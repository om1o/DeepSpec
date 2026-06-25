import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { IssueLine, ResultDetailSections } from "./PositiveAnswerCard";
import { getAnswerBody } from "../../lib/resultFacts";
import { getSimpleResultSummary } from "../../lib/simpleResultSummary";
import type { IdentificationResult } from "../../types";

function makeResult(overrides: Partial<IdentificationResult> = {}): IdentificationResult {
  return {
    partName: "Alternator",
    confidence: "high",
    scanCategory: "electrical",
    candidateMatches: [],
    whatItDoes: "It charges the battery while the engine runs.",
    visibleObservations: ["Belt-driven metal housing is visible."],
    evidenceRegions: [],
    concerns: [],
    safetyTriage: "can_help",
    isSafetyCritical: false,
    nextAction: "Compare with the vehicle context.",
    needsBetterPhoto: false,
    evidence: [],
    sourceLinks: [],
    ...overrides,
  };
}

describe("PositiveAnswerCard pieces", () => {
  it("IssueLine renders the damage sentence when present", () => {
    render(<IssueLine result={makeResult({ concerns: ["A dent on the door."] })} variant="result" />);
    expect(screen.getByTestId("visible-issue-line")).toHaveTextContent("dent");
  });

  it("IssueLine renders nothing when everything looks fine", () => {
    const { container } = render(<IssueLine result={makeResult()} variant="result" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("getAnswerBody names the function when there is an issue, otherwise the summary body", () => {
    const withIssue = makeResult({ concerns: ["Crack in the case."], whatItDoes: "It powers the cooling fan." });
    expect(getAnswerBody(withIssue, getSimpleResultSummary(withIssue))).toBe("It powers the cooling fan.");

    const clean = makeResult();
    expect(getAnswerBody(clean, getSimpleResultSummary(clean))).toBe(getSimpleResultSummary(clean).body);
  });

  it("ResultDetailSections lists facts and never shows a percentage", () => {
    const { container } = render(
      <ResultDetailSections
        result={makeResult({ visibleObservations: ["Vented metal housing."], evidence: ["Pulley shape matches."] })}
        variant="result"
      />,
    );
    expect(screen.getByText("What we see")).toBeInTheDocument();
    expect(screen.getByText("Vented metal housing.")).toBeInTheDocument();
    expect(screen.getByText("Match clues")).toBeInTheDocument();
    expect(container.textContent ?? "").not.toMatch(/%/);
  });

  it("ResultDetailSections renders nothing when there is no detail to show", () => {
    const { container } = render(
      <ResultDetailSections
        result={makeResult({ visibleObservations: [], evidence: [], evidenceRegions: [], concerns: [], nextAction: "" })}
        variant="result"
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
