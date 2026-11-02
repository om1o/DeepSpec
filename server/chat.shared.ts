import { CHAT_USER_MESSAGE_MAX_CHARS, FOLLOWUP_PROMPT } from "../src/services/systemPrompts.js";
import type { SourceLink } from "../src/types/index.js";

type JsonObject = Record<string, unknown>;

export type ChatResponse =
  | {
      status: 200;
      body: {
        message: string;
        sources?: SourceLink[];
        searchSuggestions?: string;
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
const RETRYABLE_PROVIDER_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
const MAX_IMAGE_CHARS = 4_000_000;
type ChatRequest = { userMessage: string; image?: { mimeType: string; data: string }; research: boolean; sourceUrls: string[] };

export async function createChatResponse(body: unknown, env: Record<string, string | undefined>): Promise<ChatResponse> {
  if (!isChatEnabled(env)) {
    return errorResponse(503, "feature_disabled", "Follow-up chat is unavailable in this beta.");
  }

  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) {
    return errorResponse(500, "not_configured", "Deep Spec chat is not configured. Add GEMINI_API_KEY on the server.");
  }

  const parsed = parseChatRequest(body);
  if ("error" in parsed) {
    return parsed.error;
  }

  const models = getChatModels(env);
  let rateLimited = false;
  let lastRetryableError: ChatResponse | null = null;

  for (let index = 0; index < models.length; index += 1) {
    const model = models[index];
    const hasFallback = index < models.length - 1;
    const startedAt = Date.now();
    const response = await fetchGeminiChat(model, parsed, apiKey);

    if (!response) {
      const networkError = errorResponse(502, "network", "Deep Spec could not reach Gemini.");
      lastRetryableError = networkError;
      logChatAttempt(model, startedAt, networkError, hasFallback);
      if (hasFallback) continue;
      return networkError;
    }

    if (response.status === 429) {
      rateLimited = true;
      const retryError = errorResponse(429, "rate_limited", "Too many AI chat requests right now. Try again in a few minutes.");
      lastRetryableError = retryError;
      logChatAttempt(model, startedAt, retryError, hasFallback);
      if (hasFallback) continue;
      return retryError;
    }

    const isJson = (response.headers.get("content-type") ?? "").includes("application/json");
    const responseBody = isJson ? ((await response.json().catch(() => null)) as JsonObject | null) : null;

    if (!response.ok) {
      const providerError = errorResponse(response.status, "provider_error", getProviderErrorMessage(responseBody));
      if (RETRYABLE_PROVIDER_STATUSES.has(response.status)) {
        lastRetryableError = providerError;
        logChatAttempt(model, startedAt, providerError, hasFallback);
        if (hasFallback) continue;
      }

      return providerError;
    }

    const message = cleanChatMessage(extractGeminiText(responseBody));
    if (!message) {
      const invalidResponse = errorResponse(502, "invalid_response", "Gemini did not return a usable chat answer.");
      lastRetryableError = invalidResponse;
      logChatAttempt(model, startedAt, invalidResponse, hasFallback);
      if (hasFallback) continue;
      return invalidResponse;
    }

    console.info("[DeepSpec Chat]", {
      model,
      latencyMs: Date.now() - startedAt,
      success: true,
    });

    return {
      status: 200,
      body: {
        message,
        ...(parsed.research ? getResearchSources(responseBody) : {}),
      },
    };
  }

  return rateLimited
    ? errorResponse(429, "rate_limited", "Too many AI chat requests right now. Try again in a few minutes.")
    : lastRetryableError ?? errorResponse(502, "provider_error", "The AI provider rejected this request.");
}

export function isChatEnabled(env: Record<string, string | undefined>) {
  const configured = env.DEEPSPEC_ENABLE_CHAT?.trim().toLowerCase();
  if (configured === "true") return true;
  if (configured === "false") return false;
  return env.NODE_ENV !== "production" && env.VERCEL_ENV !== "production";
}

function getChatModels(env: Record<string, string | undefined>) {
  return uniqueStrings([
    env.GEMINI_CHAT_MODEL || env.GEMINI_TEXT_MODEL || DEFAULT_MODEL,
    ...splitModelList(env.GEMINI_CHAT_FALLBACK_MODELS),
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

function fetchGeminiChat(model: string, request: ChatRequest, apiKey: string) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const researchContext = request.research
    ? [
      "The user explicitly requested research. Use Google Search and URL context where useful. Distinguish external references from observations of the attached photo. Do not invent citations or claim a source was checked when no grounding is available.",
      "YouTube links are reference links only: URL context cannot watch videos. Use indexed search information and do not claim to have watched a linked video.",
      ...request.sourceUrls.map((url) => `User-provided reference URL: ${url}`),
    ].join("\n")
    : "";

  return fetch(endpoint, {
    method: "POST",
    signal: AbortSignal.timeout(request.research ? 25_000 : 20_000),
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      system_instruction: {
        parts: [{ text: FOLLOWUP_PROMPT }],
      },
      contents: [
        {
          role: "user",
          parts: [
            { text: [request.userMessage, researchContext].filter(Boolean).join("\n\n") },
            ...(request.image ? [{ inlineData: request.image }] : []),
          ],
        },
      ],
      ...(request.research ? { tools: [{ googleSearch: {} }, { urlContext: {} }] } : {}),
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 1800,
        ...(/^gemini-2\.5-flash(?:-lite)?(?:-|$)/.test(model) ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
      },
    }),
  }).catch(() => null);
}

function logChatAttempt(model: string, startedAt: number, response: ChatResponse, fallbackAvailable: boolean) {
  if (response.status === 200) {
    return;
  }

  const code = "error" in response.body ? response.body.error.code : "unknown";
  console.warn("[DeepSpec Chat]", {
    model,
    latencyMs: Date.now() - startedAt,
    success: false,
    status: response.status,
    code,
    fallbackAvailable,
  });
}

function parseChatRequest(body: unknown): ChatRequest | { error: ChatResponse } {
  if (!isRecord(body) || typeof body.userMessage !== "string") {
    return { error: errorResponse(400, "invalid_input", "A question is required.") };
  }

  const userMessage = body.userMessage.trim();
  if (!userMessage) {
    return { error: errorResponse(400, "invalid_input", "A question is required.") };
  }

  let image: ChatRequest["image"];
  if (body.imageBase64 !== undefined) {
    if (typeof body.imageBase64 !== "string") {
      return { error: errorResponse(400, "invalid_input", "The saved photo must be a JPEG, PNG, or WebP data URL.") };
    }
    if (body.imageBase64.length > MAX_IMAGE_CHARS) {
      return { error: errorResponse(400, "image_too_large", "The saved photo is too large for chat. Use a smaller photo.") };
    }
    const match = body.imageBase64.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/);
    if (!match?.[2] || match[2].length % 4 !== 0) {
      return { error: errorResponse(400, "invalid_input", "The saved photo must be a JPEG, PNG, or WebP data URL.") };
    }
    image = { mimeType: match[1], data: match[2] };
  }
  if (body.research !== undefined && typeof body.research !== "boolean") {
    return { error: errorResponse(400, "invalid_input", "Research must be explicitly enabled or disabled.") };
  }
  if (body.sourceUrls !== undefined && (!Array.isArray(body.sourceUrls) || body.sourceUrls.length > 3 || !body.sourceUrls.every((url) => typeof url === "string" && cleanResearchUrl(url)))) {
    return { error: errorResponse(400, "invalid_input", "Use up to three public HTTPS reference URLs.") };
  }
  const research = body.research === true;
  const sourceUrls = research ? [...new Set([
    ...(Array.isArray(body.sourceUrls) ? body.sourceUrls : []),
    ...(userMessage.match(/https:\/\/[^\s<>]+/g) ?? []).map((url) => url.replace(/[),.;!?]+$/, "")),
  ].map(cleanResearchUrl).filter((url): url is string => Boolean(url)))].slice(0, 3) : [];

  return {
    userMessage: userMessage.slice(0, CHAT_USER_MESSAGE_MAX_CHARS),
    image,
    research,
    sourceUrls,
  };
}

function cleanResearchUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port || !url.hostname.includes(".") || url.hostname.includes(":") || /^\d+(?:\.\d+){3}$/.test(url.hostname) || /\.(?:local|localhost|internal)$/.test(url.hostname)) return null;
    return url.href;
  } catch {
    return null;
  }
}

function getResearchSources(responseBody: JsonObject | null): { sources?: SourceLink[]; searchSuggestions?: string } {
  const candidate = Array.isArray(responseBody?.candidates) ? responseBody.candidates[0] : null;
  if (!isRecord(candidate)) return {};
  const grounding = isRecord(candidate.groundingMetadata) ? candidate.groundingMetadata : {};
  const chunks = Array.isArray(grounding.groundingChunks) ? grounding.groundingChunks : [];
  const context = isRecord(candidate.urlContextMetadata) ? candidate.urlContextMetadata : {};
  const metadata = Array.isArray(context.urlMetadata) ? context.urlMetadata : [];
  const sources: SourceLink[] = [];
  const add = (urlValue: unknown, title: unknown) => {
    const url = cleanResearchUrl(urlValue);
    if (!url || sources.some((source) => source.url === url)) return;
    sources.push({ url, label: typeof title === "string" && title.trim() ? title.trim().slice(0, 160) : new URL(url).hostname, sourceType: "reference" });
  };
  for (const chunk of chunks) if (isRecord(chunk) && isRecord(chunk.web)) add(chunk.web.uri, chunk.web.title);
  for (const entry of metadata) if (isRecord(entry) && entry.urlRetrievalStatus === "URL_RETRIEVAL_STATUS_SUCCESS") add(entry.retrievedUrl, undefined);
  const entryPoint = isRecord(grounding.searchEntryPoint) ? grounding.searchEntryPoint : {};
  const searchSuggestions = typeof entryPoint.renderedContent === "string" && entryPoint.renderedContent.length <= 50_000 ? entryPoint.renderedContent : undefined;
  return { ...(sources.length ? { sources: sources.slice(0, 8) } : {}), ...(searchSuggestions ? { searchSuggestions } : {}) };
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

function cleanChatMessage(value: string | null) {
  if (!value) {
    return null;
  }

  const cleaned = value.replace(/\r\n?/g, "\n").split("\n").map((line) => line.trimEnd()).join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return cleaned ? cleaned.slice(0, 6000) : null;
}

function getProviderErrorMessage(responseBody: JsonObject | null) {
  const error = responseBody?.error;
  if (isRecord(error) && typeof error.message === "string") {
    return error.message;
  }

  return "The AI provider rejected this request.";
}

function errorResponse(status: number, code: string, message: string): ChatResponse {
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
