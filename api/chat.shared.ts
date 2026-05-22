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

  for (const model of models) {
    const startedAt = Date.now();
    const response = await fetchGeminiChat(model, parsed.userMessage, apiKey);

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
      return errorResponse(response.status, "provider_error", getProviderErrorMessage(responseBody));
    }

    const message = cleanChatMessage(extractGeminiText(responseBody));
    if (!message) {
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
    ? errorResponse(429, "rate_limited", "Too many AI chat requests right now. Try again in a few minutes.")
    : errorResponse(502, "provider_error", "The AI provider rejected this request.");
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
