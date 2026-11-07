import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PhotoReviewPanel } from "../components/result/PhotoReviewPanel";
import { independentPhotoReviewFixture } from "../test/independentPhotoReviewFixture";
import { buildPhotoReviewState } from "./photoReview";
import { buildConditionHandoff, formatConditionHandoff } from "./conditionHandoff";
import { buildInspectionReportHtml } from "./inspectionReportHtml";
import { getLookup, saveExistingLookup } from "../services/storage";
import { sendFollowUpDetails } from "../services/aiService";
import { createChatResponse } from "../../server/chat.shared";

vi.mock("../services/auth", () => ({ getAuthClient: async () => null }));
beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

it.each(["independent", "same_part_or_area", "unknown"] as const)("uses the declared %s relationship without altering the saved review", (relationship) => {
  const scan = independentPhotoReviewFixture(relationship), raw = JSON.stringify(scan);
  const state = buildPhotoReviewState(scan.result!.photoReview, scan.photos!.map((photo) => ({ id: photo.id, label: photo.id })), true, relationship);
  expect(state.review?.disagreements).toHaveLength(relationship === "independent" ? 0 : 1);
  expect(state.rows.map((row) => row.summary)).toEqual(scan.result!.photoReview!.photos.map((photo) => photo.summary));
  if (relationship === "independent") {
    expect(state.disagreementMessage).toContain("do not apply to independent examples");
    expect(state.disagreementMessage).not.toContain("No disagreements were reported");
  } else expect(state.disagreementMessage).toContain("need confirmation");
  expect(JSON.stringify(scan)).toBe(raw);
});

it("keeps every original selectable while omitting the invalid independent-example comparison", async () => {
  const scan = independentPhotoReviewFixture(), select = vi.fn();
  render(<PhotoReviewPanel scan={scan} onSelectPhoto={select} />);
  const panel = screen.getByRole("region", { name: "Photo review" });
  expect(panel).toHaveTextContent("do not apply to independent examples");
  expect(panel).not.toHaveTextContent(scan.result!.photoReview!.disagreements[0].description);
  expect(panel).toHaveTextContent(scan.result!.photoReview!.photos[1].summary);
  await userEvent.click(within(panel).getByRole("button", { name: "View saved Photo 2 — Other angle" }));
  expect(select).toHaveBeenCalledWith("rotor");
  expect(within(panel).queryByRole("button", { name: /for disagreement/ })).not.toBeInTheDocument();
});

it("preserves the raw saved response on reopen while text and HTML reports omit inapplicable comparisons", () => {
  const scan = independentPhotoReviewFixture();
  expect(saveExistingLookup(scan).ok).toBe(true);
  const reopened = getLookup(scan.id)!;
  expect(reopened.result!.photoReview).toEqual(scan.result!.photoReview);
  expect(reopened.photos).toEqual(scan.photos);
  const before = JSON.stringify(reopened);
  expect(buildConditionHandoff(reopened).photoReview?.disagreements).toHaveLength(0);
  const text = formatConditionHandoff(reopened);
  const html = buildInspectionReportHtml({ version: 1, createdAt: scan.createdAt, rootLookupId: scan.id, map: null, scans: [reopened], missing: [], embeddedBytes: 200 });
  const doc = new DOMParser().parseFromString(html, "text/html");
  for (const output of [text, doc.body.textContent!]) {
    expect(output).toContain("do not apply to independent examples");
    expect(output).toContain(scan.result!.photoReview!.photos[1].summary);
    expect(output).not.toContain(scan.result!.photoReview!.disagreements[0].description);
    expect(output).not.toContain(scan.result!.photoReview!.disagreements[0].nextEvidence.request);
  }
  expect(doc.querySelectorAll(".photo-review-disagreements > li")).toHaveLength(0);
  expect(doc.querySelector("#review-overview")?.textContent).not.toContain("reported disagreement(s)");
  expect(doc.querySelectorAll(".saved-photo")).toHaveLength(2);
  // The report embeds identical fixture bytes once, with a link for the other photo.
  expect(doc.querySelector(".saved-photo img")?.getAttribute("src")).toBe(scan.photos![0].imageBase64);
  expect(doc.querySelector("#scan-1-photo-2 a[href='#scan-1-photo-1']")).not.toBeNull();
  expect(JSON.stringify(reopened)).toBe(before);
  expect(getLookup(scan.id)!.result!.photoReview).toEqual(scan.result!.photoReview);
});

it.each([false, true])("does not pass independent-example comparisons to follow-up chat (research=%s)", async (research) => {
  const scan = independentPhotoReviewFixture(), original = JSON.stringify(scan);
  const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ message: "Review each image separately." })));
  await sendFollowUpDetails(scan, "What does each photo show?", { research });
  const sent = JSON.parse(String(fetch.mock.calls[0][1]?.body));
  expect(sent.photoRelationship).toBe("independent");
  expect(sent.photoReview).toEqual({ ...scan.result!.photoReview, disagreements: [] });
  expect(JSON.stringify(sent)).not.toContain(scan.result!.photoReview!.disagreements[0].description);
  expect(sent.photos).toHaveLength(2);
  expect(JSON.stringify(scan)).toBe(original);
});

it.each([false, true])("filters old-client independent comparisons at the server too (research=%s)", async (research) => {
  const scan = independentPhotoReviewFixture(), raw = JSON.stringify(scan.result!.photoReview);
  const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: "Review each image separately." }] } }] }), { headers: { "Content-Type": "application/json" } }));
  const response = await createChatResponse({ userMessage: "What does each photo show?", photos: scan.photos,
    photoRelationship: "independent", photoReview: scan.result!.photoReview, research }, { GEMINI_API_KEY: "test-key" });
  expect(response.status).toBe(200);
  const prompt = JSON.parse(String(fetch.mock.calls[0][1]?.body)).contents[0].parts[0].text;
  expect(JSON.parse(prompt.split("Saved photoReview data: ")[1])).toEqual({ ...scan.result!.photoReview, disagreements: [] });
  expect(prompt).not.toContain(scan.result!.photoReview!.disagreements[0].description);
  expect(prompt).toContain("do not apply to independent examples");
  expect(JSON.stringify(scan.result!.photoReview)).toBe(raw);
});

it("does not use independent status to hide malformed references or fabricate missing coverage", () => {
  const scan = independentPhotoReviewFixture();
  scan.result!.photoReview!.disagreements[0].photoIds[1] = "another-scan";
  const photos = scan.photos!.map((photo) => ({ id: photo.id, label: photo.id }));
  const invalid = buildPhotoReviewState(scan.result!.photoReview, photos, true, "independent");
  expect(invalid.invalid).toBe(true);
  expect(invalid.rows.every((row) => row.status === "not_reported")).toBe(true);
  const missing = buildPhotoReviewState(undefined, photos, true, "independent");
  expect(missing.message).toContain("not reported");
  expect(missing.rows.every((row) => row.status === "not_reported")).toBe(true);
});
