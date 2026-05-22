import { IDENTIFY_PROMPT } from "../src/services/systemPrompts";
import {
  SCAN_CATEGORIES,
  type CandidateMatch,
  type EvidenceRegion,
  type AIModelRun,
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
        modelRun: AIModelRun;
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
const DEFAULT_FALLBACK_MODELS = ["gemini-flash-lite-latest"];
const DEFAULT_OCR_MODEL = "microsoft/trocr-large-printed";
const IDENTIFY_PROMPT_VERSION = "identify-v1";
const IDENTIFY_MAX_OUTPUT_TOKENS = 2048;
const DEFAULT_DATASET_ROOT = "datasets/raw/drbimmer-car-parts-and-damage-dataset";
const DEFAULT_DATASET_INDEX_PATH = "datasets/derived/drbimmer-car-parts-and-damage-dataset/records.jsonl";

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
  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) {
    return errorResponse(500, "not_configured", "Deep Spec AI is not configured. Add GEMINI_API_KEY on the server.");
  }

  const parsed = parseIdentifyRequest(body);
  if ("error" in parsed) {
    return parsed.error;
  }

  const ocr = shouldRunOcr(parsed) ? await runOcrFallback(parsed, env) : null;
  const models = getIdentifyModels(env);
  let rateLimited = false;

  for (let index = 0; index < models.length; index += 1) {
    const model = models[index];
    const canTryFallback = index < models.length - 1;
    const startedAt = Date.now();
    const response = await fetchGeminiIdentify(model, parsed, ocr, apiKey);

    if (!response) {
      return errorResponse(502, "network", "Deep Spec could not reach Gemini.");
    }

    if (response.status === 429) {
      rateLimited = true;
      continue;
    }

    const isJson = (response.headers.get("content-type") ?? "").includes("application/json");
    const responseBody = isJson ? ((await response.json().catch(() => null)) as JsonObject | null) : null;

    if (!response.ok) {
      if (response.status === 503 && canTryFallback) {
        continue;
      }

      return errorResponse(response.status, "provider_error", getProviderErrorMessage(responseBody));
    }

    const text = extractGeminiText(responseBody);
    if (!text) {
      if (canTryFallback) {
        continue;
      }

      return errorResponse(502, "invalid_response", "Gemini did not return a usable answer.");
    }

    const result = parseIdentificationResult(text);
    if (!result) {
      if (canTryFallback) {
        continue;
      }

      return errorResponse(502, "invalid_response", "Gemini returned JSON that Deep Spec could not read.");
    }

    const normalizedResult = normalizeIdentificationResult(result, ocr?.text ?? null, env);
    const latencyMs = Date.now() - startedAt;
    const modelRun = createModelRun({
      kind: "identify",
      latencyMs,
      model,
      ocr,
      promptVersion: IDENTIFY_PROMPT_VERSION,
    });

    console.info("[DeepSpec AI]", {
      model,
      latencyMs,
      success: true,
      confidence: normalizedResult.confidence,
      scanCategory: normalizedResult.scanCategory,
      safetyTriage: normalizedResult.safetyTriage,
      ocrUsed: Boolean(ocr?.text),
    });

    return {
      status: 200,
      body: {
        modelRun,
        result: normalizedResult,
      },
    };
  }

  return rateLimited
    ? errorResponse(429, "rate_limited", "Too many AI lookups right now. Try again in a few minutes.")
    : errorResponse(502, "provider_error", "The AI provider rejected this request.");
}

function getIdentifyModels(env: Record<string, string | undefined>) {
  return uniqueStrings([env.GEMINI_MODEL || DEFAULT_MODEL, ...DEFAULT_FALLBACK_MODELS]);
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
  apiKey: string,
) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

  return fetch(endpoint, {
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
    return coerceIdentificationResult(parsed);
  } catch {
    return null;
  }
}

