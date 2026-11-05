import type { Lookup, VisualFocusBox } from "../types";
import type { ComponentCaptureTarget, ComponentMap, ComponentMapComponent, ComponentMapRecord, ComponentMapStatus } from "../types/componentMap";

export const MAX_MAP_COMPONENTS = 100;
export const MAX_COMPONENT_SCAN_GROUPS = 100;
export const MAX_COMPONENT_LABEL_LENGTH = 120;
export const MAX_COMPONENT_NOTES_LENGTH = 2000;
const UUID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
const RECORD_ID = /^[a-zA-Z0-9._:-]{1,160}$/;
const PHOTO_ID = /^[a-zA-Z0-9._:-]{1,80}$/;
const STATUSES: readonly ComponentMapStatus[] = ["needs_view", "inspected", "not_visible"];
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const id = (value: unknown, pattern = RECORD_ID): value is string => typeof value === "string" && pattern.test(value);
const revision = (value: unknown, minimum = 1): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= minimum;
const timestamp = (value: unknown): value is string => typeof value === "string"
  && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 19) === value.slice(0, 19);

export class ComponentMapError extends Error {
  constructor(public readonly code: "invalid_map" | "stale_revision" | "missing_map" | "missing_component" | "account_changed" | "storage_unavailable" | "link_conflict", message: string) {
    super(message);
    this.name = "ComponentMapError";
  }
}

function normalizeBox(value: unknown): VisualFocusBox | undefined {
  if (!object(value)) return undefined;
  const { x, y, width, height, confidence } = value;
  if (![x, y, width, height, confidence].every((part) => typeof part === "number" && Number.isFinite(part))) return undefined;
  const box = { x, y, width, height, confidence } as VisualFocusBox;
  if (box.x < 0 || box.y < 0 || box.width <= 0 || box.height <= 0 || box.x + box.width > 1
    || box.y + box.height > 1 || box.confidence < 0 || box.confidence > 1) return undefined;
  return box;
}

// Reject an invalid document as a whole. Never silently lose a component or its evidence links.
export function normalizeComponentMap(value: unknown): ComponentMap | undefined {
  if (!object(value) || value.version !== 1 || !id(value.id) || !object(value.overview)
    || value.overview.lookupId !== value.id || !id(value.overview.photoId, PHOTO_ID)
    || !Array.isArray(value.components) || value.components.length > MAX_MAP_COMPONENTS) return undefined;
  const components: ComponentMapComponent[] = [];
  const componentIds = new Set<string>();
  const linkIds = new Set<string>();
  for (const raw of value.components) {
    if (!object(raw) || !id(raw.id, UUID) || componentIds.has(raw.id.toLowerCase())
      || typeof raw.label !== "string" || !raw.label.trim() || raw.label.trim().length > MAX_COMPONENT_LABEL_LENGTH
      || typeof raw.notes !== "string" || raw.notes.length > MAX_COMPONENT_NOTES_LENGTH
      || !STATUSES.includes(raw.status as ComponentMapStatus) || !Array.isArray(raw.scanGroups)
      || raw.scanGroups.length > MAX_COMPONENT_SCAN_GROUPS
      || (raw.reviewedAt !== undefined && !timestamp(raw.reviewedAt))
      || (raw.status !== "needs_view" && !timestamp(raw.reviewedAt))) return undefined;
    componentIds.add(raw.id.toLowerCase());
    let region: ComponentMapComponent["region"];
    if (raw.region !== undefined) {
      if (!object(raw.region) || raw.region.sourcePhotoId !== value.overview.photoId) return undefined;
      const box = normalizeBox(raw.region.box);
      if (!box) return undefined;
      region = { sourcePhotoId: value.overview.photoId, box };
    }
    const scanGroups: ComponentMapComponent["scanGroups"] = [];
    for (const group of raw.scanGroups) {
      if (!object(group) || !id(group.linkId, UUID) || linkIds.has(group.linkId.toLowerCase()) || !id(group.lookupId)
        || !Array.isArray(group.photoIds) || group.photoIds.length < 1 || group.photoIds.length > 4
        || !group.photoIds.every((photoId) => id(photoId, PHOTO_ID)) || new Set(group.photoIds).size !== group.photoIds.length) return undefined;
      linkIds.add(group.linkId.toLowerCase());
      scanGroups.push({ linkId: group.linkId, lookupId: group.lookupId, photoIds: [...group.photoIds] as string[] });
    }
    components.push({ id: raw.id, label: raw.label.trim(), status: raw.status as ComponentMapStatus, notes: raw.notes,
      ...(raw.reviewedAt === undefined ? {} : { reviewedAt: raw.reviewedAt as string }), ...(region ? { region } : {}), scanGroups });
  }
  return { version: 1, id: value.id, overview: { lookupId: value.id, photoId: value.overview.photoId }, components };
}

