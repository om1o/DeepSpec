import { CHAT_USER_MESSAGE_MAX_CHARS, IDENTIFY_PROMPT } from "./systemPrompts";
import { identifyOnDevice, isOnDeviceFallbackEnabled } from "./onDeviceIdentify";
import { getAuthClient } from "./auth";
import { getAccountScope, isAccountScopeCurrent, type AccountScope } from "../lib/accountScope";
import { prepareRetryFrame } from "../lib/retryFrame";
import { compressImageDataUrl } from "../lib/utils";
import { validatePhotoGroup } from "./photoDraft";
import { normalizeConditionAssessment } from "../lib/conditionAssessment";
import { normalizePhotoReview, photoReviewForRelationship } from "../lib/photoReview";
import { buildConditionHandoff } from "../lib/conditionHandoff";
import { providerVehicleContext } from "../lib/vehicleContext";
import { hasFirstPhotoIdentityScopePipeline, isPhotoRelationship } from "../lib/photoRelationship";
import { isAIRequestId } from "../lib/aiRequestId";
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
  type MeasurementContext,
  type PartMeasurement,
  type PhotoRelationship,
  type PossibleVehicleContext,
  type ScanCategory,
  type ScanPhoto,
  type SourceLink,
  type VehicleContext,
} from "../types";

type AIErrorCode =
  | "connection_failed"
  | "entitlement_unavailable"
  | "feature_disabled"
  | "image_too_large"
  | "invalid_input"
  | "invalid_session"
  | "invalid_response"
  | "incomplete_response"
  | "missing_session"
  | "network"
  | "not_configured"
  | "provider_error"
  | "rate_limited"
  | "rate_limit_unavailable"
  | "response_blocked"
  | "request_timeout"
  | "scan_limit_reached"
  | "session_unavailable"
  | "service_response_error"
  | "timeout"
  | "unsupported";

export type AIErrorCategory = "connection" | "input" | "model_response" | "provider_unavailable" | "setup" | "unknown";

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
  sources?: SourceLink[];
  searchSuggestions?: string;
};

export type FollowUpOptions = { research?: boolean; sourceUrls?: string[] };
export type FollowUpDetails = ChatApiSuccess;

type AIRequestOptions = {
  signal?: AbortSignal;
};

const ON_DEVICE_PROVIDER_FALLBACK_TIMEOUT_MS = 90_000;
const DEFAULT_IDENTIFY_CLIENT_TIMEOUT_MS = 80_000;
const DEFAULT_CHAT_CLIENT_TIMEOUT_MS = 30_000;
const MAX_AI_REQUEST_BYTES = 4_000_000;
const MAX_SINGLE_IDENTIFY_IMAGE_CHARS = 3_800_000;
const MAX_DUAL_IDENTIFY_IMAGE_CHARS = 1_850_000;
const IDENTIFY_COMPRESSION_STEPS = [
  { maxLongestEdge: 1792, quality: 0.78 },
  { maxLongestEdge: 1536, quality: 0.74 },
  { maxLongestEdge: 1280, quality: 0.7 },
  { maxLongestEdge: 1024, quality: 0.66 },
  { maxLongestEdge: 768, quality: 0.62 },
] as const;

export class AIServiceError extends Error {
  code: AIErrorCode | string;
  requestId?: string;

  constructor(code: AIErrorCode | string, message: string, requestId?: string) {
    super(message);
    this.name = "AIServiceError";
    this.code = code;
    if (isAIRequestId(requestId)) this.requestId = requestId;
  }
}

