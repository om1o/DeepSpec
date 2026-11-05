import { webcrypto } from "node:crypto";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ScanComparisonReview } from "./ScanComparisonReview";
import { getAccountScope, setActiveAccount, accountStorageKey } from "../../lib/accountScope";
import { mergeInspectionComparisons } from "../../lib/inspectionComparison";
import { createLookup, deleteLookup, getLookup, LOOKUPS_STORAGE_KEY } from "../../services/storage";
import * as evidence from "../../services/comparisonEvidence";
import * as store from "../../services/inspectionComparisonStore";
import * as cloud from "../../services/inspectionComparisonCloud";
import * as drafts from "../../services/inspectionComparisonDraft";
import { readCloudLookups } from "../../services/cloudHistory";
import { downloadTextFile } from "../../services/report";
import type { Lookup } from "../../types";
import type { ComparisonSide, InspectionComparison } from "../../types/inspectionComparison";

const mocks = vi.hoisted(() => ({ navigate: vi.fn(), raw: null as string | null, failDraft: false }));
vi.mock("react-router-dom", async (original) => ({ ...await original<typeof import("react-router-dom")>(), useNavigate: () => mocks.navigate }));
vi.mock("../../services/comparisonEvidence", () => ({ comparisonPhotos: vi.fn(), comparisonSideForLookup: vi.fn(), resolveComparisonSide: vi.fn() }));
vi.mock("../../services/inspectionComparisonStore", () => ({ readInspectionComparisons: vi.fn(), appendInspectionComparison: vi.fn(), importInspectionComparisons: vi.fn(), subscribeInspectionComparisons: vi.fn() }));
vi.mock("../../services/inspectionComparisonCloud", () => ({ readCloudInspectionComparisons: vi.fn(), syncInspectionComparisons: vi.fn() }));
vi.mock("../../services/cloudHistory", () => ({ readCloudLookups: vi.fn() }));
vi.mock("../../services/report", () => ({ downloadTextFile: vi.fn() }));
vi.mock("../../services/inspectionComparisonDraft", async (original) => {
  const actual = await original<typeof import("../../services/inspectionComparisonDraft")>();
  return { ...actual, readComparisonDraft: vi.fn(async () => ({ ok: true, raw: mocks.raw, draft: mocks.raw ? actual.parseComparisonDraft(mocks.raw) : null, message: "" })),
    writeComparisonDraft: vi.fn(async (_scope: unknown, _id: string, expected: string | null, draft: import("../../services/inspectionComparisonDraft").ComparisonDraft | null) => {
      if (mocks.failDraft) return { ok: false, message: "Draft quota failed. Download entered text." };
      if (mocks.raw !== expected) return { ok: false, message: "Another tab changed this comparison draft." };
      mocks.raw = draft ? JSON.stringify(draft) : null; return { ok: true, raw: mocks.raw };
    }) };
});

let lookup: Lookup, earlier: Lookup, history: InspectionComparison[];
function side(source: Lookup, photoId: string): ComparisonSide {
  const photo = (source.photos ?? [{ ...source.frame, id: "photo-1", label: "overview" as const }]).find((p) => p.id === photoId)!;
  return { lookupId: source.id, photoId, photoLabel: photo.label, photoAddedAt: photo.capturedAt, scanSavedAt: source.createdAt,
    sha256: (photo.imageBase64.endsWith("changed") ? "c" : photoId === "photo-2" ? "b" : "a").repeat(64), width: 40, height: 30, observedOn: null, vehicleContext: source.vehicleContext ?? null,
    ...(source.analysisAttemptId ? { analysisAttemptId: source.analysisAttemptId } : {}) };
}
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); setActiveAccount("comparison-owner"); vi.stubGlobal("crypto", webcrypto);
  mocks.raw = null; mocks.failDraft = false; history = [];
  const first = { imageBase64: "data:image/png;base64,original", capturedAt: "2026-11-01T12:00:00.000Z" };
  earlier = createLookup({ frame: first, vehicleContext: { model: "Saved car" } }, "earlier-scan").value;
  const frame = { ...first, capturedAt: "2026-11-05T12:00:00.000Z" };
  lookup = createLookup({ frame, photos: [{ ...frame, id: "photo-1", label: "overview" }, { ...frame, id: "photo-2", label: "close_up" }], vehicleContext: { model: "Saved car" }, analysisAttemptId: "analysis:One" }, "current-scan").value;
  vi.mocked(evidence.comparisonPhotos).mockImplementation((value) => value.photos?.length ? value.photos : [{ ...value.frame, id: "photo-1", label: "overview" }]);
  vi.mocked(evidence.comparisonSideForLookup).mockImplementation(async (value, id) => side(value, id));
  vi.mocked(evidence.resolveComparisonSide).mockImplementation(async (value) => ({ status: "unchanged", image: `data:image/png;base64,${value.photoId}`, message: "Original verified." }));
  vi.mocked(store.readInspectionComparisons).mockImplementation(async () => history);
  vi.mocked(store.appendInspectionComparison).mockImplementation(async (record) => {
    if (record.supersedesId && history.some((item) => item.supersedesId === record.supersedesId && item.id !== record.id)) throw new Error("This comparison was corrected elsewhere. Your draft is preserved.");
    history = mergeInspectionComparisons(history, [record], lookup.id); return history;
  });
  vi.mocked(store.importInspectionComparisons).mockImplementation(async (_id, remote) => { history = mergeInspectionComparisons(history, remote, lookup.id); return history; });
  vi.mocked(store.subscribeInspectionComparisons).mockReturnValue(() => {});
  vi.mocked(cloud.readCloudInspectionComparisons).mockResolvedValue([]);
  vi.mocked(cloud.syncInspectionComparisons).mockResolvedValue({ synced: 0, message: "All snapshot comparisons cloud-confirmed. Later entries need another sync." });
  vi.mocked(readCloudLookups).mockResolvedValue({ ok: true, value: [earlier] });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

