import { IDENTIFY_PROMPT } from "../src/services/systemPrompts";
import {
  SCAN_CATEGORIES,
  type CandidateMatch,
  type Confidence,
  type EvidenceRegion,
  type IdentificationResult,
  type ScanCategory,
  type SourceLink,
} from "../src/types";
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
const DEFAULT_FALLBACK_MODELS = ["gemini-2.5-flash-lite"];
const DEFAULT_OLLAMA_IDENTIFY_MODEL = "llava:latest";
const DEFAULT_OLLAMA_BASE_URL = "http://127.0.0.1:11434";
const DEFAULT_OCR_MODEL = "microsoft/trocr-large-printed";
const IDENTIFY_MAX_OUTPUT_TOKENS = 2048;
const OLLAMA_IDENTIFY_MAX_OUTPUT_TOKENS = 900;
const DEFAULT_IDENTIFY_PROVIDER_TIMEOUT_MS = 25_000;
const DEFAULT_OLLAMA_IDENTIFY_TIMEOUT_MS = 180_000;
const DEFAULT_DATASET_ROOT = "datasets/raw/drbimmer-car-parts-and-damage-dataset";
const DEFAULT_DATASET_INDEX_PATH = "datasets/derived/drbimmer-car-parts-and-damage-dataset/records.jsonl";
const RETRYABLE_PROVIDER_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

const OLLAMA_IDENTIFY_PROMPT = [
  "Identify the main visible car part or car damage.",
  "Return only JSON with partName, confidence, scanCategory, and visibleObservations.",
  "confidence: high, medium, or low.",
  `scanCategory: ${SCAN_CATEGORIES.join(", ")}.`,
].join(" ");

const IDENTIFICATION_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    partName: { type: "string" },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    scanCategory: { type: "string", enum: [...SCAN_CATEGORIES] },
    candidateMatches: {
      type: "array",
      items: {
        type: "object",
        properties: {
          partName: { type: "string" },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
          scanCategory: { type: "string", enum: [...SCAN_CATEGORIES] },
          reason: { type: "string" },
        },
        required: ["partName", "confidence", "scanCategory", "reason"],
      },
    },
    whatItDoes: { type: "string" },
    visibleObservations: {
      type: "array",
      items: { type: "string" },
    },
    evidenceRegions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          label: { type: "string" },
          observation: { type: "string" },
          regionLabel: { type: "string" },
        },
        required: ["label", "observation", "regionLabel"],
      },
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
    sourceLinks: {
      type: "array",
      items: {
        type: "object",
        properties: {
          label: { type: "string" },
          url: { type: "string" },
          sourceType: { type: "string", enum: ["dataset", "reference", "search", "safety"] },
        },
        required: ["label", "url", "sourceType"],
      },
    },
  },
  required: [
    "partName",
    "confidence",
    "scanCategory",
    "candidateMatches",
    "whatItDoes",
    "visibleObservations",
    "evidenceRegions",
    "concerns",
    "safetyTriage",
    "isSafetyCritical",
    "nextAction",
    "needsBetterPhoto",
    "evidence",
    "sourceLinks",
  ],
};

