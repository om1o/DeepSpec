import { getAccountScope, setActiveAccount } from "../lib/accountScope";
import { emptyPartInspection } from "../lib/partInspection";
import { inspectionDraftKey, readInspectionDraft, writeInspectionDraft, type InspectionRecovery } from "./inspectionDraft";

const scanId = "inspection/service-review";
const record = (notes = "  Check the mount\nwhen the tester returns  "): InspectionRecovery => ({
  version: 1,
  draft: { ...emptyPartInspection, visibleNotes: notes },
  deviceInspection: "null",
  displayedInspection: "null",
  updatedAt: "2026-09-26T16:00:00.000Z",
});

beforeEach(() => {
  localStorage.clear();
  setActiveAccount("draft-owner-a");
});
afterEach(() => vi.restoreAllMocks());

it("retains exact incomplete text separately from a completed inspection", () => {
  const scope = getAccountScope();
  const incomplete = record();
  const written = writeInspectionDraft(scope, scanId, null, incomplete);
  expect(written.ok).toBe(true);
  const recovered = readInspectionDraft(scope, scanId);
  expect(recovered.record).toEqual(incomplete);
  expect(recovered.record?.draft.inspectorName).toBe("");
  expect(recovered.message).toBe("");
  expect(recovered.raw).toBe(JSON.stringify(incomplete));
});

it("keeps two accounts' drafts separate even for the same scan ID", () => {
  writeInspectionDraft(getAccountScope(), scanId, null, record("Owner A notes"));
  setActiveAccount("draft-owner-b");
  expect(readInspectionDraft(getAccountScope(), scanId)).toEqual({ raw: null, record: null, message: "" });
  writeInspectionDraft(getAccountScope(), scanId, null, record("Owner B notes"));
  expect(readInspectionDraft(getAccountScope(), scanId).record?.draft.visibleNotes).toBe("Owner B notes");
  setActiveAccount("draft-owner-a");
  expect(readInspectionDraft(getAccountScope(), scanId).record?.draft.visibleNotes).toBe("Owner A notes");
});

it.each(["other-account", "round-trip", "signed-out"])("blocks stale reads, updates and removal after %s", (change) => {
  const scope = getAccountScope();
  const raw = JSON.stringify(record());
  writeInspectionDraft(scope, scanId, null, record());
  setActiveAccount(change === "signed-out" ? null : "draft-owner-b");
  if (change === "round-trip") setActiveAccount("draft-owner-a");
  const read = vi.spyOn(Storage.prototype, "getItem");
  const write = vi.spyOn(Storage.prototype, "setItem");
  const remove = vi.spyOn(Storage.prototype, "removeItem");
  expect(readInspectionDraft(scope, scanId)).toMatchObject({ raw: null, record: null, message: expect.stringContaining("Account changed") });
  expect(writeInspectionDraft(scope, scanId, raw, record("stale edit"))).toMatchObject({ ok: false, message: expect.stringContaining("Account changed") });
  expect(writeInspectionDraft(scope, scanId, raw, null)).toMatchObject({ ok: false, message: expect.stringContaining("Account changed") });
  expect(read).not.toHaveBeenCalled();
  expect(write).not.toHaveBeenCalled();
  expect(remove).not.toHaveBeenCalled();
});

const invalidRecords: [string, string][] = [
  ["invalid JSON", "{broken"],
  ["null", "null"],
  ["future version", JSON.stringify({ ...record(), version: 2 })],
  ["missing fields", JSON.stringify({ ...record(), draft: {} })],
  ["invalid visible condition", JSON.stringify({ ...record(), draft: { ...record().draft, visibleCondition: "certified" } })],
  ["invalid function status", JSON.stringify({ ...record(), draft: { ...record().draft, functionalStatus: "guaranteed" } })],
  ["oversized field", JSON.stringify({ ...record(), draft: { ...record().draft, visibleNotes: "x".repeat(1001) } })],
  ["invalid timestamp", JSON.stringify({ ...record(), updatedAt: "not a date" })],
  ["invalid base inspection", JSON.stringify({ ...record(), deviceInspection: false })],
  ["invalid displayed inspection", JSON.stringify({ ...record(), displayedInspection: null })],
  ["oversized record", JSON.stringify({ ...record(), padding: "x".repeat(40_001) })],
];

