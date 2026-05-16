import { FOLLOWUP_PROMPT, IDENTIFY_PROMPT } from "./systemPrompts";
import { SCAN_CATEGORIES, type AIInput, type CapturedFrame, type IdentificationResult, type Lookup, type ScanCategory } from "../types";

type AIErrorCode = "invalid_input" | "not_configured" | "rate_limited" | "invalid_response" | "network" | "unsupported";

type IdentifyApiSuccess = {
  result: IdentificationResult;
};

type ChatApiSuccess = {
  message: string;
};

type AIApiFailure = {
  error: {
    code: AIErrorCode | string;
    message: string;
  };
};

export class AIServiceError extends Error {
  code: AIErrorCode | string;

  constructor(code: AIErrorCode | string, message: string) {
    super(message);
    this.name = "AIServiceError";
    this.code = code;
  }
}

export async function runAI(input: AIInput): Promise<string | object> {
  if (input.type === "text") {
    if (!input.userMessage.trim()) {
      throw new AIServiceError("invalid_input", "Ask a question first.");
    }

    const body = await postAI<ChatApiSuccess>("/api/chat", {
      userMessage: input.userMessage,
      systemPrompt: input.systemPrompt,
      responseAsJson: input.responseAsJson ?? false,
    });

    return body.message;
  }

  if (input.type === "vision") {
    if (!input.imageBase64) {
      throw new AIServiceError("invalid_input", "No captured image was provided.");
    }

    const body = await postAI<IdentifyApiSuccess>("/api/identify", {
      imageBase64: input.imageBase64,
      userMessage: input.userMessage,
      responseAsJson: input.responseAsJson ?? true,
    });

    return body.result;
  }

  throw new AIServiceError("unsupported", "Deep Spec does not support that AI request yet.");
}

async function postAI<TSuccess extends object>(path: string, payload: object): Promise<TSuccess> {
  const response = await fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  }).catch(() => {
    throw new AIServiceError("network", "Could not reach the Deep Spec AI service.");
  });

  const body = (await response.json().catch(() => null)) as TSuccess | AIApiFailure | null;

  if (!response.ok || !body || "error" in body) {
    const error = body && "error" in body ? body.error : null;
    throw new AIServiceError(error?.code ?? "network", error?.message ?? "Deep Spec could not complete that AI request.");
  }

  return body;
}

export async function identifyCapturedFrame(frame: CapturedFrame): Promise<IdentificationResult> {
  const result = await runAI({
    type: "vision",
    imageBase64: frame.imageBase64,
    userMessage: "Identify this car part from the captured photo.",
    systemPrompt: IDENTIFY_PROMPT,
    responseAsJson: true,
  });

  return assertIdentificationResult(result);
}

export async function sendFollowUp(lookup: Lookup, question: string): Promise<string> {
  const trimmedQuestion = question.trim().slice(0, 500);
  if (!trimmedQuestion) {
    throw new AIServiceError("invalid_input", "Ask a question first.");
  }

  const result = await runAI({
    type: "text",
    userMessage: buildFollowUpContext(lookup, trimmedQuestion),
    systemPrompt: FOLLOWUP_PROMPT,
    responseAsJson: false,
  });

  if (typeof result !== "string" || !result.trim()) {
    throw new AIServiceError("invalid_response", "Deep Spec received an unreadable chat response.");
  }

  return result.trim();
}

export function getAIErrorMessage(error: unknown) {
  if (error instanceof AIServiceError) {
    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Deep Spec could not analyze this photo.";
}

function assertIdentificationResult(value: unknown): IdentificationResult {
  if (!isIdentificationResult(value)) {
    throw new AIServiceError("invalid_response", "Deep Spec received an unreadable AI response.");
  }

  return value;
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

function isRecord(value: unknown): value is Record<string, unknown> {
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

function buildFollowUpContext(lookup: Lookup, question: string) {
  const result = lookup.result;
  const recentMessages = lookup.chatHistory
    .slice(-6)
    .map((message) => `${message.role}: ${message.content}`)
    .join("\n");

  return [
    `Saved scan category: ${lookup.scanCategory}`,
    `Training label: ${lookup.trainingLabel}`,
    result ? `Part name: ${result.partName}` : "Part name: unknown",
    result ? `Confidence: ${result.confidence}` : "Confidence: unknown",
    result ? `Safety triage: ${result.safetyTriage}` : "Safety triage: unknown",
    result ? `Safety-critical: ${result.isSafetyCritical ? "yes" : "no"}` : "Safety-critical: unknown",
    result ? `What it does: ${result.whatItDoes}` : "",
    result ? `Visible observations: ${result.visibleObservations.join("; ") || "none"}` : "",
    result ? `Concerns: ${result.concerns.join("; ") || "none"}` : "",
    result ? `Next action: ${result.nextAction}` : "",
    lookup.correction ? `User correction: ${lookup.correction}` : "",
    recentMessages ? `Recent chat:\n${recentMessages}` : "",
    `User question: ${question}`,
  ]
    .filter(Boolean)
    .join("\n");
}
