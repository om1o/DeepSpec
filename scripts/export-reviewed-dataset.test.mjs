import { afterEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createExportClient, exportReviewedDataset } from "./export-reviewed-dataset.mjs";

const roots = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const bytes = Buffer.from("synthetic test bytes");
const hash = createHash("sha256").update(bytes).digest("hex");
const fingerprint = createHash("md5").update(bytes).digest("hex");
const owner = "10000000-0000-4000-8000-000000000001";
const row = { id: "20000000-0000-4000-8000-000000000001", dataset_version: "v1", user_id: owner, scan_local_id: "scan-1", consent_revision: 1, policy_version: "2026-09-27-v1", scan_hash: fingerprint, model_run_id: "30000000-0000-4000-8000-000000000001", model_run_hash: fingerprint, label: "Alternator", label_source: "human_verified_prediction", original_prediction: "Alternator", correction: null, provider: "test", model: "test-model", prompt_version: "v1", pipeline_version: "v1", reviewer_reference: "test-reviewer", original_image_path: `${owner}/scan-1.jpg`, original_image_hash: hash, original_image_mime_type: "image/jpeg", original_image_byte_length: bytes.length, isolated_image_path: null, eligible: true };
const corrected = { ...row, label: "Compressor", label_source: "human_verified_correction", correction: "Compressor" };
const outcome = { dataset_member_id: row.id, dataset_version: "v1", record_id: "40000000-0000-4000-8000-000000000001", reported_outcome: "symptom_not_observed", reporting_basis: "personally_performed", consent_revision: 1, policy_version: "2026-11-26-v1", reviewer_reference: "outcome-reviewer", reviewed_history_hash: fingerprint, eligible: true };
async function fixture(overrides = {}) {
  const root = await mkdtemp(join(tmpdir(), "deepspec-export-test-")); roots.push(root);
  return { root, outputDir: join(root, "dataset"), version: "v1", client: { list: async () => [structuredClone(row)], download: async () => ({ bytes, mime: "image/jpeg" }), ...overrides } };
}
async function rejectsClean(options, pattern) {
  await expect(exportReviewedDataset(options)).rejects.toThrow(pattern);
  expect(await readdir(options.root)).toEqual([]);
}