export async function runAI(input: AIInput, options: AIRequestOptions = {}): Promise<string | object> {
  throwIfAborted(options.signal);
  const photoRelationship = validatePhotoRelationship(input.photoRelationship);
  const vehicleContext = providerVehicleContext(input.vehicleContext);
  if (input.type === "text") {
    if (!input.userMessage.trim()) {
      throw new AIServiceError("invalid_input", "Ask a question first.");
    }

    const body = await postAI<ChatApiSuccess>(
      "/api/chat",
      {
        userMessage: input.userMessage,
        photoRelationship,
        ...(vehicleContext ? { vehicleContext } : {}),
        ...(input.imageBase64 ? { imageBase64: input.imageBase64 } : {}),
        systemPrompt: input.systemPrompt,
        responseAsJson: input.responseAsJson ?? false,
      },
      { signal: options.signal, timeoutMs: DEFAULT_CHAT_CLIENT_TIMEOUT_MS },
    );

    return body.message;
  }

  if (input.type === "vision") {
    if (input.photos) {
      const scope = getAccountScope();
      const photos = await preparePhotoGroupForRequest(input.photos, options.signal);
      const body = await postAI<IdentifyApiSuccess>("/api/identify", {
        photos,
        photoRelationship,
        ...(vehicleContext ? { vehicleContext } : {}),
        ...(input.measurementContext ? { measurementContext: input.measurementContext } : {}),
        userMessage: input.userMessage,
        responseAsJson: true,
      }, { signal: options.signal, timeoutMs: getIdentifyClientTimeoutMs(), scope });
      return withValidatedConditionAssessment(
        { ...body.result, ...(body.modelRun ? { modelRun: body.modelRun } : {}) },
        photos.map((photo) => photo.id),
      );
    }
    if (!input.imageBase64) {
      throw new AIServiceError("invalid_input", "No captured image was provided.");
    }

    const imageLimit = input.imageBase64_2
      ? MAX_DUAL_IDENTIFY_IMAGE_CHARS
      : MAX_SINGLE_IDENTIFY_IMAGE_CHARS;
    const [imageBase64, imageBase64_2] = await Promise.all([
      fitIdentifyImageToRequest(input.imageBase64, imageLimit, options.signal),
      input.imageBase64_2
        ? fitIdentifyImageToRequest(input.imageBase64_2, imageLimit, options.signal)
        : Promise.resolve(undefined),
    ]);
    throwIfAborted(options.signal);

    const body = await postAI<IdentifyApiSuccess>(
      "/api/identify",
      {
        imageBase64,
        photoRelationship,
        ...(imageBase64_2 ? { imageBase64_2 } : {}),
        ...(input.labelRescueTrigger ? { labelRescueTrigger: input.labelRescueTrigger } : {}),
        ...(vehicleContext ? { vehicleContext } : {}),
        ...(input.measurementContext ? { measurementContext: input.measurementContext } : {}),
        userMessage: input.userMessage,
        responseAsJson: input.responseAsJson ?? true,
      },
      { signal: options.signal, timeoutMs: getIdentifyClientTimeoutMs() },
    );

    return withValidatedConditionAssessment({
      ...body.result,
      ...(body.modelRun ? { modelRun: body.modelRun } : {}),
    }, imageBase64_2 ? ["photo-1", "photo-2"] : ["photo-1"]);
  }

  throw new AIServiceError("unsupported", "Deep Spec does not support that AI request yet.");
}

function validatePhotoRelationship(value: unknown): PhotoRelationship {
  if (value === undefined) return "unknown";
  if (isPhotoRelationship(value)) return value;
  throw new AIServiceError("invalid_input", "Choose a supported photo relationship before analyzing or asking a question.");
}

