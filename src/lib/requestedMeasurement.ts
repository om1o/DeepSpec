import type { RequestedMeasurementGuide, RequestedMeasurementReceipt } from "../types/requestedMeasurement";
import { normalizeComparisonSide } from "./inspectionComparison";

const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const id = (value: unknown, max = 160): value is string => typeof value === "string" && value.length <= max && /^[A-Za-z0-9._:-]+$/.test(value) && value !== "." && value !== "..";
const keys = (value: Record<string, unknown>, allowed: readonly string[]) => Object.keys(value).every((key) => allowed.includes(key));
const requestText = (value: unknown): value is string => typeof value === "string" && value.length <= 600 && Boolean(value.trim()) && value === value.trim();

export function normalizeRequestedMeasurementGuide(value: unknown): RequestedMeasurementGuide | undefined {
  if (!object(value) || value.version !== 1 || value.kind !== "measurement"
    || !keys(value, ["version", "kind", "request", "purpose", "photoIds", "analysisAttemptId"])
    || !requestText(value.request) || !requestText(value.purpose) || !Array.isArray(value.photoIds)
    || value.photoIds.length > 4 || !value.photoIds.every((photoId) => id(photoId, 80))
    || new Set(value.photoIds).size !== value.photoIds.length || (value.analysisAttemptId !== undefined && !id(value.analysisAttemptId))) return undefined;
  return { version: 1, kind: "measurement", request: value.request, purpose: value.purpose, photoIds: [...value.photoIds],
    ...(value.analysisAttemptId === undefined ? {} : { analysisAttemptId: value.analysisAttemptId }) };
}

export function normalizeRequestedMeasurementReceipt(value: unknown, lookupId?: string): RequestedMeasurementReceipt | undefined {
  if (!object(value) || value.version !== 1 || !keys(value, ["version", "guide", "analysisSha256", "references"])
    || typeof value.analysisSha256 !== "string" || !/^[a-f0-9]{64}$/.test(value.analysisSha256)
    || !Array.isArray(value.references) || (lookupId !== undefined && !id(lookupId))) return undefined;
  const guide = normalizeRequestedMeasurementGuide(value.guide);
  if (!guide || value.references.length !== guide.photoIds.length) return undefined;
  const references = [];
  let owner = lookupId;
  for (const [index, raw] of value.references.entries()) {
    if (!object(raw) || !keys(raw, ["lookupId", "photoId", "photoLabel", "photoAddedAt", "scanSavedAt", "sha256", "width", "height", "observedOn", "vehicleContext", "analysisAttemptId"])) return undefined;
    const reference = normalizeComparisonSide(raw);
    if (!reference || reference.photoId !== guide.photoIds[index] || reference.analysisAttemptId !== guide.analysisAttemptId) return undefined;
    owner ??= reference.lookupId;
    if (reference.lookupId !== owner) return undefined;
    references.push(reference);
  }
  return { version: 1, guide, analysisSha256: value.analysisSha256, references };
}
