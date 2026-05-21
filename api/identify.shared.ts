import { IDENTIFY_PROMPT } from "../src/services/systemPrompts";
import { SCAN_CATEGORIES, type IdentificationResult, type ScanCategory } from "../src/types";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

type JsonObject = Record<string, unknown>;
type LabelRescueTrigger = "too_blurry";

export type IdentifyResponse =
  | {
      status: 200;
      body: {
        result: IdentificationResult;
      };
    }
  | {
      status: number;
      body: {
        error: {
          code: string;
          message: string;
        };
      };
    };

const DEFAULT_MODEL = "gemini-2.5-flash";
const DEFAULT_OCR_MODEL = "microsoft/trocr-large-printed";
const IDENTIFY_MAX_OUTPUT_TOKENS = 2048;
const DEFAULT_DATASET_ROOT = "datasets/raw/drbimmer-car-parts-and-damage-dataset";
const DEFAULT_DATASET_INDEX_PATH = "datasets/derived/drbimmer-car-parts-and-damage-dataset/records.jsonl";

const IDENTIFICATION_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    partName: { type: "string" },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    scanCategory: { type: "string", enum: [...SCAN_CATEGORIES] },
    whatItDoes: { type: "string" },
    visibleObservations: {
      type: "array",
      items: { type: "string" },
    },
    concerns: {
      type: "array",
      items: { type: "string" },
    },
    safetyTriage: { type: "string", enum: ["can_help", "needs_better_photo", "needs_professional"] },
    isSafetyCritical: { type: "boolean" },
    nextAction: { type: "string" },
    needsBetterPhoto: { type: "boolean" },
    evidence: {
      type: "array",
      items: { type: "string" },
    },
  },
  required: [
    "partName",
    "confidence",
    "scanCategory",
    "whatItDoes",
    "visibleObservations",
    "concerns",
    "safetyTriage",
    "isSafetyCritical",
    "nextAction",
    "needsBetterPhoto",
    "evidence",
  ],
};

export async function createIdentifyResponse(body: unknown, env: Record<string, string | undefined>): Promise<IdentifyResponse> {
  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) {
    return errorResponse(500, "not_configured", "Deep Spec AI is not configured. Add GEMINI_API_KEY on the server.");
  }

  const parsed = parseIdentifyRequest(body);
  if ("error" in parsed) {
    return parsed.error;
  }

  const model = env.GEMINI_MODEL || DEFAULT_MODEL;
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const ocr = shouldRunOcr(parsed) ? await runOcrFallback(parsed, env) : null;

  const startedAt = Date.now();
  const response = await fetch(endpoint, {
    method: "POST",
    signal: AbortSignal.timeout(25_000),
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      system_instruction: {
        parts: [{ text: IDENTIFY_PROMPT }],
      },
      contents: [
        {
          role: "user",
          parts: [
            {
              inline_data: {
                mime_type: parsed.mimeType,
                data: parsed.base64,
              },
            },
            ...(parsed.base64_2 && parsed.mimeType_2
              ? [{ inline_data: { mime_type: parsed.mimeType_2, data: parsed.base64_2 } }]
              : []),
            ...(ocr?.text ? [{ text: buildOcrContext(ocr.text) }] : []),
            { text: parsed.userMessage },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: IDENTIFY_MAX_OUTPUT_TOKENS,
        responseMimeType: "application/json",
        responseJsonSchema: IDENTIFICATION_RESPONSE_SCHEMA,
      },
    }),
  }).catch(() => null);

  if (!response) {
    return errorResponse(502, "network", "Deep Spec could not reach Gemini.");
  }

  if (response.status === 429) {
    return errorResponse(429, "rate_limited", "Too many AI lookups right now. Try again in a few minutes.");
  }

  const isJson = (response.headers.get("content-type") ?? "").includes("application/json");
  const responseBody = isJson ? ((await response.json().catch(() => null)) as JsonObject | null) : null;

  if (!response.ok) {
    return errorResponse(response.status, "provider_error", getProviderErrorMessage(responseBody));
  }

  const text = extractGeminiText(responseBody);
  if (!text) {
    return errorResponse(502, "invalid_response", "Gemini did not return a usable answer.");
  }

  const result = parseIdentificationResult(text);
  if (!result) {
    return errorResponse(502, "invalid_response", "Gemini returned JSON that Deep Spec could not read.");
  }

  const normalizedResult = normalizeIdentificationResult(result, ocr?.text ?? null, env);

  console.info("[DeepSpec AI]", {
    model,
    latencyMs: Date.now() - startedAt,
    success: true,
    confidence: normalizedResult.confidence,
    scanCategory: normalizedResult.scanCategory,
    safetyTriage: normalizedResult.safetyTriage,
    ocrUsed: Boolean(ocr?.text),
  });

  return {
    status: 200,
    body: {
      result: normalizedResult,
    },
  };
}

