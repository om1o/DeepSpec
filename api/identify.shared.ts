import { IDENTIFY_PROMPT } from "../src/services/systemPrompts";
import { SCAN_CATEGORIES, type IdentificationResult, type ScanCategory } from "../src/types";

type JsonObject = Record<string, unknown>;

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

  const startedAt = Date.now();
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
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
            {
              text: `${IDENTIFY_PROMPT}\n\nUser task: ${parsed.userMessage}`,
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.4,
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

  const responseBody = (await response.json().catch(() => null)) as JsonObject | null;

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

  const normalizedResult = normalizeIdentificationResult(result);

  console.info("[DeepSpec AI]", {
    model,
    latencyMs: Date.now() - startedAt,
    success: true,
    confidence: normalizedResult.confidence,
    scanCategory: normalizedResult.scanCategory,
    safetyTriage: normalizedResult.safetyTriage,
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
      userMessage: string;
    }
  | { error: IdentifyResponse } {
  if (!isRecord(body) || typeof body.imageBase64 !== "string") {
    return { error: errorResponse(400, "invalid_input", "A captured image is required.") };
  }

  const parsedImage = parseDataUrl(body.imageBase64);
  if (!parsedImage) {
    return { error: errorResponse(400, "invalid_input", "The captured image must be a JPEG, PNG, or WebP data URL.") };
  }

  return {
    base64: parsedImage.base64,
    mimeType: parsedImage.mimeType,
    userMessage:
      typeof body.userMessage === "string" && body.userMessage.trim()
        ? body.userMessage.trim().slice(0, 500)
        : "Identify this car part from the captured photo.",
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

function normalizeIdentificationResult(result: IdentificationResult): IdentificationResult {
  const safetyTriage = result.isSafetyCritical ? "needs_professional" : result.safetyTriage;
  const needsBetterPhoto = result.needsBetterPhoto || safetyTriage === "needs_better_photo";

  return {
    ...result,
    partName: cleanText(result.partName, "Unidentified car part"),
    scanCategory: getTrustedCategory(result),
    whatItDoes: cleanText(result.whatItDoes, "Deep Spec could not verify what this part does from this photo."),
    visibleObservations: cleanList(result.visibleObservations),
    concerns: cleanList(result.concerns),
    evidence: cleanList(result.evidence),
    nextAction:
      safetyTriage === "needs_professional"
        ? ensureProfessionalNextAction(result.nextAction)
        : cleanText(result.nextAction, "Take a clearer photo from another angle before acting on this result."),
    safetyTriage,
    needsBetterPhoto,
  };
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
