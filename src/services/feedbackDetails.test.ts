import { feedbackCloudMessage, normalizeFeedbackContext } from "./feedbackDetails";
import { getEngagementData, saveFeedbackSubmission } from "./engagement";

describe("structured feedback", () => {
  beforeEach(() => localStorage.clear());

  it("saves a quick wrong-result report without requiring an explanation", () => {
    const saved = saveFeedbackSubmission({ category: "scanner", issue: "wrong_part", message: "", contactEmail: "" });
    expect(saved.ok).toBe(true);
    expect(getEngagementData().feedback[0]).toMatchObject({ category: "ai_result", issue: "wrong_part", message: "Wrong part" });
    expect(getEngagementData().feedback[0].context).toBeUndefined();
  });

  it("preserves only the approved context fields on reload and cloud serialization", () => {
    const context = normalizeFeedbackContext({ scanId: "scan-1", predictedPart: "Alternator", imageBase64: "private-image", chat: "private-chat", userId: "secret" });
    saveFeedbackSubmission({ category: "other", issue: "ar_jitter", message: "Shakes when I move", contactEmail: "", context });
    const report = getEngagementData().feedback[0];
    expect(report.category).toBe("scanner");
    expect(report.context).toEqual({ scanId: "scan-1", predictedPart: "Alternator" });
    expect(feedbackCloudMessage(report)).toBe("DeepSpec report v1\nIssue: ar_jitter\nScan: scan-1\nPrediction: Alternator\n\nShakes when I move");
  });

  it("keeps bounded context and details within the existing 800 character envelope", () => {
    const saved = saveFeedbackSubmission({ category: "other", issue: "wrong_condition", message: "a".repeat(450), contactEmail: "", context: { scanId: "s".repeat(200), predictedPart: "p".repeat(300) } });
    expect(saved.ok).toBe(true);
    const payload = feedbackCloudMessage(getEngagementData().feedback[0]);
    expect(payload.length).toBeLessThanOrEqual(800);
    expect(payload.endsWith("a".repeat(450))).toBe(true);
    expect(saveFeedbackSubmission({ category: "other", issue: "bug", message: "a".repeat(451), contactEmail: "" }).ok).toBe(false);
  });

  it("retains legacy feedback without adding a context envelope", () => {
    saveFeedbackSubmission({ category: "chat", message: "The answer was useful", contactEmail: "" });
    expect(feedbackCloudMessage(getEngagementData().feedback[0])).toBe("The answer was useful");
    expect(saveFeedbackSubmission({ category: "other", message: "", contactEmail: "" }).ok).toBe(false);
  });
});