async function open(value = lookup) {
  const view = render(<ScanComparisonReview lookup={value} />);
  const details = screen.getByText("Compare dated inspections").closest("details")!; details.open = true; fireEvent.toggle(details);
  await screen.findByLabelText("Part or location");
  await waitFor(() => expect(screen.getByLabelText("Part or location")).toBeEnabled()); return view;
}
function fill(name: string, value: string) { fireEvent.change(screen.getByLabelText(name), { target: { value } }); }
async function prepare(photoId = "photo-2") {
  fill("Part or location", "Rust patch near mount"); fill("Earlier saved scan", earlier.id); fill("Current original photo", photoId);
  fireEvent.click(screen.getByRole("button", { name: "Check selected originals" }));
  await screen.findByLabelText("Earlier observation date (self-reported, optional)");
  await waitFor(() => expect(screen.getByRole("button", { name: "Save comparison on this device" })).toBeEnabled());
}
function observation() {
  fireEvent.click(screen.getByLabelText("I confirm these show the same vehicle")); fill("Component relationship", "same_part");
  fill("How you know the vehicle / part relationship", "I photographed my car in both visits");
  fill("Your comparison outcome", "change_observed"); fill("Human observations (included in reports)", "  Darker edge; different lighting may explain it.  ");
}
async function save() {
  fireEvent.click(screen.getByRole("button", { name: "Save comparison on this device" }));
  await screen.findByText("Comparison saved on this device. AI findings and inspection status are unchanged.");
}
function savedRecord(): InspectionComparison {
  const draft = drafts.newComparisonDraft(lookup.id, "photo-2");
  return { ...draft.record, subject: "Rust patch", earlier: side(earlier, "photo-1"), current: side(lookup, "photo-2") };
}

it("saves exact selected originals and human notes without changing AI or automatically using cloud", async () => {
  const before = JSON.stringify(getLookup(lookup.id)); await open(); await prepare(); observation();
  fill("Earlier observation date (self-reported, optional)", "2026-10-29"); fill("Current observation date (self-reported, optional)", "2026-11-04");
  fill("Viewing angle", "different"); fill("Lighting", "unknown"); await save();
  expect(history).toHaveLength(1); expect(history[0]).toMatchObject({ earlier: { lookupId: earlier.id, photoId: "photo-1", observedOn: "2026-10-29" }, current: { lookupId: lookup.id, photoId: "photo-2", observedOn: "2026-11-04" }, relationship: { sameVehicle: true, component: "same_part" }, conditions: { angle: "different", lighting: "unknown" }, observation: { notes: "  Darker edge; different lighting may explain it.  " } });
  expect(JSON.stringify(getLookup(lookup.id))).toBe(before); expect(mocks.raw).toBeNull();
  expect(cloud.syncInspectionComparisons).not.toHaveBeenCalled(); expect(readCloudLookups).not.toHaveBeenCalled();
  expect(screen.getAllByText(/Photo added/).length).toBe(2);
});

