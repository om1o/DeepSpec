// Correlation IDs, not authentication tokens. Keep upload/retry usable on local HTTP previews.
export function createAnalysisAttemptId() {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `request-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
