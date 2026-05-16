import type { IdentificationResult, Lookup, Rating, ScanAnalysisState, ScanCategory, TrainingStatus } from "../types";

export const LOOKUPS_STORAGE_KEY = "deep-spec:lookups";

type StorageResult<T> =
  | {
      ok: true;
      value: T;
    }
  | {
      ok: false;
      message: string;
      value: T;
    };

export function createLookup(scanState: ScanAnalysisState): StorageResult<Lookup> {
  const lookup: Lookup = {
    id: createId(),
    createdAt: new Date().toISOString(),
    frame: scanState.frame,
    result: scanState.result,
    errorMessage: scanState.errorMessage,
    errorCode: scanState.errorCode,
    analyzedAt: scanState.analyzedAt,
    rating: null,
    correction: null,
    notes: "",
    scanCategory: categorizeScan(scanState.result),
    trainingLabel: scanState.result?.partName ?? "unlabeled",
    trainingStatus: "raw_unreviewed",
    chatHistory: [],
  };

  const lookups = [lookup, ...getLookups()];
  const writeResult = writeLookups(lookups);

  return writeResult.ok ? { ok: true, value: lookup } : { ok: false, message: writeResult.message, value: lookup };
}

export function getLookups(): Lookup[] {
  if (!hasLocalStorage()) {
    return [];
  }

  try {
    const rawLookups = localStorage.getItem(LOOKUPS_STORAGE_KEY);
    if (!rawLookups) {
      return [];
    }

    const parsed = JSON.parse(rawLookups) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.map(normalizeLookup).filter((lookup): lookup is Lookup => Boolean(lookup));
  } catch {
    return [];
  }
}

export function getLookup(id: string): Lookup | null {
  return getLookups().find((lookup) => lookup.id === id) ?? null;
}

export function updateLookup(
  id: string,
  patch: Partial<Pick<Lookup, "rating" | "correction" | "notes">>,
): StorageResult<Lookup | null> {
  const lookups = getLookups();
  const index = lookups.findIndex((lookup) => lookup.id === id);

  if (index === -1) {
    return { ok: false, message: "This saved scan was not found.", value: null };
  }

  const patchData = sanitizePatch(patch);
  const updatedLookup = {
    ...lookups[index],
    ...patchData,
  };
  updatedLookup.trainingStatus = getTrainingStatus(updatedLookup.rating, updatedLookup.correction);
  updatedLookup.trainingLabel = getTrainingLabel(updatedLookup.result, updatedLookup.correction);
  updatedLookup.scanCategory = categorizeScan(updatedLookup.result, updatedLookup.correction ?? undefined);

  const updatedLookups = [...lookups];
  updatedLookups[index] = updatedLookup;

  const writeResult = writeLookups(updatedLookups);
  return writeResult.ok
    ? { ok: true, value: updatedLookup }
    : { ok: false, message: writeResult.message, value: updatedLookup };
}

export function deleteLookup(id: string): StorageResult<boolean> {
  const existing = getLookups();
  const next = existing.filter((lookup) => lookup.id !== id);

  if (next.length === existing.length) {
    return { ok: false, message: "This saved scan was already deleted.", value: false };
  }

  const writeResult = writeLookups(next);
  return writeResult.ok ? { ok: true, value: true } : { ok: false, message: writeResult.message, value: false };
}

export function scanStateFromLookup(lookup: Lookup): ScanAnalysisState {
  return {
    frame: lookup.frame,
    result: lookup.result,
    errorMessage: lookup.errorMessage,
    errorCode: lookup.errorCode,
    analyzedAt: lookup.analyzedAt,
  };
}

function writeLookups(lookups: Lookup[]): StorageResult<Lookup[]> {
  if (!hasLocalStorage()) {
    return {
      ok: false,
      message: "Saved scans are not available in this browser.",
      value: lookups,
    };
  }

  try {
    localStorage.setItem(LOOKUPS_STORAGE_KEY, JSON.stringify(lookups));
    return { ok: true, value: lookups };
  } catch (error) {
    return {
      ok: false,
      message: isQuotaError(error)
        ? "Your device storage is full. Delete older saved scans, then try again."
        : "Deep Spec could not save this scan on this device.",
      value: lookups,
    };
  }
}