export async function createIdentifyResponse(body: unknown, env: Record<string, string | undefined>): Promise<IdentifyResponse> {
  const parsed = parseIdentifyRequest(body);
  if ("error" in parsed) {
    return parsed.error;
  }

  const ocr = shouldRunOcr(parsed) ? await runOcrFallback(parsed, env) : null;
  const sourceContext = buildDatasetSourceContext(env);
  const hasOllamaFallback = isOllamaIdentifyFallbackEnabled(env);
  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) {
    return hasOllamaFallback
      ? createOllamaIdentifyResponse(parsed, ocr, env)
      : errorResponse(500, "not_configured", "Deep Spec AI is not configured. Add GEMINI_API_KEY on the server.");
  }

  const models = getIdentifyModels(env);
  let rateLimited = false;
  let lastRetryableError: IdentifyResponse | null = null;

  for (let index = 0; index < models.length; index += 1) {
    const model = models[index];
    const hasFallback = index < models.length - 1;
    const fallbackAvailable = hasFallback || hasOllamaFallback;
    const startedAt = Date.now();
    const response = await fetchGeminiIdentify(model, parsed, ocr, sourceContext, apiKey, env);

    if (!response) {
      const networkError = errorResponse(502, "network", "Deep Spec could not reach Gemini.");
      lastRetryableError = networkError;
      logIdentifyAttempt("gemini", model, startedAt, networkError, fallbackAvailable);
      if (hasFallback) continue;
      if (hasOllamaFallback) break;
      return networkError;
    }

    if (response.status === 429) {
      rateLimited = true;
      const retryError = errorResponse(429, "rate_limited", "Too many AI lookups right now. Try again in a few minutes.");
      lastRetryableError = retryError;
      logIdentifyAttempt("gemini", model, startedAt, retryError, fallbackAvailable);
      if (hasFallback) continue;
      if (hasOllamaFallback) break;
      return retryError;
    }

    const isJson = (response.headers.get("content-type") ?? "").includes("application/json");
    const responseBody = isJson ? ((await response.json().catch(() => null)) as JsonObject | null) : null;

    if (!response.ok) {
      const providerError = errorResponse(response.status, "provider_error", getProviderErrorMessage(responseBody));
      if (RETRYABLE_PROVIDER_STATUSES.has(response.status)) {
        lastRetryableError = providerError;
        logIdentifyAttempt("gemini", model, startedAt, providerError, fallbackAvailable);
        if (hasFallback) continue;
        if (hasOllamaFallback) break;
      }

      return providerError;
    }

    const text = extractGeminiText(responseBody);
    if (!text) {
      const invalidResponse = errorResponse(502, "invalid_response", "Gemini did not return a usable answer.");
      lastRetryableError = invalidResponse;
      logIdentifyAttempt("gemini", model, startedAt, invalidResponse, hasFallback);
      if (hasFallback) continue;
      return invalidResponse;
    }

    const result = parseIdentificationResult(text);
    if (!result) {
      const invalidResponse = errorResponse(502, "invalid_response", "Gemini returned JSON that Deep Spec could not read.");
      lastRetryableError = invalidResponse;
      logIdentifyAttempt("gemini", model, startedAt, invalidResponse, hasFallback);
      if (hasFallback) continue;
      return invalidResponse;
    }

    const normalizedResult = normalizeIdentificationResult(result, ocr?.text ?? null, env);

    console.info("[DeepSpec AI]", {
      provider: "gemini",
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

  if (hasOllamaFallback && lastRetryableError) {
    const response = await createOllamaIdentifyResponse(parsed, ocr, env);
    if (response.status === 200) {
      return response;
    }

    return "error" in response.body && response.body.error.code === "invalid_response" ? response : lastRetryableError;
  }

  return rateLimited
    ? errorResponse(429, "rate_limited", "Too many AI lookups right now. Try again in a few minutes.")
    : lastRetryableError ?? errorResponse(502, "provider_error", "The AI provider rejected this request.");
}

function getIdentifyModels(env: Record<string, string | undefined>) {
  return uniqueStrings([
    env.GEMINI_MODEL || DEFAULT_MODEL,
    ...splitModelList(env.GEMINI_FALLBACK_MODELS),
    ...DEFAULT_FALLBACK_MODELS,
  ]);
}

function splitModelList(value: string | undefined) {
  if (!value) {
    return [];
  }

  return value.split(",").map((item) => item.trim());
}

function uniqueStrings(values: string[]) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) {
      return false;
    }

    seen.add(trimmed);
    return true;
  });
}

function logIdentifyAttempt(
  provider: "gemini" | "ollama",
  model: string,
  startedAt: number,
  response: IdentifyResponse,
  fallbackAvailable: boolean,
) {
  if (response.status === 200) {
    return;
  }

  const code = "error" in response.body ? response.body.error.code : "unknown";
  console.warn("[DeepSpec AI]", {
    provider,
    model,
    latencyMs: Date.now() - startedAt,
    success: false,
    status: response.status,
    code,
    fallbackAvailable,
  });
}

