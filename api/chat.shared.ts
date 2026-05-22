import { FOLLOWUP_PROMPT } from "../src/services/systemPrompts";
import type { AIModelRun } from "../src/types";

type JsonObject = Record<string, unknown>;

export type ChatResponse =
  | {
      status: 200;
      body: {
        message: string;
        modelRun: AIModelRun;
      };
    }
  | {
      status: number;
      body: {
        error: {
          code: string;
          message: string;
          retryAfterSeconds?: number;
        };
      };
    };

const DEFAULT_MODEL = "gemini-2.5-flash";
const DEFAULT_FALLBACK_MODELS = ["gemini-flash-lite-latest"];
const FOLLOWUP_PROMPT_VERSION = "followup-v1";

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
  let retryAfterSeconds: number | undefined;

  for (let index = 0; index < models.length; index += 1) {
    const model = models[index];
    const canTryFallback = index < models.length - 1;
    const startedAt = Date.now();
    const response = await fetchGeminiChat(model, parsed.userMessage, apiKey);

    if (!response) {
      return errorResponse(502, "network", "Deep Spec could not reach Gemini.");
    }

    if (response.status === 429) {
      rateLimited = true;
      retryAfterSeconds = chooseRetryAfterSeconds(retryAfterSeconds, parseRetryAfterSeconds(response.headers.get("retry-after")));
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

    const message = cleanChatMessage(extractGeminiText(responseBody));
    if (!message) {
      if (canTryFallback) {
        continue;
      }

      return errorResponse(502, "invalid_response", "Gemini did not return a usable chat answer.");
    }

    const latencyMs = Date.now() - startedAt;
    console.info("[DeepSpec Chat]", {
      model,
      latencyMs,
      success: true,
    });

    return {
      status: 200,
      body: {
        message,
        modelRun: createModelRun({
          kind: "chat",
          latencyMs,
          model,
          promptVersion: FOLLOWUP_PROMPT_VERSION,
        }),
      },
    };
  }

  return rateLimited
    ? errorResponse(429, "rate_limited", getRateLimitMessage("AI chat requests", retryAfterSeconds), retryAfterSeconds)
    : errorResponse(502, "provider_error", "The AI provider rejected this request.");
}

function getRateLimitMessage(label: string, retryAfterSeconds: number | undefined) {
  if (!retryAfterSeconds) {
    return `Too many ${label} right now. Try again in a few minutes.`;
  }

  return `Too many ${label} right now. Try again in about ${formatRetryAfter(retryAfterSeconds)}.`;
}

function formatRetryAfter(retryAfterSeconds: number) {
  if (retryAfterSeconds < 60) {
    return `${retryAfterSeconds} second${retryAfterSeconds === 1 ? "" : "s"}`;
  }

  const minutes = Math.ceil(retryAfterSeconds / 60);
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}

function chooseRetryAfterSeconds(current: number | undefined, next: number | undefined) {
  if (!next) {
    return current;
  }

  return current ? Math.max(current, next) : next;
}

function parseRetryAfterSeconds(value: string | null) {
  if (!value) {
    return undefined;
  }

  const seconds = Number(value);
  if (Number.isFinite(seconds)) {
    return clampRetryAfterSeconds(Math.ceil(seconds));
  }

  const retryAt = Date.parse(value);
  if (!Number.isNaN(retryAt)) {
    return clampRetryAfterSeconds(Math.ceil((retryAt - Date.now()) / 1000));
  }

  return undefined;
}

function clampRetryAfterSeconds(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return undefined;
  }

  return Math.min(3600, Math.max(1, seconds));
}

function getChatModels(env: Record<string, string | undefined>) {
  return uniqueStrings([env.GEMINI_CHAT_MODEL || env.GEMINI_TEXT_MODEL || DEFAULT_MODEL, ...DEFAULT_FALLBACK_MODELS]);
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

function createModelRun({
  kind,
  latencyMs,
  model,
  promptVersion,
}: {
  kind: AIModelRun["kind"];
  latencyMs: number;
  model: string;
  promptVersion: string;
}): AIModelRun {
  return {
    id: createRunId(),
    createdAt: new Date().toISOString(),
    kind,
    latencyMs,
    model,
    ocrUsed: false,
    promptVersion,
    provider: "gemini",
  };
}

function createRunId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `run-${Date.now()}-${Math.random().toString(16).slice(2)}`;
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

function errorResponse(status: number, code: string, message: string, retryAfterSeconds?: number): ChatResponse {
  return {
    status,
    body: {
      error: {
        code,
        message,
        ...(retryAfterSeconds ? { retryAfterSeconds } : {}),
      },
    },
  };
}

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null;
}
