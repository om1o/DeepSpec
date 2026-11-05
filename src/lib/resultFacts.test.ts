import { describe, expect, it } from "vitest";
import { deriveIssue, getAnswerBody, getEvidenceFacts, getSceneChips, getSecondarySceneObjects, isRelevantSceneObject, regionLabelToBox } from "./resultFacts";
import { getSimpleResultSummary } from "./simpleResultSummary";
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
  it.each(["Unknown", "Unknown   component", "Not\nidentified"])("keeps an unresolved identity's visible evidence instead of restoring a successful-match description: %j", (partName) => {
    const result = makeResult({ partName, whatItDoes: "Deep Spec matched the visible item.", visibleObservations: ["Surface rust is visible on the bracket."] });
    const body = getAnswerBody(result, getSimpleResultSummary(result));
    expect(body).toBe("Surface rust is visible on the bracket.");
    expect(body).not.toMatch(/matched|identified/i);
  });

  it("retains the ordinary part explanation when a named candidate also has visible damage", () => {
    const result = makeResult({ visibleObservations: ["Surface rust is visible on the housing."] });
    expect(getAnswerBody(result, getSimpleResultSummary(result))).toBe(result.whatItDoes);
  });

  it("deriveIssue returns null when nothing looks wrong", () => {
    expect(deriveIssue(makeResult())).toBeNull();
  });

  it("deriveIssue locates the same observation using its own supported coarse region", () => {
    const issue = deriveIssue(
      makeResult({
        visibleObservations: ["A dent is visible on the housing."],
        evidenceRegions: [{ label: "Housing", observation: "  A dent is visible on the housing.  ", regionLabel: "upper left" }],
      }),
    );
    expect(issue?.text).toContain("dent");
    expect(issue?.anchor?.x).toBeLessThan(0.34);
    expect(issue?.anchor?.y).toBeLessThan(0.34);
  });

  it("deriveIssue yields a null anchor when no region matches the damage", () => {
    const issue = deriveIssue(makeResult({ visibleObservations: ["Surface rust on the bracket."] }));
    expect(issue?.text).toContain("rust");
    expect(issue?.anchor).toBeNull();
  });

  it("never pairs the first visible issue with another issue's location", () => {
    const issue = deriveIssue(makeResult({
      visibleObservations: ["Surface rust on the bracket.", "An oil stain is visible."],
      evidenceRegions: [{ label: "Oil", observation: "An oil stain is visible.", regionLabel: "lower right" }],
    }));
    expect(issue).toEqual({ text: "Surface rust on the bracket.", anchor: null });
  });

  it("finds matching evidence later in the list without borrowing the first damage location", () => {
    const issue = deriveIssue(makeResult({
      visibleObservations: ["Surface rust on the bracket."],
      evidenceRegions: [
        { label: "Oil", observation: "An oil stain is visible.", regionLabel: "lower right" },
        { label: "Bracket", observation: "Surface rust on the bracket.", regionLabel: "upper left" },
      ],
    }));
    expect(issue?.anchor).toEqual(regionLabelToBox("upper left"));
  });

  it("keeps a paraphrased observation unlocated rather than inferring that similar damage words identify the same area", () => {
    expect(deriveIssue(makeResult({ visibleObservations: ["A dent is visible on the housing."],
      evidenceRegions: [{ label: "Housing", observation: "Dent on the housing.", regionLabel: "upper left" }],
    }))?.anchor).toBeNull();
  });

  it("uses both the text and location of a region when there is no visible-observation damage sentence", () => {
    expect(deriveIssue(makeResult({ evidenceRegions: [{ label: "Housing", observation: "Cracked housing.", regionLabel: "right side" }] })))
      .toEqual({ text: "Cracked housing.", anchor: regionLabelToBox("right side") });
  });

  it.each(["lower right", "Scanned area", "upper left or lower right"])("keeps duplicate observation evidence unlocated when locations disagree or are unresolved: %s", (secondRegion) => {
    expect(deriveIssue(makeResult({ visibleObservations: ["Surface rust on the bracket."], evidenceRegions: [
      { label: "Bracket", observation: "Surface rust on the bracket.", regionLabel: "upper left" },
      { label: "Bracket", observation: "Surface rust on the bracket.", regionLabel: secondRegion },
    ] }))?.anchor).toBeNull();
  });

  it("permits duplicate evidence only when both refer to the same supported coarse area", () => {
    expect(deriveIssue(makeResult({ visibleObservations: ["Surface rust on the bracket."], evidenceRegions: [
      { label: "Bracket", observation: "Surface rust on the bracket.", regionLabel: "upper left" },
      { label: "Bracket", observation: "SURFACE RUST ON THE BRACKET.", regionLabel: "top-left" },
    ] }))?.anchor).toEqual(regionLabelToBox("upper left"));
  });

  it("does not turn a hypothetical concern into an observed damage headline", () => {
    expect(deriveIssue(makeResult({ concerns: ["Possible overheating damage or hidden corrosion."] }))).toBeNull();
    expect(deriveIssue(makeResult({
      concerns: ["Possible overheating caused a crack."],
      visibleObservations: ["Surface rust is visible on the bracket."],
    }))?.text).toBe("Surface rust is visible on the bracket.");
  });

  it("regionLabelToBox maps coarse labels and rejects unknown ones", () => {
    expect(regionLabelToBox("center")).not.toBeNull();
    expect(regionLabelToBox("lower right")?.x).toBeGreaterThan(0.5);
    expect(regionLabelToBox("Scanned area")).toBeNull();
  });

  it.each(["upper left or lower right", "left and right", "not upper left", "upper lower left", "center of the hose on the right", "possibly left", "outside upper left", "lower-right/top-left", "Scanned area", ""])("does not fabricate a location from an ambiguous or unsupported description: %s", (label) => {
    expect(regionLabelToBox(label)).toBeNull();
    expect(deriveIssue(makeResult({ visibleObservations: ["Cracked housing."], evidenceRegions: [{ label: "Housing", observation: "Cracked housing.", regionLabel: label }] }))?.anchor).toBeNull();
  });

  it("keeps an unspecified axis broad instead of inventing a point at its middle", () => {
    expect(regionLabelToBox("right side")).toMatchObject({ x: 2 / 3, y: 0, width: 1 / 3, height: 1 });
    expect(regionLabelToBox("top")).toMatchObject({ x: 0, y: 0, width: 1, height: 1 / 3 });
    expect(regionLabelToBox("lower right corner")).toMatchObject({ x: 2 / 3, y: 2 / 3, width: 1 / 3, height: 1 / 3 });
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

    // [name, category, kept?] — the probe table from the category-filter review.
    const KEEP = true;
    const DROP = false;
    const cases: Record<string, [string, string, boolean][]> = {
      // Furniture/room/decor words are modifiers in these names, not what the object is.
      "tools whose names contain a furniture/room word": [
        ["Floor jack", "tool", KEEP], ["Bottle jack", "tool", KEEP], ["Table saw", "tool", KEEP],
        ["Bench grinder", "tool", KEEP], ["Bench vise", "tool", KEEP], ["Shop towel", "tool", KEEP],
        ["Tool cabinet", "tool", KEEP], ["Tool chest drawer", "tool", KEEP], ["Creeper board", "tool", KEEP],
        ["Wall charger", "electronics", KEEP], ["Desk lamp", "electronics", KEEP], ["Face shield", "tool", KEEP],
        ["Shop light on stand", "tool", KEEP], ["Magnetic parts tray on floor", "tool", KEEP],
        ["Phone on table", "electronics", KEEP], ["Laptop on desk", "electronics", KEEP],
      ],
      "car parts whose names contain a furniture/room word": [
        ["Side mirror", "part", KEEP], ["Rearview mirror", "part", KEEP], ["Brake shoe", "part", KEEP],
        ["Skid plate", "part", KEEP], ["Pressure plate", "part", KEEP], ["License plate", "part", KEEP],
        ["Clock spring", "part", KEEP], ["Water jacket", "part", KEEP], ["Truck bed", "part", KEEP],
        ["Floor pan", "part", KEEP], ["Floor mat", "part", KEEP], ["Seat cushion", "part", KEEP],
        ["Cup holder", "part", KEEP], ["Coolant reservoir bottle", "part", KEEP], ["Overflow bottle", "part", KEEP],
        ["Glove box", "part", KEEP], ["Cabin air filter", "part", KEEP], ["Door panel", "part", KEEP],
        ["Hood", "body part", KEEP], ["Wheel", "part", KEEP], ["Tire", "part", KEEP], ["Headlight", "part", KEEP],
        ["Bumper", "part", KEEP], ["Fender", "part", KEEP], ["Windshield", "part", KEEP],
        ["Engine cover", "part", KEEP], ["Dipstick", "part", KEEP], ["Exhaust manifold", "part", KEEP],
      ],
      "car parts and tools named with a body-part word": [
        ["Control arm", "part", KEEP], ["Rocker arm", "part", KEEP], ["Wiper arm", "part", KEEP],
        ["Hand brake lever", "part", KEEP], ["Hand brake", "brakes", KEEP], ["Hand tools", "tools", KEEP],      ],
      "plural names and categories": [
        ["Wrenches", "tools", KEEP], ["Screwdrivers", "tools", KEEP], ["Sockets", "tools", KEEP],
        ["Pliers", "tools", KEEP], ["Hoses", "parts", KEEP], ["Bolts", "parts", KEEP], ["Belts", "parts", KEEP],
        ["Spark plugs", "parts", KEEP], ["Cables", "electronics", KEEP], ["Wires", "electrical parts", KEEP],
        ["Fuses", "parts", KEEP], ["Clamps", "tools", KEEP], ["Hammers", "tools", KEEP],
        ["Knives", "tools", KEEP], ["Batteries", "parts", KEEP],
      ],
      "car-part categories in any casing": [
        ["Hood", "Body", KEEP], ["Hood", "body", KEEP], ["Radiator hose", "Engine", KEEP],
        ["Thing", "Engine", KEEP], ["Thing", "engine", KEEP], ["Thing", " BRAKES ", KEEP],
      ],
      "people, body parts, furniture, room, decor, animals": [
        ["Man", "person", DROP], ["Person", "person", DROP], ["People", "people", DROP],
        ["Mechanic", "person", DROP], ["Person holding phone", "person", DROP], ["Kids", "people", DROP],
        ["Person's hand", "hand", DROP], ["Hand", "hand", DROP], ["Hand holding wrench", "hand", DROP],
        ["Fingers", "hand", DROP], ["Arm", "unknown", DROP], ["Woman holding wrench", "tool", DROP],
        // "body part" is the anatomical sense, so it doesn't vouch for a body-part word.
        ["Hand", "body part", DROP], ["Human hand", "Body Parts", DROP], ["Finger", "body-part", DROP],
        ["Chairs", "furniture", DROP], ["Couch", "furniture", DROP], ["Desk", "furniture", DROP],
        ["Workbench", "furniture", DROP], ["Shelving unit", "furniture", DROP], ["Poster", "decor", DROP],
        ["Posters", "decor", DROP], ["Potted plants", "decor", DROP], ["Coffee mug", "kitchen", DROP],
        ["Dog", "animal", DROP],
      ],
      // These names contain an allow word; the non-target category is what drops them.
      "household items with a part-like name": [
        ["Baseball cap", "clothing", DROP], ["Belt", "clothing", DROP], ["Cutting board", "kitchen", DROP],
        ["Kitchen knife", "kitchen", DROP], ["Light switch", "home", DROP], ["Level", "home", DROP],
        ["Nail file", "personal", DROP], ["Spring onion", "food", DROP], ["Picture frame on shelf", "decor", DROP],
        ["TV screen", "electronics", KEEP],
      ],
    };
    for (const [group, rows] of Object.entries(cases)) {
      it.each(rows)(`${group}: %s / %s → kept=%s`, (name, category, kept) => {
        expect(isRelevantSceneObject(obj(name, category))).toBe(kept);
      });
    }
  });
});
