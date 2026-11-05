import { webcrypto } from "node:crypto";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { DiagnosticReportReview } from "./DiagnosticReportReview";
import { accountStorageKey, getAccountScope, setActiveAccount } from "../../lib/accountScope";
import { mergeDiagnosticBundles } from "../../lib/diagnosticAssociation";
import { createDiagnosticDocument, diagnosticSourceBytes, parseDiagnosticText } from "../../lib/diagnosticReport";
import { createLookup, deleteLookup, getLookup, LOOKUPS_STORAGE_KEY } from "../../services/storage";
import * as store from "../../services/diagnosticReportStore";
import * as cloud from "../../services/diagnosticReportCloud";
import * as drafts from "../../services/diagnosticDraft";
import * as evidence from "../../services/comparisonEvidence";
import { downloadTextFile } from "../../services/report";
import type { Lookup } from "../../types";
import type { ComparisonSide } from "../../types/inspectionComparison";
import type { DiagnosticAssociation, DiagnosticBundle, DiagnosticDocument } from "../../types/diagnosticReport";

const mocks = vi.hoisted(() => ({ raw: null as string | null, failDraft: false }));
vi.mock("../../services/comparisonEvidence", () => ({ comparisonPhotos: vi.fn(), comparisonSideForLookup: vi.fn(), resolveComparisonSide: vi.fn() }));
vi.mock("../../services/diagnosticReportStore", () => ({ readDiagnosticBundle: vi.fn(), appendDiagnosticDocument: vi.fn(), appendDiagnosticAssociation: vi.fn(), importDiagnosticBundle: vi.fn(), subscribeDiagnosticReports: vi.fn() }));
vi.mock("../../services/diagnosticReportCloud", () => ({ readCloudDiagnosticBundle: vi.fn(), syncDiagnosticReports: vi.fn() }));
vi.mock("../../services/report", () => ({ downloadTextFile: vi.fn() }));
vi.mock("../../services/diagnosticDraft", async (original) => {
  const actual = await original<typeof import("../../services/diagnosticDraft")>();
  return { ...actual, readDiagnosticDraft: vi.fn(async () => ({ ok: true, raw: mocks.raw, draft: mocks.raw ? actual.parseDiagnosticDraft(mocks.raw) : null, message: "" })),
    writeDiagnosticDraft: vi.fn(async (_scope: unknown, _id: string, expected: string | null, draft: drafts.DiagnosticDraft | null) => {
      if (mocks.failDraft) return { ok: false, message: "Draft quota failed. Download entered text." };
      if (mocks.raw !== expected) return { ok: false, message: "Another tab changed this diagnostic draft." };
      mocks.raw = draft ? JSON.stringify(draft) : null; return { ok: true, raw: mocks.raw };
    }) };
});