async function postAI<TSuccess extends object>(
  path: string,
  payload: object,
  options: { signal?: AbortSignal; timeoutMs: number; scope?: AccountScope },
): Promise<TSuccess> {
  throwIfAborted(options.signal);
  if (options.scope && !isAccountScopeCurrent(options.scope)) throw new AIServiceError("invalid_input", "Account changed. Reopen this scan before asking a question.");
  const requestBody = JSON.stringify(payload);
  if (new TextEncoder().encode(requestBody).byteLength > MAX_AI_REQUEST_BYTES) {
    throw new AIServiceError("image_too_large", "The photo request is too large. Try a lower-resolution photo.");
  }
  const authHeader = await getAuthHeader();
  throwIfAborted(options.signal);
  if (options.scope && !isAccountScopeCurrent(options.scope)) throw new AIServiceError("invalid_input", "Account changed. Reopen this scan before asking a question.");
  const requestId = crypto.randomUUID();
  const started = Date.now();
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort();
  options.signal?.addEventListener("abort", abortFromCaller, { once: true });
  const timeoutId = setTimeout(() => controller.abort(), options.timeoutMs);
  let stage: "fetch" | "body" = "fetch";
  let httpStatus: number | undefined;
  try {
    const response = await fetch(path, {
      method: "POST",
      signal: controller.signal,
      headers: {
        ...(authHeader ? { Authorization: authHeader } : {}),
        "Content-Type": "application/json",
        "X-DeepSpec-Request-Id": requestId,
      },
      body: requestBody,
    });
    httpStatus = response.status;
    stage = "body";
    // fetch resolves at headers. Keep cancellation and the deadline through the body read.
    const body: unknown = await response.json();
    throwIfAborted(options.signal);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new AIServiceError("service_response_error", "DeepSpec could not read the service response. Try again.", requestId);
    }
    if ("error" in body) {
      const error = body.error;
      if (error && typeof error === "object" && "code" in error && typeof error.code === "string"
        && "message" in error && typeof error.message === "string") {
        throw new AIServiceError(error.code, error.message, requestId);
      }
      throw new AIServiceError("service_response_error", "DeepSpec could not read the service response. Try again.", requestId);
    }
    if (!response.ok) {
      throw new AIServiceError("service_response_error", "DeepSpec could not complete this request. Try again.", requestId);
    }
    return body as TSuccess;
  } catch (error) {
    if (options.signal?.aborted) throw createAbortError();
    // Only fixed metadata is logged; no question, photo, credential or raw exception.
    console.warn("[DeepSpec Connection]", { requestId, path, stage, httpStatus, durationMs: Date.now() - started });
    if (error instanceof AIServiceError) throw error;
    if (controller.signal.aborted) {
      throw new AIServiceError("request_timeout", "DeepSpec did not return a complete response in time. Try again.", requestId);
    }
    if (error instanceof SyntaxError) {
      throw new AIServiceError("service_response_error", "DeepSpec could not read the service response. Try again.", requestId);
    }
    throw new AIServiceError("connection_failed", "The connection to DeepSpec was interrupted before a complete response arrived. Try again.", requestId);
  } finally {
    clearTimeout(timeoutId);
    options.signal?.removeEventListener("abort", abortFromCaller);
  }
}

async function fitIdentifyImageToRequest(dataUrl: string, maxChars: number, signal?: AbortSignal) {
  throwIfAborted(signal);
  if (dataUrl.length <= maxChars) {
    return dataUrl;
  }

  try {
    for (const step of IDENTIFY_COMPRESSION_STEPS) {
      throwIfAborted(signal);
      const compressed = await compressImageDataUrl(dataUrl, step.maxLongestEdge, step.quality);
      throwIfAborted(signal);
      if (compressed.length <= maxChars) {
        return compressed;
      }
    }
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw new AIServiceError("invalid_input", "The captured photo could not be prepared for scanning.");
  }

  throw new AIServiceError("image_too_large", "The captured photo is too large. Try a lower-resolution photo.");
}

export async function preparePhotoGroupForRequest(photos: ScanPhoto[], signal?: AbortSignal) {
  if (!photos.length || photos.length > 4) throw new AIServiceError("invalid_input", "Choose one to four labeled photos.");
  const prepared: ScanPhoto[] = [];
  for (const photo of photos) {
    throwIfAborted(signal);
    const frame = await prepareRetryFrame(photo);
    prepared.push({ ...photo, ...frame, imageBase64: await fitIdentifyImageToRequest(frame.imageBase64, Math.floor(3_700_000 / photos.length), signal) });
  }
  if (!validatePhotoGroup(prepared)) throw new AIServiceError("invalid_input", "The saved photo group is incomplete. Reopen it before retrying.");
  return prepared.map(({ id, label, imageBase64 }) => ({ id, label, imageBase64 }));
}

export async function identifyCapturedFrame(
  frame: CapturedFrame,
  secondFrame?: CapturedFrame,
  labelRescueTrigger?: LabelRescueTrigger,
  options: {
    photos?: ScanPhoto[];
    photoRelationship?: PhotoRelationship;
    measurementContext?: MeasurementContext;
    signal?: AbortSignal;
    vehicleContext?: VehicleContext;
  } = {},
): Promise<IdentificationResult> {
  throwIfAborted(options.signal);
  validatePhotoRelationship(options.photoRelationship);
  if (options.photos && typeof navigator !== "undefined" && navigator.onLine === false) {
    throw new AIServiceError("connection_failed", "Your photo group is saved on this device. Reconnect and retry to analyze every angle together.");
  }
  if (!options.photos && isOnDeviceFallbackEnabled() && typeof navigator !== "undefined" && navigator.onLine === false) {
    const offlineResult = await identifyOnDevice(frame);
    throwIfAborted(options.signal);
    return assertIdentificationResult(offlineResult, ["photo-1"]);
  }

  const result = await runCloudIdentify(frame, secondFrame, labelRescueTrigger, options).catch((error: unknown) => {
    throwIfAborted(options.signal);
    if (!options.photos && shouldUseOnDeviceAfterCloudError(error)) {
      return identifyOnDeviceWithTimeout(frame, error, options.signal)
        .then((offlineResult) => assertIdentificationResult(offlineResult, ["photo-1"]));
    }

    throw error;
  });

  return assertIdentificationResult(result, options.photos?.map((photo) => photo.id)
    ?? (secondFrame ? ["photo-1", "photo-2"] : ["photo-1"]));
}

