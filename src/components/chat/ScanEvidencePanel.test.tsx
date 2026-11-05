import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type { Lookup } from "../../types";
import { ScanEvidencePanel } from "./ScanEvidencePanel";
import { getTrustedFocusBox } from "./scanEvidenceGeometry";

const lookup: Lookup = {
  id: "lookup-1",
  createdAt: "2026-10-31T12:00:00.000Z",
  frame: { imageBase64: "data:image/jpeg;base64,test", capturedAt: "2026-10-31T12:00:00.000Z" },
  focusBox: { x: 0.2, y: 0.25, width: 0.5, height: 0.4, confidence: 0.9 },
  result: {
    partName: "Alternator",
    confidence: "high",
    confidenceScore: 91,
    scanCategory: "electrical",
    candidateMatches: [],
    whatItDoes: "Charges the battery while the engine runs.",
    visibleObservations: ["A belt pulley is visible."],
    evidenceRegions: [{ label: "Housing", observation: "Vented metal housing is visible.", regionLabel: "center" }],
    concerns: ["Surface corrosion may be present."],
    safetyTriage: "can_help",
    isSafetyCritical: false,
    nextAction: "Check the belt and electrical connector.",
    needsBetterPhoto: false,
    evidence: ["The vented housing and pulley support the result."],
    sourceLinks: [{ label: "Alternator reference", sourceType: "reference", url: "https://example.com/alternator" }],
    modelRun: { provider: "gemini", model: "gemini-test", latencyMs: 1200, ocrUsed: false },
  },
  analyzedAt: "2026-10-31T12:00:02.000Z",
  rating: null,
  correction: null,
  notes: "",
  scanCategory: "electrical",
  trainingLabel: "Alternator",
  trainingStatus: "raw_unreviewed",
  chatHistory: [],
  provenance: { analysisSource: "ai_detection", captureMode: "upload", savedAt: "2026-10-31T12:00:02.000Z" },
};

describe("ScanEvidencePanel", () => {
  it.each([91, 100, undefined])("does not turn the stored model score %s into a probability", (confidenceScore) => {
    const result = { ...lookup.result!, confidenceScore };
    renderPanel({ ...lookup, result });
    const identity = screen.getByRole("button", { name: /Identity/ });
    expect(identity).toHaveTextContent("Alternator · AI estimate: high");
    expect(identity).not.toHaveTextContent(/\d+%/);
    expect(screen.getByText(/does not represent a measured chance of a correct identification/)).toBeInTheDocument();
    expect(screen.getByText("The vented housing and pulley support the result.")).toBeInTheDocument();
    expect(result.confidenceScore).toBe(confidenceScore);
  });

  it("keeps the estimate limitation visible when identity evidence is absent", () => {
    renderPanel({ ...lookup, result: { ...lookup.result!, evidence: [], confidence: "low", confidenceScore: 28 } });
    expect(screen.getByRole("button", { name: /Identity/ })).toHaveTextContent("AI estimate: low");
    expect(screen.getByText("DeepSpec suggests Alternator; verify using visible evidence.")).toBeInTheDocument();
    expect(screen.getByText(/does not represent a measured chance/)).toBeInTheDocument();
    expect(screen.queryByText(/28%/)).not.toBeInTheDocument();
  });

  it("draws only a sufficiently confident saved focus box", () => {
    const { rerender } = renderPanel(lookup);
    expect(screen.getByTestId("chat-focus-target")).toHaveStyle({ left: "20%", top: "25%", width: "50%", height: "40%" });

    rerender(<MemoryRouter><ScanEvidencePanel lookup={{ ...lookup, focusBox: { ...lookup.focusBox!, confidence: 0.4 } }} onDraftQuestion={vi.fn()} /></MemoryRouter>);
    expect(screen.queryByTestId("chat-focus-target")).not.toBeInTheDocument();
    expect(screen.getByText(/No locked target geometry/)).toBeInTheDocument();
  });

  it("links separated evidence sections back to a focused chat draft", async () => {
    const onDraftQuestion = vi.fn();
    renderPanel(lookup, onDraftQuestion);

    await userEvent.click(screen.getByRole("button", { name: /Function/ }));
    const detail = screen.getByRole("heading", { name: "Function" }).closest("section");
    expect(detail).not.toBeNull();
    expect(within(detail!).getByText("Charges the battery while the engine runs.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Ask about this" }));
    expect(onDraftQuestion).toHaveBeenCalledWith(expect.stringContaining("What does this Alternator do"));
  });

  it("keeps text-only evidence in the detail list instead of inventing image boxes", async () => {
    renderPanel(lookup);
    await userEvent.click(screen.getByRole("button", { name: /Visible evidence/ }));
    expect(screen.getByText("A belt pulley is visible.")).toBeInTheDocument();
    expect(screen.getByText("Vented metal housing is visible.")).toBeInTheDocument();
    expect(screen.getAllByTestId("chat-focus-target")).toHaveLength(1);
  });
});

describe("getTrustedFocusBox", () => {
  it("rejects low-confidence, tiny, and out-of-bounds geometry", () => {
    expect(getTrustedFocusBox({ x: 0, y: 0, width: 0.4, height: 0.4, confidence: 0.59 })).toBeNull();
    expect(getTrustedFocusBox({ x: 0, y: 0, width: 0.02, height: 0.4, confidence: 0.9 })).toBeNull();
    expect(getTrustedFocusBox({ x: 0.8, y: 0, width: 0.3, height: 0.4, confidence: 0.9 })).toBeNull();
  });
});

function renderPanel(value: Lookup, onDraftQuestion = vi.fn()) {
  return render(
    <MemoryRouter>
      <ScanEvidencePanel lookup={value} onDraftQuestion={onDraftQuestion} />
    </MemoryRouter>,
  );
}