it("resets confirmation, outcome and alignment after changing either original while retaining entered notes", async () => {
  await open(); await prepare(); observation();
  fireEvent.change(screen.getByLabelText("Rotate current photo"), { target: { value: "90" } });
  fill("Current original photo", "photo-1");
  expect(screen.getByLabelText("I confirm these show the same vehicle")).not.toBeChecked();
  expect(screen.getByLabelText("Component relationship")).toHaveValue("unconfirmed"); expect(screen.getByLabelText("Your comparison outcome")).toHaveValue("not_reviewed");
  expect(screen.getByLabelText("Human observations (included in reports)")).toHaveValue("  Darker edge; different lighting may explain it.  ");
  expect(screen.queryByAltText("Current original")).not.toBeInTheDocument();
  await waitFor(() => expect(drafts.parseComparisonDraft(mocks.raw!)?.record.alignment.rotation).toBe(0));
});

it("keeps unknown observation dates and unconfirmed identity instead of treating saved dates as proof", async () => {
  await open(); await prepare(); await save();
  expect(history[0]).toMatchObject({ earlier: { observedOn: null }, current: { observedOn: null }, relationship: { sameVehicle: false, component: "unconfirmed" }, observation: { outcome: "not_reviewed" } });
  expect(screen.getAllByText(/Observation date unknown/)).toHaveLength(2);
});

it("applies reversible viewing transforms and reset without changing the original image or frozen dimensions", async () => {
  await open(); await prepare(); const image = screen.getByAltText("Current original"); const originalSrc = image.getAttribute("src");
  fireEvent.change(screen.getByLabelText("Rotate current photo"), { target: { value: "90" } });
  fireEvent.change(screen.getByLabelText("Scale current photo"), { target: { value: "2" } });
  expect(image).toHaveStyle({ transform: "translate(0%, 0%) rotate(90deg) scale(2)" }); expect(image.getAttribute("src")).toBe(originalSrc);
  fireEvent.click(screen.getByRole("button", { name: "Show unaligned original" })); expect(image.style.transform).toBe("");
  expect(screen.getByLabelText("Rotate current photo")).toHaveValue("90"); expect(screen.getByLabelText("Scale current photo")).toHaveValue("2");
  fireEvent.click(screen.getByRole("button", { name: "Show saved alignment" })); expect(image).toHaveStyle({ transform: "translate(0%, 0%) rotate(90deg) scale(2)" });
  fireEvent.click(screen.getByRole("button", { name: "Reset alignment" })); expect(image).toHaveStyle({ transform: "translate(0%, 0%) rotate(0deg) scale(1)" });
  await save(); expect(history[0].current).toMatchObject({ width: 40, height: 30 });
});

it.each(["source_changed", "missing_photo", "verification_unavailable"] as const)("blocks save for %s without substituting another photo", async (status) => {
  await open(); await prepare(); vi.mocked(evidence.resolveComparisonSide).mockResolvedValue({ status, message: `Original ${status}; no substitute shown.` });
  fireEvent.click(screen.getByRole("button", { name: "Save comparison on this device" }));
  expect(await screen.findByText(`Original ${status}; no substitute shown.`)).toBeInTheDocument(); expect(store.appendInspectionComparison).not.toHaveBeenCalled();
  expect(screen.getByLabelText("Part or location")).toHaveValue("Rust patch near mount");
});

it("blocks changed saved vehicle context and a deleted original device scan", async () => {
  await open(); await prepare();
  localStorage.setItem(accountStorageKey(LOOKUPS_STORAGE_KEY), JSON.stringify([earlier, { ...lookup, vehicleContext: { model: "Other car" } }]));
  fireEvent.click(screen.getByRole("button", { name: "Save comparison on this device" }));
  expect(await screen.findByText(/saved vehicle\/analysis context changed/)).toBeInTheDocument(); expect(store.appendInspectionComparison).not.toHaveBeenCalled();
  deleteLookup(lookup.id); fireEvent.click(screen.getByRole("button", { name: "Save comparison on this device" }));
  expect(await screen.findByText(/original device scan was removed/)).toBeInTheDocument();
});

it("rejects an earlier local scan changed while the current original is being resolved", async () => {
  await open(); await prepare();
  vi.mocked(evidence.resolveComparisonSide).mockImplementation(async (value) => {
    if (value.lookupId === lookup.id) deleteLookup(earlier.id);
    return { status: "unchanged", image: "data:image/png;base64,old", message: "Verified at read time" };
  });
  fireEvent.click(screen.getByRole("button", { name: "Save comparison on this device" }));
  expect(await screen.findByText(/One of the saved scans changed while its originals/)).toBeInTheDocument();
  expect(store.appendInspectionComparison).not.toHaveBeenCalled(); expect(mocks.raw).toContain("Rust patch near mount");
});

