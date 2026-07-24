import { describe, expect, it } from "vitest";
import { deriveIssue, getEvidenceFacts, getSceneChips, getSecondarySceneObjects, isRelevantSceneObject, regionLabelToBox } from "./resultFacts";
import type { SceneObject } from "../types";
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

  it("getSecondarySceneObjects keeps only named, non-primary, relevant objects", () => {
    const others = getSecondarySceneObjects(
      makeResult({
        sceneObjects: [
          { name: "Engine", category: "engine", regionLabel: "center", primary: true },        // primary → dropped
          { name: "Torque wrench", category: "tool", regionLabel: "left side", primary: false }, // relevant → kept
          { name: "Band poster", category: "poster", regionLabel: "top", primary: false },        // irrelevant → dropped
          { name: "", category: "tool", regionLabel: "right side", primary: false },              // unnamed → dropped
        ],
      }),
    );
    expect(others).toHaveLength(1);
    expect(others[0].name).toBe("Torque wrench");
  });

  it("getSceneChips places only secondary objects that are relevant and have a usable region", () => {
    const chips = getSceneChips(
      makeResult({
        sceneObjects: [
          { name: "Engine", category: "engine", regionLabel: "center", primary: true },
          { name: "Diagnostic scanner", category: "tool", regionLabel: "upper left", primary: false }, // relevant + region → chip
          { name: "Socket set", category: "tool", regionLabel: "somewhere", primary: false },           // relevant, no region → dropped
          { name: "Wall poster", category: "decor", regionLabel: "upper right", primary: false },        // irrelevant → dropped
        ],
      }),
    );
    expect(chips).toHaveLength(1);
    expect(chips[0].object.name).toBe("Diagnostic scanner");
    expect(chips[0].box.x).toBeLessThan(0.34);
  });

  describe("isRelevantSceneObject", () => {
    const obj = (name: string, category: string): SceneObject => ({ name, category, regionLabel: "center", primary: false });

    it("keeps tools, tech/electronics, and car parts", () => {
      expect(isRelevantSceneObject(obj("Torque wrench", "tool"))).toBe(true);
      expect(isRelevantSceneObject(obj("Remote control", "remote"))).toBe(true);
      expect(isRelevantSceneObject(obj("Xbox controller", "electronics"))).toBe(true);
      expect(isRelevantSceneObject(obj("Brake caliper", "unknown"))).toBe(true); // allow-word in name
      expect(isRelevantSceneObject(obj("Some part", "brakes"))).toBe(true);      // real SCAN_CATEGORY
    });

    it("drops people, furniture, and room/environment", () => {
      expect(isRelevantSceneObject(obj("boy", "person"))).toBe(false);
      expect(isRelevantSceneObject(obj("Leather couch", "furniture"))).toBe(false);
      expect(isRelevantSceneObject(obj("Wall poster", "decor"))).toBe(false);
      expect(isRelevantSceneObject(obj("Potted plant", "unknown"))).toBe(false);
    });

    it("matches whole words only, so 'manifold' is not blocked as the person-word 'man'", () => {
      expect(isRelevantSceneObject(obj("Exhaust manifold", "part"))).toBe(true); // 'man' must not block 'manifold'
    });

    it("drops an unclassified object that matches neither block nor allow list", () => {
      expect(isRelevantSceneObject(obj("Mystery blob", "unknown"))).toBe(false);
    });
  });
});
