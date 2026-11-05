import { describe, expect, it } from "vitest";

import { getSimpleResultSummary } from "./simpleResultSummary";
import type { IdentificationResult } from "../types";

function makeResult(partName: string): IdentificationResult {
  return {
    partName,
    confidence: "medium",
    scanCategory: "unknown",
    candidateMatches: [],
    whatItDoes: "Deep Spec matched the visible item.",
    visibleObservations: ["The item is visible in the photo."],
    evidenceRegions: [],
    concerns: [],
    safetyTriage: "can_help",
    isSafetyCritical: false,
    nextAction: "",
    needsBetterPhoto: false,
    evidence: [],
    sourceLinks: [],
  };
}

describe("getSimpleResultSummary", () => {
  it.each(["Unknown object", "Unknown component", "Unknown   component", "Unknown\nobject", "Unidentified", "Not a vehicle part", "Unknown", "Unknown part", "Unknown item", "Not identified", "  Not\n identified  ", "", "   "])("labels an unresolved identity honestly: %j", (name) => {
    const summary = getSimpleResultSummary(makeResult(name));
    expect(summary.eyebrow).toBe("Identity unresolved");
    expect(summary.title).toBe("Identity unresolved");
    expect(summary.body).toBe("The item is visible in the photo.");
    expect(summary.nextAction).toBe("Use a closer photo of the part.");
    expect(summary.body).not.toMatch(/matched|identified/i);
  });

  it("keeps visible damage and the complete safety action without turning an unresolved identity into a match", () => {
    const result = makeResult("Unknown component");
    result.visibleObservations = ["A crack-like line is visible."];
    result.isSafetyCritical = true;
    result.nextAction = "Do not drive. Have the mounting checked before further use.";
    expect(getSimpleResultSummary(result)).toMatchObject({ eyebrow: "Identity unresolved", title: "Identity unresolved", body: "A crack-like line is visible.", nextAction: result.nextAction });
  });

  it("does not manufacture an identity or successful-match description from an empty result", () => {
    const result = makeResult(""); result.visibleObservations = []; result.whatItDoes = "";
    expect(getSimpleResultSummary(result).body).toBe("The available evidence does not establish the item's identity.");
  });

  it("keeps an uncertain identification qualified in the heading", () => {
    const summary = getSimpleResultSummary(makeResult("Likely alternator"));

    expect(summary.title).toBe("Likely alternator");
  });

  it.each(["Unknown manufacturer alternator", "Unknown-brand alternator", "Part number not identified on alternator"])("does not mistake a named candidate for an exact placeholder: %s", (name) => {
    expect(getSimpleResultSummary(makeResult(name))).toMatchObject({ title: name, eyebrow: "Best match" });
  });

  it("does not promote a hypothetical concern into a visible issue", () => {
    const result = makeResult("Bracket");
    result.concerns = ["Hidden corrosion could weaken the mounting."];
    expect(getSimpleResultSummary(result)).toMatchObject({ eyebrow: "Best match", body: result.whatItDoes });
  });

  it("describes the visible surface evidence without replacing it with a possible cause", () => {
    const result = makeResult("Brake rotor");
    result.visibleObservations = ["Surface rust is visible on the outer edge."];
    result.concerns = ["Possible structural weakening from corrosion."];
    expect(getSimpleResultSummary(result)).toMatchObject({ eyebrow: "Visible issue", body: result.visibleObservations[0] });
  });

  it("retains the entire specific safety action even when no better photo is needed", () => {
    const result = makeResult("Brake mounting bracket");
    result.isSafetyCritical = true;
    result.safetyTriage = "needs_professional";
    result.nextAction = "Do not drive until the mounting bracket has been checked. A qualified technician should inspect the apparent crack and the mounting points before deciding whether the assembly can be reused.";
    expect(getSimpleResultSummary(result).nextAction).toBe(result.nextAction);
  });
});