it("surfaces conflicting saved vehicle facts without automatically confirming identity", async () => {
  earlier = { ...earlier, vehicleContext: { year: "2010", model: "Earlier model", vin: "AAAAAAAAAAAAAAAAA" } };
  localStorage.setItem(accountStorageKey(LOOKUPS_STORAGE_KEY), JSON.stringify([earlier, lookup]));
  await open(); await prepare();
  expect(screen.getByText(/Saved vehicle details differ: model/)).toBeInTheDocument();
  expect(screen.getByLabelText("I confirm these show the same vehicle")).not.toBeChecked();
  expect(screen.getByLabelText("Component relationship")).toHaveValue("unconfirmed");
});

it("supports an originally cloud-only current scan with guarded saved prop context", async () => {
  deleteLookup(lookup.id); await open(); await prepare(); await save(); expect(history).toHaveLength(1);
});

it("retains and explicitly restores the draft after reopening, without silently replacing another tab", async () => {
  const view = await open(); await prepare(); observation(); await waitFor(() => expect(mocks.raw).toContain("Darker edge"));
  const prior = mocks.raw; view.unmount(); await open();
  expect(await screen.findByLabelText("Comparison draft recovery")).toBeInTheDocument(); expect(screen.getByLabelText("Part or location")).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Restore comparison draft" })); await waitFor(() => expect(screen.getByLabelText("Part or location")).toBeEnabled());
  expect(screen.getByLabelText("Human observations (included in reports)")).toHaveValue("  Darker edge; different lighting may explain it.  ");
  const other = drafts.parseComparisonDraft(prior!)!; other.record.subject = "Other tab newer draft"; mocks.raw = JSON.stringify(other);
  fill("Part or location", "My unsaved edit"); await screen.findByText(/Another tab changed this comparison draft/);
  fireEvent.click(screen.getByRole("button", { name: "Download unsaved comparison" })); expect(downloadTextFile).toHaveBeenCalledWith(expect.any(String), expect.stringContaining("My unsaved edit"));
  fireEvent.click(screen.getByRole("button", { name: "Discard comparison draft" })); await waitFor(() => expect(mocks.raw).toContain("Other tab newer draft"));
  expect(store.appendInspectionComparison).not.toHaveBeenCalled();
});

it("does not clear a failed local save and retries the same record ID", async () => {
  await open(); await prepare(); vi.mocked(store.appendInspectionComparison).mockRejectedValueOnce(new Error("Device full"));
  fireEvent.click(screen.getByRole("button", { name: "Save comparison on this device" })); await screen.findByText("Device full");
  const id = vi.mocked(store.appendInspectionComparison).mock.calls[0][0].id; expect(mocks.raw).toContain(id); await save();
  expect(vi.mocked(store.appendInspectionComparison).mock.calls[1][0].id).toBe(id);
});

it("appends a correction with reason and preserves both originals and the prior record", async () => {
  const original = savedRecord(); history = [original]; await open();
  fireEvent.click(screen.getByRole("button", { name: "Correct comparison" })); fill("Reason for correction", "Lighting was different");
  fill("Lighting", "different"); await save();
  expect(history).toHaveLength(2); expect(history[0]).toEqual(original); expect(history[1]).toMatchObject({ supersedesId: original.id, correctionReason: "Lighting was different", earlier: original.earlier, current: original.current });
});

it("shows correction forks without silently preferring a branch", async () => {
  const original = savedRecord(); const branch = () => ({ ...original, id: crypto.randomUUID(), supersedesId: original.id, correctionReason: "Independent correction" });
  history = [original, branch(), branch()]; await open();
  const list = screen.getByRole("list", { name: "Saved comparisons" });
  expect(within(list).getAllByText(/Correction fork:/)).toHaveLength(3);
  expect(within(list).getAllByRole("button", { name: "Correct comparison" }).every((button) => button.hasAttribute("disabled"))).toBe(true);
});

it("uses explicit cloud acknowledgement even when no records were newly inserted", async () => {
  await open(); fireEvent.click(screen.getByRole("button", { name: "Sync comparisons" }));
  await screen.findByText(/All snapshot comparisons cloud-confirmed/); expect(cloud.syncInspectionComparisons).toHaveBeenCalledWith(lookup.id, getAccountScope());
  expect(store.appendInspectionComparison).not.toHaveBeenCalled();
});

