import { FOLLOWUP_PROMPT, IDENTIFY_PROMPT } from "./systemPrompts";
import { identifyOnDevice, isOnDeviceFallbackEnabled } from "./onDeviceIdentify";
import {
  SCAN_CATEGORIES,
  type AIInput,
  type CandidateMatch,
  type CapturedFrame,
  type EvidenceRegion,
  type IdentificationResult,
  type IdentifyModelRun,
  type LabelRescueTrigger,
  type Lookup,
  type ScanCategory,
  type SourceLink,
} from "../types";

type AIErrorCode =
  | "image_too_large"
  | "invalid_input"
  | "invalid_response"
  | "network"
  | "not_configured"
  | "provider_error"
  | "rate_limited"
  | "unsupported";

export type AIErrorCategory = "input" | "model_response" | "provider_unavailable" | "setup" | "unknown";

export type AIErrorDetails = {
  category: AIErrorCategory;
  description: string;
  retryLabel: string;
  title: string;
};

type IdentifyApiSuccess = {
  result: IdentificationResult;
  modelRun?: IdentifyModelRun;
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
      ...(input.imageBase64_2 ? { imageBase64_2: input.imageBase64_2 } : {}),
      ...(input.labelRescueTrigger ? { labelRescueTrigger: input.labelRescueTrigger } : {}),
      userMessage: input.userMessage,
      responseAsJson: input.responseAsJson ?? true,
    });

    return {
      ...body.result,
      ...(body.modelRun ? { modelRun: body.modelRun } : {}),
    };
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

export async function identifyCapturedFrame(
  frame: CapturedFrame,
  secondFrame?: CapturedFrame,
  labelRescueTrigger?: LabelRescueTrigger,
): Promise<IdentificationResult> {
  if (isOnDeviceFallbackEnabled() && typeof navigator !== "undefined" && navigator.onLine === false) {
    return identifyOnDevice(frame);
  }

  try {
    const result = await runAI({
      type: "vision",
      imageBase64: frame.imageBase64,
      imageBase64_2: secondFrame?.imageBase64,
      labelRescueTrigger,
      userMessage: "Identify this car part from the captured photo.",
      systemPrompt: IDENTIFY_PROMPT,
      responseAsJson: true,
    });

    return assertIdentificationResult(result);
  } catch (error) {
    if (isOnDeviceFallbackEnabled() && error instanceof AIServiceError && error.code === "network") {
      return identifyOnDevice(frame);
    }

    throw error;
  }
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

export function getAIErrorDetails(code: string | undefined | null): AIErrorDetails {
  switch (code) {
    case "rate_limited":
      return {
        category: "provider_unavailable",
        description: "This is a provider quota or traffic issue, not proof the model identified the part incorrectly.",
        retryLabel: "Try again later",
        title: "AI provider is rate-limited",
      };
    case "network":
      return {
        category: "provider_unavailable",
        description: "The photo can be retried when the Deep Spec service can reach the AI provider again.",
        retryLabel: "Try again",
        title: "AI provider could not be reached",
      };
    case "provider_error":
      return {
        category: "provider_unavailable",
        description: "Treat this as provider health, not model quality. Retry after the provider recovers.",
        retryLabel: "Try again",
        title: "AI provider is unavailable",
      };
    case "invalid_response":
      return {
        category: "model_response",
        description: "The provider responded, but Deep Spec could not read the model output. This should count as a model or prompt failure.",
        retryLabel: "Try again",
        title: "AI response was unreadable",
      };
    case "not_configured":
      return {
        category: "setup",
        description: "The server is missing its AI provider configuration. This needs a deployment fix before retries will work.",
        retryLabel: "Try again",
        title: "AI is not configured",
      };
    case "image_too_large":
    case "invalid_input":
    case "unsupported":
      return {
        category: "input",
        description: "Change the request and try again.",
        retryLabel: "Try again",
        title: "Scan input needs attention",
      };
    default:
      return {
        category: "unknown",
        description: "The captured photo is still available, so you can retry without taking another scan.",
        retryLabel: "Try again",
        title: "Keep the photo and try again",
      };
  }
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
    isOptionalConfidenceScore(value.confidenceScore) &&
    isOptionalConfidenceRange(value.confidenceRange) &&
    isOptionalConfirmationNeed(value.confirmationNeed) &&
    isScanCategory(value.scanCategory) &&
    isCandidateMatchArray(value.candidateMatches) &&
    typeof value.whatItDoes === "string" &&
    isStringArray(value.visibleObservations) &&
    isEvidenceRegionArray(value.evidenceRegions) &&
    isStringArray(value.concerns) &&
    isSafetyTriage(value.safetyTriage) &&
    typeof value.isSafetyCritical === "boolean" &&
    typeof value.nextAction === "string" &&
    typeof value.needsBetterPhoto === "boolean" &&
    isStringArray(value.evidence) &&
    isSourceLinkArray(value.sourceLinks)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
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
    (item.sourceType === "dataset" || item.sourceType === "reference" || item.sourceType === "search" || item.sourceType === "safety")
  ));
}

function isConfidence(value: unknown) {
  return value === "high" || value === "medium" || value === "low";
}

function isOptionalConfidenceScore(value: unknown) {
  return value === undefined || (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100);
}

function isOptionalConfidenceRange(value: unknown) {
  if (value === undefined) {
    return true;
  }

  return (
    isRecord(value) &&
    typeof value.low === "number" &&
    typeof value.high === "number" &&
    Number.isFinite(value.low) &&
    Number.isFinite(value.high) &&
    value.low >= 0 &&
    value.high <= 100 &&
    value.low <= value.high
  );
}

function isOptionalConfirmationNeed(value: unknown) {
  return value === undefined || value === "none" || value === "one_more_angle" || value === "reference_needed";
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