// Synthetic report only. Exact source bytes and the production parser are used by
// these UI tests; IDB and cloud boundaries have separate native/store tests.
const SOURCE = ["Thursday,05,November,2026,09:30:00:00001", "VCDS -- Synthetic test export", "VCDS Version: 22.4.0.1 (x64)", "Chassis Type: TEST", "Scan: 01", "VIN: SYNTHETICVIN000001", "Mileage: 123 km", "01-Engine -- Status: Malfunction 0010", "-----", "Address 01: Engine       Labels: None", "1 Fault Found:", "00123456 - Synthetic fault description", "          U1234 00 [032] - Synthetic elaboration", "          Intermittent - Not Confirmed - Tested Since Memory Clear", "             Freeze Frame:", "                    Temperature: -6.30 °C", "                    Temperature: 12.00 °C", "Readiness: 0000 0000", "End----------------", ""].join("\r\n");
let lookup: Lookup, bundle: DiagnosticBundle, document: DiagnosticDocument;
function side(source: Lookup, photoId: string): ComparisonSide {
  const photo = (source.photos ?? [{ ...source.frame, id: "photo-1", label: "overview" as const }]).find((item) => item.id === photoId)!;
  return { lookupId: source.id, photoId, photoLabel: photo.label, photoAddedAt: photo.capturedAt, scanSavedAt: source.createdAt,
    sha256: (photoId === "photo-2" ? "b" : "a").repeat(64), width: 40, height: 30, observedOn: null, vehicleContext: source.vehicleContext ?? null,
    ...(source.analysisAttemptId ? { analysisAttemptId: source.analysisAttemptId } : {}) };
}
beforeEach(async () => {
  vi.clearAllMocks(); localStorage.clear(); setActiveAccount("diagnostic-owner"); vi.stubGlobal("crypto", webcrypto); mocks.raw = null; mocks.failDraft = false;
  const frame = { imageBase64: "data:image/png;base64,original", capturedAt: "2026-11-05T12:00:00.000Z" };
  lookup = createLookup({ frame, photos: [{ ...frame, id: "photo-1", label: "overview" }, { ...frame, id: "photo-2", label: "close_up" }], vehicleContext: { model: "Saved car" }, analysisAttemptId: "analysis:Original" }, "diagnostic-scan").value;
  document = await createDiagnosticDocument(new File([SOURCE], "synthetic.txt", { type: "text/plain" }), lookup.id);
  bundle = { documents: [document], associations: [] };
  vi.mocked(evidence.comparisonPhotos).mockImplementation((value) => value.photos?.length ? value.photos : [{ ...value.frame, id: "photo-1", label: "overview" }]);
  vi.mocked(evidence.comparisonSideForLookup).mockImplementation(async (value, id) => side(value, id));
  vi.mocked(evidence.resolveComparisonSide).mockImplementation(async (value) => ({ status: "unchanged", image: `data:image/png;base64,${value.photoId}`, message: "Original verified." }));
  vi.mocked(store.readDiagnosticBundle).mockImplementation(async () => bundle);
  vi.mocked(store.appendDiagnosticDocument).mockImplementation(async (value) => { bundle = mergeDiagnosticBundles(bundle, { documents: [value], associations: [] }, lookup.id); return bundle; });
  vi.mocked(store.appendDiagnosticAssociation).mockImplementation(async (value) => {
    if (value.supersedesId && bundle.associations.some((item) => item.supersedesId === value.supersedesId && item.id !== value.id)) throw new Error("This association was already corrected in another view.");
    bundle = mergeDiagnosticBundles(bundle, { documents: [], associations: [value] }, lookup.id); return bundle;
  });
  vi.mocked(store.importDiagnosticBundle).mockImplementation(async (_id, value) => { bundle = mergeDiagnosticBundles(bundle, value, lookup.id); return bundle; });
  vi.mocked(store.subscribeDiagnosticReports).mockReturnValue(() => {});
  vi.mocked(cloud.readCloudDiagnosticBundle).mockResolvedValue({ documents: [], associations: [] });
  vi.mocked(cloud.syncDiagnosticReports).mockResolvedValue({ synced: 0, message: "All snapshot originals and associations cloud-confirmed. Later entries need another sync." });
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

function openDetails(summary: string) { const details = screen.getByText(summary, { selector: "summary" }).closest("details")!; details.open = true; fireEvent(details, new Event("toggle")); }
async function open(value = lookup, recovering = false) {
  const view = render(<DiagnosticReportReview lookup={value} />); openDetails("Diagnostic report imports");
  await screen.findByLabelText("Part or location associated with the report");
  if (recovering) await screen.findByLabelText("Diagnostic draft recovery");
  else await waitFor(() => expect(screen.getByLabelText("Part or location associated with the report")).toBeEnabled());
  return view;
}
function fill(name: string, value: string) { fireEvent.change(screen.getByLabelText(name), { target: { value } }); }
async function prepare() {
  fill("Imported report", document.id); fill("Part or location associated with the report", "Engine harness near connector");
  fireEvent.click(screen.getByLabelText("close up — photo-2")); fireEvent.click(screen.getByRole("button", { name: "Check selected originals" }));
  await screen.findByAltText("Diagnostic association original photo-2");
  await waitFor(() => expect(screen.getByRole("button", { name: "Save human association on this device" })).toBeEnabled());
  await screen.findByText(/Parsing coverage: complete/);
}
async function save() {
  fireEvent.click(screen.getByRole("button", { name: "Save human association on this device" }));
  await screen.findByText("Human association saved on this device. Original diagnostic output, AI findings and inspection status are unchanged.");
}
function savedRecord(): DiagnosticAssociation { return { ...drafts.newDiagnosticDraft(lookup.id, document).record, subject: "Original relationship", photos: [side(lookup, "photo-2")] }; }
function selectFile(file: File) { fireEvent.change(screen.getByLabelText("Plain-text report (.txt, up to 2 MiB)"), { target: { files: [file] } }); }

it("imports reports locally while cloud reads and sync stay disabled", async () => {
  vi.stubEnv("VITE_ENABLE_CLOUD_SYNC", "false");
  bundle = { documents: [], associations: [] }; await open();
  for (const name of ["Read cloud diagnostic reports", "Sync diagnostic reports"]) {
    const button = screen.getByRole("button", { name }); expect(button).toBeDisabled(); fireEvent.click(button);
  }
  selectFile(new File([SOURCE], "device-only.txt", { type: "text/plain" }));
  fireEvent.click(screen.getByRole("button", { name: "Import original on this device" }));
  await screen.findByRole("option", { name: /device-only.txt/ });
  expect(bundle.documents).toHaveLength(1);
  expect(diagnosticSourceBytes(bundle.documents[0])).toEqual(new TextEncoder().encode(SOURCE));
  expect(screen.getByText(/Cloud sync is off/)).toBeInTheDocument();
  expect(screen.getByLabelText("Part or location associated with the report")).toBeEnabled();
  expect(cloud.readCloudDiagnosticBundle).not.toHaveBeenCalled(); expect(cloud.syncDiagnosticReports).not.toHaveBeenCalled();
  expect(store.importDiagnosticBundle).not.toHaveBeenCalled();
});

it("imports exact original bytes before offering the saved report and keeps parsing local", async () => {
  bundle = { documents: [], associations: [] }; await open(); const network = vi.fn(); vi.stubGlobal("fetch", network);
  const source = new File([`\uFEFF${SOURCE}`], "original.txt", { type: "text/plain" });
  let acknowledge!: (value: DiagnosticBundle) => void;
  vi.mocked(store.appendDiagnosticDocument).mockImplementationOnce(() => new Promise((resolve) => { acknowledge = resolve; }));
  selectFile(source); fireEvent.click(screen.getByRole("button", { name: "Import original on this device" }));
  await waitFor(() => expect(store.appendDiagnosticDocument).toHaveBeenCalledOnce());
  const saved = vi.mocked(store.appendDiagnosticDocument).mock.calls[0][0];
  expect(Array.from(diagnosticSourceBytes(saved))).toEqual(Array.from(new TextEncoder().encode(`\uFEFF${SOURCE}`)));
  expect(screen.queryByRole("option", { name: /original.txt/ })).not.toBeInTheDocument();
  await act(async () => acknowledge({ documents: [saved], associations: [] }));
  expect(await screen.findByRole("option", { name: /original.txt/ })).toBeInTheDocument();
  expect(network).not.toHaveBeenCalled(); expect(cloud.syncDiagnosticReports).not.toHaveBeenCalled(); expect(store.appendDiagnosticAssociation).not.toHaveBeenCalled();
});

it("requires explicit Windows-1252 after UTF-8 rejects bytes and preserves the selected file", async () => {
  await open(); const bytes = Uint8Array.from(SOURCE.replaceAll("°", "~"), (character) => character === "~" ? 0xb0 : character.charCodeAt(0));
  selectFile(new File([bytes.buffer], "legacy.txt", { type: "text/plain" })); fireEvent.click(screen.getByRole("button", { name: "Import original on this device" }));
  await screen.findByText(/Choose Windows-1252/); expect(store.appendDiagnosticDocument).not.toHaveBeenCalled();
  expect(screen.getByText("Selected: legacy.txt")).toBeInTheDocument(); fill("File encoding", "windows-1252");
  fireEvent.click(screen.getByRole("button", { name: "Import original on this device" })); await screen.findByRole("option", { name: /legacy.txt/ });
  const saved = vi.mocked(store.appendDiagnosticDocument).mock.calls[0][0]; expect(saved.encoding).toBe("windows-1252"); expect(diagnosticSourceBytes(saved)).toEqual(bytes);
});

it.each(["wrong extension", "oversize"])("rejects %s without storing a document and retains the selected file", async (kind) => {
  await open(); const file = kind === "oversize" ? new File(["x".repeat(2 * 1024 * 1024 + 1)], "too-large.txt") : new File([SOURCE], "report.pdf", { type: "text/plain" });
  selectFile(file); fireEvent.click(screen.getByRole("button", { name: "Import original on this device" }));
  await screen.findByText(kind === "oversize" ? /report exceeds the 2 MiB limit/ : /Choose a plain-text .txt report/);
  expect(screen.getByText(`Selected: ${file.name}`)).toBeInTheDocument(); expect(store.appendDiagnosticDocument).not.toHaveBeenCalled();
});

it("retries a failed raw-document write with the exact same ID and bytes", async () => {
  await open(); vi.mocked(store.appendDiagnosticDocument).mockRejectedValueOnce(new Error("Device full"));
  selectFile(new File([SOURCE], "retry.txt", { type: "text/plain" })); fireEvent.click(screen.getByRole("button", { name: "Import original on this device" })); await screen.findByText("Device full");
  const first = vi.mocked(store.appendDiagnosticDocument).mock.calls[0][0];
  fireEvent.click(screen.getByRole("button", { name: "Import original on this device" })); await screen.findByRole("option", { name: /retry.txt/ });
  expect(vi.mocked(store.appendDiagnosticDocument).mock.calls[1][0]).toEqual(first);
});

it("renders repeated readings, status and exact line provenance, and saves selected entries/photos without changing AI", async () => {
  const before = JSON.stringify(getLookup(lookup.id)); await open(); await prepare();
  const parsed = parseDiagnosticText(SOURCE), readings = parsed.controllers[0].faults[0].freezeFrames[0].readings;
  expect(screen.getByText(`Line ${readings[0].line}: Temperature: -6.30 °C`)).toBeInTheDocument();
  expect(screen.getByText(`Line ${readings[1].line}: Temperature: 12.00 °C`)).toBeInTheDocument();
  expect(screen.getByText(/Intermittent - Not Confirmed - Tested Since Memory Clear/)).toBeInTheDocument();
  fireEvent.click(screen.getByLabelText(`Select reading at line ${readings[1].line}`));
  fill("Report’s relationship to this vehicle", "same_vehicle"); fill("How you know the vehicle relationship", "I exported this report from this car at this visit.");
  fill("Human association notes (included in reports)", "  Code does not establish connector failure.  "); await save();
  expect(bundle.associations[0]).toMatchObject({ documentId: document.id, sourceSha256: document.sha256, entryIds: [readings[1].id], photos: [{ lookupId: lookup.id, photoId: "photo-2" }], vehicleRelationship: "same_vehicle", notes: "  Code does not establish connector failure.  " });
  expect(JSON.stringify(getLookup(lookup.id))).toBe(before); expect(mocks.raw).toBeNull(); expect(cloud.syncDiagnosticReports).not.toHaveBeenCalled();
});

it("retains unsupported original text safely and downloads its exact bytes without claiming structured success", async () => {
  const text = "<script>window.__unsafe = true</script>\r\nUnsupported scanner text";
  document = await createDiagnosticDocument(new File([text], "unsupported.txt", { type: "text/plain" }), lookup.id); bundle.documents = [document];
  await open(); fill("Imported report", document.id); await screen.findByText(/Unsupported report format/);
  expect(screen.queryByText(/Module 01/)).not.toBeInTheDocument(); openDetails("Read original text with line numbers");
  expect(screen.getByText("<script>window.__unsafe = true</script>")).toBeInTheDocument(); expect(window.document.querySelector("script")).toBeNull();
  const urls = vi.fn<(blob: Blob) => string>().mockReturnValue("blob:diagnostic-test"); vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: urls, revokeObjectURL: vi.fn() }));
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  fireEvent.click(screen.getByRole("button", { name: "Download exact original bytes" })); expect(click).toHaveBeenCalledOnce();
  const blob = urls.mock.calls[0][0] as Blob;
  const bytes = await new Promise<ArrayBuffer>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result as ArrayBuffer); reader.onerror = reject; reader.readAsArrayBuffer(blob); });
  expect(Array.from(new Uint8Array(bytes))).toEqual(Array.from(new TextEncoder().encode(text)));
});

