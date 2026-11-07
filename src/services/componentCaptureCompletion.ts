import { getAccountScope } from "../lib/accountScope";
import { componentMapGroupBindingsMatch, normalizeComponentCaptureTarget } from "../lib/componentMap";
import { isPhotoRelationship, photoRelationshipOrUnknown } from "../lib/photoRelationship";
import { vehicleContextsMatch } from "../lib/vehicleContext";
import type { Lookup } from "../types";
import type { ComponentCaptureTarget, ComponentMapRecord } from "../types/componentMap";
import { linkComponentMap, readComponentMap } from "./componentMapStore";
import { assertLinkedPhotoGuardCurrent, prepareLinkedPhotoBinding } from "./linkedPhotoEvidence";
import { guardOriginalEvidence } from "./originalImageEvidence";
import { photoGroupsMatch } from "./photoDraft";
import { getLookup, readLookups } from "./storage";

const photos = (lookup: Lookup) => lookup.photos !== undefined ? lookup.photos : [{ ...lookup.frame, id: "photo-1", label: "overview" as const }];

/** Reusable synchronous check for the final draft-CAS callback; never hashes or awaits. */
export function assertComponentCaptureCurrent(saved: Lookup, scope = getAccountScope(), signal?: AbortSignal): void {
  guardOriginalEvidence(scope, signal);
  const read = readLookups();
  if (!read.ok) throw new Error("The saved scan could not be checked. Resume its photo draft to finish linking.");
  const current = getLookup(saved.id, read.value);
  if (!current || current.createdAt !== saved.createdAt || !photoGroupsMatch(photos(saved), photos(current))
    || photoRelationshipOrUnknown(current.photoRelationship) !== photoRelationshipOrUnknown(saved.photoRelationship)
    || (saved.photoRelationship !== undefined && !isPhotoRelationship(saved.photoRelationship))
    || (current.photoRelationship !== undefined && !isPhotoRelationship(current.photoRelationship))
    || !vehicleContextsMatch(current.vehicleContext, saved.vehicleContext) || current.jobId !== saved.jobId || current.orgId !== saved.orgId) {
    throw new Error("The saved component photos or their context changed. Its pending draft was kept for review.");
  }
}

/** Complete only the reserved saved scan. Never analyze again or discard its draft. */
export async function completeComponentCapture(target: ComponentCaptureTarget, saved: Lookup, scope = getAccountScope(), signal?: AbortSignal, assertContextCurrent?: () => void): Promise<ComponentMapRecord> {
  guardOriginalEvidence(scope, signal);
  const checked = normalizeComponentCaptureTarget(target), original = structuredClone(saved);
  if (!checked || checked.lookupId !== original.id) throw new Error("The saved scan does not match this component capture. Its draft was kept.");
  if (original.photoRelationship !== undefined && !isPhotoRelationship(original.photoRelationship)) throw new Error("The saved photo relationship is invalid. Its draft was kept.");
  const sourcePhotos = photos(original), photoIds = sourcePhotos.map((photo) => photo.id);
  const assertCurrent = () => { assertComponentCaptureCurrent(original, scope, signal); assertContextCurrent?.(); };
  assertCurrent();
  const map = await readComponentMap(checked.mapId, scope);
  assertCurrent();
  if (!map) throw new Error("The component map is missing. The scan and pending photo draft were kept.");
  if (!map.document.components.some((component) => component.id === checked.componentId)) throw new Error("This component was removed. The saved scan and pending draft were kept.");
  const prior = map.document.components.flatMap((component) => component.scanGroups).find((group) => group.linkId.toLowerCase() === checked.linkAttemptId.toLowerCase());
  // A legacy attempt remains ID-only even if the surrounding map was upgraded.
  const needsBinding = prior ? Boolean(prior.binding) : map.document.version === 3 || map.document.version === 4;
  const prepared = needsBinding ? await prepareLinkedPhotoBinding(original, photoIds, scope, signal, true) : undefined;
  assertCurrent();
  if (prior?.binding && (!prepared || !componentMapGroupBindingsMatch(prior.binding, prepared.binding))) {
    throw new Error("This capture is already linked to different source evidence. The existing link and pending draft were kept.");
  }
  const committed = await linkComponentMap(checked, photoIds, scope, prepared, assertCurrent);
  assertCurrent();
  const linked = committed.document.components.find((component) => component.id === checked.componentId)?.scanGroups.find((group) => group.linkId.toLowerCase() === checked.linkAttemptId.toLowerCase());
  if (!linked || linked.lookupId !== original.id || linked.photoIds.length !== photoIds.length || linked.photoIds.some((id, index) => id !== photoIds[index])) {
    throw new Error("The component link was not confirmed saved. Resume the pending draft to retry.");
  }
  if (prepared) {
    if (!linked.binding || !componentMapGroupBindingsMatch(linked.binding, prepared.binding)) throw new Error("The saved component binding differs. Its pending draft was kept.");
    assertLinkedPhotoGuardCurrent(prepared.guard, original.id, linked.binding, scope);
  } else if (linked.binding) throw new Error("The component link changed while saving. Its pending draft was kept.");
  guardOriginalEvidence(scope, signal);
  return committed;
}
