import { describe, expect, it } from "vitest";
import { mergeCloudLookup } from "./lookupMerge";
import type { IdentificationResult, Lookup } from "../types";
const box = { x: 0, y: 0, width: 0.3, height: 0.4, confidence: 1 };
const lookup = (token: string) => ({ id: "scan", cloudRevision: 1, frame: { capturedAt: "now", imageBase64: `https://images/original?${token}` },
  photos: [{ id: "overview", label: "overview", capturedAt: "now", imageBase64: `https://images/photo?${token}` }],
  focusBox: box, focusMode: "mask", isolatedImageBase64: `https://images/primary?${token}`,
  isolatedObjects: [{ name: "Part", category: "engine", primary: true, focusBox: box, focusMode: "mask", isolatedImageBase64: `https://images/object?${token}` }],
} as Lookup);
describe("cloud evidence URL refresh", () => {
  it.each([true, false])("keeps local review coverage from its own attempt when refreshing URLs (local review: %s)", (hasReview) => {
    const result: IdentificationResult = { partName: "Panel", confidence: "low", scanCategory: "body", candidateMatches: [], whatItDoes: "Body panel",
      visibleObservations: [], evidenceRegions: [], concerns: [], safetyTriage: "can_help", isSafetyCritical: false, nextAction: "Inspect", needsBetterPhoto: true,
      evidence: [], sourceLinks: [], modelRun: { provider: "gemini", model: "fixture", runId: "local-attempt", latencyMs: 1, ocrUsed: false },
      ...(hasReview ? { photoReview: { version: 1 as const, photos: [{ photoId: "overview", status: "limited_view" as const, summary: "Reverse not visible." }], disagreements: [] } } : {}) };
    const local = { ...lookup("old"), result };
    const remote = { ...lookup("new"), result: { ...result, modelRun: { ...result.modelRun!, runId: "remote-attempt" },
      photoReview: { version: 1 as const, photos: [{ photoId: "overview", status: "observations_returned" as const, summary: "A different review." }], disagreements: [] } } };
    const merged = mergeCloudLookup(local, remote);
    expect(merged.result).toEqual(result);
    expect(merged.photos?.[0].imageBase64).toBe(remote.photos?.[0].imageBase64);
    if (!hasReview) expect(merged.result).not.toHaveProperty("photoReview");
  });
  it.each(["same_part_or_area", "independent", "unknown", undefined] as const)("keeps local relationship %s while refreshing URLs, not a remote source's declaration", (photoRelationship) => {
    const local = { ...lookup("old"), photoRelationship };
    const remote = { ...lookup("new"), photoRelationship: "independent" as const };
    remote.photos![0].id = "other-source";
    expect(mergeCloudLookup(local, remote).photoRelationship).toBe(photoRelationship);
    expect(mergeCloudLookup(local, remote).photos).toEqual(local.photos);
    remote.photos![0].id = local.photos![0].id;
    expect(mergeCloudLookup(local, remote).photoRelationship).toBe(photoRelationship);
    expect(mergeCloudLookup(local, remote).photos?.[0].imageBase64).toBe(remote.photos?.[0].imageBase64);
  });
  it("refreshes matching URLs and keeps local revision and metadata", () => {
    const local = lookup("old");
    const remote = { ...lookup("new"), cloudRevision: 3 };
    const merged = mergeCloudLookup(local, remote);
    expect(merged.frame.imageBase64).toBe(remote.frame.imageBase64);
    expect(merged.photos?.[0].imageBase64).toBe(remote.photos?.[0].imageBase64);
    expect(merged.isolatedObjects?.[0].isolatedImageBase64).toBe(remote.isolatedObjects?.[0].isolatedImageBase64);
    expect(merged.isolatedImageBase64).toBe(remote.isolatedImageBase64);
    expect(merged.cloudRevision).toBe(1);
  });
  it.each(["/brand/deepspec-logo.webp", "/brand/deepspec-symbol.webp"])("recovers a placeholder cover while preserving device edits: %s", (placeholder) => {
    const local = lookup("old");
    local.frame.imageBase64 = placeholder;
    local.notes = "Receiving notes";
    local.correction = "Generator assembly";
    local.photos![0].imageBase64 = "data:image/jpeg;base64,AA==";
    local.isolatedObjects![0] = { ...local.isolatedObjects![0], focusMode: "crop", isolatedImageBase64: "", correctedAt: "today" };
    local.focusMode = "crop";
    local.isolatedImageBase64 = "";
    const remote = lookup("new");
    remote.frame.capturedAt = "remote-time";
    const merged = mergeCloudLookup(local, remote);
    expect(merged.frame).toEqual({ ...local.frame, imageBase64: remote.frame.imageBase64 });
    expect(merged.notes).toBe(local.notes);
    expect(merged.correction).toBe(local.correction);
    expect(merged.cloudRevision).toBe(local.cloudRevision);
    expect(merged.photos).toEqual(local.photos);
    expect(merged.isolatedObjects).toEqual(local.isolatedObjects);
    expect(merged.isolatedImageBase64).toBe("");
    expect(local.frame.imageBase64).toBe(placeholder);
  });
  it.each(["data:image/jpeg;base64,AA==", "blob:https://example.test/device-photo"])("preserves local cover pixels when a cloud photo arrives: %s", (imageBase64) => {
    const local = lookup("old");
    local.frame.imageBase64 = imageBase64;
    expect(mergeCloudLookup(local, lookup("new")).frame).toEqual(local.frame);
  });
  it("keeps a cached cover when cloud signing only returns a placeholder", () => {
    const local = lookup("old");
    const remote = lookup("new");
    remote.frame.imageBase64 = "/brand/deepspec-symbol.webp";
    expect(mergeCloudLookup(local, remote).frame).toEqual(local.frame);
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