it("surfaces incomplete coverage and does not equate no reported fault with vehicle health", async () => {
  document = await createDiagnosticDocument(new File([SOURCE.replace("22.4.0.1", "26.9.0").replace("End----------------", "")], "incomplete.txt"), lookup.id); bundle.documents = [document];
  await open(); fill("Imported report", document.id); await screen.findByText(/Parsing coverage: incomplete/);
  expect(within(screen.getByRole("list", { name: "Parser warnings" })).getByText(/compatibility is unverified/)).toBeInTheDocument();
  expect(screen.getByText(/File coverage is not vehicle health/)).toBeInTheDocument();
});

it("resets vehicle confirmation when photos or original report change, retaining notes", async () => {
  const other = await createDiagnosticDocument(new File([SOURCE], "other.txt"), lookup.id); bundle.documents.push(other);
  await open(); await prepare(); fill("Report’s relationship to this vehicle", "same_vehicle"); fill("How you know the vehicle relationship", "My car"); fill("Human association notes (included in reports)", "Keep my notes");
  fireEvent.click(screen.getByLabelText("overview — photo-1")); expect(screen.getByLabelText("Report’s relationship to this vehicle")).toHaveValue("unconfirmed");
  expect(screen.getByLabelText("How you know the vehicle relationship")).toHaveValue(""); expect(screen.queryByAltText("Diagnostic association original photo-2")).not.toBeInTheDocument();
  fill("Report’s relationship to this vehicle", "different_vehicle"); fill("Imported report", other.id);
  expect(screen.getByLabelText("Report’s relationship to this vehicle")).toHaveValue("unconfirmed"); expect(screen.getByLabelText("Human association notes (included in reports)")).toHaveValue("Keep my notes");
});