function parseIdentifyRequest(body: unknown):
  | {
      base64: string;
      mimeType: string;
      base64_2: string | null;
      mimeType_2: string | null;
      userMessage: string;
      labelRescueTrigger: LabelRescueTrigger | null;
    }
  | { error: IdentifyResponse } {
  if (!isRecord(body) || typeof body.imageBase64 !== "string") {
    return { error: errorResponse(400, "invalid_input", "A captured image is required.") };
  }

  // ~10 MB decoded; check length before running the regex on a giant string
  if (body.imageBase64.length > 14_000_000) {
    return { error: errorResponse(400, "image_too_large", "The captured image is too large. Try a lower-resolution photo.") };
  }

  const parsedImage = parseDataUrl(body.imageBase64);
  if (!parsedImage) {
    return { error: errorResponse(400, "invalid_input", "The captured image must be a JPEG, PNG, or WebP data URL.") };
  }

  // Optional second image — silently ignored if invalid or oversized
  let base64_2: string | null = null;
  let mimeType_2: string | null = null;
  if (typeof body.imageBase64_2 === "string" && body.imageBase64_2.length <= 14_000_000) {
    const parsed2 = parseDataUrl(body.imageBase64_2);
    if (parsed2) {
      base64_2 = parsed2.base64;
      mimeType_2 = parsed2.mimeType;
    }
  }

  const hasSecond = base64_2 !== null;
  return {
    base64: parsedImage.base64,
    mimeType: parsedImage.mimeType,
    base64_2,
    mimeType_2,
    userMessage:
      typeof body.userMessage === "string" && body.userMessage.trim()
        ? body.userMessage.trim().slice(0, 500)
        : hasSecond
          ? "Identify this car part from two photos taken from slightly different angles."
          : "Identify this car part from the captured photo.",
    labelRescueTrigger: body.labelRescueTrigger === "too_blurry" ? "too_blurry" : null,
  };
}

function parseDataUrl(dataUrl: string) {
  const match = dataUrl.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!match) {
    return null;
  }

  return {
    mimeType: match[1],
    base64: match[2],
  };
}

function extractGeminiText(responseBody: JsonObject | null) {
  const candidates = Array.isArray(responseBody?.candidates) ? responseBody.candidates : [];
  const firstCandidate = candidates[0];
  if (!isRecord(firstCandidate) || !isRecord(firstCandidate.content) || !Array.isArray(firstCandidate.content.parts)) {
    return null;
  }

  return firstCandidate.content.parts
    .map((part) => (isRecord(part) && typeof part.text === "string" ? part.text : ""))
    .join("")
    .trim();
}

function parseIdentificationResult(text: string): IdentificationResult | null {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!isIdentificationResult(parsed)) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

function normalizeIdentificationResult(
  result: IdentificationResult,
  ocrText: string | null = null,
  env: Record<string, string | undefined> = {},
): IdentificationResult {
  const safetyTriage = result.isSafetyCritical ? "needs_professional" : result.safetyTriage;
  const needsBetterPhoto = result.needsBetterPhoto || safetyTriage === "needs_better_photo";
  const cleanEvidence = appendDatasetEvidence(appendOcrEvidence(cleanList(result.evidence), ocrText), result, env);

  return {
    ...result,
    partName: cleanText(result.partName, "Unidentified car part"),
    scanCategory: getTrustedCategory(result),
    whatItDoes: cleanText(result.whatItDoes, "Deep Spec could not verify what this part does from this photo."),
    visibleObservations: cleanList(result.visibleObservations),
    concerns: cleanList(result.concerns),
    evidence: cleanEvidence,
    nextAction:
      safetyTriage === "needs_professional"
        ? ensureProfessionalNextAction(result.nextAction)
        : cleanText(result.nextAction, "Take a clearer photo from another angle before acting on this result."),
    safetyTriage,
    needsBetterPhoto,
  };
}

