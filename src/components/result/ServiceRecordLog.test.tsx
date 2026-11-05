import { webcrypto } from "node:crypto";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ServiceRecordLog } from "./ServiceRecordLog";
import { accountStorageKey, getAccountScope, setActiveAccount } from "../../lib/accountScope";
import { mergeServiceRecords, normalizeServiceRecord } from "../../lib/serviceRecord";
import { createLookup, deleteLookup, getLookup, LOOKUPS_STORAGE_KEY } from "../../services/storage";
import * as store from "../../services/serviceRecordStore";
import * as cloud from "../../services/serviceRecordCloud";
import { downloadTextFile } from "../../services/report";
import { newServiceRecordDraft, readServiceRecordDraft, serviceRecordContextForLookup, serviceRecordDraftKey, serviceRecordFromDraft, writeServiceRecordDraft } from "../../services/serviceRecordDraft";
import type { Lookup } from "../../types";
import type { ServiceRecord } from "../../types/serviceRecord";
const draftDb = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock("../../services/evidenceDb", () => ({ openEvidenceDatabase: draftDb.open, SERVICE_RECORD_DRAFT_STORE: "service-record-drafts", EVIDENCE_STORAGE_TIMEOUT_MS: 15_000 }));

function draftDatabaseFixture() {
  const rows = new Map<string, unknown>();
  let queue = Promise.resolve();
  const options = { failPut: false, beforeRead: undefined as (() => Promise<void>) | undefined };
  const database = { close: vi.fn(), transaction: () => {
    let aborted = false;
    const writes = new Map<string, unknown>();
    const tx = { oncomplete: null, onerror: null, onabort: null,
      abort: () => { aborted = true; queueMicrotask(() => tx.onabort?.()); },
      objectStore: () => ({
        get: (key: unknown) => {
          const request = { result: undefined, onsuccess: null } as { result: unknown; onsuccess: (() => void) | null };
          queue = queue.then(async () => {
            await options.beforeRead?.(); if (aborted) return;
            request.result = structuredClone(rows.get(JSON.stringify(key))); request.onsuccess?.(); if (aborted) return;
            for (const [id, value] of writes) rows.set(id, value);
            tx.oncomplete?.();
          }); return request;
        },
        put: (value: unknown, key: unknown) => { if (options.failPut) throw new DOMException("Full", "QuotaExceededError"); writes.set(JSON.stringify(key), structuredClone(value)); },
      }),
    } as { oncomplete: (() => void) | null; onerror: (() => void) | null; onabort: (() => void) | null; abort: () => void; objectStore: () => unknown };
    return tx;
  } };
  return { database, rows, options };
}
let draftDatabase: ReturnType<typeof draftDatabaseFixture>;