export function normalizeComponentCaptureTarget(value: unknown): ComponentCaptureTarget | null {
  if (!object(value) || !id(value.mapId) || !id(value.componentId, UUID) || !id(value.linkAttemptId, UUID) || !id(value.lookupId)) return null;
  return { mapId: value.mapId, componentId: value.componentId, linkAttemptId: value.linkAttemptId, lookupId: value.lookupId };
}

export function componentCaptureTargetsMatch(left: ComponentCaptureTarget, right: ComponentCaptureTarget): boolean {
  return left.mapId === right.mapId && left.componentId === right.componentId
    && left.linkAttemptId === right.linkAttemptId && left.lookupId === right.lookupId;
}

export function normalizeComponentMapRecord(value: unknown): ComponentMapRecord | undefined {
  if (!object(value)) return undefined;
  const document = normalizeComponentMap(value.document);
  if (!document || !revision(value.localRevision) || (value.cloudRevision !== null && !revision(value.cloudRevision))
    || !revision(value.syncedLocalRevision, 0) || value.syncedLocalRevision > value.localRevision
    || (value.cloudRevision === null && value.syncedLocalRevision !== 0)) return undefined;
  let syncAttempt: ComponentMapRecord["syncAttempt"];
  if (value.syncAttempt !== undefined) {
    const attempt = value.syncAttempt;
    if (!object(attempt) || !id(attempt.id, UUID) || !revision(attempt.localRevision)
      || attempt.localRevision > value.localRevision || !timestamp(attempt.startedAt)) return undefined;
    syncAttempt = { id: attempt.id, localRevision: attempt.localRevision, startedAt: attempt.startedAt };
  }
  let conflict: ComponentMapRecord["conflict"];
  if (value.conflict !== undefined) {
    if (!object(value.conflict) || !revision(value.conflict.revision)) return undefined;
    const remote = normalizeComponentMap(value.conflict.document);
    if (!remote || remote.id !== document.id || remote.overview.photoId !== document.overview.photoId) return undefined;
    conflict = { document: remote, revision: value.conflict.revision };
  }
  return { document, localRevision: value.localRevision, cloudRevision: value.cloudRevision, syncedLocalRevision: value.syncedLocalRevision,
    ...(syncAttempt ? { syncAttempt } : {}), ...(conflict ? { conflict } : {}) };
}

export function isComponentMapRecord(value: unknown): value is ComponentMapRecord {
  return normalizeComponentMapRecord(value) !== undefined;
}

export function createMapComponent(label: string): ComponentMapComponent {
  if (!label.trim() || label.trim().length > MAX_COMPONENT_LABEL_LENGTH) throw new ComponentMapError("invalid_map", "Enter a component label of 1 to 120 characters.");
  return { id: crypto.randomUUID(), label: label.trim(), status: "needs_view", notes: "", scanGroups: [] };
}

