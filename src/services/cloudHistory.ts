import { getAuthClient, isSupabaseAuthConfigured } from "./auth";
import type {
  CandidateMatch,
  ChatMessage,
  Confidence,
  EvidenceRegion,
  IdentificationResult,
  Lookup,
  Rating,
  ScanCategory,
  SourceLink,
  TrainingStatus,
} from "../types";

const SCAN_BUCKET = "scan-images";
const SIGNED_URL_TTL_SECONDS = 60 * 60;
const DEFAULT_HISTORY_LIMIT = 200;
const FALLBACK_IMAGE = "/brand/deepspec-logo.png";

type CloudHistoryRow = {
  local_id: unknown;
  created_at: unknown;
  captured_at: unknown;
  analyzed_at: unknown;
  error_code: unknown;
  error_message: unknown;
  rating: unknown;
  correction: unknown;
  notes: unknown;
  scan_category: unknown;
  training_label: unknown;
  training_status: unknown;
  chat_history: unknown;
  result_json: unknown;
  image_path: unknown;
};

type SignedImageRow = {
  path?: unknown;
  signedUrl?: unknown;
  signedURL?: unknown;
  error?: unknown;
};

type ReadCloudHistoryResult =
  | { ok: true; value: Lookup[] }
  | { ok: false; message: string };

export async function readCloudLookups(limit = DEFAULT_HISTORY_LIMIT): Promise<ReadCloudHistoryResult> {
  if (!isSupabaseAuthConfigured()) {
    return { ok: false, message: "Supabase auth is not configured for this build." };
  }

  const supabase = await getAuthClient();
  if (!supabase) {
    return { ok: false, message: "Supabase auth is not configured for this build." };
  }

  const userResult = await supabase.auth.getUser();
  if (userResult.error || !userResult.data.user) {
    return { ok: false, message: "No verified Supabase session was found." };
  }

  const rowsResult = await supabase
    .from("scan_lookups")
    .select("local_id,created_at,captured_at,analyzed_at,error_code,error_message,rating,correction,notes,scan_category,training_label,training_status,chat_history,result_json,image_path")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (rowsResult.error) {
    return { ok: false, message: rowsResult.error.message };
  }

  const rows = Array.isArray(rowsResult.data) ? (rowsResult.data as CloudHistoryRow[]) : [];
  const signedImageMap = await getSignedImageMap(supabase, rows);
  const lookups = rows
    .map((row, index) => mapCloudRowToLookup(row, signedImageMap, index))
    .filter((lookup): lookup is Lookup => Boolean(lookup));

  return { ok: true, value: lookups };
}

async function getSignedImageMap(
  supabase: NonNullable<Awaited<ReturnType<typeof getAuthClient>>>,
  rows: CloudHistoryRow[],
) {
  const map = new Map<string, string>();
  const paths = [...new Set(rows.map((row) => row.image_path).filter(isString))];

  if (!paths.length) {
    return map;
  }

  const signedResult = await supabase.storage.from(SCAN_BUCKET).createSignedUrls(paths, SIGNED_URL_TTL_SECONDS);
  if (signedResult.error || !Array.isArray(signedResult.data)) {
    return map;
  }

  for (const entry of signedResult.data as SignedImageRow[]) {
    const path = isString(entry.path) ? entry.path : null;
    const signedUrl = isString(entry.signedUrl)
      ? entry.signedUrl
      : isString(entry.signedURL)
        ? entry.signedURL
        : null;

    if (!path || !signedUrl) {
      continue;
    }

    map.set(path, signedUrl);
  }

  return map;
}

function mapCloudRowToLookup(
  row: CloudHistoryRow,
  signedImageMap: Map<string, string>,
  index: number,
): Lookup | null {
  const createdAt = isString(row.created_at) ? row.created_at : new Date().toISOString();
  const imagePath = isString(row.image_path) ? row.image_path : "";
  const scanCategory = parseScanCategory(row.scan_category);
  const result = parseIdentificationResult(row.result_json, scanCategory);
  const correction = isString(row.correction) ? row.correction : null;

  return {
    id: isString(row.local_id) ? row.local_id : `cloud-${index}`,
    createdAt,
    frame: {
      imageBase64: signedImageMap.get(imagePath) ?? FALLBACK_IMAGE,
      capturedAt: isString(row.captured_at) ? row.captured_at : createdAt,
    },
    analyzedAt: isString(row.analyzed_at) ? row.analyzed_at : undefined,
    errorCode: isString(row.error_code) ? row.error_code : undefined,
    errorMessage: isString(row.error_message) ? row.error_message : undefined,
    rating: parseRating(row.rating),
    correction,
    notes: isString(row.notes) ? row.notes : "",
    scanCategory,
    trainingLabel: isString(row.training_label)
      ? row.training_label
      : correction?.trim() || result?.partName || "unlabeled",
    trainingStatus: parseTrainingStatus(row.training_status),
    chatHistory: parseChatHistory(row.chat_history),
    result,
  };
}

