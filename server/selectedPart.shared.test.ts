import { afterEach, describe, expect, it, vi } from "vitest";
import { createIdentifyResponse } from "./identify.shared";
import { createChatResponse } from "./chat.shared";

const imageBase64 = "data:image/png;base64,aGVsbG8=";
const photos = ["original", "another-original", "selected-crop"].map((id) => ({ id, label: "other", imageBase64 }));
const selectedPart = { photoId: "original", rectangle: { x: 0.15, y: 0.2, width: 0.4, height: 0.5 }, cropPhotoId: "selected-crop" };
const identification = {
  partName: "Alternator", confidence: "medium", scanCategory: "electrical", candidateMatches: [],
  whatItDoes: "Charges the battery.", visibleObservations: ["A vented housing and pulley are visible."],
  evidenceRegions: [], concerns: [], safetyTriage: "can_help", isSafetyCritical: false,
  nextAction: "Photograph the alternator label straight on.", needsBetterPhoto: true,
  evidence: ["Vented housing and pulley."], sourceLinks: [],
};
const providerAnswer = () => new Response(JSON.stringify({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(identification) }] } }] }), { status: 200, headers: { "Content-Type": "application/json" } });

afterEach(() => vi.restoreAllMocks());

describe("selected-part provider transport", () => {
  it("retains the original selected region and derived crop on Gemini identify and fallback", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("{}", { status: 503 }))
      .mockImplementation(async () => providerAnswer());
    const response = await createIdentifyResponse({ photos, selectedPart, photoRelationship: "independent" }, {
      GEMINI_API_KEY: "test-key", GEMINI_MODEL: "gemini-primary", GEMINI_FALLBACK_MODELS: "gemini-backup",
    });
    expect(response.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    for (const [, options] of fetchSpy.mock.calls) {
      const sent = String(options?.body);
      expect(sent).toContain("Selected part reference:");
      expect(sent).toContain(JSON.stringify(selectedPart).replaceAll('"', '\\"'));
      expect(sent).toContain("not a new camera angle");
      expect(sent).toContain("Keep markings on the object that visibly bears them");
      expect(sent).toContain("For example, when selecting an alternator beside a hose");
      expect(sent).not.toContain("not the selected alternator");
      expect(sent).toContain("Consider every other original photo separately");
      expect(sent).toContain("sole exception to instructions separating independent or unknown photos");
      expect(sent).toContain("one straight-on close-up of that part's label");
      expect(sent.indexOf('\\"id\\":\\"original\\"')).toBeLessThan(sent.indexOf('\\"id\\":\\"another-original\\"'));
    }
  });

  it.each([false, true])("keeps the selected reference outside bounded chat history (research=%s)", async (research) => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("{}", { status: 503 }))
      .mockImplementation(async () => new Response(JSON.stringify({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: "The alternator number is unreadable." }] } }] }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const response = await createChatResponse({ userMessage: "Q".repeat(3000), photos, selectedPart, research }, {
      GEMINI_API_KEY: "test-key", GEMINI_CHAT_MODEL: "gemini-primary", GEMINI_CHAT_FALLBACK_MODELS: "gemini-backup",
    });
    expect(response.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    for (const [, options] of fetchSpy.mock.calls) {
      const sent = JSON.parse(String(options?.body));
      const prompt = sent.contents[0].parts[0].text;
      expect(prompt).toContain("Q".repeat(3000));
      expect(prompt).toContain(`Selected part reference: ${JSON.stringify(selectedPart)}`);
      expect(prompt).toContain("Identify and answer about the selected region");
      expect(prompt).toContain("hose's markings belong to the hose");
      expect(sent.system_instruction.parts[0].text).toContain("transcribe a clearly readable marking");
    }
  });

  it("abstains from an exact selected-part identifier when the answer provides no label or catalog evidence", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      candidates: [{ finishReason: "STOP", content: { parts: [{ text: "The part number is HOSE-123." }] } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));

    const response = await createChatResponse({
      userMessage: "Can you tell me the selected alternator's exact part number?",
      photos,
      selectedPart,
    }, { GEMINI_API_KEY: "test-key" });

    expect(response.status).toBe(200);
    if (response.status !== 200) return;
    expect(response.body.message).not.toContain("HOSE-123");
    expect(response.body.message).toContain("can\u2019t verify an exact part or serial number");
    expect(response.body.message).toContain("straight-on close-up");
  });

  it.each([
    "The clearly readable label on the selected part says DENSO 104210-1230; this is a literal transcription, not verified fitment.",
    "I can\u2019t read the selected part\u2019s number. Please take a straight-on close-up of its label.",
  ])("keeps a selected-part identifier answer with explicit evidence or abstention: %s", async (message) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      candidates: [{ finishReason: "STOP", content: { parts: [{ text: message }] } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));

    const response = await createChatResponse({
      userMessage: "What is the exact part number on the selected component?",
      photos,
      selectedPart,
    }, { GEMINI_API_KEY: "test-key" });

    expect(response.status).toBe(200);
    if (response.status !== 200) return;
    expect(response.body.message).toBe(message);
  });

  it("does not run unlocalized whole-photo OCR for a selected part", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => String(url).includes("api-inference.huggingface.co")
      ? new Response(JSON.stringify([{ generated_text: "HOSE-123" }]), { status: 200 })
      : providerAnswer());
    const response = await createIdentifyResponse({ photos, selectedPart, labelRescueTrigger: "too_blurry" }, {
      GEMINI_API_KEY: "test-key", HF_TOKEN: "test-token",
    });
    expect(response.status).toBe(200);
    expect(fetchSpy.mock.calls.some(([url]) => String(url).includes("api-inference.huggingface.co"))).toBe(false);
    expect(JSON.stringify(response.body)).not.toContain("HOSE-123");
  });

  it.each([
    null,
    { ...selectedPart, photoId: "another-original" },
    { ...selectedPart, photoId: "missing" },
    { ...selectedPart, cropPhotoId: "original" },
    { ...selectedPart, cropPhotoId: "missing" },
    { ...selectedPart, rectangle: { ...selectedPart.rectangle, width: 0 } },
    { ...selectedPart, rectangle: { ...selectedPart.rectangle, x: -0.1 } },
    { ...selectedPart, rectangle: { ...selectedPart.rectangle, x: 0.9 } },
    { ...selectedPart, rectangle: { ...selectedPart.rectangle, height: Infinity } },
    { ...selectedPart, rectangle: { ...selectedPart.rectangle, y: "0.2" } },
  ])("rejects an invalid explicit reference before either provider is called: %j", async (invalid) => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => providerAnswer());
    const body = { userMessage: "What part is this?", photos, selectedPart: invalid };
    expect((await createIdentifyResponse(body, { GEMINI_API_KEY: "test-key" })).status).toBe(400);
    expect((await createChatResponse(body, { GEMINI_API_KEY: "test-key" })).status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
