import { describe, expect, it } from "vitest";
import { deriveIssue, getEvidenceFacts, regionLabelToBox } from "./resultFacts";
import type { IdentificationResult } from "../types";

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

describe("resultFacts", () => {
  it("deriveIssue returns null when nothing looks wrong", () => {
    expect(deriveIssue(makeResult())).toBeNull();
  });

  it("deriveIssue surfaces a damage sentence with an upper-left anchor from the region label", () => {
    const issue = deriveIssue(
      makeResult({
        concerns: ["A dent is visible on the housing."],
        evidenceRegions: [{ label: "Housing", observation: "Dent on the housing.", regionLabel: "upper left" }],
      }),
    );
    expect(issue?.text).toContain("dent");
    expect(issue?.anchor?.x).toBeLessThan(0.34);
    expect(issue?.anchor?.y).toBeLessThan(0.34);
  });

  it("deriveIssue yields a null anchor when no region matches the damage", () => {
    const issue = deriveIssue(makeResult({ concerns: ["Surface rust on the bracket."] }));
    expect(issue?.text).toContain("rust");
    expect(issue?.anchor).toBeNull();
  });

  it("regionLabelToBox maps coarse labels and rejects unknown ones", () => {
    expect(regionLabelToBox("center")).not.toBeNull();
    expect(regionLabelToBox("lower right")?.x).toBeGreaterThan(0.5);
    expect(regionLabelToBox("Scanned area")).toBeNull();
  });

  it("getEvidenceFacts hides internal provenance strings", () => {
    const facts = getEvidenceFacts(
      makeResult({
        evidence: ["Pulley shape matches.", "OCR label text: DENSO 123", "Dataset source: https://example.com"],
      }),
      false,
    );
    expect(facts).toContain("Pulley shape matches.");
    expect(facts.some((fact) => /OCR label text/i.test(fact))).toBe(false);
    expect(facts.some((fact) => /Dataset source/i.test(fact))).toBe(false);
  });
});
