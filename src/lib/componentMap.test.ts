import { describe, expect, it } from "vitest";
import type { Lookup } from "../types";
import type { ComponentCaptureTarget, ComponentMap, ComponentMapRecord } from "../types/componentMap";
import { componentCaptureTargetsMatch, createMapComponent, linkComponentMapDocument, normalizeComponentCaptureTarget, normalizeComponentMap, normalizeComponentMapRecord, reviewMapComponent, seedMapFromLookup } from "./componentMap";

const componentId = "10000000-0000-4000-8000-000000000001";
const linkId = "20000000-0000-4000-8000-000000000001";
const box = { x: 0.1, y: 0.2, width: 0.3, height: 0.4, confidence: 0.8 };
const now = "2026-11-05T09:00:00.000Z";
const map = (): ComponentMap => ({ version: 1, id: "overview-lookup", overview: { lookupId: "overview-lookup", photoId: "overview-photo" },
  components: [{ id: componentId, label: "Alternator", status: "needs_view", notes: "", scanGroups: [] }] });
const target = (): ComponentCaptureTarget => ({ mapId: "overview-lookup", componentId, linkAttemptId: linkId, lookupId: "detail-lookup" });
const record = (): ComponentMapRecord => ({ document: map(), localRevision: 1, cloudRevision: null, syncedLocalRevision: 0 });
const lookup = (): Lookup => ({ id: "overview-lookup", createdAt: now, frame: { imageBase64: "data:image/jpeg;base64,AA==", capturedAt: now },
  rating: null, correction: null, notes: "", scanCategory: "engine", trainingLabel: "Engine bay", trainingStatus: "user_confirmed", chatHistory: [],
  provenance: { captureMode: "camera", analysisSource: "ai_detection", savedAt: now } });

describe("component map validation", () => {
  it("retains unknown locations without inventing geometry and strips unrelated fields", () => {
    const input = { ...map(), unrelated: "discard", components: [{ ...map().components[0], label: " Alternator ", confidence: "confirmed" }] };
    const result = normalizeComponentMap(input)!;
    expect(result).toEqual(map());
    expect(result.components[0].region).toBeUndefined();
    expect(result.components[0].reviewedAt).toBeUndefined();
  });

  it("allows 100 independently identified components but rejects the entire 101st entry", () => {
    const input = map();
    input.components = Array.from({ length: 100 }, (_, index) => ({ ...input.components[0], id: `10000000-0000-4000-8000-${String(index).padStart(12, "0")}` }));
    expect(normalizeComponentMap(input)?.components).toHaveLength(100);
    input.components.push({ ...input.components[0], id: "10000000-0000-4000-8000-000000000101" });
    expect(normalizeComponentMap(input)).toBeUndefined();
    expect(input.components).toHaveLength(101);
    expect(normalizeComponentMap({ ...map(), components: [] })?.components).toEqual([]);
  });

  it.each([
    { name: "wrong map identity", value: { ...map(), id: "different-lookup" } },
    { name: "string version", value: { ...map(), version: "1" } },
    { name: "duplicate component", value: { ...map(), components: [...map().components, ...map().components] } },
    { name: "bad component ID", value: { ...map(), components: [{ ...map().components[0], id: "temporary-index-0" }] } },
    { name: "empty label", value: { ...map(), components: [{ ...map().components[0], label: " " }] } },
    { name: "overlong notes", value: { ...map(), components: [{ ...map().components[0], notes: "x".repeat(2001) }] } },
    { name: "automatic inspected", value: { ...map(), components: [{ ...map().components[0], status: "inspected" }] } },
    { name: "invalid review date", value: { ...map(), components: [{ ...map().components[0], status: "not_visible", reviewedAt: "2026-02-31T09:00:00Z" }] } },
    { name: "other photo region", value: { ...map(), components: [{ ...map().components[0], region: { sourcePhotoId: "other-photo", box } }] } },
    { name: "out-of-frame box", value: { ...map(), components: [{ ...map().components[0], region: { sourcePhotoId: "overview-photo", box: { ...box, x: 0.9 } } }] } },
    { name: "nonfinite box", value: { ...map(), components: [{ ...map().components[0], region: { sourcePhotoId: "overview-photo", box: { ...box, confidence: NaN } } }] } },
  ])("rejects $name without dropping just the invalid component", ({ value }) => {
    expect(normalizeComponentMap(value)).toBeUndefined();
  });

  it("requires valid photo groups and globally unique link attempts", () => {
    const linked = linkComponentMapDocument(map(), target(), ["photo-1", "photo-2"]);
    expect(normalizeComponentMap(linked)).toEqual(linked);
    for (const photoIds of [[], ["photo-1", "photo-1"], ["bad photo"], ["p1", "p2", "p3", "p4", "p5"]]) {
      const invalid = structuredClone(linked);
      invalid.components[0].scanGroups[0].photoIds = photoIds;
      expect(normalizeComponentMap(invalid)).toBeUndefined();
    }
    const duplicate = structuredClone(linked);
    duplicate.components.push({ ...duplicate.components[0], id: "10000000-0000-4000-8000-000000000002" });
    expect(normalizeComponentMap(duplicate)).toBeUndefined();
  });
});

