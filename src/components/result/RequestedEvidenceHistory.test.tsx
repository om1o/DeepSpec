import { webcrypto } from "node:crypto";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { RequestedEvidenceHistory } from "./RequestedEvidenceHistory";
import { getAccountScope, setActiveAccount } from "../../lib/accountScope";
import { createLookup, deleteLookup } from "../../services/storage";
import { readRequestedEvidenceHistory } from "../../services/requestedEvidenceHistory";
import { subscribeInspectionComparisons } from "../../services/inspectionComparisonStore";
import type { Lookup } from "../../types";
import type { RequestedInspectionComparison } from "../../types/inspectionComparison";

const mocks = vi.hoisted(() => ({ navigate: vi.fn(), change: undefined as ((id: string) => void) | undefined }));
vi.mock("react-router-dom", async (original) => ({ ...await original<typeof import("react-router-dom")>(), useNavigate: () => mocks.navigate }));
vi.mock("../../services/requestedEvidenceHistory", () => ({ readRequestedEvidenceHistory: vi.fn() }));
vi.mock("../../services/inspectionComparisonStore", () => ({ subscribeInspectionComparisons: vi.fn() }));

let origin: Lookup, followup: Lookup, receipt: RequestedInspectionComparison;
const stamp = "2026-11-05T14:00:00.000Z";
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); setActiveAccount("request-history-owner"); vi.stubGlobal("crypto", webcrypto);
  const frame = { imageBase64: "data:image/png;base64,original", capturedAt: stamp };
  origin = createLookup({ frame }, "origin-scan").value;
  followup = createLookup({ frame }, "followup-scan").value;
  receipt = {
    version: 2, id: "11111111-1111-4111-8111-111111111111", lookupId: followup.id, recordedAt: stamp, subject: "Mounting edge",
    earlier: { lookupId: origin.id, photoId: "photo-1", photoLabel: "overview", photoAddedAt: stamp, scanSavedAt: origin.createdAt, sha256: "a".repeat(64), width: 40, height: 30, observedOn: null, vehicleContext: null },
    current: { lookupId: followup.id, photoId: "photo-1", photoLabel: "overview", photoAddedAt: stamp, scanSavedAt: followup.createdAt, sha256: "b".repeat(64), width: 40, height: 30, observedOn: null, vehicleContext: null },
    relationship: { sameVehicle: false, component: "unconfirmed", basis: "" },
    conditions: { angle: "unknown", lighting: "unknown", surfaceNotes: "" }, observation: { outcome: "not_reviewed", notes: "" },
    alignment: { rotation: 0, scale: 1, offsetX: 0, offsetY: 0 },
    requestedEvidence: { version: 1, kind: "photo", request: "Photograph the hidden reverse side.", purpose: "Show the far end of the line.", photoIds: ["photo-1"] }, analysisSha256: "c".repeat(64),
  };
  vi.mocked(readRequestedEvidenceHistory).mockResolvedValue({ records: [receipt], complete: true, scannedBuckets: 1 });
  vi.mocked(subscribeInspectionComparisons).mockImplementation((listener) => { mocks.change = listener; return () => { mocks.change = undefined; }; });
});
afterEach(() => { vi.unstubAllGlobals(); });

function open(value = origin, disabled = false) {
  const view = render(<RequestedEvidenceHistory lookup={value} disabled={disabled} />);
  const details = screen.getByText("Requested-photo follow-ups", { selector: "summary" }).closest("details")!;
  details.open = true; fireEvent(details, new Event("toggle")); return view;
}

