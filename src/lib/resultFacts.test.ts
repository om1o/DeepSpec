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