vi.mock("../../services/serviceRecordStore", () => ({ readServiceRecords: vi.fn(), appendServiceRecord: vi.fn(), importServiceRecords: vi.fn(), subscribeServiceRecords: vi.fn() }));
vi.mock("../../services/serviceRecordCloud", () => ({ readCloudServiceRecords: vi.fn(), syncServiceRecords: vi.fn() }));
vi.mock("../../services/report", () => ({ downloadTextFile: vi.fn() }));
let history: ServiceRecord[];
let lookup: Lookup;
beforeEach(() => {
  vi.resetAllMocks(); localStorage.clear(); setActiveAccount("service-owner"); vi.stubGlobal("crypto", webcrypto);
  draftDatabase = draftDatabaseFixture(); draftDb.open.mockResolvedValue(draftDatabase.database);
  history = [];
  const frame = { imageBase64: "data:image/jpeg;base64,test", capturedAt: "2026-11-05T12:00:00.000Z" };
  lookup = createLookup({ frame, photos: [{ ...frame, id: "view:1.a", label: "overview" }, { ...frame, imageBase64: "data:image/jpeg;base64,other", id: "view-2", label: "close_up" }], analysisAttemptId: "original-analysis:One", vehicleContext: { model: "Original car", mileage: "010020", mileageUnit: "mi", customerName: "Private customer", notes: "Private vehicle notes" } }, "scan-a").value;
  vi.mocked(store.readServiceRecords).mockImplementation(async () => history);
  vi.mocked(store.appendServiceRecord).mockImplementation(async (record) => { history = mergeServiceRecords(history, [record], lookup.id); return history; });
  vi.mocked(store.importServiceRecords).mockImplementation(async (_id, records) => { history = mergeServiceRecords(history, records, lookup.id); return history; });
  vi.mocked(store.subscribeServiceRecords).mockReturnValue(() => {});
  vi.mocked(cloud.readCloudServiceRecords).mockResolvedValue([]);
  vi.mocked(cloud.syncServiceRecords).mockResolvedValue({ synced: 0, message: "All 1 snapshot entries confirmed in cloud." });
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

async function open(value = lookup) {
  const view = render(<ServiceRecordLog lookup={value} />);
  fireEvent.click(screen.getByText(/^Human service history/));
  await screen.findByLabelText("Part or area checked");
  await waitFor(() => expect(screen.getByRole("button", { name: "Save service record on this device" })).toBeEnabled());
  return view;
}
function fill(label: string, value: string) { fireEvent.change(screen.getByLabelText(label), { target: { value } }); }
function common() { fill("Part or area checked", "Alternator"); fill("Recorded by (self-reported)", "Pat"); }
function measurement() { common(); fill("What was measured", "Terminal voltage"); fill("Reading (exact numeric text)", " 12.500 "); fill("Unit", "V"); }
async function save() { fireEvent.click(screen.getByRole("button", { name: "Save service record on this device" })); await waitFor(() => expect(screen.getByText("Service record saved on this device. AI findings and inspection status are unchanged.")).toBeInTheDocument()); }
async function originalRecord() {
  const draft = newServiceRecordDraft(await serviceRecordContextForLookup(lookup));
  Object.assign(draft.fields, { recordedBy: "Original recorder", subject: "Alternator", quantity: "Voltage", reading: "12.50", unit: "V" });
  return normalizeServiceRecord(serviceRecordFromDraft(draft))!;
}

it("keeps local service saves available and never reads or writes cloud while sync is off", async () => {
  vi.stubEnv("VITE_ENABLE_CLOUD_SYNC", "false");
  await open(); measurement();
  for (const name of ["Read cloud service history", "Sync service history"]) {
    const button = screen.getByRole("button", { name }); expect(button).toBeDisabled(); fireEvent.click(button);
  }
  await save();
  expect(history).toHaveLength(1); expect(history[0]).toMatchObject({ reading: " 12.500 ", unit: "V" });
  expect(screen.getByText(/Cloud sync is off/)).toBeInTheDocument();
  expect(cloud.readCloudServiceRecords).not.toHaveBeenCalled(); expect(cloud.syncServiceRecords).not.toHaveBeenCalled();
  expect(store.importServiceRecords).not.toHaveBeenCalled();
});

it("saves exact measurement text and selected evidence locally without changing AI/inspection or automatically syncing", async () => {
  const before = JSON.stringify(getLookup(lookup.id)); await open(); measurement();
  fireEvent.click(screen.getByLabelText("Photo 2: close up (view-2)"));
  fill("Evidence notes (included in reports)", "Meter settled after 5 seconds");
  await save();
  expect(history).toHaveLength(1);
  expect(history[0]).toMatchObject({ kind: "measurement", reading: " 12.500 ", unit: "V", method: "Unknown", occurredOn: null, photoIds: ["view-2"], analysisAttemptId: "original-analysis:One", vehicleContext: { model: "Original car", mileage: "010020", mileageUnit: "mi" } });
  expect(JSON.stringify(history)).not.toContain("Private");
  expect(JSON.stringify(getLookup(lookup.id))).toBe(before);
  expect(cloud.syncServiceRecords).not.toHaveBeenCalled(); expect(cloud.readCloudServiceRecords).not.toHaveBeenCalled();
  expect((await readServiceRecordDraft(getAccountScope(), lookup.id)).raw).toBeNull();
});

it("requires a reason for an explicitly unavailable reading and never substitutes zero", async () => {
  await open(); common(); fill("What was measured", "Voltage"); fill("Reading state", "not_obtained");
  fireEvent.click(screen.getByRole("button", { name: "Save service record on this device" }));
  expect(await screen.findByText(/Explain why no reading was obtained/)).toBeInTheDocument();
  expect(store.appendServiceRecord).not.toHaveBeenCalled();
  fill("Why no reading was obtained", "Tester unavailable"); await save();
  expect(history[0]).toMatchObject({ reading: null, noReadingReason: "Tester unavailable", unit: "" });
});

it("records repair status and a separate bounded follow-up without claiming repair success", async () => {
  await open(); fill("Record type", "repair"); common(); fill("Work status", "attempted"); fill("Action planned or performed", "Reseated connector"); fill("Parts used or proposed", "None"); await save();
  const repairId = history[0].id;
  fill("Record type", "follow_up"); common(); fill("Outcome of this check", "symptom_not_observed"); fill("Follow-up check performed", "Ran at idle for two minutes"); fill("Conditions during the check", "Cold engine; stationary");
  fireEvent.click(screen.getByLabelText(new RegExp(`Repair / work: Alternator`))); await save();
  expect(history).toHaveLength(2);
  expect(history[0]).toMatchObject({ kind: "repair", status: "attempted" });
  expect(history[1]).toMatchObject({ kind: "follow_up", relatedRecordIds: [repairId], outcome: "symptom_not_observed", conditions: "Cold engine; stationary" });
  expect(screen.getByText(/not proof of a permanent resolution/)).toBeInTheDocument();
});

it("retains the draft during an unresolved/failed local save and retries the same immutable ID", async () => {
  let reject!: (error: Error) => void;
  vi.mocked(store.appendServiceRecord).mockImplementationOnce(() => new Promise((_resolve, failure) => { reject = failure; }));
  await open(); measurement();
  fireEvent.click(screen.getByRole("button", { name: "Save service record on this device" }));
  await waitFor(() => expect(store.appendServiceRecord).toHaveBeenCalledOnce());
  const first = vi.mocked(store.appendServiceRecord).mock.calls[0][0];
  expect(screen.getByLabelText("Reading (exact numeric text)")).toHaveValue(" 12.500 ");
  expect((await readServiceRecordDraft(getAccountScope(), lookup.id)).record?.id).toBe(first.id);
  await act(async () => reject(new Error("Device unavailable")));
  expect(screen.getByText("Device unavailable")).toBeInTheDocument();
  await save();
  expect(vi.mocked(store.appendServiceRecord).mock.calls[1][0]).toEqual(first);
});

it("requires explicit recovery and preserves raw incomplete text across reopening", async () => {
  const draft = newServiceRecordDraft(await serviceRecordContextForLookup(lookup)); draft.fields.notes = " unfinished\n context ";
  await writeServiceRecordDraft(getAccountScope(), lookup.id, null, draft);
  render(<ServiceRecordLog lookup={lookup} />); fireEvent.click(screen.getByText(/^Human service history/));
  await waitFor(() => expect(screen.getByRole("button", { name: "Restore service draft" })).toBeEnabled());
  expect(screen.getByLabelText("Evidence notes (included in reports)")).toHaveValue("");
  fireEvent.click(screen.getByRole("button", { name: "Restore service draft" }));
  await waitFor(() => expect(screen.getByLabelText("Evidence notes (included in reports)")).toHaveValue(" unfinished\n context "));
  expect(store.appendServiceRecord).not.toHaveBeenCalled();
});

it("blocks mismatched recovery but offers an exact download without overwriting it", async () => {
  const draft = newServiceRecordDraft(await serviceRecordContextForLookup(lookup)); draft.fields.notes = "Original notes";
  await writeServiceRecordDraft(getAccountScope(), lookup.id, null, draft);
  const changed = { ...lookup, vehicleContext: { model: "Another vehicle" } };
  render(<ServiceRecordLog lookup={changed} />); fireEvent.click(screen.getByText(/^Human service history/));
  await screen.findByLabelText("Part or area checked");
  expect(await screen.findByRole("button", { name: "Restore service draft" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Download recovery copy" }));
  expect(downloadTextFile).toHaveBeenCalledWith(expect.any(String), expect.stringContaining(JSON.stringify(draft)));
  expect((await readServiceRecordDraft(getAccountScope(), lookup.id)).record).toEqual(draft);
});

it("preserves another tab's draft on stale edit and discard while keeping entered text visible", async () => {
  await open(); fill("Part or area checked", "My text");
  await screen.findByText("Draft kept on this device. It is not a saved service record or cloud backup.");
  const current = await readServiceRecordDraft(getAccountScope(), lookup.id);
  const other = { ...current.record!, fields: { ...current.record!.fields, subject: "Other tab" } };
  await writeServiceRecordDraft(getAccountScope(), lookup.id, current.raw, other);
  fill("Part or area checked", "My newer text");
  expect(screen.getByLabelText("Part or area checked")).toHaveValue("My newer text");
  fireEvent.click(screen.getByRole("button", { name: "Discard service draft" }));
  await waitFor(() => expect(screen.getAllByText(/Another tab changed this service draft/).length).toBeGreaterThan(0));
  expect((await readServiceRecordDraft(getAccountScope(), lookup.id)).record?.fields.subject).toBe("Other tab");
});

it("hides old-account form and ignores its late save completion", async () => {
  let resolve!: (records: ServiceRecord[]) => void;
  vi.mocked(store.appendServiceRecord).mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  const view = await open(); measurement(); fireEvent.click(screen.getByRole("button", { name: "Save service record on this device" }));
  await waitFor(() => expect(store.appendServiceRecord).toHaveBeenCalledOnce());
  const saved = vi.mocked(store.appendServiceRecord).mock.calls[0][0];
  setActiveAccount("other-owner"); view.rerender(<ServiceRecordLog lookup={lookup} />);
  await act(async () => resolve([saved]));
  expect(screen.queryByLabelText("Recorded by (self-reported)")).not.toBeInTheDocument();
  expect(screen.queryByText("Pat")).not.toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("Service notes are hidden");
  expect((await readServiceRecordDraft(getAccountScope(), lookup.id)).raw).toBeNull();
});

it("allows a cloud-only saved scan but rejects deletion of an originally present device scan", async () => {
  deleteLookup(lookup.id); const view = await open(); measurement(); await save(); expect(history).toHaveLength(1); view.unmount();
  lookup = createLookup({ frame: lookup.frame, vehicleContext: lookup.vehicleContext }, "scan-b").value;
  history = []; await open(); measurement(); deleteLookup(lookup.id);
  fireEvent.click(screen.getByRole("button", { name: "Save service record on this device" }));
  expect(await screen.findByText(/original device scan was removed/)).toBeInTheDocument();
  expect(history).toHaveLength(0);
});

it("rejects a changed saved vehicle context before append", async () => {
  await open(); measurement();
  // Simulate another writer replacing the saved record. updateLookup deliberately
  // accepts only rating/correction/notes, so it cannot create this precondition.
  localStorage.setItem(accountStorageKey(LOOKUPS_STORAGE_KEY), JSON.stringify([{ ...getLookup(lookup.id)!, vehicleContext: { model: "Different car" } }]));
  expect(getLookup(lookup.id)?.vehicleContext?.model).toBe("Different car");
  fireEvent.click(screen.getByRole("button", { name: "Save service record on this device" }));
  expect(await screen.findByText(/saved scan photos or vehicle context changed/)).toBeInTheDocument();
  expect(store.appendServiceRecord).not.toHaveBeenCalled(); expect(screen.getByLabelText("Reading (exact numeric text)")).toHaveValue(" 12.500 ");
});

it("rejects a correction made stale by another tab without rewriting its target", async () => {
  const first = await originalRecord(); history = [first]; await open();
  fireEvent.click(screen.getByRole("button", { name: "Correct entry" })); fill("Reason for correction or retraction", "Decimal point correction"); fill("Reading (exact numeric text)", "1.25");
  const competing = normalizeServiceRecord({ ...first, id: crypto.randomUUID(), supersedesId: first.id, correctionReason: "Other tab correction", reading: "12.6" })!;
  history = [first, competing];
  fireEvent.click(screen.getByRole("button", { name: "Save service record on this device" }));
  expect(await screen.findByText(/corrected or retracted elsewhere/)).toBeInTheDocument();
  expect(store.appendServiceRecord).not.toHaveBeenCalled(); expect(history[0]).toEqual(first);
});

it("appends a retraction with reason and keeps original history", async () => {
  const first = await originalRecord(); history = [first]; await open(); fireEvent.click(screen.getByRole("button", { name: "Retract entry" }));
  fill("Reason for correction or retraction", "Reading transcribed for the wrong instrument"); await save();
  expect(history).toHaveLength(2); expect(history[0]).toEqual(first);
  expect(history[1]).toMatchObject({ kind: "retraction", supersedesId: first.id, correctionReason: "Reading transcribed for the wrong instrument" });
});

it("shows correction forks and reports explicit cloud acknowledgement even when no entry was newly inserted", async () => {
  const first = await originalRecord();
  const branch = (reading: string) => normalizeServiceRecord({ ...first, id: crypto.randomUUID(), supersedesId: first.id, correctionReason: "Independent correction", reading })!;
  history = [first, branch("12.6"), branch("12.7")]; await open();
  expect(within(screen.getByRole("list", { name: "Saved service records" })).getAllByText(/Correction fork:/)).toHaveLength(3);
  expect(screen.getAllByRole("button", { name: "Correct entry" }).every((button) => button.hasAttribute("disabled"))).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Sync service history" }));
  expect(await screen.findByText(/All 1 snapshot entries confirmed in cloud/)).toBeInTheDocument();
  expect(cloud.syncServiceRecords).toHaveBeenCalledWith(lookup.id, expect.objectContaining({ userId: "service-owner" }));
  expect(cloud.readCloudServiceRecords).not.toHaveBeenCalled();
});

it("keeps entered text available when draft quota fails", async () => {
  await open(); draftDatabase.options.failPut = true;
  fill("Part or area checked", "Unsaved value");
  expect(screen.getByLabelText("Part or area checked")).toHaveValue("Unsaved value");
  fireEvent.click(screen.getByRole("button", { name: "Download unsaved service draft" }));
  expect(downloadTextFile).toHaveBeenCalledWith(expect.any(String), expect.stringContaining("Unsaved value"));
  expect(await screen.findByText(/draft could not be kept.*Download/)).toBeInTheDocument();
  expect(screen.queryByText(/^Draft kept on this device/)).not.toBeInTheDocument();
  expect(localStorage.getItem(serviceRecordDraftKey(lookup.id))).toBeNull();
});

it("does not acknowledge a pending draft and waits for queued keystrokes before saving", async () => {
  await open();
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  draftDatabase.options.beforeRead = () => held;
  measurement(); fill("Evidence notes (included in reports)", "Latest queued note");
  expect(screen.getByText("Keeping draft on this device…")).toBeInTheDocument();
  expect(screen.queryByText(/^Draft kept on this device/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Save service record on this device" }));
  expect(store.appendServiceRecord).not.toHaveBeenCalled();
  await act(async () => { release(); });
  await screen.findByText("Service record saved on this device. AI findings and inspection status are unchanged.");
  expect(history).toHaveLength(1);
  expect(history[0]).toMatchObject({ subject: "Alternator", recordedBy: "Pat", quantity: "Terminal voltage", reading: " 12.500 ", unit: "V", notes: "Latest queued note" });
  expect((await readServiceRecordDraft(getAccountScope(), lookup.id)).raw).toBeNull();
});

it("keeps editing disabled until recovery has been read", async () => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  draftDatabase.options.beforeRead = () => held;
  render(<ServiceRecordLog lookup={lookup} />); fireEvent.click(screen.getByText(/^Human service history/));
  expect(await screen.findByLabelText("Part or area checked")).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Part or area checked"), { target: { value: "Must not enter" } });
  expect(screen.getByLabelText("Part or area checked")).toHaveValue("");
  await act(async () => { release(); });
  await waitFor(() => expect(screen.getByLabelText("Part or area checked")).toBeEnabled());
});

it("does not persist or display an old account's queued draft after switching accounts", async () => {
  const view = await open(); const originalScope = getAccountScope();
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  draftDatabase.options.beforeRead = () => held;
  fill("Part or area checked", "Old private draft");
  setActiveAccount("other-owner"); view.rerender(<ServiceRecordLog lookup={lookup} />);
  await act(async () => { release(); });
  expect(screen.queryByText("Old private draft")).not.toBeInTheDocument();
  expect(draftDatabase.rows.get(JSON.stringify([originalScope.userId, lookup.id]))).toBeNull();
  expect((await readServiceRecordDraft(getAccountScope(), lookup.id)).raw).toBeNull();
});

it("keeps an imported legacy raw copy downloadable after discarding the current draft", async () => {
  const draft = newServiceRecordDraft(await serviceRecordContextForLookup(lookup)); draft.fields.notes = "Exact legacy\nrecovery";
  const raw = JSON.stringify(draft); localStorage.setItem(serviceRecordDraftKey(lookup.id), raw);
  render(<ServiceRecordLog lookup={lookup} />); fireEvent.click(screen.getByText(/^Human service history/));
  const discard = await screen.findByRole("button", { name: "Discard service draft" });
  await waitFor(() => expect(discard).toBeEnabled()); fireEvent.click(discard);
  fireEvent.click(await screen.findByRole("button", { name: "Download earlier recovery copy" }));
  expect(downloadTextFile).toHaveBeenCalledWith(expect.any(String), expect.stringContaining(raw));
  expect(localStorage.getItem(serviceRecordDraftKey(lookup.id))).toBe(raw);
  expect((await readServiceRecordDraft(getAccountScope(), lookup.id)).raw).toBeNull();
});