it("opens the exact retained follow-up without claiming collection resolved the request", async () => {
  render(<RequestedEvidenceHistory lookup={origin} />);
  expect(readRequestedEvidenceHistory).not.toHaveBeenCalled();
  const details = screen.getByText("Requested-photo follow-ups", { selector: "summary" }).closest("details")!;
  details.open = true; fireEvent(details, new Event("toggle"));
  expect(await screen.findByText(receipt.requestedEvidence.request)).toBeInTheDocument();
  expect(readRequestedEvidenceHistory).toHaveBeenCalledWith(origin.id, getAccountScope());
  expect(screen.getByLabelText("Saved photo request")).toHaveTextContent(receipt.requestedEvidence.purpose);
  expect(screen.getByText(/Collecting photos does not mean this request was resolved/)).toBeInTheDocument();
  expect(screen.getByText(/Device history only. Cloud history is not searched/)).toBeInTheDocument();
  expect(screen.getByText(/Receipt recorded.*not a proven photo exposure date/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Open follow-up" }));
  expect(mocks.navigate).toHaveBeenCalledExactlyOnceWith(`/result/${followup.id}`);
});

it("keeps historical request text after the follow-up device scan is removed", async () => {
  open(); await screen.findByText(receipt.requestedEvidence.request);
  act(() => { deleteLookup(followup.id); });
  expect(screen.getByRole("button", { name: "Open follow-up" })).toBeDisabled();
  expect(screen.getByText(/Follow-up unavailable on this device/)).toBeInTheDocument();
  expect(screen.getByText(receipt.requestedEvidence.request)).toBeInTheDocument();
  expect(screen.getByText(/Human outcome: not reviewed/)).toBeInTheDocument();
  expect(mocks.navigate).not.toHaveBeenCalled();
});

it("refreshes for every owner bucket and ignores a slower older response", async () => {
  let finishOld!: (value: Awaited<ReturnType<typeof readRequestedEvidenceHistory>>) => void;
  vi.mocked(readRequestedEvidenceHistory).mockImplementationOnce(() => new Promise((resolve) => { finishOld = resolve; }));
  open(); await waitFor(() => expect(readRequestedEvidenceHistory).toHaveBeenCalledTimes(1));
  act(() => { mocks.change?.("unrelated-owner-bucket"); });
  await screen.findByText(receipt.requestedEvidence.request);
  await act(async () => { finishOld({ records: [], complete: true, scannedBuckets: 0 }); });
  expect(screen.getByText(receipt.requestedEvidence.request)).toBeInTheDocument();
  expect(readRequestedEvidenceHistory).toHaveBeenCalledTimes(2);
  expect(screen.queryByText(/No saved requested-photo receipts/)).not.toBeInTheDocument();
});

it("never calls incomplete or failed discovery an empty history", async () => {
  vi.mocked(readRequestedEvidenceHistory).mockResolvedValueOnce({ records: [], complete: false, reason: "One bucket was unreadable.", scannedBuckets: 3 });
  open(); await screen.findByText(/History is incomplete.*One bucket was unreadable/);
  expect(screen.queryByText(/No saved requested-photo receipts/)).not.toBeInTheDocument();
  vi.mocked(readRequestedEvidenceHistory).mockRejectedValueOnce(new Error("Device storage unavailable"));
  fireEvent.click(screen.getByRole("button", { name: "Refresh device request history" }));
  await screen.findByText(/History may be incomplete.*Device storage unavailable/);
  expect(screen.queryByText(/No saved requested-photo receipts/)).not.toBeInTheDocument();
});

it("labels a completed empty device search without claiming cloud or legacy captures are absent", async () => {
  vi.mocked(readRequestedEvidenceHistory).mockResolvedValue({ records: [], complete: true, scannedBuckets: 2 });
  open(); await screen.findByText(/No saved requested-photo receipts were found on this device/);
  expect(screen.getByText(/Older captures may not have retained the request; cloud history was not searched/)).toBeInTheDocument();
});

it("hides another origin's late response after route change", async () => {
  let finish!: (value: Awaited<ReturnType<typeof readRequestedEvidenceHistory>>) => void;
  vi.mocked(readRequestedEvidenceHistory).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; })).mockResolvedValue({ records: [], complete: true, scannedBuckets: 1 });
  const view = open(); await waitFor(() => expect(readRequestedEvidenceHistory).toHaveBeenCalledTimes(1));
  view.rerender(<RequestedEvidenceHistory lookup={followup} />);
  await screen.findByText(/No saved requested-photo receipts were found on this device/);
  await act(async () => { finish({ records: [receipt], complete: true, scannedBuckets: 1 }); });
  expect(screen.queryByText(receipt.requestedEvidence.request)).not.toBeInTheDocument();
  expect(readRequestedEvidenceHistory).toHaveBeenLastCalledWith(followup.id, getAccountScope());
});

it("rejects account changes during discovery and hides loaded history on rerender", async () => {
  let finish!: (value: Awaited<ReturnType<typeof readRequestedEvidenceHistory>>) => void;
  vi.mocked(readRequestedEvidenceHistory).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const view = open(); await waitFor(() => expect(readRequestedEvidenceHistory).toHaveBeenCalledTimes(1));
  setActiveAccount("another-owner");
  await act(async () => { finish({ records: [receipt], complete: true, scannedBuckets: 1 }); });
  view.rerender(<RequestedEvidenceHistory lookup={origin} />);
  expect(screen.getByText(/Account changed. Request history is hidden/)).toBeInTheDocument();
  expect(screen.queryByText(receipt.requestedEvidence.request)).not.toBeInTheDocument();
  expect(mocks.navigate).not.toHaveBeenCalled();
});

it("preserves forks, exact escaped request text and unavailable receipts with colliding IDs in different buckets", async () => {
  const special = { ...receipt, requestedEvidence: { ...receipt.requestedEvidence, request: '<img src=x onerror="alert(1)">\nAnother angle.' } };
  const branch = { ...special, id: "22222222-2222-4222-8222-222222222222", supersedesId: special.id, correctionReason: "First correction" };
  const fork = { ...branch, id: "33333333-3333-4333-8333-333333333333", correctionReason: "Other correction" };
  const otherBucket = { ...special, lookupId: "unavailable-other", current: { ...special.current, lookupId: "unavailable-other" } };
  vi.mocked(readRequestedEvidenceHistory).mockResolvedValue({ records: [special, branch, fork, otherBucket], complete: true, scannedBuckets: 2 });
  open();
  const list = await screen.findByRole("list", { name: "Requested-photo receipts" });
  await waitFor(() => expect(within(list).getAllByRole("listitem")).toHaveLength(4));
  expect(list.querySelector("img")).toBeNull();
  expect(within(list).getAllByLabelText("Saved photo request")[0].textContent).toContain(special.requestedEvidence.request);
  expect(screen.getAllByText(/Correction fork: review all retained versions/)).toHaveLength(3);
  expect(screen.getAllByRole("button", { name: "Open follow-up" })[3]).toBeDisabled();
});

it("retains historical receipts when the originating AI result changes and respects disabled navigation", async () => {
  const view = open(origin, true); await screen.findByText(receipt.requestedEvidence.request);
  expect(screen.getByRole("button", { name: "Open follow-up" })).toBeDisabled();
  view.rerender(<RequestedEvidenceHistory lookup={{ ...origin, analysisAttemptId: "new:answer" }} />);
  expect(screen.getByText(receipt.requestedEvidence.request)).toBeInTheDocument();
  expect(readRequestedEvidenceHistory).toHaveBeenCalledTimes(1);
});