// Call only for an explicit human review action; AI seeding never calls this helper.
export function reviewMapComponent(component: ComponentMapComponent, status: ComponentMapStatus, notes = component.notes, now = new Date().toISOString()): ComponentMapComponent {
  if (!STATUSES.includes(status) || typeof notes !== "string" || notes.length > MAX_COMPONENT_NOTES_LENGTH || !timestamp(now)) {
    throw new ComponentMapError("invalid_map", "Choose a review status and keep notes within 2000 characters.");
  }
  return { ...component, status, notes, reviewedAt: now };
}

export function seedMapFromLookup(lookup: Lookup): ComponentMap {
  const overview = { lookupId: lookup.id, photoId: lookup.photos?.[0]?.id ?? "photo-1" };
  const suggestions = [
    ...(lookup.isolatedObjects ?? []).map((item) => ({ label: item.name, box: item.focusBox })),
    ...(lookup.result?.partName ? [{ label: lookup.result.partName, box: lookup.focusBox }] : []),
    ...(lookup.result?.sceneObjects ?? []).map((item) => ({ label: item.name, box: undefined })),
  ];
  const components: ComponentMapComponent[] = [];
  for (const item of suggestions) {
    const label = item.label.trim().slice(0, MAX_COMPONENT_LABEL_LENGTH);
    if (!label) continue;
    const box = normalizeBox(item.box);
    const sameLabel = components.filter((part) => part.label.toLowerCase() === label.toLowerCase());
    if (sameLabel.some((part) => !box || (part.region?.box.x === box.x && part.region.box.y === box.y
      && part.region.box.width === box.width && part.region.box.height === box.height))) continue;
    // Keep distinct existing boxes with the same name, but do not duplicate a label-only suggestion.
    const unboxed = sameLabel.find((part) => !part.region);
    if (box && unboxed) { unboxed.region = { sourcePhotoId: overview.photoId, box }; continue; }
    if (components.length >= MAX_MAP_COMPONENTS) break;
    const component = createMapComponent(label);
    components.push(box ? { ...component, region: { sourcePhotoId: overview.photoId, box } } : component);
  }
  const document = normalizeComponentMap({ version: 1, id: lookup.id, overview, components });
  if (!document) throw new ComponentMapError("invalid_map", "This scan does not have a usable overview reference.");
  return document;
}

export function linkComponentMapDocument(document: ComponentMap, target: ComponentCaptureTarget, photoIds: readonly string[]): ComponentMap {
  const checked = normalizeComponentMap(document);
  const capture = normalizeComponentCaptureTarget(target);
  if (!checked || !capture || checked.id !== capture.mapId || photoIds.length < 1 || photoIds.length > 4
    || !photoIds.every((photoId) => id(photoId, PHOTO_ID)) || new Set(photoIds).size !== photoIds.length) {
    throw new ComponentMapError("invalid_map", "The saved photo group cannot be linked to this component map.");
  }
  const component = checked.components.find((item) => item.id === capture.componentId);
  if (!component) throw new ComponentMapError("missing_component", "This component was removed. Its saved scan is still available in history.");
  for (const item of checked.components) {
    const prior = item.scanGroups.find((group) => group.linkId.toLowerCase() === capture.linkAttemptId.toLowerCase());
    if (!prior) continue;
    if (item.id !== component.id || prior.lookupId !== capture.lookupId || prior.photoIds.length !== photoIds.length
      || prior.photoIds.some((photoId, index) => photoId !== photoIds[index])) {
      throw new ComponentMapError("link_conflict", "This capture was already linked to different evidence. The existing link was preserved.");
    }
    return checked;
  }
  if (component.scanGroups.length >= MAX_COMPONENT_SCAN_GROUPS) throw new ComponentMapError("invalid_map", "This component already has 100 linked photo groups. Its new scan remains in history.");
  component.scanGroups.push({ linkId: capture.linkAttemptId, lookupId: capture.lookupId, photoIds: [...photoIds] });
  return checked;
}
