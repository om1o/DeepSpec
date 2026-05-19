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

export async function createChatResponse(body: unknown, env: Record<string, string | undefined>): Promise<ChatResponse> {
  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) {
    return errorResponse(500, "not_configured", "Deep Spec chat is not configured. Add GEMINI_API_KEY on the server.");
  }

  const parsed = parseChatRequest(body);
  if ("error" in parsed) {
    return parsed.error;
  }

  const model = env.GEMINI_CHAT_MODEL || env.GEMINI_TEXT_MODEL || DEFAULT_MODEL;
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

  const startedAt = Date.now();
  const response = await fetch(endpoint, {
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
          parts: [{ text: parsed.userMessage }],
        },
      ],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 480,
      },
    }),
  }).catch(() => null);

  if (!response) {
    return errorResponse(502, "network", "Deep Spec could not reach Gemini.");
  }

  if (response.status === 429) {
    return errorResponse(429, "rate_limited", "Too many AI chat requests right now. Try again in a few minutes.");
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
