import { beforeEach, describe, expect, it, vi } from "vitest";
import { accountStorageKey, getAccountScope, setActiveAccount } from "../lib/accountScope";
import type { Lookup, ShopJob } from "../types";
import type { InspectionReportSnapshot } from "../types/inspectionReport";
import type { JobInspectionContext } from "../types/jobInspectionHandoff";
import { assertJobInspectionContextCurrent, buildJobInspectionReportScope, jobInspectionContextSignature, normalizeJobInspectionReportScope, readJobInspectionContext } from "./jobInspectionHandoff";
import { attachScanToJob, createShopJob, SHOP_JOBS_STORAGE_KEY, updateShopJob } from "./shop";
import { createLookup, LOOKUPS_STORAGE_KEY, readLookups, updateLookup } from "./storage";

const intake = { title: "PRIVATE_TITLE", customerName: "PRIVATE_CUSTOMER", technicianName: "PRIVATE_TECH", symptom: "PRIVATE_SYMPTOM", year: "2012", make: "Toyota", model: "Camry", engine: "2.5 L", vin: "1HGCM82633A004352" };
const frame = { imageBase64: "data:image/png;base64,c3ludGhldGlj", capturedAt: "2026-11-05T12:00:00.000Z" };
const scan = (id: string, jobId?: string, vehicleContext?: Lookup["vehicleContext"]) => createLookup({ frame, ...(jobId ? { jobId } : {}), ...(vehicleContext ? { vehicleContext } : {}) }, id).value;
const snapshot = (root: string, scans: Lookup[]): InspectionReportSnapshot => ({ version: 1, createdAt: "2026-11-05T12:00:00.000Z", rootLookupId: root, map: null, scans, missing: [], embeddedBytes: 0 });
let job: ShopJob;
beforeEach(() => { localStorage.clear(); setActiveAccount("handoff-owner"); job = createShopJob(intake).value!; });

