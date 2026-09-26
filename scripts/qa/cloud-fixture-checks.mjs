import { isDeepStrictEqual } from "node:util";

export function fetchCloudVerification(input, options = {}) {
  const callerSignal = options.signal ?? (input instanceof Request ? input.signal : undefined);
  const timeoutSignal = AbortSignal.timeout(20_000);
  return fetch(input, { ...options, signal: callerSignal ? AbortSignal.any([callerSignal, timeoutSignal]) : timeoutSignal });
}

export async function assertInspectionSchema(client) {
  const result = await client.from("scan_lookups").select("inspection_json").limit(0);
  if (result.error && (result.error.code === "42703" || result.error.code === "PGRST204")) {
    throw new Error("Inspection cloud verification blocked: inspection_json is missing. Apply supabase/migrations/20260920000100_part_inspection.sql through the normal deployment process, then rerun. No scan fixtures were written.");
  }
  checked(result, "Inspection schema preflight");
}

export async function verifyInspectionRoundTrip(owner, other, userId, localId) {
  const read = async () => checked(await owner.from("scan_lookups").select("*").eq("user_id", userId).eq("local_id", localId).single(), "Owner inspection read").data;
  const before = await read();
  if (!before || before.user_id !== userId || before.local_id !== localId) throw new Error("Owner inspection read returned the wrong fixture.");
  const inspection = {
    confirmedPartName: "QA fixture only", partNumber: "QA-000", identityEvidence: "Synthetic verification record",
    visibleCondition: "not_inspected", visibleNotes: "", functionalStatus: "not_tested", functionalNotes: "",
    inspectorName: "Generated QA inspector", inspectedAt: new Date().toISOString(),
  };
  for (const next of [inspection, { ...inspection, visibleCondition: "uncertain", visibleNotes: "Synthetic update; no real part inspected" }]) {
    const updated = checked(await owner.from("scan_lookups").update({ inspection_json: next }).eq("user_id", userId).eq("local_id", localId).select("local_id"), "Owner inspection update");
    if (updated.data?.length !== 1 || updated.data[0].local_id !== localId) throw new Error("Owner inspection update did not return the expected fixture.");
    const actual = await read();
    if (!isDeepStrictEqual(actual.inspection_json, next)) throw new Error("Inspection did not survive cloud save/read.");
    assertEvidencePreserved(before, actual);
  }
  const expected = await read();
  const deniedRead = checked(await other.from("scan_lookups").select("inspection_json").eq("local_id", localId), "Cross-account inspection read");
  if (!Array.isArray(deniedRead.data) || deniedRead.data.length) throw new Error("Inspection isolation failed: another account could read the fixture.");
  const deniedWrite = await other.from("scan_lookups").update({ inspection_json: { ...inspection, inspectorName: "Unauthorized QA attempt" } }).eq("user_id", userId).eq("local_id", localId).select("local_id");
  if (deniedWrite.error) {
    if (deniedWrite.error.code !== "42501") throw new Error("Inspection write isolation inconclusive: request failed without an explicit permission denial.");
  } else if (!Array.isArray(deniedWrite.data) || deniedWrite.data.length) {
    throw new Error("Inspection isolation failed: another account could update the fixture.");
  }
  const after = await read();
  if (!isDeepStrictEqual(after.inspection_json, expected.inspection_json)) throw new Error("Inspection isolation failed: owner evidence changed after the other account's write attempt.");
  assertEvidencePreserved(before, after);
}

function assertEvidencePreserved(before, after) {
  for (const field of ["result_json", "training_label", "training_status", "notes", "chat_history", "rating", "correction", "image_path", "image_hash", "image_mime_type", "image_byte_length"]) {
    if (!isDeepStrictEqual(before[field], after[field])) throw new Error(`Inspection update unexpectedly changed ${field}.`);
  }
}

export async function cleanupCloudFixture(client, userId, localId, imagePath) {
  // This verifier may remove only its generated IDs, never an arbitrary user record.
  if (!/^phase8-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:-second)?$/i.test(localId) || !userId || imagePath !== `${userId}/${localId}.jpg`) {
    throw new Error("Refusing cleanup outside the generated cloud fixture.");
  }
  const failures = [];
  const attempt = async (label, action) => {
    try { checked(await action(), label); } catch (error) { failures.push(error instanceof Error ? error.message : String(error)); }
  };
  await attempt("Sync-event cleanup", () => client.from("sync_events").delete().eq("user_id", userId).eq("scan_local_id", localId));
  await attempt("Scan cleanup", () => client.from("scan_lookups").delete().eq("user_id", userId).eq("local_id", localId));
  await attempt("Image cleanup", () => client.storage.from("scan-images").remove([imagePath]));
  for (const table of ["scan_lookups", "scan_candidates", "scan_evidence", "scan_corrections", "scan_model_runs", "sync_events"]) {
    await attempt(`${table} cleanup verification`, async () => {
      const result = checked(await client.from(table).select(table === "scan_lookups" ? "local_id" : "scan_local_id").eq("user_id", userId).eq(table === "scan_lookups" ? "local_id" : "scan_local_id", localId), `${table} cleanup read`);
      if (!Array.isArray(result.data) || result.data.length) throw new Error(`${table} cleanup left a generated row or could not verify absence.`);
      return result;
    });
  }
  await attempt("Image cleanup verification", async () => {
    const result = checked(await client.storage.from("scan-images").list(userId, { search: `${localId}.jpg`, limit: 100 }), "Image cleanup listing");
    if (!Array.isArray(result.data) || result.data.some((file) => file.name === `${localId}.jpg`)) throw new Error("Image cleanup left the generated image or could not verify absence.");
    return result;
  });
  if (failures.length) throw new Error(`Cloud fixture cleanup incomplete: ${failures.join("; ")}`);
}

function checked(result, label) {
  if (result.error) throw new Error(`${label} failed: ${result.error.message ?? "Unknown service error"}`);
  return result;
}
