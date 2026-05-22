import type { ChatMessage, Confidence, IdentificationResult, Lookup, Rating, ScanAnalysisState, ScanCategory, TrainingStatus } from "../types";

export const LOOKUPS_STORAGE_KEY = "deep-spec:lookups";
export const MAX_SAVED_LOOKUPS = 50;
const MAX_CHAT_MESSAGES = 40;
const CHAT_KEY = (id: string) => `deep-spec:chat:${id}`;

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
  const lookup = getLookups().find((l) => l.id === id) ?? null;
  if (!lookup) return null;
  return mergeLookupChatHistory(lookup);
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

export function updateLookupResult(
  id: string,
  result: IdentificationResult,
): StorageResult<Lookup | null> {
  const lookups = getLookups();
  const index = lookups.findIndex((lookup) => lookup.id === id);

  if (index === -1) {
    return { ok: false, message: "This saved scan was not found.", value: null };
  }

  const existing = lookups[index];
  const updatedLookup: Lookup = {
    ...existing,
    result,
    errorMessage: undefined,
    errorCode: undefined,
    analyzedAt: new Date().toISOString(),
    scanCategory: categorizeScan(result, existing.correction ?? undefined),
    trainingLabel: getTrainingLabel(result, existing.correction),
    trainingStatus: getTrainingStatus(existing.rating, existing.correction),
  };

  const updatedLookups = [...lookups];
  updatedLookups[index] = updatedLookup;

  const writeResult = writeLookups(updatedLookups);
  return writeResult.ok
    ? { ok: true, value: updatedLookup }
    : { ok: false, message: writeResult.message, value: updatedLookup };
}


export function createChatMessage(role: ChatMessage["role"], content: string): ChatMessage {
  return {
    id: createId(),
    role,
    content: cleanText(content, role === "user" ? 500 : 1200),
    timestamp: new Date().toISOString(),
  };
}

export function appendChatMessages(id: string, messages: ChatMessage[]): StorageResult<Lookup | null> {
  const lookup = getLookup(id);
  if (!lookup) {
    return { ok: false, message: "This saved scan was not found.", value: null };
  }

  const cleanMessages = messages.map(normalizeChatMessage).filter((message): message is ChatMessage => Boolean(message));
  if (cleanMessages.length === 0) {
    return { ok: true, value: lookup };
  }

  const updatedHistory = [...lookup.chatHistory, ...cleanMessages].slice(-MAX_CHAT_MESSAGES);
  const updatedLookup: Lookup = { ...lookup, chatHistory: updatedHistory };
  const lookups = getLookups();
  const index = lookups.findIndex((storedLookup) => storedLookup.id === id);

  if (index === -1) {
    return { ok: false, message: "This saved scan was not found.", value: null };
  }

  const updatedLookups = [...lookups];
  updatedLookups[index] = updatedLookup;

  const lookupWriteResult = writeLookups(updatedLookups);
  if (!lookupWriteResult.ok) {
    return { ok: false, message: lookupWriteResult.message, value: updatedLookup };
  }

  const chatWriteResult = writeChatHistory(id, updatedHistory);
  if (!chatWriteResult.ok) {
    try {
      localStorage.removeItem(CHAT_KEY(id));
    } catch {
      // Fall back to the parent lookup record if the per-scan chat key cannot be updated.
    }
    return { ok: false, message: chatWriteResult.message, value: updatedLookup };
  }

  return { ok: true, value: updatedLookup };
}