describe("owner-scoped job inspection context", () => {
  it("unions declared and reverse membership but excludes explicit foreign membership", () => {
    scan("declared"); scan("reverse", job.id); scan("foreign", "other-job"); scan("unrelated");
    for (const id of ["declared", "foreign", "missing"]) attachScanToJob(job.id, id);
    const context = readJobInspectionContext(job.id)!;
    expect(context.scans.map((item) => item.id)).toEqual(["declared", "reverse"]);
    expect(context.unavailableScanIds).toEqual(["missing"]); expect(context.conflictingScanIds).toEqual(["foreign"]);
    expect(context.job.id).toBe(job.id); expect(readJobInspectionContext("absent")).toBeNull();
  });
  it("does not turn unreadable jobs or scans into an empty handoff", () => {
    localStorage.setItem(accountStorageKey(LOOKUPS_STORAGE_KEY), "{broken");
    expect(() => readJobInspectionContext(job.id)).toThrow("could not be read safely");
    localStorage.removeItem(accountStorageKey(LOOKUPS_STORAGE_KEY));
    localStorage.setItem(accountStorageKey(SHOP_JOBS_STORAGE_KEY), "{}");
    expect(() => readJobInspectionContext(job.id)).toThrow("could not be read safely");
  });
  it("rejects stale account generations including a switch during storage read", () => {
    const scope = getAccountScope(); const context = readJobInspectionContext(job.id)!;
    setActiveAccount("other"); expect(() => readJobInspectionContext(job.id, scope)).toThrow("Account changed");
    setActiveAccount("handoff-owner"); expect(() => assertJobInspectionContextCurrent(context)).toThrow();
    const originalGet = Storage.prototype.getItem;
    const getter = vi.spyOn(Storage.prototype, "getItem").mockImplementation(function (this: Storage, key) { const result = originalGet.call(this, key); setActiveAccount("other"); return result; });
    expect(() => readJobInspectionContext(job.id)).toThrow("Account changed"); getter.mockRestore();
  });
  it("rejects changed membership, deletion, job fields, vehicle facts and mutable context tampering", () => {
    scan("root", job.id, { make: "Toyota" });
    let context = readJobInspectionContext(job.id)!; expect(() => assertJobInspectionContextCurrent(context)).not.toThrow();
    updateShopJob(job.id, { engine: "Different" }); expect(() => assertJobInspectionContextCurrent(context)).toThrow("changed");
    context = readJobInspectionContext(job.id)!; scan("new", job.id); expect(() => assertJobInspectionContextCurrent(context)).toThrow("changed");
    context = readJobInspectionContext(job.id)!;
    const values = readLookups().value.map((item) => item.id === "root" ? { ...item, vehicleContext: { make: "Different" } } : item);
    localStorage.setItem(accountStorageKey(LOOKUPS_STORAGE_KEY), JSON.stringify(values)); expect(() => assertJobInspectionContextCurrent(context)).toThrow("changed");
    context = readJobInspectionContext(job.id)!; context.job.title = "Changed in memory"; expect(() => assertJobInspectionContextCurrent(context)).toThrow("changed");
    context = readJobInspectionContext(job.id)!; localStorage.setItem(accountStorageKey(SHOP_JOBS_STORAGE_KEY), "[]"); expect(() => assertJobInspectionContextCurrent(context)).toThrow("changed");
  });
  it("keeps photo bytes out of the membership signature and leaves image freshness to the collector", () => {
    scan("root", job.id); const context = readJobInspectionContext(job.id)!;
    expect(jobInspectionContextSignature(context)).not.toContain(frame.imageBase64);
    const withUnexpectedField = { ...context, job: { ...context.job, imageBase64: "PRIVATE_IMAGE_BYTES" } };
    expect(jobInspectionContextSignature(withUnexpectedField)).not.toContain("PRIVATE_IMAGE_BYTES");
    expect(jobInspectionContextSignature(withUnexpectedField)).toBe(jobInspectionContextSignature(context));
    updateLookup("root", { notes: "A scan note is verified by the collector" });
    expect(() => assertJobInspectionContextCurrent(context)).not.toThrow();
  });
  it("rejects an overview whose original presence changes before the next action", () => {
    scan("root", job.id); const context = readJobInspectionContext(job.id)!;
    const lookups = readLookups().value.map((item) => ({ ...item, photos: [] }));
    localStorage.setItem(accountStorageKey(LOOKUPS_STORAGE_KEY), JSON.stringify(lookups));
    expect(() => assertJobInspectionContextCurrent(context)).toThrow("changed");
  });
});

