import { describe, expect, it } from "vitest";
import { normalizePhotoDraft, photoDraftsMatch, type PhotoDraftEnvelope } from "./photoDraft";
import type { ScanPhoto } from "../types";
import type { ComparisonCaptureTarget } from "../types/inspectionComparison";

const photos: ScanPhoto[] = [{ id: "overview", label: "overview", capturedAt: "2026-11-05T00:00:00Z", imageBase64: "data:image/jpeg;base64,cGhvdG8=" }];
const draft: PhotoDraftEnvelope = { version: 2, photos, target: { mapId: "bay", componentId: "00000000-0000-4000-8000-000000000001", linkAttemptId: "00000000-0000-4000-8000-000000000002", lookupId: "detail" } };
const comparisonTarget: ComparisonCaptureTarget = { version: 1, comparisonId: "00000000-0000-4000-8000-000000000004", lookupId: "detail", subject: "Bracket stain",
  earlier: { lookupId: "earlier", photoId: "source", photoLabel: "overview", photoAddedAt: "2026-11-04T00:00:00Z", scanSavedAt: "2026-11-04T00:00:00Z",
    observedOn: null, sha256: "a".repeat(64), width: 640, height: 360, vehicleContext: { model: "Original car" } } };

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
  it("retains the complete repeat-capture target, frozen car/job and compatible component target in version four", () => {
    const repeat: PhotoDraftEnvelope = { version: 4, photos, target: draft.target, comparisonTarget, vehicleContext: { model: "Original car" }, jobId: "job-a" };
    expect(normalizePhotoDraft(JSON.parse(JSON.stringify(repeat)))).toEqual(repeat);
    expect(normalizePhotoDraft({ ...repeat, photos: [{ ...photos[0], label: "close_up" }] })).toMatchObject({ comparisonTarget, target: draft.target, vehicleContext: repeat.vehicleContext, jobId: "job-a" });
  });
  it("rejects conflicting reserved IDs, partial reference metadata and unsupported older repeat envelopes", () => {
    const repeat = { version: 4, photos, comparisonTarget, vehicleContext: null };
    expect(normalizePhotoDraft({ ...repeat, target: { ...draft.target, lookupId: "different" } })).toBeNull();
    expect(normalizePhotoDraft({ ...repeat, comparisonTarget: { ...comparisonTarget, earlier: { ...comparisonTarget.earlier, sha256: "missing" } } })).toBeNull();
    expect(normalizePhotoDraft({ ...repeat, comparisonTarget: undefined })).toBeNull();
    expect(normalizePhotoDraft({ ...repeat, vehicleContext: undefined })).toBeNull();
    expect(normalizePhotoDraft({ ...repeat, version: 3 })).toBeNull();
    expect(normalizePhotoDraft({ ...repeat, version: 2 })).toBeNull();
  });
  it("does not let unchanged photo bytes authorize replacing or retiring a different comparison draft", () => {
    const repeat: PhotoDraftEnvelope = { version: 4, photos, comparisonTarget, vehicleContext: null };
    expect(photoDraftsMatch(repeat, { version: 3, photos, vehicleContext: null })).toBe(false);
    expect(photoDraftsMatch(repeat, { ...repeat, comparisonTarget: { ...comparisonTarget, comparisonId: "00000000-0000-4000-8000-000000000005" } })).toBe(false);
    expect(photoDraftsMatch(repeat, { ...repeat, comparisonTarget: { ...comparisonTarget, lookupId: "other" } })).toBe(false);
    expect(photoDraftsMatch(repeat, { ...repeat, comparisonTarget: { ...comparisonTarget, earlier: { ...comparisonTarget.earlier, sha256: "b".repeat(64) } } })).toBe(false);
    expect(photoDraftsMatch(repeat, { ...repeat, comparisonTarget: { ...comparisonTarget, earlier: { ...comparisonTarget.earlier, observedOn: "2026-11-03" } } })).toBe(false);
    expect(photoDraftsMatch(repeat, { ...repeat, vehicleContext: { model: "Other car" } })).toBe(false);
    expect(photoDraftsMatch(repeat, { ...repeat, jobId: "another-job" })).toBe(false);
    expect(photoDraftsMatch(repeat, structuredClone(repeat))).toBe(true);
  });
});