async function createOllamaIdentifyResponse(
  parsed: {
    base64: string;
    mimeType: string;
    base64_2: string | null;
    userMessage: string;
  },
  ocr: { text: string; model: string } | null,
  env: Record<string, string | undefined>,
): Promise<IdentifyResponse> {
  const model = env.OLLAMA_IDENTIFY_MODEL?.trim() || DEFAULT_OLLAMA_IDENTIFY_MODEL;
  const startedAt = Date.now();
  const response = await fetchOllamaIdentify(model, parsed, ocr, env);

  if (!response) {
    const networkError = errorResponse(502, "network", "Deep Spec could not reach the local Ollama fallback.");
    logIdentifyAttempt("ollama", model, startedAt, networkError, false);
    return networkError;
  }

  const isJson = (response.headers.get("content-type") ?? "").includes("application/json");
  const responseBody = isJson ? ((await response.json().catch(() => null)) as JsonObject | null) : null;

  if (!response.ok) {
    const providerError = errorResponse(response.status, "provider_error", getProviderErrorMessage(responseBody));
    logIdentifyAttempt("ollama", model, startedAt, providerError, false);
    return providerError;
  }

  const text = extractOllamaText(responseBody);
  const result = text ? parseOllamaIdentificationResult(text) : null;
  if (!result) {
    const invalidResponse = errorResponse(502, "invalid_response", "Ollama returned JSON that Deep Spec could not read.");
    logIdentifyAttempt("ollama", model, startedAt, invalidResponse, false);
    return invalidResponse;
  }

  const normalizedResult = normalizeIdentificationResult(result, ocr?.text ?? null, env);

  console.info("[DeepSpec AI]", {
    provider: "ollama",
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

function fetchOllamaIdentify(
  model: string,
  parsed: {
    base64: string;
    mimeType: string;
    base64_2: string | null;
    userMessage: string;
  },
  ocr: { text: string; model: string } | null,
  env: Record<string, string | undefined>,
) {
  const baseUrl = getOllamaBaseUrl(env);
  if (!baseUrl) {
    return null;
  }

  const messages = [
    {
      role: "user",
      content: [
        OLLAMA_IDENTIFY_PROMPT,
        parsed.userMessage,
        ocr?.text ? buildOcrContext(ocr.text) : "",
      ]
        .filter(Boolean)
        .join("\n\n"),
      images: [parsed.base64, parsed.base64_2].filter(isString),
    },
  ];

  return fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    signal: AbortSignal.timeout(getOllamaIdentifyTimeoutMs(env)),
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages,
      stream: false,
      format: "json",
      options: {
        num_ctx: 2048,
        temperature: 0.1,
        num_predict: OLLAMA_IDENTIFY_MAX_OUTPUT_TOKENS,
      },
    }),
  }).catch(() => null);
}

function isOllamaIdentifyFallbackEnabled(env: Record<string, string | undefined>) {
  return env.DEEPSPEC_ENABLE_OLLAMA_IDENTIFY_FALLBACK === "true";
}

function getOllamaBaseUrl(env: Record<string, string | undefined>) {
  const raw = env.OLLAMA_BASE_URL?.trim() || DEFAULT_OLLAMA_BASE_URL;
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }

    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function getOllamaIdentifyTimeoutMs(env: Record<string, string | undefined>) {
  const value = env.DEEPSPEC_OLLAMA_IDENTIFY_TIMEOUT_MS;
  if (!value) {
    return DEFAULT_OLLAMA_IDENTIFY_TIMEOUT_MS;
  }

  const timeoutMs = Number(value);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 5_000 || timeoutMs > 300_000) {
    return DEFAULT_OLLAMA_IDENTIFY_TIMEOUT_MS;
  }

  return timeoutMs;
}

function extractOllamaText(responseBody: JsonObject | null) {
  const message = responseBody?.message;
  if (isRecord(message) && typeof message.content === "string") {
    return message.content.trim();
  }

  return null;
}

