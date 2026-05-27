import { FOLLOWUP_PROMPT } from "../src/services/systemPrompts";

type JsonObject = Record<string, unknown>;

export type ChatResponse =
  | {
      status: 200;
      body: {
        message: string;
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

export async function createChatResponse(body: unknown, env: Record<string, string | undefined>): Promise<ChatResponse> {
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
    const response = await fetchGeminiChat(model, parsed.userMessage, apiKey);

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
      },
    };
  }

  return rateLimited
    ? errorResponse(429, "rate_limited", "Too many AI chat requests right now. Try again in a few minutes.")
    : lastRetryableError ?? errorResponse(502, "provider_error", "The AI provider rejected this request.");
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

function fetchGeminiChat(model: string, userMessage: string, apiKey: string) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

  return fetch(endpoint, {
    method: "POST",
    signal: AbortSignal.timeout(20_000),
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
          parts: [{ text: userMessage }],
        },
      ],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 480,
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

function parseChatRequest(body: unknown): { userMessage: string } | { error: ChatResponse } {
  if (!isRecord(body) || typeof body.userMessage !== "string") {
    return { error: errorResponse(400, "invalid_input", "A question is required.") };
  }

  const userMessage = body.userMessage.trim();
  if (!userMessage) {
    return { error: errorResponse(400, "invalid_input", "A question is required.") };
  }

  return {
    userMessage: userMessage.slice(0, 3000),
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

function cleanChatMessage(value: string | null) {
  if (!value) {
    return null;
  }

  const cleaned = value.trim().replace(/\s+/g, " ");
  return cleaned ? cleaned.slice(0, 1200) : null;
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