describe("one-snapshot job report scope", () => {
  function fixture() {
    const root = scan("root", job.id, { make: " toyota ", model: " CAMRY", engine: "2.5   l" });
    const excluded = scan("excluded", job.id);
    const conflict = scan("conflict", "other-job", { year: "2014" });
    const outside = scan("outside", undefined, { vin: "OTHER_VIN", model: "Corolla", year: "unknown" });
    attachScanToJob(job.id, "conflict"); attachScanToJob(job.id, "missing");
    const context = readJobInspectionContext(job.id)!;
    return { context, report: snapshot(root.id, [root, conflict, outside]), root, excluded, conflict, outside };
  }
  it("partitions eligible, excluded, unavailable, conflict and outside references without claiming whole-job coverage", () => {
    const { context, report } = fixture(); const result = buildJobInspectionReportScope(context, report);
    expect(result).toEqual({ version: 1, jobId: job.id, rootLookupId: "root", jobScanIds: ["conflict", "excluded", "missing", "root"], includedJobScanIds: ["root"], excludedJobScanIds: ["excluded"], unavailableJobScanIds: ["missing"], conflictingJobScanIds: ["conflict"], outsideJobScanIds: ["outside"], vehicleDifferences: [{ lookupId: "conflict", fields: ["year"] }, { lookupId: "outside", fields: ["vin", "model"] }] });
    const raw = JSON.stringify(result); for (const privateValue of ["PRIVATE_TITLE", "PRIVATE_CUSTOMER", "PRIVATE_TECH", "PRIVATE_SYMPTOM", intake.vin, "OTHER_VIN", "Corolla"]) expect(raw).not.toContain(privateValue);
    expect(result).not.toHaveProperty("sameVehicle"); expect(result).not.toHaveProperty("confirmed");
    expect(normalizeJobInspectionReportScope(JSON.parse(raw), report)).toEqual(result);
  });
  it("does not select a foreign, excluded or deleted root automatically", () => {
    const { context, report } = fixture();
    for (const root of ["outside", "conflict", "missing", "excluded"]) expect(() => buildJobInspectionReportScope(context, { ...report, rootLookupId: root })).toThrow("Choose an available scan");
  });
  it("reclassifies a declared missing scan recovered in the supplied snapshot without a second collection", () => {
    const { context, report, root } = fixture();
    const recovered = { ...root, id: "missing", jobId: job.id };
    const included = buildJobInspectionReportScope(context, { ...report, scans: [...report.scans, recovered] });
    expect(included.includedJobScanIds).toEqual(["missing", "root"]); expect(included.unavailableJobScanIds).toEqual([]);
    const foreign = buildJobInspectionReportScope(context, { ...report, scans: [...report.scans, { ...recovered, jobId: "foreign" }] });
    expect(foreign.includedJobScanIds).toEqual(["root"]); expect(foreign.conflictingJobScanIds).toEqual(["conflict", "missing"]); expect(foreign.unavailableJobScanIds).toEqual([]);
    expect(() => buildJobInspectionReportScope(context, { ...report, rootLookupId: "missing", scans: [...report.scans, recovered] })).toThrow("Choose an available scan");
  });
  it("discovers explicit same-job membership in the snapshot and rejects a forged included foreign association", () => {
    const { context, report, root } = fixture();
    const found = { ...root, id: "snapshot-discovered", jobId: job.id };
    const prepared = { ...report, scans: [...report.scans, found] };
    const result = buildJobInspectionReportScope(context, prepared);
    expect(result.jobScanIds).toContain(found.id); expect(result.includedJobScanIds).toContain(found.id); expect(result.outsideJobScanIds).not.toContain(found.id);
    const forged = { ...result, includedJobScanIds: [...result.includedJobScanIds, "conflict"], conflictingJobScanIds: [] };
    expect(normalizeJobInspectionReportScope(forged, prepared)).toBeUndefined();
    const omitted = { ...result, jobScanIds: result.jobScanIds.filter((id) => id !== found.id), includedJobScanIds: result.includedJobScanIds.filter((id) => id !== found.id), outsideJobScanIds: [...result.outsideJobScanIds, found.id] };
    expect(normalizeJobInspectionReportScope(omitted, prepared)).toBeUndefined();
  });
  it("rejects private/unknown export fields, inconsistent categories and invented photo membership", () => {
    const { context, report } = fixture(); const valid = buildJobInspectionReportScope(context, report);
    for (const patch of [{ title: "PRIVATE" }, { customerName: "PRIVATE" }, { vin: intake.vin }, { includedJobScanIds: ["root", "conflict"] }, { excludedJobScanIds: [] }, { outsideJobScanIds: [] }, { unavailableJobScanIds: ["root"] }, { rootLookupId: "outside" }, { jobScanIds: ["root", "root"] }, { vehicleDifferences: [{ lookupId: "outside", fields: ["vin"], values: [intake.vin] }] }, { vehicleDifferences: [{ lookupId: "outside", fields: ["customerName"] }] }, { vehicleDifferences: [{ lookupId: "invented", fields: ["model"] }] }]) expect(normalizeJobInspectionReportScope({ ...valid, ...patch }, report)).toBeUndefined();
    expect(normalizeJobInspectionReportScope(valid, { ...report, scans: [...report.scans, report.scans[0]] })).toBeUndefined();
  });
  it("returns new scope arrays and never mutates the frozen snapshot or context", () => {
    const { context, report } = fixture(); const before = JSON.stringify({ context, report });
    const result = buildJobInspectionReportScope(context, report); result.jobScanIds.push("extra");
    expect(JSON.stringify({ context, report })).toBe(before);
    expect(() => assertJobInspectionContextCurrent({ ...context } as JobInspectionContext)).toThrow("changed");
  });
});
