import { IDENTIFY_PROMPT } from "./systemPrompts";
import type { AIInput, CapturedFrame, IdentificationResult } from "../types";

type AIErrorCode = "invalid_input" | "not_configured" | "rate_limited" | "invalid_response" | "network" | "unsupported";

type IdentifyApiSuccess = {
  result: IdentificationResult;
};

type IdentifyApiFailure = {
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
  if (input.type !== "vision") {
    throw new AIServiceError("unsupported", "Text follow-up chat is planned for Phase 5.");
  }

  if (!input.imageBase64) {
    throw new AIServiceError("invalid_input", "No captured image was provided.");
  }

  const response = await fetch("/api/identify", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      imageBase64: input.imageBase64,
      userMessage: input.userMessage,
      responseAsJson: input.responseAsJson ?? true,
    }),
  }).catch(() => {
    throw new AIServiceError("network", "Could not reach the Deep Spec AI service.");
  });

  const body = (await response.json().catch(() => null)) as IdentifyApiSuccess | IdentifyApiFailure | null;

  if (!response.ok || !body || "error" in body) {
    const error = body && "error" in body ? body.error : null;
    throw new AIServiceError(error?.code ?? "network", error?.message ?? "Deep Spec could not analyze this photo.");
  }

  return body.result;
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
