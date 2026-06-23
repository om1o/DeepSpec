import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { VisualEvidenceOverlay } from "./VisualEvidenceOverlay";
import { buildVisualEvidenceLayer, type VisualEvidenceTarget } from "./visualEvidenceLayer";
import type { IdentificationResult } from "../../types";

const TARGET: VisualEvidenceTarget = {
  confidence: 0.82,
  height: 180,
  id: "target-1",
  width: 240,
  x: 80,
  y: 160,
};

describe("VisualEvidenceOverlay", () => {
  it("renders a grounded visual evidence layer for a confident scan", () => {
    render(<VisualEvidenceOverlay result={makeResult()} target={TARGET} />);

    expect(screen.getByTestId("visual-evidence-layer")).toHaveAttribute("data-visual-mode", "grounded");
    expect(screen.getByTestId("visual-evidence-mode")).toHaveTextContent("Grounded");
    expect(screen.getByTestId("lens-primary-label")).toHaveTextContent("Alternator");
    expect(screen.getByTestId("lens-context-overlay")).toBeInTheDocument();
    expect(screen.getAllByTestId(/lens-part-overlay-/)).toHaveLength(1);
  });

  it("shows an evidence-needed state for low-confidence scans", () => {
    render(
      <VisualEvidenceOverlay
        result={makeResult({
          confidence: "low",
          confidenceRange: { high: 51, low: 28 },
          confirmationNeed: "one_more_angle",
          requiredNextEvidence: ["Second angle", "VIN"],
        })}
        target={TARGET}
      />,
    );

    expect(screen.getByTestId("visual-evidence-layer")).toHaveAttribute("data-visual-mode", "needs_evidence");
    expect(screen.getByTestId("visual-evidence-required")).toHaveTextContent("Second angle / VIN");
  });

  it("uses measure mode when a same-plane reference is required", () => {
    const layer = buildVisualEvidenceLayer(makeResult({
      confirmationNeed: "reference_needed",
      requiredNextEvidence: ["Add same-plane reference"],
    }), TARGET);

    expect(layer.mode).toBe("measure");
    expect(layer.requiredEvidence).toEqual(["Add same-plane reference"]);
  });

  it("marks on-device or backup provider results as estimates", () => {
    render(
      <VisualEvidenceOverlay
        result={makeResult({
          modelRun: {
            fallbackReason: "offline",
            latencyMs: 12,
            model: "local",
            ocrUsed: false,
            provider: "on-device",
          },
        })}
        target={TARGET}
      />,
    );

    expect(screen.getByTestId("visual-evidence-estimate")).toHaveTextContent("estimate");
  });

  it("keeps text evidence as chips instead of fake spatial boxes", () => {
    render(
      <VisualEvidenceOverlay
        result={makeResult({
          evidenceRegions: [
            {
              label: "Pulley",
              observation: "Belt pulley visible near the front.",
              regionLabel: "upper left",
            },
            {
              label: "Housing",
              observation: "Cast housing shape is visible.",
              regionLabel: "center",
            },
          ],
        })}
        target={TARGET}
      />,
    );

    expect(screen.getAllByTestId(/lens-part-overlay-/)).toHaveLength(1);
    expect(screen.getAllByTestId("lens-evidence-chip")).toHaveLength(2);
  });

  it("classifies missing target as blocked without rendering a floating box", () => {
    const layer = buildVisualEvidenceLayer(makeResult(), null);
    const { container } = render(<VisualEvidenceOverlay result={makeResult()} target={null} />);

    expect(layer.mode).toBe("blocked");
    expect(container).toBeEmptyDOMElement();
  });
});

function makeResult(overrides: Partial<IdentificationResult> = {}): IdentificationResult {
  return {
    candidateMatches: [],
    confidence: "high",
    confidenceRange: { high: 90, low: 82 },
    concerns: [],
    evidence: ["Belt-driven pulley and ribbed housing are visible."],
    evidenceRegions: [],
    isSafetyCritical: false,
    needsBetterPhoto: false,
    nextAction: "Confirm with a second angle before ordering parts.",
    partName: "Alternator",
    safetyTriage: "can_help",
    scanCategory: "electrical",
    sourceLinks: [],
    visibleObservations: ["Pulley and housing are visible."],
    whatItDoes: "It charges the battery while the engine runs.",
    ...overrides,
  };
}