it("keeps unconfirmed identity and whole-report selection explicit when saving", async () => {
  await open(); await prepare(); await save(); expect(bundle.associations[0]).toMatchObject({ entryIds: [], vehicleRelationship: "unconfirmed", basis: "" });
});

it("rejects a changed photo context and a deleted original device scan, preserving the draft", async () => {
  await open(); await prepare(); localStorage.setItem(accountStorageKey(LOOKUPS_STORAGE_KEY), JSON.stringify([{ ...lookup, vehicleContext: { model: "Other car" } }]));
  fireEvent.click(screen.getByRole("button", { name: "Save human association on this device" })); await screen.findByText(/saved vehicle\/analysis context changed/);
  expect(store.appendDiagnosticAssociation).not.toHaveBeenCalled(); deleteLookup(lookup.id);
  fireEvent.click(screen.getByRole("button", { name: "Save human association on this device" })); await screen.findByText(/original device scan was removed/);
  expect(mocks.raw).toContain("Engine harness near connector");
});

it("checks the source again after asynchronous original resolution and allows a cloud-only saved source", async () => {
  deleteLookup(lookup.id); await open(); await prepare(); await save(); expect(bundle.associations).toHaveLength(1);
});

it("does not save if the current device scan changes during final evidence checks", async () => {
  await open(); await prepare();
  vi.mocked(evidence.resolveComparisonSide).mockImplementation(async () => { deleteLookup(lookup.id); return { status: "unchanged", image: "data:image/png;base64,original", message: "Verified" }; });
  fireEvent.click(screen.getByRole("button", { name: "Save human association on this device" })); await screen.findByText(/original device scan was removed/);
  expect(store.appendDiagnosticAssociation).not.toHaveBeenCalled();
});

