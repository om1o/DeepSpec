import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConditionEvidenceReview } from "./ConditionEvidenceReview";
import type { Lookup } from "../../types";
import { formatConditionHandoff } from "../../lib/conditionHandoff";
import { getAccountScope, setActiveAccount } from "../../lib/accountScope";
import { prepareRequestedEvidenceCapture, requestedEvidenceGuideForLookup } from "../../services/requestedEvidenceCapture";
import { identifyCapturedFrame } from "../../services/aiService";
import type { ComparisonCaptureTarget } from "../../types/inspectionComparison";

const capture = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock("react-router-dom", async (original) => ({ ...await original<typeof import("react-router-dom")>(), useNavigate: () => capture.navigate }));
vi.mock("../../services/requestedEvidenceCapture", async (original) => ({ ...await original<typeof import("../../services/requestedEvidenceCapture")>(), prepareRequestedEvidenceCapture: vi.fn() }));
vi.mock("../../services/aiService", () => ({ identifyCapturedFrame: vi.fn() }));
beforeEach(() => { vi.clearAllMocks(); vi.mocked(prepareRequestedEvidenceCapture).mockReset(); });

function record(): Lookup {
  return {
    id: "inspection", createdAt: "2026-11-05T08:00:00Z", frame: { imageBase64: "data:image/jpeg;base64,original", capturedAt: "2026-11-05T08:00:00Z" },
    photos: [
      { id: "bay", label: "overview", imageBase64: "data:image/jpeg;base64,original", capturedAt: "2026-11-05T08:00:00Z" },
      { id: "bracket", label: "close_up", imageBase64: "data:image/jpeg;base64,detail", capturedAt: "2026-11-05T08:01:00Z" },
    ],
    scanCategory: "body", rating: "up", correction: null, notes: "", chatHistory: [], trainingLabel: "Bracket", trainingStatus: "user_confirmed", reviewStatus: "confirmed",
    provenance: { captureMode: "upload", analysisSource: "ai_detection", savedAt: "2026-11-05T08:00:00Z" },
    result: {
      partName: "Bracket", confidence: "high", scanCategory: "body", candidateMatches: [], whatItDoes: "Supports a component.", visibleObservations: ["Flaking surface material."],
      evidenceRegions: [], concerns: [], safetyTriage: "can_help", isSafetyCritical: false, nextAction: "Show the reverse side.", needsBetterPhoto: false, evidence: [], sourceLinks: [],
      conditionAssessment: {
        version: 1, observations: [{ id: "o1", text: "Brown flaking material is visible.", photoIds: ["bracket"], regionLabel: "Lower mounting edge" }],
        possibleCauses: [{ text: "Corrosion may explain the flaking.", observationIds: ["o1"] }],
        unknowns: ["Remaining thickness and strength are unknown."],
        nextEvidence: { kind: "photo", request: "Show the reverse side.", purpose: "Check whether the visible area continues behind the mounting edge.", photoIds: ["bracket"] },
      },
    },
  };
}

it("opens the actual evidence photo and keeps hypotheses and unknowns explicit", async () => {
  const lookup = record(), select = vi.fn();
  render(<ConditionEvidenceReview lookup={lookup} onSelectPhoto={select} />);
  await userEvent.click(screen.getByRole("button", { name: /for observation o1/ }));
  expect(select).toHaveBeenCalledExactlyOnceWith("bracket");
  expect(screen.getByRole("heading", { name: "Possible causes — unconfirmed" })).toBeInTheDocument();
  expect(screen.getByText("Remaining thickness and strength are unknown.")).toBeInTheDocument();
  expect(screen.getByText(/Not tested; no human inspection recorded/)).toBeInTheDocument();
  const exported = formatConditionHandoff(lookup);
  expect(exported).toContain("[bracket]");
  expect(exported).toContain("based on observations o1");
  expect(exported).toContain(lookup.result!.conditionAssessment!.nextEvidence!.request);
  expect(exported).toContain(lookup.result!.conditionAssessment!.nextEvidence!.purpose);
});

