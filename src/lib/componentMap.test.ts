import { describe, expect, it } from "vitest";
import type { Lookup } from "../types";
import type { ComponentCaptureTarget, ComponentMap, ComponentMapRecord, MapOverviewSource } from "../types/componentMap";
import { MAX_SUGGESTED_LOCATION_LENGTH, componentCaptureTargetsMatch, createMapComponent, linkComponentMapDocument, mapOverviewSourcesMatch, normalizeComponentCaptureTarget, normalizeComponentMap, normalizeComponentMapRecord, normalizeMapOverviewSource, reviewMapComponent, seedMapFromLookup } from "./componentMap";

const componentId = "10000000-0000-4000-8000-000000000001";
const linkId = "20000000-0000-4000-8000-000000000001";
const box = { x: 0.1, y: 0.2, width: 0.3, height: 0.4, confidence: 0.8 };
const now = "2026-11-05T09:00:00.000Z";
const source = (): MapOverviewSource => ({ sha256: "a".repeat(64), width: 720, height: 420, photoAddedAt: now, scanSavedAt: now });
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

  it("retains v2 AI location provenance separately from human notes and review", () => {
    const input = { ...map(), version: 2, components: [{ ...reviewMapComponent(map().components[0], "inspected", "I checked the bolt", now),
      suggestedLocation: { source: "ai_scene", text: "  behind the left bracket  " } }] };
    const normalized = normalizeComponentMap(input)!;
    expect(normalized.version).toBe(2);
    expect(normalized.components[0]).toMatchObject({ id: componentId, notes: "I checked the bolt", status: "inspected", reviewedAt: now,
      suggestedLocation: { source: "ai_scene", text: "behind the left bracket" } });
    expect(normalized.components[0].region).toBeUndefined();
    expect(input.components[0].suggestedLocation.text).toBe("  behind the left bracket  ");
    expect(normalizeComponentMap(map())?.version).toBe(1);
    expect(normalizeComponentMap({ ...map(), version: 2 })?.version).toBe(2);
    expect(normalizeComponentMap({ ...map(), version: 3 })).toBeUndefined();
  });

  it.each([undefined, null, { source: "ai_scene", text: "left" }])("rejects v1 location metadata presence, even %#", (suggestedLocation) => {
    expect(normalizeComponentMap({ ...map(), components: [{ ...map().components[0], suggestedLocation }] })).toBeUndefined();
  });

  it.each([
    null, [], "left", { source: "human", text: "left" }, { source: "ai_scene", text: "  " },
    { source: "ai_scene", text: 12 }, { source: "ai_scene", text: "left", confidence: 0.9 },
    { source: "ai_scene", text: "x".repeat(241) },
  ])("rejects the whole v2 map for malformed suggested location %#", (suggestedLocation) => {
    const input = { ...map(), version: 2, components: [{ ...map().components[0], suggestedLocation }] };
    expect(normalizeComponentMap(input)).toBeUndefined();
    expect(input.components).toHaveLength(1);
  });

  it("uses the agreed 240 Unicode-code-point limit without truncation", () => {
    expect(MAX_SUGGESTED_LOCATION_LENGTH).toBe(240);
    const withText = (text: string) => ({ ...map(), version: 2, components: [{ ...map().components[0], suggestedLocation: { source: "ai_scene", text } }] });
    const text = "🔧".repeat(240);
    expect(normalizeComponentMap(withText(` ${text} `))?.components[0].suggestedLocation?.text).toBe(text);
    expect(normalizeComponentMap(withText(`${text}🔧`))).toBeUndefined();
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

describe("bound map overview source", () => {
  it("preserves the exact source, human work and location hints through a v3 document round-trip", () => {
    const input: ComponentMap = { ...map(), version: 3, overview: { ...map().overview, source: source() } };
    input.components[0] = { ...reviewMapComponent(input.components[0], "inspected", "User review remains separate", now),
      suggestedLocation: { source: "ai_scene", text: "left side" }, region: { sourcePhotoId: input.overview.photoId, box } };
    expect(normalizeComponentMap(JSON.parse(JSON.stringify(input)))).toEqual(input);
    expect(normalizeMapOverviewSource(source())).toEqual(source());
    expect(mapOverviewSourcesMatch(source(), { ...source() })).toBe(true);
    expect(mapOverviewSourcesMatch(undefined, undefined)).toBe(false);
  });

  it.each([
    null, {}, { ...source(), extra: true }, { ...source(), sha256: "A".repeat(64) }, { ...source(), sha256: "a".repeat(63) },
    { ...source(), width: 0 }, { ...source(), width: 1.5 }, { ...source(), height: 32769 }, { ...source(), width: "720" },
    { ...source(), width: 10001, height: 10000 }, { ...source(), height: NaN },
    { ...source(), photoAddedAt: "2026-02-30T09:00:00.000Z" }, { ...source(), scanSavedAt: "0000-01-01T00:00:00.000Z" },
    { ...source(), photoAddedAt: "2026-11-05T09:00:00Z" }, { ...source(), scanSavedAt: "2026-11-05T10:00:00.000+01:00" },
  ])("rejects an invalid source without dropping only its binding %#", (invalid) => {
    expect(normalizeMapOverviewSource(invalid)).toBeUndefined();
    expect(normalizeComponentMap({ ...map(), version: 3, overview: { ...map().overview, source: invalid } })).toBeUndefined();
    expect(mapOverviewSourcesMatch(source(), invalid)).toBe(false);
  });

  it.each([1, 2])("rejects binding presence on legacy version %s without upgrading it", (version) => {
    for (const value of [undefined, null, source()]) {
      expect(normalizeComponentMap({ ...map(), version, overview: { ...map().overview, source: value } })).toBeUndefined();
    }
    expect(normalizeComponentMap({ ...map(), version })?.version).toBe(version);
  });

  it("bounds decoded dimensions and detects every bound source field changing", () => {
    expect(normalizeMapOverviewSource({ ...source(), width: 32768, height: 1 })).toBeDefined();
    expect(normalizeMapOverviewSource({ ...source(), width: 10000, height: 10000 })).toBeDefined();
    for (const changed of [
      { ...source(), sha256: "b".repeat(64) }, { ...source(), width: 721 }, { ...source(), height: 421 },
      { ...source(), photoAddedAt: "2026-11-05T09:00:01.000Z" }, { ...source(), scanSavedAt: "2026-11-05T09:00:01.000Z" },
    ]) expect(mapOverviewSourcesMatch(source(), changed)).toBe(false);
  });

  it("seeds v3 only with a valid supplied source and leaves the legacy helper unbound", () => {
    const input = lookup(), verified = source();
    expect(seedMapFromLookup(input).version).toBe(2);
    expect(seedMapFromLookup(input).overview).not.toHaveProperty("source");
    const seeded = seedMapFromLookup(input, verified);
    expect(seeded).toMatchObject({ version: 3, overview: { lookupId: input.id, photoId: "photo-1", source: verified } });
    expect(seeded.overview.source).not.toBe(verified);
    expect(() => seedMapFromLookup(input, { ...verified, width: 0 })).toThrow(/no map was created/);
    expect(input).toEqual(lookup());
  });

  it("retains a conflicting source as readable evidence rather than silently merging bindings", () => {
    const document: ComponentMap = { ...map(), version: 3, overview: { ...map().overview, source: source() } };
    const conflict = { ...document, overview: { ...document.overview, source: { ...source(), sha256: "b".repeat(64) } } };
    const input = { ...record(), document, cloudRevision: 2, conflict: { document: conflict, revision: 3 } };
    expect(normalizeComponentMapRecord(input)).toEqual(input);
    expect(normalizeComponentMapRecord({ ...input, conflict: { document: map(), revision: 3 } })).toBeDefined();
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

  it("preserves nonprimary scene occurrences beyond four without guessing their existing boxes", () => {
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
    expect(seeded.version).toBe(2);
    expect(seeded.components.map((item) => item.label)).toEqual(["Alternator", "Hose", "Alternator", "Hose", "Battery", "Oil cap", "Radiator", "Air box"]);
    expect(seeded.components.every((item) => item.status === "needs_view" && item.reviewedAt === undefined)).toBe(true);
    expect(seeded.components[0].region).toEqual({ sourcePhotoId: "actual-overview", box });
    expect(seeded.components.slice(2).every((item) => item.region === undefined)).toBe(true);
    expect(seeded.components.slice(0, 2).every((item) => item.suggestedLocation === undefined)).toBe(true);
    expect(seeded.components.slice(2).every((item) => item.suggestedLocation?.text === "upper left" && item.notes === "")).toBe(true);
  });

  it("aliases only the uniquely proven primary and retains same-name or same-location scene occurrences", () => {
    const input = lookup();
    input.isolatedObjects = [
      { name: "Alternator", category: "electrical", primary: true, focusBox: box, isolatedImageBase64: "" },
      { name: "Hose", category: "engine", primary: false, focusBox: { ...box, x: 0.5 }, isolatedImageBase64: "" },
    ];
    input.focusBox = { ...box, confidence: 0.9 };
    input.result = { partName: " alternator ", sceneObjects: [
      { name: "Alternator", primary: true, regionLabel: " front center ", category: "engine" },
      { name: "Hose", primary: false, regionLabel: "left", category: "engine" },
      { name: "Hose", primary: false, regionLabel: "right", category: "engine" },
      ...Array.from({ length: 2 }, () => ({ name: "Connector", primary: false, regionLabel: "behind bracket", category: "engine" })),
    ] } as Lookup["result"];
    const before = structuredClone(input);
    const seeded = seedMapFromLookup(input);
    expect(seeded.components.map((item) => item.label)).toEqual(["Alternator", "Hose", "Hose", "Hose", "Connector", "Connector"]);
    expect(new Set(seeded.components.map((item) => item.id)).size).toBe(6);
    expect(seeded.components[0]).toMatchObject({ region: { sourcePhotoId: "photo-1", box }, suggestedLocation: { source: "ai_scene", text: "front center" } });
    expect(seeded.components[1].suggestedLocation).toBeUndefined();
    expect(seeded.components.slice(2).map((item) => item.suggestedLocation?.text)).toEqual(["left", "right", "behind bracket", "behind bracket"]);
    expect(seeded.components.slice(2).every((item) => !item.region)).toBe(true);
    expect(seeded.components.every((item) => item.status === "needs_view" && item.notes === "" && !item.reviewedAt)).toBe(true);
    expect(input).toEqual(before);
  });

  it.each(["missing result box", "different result box", "not explicitly primary", "multiple primary boxes", "different name"])("keeps the result unboxed when primary alias evidence is %s", (scenario) => {
    const input = lookup();
    input.focusBox = scenario === "missing result box" ? undefined : { ...box, ...(scenario === "different result box" ? { x: 0.2 } : {}) };
    input.isolatedObjects = [{ name: scenario === "different name" ? "Compressor" : "Alternator", category: "engine", primary: scenario !== "not explicitly primary", focusBox: box, isolatedImageBase64: "" }];
    if (scenario === "multiple primary boxes") input.isolatedObjects.push({ ...input.isolatedObjects[0] });
    input.result = { partName: "Alternator", sceneObjects: [] } as Lookup["result"];
    const seeded = seedMapFromLookup(input);
    expect(seeded.components).toHaveLength(input.isolatedObjects.length + 1);
    expect(seeded.components.at(-1)).toMatchObject({ label: "Alternator", status: "needs_view" });
    expect(seeded.components.at(-1)?.region).toBeUndefined();
    expect(seeded.components.slice(0, -1).every((item) => JSON.stringify(item.region?.box) === JSON.stringify(box))).toBe(true);
  });

  it("retains ambiguous primary scene entries and never attaches their hints to the result box", () => {
    const input = lookup();
    input.focusBox = box;
    input.result = { partName: "Hose", sceneObjects: ["left", "right"].map((regionLabel) => ({ name: "Hose", primary: true, category: "engine", regionLabel })) } as Lookup["result"];
    const seeded = seedMapFromLookup(input);
    expect(seeded.components).toHaveLength(3);
    expect(seeded.components[0].region?.box).toEqual(box);
    expect(seeded.components[0].suggestedLocation).toBeUndefined();
    expect(seeded.components.slice(1).map((item) => item.suggestedLocation?.text)).toEqual(["left", "right"]);
    expect(seeded.components.slice(1).every((item) => !item.region)).toBe(true);
  });

  it("preserves identical isolated occurrences and allows an empty unanalysed overview", () => {
    const input = lookup();
    input.isolatedObjects = Array.from({ length: 2 }, () => ({ name: "Hose", category: "engine", primary: false, focusBox: box, isolatedImageBase64: "" }));
    const seeded = seedMapFromLookup(input);
    expect(seeded.components).toHaveLength(2);
    expect(new Set(seeded.components.map((item) => item.id)).size).toBe(2);
    expect(seeded.components.map((item) => item.region?.box)).toEqual([box, box]);
    expect(seedMapFromLookup(lookup())).toMatchObject({ version: 2, components: [] });
  });

  it("refuses excess occurrences or overlong location text without saving a partial seed", () => {
    const input = lookup();
    input.result = { partName: "Connector", sceneObjects: Array.from({ length: 99 }, () => ({ name: "Connector", primary: false, category: "engine", regionLabel: "left" })) } as Lookup["result"];
    expect(seedMapFromLookup(input).components).toHaveLength(100);
    input.result!.sceneObjects!.push({ name: "Connector", primary: false, category: "engine", regionLabel: "left" });
    expect(() => seedMapFromLookup(input)).toThrow(/no partial map was saved/);
    expect(input.result?.sceneObjects).toHaveLength(100);
    input.result!.sceneObjects = [{ name: "Connector", primary: false, category: "engine", regionLabel: "x".repeat(241) }];
    expect(() => seedMapFromLookup(input)).toThrow(/location exceeds/);
    expect(input.result!.sceneObjects[0].regionLabel).toHaveLength(241);
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
    original.version = 2;
    original.components[0].suggestedLocation = { source: "ai_scene", text: "left bracket" };
    original.components[0] = reviewMapComponent(original.components[0], "inspected", "I checked the mounting bolt", now);
    const linked = linkComponentMapDocument(original, target(), ["photo-1"]);
    expect(linked.version).toBe(2);
    expect(linked.components[0]).toMatchObject({ id: componentId, status: "inspected", reviewedAt: now, notes: "I checked the mounting bolt", suggestedLocation: { source: "ai_scene", text: "left bracket" } });
    expect(linkComponentMapDocument(linked, target(), ["photo-1"])).toEqual(linked);
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
