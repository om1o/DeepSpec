import { describe, expect, it } from "vitest";
import { mergeCloudLookup } from "./lookupMerge";
import type { Lookup } from "../types";
const box = { x: 0, y: 0, width: 0.3, height: 0.4, confidence: 1 };
const lookup = (token: string) => ({ id: "scan", cloudRevision: 1, frame: { capturedAt: "now", imageBase64: `https://images/original?${token}` },
  photos: [{ id: "overview", label: "overview", capturedAt: "now", imageBase64: `https://images/photo?${token}` }],
  focusBox: box, focusMode: "mask", isolatedImageBase64: `https://images/primary?${token}`,
  isolatedObjects: [{ name: "Part", category: "engine", primary: true, focusBox: box, focusMode: "mask", isolatedImageBase64: `https://images/object?${token}` }],
} as Lookup);
describe("cloud evidence URL refresh", () => {
  it("refreshes matching URLs and keeps local revision and metadata", () => {
    const local = lookup("old");
    const remote = { ...lookup("new"), cloudRevision: 3 };
    const merged = mergeCloudLookup(local, remote);
    expect(merged.photos?.[0].imageBase64).toBe(remote.photos?.[0].imageBase64);
    expect(merged.isolatedObjects?.[0].isolatedImageBase64).toBe(remote.isolatedObjects?.[0].isolatedImageBase64);
    expect(merged.isolatedImageBase64).toBe(remote.isolatedImageBase64);
    expect(merged.cloudRevision).toBe(1);
  });
  it("preserves device pixels and corrected selections when cloud data is stale", () => {
    const local = lookup("old");
    local.photos![0].imageBase64 = "data:image/jpeg;base64,AA==";
    local.isolatedObjects![0] = { ...local.isolatedObjects![0], focusMode: "crop", isolatedImageBase64: "", correctedAt: "today" };
    local.isolatedImageBase64 = "";
    local.focusMode = "crop";
    const merged = mergeCloudLookup(local, lookup("new"));
    expect(merged.photos).toEqual(local.photos);
    expect(merged.isolatedObjects).toEqual(local.isolatedObjects);
    expect(merged.isolatedImageBase64).toBe("");
  });
  it("does not attach a different photo or changed selection to local evidence", () => {
    const local = lookup("old");
    const remote = lookup("new");
    remote.photos![0].id = "different";
    remote.isolatedObjects![0].focusBox = { ...box, x: 0.4 };
    const merged = mergeCloudLookup(local, remote);
    expect(merged.photos).toEqual(local.photos);
    expect(merged.isolatedObjects).toEqual(local.isolatedObjects);
  });
});