function sanitizePatch(patch: Partial<Pick<Lookup, "rating" | "correction" | "notes">>) {
  const sanitized: Partial<Pick<Lookup, "rating" | "correction" | "notes">> = {};

  if ("rating" in patch && isRating(patch.rating)) {
    sanitized.rating = patch.rating;
  }

  if ("correction" in patch) {
    sanitized.correction = typeof patch.correction === "string" ? patch.correction.slice(0, 240) : null;
  }

  if ("notes" in patch && typeof patch.notes === "string") {
    sanitized.notes = patch.notes.slice(0, 500);
  }

  return sanitized;
}

function normalizeLookup(value: unknown): Lookup | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const lookup = value as Partial<Lookup>;
  if (
    typeof lookup.id !== "string" ||
    typeof lookup.createdAt !== "string" ||
    typeof lookup.frame?.imageBase64 !== "string" ||
    typeof lookup.frame?.capturedAt !== "string" ||
    !isRating(lookup.rating) ||
    (lookup.correction !== null && typeof lookup.correction !== "string") ||
    typeof lookup.notes !== "string" ||
    !Array.isArray(lookup.chatHistory)
  ) {
    return null;
  }

  const scanCategory = isScanCategory(lookup.scanCategory)
    ? lookup.scanCategory
    : categorizeScan(lookup.result, lookup.correction ?? undefined);
  const trainingStatus = isTrainingStatus(lookup.trainingStatus)
    ? lookup.trainingStatus
    : getTrainingStatus(lookup.rating, lookup.correction);

  return {
    id: lookup.id,
    createdAt: lookup.createdAt,
    frame: lookup.frame,
    result: lookup.result,
    errorMessage: lookup.errorMessage,
    errorCode: lookup.errorCode,
    analyzedAt: lookup.analyzedAt,
    rating: lookup.rating,
    correction: lookup.correction,
    notes: lookup.notes,
    scanCategory,
    trainingLabel: typeof lookup.trainingLabel === "string" ? lookup.trainingLabel : getTrainingLabel(lookup.result, lookup.correction),
    trainingStatus,
    chatHistory: lookup.chatHistory,
  };
}

function isRating(value: unknown): value is Rating {
  return value === "up" || value === "down" || value === null;
}

function isScanCategory(value: unknown): value is ScanCategory {
  return (
    value === "engine" ||
    value === "electrical" ||
    value === "brakes" ||
    value === "steering" ||
    value === "suspension" ||
    value === "fuel" ||
    value === "airbag" ||
    value === "body" ||
    value === "leak" ||
    value === "unknown"
  );
}

function isTrainingStatus(value: unknown): value is TrainingStatus {
  return value === "raw_unreviewed" || value === "user_confirmed" || value === "user_corrected";
}

function getTrainingStatus(rating: Rating | undefined, correction: string | null | undefined): TrainingStatus {
  if (correction?.trim()) {
    return "user_corrected";
  }

  if (rating === "up") {
    return "user_confirmed";
  }

  return "raw_unreviewed";
}

function getTrainingLabel(result: IdentificationResult | undefined, correction: string | null | undefined) {
  return correction?.trim() || result?.partName || "unlabeled";
}

function categorizeScan(result?: IdentificationResult, correction?: string): ScanCategory {
  const text = [correction, result?.partName, result?.whatItDoes, ...(result?.visibleObservations ?? []), ...(result?.concerns ?? [])]
    .join(" ")
    .toLowerCase();

  if (/airbag|srs/.test(text)) return "airbag";
  if (/brake|caliper|rotor|pad/.test(text)) return "brakes";
  if (/steering|tie rod|rack and pinion/.test(text)) return "steering";
  if (/suspension|control arm|strut|shock|ball joint/.test(text)) return "suspension";
  if (/fuel|gas|injector|fuel line|tank/.test(text)) return "fuel";
  if (/leak|oil|coolant|fluid/.test(text)) return "leak";
  if (/battery|alternator|starter|wire|wiring|connector|fuse|sensor|electrical/.test(text)) return "electrical";
  if (/bumper|fender|door|panel|body/.test(text)) return "body";
  if (/engine|belt|hose|radiator|thermostat|filter|intake|manifold/.test(text)) return "engine";

  return "unknown";
}

function hasLocalStorage() {
  return typeof localStorage !== "undefined";
}

function createId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `lookup-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function isQuotaError(error: unknown) {
  return error instanceof DOMException && (error.name === "QuotaExceededError" || error.name === "NS_ERROR_DOM_QUOTA_REACHED");
}
