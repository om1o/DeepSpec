import type { Lookup, VisualFocusBox } from "../types";
import type { ComponentCaptureTarget, ComponentMap, ComponentMapComponent, ComponentMapRecord, ComponentMapStatus } from "../types/componentMap";

export const MAX_MAP_COMPONENTS = 100;
export const MAX_COMPONENT_SCAN_GROUPS = 100;
export const MAX_COMPONENT_LABEL_LENGTH = 120;
export const MAX_COMPONENT_NOTES_LENGTH = 2000;
export const MAX_SUGGESTED_LOCATION_LENGTH = 240;
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

function normalizeSuggestedLocation(value: unknown): ComponentMapComponent["suggestedLocation"] {
  if (!object(value) || Object.keys(value).length !== 2 || value.source !== "ai_scene" || typeof value.text !== "string") return undefined;
  const text = value.text.trim();
  if (!text || Array.from(text).length > MAX_SUGGESTED_LOCATION_LENGTH) return undefined;
  return { source: "ai_scene", text };
}

// Reject an invalid document as a whole. Never silently lose a component or its evidence links.
export function normalizeComponentMap(value: unknown): ComponentMap | undefined {
  if (!object(value) || (value.version !== 1 && value.version !== 2) || !id(value.id) || !object(value.overview)
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
    let suggestedLocation: ComponentMapComponent["suggestedLocation"];
    if (Object.prototype.hasOwnProperty.call(raw, "suggestedLocation")) {
      if (value.version !== 2) return undefined;
      suggestedLocation = normalizeSuggestedLocation(raw.suggestedLocation);
      if (!suggestedLocation) return undefined;
    }
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
      ...(raw.reviewedAt === undefined ? {} : { reviewedAt: raw.reviewedAt as string }), ...(region ? { region } : {}),
      ...(suggestedLocation ? { suggestedLocation } : {}), scanGroups });
  }
  return { version: value.version, id: value.id, overview: { lookupId: value.id, photoId: value.overview.photoId }, components };
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
  const components: ComponentMapComponent[] = [];
  const add = (label: string, box?: VisualFocusBox) => {
    if (components.length >= MAX_MAP_COMPONENTS) throw new ComponentMapError("invalid_map", "This scan has more than 100 component suggestions. The original scan was preserved; no partial map was saved.");
    const component = createMapComponent(label);
    if (box) component.region = { sourcePhotoId: overview.photoId, box };
    components.push(component);
    return component;
  };
  const nameKey = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();
  const isolated = (lookup.isolatedObjects ?? []).map((item) => ({
    item, component: add(item.name, normalizeBox(item.focusBox)),
  }));
  const primaryIsolations = isolated.filter(({ item }) => item.primary);
  const primaryName = lookup.result?.partName?.trim();
  let primaryResult: ComponentMapComponent | undefined;
  if (primaryName) {
    const mainBox = normalizeBox(lookup.focusBox);
    const candidate = primaryIsolations.length === 1 ? primaryIsolations[0] : undefined;
    const candidateBox = candidate?.component.region?.box;
    // Names alone cannot bind a result to one of several same-named selections.
    // Confidence is not geometry; all four coordinates must agree exactly.
    const samePrimary = candidate && nameKey(candidate.item.name) === nameKey(primaryName)
      && mainBox && candidateBox && mainBox.x === candidateBox.x && mainBox.y === candidateBox.y
      && mainBox.width === candidateBox.width && mainBox.height === candidateBox.height;
    primaryResult = samePrimary && candidate ? candidate.component : add(primaryName, isolated.length === 0 ? mainBox : undefined);
  }
  const scenes = lookup.result?.sceneObjects ?? [];
  const primaryScenes = scenes.filter((item) => item.primary);
  for (const item of scenes) {
    // Preserve every occurrence, even identical names/locations. A text location
    // does not prove which existing box (if any) belongs to this scene entry.
    const aliasesPrimary = primaryResult && primaryName && item.primary && primaryScenes.length === 1
      && nameKey(item.name) === nameKey(primaryName);
    const component = aliasesPrimary && primaryResult ? primaryResult : add(item.name);
    if (item.regionLabel.trim()) {
      const suggestedLocation = normalizeSuggestedLocation({ source: "ai_scene", text: item.regionLabel });
      if (!suggestedLocation) throw new ComponentMapError("invalid_map", "An AI-suggested location exceeds the supported length. The original scan was preserved; no partial map was saved.");
      component.suggestedLocation = suggestedLocation;
    }
  }
  const document = normalizeComponentMap({ version: 2, id: lookup.id, overview, components });
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