it("releases the form after the cloud-choice deadline and ignores the late response", async () => {
  let release!: (value: Awaited<ReturnType<typeof readCloudLookups>>) => void;
  vi.mocked(readCloudLookups).mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
  await open(); fill("Part or location", "Keep my device draft");
  await waitFor(() => expect(mocks.raw).toContain("Keep my device draft"));
  vi.useFakeTimers(); fireEvent.click(screen.getByRole("button", { name: "Load cloud scan choices" }));
  expect(screen.getByLabelText("Part or location")).toBeDisabled();
  await act(async () => { await vi.advanceTimersByTimeAsync(19_999); }); expect(screen.getByLabelText("Part or location")).toBeDisabled();
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(screen.getByText(/Cloud scan choices timed out/)).toBeInTheDocument(); expect(screen.getByLabelText("Part or location")).toBeEnabled();
  expect(screen.getByLabelText("Part or location")).toHaveValue("Keep my device draft");
  await act(async () => { release({ ok: true, value: [{ ...earlier, id: "late-cloud-scan" }] }); });
  expect(screen.getByText(/Cloud scan choices timed out/)).toBeInTheDocument();
  expect([...screen.getByLabelText<HTMLSelectElement>("Earlier saved scan").options].some((option) => option.value === "late-cloud-scan")).toBe(false);
  expect(store.appendInspectionComparison).not.toHaveBeenCalled();
});

it("shows an unaligned original from saved history without correcting or mutating its record", async () => {
  const record = savedRecord(); record.alignment = { rotation: 90, scale: 2, offsetX: .25, offsetY: -.1 }; history = [record];
  const before = JSON.stringify(history); await open(); const list = screen.getByRole("list", { name: "Saved comparisons" });
  const image = await within(list).findByAltText<HTMLImageElement>("Current original"); const source = image.src;
  expect(image.style.transform).toBe("translate(25%, -10%) rotate(90deg) scale(2)");
  fireEvent.click(within(list).getByRole("button", { name: "Show unaligned original" })); expect(image.style.transform).toBe(""); expect(image.src).toBe(source);
  fireEvent.click(within(list).getByRole("button", { name: "Show saved alignment" })); expect(image.style.transform).toBe("translate(25%, -10%) rotate(90deg) scale(2)");
  expect(JSON.stringify(history)).toBe(before); expect(store.appendInspectionComparison).not.toHaveBeenCalled(); expect(drafts.writeComparisonDraft).not.toHaveBeenCalled();
  expect(screen.queryByText("Correct a saved comparison")).not.toBeInTheDocument();
});

it("prepares repeat capture with reserved IDs and exact reference metadata, never image bytes as a new view", async () => {
  await open(); fill("Part or location", "Rust patch near mount"); fill("Current original photo", "photo-2");
  fireEvent.click(screen.getByRole("button", { name: "Photograph this location again" }));
  await waitFor(() => expect(mocks.navigate).toHaveBeenCalledOnce());
  const [path, options] = mocks.navigate.mock.calls[0]; expect(path).toBe("/scan");
  expect(options.state).toMatchObject({ accountId: "comparison-owner", comparisonCaptureTarget: { version: 1, subject: "Rust patch near mount", earlier: { lookupId: lookup.id, photoId: "photo-2" } } });
  expect(options.state.comparisonCaptureTarget.lookupId).not.toBe(lookup.id); expect(JSON.stringify(options)).not.toContain("data:image");
  expect(store.appendInspectionComparison).not.toHaveBeenCalled(); expect(mocks.raw).toContain("Rust patch near mount");
});

it("hides private fields after account change and ignores late completion", async () => {
  let release!: (value: InspectionComparison[]) => void;
  const view = await open(); await prepare(); vi.mocked(store.appendInspectionComparison).mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
  fireEvent.click(screen.getByRole("button", { name: "Save comparison on this device" })); await waitFor(() => expect(store.appendInspectionComparison).toHaveBeenCalledOnce());
  const saved = vi.mocked(store.appendInspectionComparison).mock.calls[0][0];
  setActiveAccount("other"); view.rerender(<ScanComparisonReview lookup={lookup} />); await act(async () => release([saved]));
  expect(screen.queryByLabelText("Part or location")).not.toBeInTheDocument(); expect(screen.getByText(/Comparison notes are hidden/)).toBeInTheDocument();
  expect(mocks.raw).toContain("Rust patch near mount");
});