it.each(invalidRecords)("preserves unreadable %s until explicitly discarded", (_label, raw) => {
  const scope = getAccountScope();
  const key = inspectionDraftKey(scanId);
  localStorage.setItem(key, raw);
  const recovered = readInspectionDraft(scope, scanId);
  expect(recovered).toMatchObject({ raw, record: null, message: expect.stringContaining("could not be read") });
  expect(localStorage.getItem(key)).toBe(raw);
  expect(writeInspectionDraft(scope, scanId, null, record())).toMatchObject({ ok: false });
  expect(localStorage.getItem(key)).toBe(raw);
  expect(writeInspectionDraft(scope, scanId, recovered.raw, null)).toEqual({ ok: true, raw: null });
  expect(localStorage.getItem(key)).toBeNull();
});

it("rejects an oversized new draft without replacing the previous recovery copy", () => {
  const scope = getAccountScope();
  const initial = record("Earlier recovery copy");
  const raw = JSON.stringify(initial);
  writeInspectionDraft(scope, scanId, null, initial);
  expect(writeInspectionDraft(scope, scanId, raw, record("x".repeat(1001)))).toMatchObject({ ok: false });
  expect(readInspectionDraft(scope, scanId).record).toEqual(initial);
});

it("reports storage read failure without attempting a blind update or removal", () => {
  const scope = getAccountScope();
  const initial = record();
  writeInspectionDraft(scope, scanId, null, initial);
  const read = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new DOMException("unavailable", "SecurityError"); });
  const write = vi.spyOn(Storage.prototype, "setItem");
  const remove = vi.spyOn(Storage.prototype, "removeItem");
  expect(readInspectionDraft(scope, scanId)).toMatchObject({ raw: null, record: null, message: expect.stringContaining("Download a copy") });
  expect(writeInspectionDraft(scope, scanId, null, record("new text"))).toMatchObject({ ok: false, message: expect.stringContaining("Download a copy") });
  expect(writeInspectionDraft(scope, scanId, null, null)).toMatchObject({ ok: false });
  expect(write).not.toHaveBeenCalled();
  expect(remove).not.toHaveBeenCalled();
  read.mockRestore();
  expect(readInspectionDraft(scope, scanId).record).toEqual(initial);
});

it("keeps the previous recovery copy when a draft update exceeds storage quota", () => {
  const scope = getAccountScope();
  const initial = record("Earlier recovery copy");
  const raw = JSON.stringify(initial);
  writeInspectionDraft(scope, scanId, null, initial);
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("full", "QuotaExceededError"); });
  const next = record("New in-memory text");
  expect(writeInspectionDraft(scope, scanId, raw, next)).toMatchObject({ ok: false, message: expect.stringContaining("Download a copy") });
  expect(readInspectionDraft(scope, scanId).record).toEqual(initial);
  expect(next.draft.visibleNotes).toBe("New in-memory text");
});

it("does not claim a failed removal discarded the recovery copy", () => {
  const scope = getAccountScope();
  const initial = record();
  const raw = JSON.stringify(initial);
  writeInspectionDraft(scope, scanId, null, initial);
  vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => { throw new DOMException("unavailable", "SecurityError"); });
  expect(writeInspectionDraft(scope, scanId, raw, null)).toMatchObject({ ok: false });
  expect(readInspectionDraft(scope, scanId).record).toEqual(initial);
});

it("rejects outdated creation, update and discard after another tab writes a newer copy", () => {
  const scope = getAccountScope();
  const first = record("Tab A");
  const firstRaw = JSON.stringify(first);
  writeInspectionDraft(scope, scanId, null, first);
  const second = record("Tab B newer text");
  expect(writeInspectionDraft(scope, scanId, firstRaw, second).ok).toBe(true);
  for (const [expected, value] of [[null, record("stale creation")], [firstRaw, record("stale edit")], [firstRaw, null]] as const) {
    expect(writeInspectionDraft(scope, scanId, expected, value)).toMatchObject({ ok: false, message: expect.stringContaining("Another tab changed") });
    expect(readInspectionDraft(scope, scanId).record).toEqual(second);
  }
  const current = readInspectionDraft(scope, scanId);
  expect(writeInspectionDraft(scope, scanId, current.raw, null)).toEqual({ ok: true, raw: null });
  expect(readInspectionDraft(scope, scanId).record).toBeNull();
  expect(writeInspectionDraft(scope, scanId, firstRaw, record("stale resurrection"))).toMatchObject({ ok: false });
  expect(readInspectionDraft(scope, scanId).record).toBeNull();
});
