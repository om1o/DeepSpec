export type MotionPermissionState = "idle" | "granted" | "denied" | "unsupported";

export type CapturedFrame = {
  imageBase64: string;
  capturedAt: string;
};

export type VisualFocusMode = "mask" | "crop" | "full_frame";

export type VisualFocusBox = {
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
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

export type VehicleContext = {
  vin?: string;
  year?: string;
  make?: string;
  model?: string;
  engine?: string;
  notes?: string;
};

export type ShopRole = "owner" | "admin" | "technician" | "viewer";

export type ShopJobStatus = "open" | "in_progress" | "ready_for_review" | "closed";

export type ShopReviewStatus = "needs_review" | "confirmed" | "corrected";

export type Organization = {
  id: string;
  createdAt: string;
  name: string;
  ownerUserId?: string;
  slug: string;
};

export type OrganizationMember = {
  id: string;
  createdAt: string;
  orgId: string;
  role: ShopRole;
  userId: string;
};

export type ShopVehicleContext = VehicleContext & {
  bayOrRo?: string;
  customerName?: string;
  jobTitle?: string;
  mileage?: string;
  plate?: string;
  symptom?: string;
  technicianName?: string;
};

export type ShopJob = {
  id: string;
  bayOrRo?: string;
  createdAt: string;
  createdByUserId?: string;
  customerName?: string;
  engine?: string;
  make: string;
  mileage?: string;
  model: string;
  notes?: string;
  orgId: string;
  plate?: string;
  reviewStatus: ShopReviewStatus;
  scanIds: string[];
  status: ShopJobStatus;
  symptom: string;
  technicianName: string;
  title: string;
  updatedAt: string;
  vin?: string;
  year: string;
};

export type CustomerVisibleReport = {
  generatedAt: string;
  summary: string;
  title: string;
};

export type ShopFeedbackPermission = {
  orgId: string;
  learningOptIn: boolean;
  updatedAt: string;
};

export type MeasurementReferenceType = "card_short_edge" | "card_long_edge" | "us_quarter" | "us_nickel" | "known_fastener" | "custom";

export type MeasurementContext = {
  referenceType: MeasurementReferenceType;
  referenceLabel: string;
  referenceMm: number;
  referencePx?: number;
  selectedRegion?: {
    height: number;
    width: number;
    x: number;
    y: number;
  };
};

export type CandidatePart = {
  partName: string;
  confidence: Confidence;
  scanCategory: ScanCategory;
  evidence: string[];
  whyNotPrimary?: string;
};

export type PossibleVehicleContext = {
  label: string;
  confidence: Confidence;
  evidence: string[];
};

export type PartMeasurement = {
  label: string;
  valueMm: number;
  confidence: Confidence;
  method: "reference_object" | "visible_marking" | "estimated";
  caveat: string;
};

export type FitmentConfidence = "not_applicable" | "needs_vehicle_context" | "possible" | "supported";

export type EvidenceRegion = {
  label: string;
  observation: string;
  regionLabel: string;
};

export type SceneObject = {
  name: string;
  category: ScanCategory | string;
  regionLabel: string;
  primary: boolean;
};

// A scene object that has been cut out (SlimSAM) for the multi-object AR view. In-memory
// only (the cutout PNGs are too large to persist); a reopened scan shows the primary alone.
export type IsolatedObject = {
  name: string;
  category: ScanCategory | string;
  focusBox: VisualFocusBox;
  isolatedImageBase64: string;
  primary: boolean;
};

// Dev-only isolation diagnostics for the on-screen debug overlay (gated by VITE_DEEPSPEC_DEBUG).
export type ScanDebugInfo = {
  webgpu?: boolean;
  segmenter?: "SAM" | "MVANet" | "crop" | "full frame" | "none";
  focusMode?: VisualFocusMode;
  samLoadMs?: number;
  samInferenceMs?: number;
  samModelMs?: number;
  samPostMs?: number;
  samMaskDims?: string;
  samOk?: boolean;
  samError?: string;
  // Geometry diagnostics for the "mask succeeded but the cutout is a wrong/tiny blob" failure
  // mode: where we told SAM to look (frame dims + target box) vs. what it actually saw and found.
  samFrameDims?: string;
  samModelDims?: string;
  samMaskBoxNorm?: string;
  samMaskCoverage?: number;
  samTargetBoxNorm?: string;
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
  primaryPart?: CandidatePart;
  confidence: Confidence;
  confidenceScore?: number;
  confidenceRange?: {
    low: number;
    high: number;
  };
  candidateParts?: CandidatePart[];
  possibleVehicleContexts?: PossibleVehicleContext[];
  measurements?: PartMeasurement[];
  requiredNextEvidence?: string[];
  fitmentConfidence?: FitmentConfidence;
  confirmationNeed?: ConfirmationNeed;
  scanCategory: ScanCategory;
  candidateMatches: CandidateMatch[];
  whatItDoes: string;
  visibleObservations: string[];
  evidenceRegions: EvidenceRegion[];
  sceneObjects?: SceneObject[];
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
  focusBox?: VisualFocusBox;
  focusMode?: VisualFocusMode;
  isolatedImageBase64?: string;
  isolatedObjects?: IsolatedObject[];
  debug?: ScanDebugInfo;
  result?: IdentificationResult;
  errorMessage?: string;
  errorCode?: string;
  analyzedAt?: string;
  scanQuality?: ScanQualitySnapshot;
  storageWarning?: string;
  provenance?: ScanProvenance;
  customerVisibleReport?: CustomerVisibleReport;
  jobId?: string;
  orgId?: string;
  reviewStatus?: ShopReviewStatus;
  technicianUserId?: string;
  vehicleContext?: ShopVehicleContext;
};

export type AIInput = {
  type: "vision" | "text";
  imageBase64?: string;
  imageBase64_2?: string;
  labelRescueTrigger?: LabelRescueTrigger;
  measurementContext?: MeasurementContext;
  userMessage: string;
  vehicleContext?: VehicleContext;
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

export type ScanCaptureMode = "camera" | "upload";

export type ScanAnalysisSource = "ai_detection" | "cached_match" | "manual_retry" | "offline_upgrade";

export type ScanProvenance = {
  analysisSource: ScanAnalysisSource;
  captureMode: ScanCaptureMode;
  savedAt: string;
};

export type Lookup = {
  id: string;
  createdAt: string;
  frame: CapturedFrame;
  focusBox?: VisualFocusBox;
  focusMode?: VisualFocusMode;
  isolatedImageBase64?: string;
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
  provenance: ScanProvenance;
  customerVisibleReport?: CustomerVisibleReport;
  jobId?: string;
  orgId?: string;
  reviewStatus?: ShopReviewStatus;
  technicianUserId?: string;
  vehicleContext?: ShopVehicleContext;
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
