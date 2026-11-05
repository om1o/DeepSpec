import { describe, expect, it } from "vitest";
import { normalizePhotoDraft, photoDraftsMatch, type PhotoDraftEnvelope } from "./photoDraft";
import type { ScanPhoto } from "../types";

const photos: ScanPhoto[] = [{ id: "overview", label: "overview", capturedAt: "2026-11-05T00:00:00Z", imageBase64: "data:image/jpeg;base64,cGhvdG8=" }];
const draft: PhotoDraftEnvelope = { version: 2, photos, target: { mapId: "bay", componentId: "00000000-0000-4000-8000-000000000001", linkAttemptId: "00000000-0000-4000-8000-000000000002", lookupId: "detail" } };

describe("photo draft envelopes", () => {
  it("reads older photo arrays without assigning them to a component", () => {
    expect(normalizePhotoDraft(photos)).toEqual({ version: 2, photos });
  });
  it("preserves a valid component target with all photos", () => {
    expect(normalizePhotoDraft(draft)).toEqual(draft);
  });
  it("rejects invalid target metadata rather than falling back to unrelated photos", () => {
    expect(normalizePhotoDraft({ ...draft, target: { ...draft.target, componentId: "invalid" } })).toBeNull();
    expect(normalizePhotoDraft({ ...draft, target: null })).toBeNull();
  });
  it("does not consider identical photos with a different component or link to be the same draft", () => {
    expect(photoDraftsMatch(draft, { version: 2, photos })).toBe(false);
    expect(photoDraftsMatch(draft, { ...draft, target: { ...draft.target!, lookupId: "other-scan" } })).toBe(false);
    expect(photoDraftsMatch(draft, { ...draft, target: { ...draft.target!, componentId: "00000000-0000-4000-8000-000000000003" } })).toBe(false);
    expect(photoDraftsMatch(draft, structuredClone(draft))).toBe(true);
  });
  it("rejects partial, duplicate or oversized groups as a whole", () => {
    expect(normalizePhotoDraft({ ...draft, photos: [photos[0], photos[0]] })).toBeNull();
    expect(normalizePhotoDraft({ ...draft, photos: [] })).toBeNull();
    expect(normalizePhotoDraft({ ...draft, photos: Array.from({ length: 5 }, (_, index) => ({ ...photos[0], id: `photo-${index}` })) })).toBeNull();
  });
  it("retains a version-three vehicle snapshot and job when reading or relabeling", () => {
    const snapshot: PhotoDraftEnvelope = { version: 3, photos, vehicleContext: { year: "2015", make: "Honda", mileage: "120000", mileageUnit: "mi" }, jobId: "job-a" };
    expect(normalizePhotoDraft(snapshot)).toEqual(snapshot);
    expect(normalizePhotoDraft({ ...snapshot, photos: [{ ...photos[0], label: "close_up" }] })).toMatchObject({ vehicleContext: snapshot.vehicleContext, jobId: "job-a" });
  });
  it("keeps old clients and another vehicle or job from changing identical photos", () => {
    const snapshot: PhotoDraftEnvelope = { version: 3, photos, vehicleContext: { model: "Civic" }, jobId: "job-a" };
    expect(photoDraftsMatch(snapshot, { version: 2, photos })).toBe(false);
    expect(photoDraftsMatch(snapshot, { ...snapshot, vehicleContext: { model: "Accord" } })).toBe(false);
    expect(photoDraftsMatch(snapshot, { ...snapshot, jobId: "job-b" })).toBe(false);
    expect(photoDraftsMatch(snapshot, structuredClone(snapshot))).toBe(true);
  });
  it("requires an explicit no-vehicle snapshot and refuses broken new metadata", () => {
    expect(normalizePhotoDraft({ version: 3, photos, vehicleContext: null })).toEqual({ version: 3, photos, vehicleContext: null });
    expect(normalizePhotoDraft({ version: 3, photos })).toBeNull();
    expect(normalizePhotoDraft({ version: 3, photos, vehicleContext: "other car" })).toBeNull();
    expect(normalizePhotoDraft({ version: 3, photos, vehicleContext: null, jobId: "wrong/job" })).toBeNull();
  });
});
