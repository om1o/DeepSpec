import { afterEach, expect, it, vi } from "vitest";
import { assertInspectionSchema, cleanupCloudFixture, fetchCloudVerification, verifyInspectionRoundTrip } from "./cloud-fixture-checks.mjs";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it.each(["timeout", "caller", "request"])("aborts pending verification requests on %s cancellation", async (source) => {
  const timeout = new AbortController();
  const caller = new AbortController();
  vi.spyOn(AbortSignal, "timeout").mockReturnValue(timeout.signal);
  vi.stubGlobal("fetch", vi.fn((_input, init) => new Promise((_resolve, reject) => {
    if (init.signal.aborted) reject(new Error("aborted"));
    else init.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
  })));
  const input = source === "request" ? new Request("https://example.test", { signal: caller.signal }) : "https://example.test";
  const pending = fetchCloudVerification(input, source === "caller" ? { signal: caller.signal } : {});
  const rejected = expect(pending).rejects.toThrow("aborted");
  if (source === "timeout") timeout.abort(); else caller.abort();
  await rejected;
});

const localId = "phase8-11111111-2222-4333-8444-555555555555";
const userId = "qa-owner";
const imagePath = `${userId}/${localId}.jpg`;

function fixture(options = {}) {
  const state = { row: { local_id: localId, user_id: userId, result_json: { partName: "Original AI" }, notes: "Original notes", chat_history: [{ role: "user", content: "Original chat" }], training_status: "raw_unreviewed", image_path: imagePath }, image: true, operations: [] };
  const client = (other = false) => ({
    from(table) {
      let operation = "read", patch, single = false, limit;
      const filters = [];
      const query = {
        select() { return query; },
        eq(key, value) { filters.push([key, value]); return query; },
        limit(value) { limit = value; return query; },
        single() { single = true; return query; },
        update(value) { operation = "update"; patch = value; return query; },
        delete() { operation = "delete"; return query; },
        then(resolve, reject) {
          return Promise.resolve().then(() => {
            state.operations.push({ other, table, operation, filters, limit });
            if (limit === 0) return { error: options.schemaError ?? null, data: [] };
            if (operation === "delete") {
              if (table === "scan_lookups" && !options.cleanupError && !options.rowsRemain) state.row = null;
              return { error: options.cleanupError ?? null, data: [] };
            }
            if (operation === "update") {
              if (other && options.crossError) return { error: options.crossError };
              if (other && !options.crossWrite && !options.silentCrossWrite) return { data: [], error: null };
              state.row = { ...state.row, ...patch, ...(options.corruptEvidence ? { notes: "Lost notes" } : {}) };
              return { data: options.missingUpdatedRow || (other && options.silentCrossWrite) ? [] : [{ local_id: localId }], error: null };
            }
            if (other) return { data: options.crossRead ? [structuredClone(state.row)] : [], error: null };
            const data = table === "scan_lookups" && state.row ? [structuredClone(state.row)] : [];
            return { data: single ? data[0] : data, error: null };
          }).then(resolve, reject);
        },
      };
      return query;
    },
    storage: { from: () => ({
      remove: vi.fn(async () => { state.operations.push({ operation: "remove-image" }); if (!options.imageRemains) state.image = false; return { error: options.imageCleanupError ?? null }; }),
      list: vi.fn(async () => ({ data: state.image ? [{ name: `${localId}.jpg` }] : [], error: null })),
    }) },
  });
  return { owner: client(), other: client(true), state };
}

it.each(["42703", "PGRST204"])("classifies missing inspection schema without writes: %s", async (code) => {
  const f = fixture({ schemaError: { code, message: "inspection_json missing" } });
  await expect(assertInspectionSchema(f.owner)).rejects.toThrow(/blocked.*inspection_json.*No scan fixtures/);
  expect(f.state.operations.every((op) => op.operation === "read" && op.limit === 0)).toBe(true);
});

it("does not classify permission or infrastructure errors as a missing migration", async () => {
  const f = fixture({ schemaError: { code: "42501", message: "permission denied" } });
  await expect(assertInspectionSchema(f.owner)).rejects.toThrow(/preflight failed: permission denied/);
});

it("verifies owner updates preserve evidence and another account cannot read or change it", async () => {
  const f = fixture();
  await assertInspectionSchema(f.owner);
  await verifyInspectionRoundTrip(f.owner, f.other, userId, localId);
  expect(f.state.row.inspection_json.inspectorName).toBe("Generated QA inspector");
  expect(f.state.row.inspection_json.visibleCondition).toBe("uncertain");
  expect(f.state.row.notes).toBe("Original notes");
  const writes = f.state.operations.filter((op) => op.operation === "update");
  expect(writes).toHaveLength(3);
  expect(writes.every((op) => JSON.stringify(op.filters) === JSON.stringify([["user_id", userId], ["local_id", localId]]))).toBe(true);
});

it("accepts explicit permission denial only after owner evidence remains unchanged", async () => {
  const f = fixture({ crossError: { code: "42501", message: "RLS denied" } });
  await expect(verifyInspectionRoundTrip(f.owner, f.other, userId, localId)).resolves.toBeUndefined();
});

it.each([
  [{ crossRead: true }, /could read/],
  [{ crossWrite: true }, /could update/],
  [{ silentCrossWrite: true }, /owner evidence changed/],
  [{ crossError: { code: "503", message: "Service unavailable" } }, /inconclusive/],
  [{ crossError: { code: "PGRST301", message: "JWT expired" } }, /inconclusive/],
  [{ corruptEvidence: true }, /unexpectedly changed notes/],
  [{ missingUpdatedRow: true }, /expected fixture/],
])("rejects misleading verification outcomes: %j", async (options, expected) => {
  const f = fixture(options);
  await expect(verifyInspectionRoundTrip(f.owner, f.other, userId, localId)).rejects.toThrow(expected);
});

it("cleans and checks generated rows and images", async () => {
  const f = fixture();
  await cleanupCloudFixture(f.owner, userId, localId, imagePath);
  expect(f.state.row).toBeNull();
  expect(f.state.image).toBe(false);
});

it.each([{ cleanupError: { message: "Delete denied" } }, { rowsRemain: true }, { imageRemains: true }, { imageCleanupError: { message: "Storage offline" } }])("reports incomplete cleanup and still attempts every removal: %j", async (options) => {
  const f = fixture(options);
  await expect(cleanupCloudFixture(f.owner, userId, localId, imagePath)).rejects.toThrow(/cleanup incomplete/);
  expect(f.state.operations.filter((op) => op.operation === "delete")).toHaveLength(2);
  expect(f.state.operations.some((op) => op.operation === "remove-image")).toBe(true);
});

it.each([["real-user-record", imagePath], [localId, "other/image.jpg"]])("refuses cleanup of nonfixture targets: %s", async (id, path) => {
  const f = fixture();
  await expect(cleanupCloudFixture(f.owner, userId, id, path)).rejects.toThrow(/Refusing cleanup/);
  expect(f.state.operations).toEqual([]);
});
