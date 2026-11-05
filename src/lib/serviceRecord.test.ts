import { describe, expect, it } from "vitest";
import type { ServiceRecord } from "../types/serviceRecord";
import { confirmVehicleContextField } from "./vehicleContext";
import { MAX_SERVICE_RECORDS, mergeServiceRecords, normalizeServiceRecord, normalizeServiceRecords, serviceRecordRows, serviceRecordStatus, serviceRecordValidationError } from "./serviceRecord";

const LOOKUP = "scan-original";
const WHEN = "2026-11-05T12:00:00.000Z";
const id = (number: number) => `00000000-0000-4000-8000-${number.toString(16).padStart(12, "0")}`;
function measurement(number = 1): ServiceRecord {
  return { version: 1, id: id(number), lookupId: LOOKUP, recordedAt: WHEN, occurredOn: "2026-11-04", recordedBy: "Recorder name",
    basis: "personally_performed", subject: "Recorded component / test point", photoIds: ["photo-1", "marking"], notes: "Shared evidence note",
    kind: "measurement", quantity: "Recorded thickness", reading: "12.00", unit: "mm", method: "Recorded measurement method", instrument: "Instrument as reported", conditions: "Conditions as reported", noReadingReason: "" };
}
function repair(number = 2): ServiceRecord {
  return { ...measurement(number), kind: "repair", action: "Recorded component replacement", status: "completed", parts: "Reported replacement part" };
}
function followUp(number = 3, relatedRecordIds = [id(2)]): ServiceRecord {
  return { ...measurement(number), kind: "follow_up", check: "Recorded symptom check", outcome: "symptom_not_observed", conditions: "Only the stated conditions", relatedRecordIds };
}
function correction(previous: ServiceRecord, number = 4): ServiceRecord {
  return { ...previous, id: id(number), supersedesId: previous.id, correctionReason: "Corrected transcription", recordedAt: "2026-11-05T12:01:00.000Z" };
}
function retraction(previous: ServiceRecord, number = 5): ServiceRecord {
  return { ...measurement(number), kind: "retraction", supersedesId: previous.id, correctionReason: "Withdrawn because the original attribution was wrong" };
}