function appendDatasetEvidence(evidence: string[], result: IdentificationResult, env: Record<string, string | undefined>) {
  const matches = findDatasetMatches(result, env);
  if (!matches.length) {
    return evidence;
  }

  const existingEvidence = new Set(evidence.map((item) => item.toLowerCase()));
  const datasetEvidence = matches.flatMap((match) => formatDatasetEvidence(match))
    .filter((item) => !existingEvidence.has(item.toLowerCase()));

  return [...evidence, ...datasetEvidence].slice(0, 8);
}

type DatasetMatch = {
  kind: "part" | "damage";
  label: string;
  score: number;
  sampleCount?: number;
  sourceUrl?: string | null;
};

function findDatasetMatches(result: IdentificationResult, env: Record<string, string | undefined>): DatasetMatch[] {
  const datasetIndexPath = resolve(process.cwd(), env.DEEPSPEC_DATASET_INDEX_PATH || DEFAULT_DATASET_INDEX_PATH);
  const datasetRecords = readDatasetRecords(datasetIndexPath);
  const datasetRoot = resolve(process.cwd(), env.DEEPSPEC_DATASET_ROOT || DEFAULT_DATASET_ROOT);
  const text = normalizeMatchText(
    [
      result.partName,
      result.whatItDoes,
      ...result.visibleObservations,
      ...result.concerns,
      ...result.evidence,
    ].join(" "),
  );

  if (datasetRecords.length) {
    return findDatasetRecordMatches(datasetRecords, text);
  }

  return findRawMetadataMatches(datasetRoot, text);
}

function findRawMetadataMatches(datasetRoot: string, text: string): DatasetMatch[] {
  const labelSets = [
    {
      kind: "part" as const,
      labels: readDatasetClassTitles(resolve(datasetRoot, "Car damages dataset", "meta.json")),
    },
    {
      kind: "damage" as const,
      labels: readDatasetClassTitles(resolve(datasetRoot, "Car parts dataset", "meta.json")),
    },
  ];

  return labelSets
    .map(({ kind, labels }) => findBestLabelMatch(kind, labels, text))
    .filter((match): match is DatasetMatch => Boolean(match))
    .sort((a, b) => b.score - a.score);
}

type DatasetRecord = {
  canonicalKind?: unknown;
  labels?: unknown;
  links?: unknown;
  primaryLabel?: unknown;
};

function readDatasetRecords(indexPath: string): DatasetRecord[] {
  if (!existsSync(indexPath)) {
    return [];
  }

  try {
    return readFileSync(indexPath, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as unknown)
      .filter(isRecord);
  } catch {
    return [];
  }
}

function findDatasetRecordMatches(records: DatasetRecord[], text: string): DatasetMatch[] {
  const labelGroups = new Map<string, DatasetMatch>();

  for (const record of records) {
    const kind = record.canonicalKind === "damage" ? "damage" : record.canonicalKind === "part" ? "part" : null;
    if (!kind) {
      continue;
    }

    const labels = getRecordLabels(record);
    for (const label of labels) {
      const key = `${kind}:${label.toLowerCase()}`;
      const existing = labelGroups.get(key);
      const sourceUrl = existing?.sourceUrl ?? getRecordSourceUrl(record);

      labelGroups.set(key, {
        kind,
        label,
        sampleCount: (existing?.sampleCount ?? 0) + 1,
        score: existing?.score ?? 0,
        sourceUrl,
      });
    }
  }

  return [...labelGroups.values()]
    .map((match) => {
      const normalizedLabel = normalizeMatchText(match.label);
      const labelWords = normalizedLabel.split(" ").filter((word) => word.length > 2);
      return {
        ...match,
        score: scoreDatasetLabel(match.kind, normalizedLabel, labelWords, text),
      };
    })
    .filter((match) => match.score >= 2)
    .sort((a, b) => b.score - a.score || (b.sampleCount ?? 0) - (a.sampleCount ?? 0))
    .slice(0, 3);
}

