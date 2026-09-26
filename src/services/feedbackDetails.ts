import type { FeedbackSubmission } from "../types";

export const FEEDBACK_ISSUES = [
  { id: "wrong_part", label: "Wrong part", category: "ai_result" },
  { id: "wrong_vehicle", label: "Wrong vehicle", category: "ai_result" },
  { id: "wrong_value", label: "Wrong value", category: "ai_result" },
  { id: "wrong_condition", label: "Wrong condition assessment", category: "ai_result" },
  { id: "missing_information", label: "Missing information", category: "ai_result" },
  { id: "bad_explanation", label: "Bad explanation", category: "ai_result" },
  { id: "other_result", label: "Other result problem", category: "ai_result" },
  { id: "ar_placement", label: "AR: wrong placement", category: "scanner" },
  { id: "ar_component", label: "AR: wrong component highlighted", category: "scanner" },
  { id: "ar_jitter", label: "AR: jitter or shaking", category: "scanner" },
  { id: "ar_tracking", label: "AR: tracking lost", category: "scanner" },
  { id: "ar_disappeared", label: "AR: overlay disappeared", category: "scanner" },
  { id: "ar_camera", label: "AR: camera issue", category: "scanner" },
  { id: "ar_label", label: "AR: incorrect label", category: "scanner" },
  { id: "ar_detection", label: "AR: poor detection", category: "scanner" },
  { id: "ar_other", label: "AR: other problem", category: "scanner" },
  { id: "bug", label: "General bug", category: "other" },
  { id: "feature_request", label: "Feature request", category: "other" },
] as const;

export type FeedbackIssue = typeof FEEDBACK_ISSUES[number]["id"];
export type FeedbackContext = { scanId: string; predictedPart: string };

export function getFeedbackIssue(value: unknown) {
  return FEEDBACK_ISSUES.find((issue) => issue.id === value);
}

export function normalizeFeedbackContext(value: unknown): FeedbackContext | undefined {
  if (!value || typeof value !== "object") return undefined;
  const context = value as Partial<FeedbackContext>;
  if (typeof context.scanId !== "string" || !context.scanId.trim()) return undefined;
  return {
    scanId: context.scanId.trim().replace(/\s+/g, " ").slice(0, 100),
    predictedPart: typeof context.predictedPart === "string" ? context.predictedPart.trim().replace(/\s+/g, " ").slice(0, 160) : "",
  };
}

// The existing cloud table has no issue/context columns. Keep a versioned,
// human-readable envelope in its message until a dedicated migration is shipped.
export function feedbackCloudMessage(feedback: FeedbackSubmission) {
  const issue = getFeedbackIssue(feedback.issue);
  const context = normalizeFeedbackContext(feedback.context);
  if (!issue && !context) return feedback.message.slice(0, 800);
  const header = ["DeepSpec report v1", issue ? `Issue: ${issue.id}` : "", context ? `Scan: ${context.scanId}\nPrediction: ${context.predictedPart}` : ""].filter(Boolean).join("\n");
  return `${header}\n\n${feedback.message}`.slice(0, 800);
}