describe("seeding and explicit review", () => {
  it("creates stable independent IDs and changes status only on explicit human review", () => {
    const component = createMapComponent("Radiator");
    const other = createMapComponent("Radiator");
    expect(component.id).not.toBe(other.id);
    expect(component).toMatchObject({ status: "needs_view", scanGroups: [], notes: "" });
    expect(component.reviewedAt).toBeUndefined();
    const reviewed = reviewMapComponent(component, "not_visible", "Covered by trim", now);
    expect(reviewed).toMatchObject({ id: component.id, status: "not_visible", reviewedAt: now, notes: "Covered by trim" });
    expect(component.status).toBe("needs_view");
  });

  it("merges more than four scene suggestions without treating a text region as a measured box", () => {
    const input = lookup();
    input.photos = [{ id: "actual-overview", label: "overview", ...input.frame }];
    input.isolatedObjects = [
      { name: "Alternator", category: "electrical", primary: true, focusBox: box, isolatedImageBase64: "" },
      { name: "Hose", category: "engine", primary: false, focusBox: { ...box, x: 0.5 }, isolatedImageBase64: "" },
    ];
    input.focusBox = { ...box, confidence: 0.9 };
    input.result = { partName: "Alternator", sceneObjects: ["Alternator", "Hose", "Battery", "Oil cap", "Radiator", "Air box"].map((name) => ({ name, category: "engine", regionLabel: "upper left", primary: false })) } as Lookup["result"];
    const seeded = seedMapFromLookup(input);
    expect(seeded.overview.photoId).toBe("actual-overview");
    expect(seeded.components.map((item) => item.label)).toEqual(["Alternator", "Hose", "Battery", "Oil cap", "Radiator", "Air box"]);
    expect(seeded.components.every((item) => item.status === "needs_view" && item.reviewedAt === undefined)).toBe(true);
    expect(seeded.components[0].region).toEqual({ sourcePhotoId: "actual-overview", box });
    expect(seeded.components.slice(2).every((item) => item.region === undefined)).toBe(true);
  });

  it("keeps different existing boxes for same-named parts and uses photo-1 only for a legacy original", () => {
    const input = lookup();
    input.isolatedObjects = [box, { ...box, x: 0.5 }].map((focusBox) => ({ name: "Hose", category: "engine", primary: false, focusBox, isolatedImageBase64: "" }));
    const seeded = seedMapFromLookup(input);
    expect(seeded.overview.photoId).toBe("photo-1");
    expect(seeded.components).toHaveLength(2);
    expect(new Set(seeded.components.map((item) => item.id)).size).toBe(2);
  });
});

describe("capture linking", () => {
  it("links a photo group once without marking the component inspected or mutating its source map", () => {
    const original = map();
    const linked = linkComponentMapDocument(original, target(), ["photo-1", "photo-2"]);
    expect(original.components[0].scanGroups).toEqual([]);
    expect(linked.components[0]).toMatchObject({ id: componentId, status: "needs_view", scanGroups: [{ linkId, lookupId: "detail-lookup", photoIds: ["photo-1", "photo-2"] }] });
    expect(linked.components[0].reviewedAt).toBeUndefined();
    expect(linkComponentMapDocument(linked, target(), ["photo-1", "photo-2"])).toEqual(linked);
  });

  it("rejects a replay with changed evidence and a deleted target, preserving every old link", () => {
    const linked = linkComponentMapDocument(map(), target(), ["photo-1"]);
    expect(() => linkComponentMapDocument(linked, { ...target(), lookupId: "replacement" }, ["photo-1"])).toThrow(/already linked/);
    expect(() => linkComponentMapDocument(linked, target(), ["photo-2"])).toThrow(/already linked/);
    expect(() => linkComponentMapDocument({ ...linked, components: [] }, target(), ["photo-1"])).toThrow(/removed/);
    expect(linked.components[0].scanGroups[0].photoIds).toEqual(["photo-1"]);
  });

  it("retains human review and notes when another photo group is linked", () => {
    const original = map();
    original.components[0] = reviewMapComponent(original.components[0], "inspected", "I checked the mounting bolt", now);
    expect(linkComponentMapDocument(original, target(), ["photo-1"]).components[0]).toMatchObject({ status: "inspected", reviewedAt: now, notes: "I checked the mounting bolt" });
  });

  it("validates and compares the entire capture target without accepting a partial target", () => {
    expect(normalizeComponentCaptureTarget({ ...target(), ignored: "value" })).toEqual(target());
    expect(normalizeComponentCaptureTarget({ ...target(), componentId: "index-0" })).toBeNull();
    expect(normalizeComponentCaptureTarget({ ...target(), lookupId: undefined })).toBeNull();
    expect(componentCaptureTargetsMatch(target(), { ...target() })).toBe(true);
    expect(componentCaptureTargetsMatch(target(), { ...target(), lookupId: "other-lookup" })).toBe(false);
  });
});

describe("local sync metadata validation", () => {
  it("retains a newer local revision while an older immutable upload attempt is in flight", () => {
    const input: ComponentMapRecord = { ...record(), localRevision: 3, cloudRevision: 7, syncedLocalRevision: 1,
      syncAttempt: { id: linkId, localRevision: 2, startedAt: now }, conflict: { document: map(), revision: 8 } };
    expect(normalizeComponentMapRecord(input)).toEqual(input);
  });

  it.each([
    { ...record(), localRevision: 0 },
    { ...record(), localRevision: 1.5 },
    { ...record(), syncedLocalRevision: 2 },
    { ...record(), cloudRevision: null, syncedLocalRevision: 1 },
    { ...record(), syncAttempt: { id: linkId, localRevision: 2, startedAt: now } },
    { ...record(), conflict: { document: { ...map(), overview: { ...map().overview, photoId: "other-photo" } }, revision: 1 } },
  ])("rejects inconsistent revision/reference metadata %#", (input) => {
    expect(normalizeComponentMapRecord(input)).toBeUndefined();
  });
});