function getIdentifyClientTimeoutMs() {
  const raw = import.meta.env.VITE_DEEPSPEC_IDENTIFY_CLIENT_TIMEOUT_MS
    || (typeof process !== "undefined" ? process.env.VITE_DEEPSPEC_IDENTIFY_CLIENT_TIMEOUT_MS : undefined);
  const timeoutMs = Number(raw);
  return Number.isInteger(timeoutMs) && timeoutMs >= 1_000 && timeoutMs <= 85_000
    ? timeoutMs
    : DEFAULT_IDENTIFY_CLIENT_TIMEOUT_MS;
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError"
    || (typeof error === "object" && error !== null && "name" in error && error.name === "AbortError");
}

export function isAIRequestCanceled(error: unknown) {
  return isAbortError(error);
}

function createAbortError() {
  return new DOMException("The scan was canceled.", "AbortError");
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw createAbortError();
  }
}

async function getAuthHeader() {
  const client = await getAuthClient().catch(() => null);
  if (!client) {
    return "";
  }

  const session = await client.auth.getSession().catch(() => null);
  const token = session?.data.session?.access_token;
  return token ? `Bearer ${token}` : "";
}

function runCloudIdentify(
  frame: CapturedFrame,
  secondFrame: CapturedFrame | undefined,
  labelRescueTrigger: LabelRescueTrigger | undefined,
  options: {
    photos?: ScanPhoto[];
    photoRelationship?: PhotoRelationship;
    measurementContext?: MeasurementContext;
    signal?: AbortSignal;
    vehicleContext?: VehicleContext;
  },
) {
  return runAI({
    type: "vision",
    imageBase64: frame.imageBase64,
    imageBase64_2: secondFrame?.imageBase64,
    photos: options.photos,
    photoRelationship: options.photoRelationship,
    labelRescueTrigger,
    measurementContext: options.measurementContext,
    userMessage: "Identify this car part from the captured photo.",
    vehicleContext: options.vehicleContext,
    systemPrompt: IDENTIFY_PROMPT,
    responseAsJson: true,
  }, { signal: options.signal });
}

function shouldUseOnDeviceAfterCloudError(error: unknown) {
  if (!isOnDeviceFallbackEnabled() || !(error instanceof AIServiceError)) {
    return false;
  }

  const category = getAIErrorDetails(error.code).category;
  return category === "provider_unavailable" || category === "connection";
}

async function identifyOnDeviceWithTimeout(frame: CapturedFrame, cloudError: unknown, signal?: AbortSignal) {
  throwIfAborted(signal);
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let abortListener: (() => void) | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => reject(cloudError), ON_DEVICE_PROVIDER_FALLBACK_TIMEOUT_MS);
  });
  const canceled = new Promise<never>((_resolve, reject) => {
    if (!signal) return;
    abortListener = () => reject(createAbortError());
    signal.addEventListener("abort", abortListener, { once: true });
  });

  try {
    return await Promise.race([identifyOnDevice(frame), timeout, canceled]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    if (abortListener) {
      signal?.removeEventListener("abort", abortListener);
    }
  }
}

export async function sendFollowUp(lookup: Lookup, question: string): Promise<string> {
  return (await sendFollowUpDetails(lookup, question)).message;
}