describe("human service record validation", () => {
  it("preserves exact accepted text and numeric precision while projecting a fresh immutable record", () => {
    const raw = { ...measurement(), subject: "  Supplied subject  ", reading: "  +0012.000  ", quantity: " Supplied quantity ", extraAIResult: "must not persist" };
    const normalized = normalizeServiceRecord(raw);
    expect(normalized).toMatchObject({ subject: raw.subject, reading: raw.reading, quantity: raw.quantity });
    expect(normalized).not.toHaveProperty("extraAIResult"); expect(normalized).not.toBe(raw);
    expect(normalized?.photoIds).not.toBe(raw.photoIds);
    expect(serviceRecordValidationError(raw)).toBeNull();
  });

  it.each(["0", "-0.00", ".125", "1.", "1.250e-3", "+12.00"])("accepts and preserves a finite decimal reading %s", (reading) => {
    expect(normalizeServiceRecord({ ...measurement(), reading })).toHaveProperty("reading", reading);
  });

  it.each(["", " ", "NaN", "Infinity", "-Infinity", "1e309", "0x10", "12 mm", "1,234", "1/2", "<12", 12, undefined])("rejects nonnumeric or nonfinite reading %s", (reading) => {
    const raw = { ...measurement(), reading };
    expect(normalizeServiceRecord(raw)).toBeUndefined(); expect(serviceRecordValidationError(raw)).toMatch(/reading/i);
  });

  it("distinguishes a missing reading from zero and rejects contradictory explanations", () => {
    const raw = { ...measurement(), reading: null, unit: "", method: "", instrument: "", noReadingReason: "Measurement was not obtained." };
    expect(normalizeServiceRecord(raw)).toMatchObject({ reading: null, noReadingReason: raw.noReadingReason });
    expect(normalizeServiceRecord({ ...raw, noReadingReason: "" })).toBeUndefined();
    expect(normalizeServiceRecord({ ...raw, reading: "0", unit: "mm", method: "Reported method" })).toBeUndefined();
    expect(normalizeServiceRecord({ ...measurement(), reading: "0" })).toHaveProperty("reading", "0");
    expect(normalizeServiceRecord({ ...measurement(), method: "" })).toBeUndefined();
    expect(normalizeServiceRecord({ ...measurement(), unit: "" })).toBeUndefined();
    expect(serviceRecordRows(normalizeServiceRecord(raw)!)).toContainEqual(["Human-recorded reading", "No reading obtained"]);
  });

  it.each([
    { version: "1" }, { version: 2 }, { id: "bad-id" }, { lookupId: "../other" }, { lookupId: ".." },
    { recordedAt: "2026-02-30T12:00:00Z" }, { recordedAt: "2026-11-05" }, { recordedAt: "2026-11-05T24:00:00Z" },
    { occurredOn: "2025-02-29" }, { occurredOn: "2026-04-31" }, { occurredOn: "yesterday" }, { occurredOn: undefined },
    { recordedBy: "" }, { recordedBy: "x".repeat(121) }, { subject: " " }, { subject: "x".repeat(201) }, { notes: "x".repeat(2001) },
    { basis: ["personally_performed"] }, { basis: "ai_generated" }, { analysisAttemptId: "../analysis" },
    { photoIds: ["photo-1", "photo-1"] }, { photoIds: ["../photo"] }, { photoIds: ["a", "b", "c", "d", "e"] },
    { supersedesId: id(1), correctionReason: "Self correction" }, { supersedesId: id(2) }, { correctionReason: "No referenced entry" },
  ])("rejects invalid common metadata without trimming or inventing a default: %j", (patch) => {
    expect(normalizeServiceRecord({ ...measurement(), ...patch })).toBeUndefined();
  });

  it("accepts actual leap days, unknown dates and valid UTC fractional seconds", () => {
    expect(normalizeServiceRecord({ ...measurement(), occurredOn: "2024-02-29", recordedAt: "2024-02-29T23:59:59.1Z" })).toBeDefined();
    expect(normalizeServiceRecord({ ...measurement(), occurredOn: null })).toHaveProperty("occurredOn", null);
    expect(normalizeServiceRecord({ ...measurement(), analysisAttemptId: "Original-Analysis:retry_2" })).toHaveProperty("analysisAttemptId", "Original-Analysis:retry_2");
  });

  it("requires a check for an observed result but permits explicitly not checked", () => {
    expect(normalizeServiceRecord({ ...followUp(), check: "" })).toBeUndefined();
    expect(normalizeServiceRecord({ ...followUp(), check: "", outcome: "not_checked" })).toBeDefined();
    expect(normalizeServiceRecord({ ...followUp(), outcome: "resolved" })).toBeUndefined();
    expect(normalizeServiceRecord({ ...repair(), status: ["completed"] })).toBeUndefined();
    expect(normalizeServiceRecord({ ...followUp(), relatedRecordIds: [id(3)] })).toBeUndefined();
    expect(normalizeServiceRecord({ ...followUp(), relatedRecordIds: [id(2), id(2)] })).toBeUndefined();
  });

  it("enforces per-kind string bounds without losing long input", () => {
    for (const patch of [{ quantity: "x".repeat(121) }, { reading: "1".repeat(101) }, { unit: "x".repeat(41) }, { method: "x".repeat(1001) }, { instrument: "x".repeat(201) }, { conditions: "x".repeat(1001) }]) expect(normalizeServiceRecord({ ...measurement(), ...patch })).toBeUndefined();
    expect(normalizeServiceRecord({ ...repair(), action: "x".repeat(2001) })).toBeUndefined();
    expect(normalizeServiceRecord({ ...repair(), parts: "x".repeat(2001) })).toBeUndefined();
    expect(normalizeServiceRecord({ ...followUp(), check: "x".repeat(2001) })).toBeUndefined();
    expect(normalizeServiceRecord({ ...correction(measurement()), correctionReason: "x".repeat(1001) })).toBeUndefined();
  });

  it("allowlists vehicle facts and removes private/shop context and stale confirmations", () => {
    const context = confirmVehicleContextField({ make: "Toyota", vin: "1hgcm82633a004352", mileage: "120000", mileageUnit: "km", modifications: { status: "modified", details: "Reported intake modification" }, symptom: "Reported noise", notes: "PRIVATE_VEHICLE_NOTE", customerName: "PRIVATE_CUSTOMER", bayOrRo: "PRIVATE_JOB" }, "make", true, WHEN);
    const normalized = normalizeServiceRecord({ ...measurement(), vehicleContext: { ...context, plate: "PRIVATE_PLATE", technicianName: "PRIVATE_TECH", jobTitle: "PRIVATE_TITLE" } })!;
    expect(normalized.vehicleContext).toMatchObject({ make: "Toyota", vin: "1HGCM82633A004352", mileageUnit: "km", symptom: "Reported noise" });
    expect(normalized.vehicleContext?.confirmedFields?.make).toBeDefined();
    expect(JSON.stringify(normalized.vehicleContext)).not.toContain("PRIVATE_");
    const edited = normalizeServiceRecord({ ...normalized, vehicleContext: { ...normalized.vehicleContext, make: "Other make" } });
    expect(edited?.vehicleContext?.confirmedFields?.make).toBeUndefined();
    expect(normalizeServiceRecord({ ...measurement(), vehicleContext: { engine: "x".repeat(121) } })).toBeUndefined();
  });
});

