import type { Lookup } from "../types";
import { withLatestInspection } from "./partInspection";

export function mergeCloudLookup(local: Lookup, remote: Lookup): Lookup {
  // Keep the local cloudRevision: this merge retains local analysis/feedback.
  // Adopting the remote revision would authorize stale fields to overwrite it.
  const merged = withLatestInspection(local, remote);
  // Device photos are durable. Cached cloud URLs expire, so use the newly
  // signed URL when available without replacing a photo with the cloud fallback.
  const refresh = (current: string, incoming?: string) => /^https?:\/\//i.test(current) && incoming && /^https?:\/\//i.test(incoming) ? incoming : current;
  const sameSelection = (a: Pick<Lookup, "focusBox" | "focusMode">, b: Pick<Lookup, "focusBox" | "focusMode">) => JSON.stringify(a.focusBox) === JSON.stringify(b.focusBox) && a.focusMode === b.focusMode;
  return { ...merged,
    frame: { ...local.frame, imageBase64: refresh(local.frame.imageBase64, remote.frame.imageBase64) },
    ...(local.photos ? { photos: local.photos.map((photo) => {
      const match = remote.photos?.find((p) => p.id === photo.id && p.capturedAt === photo.capturedAt);
      return { ...photo, imageBase64: refresh(photo.imageBase64, match?.imageBase64) };
    }) } : {}),
    ...(local.isolatedObjects ? { isolatedObjects: local.isolatedObjects.map((object) => {
      const matches = remote.isolatedObjects?.filter((o) => o.name === object.name && o.category === object.category
        && o.primary === object.primary && o.correctedAt === object.correctedAt && sameSelection(o, object));
      return { ...object, isolatedImageBase64: refresh(object.isolatedImageBase64, matches?.length === 1 ? matches[0].isolatedImageBase64 : undefined) };
    }) } : {}),
    ...(local.isolatedImageBase64 !== undefined ? { isolatedImageBase64: refresh(local.isolatedImageBase64, sameSelection(local, remote) ? remote.isolatedImageBase64 : undefined) } : {}),
  };
}
