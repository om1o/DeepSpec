export type MotionPermissionState = "idle" | "granted" | "denied" | "unsupported";

export type CapturedFrame = {
  imageBase64: string;
  capturedAt: string;
};

export type SafetyTriage = "can_help" | "needs_better_photo" | "needs_professional";

export type Confidence = "high" | "medium" | "low";

export type ConfirmationNeed = "none" | "one_more_angle" | "reference_needed";

export type LabelRescueTrigger = "too_blurry";

export type ScanQualityFailureReason =
  | "too_dark"
  | "lens_covered"
  | "too_bright"
  | "too_blurry"
  | "object_too_small"
  | "needs_better_photo";

export type ScanQualitySnapshot = {
  accepted: boolean;
  averageLuminance: number | null;
  brightPixelRatio: number | null;
  brightnessScore: number | null;
  cameraId: string;
  checkedAt: string;
  darkPixelRatio: number | null;
  failureReason?: ScanQualityFailureReason;
  firstPass: boolean;
  fixAction?: string;
  glareScore: number | null;
  gradientVariance: number | null;
  motionFallback: boolean;
  motionScore: number | null;
  motionStable: boolean;
  objectSizeRatio: number | null;
  previousFailureReason?: ScanQualityFailureReason;
  sampleHeight: number | null;
  sampleWidth: number | null;
  sharpnessScore: number | null;
  targetCenteredScore: number | null;
  targetConfidence: number | null;
  targetLocked: boolean;
};

export const SCAN_CATEGORIES = [
  "engine",
  "electrical",
  "brakes",
  "steering",
  "suspension",
  "fuel",
  "airbag",
  "body",
  "leak",
  "unknown",
] as const;

export type ScanCategory = (typeof SCAN_CATEGORIES)[number];

export type CandidateMatch = {
  partName: string;
  confidence: Confidence;
  scanCategory: ScanCategory;
  reason: string;
};

export type EvidenceRegion = {
  label: string;
  observation: string;
  regionLabel: string;
};

export type SourceLink = {
  label: string;
  url: string;
  sourceType: "dataset" | "reference" | "search" | "safety";
};

export type IdentifyProvider = "gemini" | "huggingface" | "groq" | "ollama" | "on-device";

export type IdentifyModelRun = {
  provider: IdentifyProvider;
  model: string;
  latencyMs: number;
  fallbackReason?: string;
  ocrUsed: boolean;
};

export type IdentificationResult = {
  partName: string;
  confidence: Confidence;
  confidenceScore?: number;
  confidenceRange?: {
    low: number;
    high: number;
  };
  confirmationNeed?: ConfirmationNeed;
  scanCategory: ScanCategory;
  candidateMatches: CandidateMatch[];
  whatItDoes: string;
  visibleObservations: string[];
  evidenceRegions: EvidenceRegion[];
  concerns: string[];
  safetyTriage: SafetyTriage;
  isSafetyCritical: boolean;
  nextAction: string;
  needsBetterPhoto: boolean;
  evidence: string[];
  sourceLinks: SourceLink[];
  modelRun?: IdentifyModelRun;
};

export type ScanAnalysisState = {
  frame: CapturedFrame;
  result?: IdentificationResult;
  errorMessage?: string;
  errorCode?: string;
  analyzedAt?: string;
  scanQuality?: ScanQualitySnapshot;
  storageWarning?: string;
};

export type AIInput = {
  type: "vision" | "text";
  imageBase64?: string;
  imageBase64_2?: string;
  labelRescueTrigger?: LabelRescueTrigger;
  userMessage: string;
  systemPrompt: string;
  responseAsJson?: boolean;
};

export type Rating = "up" | "down" | null;

export type TrainingStatus = "raw_unreviewed" | "user_confirmed" | "user_corrected";

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
};

export type Lookup = {
  id: string;
  createdAt: string;
  frame: CapturedFrame;
  result?: IdentificationResult;
  errorMessage?: string;
  errorCode?: string;
  analyzedAt?: string;
  scanQuality?: ScanQualitySnapshot;
  rating: Rating;
  correction: string | null;
  notes: string;
  scanCategory: ScanCategory;
  trainingLabel: string;
  trainingStatus: TrainingStatus;
  chatHistory: ChatMessage[];
};

export type WaitlistSignup = {
  id: string;
  createdAt: string;
  email: string;
  userType: "car_owner" | "van_life" | "used_car_buyer" | "weekend_wrencher" | "other";
  mainProblem: string;
};

export type FeedbackSubmission = {
  id: string;
  createdAt: string;
  category: "scanner" | "ai_result" | "saved_scans" | "chat" | "business" | "other";
  message: string;
  contactEmail: string;
};