function getRecordLabels(record: DatasetRecord) {
  const labels = Array.isArray(record.labels) ? record.labels.filter((label): label is string => typeof label === "string" && Boolean(label.trim())) : [];
  if (labels.length) {
    return labels;
  }

  return typeof record.primaryLabel === "string" && record.primaryLabel.trim() ? [record.primaryLabel.trim()] : [];
}

function getRecordSourceUrl(record: DatasetRecord) {
  if (!isRecord(record.links)) {
    return null;
  }

  return typeof record.links.image === "string" ? record.links.image : typeof record.links.dataset === "string" ? record.links.dataset : null;
}

function formatDatasetEvidence(match: DatasetMatch) {
  const sampleText =
    typeof match.sampleCount === "number"
      ? `, ${match.sampleCount} labeled sample${match.sampleCount === 1 ? "" : "s"}`
      : "";
  const evidence = [`Local dataset match: ${match.label} (${match.kind}${sampleText})`];

  if (match.sourceUrl) {
    evidence.push(`Dataset source: ${match.sourceUrl}`);
  }

  return evidence;
}

function readDatasetClassTitles(metaPath: string) {
  if (!existsSync(metaPath)) {
    return [];
  }

  try {
    const parsed = JSON.parse(readFileSync(metaPath, "utf8")) as unknown;
    if (!isRecord(parsed) || !Array.isArray(parsed.classes)) {
      return [];
    }

    return parsed.classes
      .map((item) => (isRecord(item) && typeof item.title === "string" ? item.title : ""))
      .filter(Boolean);
  } catch {
    return [];
  }
}

function findBestLabelMatch(kind: DatasetMatch["kind"], labels: string[], text: string): DatasetMatch | null {
  let best: DatasetMatch | null = null;

  for (const label of labels) {
    const normalizedLabel = normalizeMatchText(label);
    const labelWords = normalizedLabel.split(" ").filter((word) => word.length > 2);
    const score = scoreDatasetLabel(kind, normalizedLabel, labelWords, text);
    if (score > 0 && (!best || score > best.score)) {
      best = { kind, label, score };
    }
  }

  return best && best.score >= 2 ? best : null;
}

function scoreDatasetLabel(kind: DatasetMatch["kind"], label: string, labelWords: string[], text: string) {
  if (!label || !text) {
    return 0;
  }

  if (kind === "damage" && isNegatedDamageLabel(label, text)) {
    return 0;
  }

  if (text.includes(label)) {
    return 4 + labelWords.length;
  }

  const matchedWords = labelWords.filter((word) => text.includes(word));
  if (matchedWords.length === labelWords.length && labelWords.length > 0) {
    return 3 + matchedWords.length;
  }

  return matchedWords.length;
}

function isNegatedDamageLabel(label: string, text: string) {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  const beforeLabel = new RegExp(`\\b(no|not|without|free\\s+of|free\\s+from|none|absence\\s+of)\\b[^.]{0,80}\\b${escapedLabel}\\b`);
  const afterLabel = new RegExp(`\\b${escapedLabel}\\b[^.]{0,60}\\b(absent|not\\s+visible|not\\s+present|was\\s+not\\s+visible)\\b`);

  return beforeLabel.test(text) || afterLabel.test(text);
}

