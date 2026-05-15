export type AIInput = {
  type: "vision" | "text";
  imageBase64?: string;
  userMessage: string;
  systemPrompt: string;
  responseAsJson?: boolean;
};

export type AIServiceErrorCode =
  | "rate_limit"
  | "network"
  | "parse"
  | "config"
  | "bad_request"
  | "payload_too_large"
  | "unknown";

export class AIServiceError extends Error {
  readonly code: AIServiceErrorCode;

  constructor(code: AIServiceErrorCode, message: string) {
    super(message);
    this.name = "AIServiceError";
    this.code = code;
  }
}

const baseUrl = import.meta.env.VITE_API_BASE_URL ?? "";

function resolveUrl(path: string) {
  return `${baseUrl}${path}`;
}

export async function runAI(input: AIInput): Promise<string | object> {
  const started = performance.now();
  let res: Response;
  try {
    res = await fetch(resolveUrl("/api/ai"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  } catch {
    throw new AIServiceError("network", "Could not reach the AI service. Check your connection and try again.");
  }

  const payload: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const err =
      payload && typeof payload === "object" && "error" in payload
        ? (payload as { error?: { code?: string; message?: string } }).error
        : undefined;
    const code = err?.code;
    const msg = err?.message ?? res.statusText;
    if (res.status === 429 || code === "rate_limit") {
      throw new AIServiceError("rate_limit", "Too many lookups right now. Try again in a few minutes.");
    }
    if (code === "config") {
      throw new AIServiceError("config", msg);
    }
    if (res.status === 413 || code === "payload_too_large") {
      throw new AIServiceError("payload_too_large", msg || "Photo or request is too large. Try a smaller image.");
    }
    if (code === "bad_request") {
      throw new AIServiceError("bad_request", msg);
    }
    throw new AIServiceError("unknown", msg || "Something went wrong.");
  }

  if (!payload || typeof payload !== "object" || !("kind" in payload)) {
    throw new AIServiceError("parse", "Unexpected response from AI service.");
  }

  const envelope = payload as Record<string, unknown>;
  const kind = envelope.kind;
  const value = envelope.value;

  if (typeof kind !== "string") {
    throw new AIServiceError("parse", "Unexpected response from AI service.");
  }

  console.log(
    JSON.stringify({
      client: "runAI",
      type: input.type,
      ok: true,
      ms: Math.round(performance.now() - started),
      kind,
    }),
  );

  if (kind === "json" && value !== null && typeof value === "object") return value as object;
  if (kind === "text" && typeof value === "string") return value;
  throw new AIServiceError("parse", "Could not read the AI response.");
}