export async function sendFollowUpDetails(lookup: Lookup, question: string, options: FollowUpOptions = {}): Promise<FollowUpDetails> {
  const photoRelationship = validatePhotoRelationship(lookup.photoRelationship);
  const hasFirstPhotoIdentityScope = hasFirstPhotoIdentityScopePipeline(lookup.result?.modelRun?.pipelineVersion)
    && ((lookup.photos?.length ?? 1) <= 1 || photoRelationship !== "same_part_or_area");
  const savedIdentityScope = !lookup.result ? "none"
    : hasFirstPhotoIdentityScope ? "first_photo" : "unrecorded";
  const trimmedQuestion = question.trim().slice(0, 500);
  if (!trimmedQuestion) {
    throw new AIServiceError("invalid_input", "Ask a question first.");
  }

  const scope = getAccountScope();
  if (!isAccountScopeCurrent(scope)) throw new AIServiceError("invalid_input", "Reopen this scan before asking a question.");
  // Keep vehicle facts separate from the bounded question/history text, and
  // exclude customer, registration and technician metadata at the transport edge.
  const vehicleContext = providerVehicleContext(lookup.vehicleContext);
  if (lookup.photos?.length) {
    const photos = await preparePhotoGroupForRequest(lookup.photos);
    const photoReview = photoReviewForRelationship(normalizePhotoReview(lookup.result?.photoReview, photos.map((photo) => photo.id)), photoRelationship);
    const conditionAssessment = normalizeConditionAssessment(lookup.result?.conditionAssessment, photos.map((photo) => photo.id));
    const result = await postAI<ChatApiSuccess>("/api/chat", {
      userMessage: buildFollowUpContext(lookup, trimmedQuestion), photos, photoRelationship, savedIdentityScope,
      ...(photoReview ? { photoReview } : {}),
      ...(conditionAssessment ? { conditionAssessment } : {}),
      ...(vehicleContext ? { vehicleContext } : {}),
      ...(options.research ? { research: true, ...(options.sourceUrls?.length ? { sourceUrls: options.sourceUrls } : {}) } : {}),
    }, { timeoutMs: options.research ? 60_000 : DEFAULT_CHAT_CLIENT_TIMEOUT_MS, scope });
    if (typeof result.message !== "string" || !result.message.trim()) throw new AIServiceError("invalid_response", "Deep Spec received an unreadable chat response.");
    return {
      message: result.message.trim(),
      ...(isSourceLinkArray(result.sources) ? { sources: result.sources.filter((source) => /^https:\/\//.test(source.url)).slice(0, 8) } : {}),
      ...(typeof result.searchSuggestions === "string" && result.searchSuggestions.length <= 50_000 ? { searchSuggestions: result.searchSuggestions } : {}),
    };
  }
  let imageBase64: string;
  try {
    imageBase64 = (await prepareRetryFrame(lookup.frame)).imageBase64;
  } catch (error) {
    throw new AIServiceError("invalid_input", error instanceof Error ? error.message : "The saved photo could not be loaded. Reopen this scan to refresh its link.");
  }
  const attachPhoto = imageBase64.length <= 4_000_000 && /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(imageBase64) && imageBase64.split(",")[1].length % 4 === 0;
  if (!attachPhoto) throw new AIServiceError("invalid_input", "The saved photo must be a JPEG, PNG, or WebP image small enough for chat. Reopen the scan or use a smaller photo.");
  const photoReview = photoReviewForRelationship(normalizePhotoReview(lookup.result?.photoReview, ["photo-1"]), photoRelationship);
  const conditionAssessment = normalizeConditionAssessment(lookup.result?.conditionAssessment, ["photo-1"]);
  const result = await postAI<ChatApiSuccess>("/api/chat", {
    userMessage: buildFollowUpContext(lookup, trimmedQuestion),
    photoRelationship,
    savedIdentityScope,
    ...(photoReview ? { photoReview } : {}),
    ...(conditionAssessment ? { conditionAssessment } : {}),
    ...(vehicleContext ? { vehicleContext } : {}),
    imageBase64,
    ...(options.research ? { research: true, ...(options.sourceUrls?.length ? { sourceUrls: options.sourceUrls } : {}) } : {}),
  }, { timeoutMs: options.research ? 60_000 : DEFAULT_CHAT_CLIENT_TIMEOUT_MS, scope });

  if (typeof result.message !== "string" || !result.message.trim()) {
    throw new AIServiceError("invalid_response", "Deep Spec received an unreadable chat response.");
  }

  return {
    message: result.message.trim(),
    ...(isSourceLinkArray(result.sources) ? { sources: result.sources.filter((source) => /^https:\/\//.test(source.url)).slice(0, 8) } : {}),
    ...(typeof result.searchSuggestions === "string" && result.searchSuggestions.length <= 50_000 ? { searchSuggestions: result.searchSuggestions } : {}),
  };
}

export function getAIErrorMessage(error: unknown) {
  if (error instanceof AIServiceError) {
    return error.requestId ? `${error.message} Reference: ${error.requestId}` : error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Deep Spec could not analyze this photo.";
}

export function getAIErrorDetails(code: string | undefined | null): AIErrorDetails {
  switch (code) {
    case "connection_failed":
      return {
        category: "connection",
        description: "The app did not receive a complete response. This does not establish an AI provider failure. Your saved photos remain available for retry.",
        retryLabel: "Try again",
        title: "Connection to DeepSpec interrupted",
      };
    case "request_timeout":
      return {
        category: "connection",
        description: "The app stopped waiting for a complete response. The server may still be processing it. Your saved photos remain available.",
        retryLabel: "Try again",
        title: "DeepSpec request timed out",
      };
    case "service_response_error":
      return {
        category: "connection",
        description: "The service response could not be read. This is not a result about your photo. Use the reference below if the problem repeats.",
        retryLabel: "Try again",
        title: "DeepSpec response could not be read",
      };
    case "feature_disabled":
      return {
        category: "setup",
        description: "This beta has follow-up chat disabled at the server, so retrying will not send a provider request.",
        retryLabel: "Unavailable",
        title: "Follow-up chat is unavailable",
      };
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
    case "timeout":
      return {
        category: "provider_unavailable",
        description: "The provider did not finish in time. Your saved photos remain available for another attempt.",
        retryLabel: "Try again",
        title: "AI reply timed out",
      };
    case "incomplete_response":
      return {
        category: "model_response",
        description: "The provider did not return a complete result. Your saved photos remain available for another attempt.",
        retryLabel: "Try again",
        title: "AI response was incomplete",
      };
    case "response_blocked":
      return {
        category: "input",
        description: "The provider declined this request. No AI result was added to your saved work.",
        retryLabel: "Change request",
        title: "AI could not complete this request",
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

function withValidatedConditionAssessment(value: IdentificationResult, allowedPhotoIds: readonly string[]): IdentificationResult {
  const { conditionAssessment: rawAssessment, photoReview: rawPhotoReview, ...result } = value;
  const conditionAssessment = normalizeConditionAssessment(rawAssessment, allowedPhotoIds);
  const photoReview = normalizePhotoReview(rawPhotoReview, allowedPhotoIds);
  return { ...result, ...(conditionAssessment ? { conditionAssessment } : {}), ...(photoReview ? { photoReview } : {}) };
}

function assertIdentificationResult(value: unknown, allowedPhotoIds: readonly string[]): IdentificationResult {
  if (!isIdentificationResult(value)) {
    throw new AIServiceError("invalid_response", "Deep Spec received an unreadable AI response.");
  }

  return withValidatedConditionAssessment(value, allowedPhotoIds);
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
    isOptionalCandidatePart(value.primaryPart) &&
    isOptionalCandidatePartArray(value.candidateParts) &&
    isOptionalPossibleVehicleContextArray(value.possibleVehicleContexts) &&
    isOptionalPartMeasurementArray(value.measurements) &&
    isOptionalStringArray(value.requiredNextEvidence) &&
    isOptionalFitmentConfidence(value.fitmentConfidence) &&
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

function isOptionalStringArray(value: unknown): value is string[] | undefined {
  return value === undefined || isStringArray(value);
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

function isOptionalCandidatePart(value: unknown) {
  return value === undefined || (
    isRecord(value) &&
    typeof value.partName === "string" &&
    isConfidence(value.confidence) &&
    isScanCategory(value.scanCategory) &&
    isStringArray(value.evidence) &&
    (value.whyNotPrimary === undefined || typeof value.whyNotPrimary === "string")
  );
}

function isOptionalCandidatePartArray(value: unknown) {
  return value === undefined || (Array.isArray(value) && value.every(isOptionalCandidatePart));
}

function isOptionalPossibleVehicleContextArray(value: unknown): value is PossibleVehicleContext[] | undefined {
  return value === undefined || (Array.isArray(value) && value.every((item) => (
    isRecord(item) &&
    typeof item.label === "string" &&
    isConfidence(item.confidence) &&
    isStringArray(item.evidence)
  )));
}

function isOptionalPartMeasurementArray(value: unknown): value is PartMeasurement[] | undefined {
  return value === undefined || (Array.isArray(value) && value.every((item) => (
    isRecord(item) &&
    typeof item.label === "string" &&
    typeof item.valueMm === "number" &&
    Number.isFinite(item.valueMm) &&
    item.valueMm > 0 &&
    isConfidence(item.confidence) &&
    (item.method === "reference_object" || item.method === "visible_marking" || item.method === "estimated") &&
    typeof item.caveat === "string"
  )));
}

function isOptionalFitmentConfidence(value: unknown) {
  return value === undefined ||
    value === "not_applicable" ||
    value === "needs_vehicle_context" ||
    value === "possible" ||
    value === "supported";
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

/**
 * The follow-up message: scan facts, recent chat, then the question — kept within the chat API's
 * CHAT_USER_MESSAGE_MAX_CHARS cut. The question used to come last with no budget, so a detailed
 * result plus a couple of long answers pushed it past the cut and the model never saw it. Now the
 * question's room is reserved first, facts are trimmed to fit, and recent chat fills what's left,
 * newest first.
 */
function collapseWhitespace(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function buildFollowUpContext(lookup: Lookup, question: string) {
  const result = lookup.result;
  const condition = buildConditionHandoff(lookup);
  const functionalChecks = lookup.inspection
    ? `${lookup.inspection.functionalStatus.replaceAll("_", " ")} (self-reported inspection)`
    : condition.functionStatus;
  const questionLine = `User question: ${question}`;
  const facts = [
    `Saved scan category: ${lookup.scanCategory}`,
    `Training label: ${lookup.trainingLabel}`,
    result ? `Part name: ${result.partName}` : "Part name: unknown",
    result ? `Confidence: ${result.confidence}` : "Confidence: unknown",
    result ? `Safety triage: ${result.safetyTriage}` : "Safety triage: unknown",
    result ? `Safety-critical: ${result.isSafetyCritical ? "yes" : "no"}` : "Safety-critical: unknown",
    result ? `Next action: ${result.nextAction}` : "",
    lookup.correction ? `User correction: ${lookup.correction}` : "",
    ...(condition.assessment ? [
      "Condition evidence is AI-reported, not human confirmation. Causes are hypotheses; photos do not establish hidden damage or serviceability.",
      `Functional checks: ${functionalChecks}`,
      `Still unknown: ${condition.unknowns.join("; ") || "No unknowns listed; condition and function are not established."}`,
      ...(condition.nextEvidence ? [`Priority evidence: ${condition.nextEvidence.request} Why: ${condition.nextEvidence.purpose}`] : []),
      ...condition.observations.map((item) => `Observed appearance [${item.id}] in photos [${item.photoIds.join(", ")}]: ${item.text}`),
      ...condition.possibleCauses.map((item) => `Unconfirmed possible cause, based on [${item.observationIds.join(", ")}]: ${item.text}`),
    ] : []),
    result ? `What it does: ${result.whatItDoes}` : "",
    result ? `Visible observations: ${result.visibleObservations.join("; ") || "none"}` : "",
    result ? `Concerns: ${result.concerns.join("; ") || "none"}` : "",
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, Math.max(0, CHAT_USER_MESSAGE_MAX_CHARS - questionLine.length - 1));

  // Older saved conversations can end with an unanswered question being retried.
  // Compare collapsed whitespace so that question is not included twice in the prompt.
  const history = lookup.chatHistory.slice(-7);
  const last = history[history.length - 1];
  if (last?.role === "user" && collapseWhitespace(last.content) === collapseWhitespace(question)) {
    history.pop();
  }

  const chatHeader = "Recent chat:";
  let room = CHAT_USER_MESSAGE_MAX_CHARS - questionLine.length - facts.length - chatHeader.length - 3;
  const chatLines: string[] = [];
  for (const message of history.slice(-6).reverse()) {
    const line = `${message.role}: ${message.content}`;
    if (line.length + 1 > room) {
      break;
    }
    chatLines.unshift(line);
    room -= line.length + 1;
  }

  return [facts, chatLines.length ? `${chatHeader}\n${chatLines.join("\n")}` : "", questionLine]
    .filter(Boolean)
    .join("\n");
}