it("passes the exact claim and cited photo to area review without reusing the main part selection", async () => {
  const lookup = record(), select = vi.fn(), review = vi.fn();
  lookup.result!.conditionAssessment!.observations[0].photoIds = ["bracket", "bay"];
  render(<ConditionEvidenceReview lookup={lookup} onSelectPhoto={select} onReviewObservation={review} />);
  await userEvent.click(screen.getByRole("button", { name: "Brown flaking material is visible." }));
  expect(review).toHaveBeenLastCalledWith({ observationId: "o1", photoId: "bracket" });
  await userEvent.click(screen.getByRole("button", { name: /View 1. Overview for observation o1/ }));
  expect(review).toHaveBeenLastCalledWith({ observationId: "o1", photoId: "bay" });
  await userEvent.click(screen.getByRole("button", { name: "Review supporting observation o1 for possible cause 1" }));
  expect(review).toHaveBeenLastCalledWith({ observationId: "o1", photoId: "bracket" });
  expect(screen.getByRole("heading", { name: "Possible causes — unconfirmed" })).toBeInTheDocument();
  expect(select).not.toHaveBeenCalled(); expect(identifyCapturedFrame).not.toHaveBeenCalled();
});

it("does not display or export an assessment referencing an unavailable photo", () => {
  const lookup = record();
  lookup.result!.conditionAssessment!.observations[0].photoIds = ["different-car"];
  const { container } = render(<ConditionEvidenceReview lookup={lookup} onSelectPhoto={vi.fn()} />);
  expect(container).toHaveTextContent("Saved condition findings could not be validated");
  expect(container).not.toHaveTextContent("Brown flaking material");
  expect(formatConditionHandoff(lookup)).toContain("Relationship unknown");
  expect(formatConditionHandoff(lookup)).not.toContain("Brown flaking material");
  expect(formatConditionHandoff(lookup)).not.toContain("different-car");
});

it("supports older scans without inventing photo-linked observations", () => {
  const lookup = record();
  delete lookup.result!.conditionAssessment;
  const { container } = render(<ConditionEvidenceReview lookup={lookup} onSelectPhoto={vi.fn()} />);
  expect(container).toHaveTextContent("No photo-linked condition findings were returned");
  expect(container).not.toHaveTextContent("Brown flaking material");
  expect(formatConditionHandoff(lookup)).toContain("Relationship unknown");
  expect(formatConditionHandoff(lookup)).not.toContain("Condition evidence (AI-reported");
});

it("does not invent legacy original evidence for a placeholder image", () => {
  const lookup = record();
  delete lookup.photos;
  lookup.frame.imageBase64 = "/brand/deepspec-logo.webp";
  lookup.result!.conditionAssessment!.observations[0].photoIds = ["photo-1"];
  lookup.result!.conditionAssessment!.nextEvidence!.photoIds = ["photo-1"];
  expect(formatConditionHandoff(lookup)).toContain("Relationship unknown");
  expect(formatConditionHandoff(lookup)).not.toContain("Original photo [photo-1]");
  expect(formatConditionHandoff(lookup)).not.toContain("Brown flaking material");
});

function target(lookup: Lookup): Extract<ComparisonCaptureTarget, { version: 2 }> {
  return { version: 2, comparisonId: "b7279d11-d9e7-4522-b7eb-067355d09231", lookupId: "9003d4c1-0f96-4e59-834f-61a1241e48ad", subject: "Bracket",
    requestedEvidence: requestedEvidenceGuideForLookup(lookup)!, analysisSha256: "a".repeat(64),
    earlier: { lookupId: lookup.id, photoId: "bracket", photoLabel: "close_up", photoAddedAt: "2026-11-05T08:01:00.000Z", scanSavedAt: "2026-11-05T08:00:00.000Z", sha256: "b".repeat(64), width: 640, height: 480, observedOn: null, vehicleContext: null } };
}

it.each(["photo", "marking"] as const)("preselects the sole cited source for %s, previews saved pixels, and explicitly opens capture without AI", async (kind) => {
  const lookup = record(), select = vi.fn(); lookup.result!.conditionAssessment!.nextEvidence!.kind = kind;
  const prepared = target(lookup); vi.mocked(prepareRequestedEvidenceCapture).mockResolvedValue(prepared);
  render(<ConditionEvidenceReview lookup={lookup} onSelectPhoto={select} />);
  await userEvent.click(screen.getByRole("button", { name: kind === "photo" ? "Collect requested photo" : "Collect requested marking photo" }));
  const chooser = screen.getByRole("group", { name: "Choose source for requested photo" });
  expect(within(chooser).getAllByRole("radio")).toHaveLength(1);
  expect(within(chooser).getByRole("radio", { name: "2. Close-up" })).toBeChecked();
  expect(prepareRequestedEvidenceCapture).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "View selected source image" }));
  expect(select).toHaveBeenCalledExactlyOnceWith("bracket");
  await userEvent.click(screen.getByRole("button", { name: "Start requested photo capture" }));
  expect(prepareRequestedEvidenceCapture).toHaveBeenCalledExactlyOnceWith(lookup, requestedEvidenceGuideForLookup(lookup), "bracket", getAccountScope(), expect.any(AbortSignal));
  expect(capture.navigate).toHaveBeenCalledExactlyOnceWith("/scan", { state: { comparisonCaptureTarget: prepared, accountId: "test-user" } });
  expect(identifyCapturedFrame).not.toHaveBeenCalled();
});