function parseIdentificationResult(value: unknown, fallbackCategory: ScanCategory): IdentificationResult | undefined {
  if (!isObject(value)) {
    return undefined;
  }

  const partName = isString(value.partName) ? value.partName.trim() : "";
  if (!partName) {
    return undefined;
  }

  return {
    partName,
    confidence: parseConfidence(value.confidence),
    scanCategory: parseScanCategory(value.scanCategory, fallbackCategory),
    candidateMatches: parseCandidateMatches(value.candidateMatches),
    whatItDoes: isString(value.whatItDoes) ? value.whatItDoes : "",
    visibleObservations: parseStringList(value.visibleObservations, 8, 220),
    evidenceRegions: parseEvidenceRegions(value.evidenceRegions),
    concerns: parseStringList(value.concerns, 8, 220),
    safetyTriage: parseSafetyTriage(value.safetyTriage),
    isSafetyCritical: value.isSafetyCritical === true,
    nextAction: isString(value.nextAction) ? value.nextAction : "",
    needsBetterPhoto: value.needsBetterPhoto === true,
    evidence: parseStringList(value.evidence, 12, 320),
    sourceLinks: parseSourceLinks(value.sourceLinks),
  };
}

function parseCandidateMatches(value: unknown): CandidateMatch[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter(isObject)
    .map((item) => ({
      partName: isString(item.partName) ? item.partName : "",
      confidence: parseConfidence(item.confidence),
      scanCategory: parseScanCategory(item.scanCategory),
      reason: isString(item.reason) ? item.reason : "",
    }))
    .filter((item) => Boolean(item.partName));
}

function parseEvidenceRegions(value: unknown): EvidenceRegion[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter(isObject)
    .map((item) => ({
      label: isString(item.label) ? item.label : "",
      observation: isString(item.observation) ? item.observation : "",
      regionLabel: isString(item.regionLabel) ? item.regionLabel : "",
    }))
    .filter((item) => Boolean(item.label || item.observation));
}

function parseSourceLinks(value: unknown): SourceLink[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter(isObject)
    .map((item) => ({
      label: isString(item.label) ? item.label : "",
      url: isString(item.url) ? item.url : "",
      sourceType: parseSourceType(item.sourceType),
    }))
    .filter((item) => Boolean(item.label && item.url));
}

function parseChatHistory(value: unknown): ChatMessage[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter(isObject)
    .map((item): ChatMessage => ({
      id: isString(item.id) ? item.id : `chat-${Math.random().toString(16).slice(2)}`,
      role: item.role === "assistant" ? "assistant" : "user",
      content: isString(item.content) ? item.content : "",
      timestamp: isString(item.timestamp) ? item.timestamp : new Date().toISOString(),
    }))
    .filter((item) => item.content.length > 0);
}

function parseStringList(value: unknown, maxItems: number, maxLength: number) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter(isString)
    .map((item) => item.trim().slice(0, maxLength))
    .filter(Boolean)
    .slice(0, maxItems);
}

function parseConfidence(value: unknown): Confidence {
  return value === "high" || value === "medium" || value === "low" ? value : "low";
}

function parseScanCategory(value: unknown, fallback: ScanCategory = "unknown"): ScanCategory {
  return value === "engine"
    || value === "electrical"
    || value === "brakes"
    || value === "steering"
    || value === "suspension"
    || value === "fuel"
    || value === "airbag"
    || value === "body"
    || value === "leak"
    || value === "unknown"
    ? value
    : fallback;
}

function parseSafetyTriage(value: unknown): IdentificationResult["safetyTriage"] {
  return value === "needs_better_photo" || value === "needs_professional" || value === "can_help"
    ? value
    : "can_help";
}

function parseRating(value: unknown): Rating {
  return value === "up" || value === "down" ? value : null;
}

function parseTrainingStatus(value: unknown): TrainingStatus {
  return value === "user_confirmed" || value === "user_corrected" || value === "raw_unreviewed"
    ? value
    : "raw_unreviewed";
}

function parseSourceType(value: unknown): SourceLink["sourceType"] {
  return value === "dataset" || value === "reference" || value === "search" || value === "safety"
    ? value
    : "reference";
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}