describe("reviewed dataset export", () => {
  it("exports only a separately consented, reviewed self-reported outcome with a corrected case", async () => {
    const options = await fixture({ list: async () => [corrected], listOutcomes: async () => [{ ...outcome, notes: "private", recorder_name: "private", vin: "private", photo: "private" }], download: async () => { throw new Error("Outcome export must not download photos"); } });
    await exportReviewedDataset({ ...options, includeOutcomes: true });
    const manifest = JSON.parse(await readFile(join(options.outputDir, "manifest.json"), "utf8"));
    expect(manifest.format_version).toBe(2);
    expect(manifest.members).toBeUndefined();
    expect(await readdir(options.outputDir)).toEqual(["manifest.json"]);
    expect(manifest.reported_outcomes).toEqual([{ dataset_member_id: row.id, dataset_version: "v1", record_id: outcome.record_id, reported_outcome: "symptom_not_observed", reporting_basis: "personally_performed", consent_revision: 1, policy_version: "2026-11-26-v1", reviewer_reference: "outcome-reviewer", reviewed_history_hash: fingerprint }]);
    expect(JSON.stringify(manifest)).not.toMatch(/private|photo|vin|notes|recorder_name/);
  });
  it("rejects withdrawn, missing, or changed outcome evidence without an accepted export", async () => {
    await rejectsClean({ ...await fixture({ list: async () => [corrected], listOutcomes: async () => [] }), includeOutcomes: true }, /separately consented/);
    let calls = 0;
    await rejectsClean({ ...await fixture({ list: async () => [corrected], listOutcomes: async () => ++calls === 1 ? [outcome] : [] }), includeOutcomes: true }, /separately consented/);
    calls = 0;
    await rejectsClean({ ...await fixture({ list: async () => [corrected], listOutcomes: async () => [{ ...outcome, consent_revision: ++calls }] }), includeOutcomes: true }, /Outcome consent, review or history changed/);
  });
  it("rejects an outcome attached to an uncorrected or wrong case", async () => {
    await rejectsClean({ ...await fixture({ listOutcomes: async () => [outcome] }), includeOutcomes: true }, /Invalid or unreviewed outcome/);
    await rejectsClean({ ...await fixture({ list: async () => [corrected], listOutcomes: async () => [{ ...outcome, dataset_member_id: "50000000-0000-4000-8000-000000000001" }] }), includeOutcomes: true }, /Invalid or unreviewed outcome/);
  });
  it("does not export unconsented service outcomes or unexpected private view fields", async () => {
    const options = await fixture({ list: async () => [{ ...row, service_outcome: "symptom_not_observed", service_record_json: { check: "Private follow-up" }, customer_note: "Private note" }] });
    await exportReviewedDataset(options);
    const manifest = JSON.parse(await readFile(join(options.outputDir, "manifest.json"), "utf8"));
    expect(manifest.members[0]).toMatchObject({ label: "Alternator", reviewer_reference: "test-reviewer" });
    expect(manifest.members[0]).not.toHaveProperty("service_outcome");
    expect(manifest.members[0]).not.toHaveProperty("service_record_json");
    expect(manifest.members[0]).not.toHaveProperty("customer_note");
  });
  it("exports original plus optional crop with full manifest provenance and generated file names", async () => {
    const cropped = { ...row, isolated_image_path: `${owner}/crop.png`, isolated_image_hash: hash, isolated_image_mime_type: "image/png", isolated_image_byte_length: bytes.length, isolated_image_kind: "crop" };
    const options = await fixture({ list: async () => [cropped], download: async path => ({ bytes, mime: path.endsWith("png") ? "image/png" : "image/jpeg" }) });
    expect(await exportReviewedDataset(options)).toMatchObject({ members: 1 });
    const manifest = JSON.parse(await readFile(join(options.outputDir, "manifest.json"), "utf8"));
    expect(manifest.members[0]).toMatchObject({ consent_revision: 1, model_run_hash: fingerprint, reviewer_reference: "test-reviewer", files: { original: `images/${row.id}-original.jpg`, isolated: `images/${row.id}-isolated.png` } });
    expect(await readFile(join(options.outputDir, manifest.members[0].files.original))).toEqual(bytes);
    expect(await readdir(options.root)).toEqual(["dataset"]);
    expect(manifest.limits).toMatch(/Later withdrawal/);
  });
  it.each(["revoked", "deleted"])("rejects a %s member disappearing during export and leaves no partial export", async () => {
    let calls = 0;
    await rejectsClean(await fixture({ list: async () => ++calls === 1 ? [row] : [] }), /eligible memberships/);
  });
  it("rejects changed consent revision midway through export", async () => {
    let calls = 0;
    await rejectsClean(await fixture({ list: async () => [{ ...row, consent_revision: ++calls }] }), /changed during export/);
  });
  it("rejects changed reviewed model or scan metadata midway through export", async () => {
    let calls = 0;
    await rejectsClean(await fixture({ list: async () => [{ ...row, model: ++calls === 1 ? "old" : "new" }] }), /changed during export/);
  });
  it.each(["../escape.jpg", `${owner}/../escape.jpg`, `${owner}/%2e%2e/escape.jpg`, `${owner}/x\\evil.jpg`, "https://evil.example/photo.jpg", "other-owner/photo.jpg"])("rejects unsafe image path %s before downloading", async path => {
    await rejectsClean(await fixture({ list: async () => [{ ...row, original_image_path: path }], download: () => { throw new Error("Should not download"); } }), /owner's folder/);
  });
  it.each([
    { bytes: Buffer.from("mutated test bytes!!"), mime: "image/jpeg" },
    { bytes, mime: "image/png" },
    { bytes: Buffer.alloc(2 * 1024 * 1024 + 1), mime: "image/jpeg" },
  ])("rejects mutated bytes, wrong MIME, or oversized images", async download => {
    await rejectsClean(await fixture({ download: async () => download }), /no longer match/);
  });
  it("rejects ineligible initial row", async () => {
    await rejectsClean(await fixture({ list: async () => [{ ...row, eligible: false }] }), /Invalid/);
  });
  it("rejects unsupported crop kind and versions longer than database limit", async () => {
    await rejectsClean(await fixture({ list: async () => [{ ...row, isolated_image_path: `${owner}/crop.jpg`, isolated_image_hash: hash, isolated_image_mime_type: "image/jpeg", isolated_image_byte_length: bytes.length, isolated_image_kind: "unverified" }] }), /Unsupported isolated/);
    await rejectsClean({ ...await fixture(), version: "v".repeat(81) }, /1–80/);
  });
  it("preserves an existing output directory", async () => {
    const options = await fixture(); await mkdir(options.outputDir);
    await expect(exportReviewedDataset(options)).rejects.toThrow(/already exists/);
    expect(await readdir(options.root)).toEqual(["dataset"]);
  });
  it("fails download errors without accepted output or leftover staging", async () => {
    await rejectsClean(await fixture({ download: async () => { throw new Error("Network failed"); } }), /Network failed/);
  });
  it("rejects duplicate IDs and over-limit membership batches", async () => {
    await rejectsClean(await fixture({ list: async () => [row, row] }), /duplicate/);
    await rejectsClean(await fixture({ list: async () => Array(201).fill(row) }), /1–200/);
  });
});

describe("server-only export transport", () => {
  it("requests only the reviewed outcome projection, never service notes or photos", async () => {
    const requests = [];
    const client = createExportClient({ url: "https://project.supabase.co", key: "test-server-key", fetchImpl: async (url) => { requests.push(url); return new Response(JSON.stringify([outcome]), { headers: { "content-range": "0-0/1" } }); } });
    expect(await client.listOutcomes("v1")).toEqual([outcome]);
    const select = requests[0].searchParams.get("select");
    expect(requests[0].pathname).toContain("dataset_outcome_export_queue");
    expect(select).toContain("reported_outcome");
    expect(select).not.toMatch(/record_json|notes|photo|vin|recorded_by/);
  });
  it("uses fixed origin, eligible filter, bounded request, no redirects and exact count", async () => {
    const requests = [];
    const client = createExportClient({ url: "https://project.supabase.co", key: "test-server-key", fetchImpl: async (url, options) => { requests.push({ url, options }); return new Response(JSON.stringify([row]), { headers: { "content-range": "0-0/1" } }); } });
    expect(await client.list("v1")).toEqual([row]);
    expect(requests[0].url.origin).toBe("https://project.supabase.co");
    expect(requests[0].url.searchParams.get("select")).not.toBe("*");
    expect(requests[0].url.searchParams.get("select")).not.toContain("outcome");
    expect(requests[0].url.searchParams.get("eligible")).toBe("eq.true");
    expect(requests[0].options.redirect).toBe("error");
    expect(requests[0].options.headers.Prefer).toBe("count=exact");
    expect(requests[0].options.signal).toBeInstanceOf(AbortSignal);
  });
  it("does not send an opaque Supabase secret key as a bearer token", async () => {
    const requests = [];
    const client = createExportClient({ url: "https://project.supabase.co", key: "sb_secret_test", fetchImpl: async (url, options) => { requests.push({ url, options }); return new Response(JSON.stringify([row]), { headers: { "content-range": "0-0/1" } }); } });
    await client.list("v1");
    expect(requests[0].options.headers.apikey).toBe("sb_secret_test");
    expect(requests[0].options.headers.Authorization).toBeUndefined();
  });
  it("rejects a server count above the cap even if response rows are truncated", async () => {
    const client = createExportClient({ url: "https://project.supabase.co", key: "test", fetchImpl: async () => new Response("[]", { headers: { "content-range": "0-199/201" } }) });
    await expect(client.list("v1")).rejects.toThrow(/200-membership/);
  });
  it.each(["0-0/2", "0-0/*", null])("rejects incomplete or unverified entire-set count %s", async count => {
    const client = createExportClient({ url: "https://project.supabase.co", key: "test", fetchImpl: async () => new Response(JSON.stringify([row]), { headers: count ? { "content-range": count } : {} }) });
    await expect(client.list("v1")).rejects.toThrow(/Complete dataset membership/);
  });
  it("bounds streamed bytes even without Content-Length", async () => {
    const client = createExportClient({ url: "https://project.supabase.co", key: "test", fetchImpl: async () => new Response(Buffer.alloc(2 * 1024 * 1024 + 1)) });
    await expect(client.download(`${owner}/test.jpg`)).rejects.toThrow(/2 MiB/);
  });
  it("returns private storage bytes and media type", async () => {
    const client = createExportClient({ url: "https://project.supabase.co", key: "test", fetchImpl: async url => { expect(url.pathname).toContain("/storage/v1/object/authenticated/scan-images/"); return new Response(bytes, { headers: { "content-type": "image/jpeg" } }); } });
    expect(await client.download(`${owner}/test.jpg`)).toEqual({ bytes, mime: "image/jpeg" });
  });
  it.each(["http://project.supabase.co", "https://key@project.supabase.co", "https://project.supabase.co/other", "https://project.supabase.co?key=secret"])("rejects unsafe base URL %s", url => {
    expect(() => createExportClient({ url, key: "test" })).toThrow(/bare HTTPS/);
  });
});