it("requires explicit draft recovery and refuses stale edit/discard while preserving both copies", async () => {
  const view = await open(); await prepare(); fill("Human association notes (included in reports)", "Retained notes"); await waitFor(() => expect(mocks.raw).toContain("Retained notes"));
  view.unmount(); await open(lookup, true); expect(screen.getByLabelText("Part or location associated with the report")).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Restore diagnostic draft" })); await waitFor(() => expect(screen.getByLabelText("Part or location associated with the report")).toBeEnabled());
  expect(screen.getByLabelText("Human association notes (included in reports)")).toHaveValue("Retained notes");
  const other = drafts.parseDiagnosticDraft(mocks.raw!)!; other.record.subject = "Newer other-tab draft"; mocks.raw = JSON.stringify(other);
  fill("Part or location associated with the report", "My unsaved edit"); await screen.findByText("Another tab changed this diagnostic draft.");
  fireEvent.click(screen.getByRole("button", { name: "Download unsaved diagnostic association" })); expect(downloadTextFile).toHaveBeenCalledWith(expect.any(String), expect.stringContaining("My unsaved edit"));
  fireEvent.click(screen.getByRole("button", { name: "Discard diagnostic draft" })); await waitFor(() => expect(mocks.raw).toContain("Newer other-tab draft"));
  expect(store.appendDiagnosticAssociation).not.toHaveBeenCalled();
});