it.each(["multiple", "uncited"])("requires an explicit source choice when the request is %s", async (mode) => {
  const lookup = record();
  if (mode === "multiple") lookup.result!.conditionAssessment!.nextEvidence!.photoIds = ["bay", "bracket"];
  else delete lookup.result!.conditionAssessment!.nextEvidence!.photoIds;
  render(<ConditionEvidenceReview lookup={lookup} onSelectPhoto={vi.fn()} />);
  await userEvent.click(screen.getByRole("button", { name: "Collect requested photo" }));
  const start = screen.getByRole("button", { name: "Start requested photo capture" });
  expect(start).toBeDisabled();
  expect(screen.getAllByRole("radio")).toHaveLength(2);
  expect(screen.getAllByRole("radio").every((input) => !(input as HTMLInputElement).checked)).toBe(true);
  await userEvent.click(screen.getByRole("radio", { name: "1. Overview" }));
  expect(start).toBeEnabled();
  await userEvent.click(screen.getByRole("button", { name: "Cancel requested capture" }));
  expect(screen.queryByRole("group", { name: "Choose source for requested photo" })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Collect requested photo" }));
  expect(screen.getByRole("button", { name: "Start requested photo capture" })).toBeDisabled();
  expect(prepareRequestedEvidenceCapture).not.toHaveBeenCalled();
  expect(identifyCapturedFrame).not.toHaveBeenCalled();
});

it("does not silently choose a single uncited legacy source", async () => {
  const lookup = record(); delete lookup.photos;
  lookup.result!.conditionAssessment!.observations[0].photoIds = ["photo-1"];
  delete lookup.result!.conditionAssessment!.nextEvidence!.photoIds;
  render(<ConditionEvidenceReview lookup={lookup} onSelectPhoto={vi.fn()} />);
  await userEvent.click(screen.getByRole("button", { name: "Collect requested photo" }));
  expect(screen.getByRole("radio", { name: "Original photo" })).not.toBeChecked();
  expect(screen.getByRole("button", { name: "Start requested photo capture" })).toBeDisabled();
});

it.each(["measurement", "professional_inspection"] as const)("keeps %s advice readable without a camera action", (kind) => {
  const lookup = record(); lookup.result!.conditionAssessment!.nextEvidence!.kind = kind;
  render(<ConditionEvidenceReview lookup={lookup} onSelectPhoto={vi.fn()} />);
  expect(screen.getByText("Show the reverse side.")).toBeInTheDocument();
  expect(screen.getByText(/^Why:/)).toHaveTextContent(lookup.result!.conditionAssessment!.nextEvidence!.purpose);
  expect(screen.queryByRole("button", { name: /Collect requested/ })).not.toBeInTheDocument();
  expect(prepareRequestedEvidenceCapture).not.toHaveBeenCalled();
});

it("explicitly hands a valid measurement request to the human form without AI or a reading inference", async () => {
  const lookup = record(), recordMeasurement = vi.fn(); lookup.result!.conditionAssessment!.nextEvidence!.kind = "measurement";
  const view = render(<ConditionEvidenceReview lookup={lookup} onSelectPhoto={vi.fn()} onRecordMeasurement={recordMeasurement} />);
  expect(recordMeasurement).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "Record requested measurement" }));
  expect(recordMeasurement).toHaveBeenCalledTimes(1);
  expect(screen.getByText(/saved reading does not resolve the AI request/)).toBeInTheDocument();
  expect(identifyCapturedFrame).not.toHaveBeenCalled(); expect(prepareRequestedEvidenceCapture).not.toHaveBeenCalled();
  view.rerender(<ConditionEvidenceReview lookup={lookup} disabled onSelectPhoto={vi.fn()} onRecordMeasurement={recordMeasurement} />);
  expect(screen.getByRole("button", { name: "Record requested measurement" })).toBeDisabled();
});