describe("immutable human service history", () => {
  it("orders records by recordedAt then canonical ID without mutating either input", () => {
    const first = measurement(1), second = repair(2), third = followUp(3);
    const local = [third, first], incoming = [second]; const before = JSON.stringify([local, incoming]);
    expect(mergeServiceRecords(local, incoming, LOOKUP).map((record) => record.id)).toEqual([id(1), id(2), id(3)]);
    expect(JSON.stringify([local, incoming])).toBe(before);
    expect(normalizeServiceRecords([third, second, first], LOOKUP)?.map((record) => record.id)).toEqual([id(1), id(2), id(3)]);
  });

  it("permits exact merge retries but rejects duplicate input IDs and same-ID changed content", () => {
    const record = measurement(10);
    expect(mergeServiceRecords([record], [{ ...record, id: record.id.toUpperCase() }], LOOKUP)).toEqual([record]);
    expect(normalizeServiceRecords([record, record], LOOKUP)).toBeUndefined();
    expect(normalizeServiceRecords([record, { ...record, id: record.id.toUpperCase() }], LOOKUP)).toBeUndefined();
    expect(() => mergeServiceRecords([record], [{ ...record, notes: "different content" }], LOOKUP)).toThrow("conflicting content");
    expect(() => mergeServiceRecords([record], [record, record], LOOKUP)).toThrow("invalid");
  });

  it("validates same-scan references and allows a correction delta whose parent is local", () => {
    const original = measurement(), amended = correction(original);
    expect(normalizeServiceRecord(amended)).toBeDefined();
    expect(normalizeServiceRecords([amended], LOOKUP)).toBeUndefined();
    expect(mergeServiceRecords([original], [amended], LOOKUP)).toHaveLength(2);
    expect(normalizeServiceRecords([original, { ...amended, lookupId: "different-scan" }], LOOKUP)).toBeUndefined();
    expect(() => mergeServiceRecords([original], [followUp(9, [id(99)])], LOOKUP)).toThrow("missing references");
    expect(normalizeServiceRecords([original, { ...repair(), supersedesId: original.id, correctionReason: "Wrong kind" }], LOOKUP)).toBeUndefined();
  });

  it("rejects correction and related-reference cycles", () => {
    const a = correction(measurement(2), 1), b = correction(measurement(1), 2);
    expect(normalizeServiceRecords([a, b], LOOKUP)).toBeUndefined();
    const followA = followUp(10, [id(11)]), followB = followUp(11, [id(10)]);
    expect(() => mergeServiceRecords([followA], [followB], LOOKUP)).toThrow("cycle");
  });

  it("retains corrections and retractions instead of replacing an earlier statement", () => {
    const original = measurement(), amended = correction(original), withdrawn = retraction(amended);
    const all = mergeServiceRecords([original], [withdrawn, amended], LOOKUP);
    expect(all).toHaveLength(3);
    expect(serviceRecordStatus(original, all)).toBe("superseded");
    expect(serviceRecordStatus(amended, all)).toBe("retracted");
    expect(serviceRecordStatus(withdrawn, all)).toBe("retracted");
    expect(normalizeServiceRecords([...all, correction(withdrawn, 8)], LOOKUP)).toBeUndefined();
  });

  it("preserves forked corrections from different devices without choosing the newest clock", () => {
    const original = measurement(), a = correction(original, 4), b = { ...correction(original, 6), recordedAt: "2026-11-06T00:00:00Z" };
    const merged = mergeServiceRecords([original, a], [original, b], LOOKUP);
    expect(merged).toHaveLength(3);
    expect(merged.map((record) => serviceRecordStatus(record, merged))).toEqual(["conflicting_correction", "conflicting_correction", "conflicting_correction"]);
    const withdrawnBranch = retraction(a, 7);
    const withRetraction = mergeServiceRecords(merged, [withdrawnBranch], LOOKUP);
    expect(serviceRecordStatus(b, withRetraction)).toBe("conflicting_correction");
    expect(serviceRecordStatus(withdrawnBranch, withRetraction)).toBe("conflicting_correction");
  });

  it("enforces complete-list limits in UTF-8 bytes and never truncates during merge", () => {
    const tooMany = Array.from({ length: MAX_SERVICE_RECORDS + 1 }, (_, index) => measurement(index + 1));
    expect(normalizeServiceRecords(tooMany, LOOKUP)).toBeUndefined();
    expect(() => mergeServiceRecords(tooMany.slice(0, 60), tooMany.slice(60), LOOKUP)).toThrow("100 entries");
    const large = Array.from({ length: 60 }, (_, index) => ({ ...measurement(index + 1), notes: "界".repeat(1800) }));
    expect(JSON.stringify(large).length).toBeLessThan(256 * 1024);
    expect(normalizeServiceRecords(large, LOOKUP)).toBeUndefined();
    expect(() => mergeServiceRecords(large.slice(0, 30), large.slice(30), LOOKUP)).toThrow("256 KiB");
  });
});

