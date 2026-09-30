import type { Lookup } from "../types";
import { withLatestInspection } from "./partInspection";

export function mergeCloudLookup(local: Lookup, remote: Lookup): Lookup {
  const merged = withLatestInspection(local, remote);
  // Device photos are durable. Cached cloud URLs expire, so use the newly
  // signed URL when available without replacing a photo with the cloud fallback.
  if (!local.frame.imageBase64.startsWith("data:")
    && /^https?:\/\//i.test(remote.frame.imageBase64)
    && remote.frame.imageBase64 !== local.frame.imageBase64) {
    return { ...merged, frame: { ...local.frame, imageBase64: remote.frame.imageBase64 } };
  }
  return merged;
}
