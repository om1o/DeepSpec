import { SCAN_PHOTO_LABELS, type ScanAnalysisState, type ScanPhoto, type IsolatedObject, type VisualFocusBox } from "../types";

export type VisualEvidence = Pick<ScanAnalysisState, "photos" | "isolatedObjects" | "focusBox" | "focusMode" | "isolatedImageBase64">;
export type EvidenceBundle = {
  version: 1;
  photos?: Array<Omit<ScanPhoto, "imageBase64"> & { imagePath: string }>;
  isolatedObjects?: Array<Omit<IsolatedObject, "isolatedImageBase64"> & { imagePath: string | null }>;
  focusBox?: VisualFocusBox;
  focusMode?: ScanAnalysisState["focusMode"];
  isolatedImagePath?: string | null;
};

const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
export const isEvidenceImage = (value: unknown): value is string => typeof value === "string"
  && (/^data:image\/(jpeg|png|webp);base64,/i.test(value) || /^https?:\/\//i.test(value));
const isMode = (value: unknown) => value === "mask" || value === "crop" || value === "full_frame";
export function validFocusBox(value: unknown): value is VisualFocusBox {
  return record(value) && [value.x, value.y, value.width, value.height, value.confidence].every((n) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1)
    && Number(value.width) > 0 && Number(value.height) > 0;
}

/** Preserve every item or reject the bundle; never silently drop damaged evidence. */
export function normalizeVisualEvidence(value: VisualEvidence): VisualEvidence | null {
  const result: VisualEvidence = {};
  if (value.photos !== undefined) {
    if (!Array.isArray(value.photos) || value.photos.some((p) => !record(p) || typeof p.id !== "string" || !p.id
      || !SCAN_PHOTO_LABELS.includes(p.label) || typeof p.capturedAt !== "string" || !isEvidenceImage(p.imageBase64))
      || new Set(value.photos.map((p) => p.id)).size !== value.photos.length) return null;
    result.photos = value.photos.map(({ id, label, capturedAt, imageBase64 }) => ({ id, label, capturedAt, imageBase64 }));
  }
  if (value.isolatedObjects !== undefined) {
    if (!Array.isArray(value.isolatedObjects) || value.isolatedObjects.some((o) => !record(o) || typeof o.name !== "string"
      || typeof o.category !== "string" || typeof o.primary !== "boolean" || !validFocusBox(o.focusBox)
      || (o.isolatedImageBase64 !== "" && !isEvidenceImage(o.isolatedImageBase64))
      || (o.focusMode !== undefined && !isMode(o.focusMode)) || (o.correctedAt !== undefined && typeof o.correctedAt !== "string"))) return null;
    result.isolatedObjects = value.isolatedObjects.map((o) => ({ name: o.name, category: o.category, primary: o.primary,
      focusBox: { ...o.focusBox }, isolatedImageBase64: o.isolatedImageBase64,
      ...(o.focusMode ? { focusMode: o.focusMode } : {}), ...(o.correctedAt ? { correctedAt: o.correctedAt } : {}) }));
  }
  if (validFocusBox(value.focusBox)) result.focusBox = { ...value.focusBox };
  if (isMode(value.focusMode)) result.focusMode = value.focusMode;
  if (value.isolatedImageBase64 === "" || isEvidenceImage(value.isolatedImageBase64)) result.isolatedImageBase64 = value.isolatedImageBase64;
  return result;
}

export function hasVisualEvidence(value: VisualEvidence) {
  return value.photos !== undefined || value.isolatedObjects !== undefined || value.focusBox !== undefined
    || value.focusMode !== undefined || value.isolatedImageBase64 !== undefined;
}

export function isOwnedEvidencePath(path: unknown, userId: string, lookupId: string): path is string {
  return typeof path === "string" && path.startsWith(`${userId}/${lookupId}/`)
    && !path.includes("\\") && !path.includes("%") && !path.split("/").some((part) => !part || part === "." || part === "..");
}

export function evidencePaths(bundle: EvidenceBundle): string[] {
  return [...(bundle.photos ?? []).map((p) => p.imagePath), ...(bundle.isolatedObjects ?? []).flatMap((o) => o.imagePath ? [o.imagePath] : []),
    ...(bundle.isolatedImagePath ? [bundle.isolatedImagePath] : [])];
}

/** Validate metadata before requesting signed URLs, including owner/scan boundaries. */
export function parseEvidenceBundle(value: unknown, userId: string, lookupId: string): EvidenceBundle | null {
  if (!record(value) || value.version !== 1) return null;
  if (value.focusBox !== undefined && !validFocusBox(value.focusBox)) return null;
  if (value.focusMode !== undefined && !isMode(value.focusMode)) return null;
  if (value.photos !== undefined && !Array.isArray(value.photos)) return null;
  if (value.isolatedObjects !== undefined && !Array.isArray(value.isolatedObjects)) return null;
  const bundle = value as EvidenceBundle;
  if ((bundle.photos ?? []).some((p) => !record(p) || !isOwnedEvidencePath(p.imagePath, userId, lookupId))) return null;
  if ((bundle.isolatedObjects ?? []).some((o) => !record(o) || (o.imagePath !== null && !isOwnedEvidencePath(o.imagePath, userId, lookupId)))) return null;
  if (bundle.isolatedImagePath !== undefined && bundle.isolatedImagePath !== null && !isOwnedEvidencePath(bundle.isolatedImagePath, userId, lookupId)) return null;
  const probe = restoreEvidenceBundle(bundle, new Map(evidencePaths(bundle).map((path) => [path, "data:image/jpeg;base64,AA=="])));
  return normalizeVisualEvidence(probe) ? bundle : null;
}

export function restoreEvidenceBundle(bundle: EvidenceBundle, signed: Map<string, string>): VisualEvidence {
  return {
    ...(bundle.photos !== undefined ? { photos: bundle.photos.map(({ imagePath, ...p }) => ({ ...p, imageBase64: signed.get(imagePath) ?? "" })) } : {}),
    ...(bundle.isolatedObjects !== undefined ? { isolatedObjects: bundle.isolatedObjects.map(({ imagePath, ...o }) => ({ ...o, isolatedImageBase64: imagePath ? signed.get(imagePath) ?? "" : "" })) } : {}),
    ...(bundle.focusBox ? { focusBox: bundle.focusBox } : {}), ...(bundle.focusMode ? { focusMode: bundle.focusMode } : {}),
    ...(bundle.isolatedImagePath !== undefined ? { isolatedImageBase64: bundle.isolatedImagePath ? signed.get(bundle.isolatedImagePath) ?? "" : "" } : {}),
  };
}
