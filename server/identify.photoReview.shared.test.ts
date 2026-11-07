import { createIdentifyResponse } from "./identify.shared";
import { IDENTIFY_PIPELINE_VERSION, IDENTIFY_PROMPT_VERSION } from "../src/services/systemPrompts";
import type { PhotoReview } from "../src/types";

const photos = ["bay", "connector", "label", "rear"].map((id) => ({ id, label: "other", imageBase64: "data:image/png;base64,aGVsbG8=" }));
const review: PhotoReview = {
  version: 1,
  photos: [
    { photoId: "bay", status: "observations_returned", summary: "A vented housing is visible." },
    { photoId: "connector", status: "limited_view", summary: "The partly obscured connector appears different." },
    { photoId: "rear", status: "not_assessed", summary: "This view was not assessed." },
  ],
  disagreements: [{ id: "connector-difference", photoIds: ["bay", "connector"], description: "The visible connector outlines differ; the views may show independent parts.",
    nextEvidence: { request: "Photograph both connector faces clearly.", purpose: "Check whether the apparent difference persists without the obstruction." } }],
};
const strictResult = {
  partName: "Alternator", confidence: "medium", scanCategory: "electrical", whatItDoes: "Charges the battery.",
  visibleObservations: ["A vented housing is visible."], evidence: ["The housing has ventilation slots."], evidenceRegions: [],
  candidateMatches: [], concerns: [], safetyTriage: "can_help", isSafetyCritical: false,
  nextAction: "Read the part marking before applying vehicle-specific advice.", needsBetterPhoto: false, sourceLinks: [],
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
function providerResponse(provider: string, output: unknown) {
  const text = JSON.stringify(output);
  return provider === "gemini" ? json({ candidates: [{ finishReason: "STOP", content: { parts: [{ text }] } }] })
    : provider === "ollama" ? json({ message: { content: text } })
      : json({ choices: [{ message: { content: text } }] });
}
function environment(provider: string): Record<string, string> {
  if (provider === "gemini") return { GEMINI_API_KEY: "test-key" };
  if (provider === "huggingface") return { DEEPSPEC_ENABLE_HF_IDENTIFY_FALLBACK: "true", HF_TOKEN: "test-token" };
  if (provider === "groq") return { DEEPSPEC_ENABLE_GROQ_IDENTIFY_FALLBACK: "true", GROQ_API_KEY: "test-key", GROQ_IDENTIFY_MODEL: "meta-models/muse-spark-open" };
  return { DEEPSPEC_ENABLE_OLLAMA_IDENTIFY_FALLBACK: "true" };
}

describe("identify photo review transport and normalization", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  it.each(["gemini", "huggingface", "groq", "ollama"].flatMap((provider) => [false, true].map((minimal) => ({ provider, minimal }))))("preserves partial photo coverage from $provider (minimal=$minimal)", async ({ provider, minimal }) => {
    const output = { ...(minimal ? { partName: "Alternator", confidence: "medium", scanCategory: "electrical" } : strictResult), photoReview: review };
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => providerResponse(provider, output));
    const response = await createIdentifyResponse({ photos, photoRelationship: "independent" }, environment(provider));
    expect(response).toMatchObject({ status: 200, body: { result: { partName: "Alternator", photoReview: review }, modelRun: { promptVersion: IDENTIFY_PROMPT_VERSION, pipelineVersion: IDENTIFY_PIPELINE_VERSION } } });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(fetchSpy.mock.calls[0][1]?.body));
    const sent = JSON.stringify(body);
    expect(sent).toContain("photoReview");
    expect(sent).toContain("not_assessed");
    expect(sent).toContain("An omitted photo or block means review was not reported");
    expect(sent).toContain("Independent examples");
    if (provider === "gemini") expect(body.generationConfig.maxOutputTokens).toBe(2048);
    else if (provider === "ollama") expect(body.options.num_predict).toBe(900);
    else expect(body.max_tokens).toBe(2048);
    if ("result" in response.body) expect(response.body.result.photoReview?.photos.some((row) => row.photoId === "label")).toBe(false);
  });

  it.each([
    undefined,
    { ...review, photos: [{ ...review.photos[0], photoId: "not-submitted" }] },
    { ...review, disagreements: [{ ...review.disagreements[0], photoIds: ["bay", "rear"] }] },
    { version: 1, photos: "validation error: must be one of", disagreements: [] },
  ])("omits unavailable or invalid optional review without losing identification or invoking rescue: %j", async (photoReview) => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => providerResponse("gemini", { ...strictResult, ...(photoReview === undefined ? {} : { photoReview }) }));
    const response = await createIdentifyResponse({ photos }, environment("gemini"));
    expect(response).toMatchObject({ status: 200, body: { result: { partName: "Alternator", nextAction: strictResult.nextAction } } });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    if ("result" in response.body) expect(response.body.result).not.toHaveProperty("photoReview");
  });

  it.each([false, true])("preserves compact rescue review when returned without inventing it when omitted (returned=%s)", async (returned) => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(json({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: "not JSON" }] } }] }))
      .mockImplementationOnce(async () => providerResponse("gemini", { ...strictResult, ...(returned ? { photoReview: review } : {}) }));
    const response = await createIdentifyResponse({ photos, photoRelationship: "unknown" }, environment("gemini"));
    expect(response).toMatchObject({ status: 200, body: { modelRun: { fallbackReason: "compact_rescue" } } });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const rescue = JSON.parse(String(fetchSpy.mock.calls[1][1]?.body));
    expect(rescue.generationConfig.maxOutputTokens).toBe(700);
    expect(JSON.stringify(rescue)).toContain("Keep this review concise within the existing output budget");
    if ("result" in response.body) {
      if (returned) expect(response.body.result.photoReview).toEqual(review);
      else expect(response.body.result).not.toHaveProperty("photoReview");
    }
  });

  it("keeps photo-linked disagreements when an existing fallback route succeeds", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(json({ error: { message: "quota exhausted" } }, 429))
      .mockImplementationOnce(async () => providerResponse("huggingface", { ...strictResult, photoReview: review }));
    const response = await createIdentifyResponse({ photos, photoRelationship: "same_part_or_area" }, { ...environment("gemini"), ...environment("huggingface") });
    expect(response).toMatchObject({ status: 200, body: { result: { photoReview: review }, modelRun: { provider: "huggingface" } } });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    for (const call of fetchSpy.mock.calls) expect(String(call[1]?.body)).toContain("photoReview");
  });

  it.each([false, true])("checks legacy dual input review against actual photo-1/photo-2 IDs (foreign=%s)", async (foreign) => {
    const photoReview = { version: 1, photos: [{ photoId: foreign ? "bay" : "photo-2", status: "limited_view", summary: "The second view is obscured." }], disagreements: [] };
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => providerResponse("gemini", { ...strictResult, photoReview }));
    const response = await createIdentifyResponse({ imageBase64: photos[0].imageBase64, imageBase64_2: photos[1].imageBase64 }, environment("gemini"));
    expect(response.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    if ("result" in response.body) {
      if (foreign) expect(response.body.result).not.toHaveProperty("photoReview");
      else expect(response.body.result.photoReview).toEqual(photoReview);
    }
  });
});