it.each([false, true])("handles queued draft edits after unmount with account changed = %s", async (accountChanged) => {
  const view = await open();
  let release!: () => void;
  vi.mocked(drafts.writeDiagnosticDraft).mockImplementationOnce(async (_scope, _id, expected, draft) => {
    expect(expected).toBeNull();
    return new Promise((resolve) => { release = () => {
      mocks.raw = JSON.stringify(draft);
      resolve({ ok: true, raw: mocks.raw });
    }; });
  });
  fill("Part or location associated with the report", "First saved edit");
  await waitFor(() => expect(drafts.writeDiagnosticDraft).toHaveBeenCalledOnce());
  fill("Part or location associated with the report", "Newest entered edit before navigation");
  const owner = getAccountScope();
  view.unmount();
  if (accountChanged) setActiveAccount("other-owner");
  await act(async () => release());
  if (accountChanged) {
    expect(drafts.writeDiagnosticDraft).toHaveBeenCalledOnce();
    expect(drafts.parseDiagnosticDraft(mocks.raw!)?.record.subject).toBe("First saved edit");
  } else {
    await waitFor(() => expect(drafts.parseDiagnosticDraft(mocks.raw!)?.record.subject).toBe("Newest entered edit before navigation"));
    expect(drafts.writeDiagnosticDraft).toHaveBeenCalledTimes(2);
    expect(vi.mocked(drafts.writeDiagnosticDraft).mock.calls[1]).toEqual([owner, lookup.id, expect.stringContaining("First saved edit"), expect.objectContaining({ record: expect.objectContaining({ subject: "Newest entered edit before navigation" }) })]);
    await open(lookup, true);
    fireEvent.click(screen.getByRole("button", { name: "Restore diagnostic draft" }));
    await waitFor(() => expect(screen.getByLabelText("Part or location associated with the report")).toBeEnabled());
    expect(screen.getByLabelText("Part or location associated with the report")).toHaveValue("Newest entered edit before navigation");
  }
});

it("preserves a failed association save and retries its stable ID", async () => {
  await open(); await prepare(); vi.mocked(store.appendDiagnosticAssociation).mockRejectedValueOnce(new Error("Device full"));
  fireEvent.click(screen.getByRole("button", { name: "Save human association on this device" })); await screen.findByText("Device full");
  const first = vi.mocked(store.appendDiagnosticAssociation).mock.calls[0][0]; expect(mocks.raw).toContain(first.id); await save();
  expect(vi.mocked(store.appendDiagnosticAssociation).mock.calls[1][0]).toEqual(first);
});

