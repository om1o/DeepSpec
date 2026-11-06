import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { webcrypto } from "node:crypto";
import { ObservationAreaReview } from "./ObservationAreaReview";
import type { Lookup } from "../../types";
import type { ObservationAreaBinding, ObservationAreaDraft, ObservationAreaRecord } from "../../types/observationArea";
import { accountStorageKey, getAccountScope, setActiveAccount } from "../../lib/accountScope";
import { normalizeObservationAreaDraft, observationAreaRecordFromDraft } from "../../lib/observationArea";
import * as evidence from "../../services/observationAreaEvidence";
import * as store from "../../services/observationAreaStore";
import { downloadTextFile } from "../../services/report";
import { LOOKUPS_STORAGE_KEY } from "../../services/storage";

vi.mock("../../services/observationAreaEvidence", () => ({ prepareObservationAreaBinding: vi.fn(), verifyObservationAreaBinding: vi.fn(), assertObservationAreaGuardCurrent: vi.fn() }));
vi.mock("../../services/observationAreaStore", () => ({ readObservationAreas: vi.fn(), subscribeObservationAreas: vi.fn(), readObservationAreaDraft: vi.fn(), writeObservationAreaDraft: vi.fn(), commitObservationAreaDraft: vi.fn() }));
vi.mock("../../services/report", () => ({ downloadTextFile: vi.fn() }));
let lookup: Lookup, raw: string | null, history: ObservationAreaRecord[];
let notifyHistory: (lookupId: string) => void;
const at = "2026-11-05T12:00:00.000Z";
function binding(photoId = "photo-2"): ObservationAreaBinding {
  return { version: 1, observation: { id: "rust", text: "Flaking material at the mounting edge.", photoIds: ["photo-2", "photo-3"], areas: [{ photoId: "photo-2", rectangle: { x: .1, y: .2, width: .3, height: .4 } }] }, analysisSha256: "a".repeat(64), analysisAttemptId: "analysis-one",
    reference: { lookupId: lookup.id, photoId, photoLabel: "close_up", photoAddedAt: at, scanSavedAt: at, sha256: "b".repeat(64), width: 400, height: 300, observedOn: null, vehicleContext: null, analysisAttemptId: "analysis-one" } };
}
function pending(): ObservationAreaDraft {
  return { version: 1, id: crypto.randomUUID(), lookupId: lookup.id, recordedAt: at, updatedAt: at, binding: binding(), expectedHeadId: null, kind: "mark", rectangle: { x: .4, y: .2, width: .2, height: .3 }, notes: "Exact unfinished note", correctionReason: "" };
}
beforeEach(() => {
  vi.resetAllMocks(); setActiveAccount("area-owner"); vi.stubGlobal("crypto", webcrypto); raw = null; history = [];
  const frame = { imageBase64: "data:image/png;base64,first", capturedAt: at };
  lookup = { id: "scan-area", createdAt: at, frame, photos: ["photo-1", "photo-2", "photo-3"].map((id) => ({ ...frame, id, label: "close_up", imageBase64: `data:image/png;base64,${id}` })), analysisAttemptId: "analysis-one", result: null, scanCategory: "body", rating: null, correction: null, notes: "", chatHistory: [], trainingLabel: "", trainingStatus: "raw_unreviewed", reviewStatus: "needs_review", provenance: { captureMode: "upload", analysisSource: "ai_detection", savedAt: at } };
  vi.mocked(store.readObservationAreas).mockImplementation(async () => history);
  notifyHistory = () => {};
  vi.mocked(store.subscribeObservationAreas).mockImplementation((listener) => { notifyHistory = listener; return () => {}; });
  vi.mocked(store.readObservationAreaDraft).mockImplementation(async () => ({ ok: true, raw, draft: raw ? normalizeObservationAreaDraft(JSON.parse(raw)) ?? null : null, message: "" }));
  vi.mocked(store.writeObservationAreaDraft).mockImplementation(async (_scope, _id, expected, draft) => {
    if (expected !== raw) return { ok: false, message: "A different draft was saved elsewhere. Nothing was overwritten." };
    raw = draft ? JSON.stringify(draft) : null; return { ok: true, raw };
  });
  vi.mocked(store.commitObservationAreaDraft).mockImplementation(async (_scope, _id, expected, guard) => {
    if (expected !== raw || !raw) throw new Error("The draft changed elsewhere.");
    const draft = normalizeObservationAreaDraft(JSON.parse(raw))!;
    const record = observationAreaRecordFromDraft(draft); if (!record) throw new Error("Add a correction reason and valid area before saving.");
    guard(record.binding); history = [...history, record]; raw = null; return { records: history, record, raw: null };
  });
  vi.mocked(evidence.prepareObservationAreaBinding).mockImplementation(async (_lookup, _observation, photo) => {
    const value = binding(photo); return { binding: value, image: `data:image/png;base64,verified-${photo}`, guard: { binding: value, mode: "current" } };
  });
  vi.mocked(evidence.verifyObservationAreaBinding).mockImplementation(async (value, _scope, _signal, mode = "current") => ({ image: mode === "retraction" ? undefined : `data:image/png;base64,verified-${value.reference.photoId}`, guard: { binding: value, mode } }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
async function open(photoId = "photo-2") {
  const view = render(<ObservationAreaReview lookup={lookup} selection={{ observationId: "rust", photoId }} />);
  await screen.findByRole("img", { name: `Original for observation rust, photo ${photoId}` });
  return view;
}
async function mark() {
  await open(); fireEvent.click(screen.getByRole("button", { name: "Mark observation area" }));
  await screen.findByTestId("focus-area-editor");
  fireEvent.change(screen.getByRole("slider", { name: "Selection x" }), { target: { value: "35" } });
  fireEvent.click(screen.getByRole("button", { name: "Apply area" }));
  await waitFor(() => expect(raw && JSON.parse(raw).rectangle.x).toBe(.35));
}
async function save() {
  fireEvent.click(screen.getByRole("button", { name: "Save human area record" }));
  await screen.findByText("Human area record saved on this device. The AI finding and part isolation are unchanged.");
}

it("opens the exact cited second/third original, keeping AI areas separate and Original unannotated", async () => {
  const view = await open();
  expect(screen.getByRole("img")).toHaveAttribute("src", "data:image/png;base64,verified-photo-2");
  expect(screen.getByTestId("observation-ai-area")).toHaveStyle({ left: "10%", top: "20%" });
  expect(screen.queryByTestId("observation-human-area")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Original", exact: true }));
  expect(screen.queryByTestId("observation-ai-area")).not.toBeInTheDocument();
  expect(screen.getByRole("img")).not.toHaveAttribute("style");
  view.rerender(<ObservationAreaReview lookup={lookup} selection={{ observationId: "rust", photoId: "photo-3" }} />);
  expect(await screen.findByRole("img", { name: /photo photo-3$/ })).toHaveAttribute("src", "data:image/png;base64,verified-photo-3");
  expect(screen.queryByTestId("observation-ai-area")).not.toBeInTheDocument();
  expect(screen.getByText(/No AI rectangle is available/)).toBeInTheDocument();
  expect(store.writeObservationAreaDraft).not.toHaveBeenCalled();
});

it("persists a blank draft before editing, then saves an exact human rectangle without rewriting the AI binding", async () => {
  const original = JSON.stringify(lookup);
  await mark();
  expect(vi.mocked(store.writeObservationAreaDraft).mock.calls[0][3]).toMatchObject({ rectangle: null, binding: binding() });
  fireEvent.change(screen.getByLabelText("Area notes (included in reports)"), { target: { value: "Edge checked on this photo" } });
  await save();
  expect(history).toHaveLength(1); expect(history[0]).toMatchObject({ kind: "mark", rectangle: { x: .35, y: .2, width: .6, height: .6 }, binding: binding(), notes: "Edge checked on this photo" });
  expect(raw).toBeNull(); expect(JSON.stringify(lookup)).toBe(original);
  expect(evidence.assertObservationAreaGuardCurrent).toHaveBeenCalled();
});

it("requires explicit recovery and does not replace an unfinished draft when another claim/photo is chosen", async () => {
  const saved = pending(); raw = JSON.stringify(saved);
  const view = render(<ObservationAreaReview lookup={lookup} selection={{ observationId: "other", photoId: "photo-3" }} />);
  await screen.findByRole("button", { name: "Restore area draft" });
  expect(evidence.prepareObservationAreaBinding).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Restore area draft" }));
  expect(await screen.findByLabelText("Area notes (included in reports)")).toHaveValue(saved.notes);
  expect(screen.getByRole("img")).toHaveAccessibleName(/photo photo-2$/);
  view.rerender(<ObservationAreaReview lookup={lookup} selection={{ observationId: "another", photoId: "photo-3" }} />);
  await screen.findByText(/An unfinished area draft is retained/);
  expect(JSON.parse(raw!)).toEqual(saved); expect(evidence.prepareObservationAreaBinding).not.toHaveBeenCalled();
});

it("keeps corrupt raw recovery downloadable and does not invent an editable draft", async () => {
  raw = "{corrupt saved area";
  vi.mocked(store.readObservationAreaDraft).mockResolvedValue({ ok: false, raw, draft: null, message: "Draft cannot be read safely." });
  render(<ObservationAreaReview lookup={lookup} selection={{ observationId: "rust", photoId: "photo-2" }} />);
  const restore = await screen.findByRole("button", { name: "Restore area draft" }); expect(restore).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Download area recovery" }));
  expect(downloadTextFile).toHaveBeenCalledWith(expect.any(String), raw);
  expect(store.writeObservationAreaDraft).not.toHaveBeenCalled(); expect(evidence.prepareObservationAreaBinding).not.toHaveBeenCalled();
});

it("retains a failed draft write and allows a same-id retry without falsely acknowledging a record", async () => {
  await open(); vi.mocked(store.writeObservationAreaDraft).mockResolvedValueOnce({ ok: false, message: "Device quota reached." });
  fireEvent.click(screen.getByRole("button", { name: "Mark observation area" }));
  await screen.findByText("Device quota reached.");
  expect(screen.queryByTestId("focus-area-editor")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Download entered area draft" }));
  const draft = JSON.parse(vi.mocked(downloadTextFile).mock.calls[0][1]); expect(draft.rectangle).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Draw or adjust human area" }));
  fireEvent.click(screen.getByRole("button", { name: "Apply area" })); await save();
  expect(history[0].id).toBe(draft.id);
});

it("preserves a competing draft on stale edit/save/discard while retaining the entered area", async () => {
  await mark(); const competing = pending(); competing.notes = "Other tab's evidence"; raw = JSON.stringify(competing);
  fireEvent.change(screen.getByLabelText("Area notes (included in reports)"), { target: { value: "My entered note" } });
  await screen.findByText(/A different draft was saved elsewhere/);
  fireEvent.click(screen.getByRole("button", { name: "Save human area record" }));
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("A different draft"));
  fireEvent.click(screen.getByRole("button", { name: "Discard area draft" }));
  await waitFor(() => expect(JSON.parse(raw!)).toEqual(competing));
  expect(screen.getByLabelText("Area notes (included in reports)")).toHaveValue("My entered note"); expect(history).toHaveLength(0);
});

it("corrects and retracts retained human history without claiming the current answer verified the old original", async () => {
  await mark(); await save(); const original = history[0];
  fireEvent.click(screen.getByRole("button", { name: "Correct saved area" }));
  await screen.findByLabelText("Reason for area correction or retraction");
  expect(evidence.verifyObservationAreaBinding).toHaveBeenLastCalledWith(original.binding, getAccountScope(), expect.any(AbortSignal), "historical");
  fireEvent.change(screen.getByLabelText("Reason for area correction or retraction"), { target: { value: "Narrowed the mounting edge" } });
  fireEvent.click(screen.getByRole("button", { name: "Apply area" })); await save();
  expect(history[1]).toMatchObject({ supersedesId: original.id, binding: original.binding });
  fireEvent.click(screen.getByRole("button", { name: "Retract saved area" }));
  await screen.findByLabelText("Reason for area correction or retraction");
  expect(evidence.verifyObservationAreaBinding).toHaveBeenLastCalledWith(original.binding, getAccountScope(), expect.any(AbortSignal), "retraction");
  expect(screen.queryByRole("img")).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Reason for area correction or retraction"), { target: { value: "The mark was misleading" } }); await save();
  expect(history[2]).toMatchObject({ kind: "retraction", supersedesId: history[1].id, binding: original.binding }); expect(history).toHaveLength(3);
});

it.each(["source", "disabled", "account", "unmount"])("ignores delayed source preparation after %s changes", async (change) => {
  let finish!: (value: Awaited<ReturnType<typeof evidence.prepareObservationAreaBinding>>) => void;
  vi.mocked(evidence.prepareObservationAreaBinding).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const view = render(<ObservationAreaReview lookup={lookup} selection={{ observationId: "rust", photoId: "photo-2" }} />);
  await waitFor(() => expect(evidence.prepareObservationAreaBinding).toHaveBeenCalledTimes(1));
  const signal = vi.mocked(evidence.prepareObservationAreaBinding).mock.calls[0][4]!;
  if (change === "source") { lookup = { ...lookup, analysisAttemptId: "new-result" }; view.rerender(<ObservationAreaReview lookup={lookup} disabled selection={{ observationId: "rust", photoId: "photo-2" }} />); }
  if (change === "disabled") view.rerender(<ObservationAreaReview lookup={lookup} disabled />);
  if (change === "account") { setActiveAccount("other"); view.rerender(<ObservationAreaReview lookup={lookup} disabled />); }
  if (change === "unmount") view.unmount();
  await act(async () => { finish({ binding: binding(), image: "data:image/png;base64,late", guard: { binding: binding(), mode: "current" } }); });
  expect(signal.aborted).toBe(true); expect(screen.queryByRole("img")).not.toBeInTheDocument(); expect(store.writeObservationAreaDraft).not.toHaveBeenCalled();
});

it("hides an already open outline immediately when the saved source changes and keeps its draft recoverable", async () => {
  const view = await open(); fireEvent.click(screen.getByRole("button", { name: "Mark observation area" })); await screen.findByTestId("focus-area-editor");
  fireEvent.click(screen.getByRole("button", { name: "Apply area" }));
  view.rerender(<ObservationAreaReview lookup={{ ...lookup, analysisAttemptId: "changed-analysis" }} selection={{ observationId: "rust", photoId: "photo-2" }} />);
  expect(screen.queryByRole("img")).not.toBeInTheDocument(); expect(screen.queryByTestId("observation-human-area")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Save human area record" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Download entered area draft" })); expect(downloadTextFile).toHaveBeenCalled();
});

it("leaves committed history and pending draft untouched when the final guard rejects a queued save", async () => {
  await mark(); let resume!: () => void;
  const held = new Promise<void>((resolve) => { resume = resolve; });
  const commit = vi.mocked(store.commitObservationAreaDraft).getMockImplementation()!;
  vi.mocked(store.commitObservationAreaDraft).mockImplementationOnce(async (...args) => { await held; return commit(...args); });
  fireEvent.click(screen.getByRole("button", { name: "Save human area record" }));
  await waitFor(() => expect(store.commitObservationAreaDraft).toHaveBeenCalled());
  vi.mocked(evidence.assertObservationAreaGuardCurrent).mockImplementation(() => { throw new Error("Original changed before commit."); });
  await act(async () => { resume(); });
  expect(await screen.findByRole("status")).toHaveTextContent("Original changed before commit."); expect(history).toHaveLength(0); expect(raw).not.toBeNull();
  expect(within(screen.getByRole("region", { name: "Observation areas" })).getByRole("button", { name: "Download entered area draft" })).toBeEnabled();
});

it("updates the current canvas on another tab's correction and removes a retracted or forked current outline", async () => {
  const original = observationAreaRecordFromDraft(pending())!; history = [original];
  await open(); expect(screen.getByTestId("observation-human-area")).toHaveStyle({ left: "40%" });
  const corrected: ObservationAreaRecord = { ...original, id: crypto.randomUUID(), kind: "mark", rectangle: { x: .1, y: .1, width: .2, height: .2 }, supersedesId: original.id, correctionReason: "Other tab correction" };
  history = [original, corrected]; await act(async () => { notifyHistory(lookup.id); });
  expect(screen.getByTestId("observation-human-area")).toHaveStyle({ left: "10%" });
  const retracted: ObservationAreaRecord = { version: 1, id: crypto.randomUUID(), lookupId: lookup.id, recordedAt: at, binding: original.binding, kind: "retraction", notes: "", supersedesId: corrected.id, correctionReason: "Withdrawn elsewhere" };
  history = [original, corrected, retracted]; await act(async () => { notifyHistory(lookup.id); });
  expect(screen.queryByTestId("observation-human-area")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Correct human area" })).not.toBeInTheDocument();
  expect(screen.getByText(/current human area was retracted/)).toBeInTheDocument();
  const fork: ObservationAreaRecord = { ...corrected, id: crypto.randomUUID(), supersedesId: original.id, correctionReason: "Independent correction" };
  history = [original, corrected, fork]; await act(async () => { notifyHistory(lookup.id); });
  expect(screen.queryByTestId("observation-human-area")).not.toBeInTheDocument();
  expect(screen.getByText(/Conflicting area corrections are retained/)).toBeInTheDocument();
});

it("keeps an explicitly chosen historical outline visibly historical after a later correction", async () => {
  const original = observationAreaRecordFromDraft(pending())!; history = [original];
  await open(); fireEvent.click(screen.getByRole("button", { name: "View retained observation/photo" }));
  await screen.findByText(/Historical observation and photo reference retained/);
  const corrected: ObservationAreaRecord = { ...original, id: crypto.randomUUID(), kind: "mark", rectangle: { x: .1, y: .1, width: .2, height: .2 }, supersedesId: original.id, correctionReason: "Other tab correction" };
  history = [original, corrected]; await act(async () => { notifyHistory(lookup.id); });
  expect(screen.getByTestId("observation-human-area")).toHaveStyle({ left: "40%" });
  expect(screen.getByRole("note")).toHaveTextContent("Historical human area · superseded");
  expect(screen.queryByRole("button", { name: "Correct human area" })).not.toBeInTheDocument();
  expect(screen.getByText(/retained historical human area, not the current mark/)).toBeInTheDocument();
});

it.each(["replacement", "deletion"])("hides photo and editor on a real same-props storage notification after source %s, retaining the draft", async (change) => {
  await mark(); fireEvent.click(screen.getByRole("button", { name: "Draw or adjust human area" }));
  expect(screen.getByTestId("focus-area-editor")).toBeInTheDocument();
  const retained = raw;
  vi.mocked(evidence.assertObservationAreaGuardCurrent).mockImplementation(() => { throw new Error("Saved source changed."); });
  act(() => {
    const key = accountStorageKey(LOOKUPS_STORAGE_KEY);
    const next = change === "deletion" ? "[]" : JSON.stringify([{ ...lookup, createdAt: "2026-11-05T13:00:00.000Z" }]);
    localStorage.setItem(key, next);
    window.dispatchEvent(new StorageEvent("storage", { key, newValue: next, storageArea: localStorage }));
  });
  expect(screen.queryByRole("img")).not.toBeInTheDocument(); expect(screen.queryByTestId("focus-area-editor")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Save human area record" })).toBeDisabled();
  expect(screen.getByText(/changed elsewhere. The displayed image and areas were hidden/)).toBeInTheDocument();
  expect(raw).toBe(retained);
  fireEvent.click(screen.getByRole("button", { name: "Download entered area draft" })); expect(downloadTextFile).toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Verify original again" })).toBeEnabled();
});

it("does not abort a completed display proof when another operation begins, and retains the replacement proof afterward", async () => {
  const view = await open();
  const displaySignal = vi.mocked(evidence.prepareObservationAreaBinding).mock.calls[0][4]!;
  let finish!: (result: Awaited<ReturnType<typeof evidence.verifyObservationAreaBinding>>) => void;
  vi.mocked(evidence.verifyObservationAreaBinding).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  vi.mocked(evidence.assertObservationAreaGuardCurrent).mockImplementation(() => { displaySignal.throwIfAborted(); });
  fireEvent.click(screen.getByRole("button", { name: "Mark observation area" }));
  await waitFor(() => expect(evidence.verifyObservationAreaBinding).toHaveBeenCalled());
  const pendingSignal = vi.mocked(evidence.verifyObservationAreaBinding).mock.calls[0][2]!;
  act(() => { window.dispatchEvent(new StorageEvent("storage", { key: accountStorageKey(LOOKUPS_STORAGE_KEY), storageArea: localStorage })); });
  expect(displaySignal.aborted).toBe(false); expect(pendingSignal.aborted).toBe(false); expect(screen.getByRole("img")).toBeInTheDocument();
  const newGuard: evidence.ObservationAreaGuard = { binding: binding(), mode: "current" };
  await act(async () => { finish({ image: "data:image/png;base64,verified-photo-2", guard: newGuard }); });
  await screen.findByTestId("focus-area-editor");
  vi.mocked(evidence.assertObservationAreaGuardCurrent).mockClear();
  act(() => { window.dispatchEvent(new StorageEvent("storage", { key: accountStorageKey(LOOKUPS_STORAGE_KEY), storageArea: localStorage })); });
  expect(evidence.assertObservationAreaGuardCurrent).toHaveBeenLastCalledWith(newGuard, binding(), getAccountScope());
  view.unmount();
});
