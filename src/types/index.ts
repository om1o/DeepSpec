export type MotionPermissionState = "idle" | "granted" | "denied" | "unsupported";

export type CapturedFrame = {
  imageBase64: string;
  capturedAt: string;
};

export type SafetyTriage = "can_help" | "needs_better_photo" | "needs_professional";

export type Confidence = "high" | "medium" | "low";

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

export type IdentificationResult = {
  partName: string;
  confidence: Confidence;
  scanCategory: ScanCategory;
  whatItDoes: string;
  visibleObservations: string[];
  concerns: string[];
  safetyTriage: SafetyTriage;
  isSafetyCritical: boolean;
  nextAction: string;
  needsBetterPhoto: boolean;
  evidence: string[];
};

export type ScanAnalysisState = {
  frame: CapturedFrame;
  result?: IdentificationResult;
  errorMessage?: string;
  errorCode?: string;
  analyzedAt?: string;
  storageWarning?: string;
};

export type AIInput = {
  type: "vision" | "text";
  imageBase64?: string;
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
  rating: Rating;
  correction: string | null;
  notes: string;
  scanCategory: ScanCategory;
  trainingLabel: string;
  trainingStatus: TrainingStatus;
  chatHistory: ChatMessage[];
};
