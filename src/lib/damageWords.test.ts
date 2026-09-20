import { describe, expect, it } from "vitest";
import { describesVisibleDamage } from "./damageWords";
import { getSimpleResultSummary } from "./simpleResultSummary";
import { deriveIssue } from "./resultFacts";
import type { IdentificationResult } from "../types";

describe("describesVisibleDamage", () => {
  it.each([
    "Cracked locking tab on the connector.",
    "Hairline cracks along the housing.",
    "The bumper is dented.",
    "Deep scratches on the cover.",
    "Oil is leaking from the gasket.",
    "Coolant leaks at the hose clamp.",
    "Rusted bracket bolts.",
    "Heavy corroded terminals.",
    "Chipped paint on the edge.",
    "Worn brake pads.",
    "Frayed serpentine belt.",
    "Bent mounting bracket.",
    "Torn CV boot.",
    "A dent is visible on the housing.",
    "Surface rust on the bracket.",
    // A negation doesn't reach past a clause break, and one un-negated word is enough.
    "No leaks, but a crack is visible near the mount.",
    "Minor rust on the bracket, no leaks.",
  ])("flags damage: %s", (text) => {
    expect(describesVisibleDamage(text)).toBe(true);
  });

  it.each([
    "No visible damage.",
    "No leaks, cracks, or corrosion visible.",
    "Shows no signs of rust.",
    "The housing does not appear damaged.",
    "The housing doesn't look damaged.",
    "Nothing appears missing.",
    "Clean connector without corrosion.",
    "The ECU chip is visible on the board.",
    "Stain-resistant coating label.",
    "Rust-colored primer on the bracket.",
    "Belt-driven metal housing is visible.",
  ])("does not flag: %s", (text) => {
    expect(describesVisibleDamage(text)).toBe(false);
  });
});

describe("damage detection in the result summary and issue pointer", () => {
  const result = (visibleObservations: string[]): IdentificationResult => ({
    partName: "Alternator",
    confidence: "high",
    scanCategory: "electrical",
    candidateMatches: [],
    whatItDoes: "It charges the battery while the engine runs.",
    visibleObservations,
    evidenceRegions: [],
    concerns: [],
    safetyTriage: "can_help",
    isSafetyCritical: false,
    nextAction: "Compare with the vehicle context.",
    needsBetterPhoto: false,
    evidence: [],
    sourceLinks: [],
  });

  it("doesn't label a clean part a 'Visible issue' because it says 'No visible damage'", () => {
    const clean = result(["No visible damage.", "Belt-driven metal housing is visible."]);
    expect(getSimpleResultSummary(clean).eyebrow).toBe("Best match");
    expect(deriveIssue(clean)).toBeNull();
  });

  it("labels an inflected damage report a 'Visible issue' in both places", () => {
    const cracked = result(["Cracked locking tab on the connector."]);
    expect(getSimpleResultSummary(cracked).eyebrow).toBe("Visible issue");
    expect(deriveIssue(cracked)?.text).toContain("Cracked");
  });
});
