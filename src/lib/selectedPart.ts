import type { SelectedPartReference } from "../types/index.js";

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** Selection coordinates always refer to the first original, never to its derived crop. */
export function normalizeSelectedPart(value: unknown, photoIds: string[]): SelectedPartReference | null {
  if (!isRecord(value) || typeof value.photoId !== "string" || value.photoId !== photoIds[0]
    || !value.photoId.trim() || value.photoId.length > 80 || new Set(photoIds).size !== photoIds.length
    || !isRecord(value.rectangle)) return null;
  const { x, y, width, height } = value.rectangle;
  if (![x, y, width, height].every((n) => typeof n === "number" && Number.isFinite(n))
    || typeof x !== "number" || typeof y !== "number" || typeof width !== "number" || typeof height !== "number"
    || x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > 1 || y + height > 1) return null;
  if (value.cropPhotoId !== undefined && (typeof value.cropPhotoId !== "string" || value.cropPhotoId === value.photoId
    || !photoIds.includes(value.cropPhotoId))) return null;
  return { photoId: value.photoId, rectangle: { x, y, width, height },
    ...(typeof value.cropPhotoId === "string" ? { cropPhotoId: value.cropPhotoId } : {}) };
}