export function deleteLookup(id: string): StorageResult<boolean> {
  const existing = getLookups();
  const next = existing.filter((lookup) => lookup.id !== id);

  if (next.length === existing.length) {
    return { ok: false, message: "This saved scan was already deleted.", value: false };
  }

  const writeResult = writeLookups(next);
  if (writeResult.ok && hasLocalStorage()) {
    try { localStorage.removeItem(CHAT_KEY(id)); } catch { /* ignore */ }
  }
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

function mergeLookupChatHistory(lookup: Lookup): Lookup {
  if (!hasLocalStorage()) return lookup;
  try {
    const raw = localStorage.getItem(CHAT_KEY(lookup.id));
    if (!raw) return lookup;
    const parsed = JSON.parse(raw) as unknown;
    const chatHistory = normalizeChatHistory(parsed);
    if (chatHistory.length === 0) return lookup;
    return { ...lookup, chatHistory };
  } catch {
    return lookup;
  }
}

function writeChatHistory(id: string, history: ChatMessage[]): StorageResult<ChatMessage[]> {
  if (!hasLocalStorage()) {
    return { ok: false, message: "Saved scans are not available in this browser.", value: history };
  }
  try {
    localStorage.setItem(CHAT_KEY(id), JSON.stringify(history));
    return { ok: true, value: history };
  } catch (error) {
    return {
      ok: false,
      message: isQuotaError(error)
        ? "Your device storage is full. Delete older saved scans, then try again."
        : "Deep Spec could not save this scan on this device.",
      value: history,
    };
  }
}

function writeLookups(lookups: Lookup[]): StorageResult<Lookup[]> {
  const cappedLookups = lookups.slice(0, MAX_SAVED_LOOKUPS);

  if (!hasLocalStorage()) {
    return {
      ok: false,
      message: "Saved scans are not available in this browser.",
      value: cappedLookups,
    };
  }

  try {
    localStorage.setItem(LOOKUPS_STORAGE_KEY, JSON.stringify(cappedLookups));
    return { ok: true, value: cappedLookups };
  } catch (error) {
    return {
      ok: false,
      message: isQuotaError(error)
        ? "Your device storage is full. Delete older saved scans, then try again."
        : "Deep Spec could not save this scan on this device.",
      value: cappedLookups,
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
    typeof lookup.frame?.capturedAt !== "string"
  ) {
    return null;
  }

  const rating = isRating(lookup.rating) ? lookup.rating : null;
  const correction = typeof lookup.correction === "string" ? lookup.correction : null;
  const notes = typeof lookup.notes === "string" ? lookup.notes : "";
  const result = normalizeStoredIdentificationResult(lookup.result, correction ?? undefined);
  const scanCategory = isScanCategory(lookup.scanCategory) ? lookup.scanCategory : categorizeScan(result, correction ?? undefined);
  const trainingStatus = isTrainingStatus(lookup.trainingStatus)
    ? lookup.trainingStatus
    : getTrainingStatus(rating, correction);

  return {
    id: lookup.id,
    createdAt: lookup.createdAt,
    frame: lookup.frame,
    result,
    errorMessage: lookup.errorMessage,
    errorCode: lookup.errorCode,
    analyzedAt: lookup.analyzedAt,
    rating,
    correction,
    notes,
    scanCategory,
    trainingLabel: typeof lookup.trainingLabel === "string" ? lookup.trainingLabel : getTrainingLabel(result, correction),
    trainingStatus,
    chatHistory: normalizeChatHistory(lookup.chatHistory),
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

function isConfidence(value: unknown): value is Confidence {
  return value === "high" || value === "medium" || value === "low";
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

function getTrainingLabel(result: Partial<IdentificationResult> | undefined, correction: string | null | undefined) {
  return correction?.trim() || result?.partName || "unlabeled";
}

function categorizeScan(result?: Partial<IdentificationResult>, correction?: string): ScanCategory {
  if (correction?.trim()) {
    const correctedCategory = categorizeText(correction);
    if (correctedCategory !== "unknown") {
      return correctedCategory;
    }
  }

  if (isScanCategory(result?.scanCategory)) {
    return result.scanCategory;
  }

  const text = [correction, result?.partName, result?.whatItDoes, ...(result?.visibleObservations ?? []), ...(result?.concerns ?? [])]
    .join(" ")
    .toLowerCase();

  return categorizeText(text);
}

function categorizeText(text: string): ScanCategory {
  const normalized = text.toLowerCase();

  if (/airbag|srs/.test(normalized)) return "airbag";
  if (/brake|caliper|rotor|pad/.test(normalized)) return "brakes";
  if (/steering|tie rod|rack and pinion/.test(normalized)) return "steering";
  if (/suspension|control arm|strut|shock|ball joint/.test(normalized)) return "suspension";
  if (/fuel|gas|injector|fuel line|tank/.test(normalized)) return "fuel";
  if (/leak|oil|coolant|fluid/.test(normalized)) return "leak";
  if (/battery|alternator|starter|wire|wiring|connector|fuse|sensor|electrical/.test(normalized)) return "electrical";
  if (/bumper|fender|door|panel|body/.test(normalized)) return "body";
  if (/engine|belt|hose|radiator|thermostat|filter|intake|manifold/.test(normalized)) return "engine";

  return "unknown";
}

function normalizeStoredIdentificationResult(value: unknown, correction?: string): IdentificationResult | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }

  const result = value as Partial<IdentificationResult>;
  if (
    typeof result.partName !== "string" ||
    !isConfidence(result.confidence) ||
    typeof result.whatItDoes !== "string" ||
    !Array.isArray(result.visibleObservations) ||
    !Array.isArray(result.concerns) ||
    !Array.isArray(result.evidence) ||
    typeof result.nextAction !== "string" ||
    typeof result.needsBetterPhoto !== "boolean" ||
    typeof result.isSafetyCritical !== "boolean" ||
    (result.safetyTriage !== "can_help" && result.safetyTriage !== "needs_better_photo" && result.safetyTriage !== "needs_professional")
  ) {
    return undefined;
  }

  return {
    partName: cleanText(result.partName, 80),
    confidence: result.confidence,
    scanCategory: isScanCategory(result.scanCategory) ? result.scanCategory : categorizeScan(result, correction),
    whatItDoes: cleanText(result.whatItDoes, 500),
    visibleObservations: cleanStringArray(result.visibleObservations, 6, 180),
    concerns: cleanStringArray(result.concerns, 6, 180),
    safetyTriage: result.safetyTriage,
    isSafetyCritical: result.isSafetyCritical,
    nextAction: cleanText(result.nextAction, 500),
    needsBetterPhoto: result.needsBetterPhoto,
    evidence: cleanStringArray(result.evidence, 8, 320),
  };
}

function normalizeChatHistory(value: unknown): ChatMessage[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map(normalizeChatMessage).filter((message): message is ChatMessage => Boolean(message)).slice(-MAX_CHAT_MESSAGES);
}

function normalizeChatMessage(value: unknown): ChatMessage | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const message = value as Partial<ChatMessage>;
  if (!isChatRole(message.role) || typeof message.content !== "string" || typeof message.timestamp !== "string") {
    return null;
  }

  return {
    id: typeof message.id === "string" ? message.id : createId(),
    role: message.role,
    content: cleanText(message.content, message.role === "user" ? 500 : 1200),
    timestamp: message.timestamp,
  };
}

function isChatRole(value: unknown): value is ChatMessage["role"] {
  return value === "user" || value === "assistant";
}

function cleanText(value: string, maxLength: number) {
  return value.trim().replace(/\s+/g, " ").slice(0, maxLength);
}

function cleanStringArray(value: unknown[], maxItems: number, maxItemLength: number) {
  return value.filter((item): item is string => typeof item === "string").map((item) => cleanText(item, maxItemLength)).filter(Boolean).slice(0, maxItems);
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
