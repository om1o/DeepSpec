export type MotionPermissionState = "idle" | "granted" | "denied" | "unsupported";

export type CapturedFrame = {
  imageBase64: string;
  capturedAt: string;
};

export type SafetyTriage = "can_help" | "needs_better_photo" | "needs_professional";

export type Confidence = "high" | "medium" | "low";

export type IdentificationResult = {
  partName: string;
  confidence: Confidence;
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
};

export type AIInput = {
  type: "vision" | "text";
  imageBase64?: string;
  userMessage: string;
  systemPrompt: string;
  responseAsJson?: boolean;
};
