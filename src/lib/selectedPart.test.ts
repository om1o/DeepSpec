import { describe, expect, it } from "vitest";
import { normalizeSelectedPart } from "./selectedPart";

const rectangle = { x: 0.2, y: 0.1, width: 0.5, height: 0.6 };
const selected = { photoId: "original", rectangle, cropPhotoId: "crop" };

describe("selected-part source reference", () => {
  it("preserves the first original and optional derived crop without reordering photos", () => {
    expect(normalizeSelectedPart(selected, ["original", "other-original", "crop"])).toEqual(selected);
    expect(normalizeSelectedPart({ photoId: "photo-1", rectangle }, ["photo-1"])).toEqual({ photoId: "photo-1", rectangle });
  });
  it.each([
    undefined, null, [], {}, { ...selected, photoId: "crop" }, { ...selected, photoId: "missing" },
    { ...selected, cropPhotoId: "original" }, { ...selected, cropPhotoId: "missing" }, { ...selected, cropPhotoId: null },
    ...[NaN, Infinity, "0.2", -0.1].map((x) => ({ ...selected, rectangle: { ...rectangle, x } })),
    { ...selected, rectangle: { ...rectangle, width: 0 } },
    { ...selected, rectangle: { ...rectangle, width: 0.9 } },
    { ...selected, rectangle: { ...rectangle, height: 0.95 } },
  ])("rejects invalid or unbound references: %j", (value) => {
    expect(normalizeSelectedPart(value, ["original", "crop"])).toBeNull();
  });
  it("rejects ambiguous duplicate photo IDs and returns detached normalized geometry", () => {
    expect(normalizeSelectedPart(selected, ["original", "crop", "crop"])).toBeNull();
    const normalized = normalizeSelectedPart(selected, ["original", "crop"]);
    expect(normalized?.rectangle).not.toBe(rectangle);
    expect(normalizeSelectedPart({ photoId: "original", rectangle: { x: 0, y: 0, width: 1, height: 1 } }, ["original"])).not.toBeNull();
  });
});