it("appends a correction without changing its original document, photos or prior human record", async () => {
  const original = savedRecord(); bundle.associations = [original]; const bytes = document.sourceBase64; await open();
  fireEvent.click(screen.getByRole("button", { name: "Correct diagnostic association" })); fill("Reason for correction", "Vehicle attribution was not checked.");
  fill("Human association notes (included in reports)", "Corrected human note"); await save();
  expect(bundle.associations).toHaveLength(2); expect(bundle.associations.find((item) => item.id === original.id)).toEqual(original);
  expect(bundle.associations.find((item) => item.supersedesId === original.id)).toMatchObject({ photos: original.photos, documentId: original.documentId, correctionReason: "Vehicle attribution was not checked." });
  expect(bundle.documents[0].sourceBase64).toBe(bytes); expect(screen.getByText("Earlier version remains in this history.")).toBeInTheDocument();
});

it("retains visible correction forks and never offers a silently preferred branch", async () => {
  const original = savedRecord(); const branch = () => ({ ...original, id: crypto.randomUUID(), supersedesId: original.id, correctionReason: "Independent correction" });
  bundle.associations = [original, branch(), branch()]; await open(); const list = screen.getByRole("list", { name: "Saved diagnostic associations" });
  expect(within(list).getAllByText(/Correction fork:/)).toHaveLength(3); expect(within(list).getAllByRole("button", { name: "Correct diagnostic association" }).every((button) => button.hasAttribute("disabled"))).toBe(true);
});

it("shows cloud acknowledgement when no new rows were inserted without clearing entered text", async () => {
  await open(); fill("Part or location associated with the report", "Unsaved relationship"); fireEvent.click(screen.getByRole("button", { name: "Sync diagnostic reports" }));
  await screen.findByText(/All snapshot originals and associations cloud-confirmed/); expect(cloud.syncDiagnosticReports).toHaveBeenCalledWith(lookup.id, getAccountScope());
  expect(screen.getByLabelText("Part or location associated with the report")).toHaveValue("Unsaved relationship"); expect(store.appendDiagnosticAssociation).not.toHaveBeenCalled();
});

it("bounds cloud reads and ignores a late response without replacing a draft or importing data", async () => {
  let release!: (value: DiagnosticBundle) => void; vi.mocked(cloud.readCloudDiagnosticBundle).mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
  await open(); fill("Part or location associated with the report", "Keep entered text"); await waitFor(() => expect(mocks.raw).toContain("Keep entered text"));
  vi.useFakeTimers(); fireEvent.click(screen.getByRole("button", { name: "Read cloud diagnostic reports" }));
  await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
  expect(screen.getByText(/This action took too long/)).toBeInTheDocument(); expect(screen.getByLabelText("Part or location associated with the report")).toBeEnabled();
  await act(async () => release({ documents: [document], associations: [] })); expect(store.importDiagnosticBundle).not.toHaveBeenCalled();
  expect(screen.getByLabelText("Part or location associated with the report")).toHaveValue("Keep entered text");
});

it("hides private content on account change and ignores a late save acknowledgement", async () => {
  let release!: (value: DiagnosticBundle) => void; const view = await open(); await prepare();
  vi.mocked(store.appendDiagnosticAssociation).mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
  fireEvent.click(screen.getByRole("button", { name: "Save human association on this device" })); await waitFor(() => expect(store.appendDiagnosticAssociation).toHaveBeenCalledOnce());
  setActiveAccount("other-owner"); view.rerender(<DiagnosticReportReview lookup={lookup} />); await act(async () => release(bundle));
  expect(screen.getByText(/Diagnostic content is hidden/)).toBeInTheDocument(); expect(screen.queryByLabelText("Part or location associated with the report")).not.toBeInTheDocument();
  expect(mocks.raw).toContain("Engine harness near connector");
});