function fetchGeminiIdentify(
  model: string,
  parsed: {
    base64: string;
    mimeType: string;
    base64_2: string | null;
    mimeType_2: string | null;
    userMessage: string;
  },
  ocr: { text: string; model: string } | null,
  sourceContext: string | null,
  apiKey: string,
  env: Record<string, string | undefined>,
) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

  return fetch(endpoint, {
    method: "POST",
    signal: AbortSignal.timeout(getIdentifyProviderTimeoutMs(env)),
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
            ...(sourceContext ? [{ text: sourceContext }] : []),
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
}

function getIdentifyProviderTimeoutMs(env: Record<string, string | undefined>) {
  const value = env.DEEPSPEC_IDENTIFY_PROVIDER_TIMEOUT_MS;
  if (!value) {
    return DEFAULT_IDENTIFY_PROVIDER_TIMEOUT_MS;
  }

  const timeoutMs = Number(value);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 5_000 || timeoutMs > 120_000) {
    return DEFAULT_IDENTIFY_PROVIDER_TIMEOUT_MS;
  }

  return timeoutMs;
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

function parseOllamaIdentificationResult(text: string): IdentificationResult | null {
  const fullResult = parseIdentificationResult(text);
  if (fullResult) {
    return fullResult;
  }

  try {
    const parsed = JSON.parse(text) as unknown;
    if (!isRecord(parsed) || typeof parsed.partName !== "string") {
      return null;
    }

    const partName = cleanText(parsed.partName, "Unidentified car part");
    const scanCategory = getTrustedCandidateCategory(resolveScanCategory(parsed.scanCategory), partName);
    const visibleObservations = isStringArray(parsed.visibleObservations) && parsed.visibleObservations.length > 0
      ? parsed.visibleObservations
      : [`The local vision model identified ${partName} as the main visible item.`];

    return {
      partName,
      confidence: resolveOllamaConfidence(parsed.confidence),
      scanCategory,
      candidateMatches: [],
      whatItDoes: `${partName} is the main item the local vision model could identify in this scan.`,
      visibleObservations,
      evidenceRegions: [
        {
          label: partName,
          observation: visibleObservations[0] ?? `The scan appears to show ${partName}.`,
          regionLabel: "Scanned area",
        },
      ],
      concerns: [],
      safetyTriage: isSafetyCriticalCategory(scanCategory) ? "needs_professional" : "can_help",
      isSafetyCritical: isSafetyCriticalCategory(scanCategory),
      nextAction: "Verify this result with a clearer angle before ordering parts or repairing the vehicle.",
      needsBetterPhoto: false,
      evidence: visibleObservations,
      sourceLinks: [],
    };
  } catch {
    return null;
  }
}

function resolveOllamaConfidence(value: unknown): Confidence {
  if (isConfidence(value)) {
    return value;
  }

  if (typeof value === "number") {
    if (value >= 0.8) return "high";
    if (value >= 0.45) return "medium";
  }

  return "low";
}

function resolveScanCategory(value: unknown): ScanCategory {
  return isScanCategory(value) ? value : "unknown";
}

function isSafetyCriticalCategory(category: ScanCategory) {
  return category === "airbag" || category === "brakes" || category === "fuel" || category === "leak" || category === "steering" || category === "suspension";
}

function normalizeIdentificationResult(
  result: IdentificationResult,
  ocrText: string | null = null,
  env: Record<string, string | undefined> = {},
): IdentificationResult {
  const safetyTriage = result.isSafetyCritical ? "needs_professional" : result.safetyTriage;
  const needsBetterPhoto = result.needsBetterPhoto || safetyTriage === "needs_better_photo";
  const datasetMatches = findDatasetMatches(result, env);
  const cleanEvidence = appendDatasetEvidence(appendOcrEvidence(cleanList(result.evidence), ocrText), datasetMatches);
  const originalPartName = cleanText(result.partName, "Unidentified car part");
  const partName = resolvePrimaryPartName(originalPartName, datasetMatches);
  const scanCategory = getTrustedCategory(result);
  const visibleObservations = cleanList(result.visibleObservations);
  const confidence = resolvePrimaryConfidence(result.confidence, originalPartName, partName, datasetMatches);

  return {
    ...result,
    partName,
    confidence,
    scanCategory,
    candidateMatches: normalizeCandidateMatches(result, datasetMatches, partName, scanCategory),
    whatItDoes: cleanText(result.whatItDoes, "Deep Spec could not verify what this part does from this photo."),
    visibleObservations,
    evidenceRegions: normalizeEvidenceRegions(result.evidenceRegions, visibleObservations, cleanEvidence),
    concerns: cleanList(result.concerns),
    evidence: cleanEvidence,
    sourceLinks: normalizeSourceLinks(result.sourceLinks, datasetMatches, partName),
    nextAction:
      safetyTriage === "needs_professional"
        ? ensureProfessionalNextAction(result.nextAction)
        : cleanText(result.nextAction, "Take a clearer photo from another angle before acting on this result."),
    safetyTriage,
    needsBetterPhoto,
  };
}

function resolvePrimaryPartName(partName: string, datasetMatches: DatasetMatch[]) {
  if (!isGenericPartName(partName)) {
    return partName;
  }

  const supportedPartMatch = datasetMatches.find((match) => isDatasetPartMatch(match) && match.score >= 5);
  return supportedPartMatch?.label ?? partName;
}

function resolvePrimaryConfidence(
  confidence: Confidence,
  originalPartName: string,
  partName: string,
  datasetMatches: DatasetMatch[],
): Confidence {
  if (confidence !== "low" || originalPartName === partName) {
    return confidence;
  }

  const promotedMatch = datasetMatches.find((match) => isDatasetPartMatch(match) && match.label.toLowerCase() === partName.toLowerCase());
  return promotedMatch && promotedMatch.score >= 5 ? "medium" : confidence;
}

function isGenericPartName(partName: string) {
  return /^(unknown|unknown component|unidentified|unidentified car part|car part|vehicle component|vehicle part|damaged area|car body|vehicle body|body panel)$/i.test(
    partName.trim(),
  );
}

function isDatasetPartMatch(match: DatasetMatch) {
  return match.kind === "part" || categorizeText(match.label) !== "unknown";
}

function appendDatasetEvidence(evidence: string[], matches: DatasetMatch[]) {
  if (!matches.length) {
    return evidence;
  }

  const existingEvidence = new Set(evidence.map((item) => item.toLowerCase()));
  const datasetEvidence = matches.flatMap((match) => formatDatasetEvidence(match))
    .filter((item) => !existingEvidence.has(item.toLowerCase()));

  return [...evidence, ...datasetEvidence].slice(0, 8);
}

function normalizeCandidateMatches(
  result: IdentificationResult,
  datasetMatches: DatasetMatch[],
  primaryPartName: string,
  primaryCategory: ScanCategory,
): CandidateMatch[] {
  const cleanCandidates = result.candidateMatches
    .map((candidate) => ({
      partName: cleanText(candidate.partName, ""),
      confidence: candidate.confidence,
      scanCategory: getTrustedCandidateCategory(candidate.scanCategory, candidate.partName),
      reason: cleanText(candidate.reason, ""),
    }))
    .filter((candidate) => candidate.partName && candidate.reason)
    .filter((candidate) => candidate.partName.toLowerCase() !== primaryPartName.toLowerCase());

  const datasetCandidates = datasetMatches
    .filter(isDatasetPartMatch)
    .map((match) => ({
      partName: match.label,
      confidence: match.score >= 5 ? "medium" as const : "low" as const,
      scanCategory: getTrustedCandidateCategory(primaryCategory, match.label),
      reason: `Similar local dataset label with ${match.sampleCount ?? 1} sample${match.sampleCount === 1 ? "" : "s"}.`,
    }));

  return uniqueCandidates([...cleanCandidates, ...datasetCandidates]).slice(0, 4);
}

function uniqueCandidates(candidates: CandidateMatch[]) {
  const seen = new Set<string>();
  const unique: CandidateMatch[] = [];

  for (const candidate of candidates) {
    const key = candidate.partName.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(candidate);
  }

  return unique;
}

function normalizeEvidenceRegions(evidenceRegions: EvidenceRegion[], observations: string[], evidence: string[]) {
  const cleanRegions = evidenceRegions
    .map((region) => ({
      label: cleanText(region.label, ""),
      observation: cleanText(region.observation, ""),
      regionLabel: cleanText(region.regionLabel, "Scanned area"),
    }))
    .filter((region) => region.label && region.observation);

  if (cleanRegions.length) {
    return cleanRegions.slice(0, 4);
  }

  return [...observations, ...evidence]
    .slice(0, 3)
    .map((observation, index) => ({
      label: index === 0 ? "Primary clue" : `Clue ${index + 1}`,
      observation,
      regionLabel: "Scanned area",
    }));
}

function normalizeSourceLinks(sourceLinks: SourceLink[], datasetMatches: DatasetMatch[], partName: string) {
  const cleanLinks = sourceLinks
    .map((link) => ({
      label: cleanText(link.label, ""),
      url: cleanUrl(link.url),
      sourceType: link.sourceType,
    }))
    .filter((link): link is SourceLink => Boolean(link.label && link.url && isSourceType(link.sourceType)));

  const datasetLinks = datasetMatches
    .filter((match) => match.sourceUrl)
    .map((match) => ({
      label: `Dataset sample: ${match.label}`,
      url: match.sourceUrl as string,
      sourceType: "dataset" as const,
    }));

  const defaultLinks: SourceLink[] = [
    {
      label: "Search this part",
      url: `https://www.google.com/search?q=${encodeURIComponent(`${partName} car part`)}`,
      sourceType: "search",
    },
    {
      label: "NHTSA recalls",
      url: "https://www.nhtsa.gov/recalls",
      sourceType: "safety",
    },
  ];

  return uniqueSourceLinks([...datasetLinks, ...cleanLinks, ...defaultLinks]).slice(0, 6);
}

function uniqueSourceLinks(links: SourceLink[]) {
  const seen = new Set<string>();
  const unique: SourceLink[] = [];

  for (const link of links) {
    const key = link.url.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(link);
  }

  return unique;
}

function buildDatasetSourceContext(env: Record<string, string | undefined>) {
  const datasetIndexPath = resolve(process.cwd(), env.DEEPSPEC_DATASET_INDEX_PATH || DEFAULT_DATASET_INDEX_PATH);
  const datasetRecords = readDatasetRecords(datasetIndexPath);
  const sourceSummaries = datasetRecords.length
    ? summarizeDatasetRecords(datasetRecords)
    : summarizeRawDatasetLabels(resolve(process.cwd(), env.DEEPSPEC_DATASET_ROOT || DEFAULT_DATASET_ROOT));

  if (!sourceSummaries.length) {
    return null;
  }

  return [
    "Deep Spec local source context:",
    "Use these project dataset labels and source URLs as supporting context only when the photo evidence agrees. Do not treat source labels as visual evidence by themselves.",
    ...sourceSummaries.slice(0, 24).map((source) => {
      const sampleText = source.sampleCount ? `, ${source.sampleCount} labeled sample${source.sampleCount === 1 ? "" : "s"}` : "";
      const sourceText = source.sourceUrl ? ` Source: ${source.sourceUrl}` : "";
      return `- ${source.label} (${source.kind}${sampleText}).${sourceText}`;
    }),
  ].join("\n");
}

function summarizeDatasetRecords(records: DatasetRecord[]): DatasetMatch[] {
  const labelGroups = new Map<string, DatasetMatch>();

  for (const record of records) {
    const kind = record.canonicalKind === "damage" ? "damage" : record.canonicalKind === "part" ? "part" : null;
    if (!kind) {
      continue;
    }

    for (const label of getRecordLabels(record)) {
      const key = `${kind}:${label.toLowerCase()}`;
      const existing = labelGroups.get(key);
      labelGroups.set(key, {
        kind,
        label,
        score: 0,
        sampleCount: (existing?.sampleCount ?? 0) + 1,
        sourceUrl: existing?.sourceUrl ?? getRecordSourceUrl(record),
      });
    }
  }

  return [...labelGroups.values()].sort((a, b) => (b.sampleCount ?? 0) - (a.sampleCount ?? 0) || a.label.localeCompare(b.label));
}

function summarizeRawDatasetLabels(datasetRoot: string): DatasetMatch[] {
  return [
    ...readDatasetClassTitles(resolve(datasetRoot, "Car parts dataset", "meta.json")).map((label) => ({
      kind: "part" as const,
      label,
      score: 0,
    })),
    ...readDatasetClassTitles(resolve(datasetRoot, "Car damages dataset", "meta.json")).map((label) => ({
      kind: "damage" as const,
      label,
      score: 0,
    })),
  ].sort((a, b) => a.label.localeCompare(b.label));
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
      labels: readDatasetClassTitles(resolve(datasetRoot, "Car parts dataset", "meta.json")),
    },
    {
      kind: "damage" as const,
      labels: readDatasetClassTitles(resolve(datasetRoot, "Car damages dataset", "meta.json")),
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

function cleanUrl(value: string) {
  const cleaned = value.trim();
  try {
    const url = new URL(cleaned);
    return url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

function isIdentificationResult(value: unknown): value is IdentificationResult {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.partName === "string" &&
    isConfidence(value.confidence) &&
    isScanCategory(value.scanCategory) &&
    isCandidateMatchArray(value.candidateMatches) &&
    typeof value.whatItDoes === "string" &&
    isStringArray(value.visibleObservations) &&
    isEvidenceRegionArray(value.evidenceRegions) &&
    isStringArray(value.concerns) &&
    isSafetyTriage(value.safetyTriage) &&
    typeof value.isSafetyCritical === "boolean" &&
    typeof value.nextAction === "string" &&
    typeof value.needsBetterPhoto === "boolean" &&
    isStringArray(value.evidence) &&
    isSourceLinkArray(value.sourceLinks)
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

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isCandidateMatchArray(value: unknown): value is CandidateMatch[] {
  return Array.isArray(value) && value.every((item) => (
    isRecord(item) &&
    typeof item.partName === "string" &&
    isConfidence(item.confidence) &&
    isScanCategory(item.scanCategory) &&
    typeof item.reason === "string"
  ));
}

function isEvidenceRegionArray(value: unknown): value is EvidenceRegion[] {
  return Array.isArray(value) && value.every((item) => (
    isRecord(item) &&
    typeof item.label === "string" &&
    typeof item.observation === "string" &&
    typeof item.regionLabel === "string"
  ));
}

function isSourceLinkArray(value: unknown): value is SourceLink[] {
  return Array.isArray(value) && value.every((item) => (
    isRecord(item) &&
    typeof item.label === "string" &&
    typeof item.url === "string" &&
    isSourceType(item.sourceType)
  ));
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

function isSourceType(value: unknown): value is SourceLink["sourceType"] {
  return value === "dataset" || value === "reference" || value === "search" || value === "safety";
}

function getTrustedCategory(result: IdentificationResult): ScanCategory {
  if (result.scanCategory !== "unknown") {
    return result.scanCategory;
  }

  return categorizeIdentificationText(result);
}

function getTrustedCandidateCategory(category: ScanCategory, text: string): ScanCategory {
  return category === "unknown" ? categorizeText(text) : category;
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
  if (/bumper|fender|door|panel|body|hood|windshield|window|wheel|headlight|tail\s*light|taillight|roof|grille|license|mirror|rocker|quarter|trunk/.test(normalized)) return "body";
  if (/engine|belt|hose|radiator|thermostat|filter|intake|manifold/.test(normalized)) return "engine";

  return "unknown";
}