it.each(["foreign", "duplicate", "empty", "malformed"])("does not offer capture for %s source metadata", (failure) => {
  const lookup = record();
  if (failure === "foreign") lookup.result!.conditionAssessment!.nextEvidence!.photoIds = ["other-scan"];
  if (failure === "duplicate") lookup.photos![1].id = lookup.photos![0].id;
  if (failure === "empty") lookup.photos = [];
  if (failure === "malformed") lookup.photos![1].imageBase64 = "/brand/deepspec-logo.webp";
  render(<ConditionEvidenceReview lookup={lookup} onSelectPhoto={vi.fn()} />);
  expect(screen.queryByRole("button", { name: /Collect requested/ })).not.toBeInTheDocument();
  expect(prepareRequestedEvidenceCapture).not.toHaveBeenCalled();
});

it("keeps the source choice and reports a preparation failure without starting AI", async () => {
  const lookup = record(); vi.mocked(prepareRequestedEvidenceCapture).mockRejectedValue(new Error("The saved source changed. Reopen this scan before collecting evidence."));
  render(<ConditionEvidenceReview lookup={lookup} onSelectPhoto={vi.fn()} />);
  await userEvent.click(screen.getByRole("button", { name: "Collect requested photo" }));
  await userEvent.click(screen.getByRole("button", { name: "Start requested photo capture" }));
  expect(await screen.findByRole("status")).toHaveTextContent("The saved source changed.");
  expect(screen.getByRole("radio", { name: "2. Close-up" })).toBeChecked();
  expect(screen.getByRole("button", { name: "Start requested photo capture" })).toBeEnabled();
  expect(capture.navigate).not.toHaveBeenCalled(); expect(identifyCapturedFrame).not.toHaveBeenCalled();
});

it.each(["cancel", "source", "result", "disabled", "account", "unmount"])("ignores delayed preparation after %s changes", async (change) => {
  const lookup = record(); let finish!: (value: Extract<ComparisonCaptureTarget, { version: 2 }>) => void;
  vi.mocked(prepareRequestedEvidenceCapture).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  const view = render(<ConditionEvidenceReview lookup={lookup} onSelectPhoto={vi.fn()} />);
  await userEvent.click(screen.getByRole("button", { name: "Collect requested photo" }));
  await userEvent.click(screen.getByRole("button", { name: "Start requested photo capture" }));
  const signal = vi.mocked(prepareRequestedEvidenceCapture).mock.calls[0][4]!;
  if (change === "cancel") await userEvent.click(screen.getByRole("button", { name: "Cancel requested capture" }));
  if (change === "source" || change === "result") {
    const updated = structuredClone(lookup);
    if (change === "source") updated.photos![1].imageBase64 = "data:image/jpeg;base64,replaced";
    else updated.result!.conditionAssessment!.nextEvidence!.purpose = "A different result's purpose.";
    view.rerender(<ConditionEvidenceReview lookup={updated} onSelectPhoto={vi.fn()} />);
  }
  if (change === "disabled") view.rerender(<ConditionEvidenceReview lookup={lookup} disabled onSelectPhoto={vi.fn()} />);
  if (change === "account") setActiveAccount("different-account");
  if (change === "unmount") view.unmount();
  await act(async () => { finish(target(lookup)); });
  expect(capture.navigate).not.toHaveBeenCalled(); expect(identifyCapturedFrame).not.toHaveBeenCalled();
  if (change !== "account") expect(signal.aborted).toBe(true);
});

it("does not start preparation while device saving or retry is blocked", async () => {
  render(<ConditionEvidenceReview lookup={record()} disabled onSelectPhoto={vi.fn()} />);
  const button = screen.getByRole("button", { name: "Collect requested photo" });
  expect(button).toBeDisabled(); await userEvent.click(button);
  expect(prepareRequestedEvidenceCapture).not.toHaveBeenCalled();
  expect(screen.getByText(/Save this scan on this device and finish any pending retry/)).toBeInTheDocument();
});

it("retains the chosen source when unrelated human notes change", async () => {
  const lookup = record(); delete lookup.result!.conditionAssessment!.nextEvidence!.photoIds;
  const view = render(<ConditionEvidenceReview lookup={lookup} onSelectPhoto={vi.fn()} />);
  await userEvent.click(screen.getByRole("button", { name: "Collect requested photo" }));
  await userEvent.click(screen.getByRole("radio", { name: "1. Overview" }));
  view.rerender(<ConditionEvidenceReview lookup={{ ...structuredClone(lookup), notes: "New human notes", rating: "down" }} onSelectPhoto={vi.fn()} />);
  expect(screen.getByRole("radio", { name: "1. Overview" })).toBeChecked();
  expect(screen.getByRole("button", { name: "Start requested photo capture" })).toBeEnabled();
});