function coerceIdentificationResult(value: unknown): IdentificationResult | null {
  if (!isRecord(value)) {
    return null;
  }

  const partName = typeof value.partName === "string" ? cleanText(value.partName, "") : "";
  if (!partName) {
    return null;
  }

  const isSafetyCritical = typeof value.isSafetyCritical === "boolean" ? value.isSafetyCritical : false;
  return {
    partName,
    confidence: isConfidence(value.confidence) ? value.confidence : "medium",
    scanCategory: isScanCategory(value.scanCategory) ? value.scanCategory : "unknown",
    candidateMatches: isCandidateMatchArray(value.candidateMatches) ? value.candidateMatches : [],
    whatItDoes: typeof value.whatItDoes === "string" ? value.whatItDoes : "",
    visibleObservations: isStringArray(value.visibleObservations) ? value.visibleObservations : [],
    evidenceRegions: isEvidenceRegionArray(value.evidenceRegions) ? value.evidenceRegions : [],
    concerns: isStringArray(value.concerns) ? value.concerns : [],
    safetyTriage: isSafetyTriage(value.safetyTriage) ? value.safetyTriage : isSafetyCritical ? "needs_professional" : "can_help",
    isSafetyCritical,
    nextAction: typeof value.nextAction === "string" ? value.nextAction : "",
    needsBetterPhoto: typeof value.needsBetterPhoto === "boolean" ? value.needsBetterPhoto : false,
    evidence: isStringArray(value.evidence) ? value.evidence : [],
    sourceLinks: isSourceLinkArray(value.sourceLinks) ? value.sourceLinks : [],
  };
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
  const partName = refineGenericPartName(result, originalPartName);
  const scanCategory = getTrustedCategory({ ...result, partName });
  const visibleObservations = cleanList(result.visibleObservations);

  return {
    ...result,
    partName,
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

function refineGenericPartName(result: IdentificationResult, partName: string) {
  if (!isGenericPartName(partName)) {
    return partName;
  }

  const specificCandidate = result.candidateMatches
    .map((candidate) => cleanText(candidate.partName, ""))
    .find((candidatePartName) => candidatePartName && !isGenericPartName(candidatePartName));

  if (specificCandidate) {
    return specificCandidate;
  }

  return findSpecificBodyPartName(result) ?? partName;
}

function isGenericPartName(partName: string) {
  return /^(unknown|unknown component|unidentified|unidentified car part|car part|vehicle component|vehicle part|damaged area|car body|vehicle body|body panel|exterior body|vehicle exterior)$/i.test(
    partName.trim(),
  );
}

const SPECIFIC_BODY_PART_PATTERNS: Array<{ partName: string; pattern: RegExp }> = [
  { partName: "Front bumper", pattern: /\bfront bumpers?\b|\bfront bumper covers?\b/ },
  { partName: "Rear bumper", pattern: /\b(rear|back) bumpers?\b|\b(rear|back) bumper covers?\b/ },
  { partName: "Front door", pattern: /\bfront doors?\b|\bdriver s doors?\b|\bdrivers? doors?\b|\bpassenger doors?\b/ },
  { partName: "Rear door", pattern: /\b(rear|back) doors?\b/ },
  { partName: "Front fender", pattern: /\bfront fenders?\b/ },
  { partName: "Quarter panel", pattern: /\bquarter panels?\b/ },
  { partName: "Rocker panel", pattern: /\brocker panels?\b/ },
  { partName: "Front window", pattern: /\bfront windows?\b/ },
  { partName: "Rear window", pattern: /\b(rear|back) windows?\b/ },
  { partName: "Tail light", pattern: /\btail ?lights?\b|\btaillights?\b/ },
  { partName: "Headlight", pattern: /\bhead ?lights?\b|\bheadlamps?\b/ },
  { partName: "Windshield", pattern: /\bwindshields?\b|\bwindscreens?\b/ },
  { partName: "Side mirror", pattern: /\bside mirrors?\b|\bmirrors?\b/ },
  { partName: "License plate", pattern: /\blicen[cs]e plates?\b/ },
  { partName: "Front wheel", pattern: /\bfront wheels?\b/ },
  { partName: "Rear wheel", pattern: /\b(rear|back) wheels?\b/ },
  { partName: "Grille", pattern: /\bgrilles?\b|\bgrills?\b/ },
  { partName: "Fender", pattern: /\bfenders?\b/ },
  { partName: "Bumper", pattern: /\bbumpers?\b|\bbumper covers?\b/ },
  { partName: "Door", pattern: /\bdoors?\b/ },
  { partName: "Window", pattern: /\bwindows?\b/ },
  { partName: "Hood", pattern: /\bhoods?\b|\bbonnets?\b/ },
  { partName: "Trunk", pattern: /\btrunks?\b|\bboot lids?\b/ },
  { partName: "Roof", pattern: /\broofs?\b/ },
  { partName: "Dent", pattern: /\bdents?\b|\bdented\b/ },
  { partName: "Scratch", pattern: /\bscratches?\b|\bscratched\b/ },
  { partName: "Crack", pattern: /\bcracks?\b|\bcracked\b/ },
  { partName: "Corrosion", pattern: /\bcorrosion\b|\brust\b|\brusted\b/ },
];

function findSpecificBodyPartName(result: IdentificationResult) {
  const text = normalizeMatchText(
    [
      result.whatItDoes,
      ...result.visibleObservations,
      ...result.evidenceRegions.flatMap((region) => [region.label, region.observation, region.regionLabel]),
      ...result.concerns,
      ...result.evidence,
    ].join(" "),
  );

  return SPECIFIC_BODY_PART_PATTERNS.find(({ pattern }) => pattern.test(text))?.partName ?? null;
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
    .filter((match) => match.kind === "part")
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

function createModelRun({
  kind,
  latencyMs,
  model,
  ocr,
  promptVersion,
}: {
  kind: AIModelRun["kind"];
  latencyMs: number;
  model: string;
  ocr: { text: string; model: string } | null;
  promptVersion: string;
}): AIModelRun {
  return {
    id: createRunId(),
    createdAt: new Date().toISOString(),
    kind,
    latencyMs,
    model,
    ocrModel: ocr?.model,
    ocrText: ocr?.text,
    ocrUsed: Boolean(ocr?.text),
    promptVersion,
    provider: "gemini",
  };
}

function createRunId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `run-${Date.now()}-${Math.random().toString(16).slice(2)}`;
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
  if (/bumper|fender|door|panel|body/.test(normalized)) return "body";
  if (/engine|belt|hose|radiator|thermostat|filter|intake|manifold/.test(normalized)) return "engine";

  return "unknown";
}
