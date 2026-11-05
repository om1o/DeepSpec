import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConditionEvidenceReview } from "./ConditionEvidenceReview";
import type { Lookup } from "../../types";
import { formatConditionHandoff } from "../../lib/conditionHandoff";

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

it("does not display or export an assessment referencing an unavailable photo", () => {
  const lookup = record();
  lookup.result!.conditionAssessment!.observations[0].photoIds = ["different-car"];
  const { container } = render(<ConditionEvidenceReview lookup={lookup} onSelectPhoto={vi.fn()} />);
  expect(container).toBeEmptyDOMElement();
  expect(formatConditionHandoff(lookup)).toContain("Relationship unknown");
  expect(formatConditionHandoff(lookup)).not.toContain("Brown flaking material");
  expect(formatConditionHandoff(lookup)).not.toContain("different-car");
});

it("supports older scans without inventing photo-linked observations", () => {
  const lookup = record();
  delete lookup.result!.conditionAssessment;
  const { container } = render(<ConditionEvidenceReview lookup={lookup} onSelectPhoto={vi.fn()} />);
  expect(container).toBeEmptyDOMElement();
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
