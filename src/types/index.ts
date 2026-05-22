export type MotionPermissionState = "idle" | "granted" | "denied" | "unsupported";

export type CapturedFrame = {
  imageBase64: string;
  capturedAt: string;
};

export type SafetyTriage = "can_help" | "needs_better_photo" | "needs_professional";

export type Confidence = "high" | "medium" | "low";

export type LabelRescueTrigger = "too_blurry";

export const EVIDENCE_ANCHORS = [
  "scanned_area",
  "upper_left",
  "upper",
  "upper_right",
  "left",
  "center",
  "right",
  "lower_left",
  "lower",
  "lower_right",
] as const;

export type EvidenceAnchor = (typeof EVIDENCE_ANCHORS)[number];

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
  anchor?: EvidenceAnchor;
  label: string;
  observation: string;
  regionLabel: string;
};

export type SourceLink = {
  label: string;
  url: string;
  sourceType: "dataset" | "reference" | "search" | "safety";
};

export type IdentificationResult = {
  partName: string;
  confidence: Confidence;
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
};

export type ScanAnalysisState = {
  frame: CapturedFrame;
  result?: IdentificationResult;
  errorMessage?: string;
  errorCode?: string;
  analyzedAt?: string;
  modelRun?: AIModelRun;
  storageWarning?: string;
  /** Set when `?test=1`; result is in-memory only with no history or cloud save. */
  testRun?: boolean;
  /** Dev fixture label (e.g. which OEM sample photo was used). */
  testVehicleLabel?: string;
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

export type AIModelRun = {
  id: string;
  createdAt: string;
  kind: "identify" | "chat";
  provider: "gemini";
  model: string;
  promptVersion: string;
  latencyMs: number;
  ocrModel?: string;
  ocrText?: string;
  ocrUsed: boolean;
};

export type CloudSyncEvent = {
  id: string;
  createdAt: string;
  imagePath?: string;
  message: string;
  status: "success" | "failure";
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
  modelRuns: AIModelRun[];
  syncEvents: CloudSyncEvent[];
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