function normalizeMatchText(value: string) {
  return value
    .toLowerCase()
    .replace(/[-_/]/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function appendOcrEvidence(evidence: string[], ocrText: string | null) {
  if (!ocrText) {
    return evidence;
  }

  const ocrEvidence = `OCR label text: ${ocrText}`;
  if (evidence.some((item) => item.toLowerCase() === ocrEvidence.toLowerCase())) {
    return evidence;
  }

  return [...evidence, ocrEvidence].slice(0, 6);
}

function shouldRunOcr(parsed: { userMessage: string; labelRescueTrigger: LabelRescueTrigger | null }) {
  return (
    parsed.labelRescueTrigger === "too_blurry" ||
    /\b(label|part\s*(number|#)|serial|barcode|sticker|oem|printed|etched|stamp|stamped|text|low confidence)\b/i.test(parsed.userMessage)
  );
}

async function runOcrFallback(
  parsed: { base64: string; mimeType: string },
  env: Record<string, string | undefined>,
): Promise<{ text: string; model: string } | null> {
  const token = env.HUGGINGFACE_API_KEY || env.HF_API_TOKEN || env.HF_TOKEN;
  if (!token) {
    return null;
  }

  const model = env.HUGGINGFACE_OCR_MODEL || DEFAULT_OCR_MODEL;
  const endpoint = `https://api-inference.huggingface.co/models/${encodeURIComponent(model)}`;

  const response = await fetch(endpoint, {
    method: "POST",
    signal: AbortSignal.timeout(12_000),
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": parsed.mimeType,
      Accept: "application/json",
    },
    body: Buffer.from(parsed.base64, "base64"),
  }).catch(() => null);

  if (!response?.ok) {
    return null;
  }

  const body = (await response.json().catch(() => null)) as unknown;
  const text = cleanOcrText(extractOcrText(body));
  return text ? { text, model } : null;
}

function extractOcrText(body: unknown): string | null {
  if (Array.isArray(body)) {
    return body.map(extractOcrText).filter(Boolean).join(" ");
  }

  if (!isRecord(body)) {
    return null;
  }

  const generated = body.generated_text;
  if (typeof generated === "string") {
    return generated;
  }

  const text = body.text;
  if (typeof text === "string") {
    return text;
  }

  return null;
}

function cleanOcrText(value: string | null) {
  if (!value) {
    return null;
  }

  const cleaned = value
    .replace(/[^\w\s./#:-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (cleaned.length < 3 || !/[A-Za-z0-9]/.test(cleaned)) {
    return null;
  }

  return cleaned.slice(0, 160);
}

function buildOcrContext(text: string) {
  return [
    "OCR label rescue text extracted before visual identification:",
    text,
    "Use this only as visible label evidence. Do not invent OEM fitment, pricing, or compatibility from it.",
  ].join("\n");
}

function ensureProfessionalNextAction(nextAction: string) {
  const cleaned = cleanText(nextAction, "Verify this part with a mechanic before driving or attempting repair.");
  return /mechanic|professional|shop/i.test(cleaned)
    ? cleaned
    : `${cleaned} Verify this with a mechanic before driving or attempting repair.`;
}

function cleanText(value: string, fallback: string) {
  const cleaned = value.trim().replace(/\s+/g, " ");
  return cleaned || fallback;
}

function cleanList(value: string[]) {
  return value.map((item) => item.trim().replace(/\s+/g, " ")).filter(Boolean).slice(0, 6);
}

function isIdentificationResult(value: unknown): value is IdentificationResult {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.partName === "string" &&
    isConfidence(value.confidence) &&
    isScanCategory(value.scanCategory) &&
    typeof value.whatItDoes === "string" &&
    isStringArray(value.visibleObservations) &&
    isStringArray(value.concerns) &&
    isSafetyTriage(value.safetyTriage) &&
    typeof value.isSafetyCritical === "boolean" &&
    typeof value.nextAction === "string" &&
    typeof value.needsBetterPhoto === "boolean" &&
    isStringArray(value.evidence)
  );
}

function getProviderErrorMessage(responseBody: JsonObject | null) {
  const error = responseBody?.error;
  if (isRecord(error) && typeof error.message === "string") {
    return error.message;
  }

  return "The AI provider rejected this request.";
}

function errorResponse(status: number, code: string, message: string): IdentifyResponse {
  return {
    status,
    body: {
      error: {
        code,
        message,
      },
    },
  };
}

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isConfidence(value: unknown) {
  return value === "high" || value === "medium" || value === "low";
}

function isSafetyTriage(value: unknown) {
  return value === "can_help" || value === "needs_better_photo" || value === "needs_professional";
}

function isScanCategory(value: unknown): value is ScanCategory {
  return typeof value === "string" && SCAN_CATEGORIES.includes(value as ScanCategory);
}

function getTrustedCategory(result: IdentificationResult): ScanCategory {
  if (result.scanCategory !== "unknown") {
    return result.scanCategory;
  }

  return categorizeIdentificationText(result);
}

function categorizeIdentificationText(result: IdentificationResult): ScanCategory {
  const text = [
    result.partName,
    result.whatItDoes,
    ...result.visibleObservations,
    ...result.concerns,
    ...result.evidence,
  ]
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