describe("shared service record display projection", () => {
  it("excludes recorder and VIN by default, always includes evidence notes, and never includes private vehicle/shop fields", () => {
    const raw = { ...measurement(), vehicleContext: { make: "Toyota", vin: "1HGCM82633A004352", notes: "PRIVATE_VEHICLE_NOTE", customerName: "PRIVATE_CUSTOMER", plate: "PRIVATE_PLATE" } };
    const standard = JSON.stringify(serviceRecordRows(raw));
    for (const omitted of [raw.recordedBy, raw.vehicleContext.vin, "PRIVATE_VEHICLE_NOTE", "PRIVATE_CUSTOMER", "PRIVATE_PLATE"]) expect(standard).not.toContain(omitted);
    expect(standard).toContain(raw.notes); expect(standard).toContain("Evidence notes");
    const included = JSON.stringify(serviceRecordRows(raw, { includeRecorder: true, includeVin: true, includePrivateNotes: true }));
    for (const explicit of [raw.recordedBy, raw.notes, raw.vehicleContext.vin]) expect(included).toContain(explicit);
    for (const alwaysPrivate of ["PRIVATE_VEHICLE_NOTE", "PRIVATE_CUSTOMER", "PRIVATE_PLATE"]) expect(included).not.toContain(alwaysPrivate);
    expect(standard).toContain("Toyota");
  });

  it("labels human reports, incomplete verification and temporary absence without a safety clearance", () => {
    const repaired = JSON.stringify(serviceRecordRows(repair()));
    expect(repaired).toContain("Completed — self-reported; outcome not established");
    expect(repaired).toContain("Follow-up must be recorded separately");
    const checked = JSON.stringify(serviceRecordRows(followUp()));
    expect(checked).toContain("not proof of a permanent resolution");
    expect(checked).toContain("does not certify safety");
    const planned = serviceRecordRows({ ...followUp(), kind: "follow_up", check: "Recheck after work", outcome: "not_checked", conditions: "", relatedRecordIds: [] });
    expect(planned).toContainEqual(["Check intended / not performed", "Recheck after work"]);
    expect(planned.some(([label]) => label === "Check performed")).toBe(false);
    const measured = JSON.stringify(serviceRecordRows(measurement()));
    expect(measured).toContain("12.00 mm"); expect(measured).toContain("not an AI estimate");
    expect(measured).toContain("traceability and fitness for purpose are not established");
  });

  it("exposes correction reasons and unknown dates without inventing tests or measurements", () => {
    const withdrawn = retraction(measurement()); withdrawn.occurredOn = null;
    const rows = serviceRecordRows(withdrawn);
    expect(rows).toContainEqual(["Performed date", "Unknown"]);
    expect(rows).toContainEqual(["Correction / retraction reason", withdrawn.correctionReason]);
    expect(rows.some(([label]) => label === "Human-recorded reading")).toBe(false);
    expect(JSON.stringify(rows)).toContain("No replacement finding or safety clearance is inferred");
  });
});
