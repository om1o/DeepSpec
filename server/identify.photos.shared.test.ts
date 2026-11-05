import { createIdentifyResponse, validateIdentifyRequest } from "./identify.shared";

const photos = ["overview", "close_up", "marking", "mounting"].map((label, index) => ({
  id: `photo-${index + 1}`,
  label,
  imageBase64: `data:image/jpeg;base64,${Buffer.from(`photo-${index + 1}`).toString("base64")}`,
}));
const result = {
  partName: "Alternator",
  confidence: "medium",
  scanCategory: "electrical",
  whatItDoes: "Charges the battery.",
  visibleObservations: ["[photo-1] Vented housing is visible."],
  evidence: ["[photo-2] A belt pulley is visible."],
  evidenceRegions: [],
  candidateMatches: [],
  concerns: [],
  safetyTriage: "can_help",
  isSafetyCritical: false,
  nextAction: "Photograph the rear electrical connector to distinguish the candidates.",
  needsBetterPhoto: false,
  sourceLinks: [],
};
const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json" },
});
const geminiResponse = () => jsonResponse({ candidates: [{ content: { parts: [{ text: JSON.stringify(result) }] } }] });

describe("labeled identify photos", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, "info").mockImplementation(() => undefined);
  });

  it.each([
    ["non-array", {}],
    ["empty array", []],
    ["more than four", [...photos, { ...photos[0], id: "photo-5" }]],
    ["null entry", [null]],
    ["missing id", [{ label: "overview", imageBase64: photos[0].imageBase64 }]],
    ["blank id", [{ ...photos[0], id: "  " }]],
    ["overlong id", [{ ...photos[0], id: "a".repeat(81) }]],
    ["duplicate ids", [photos[0], { ...photos[1], id: photos[0].id }]],
    ["unknown label", [{ ...photos[0], label: "zoom" }]],
    ["missing image", [{ id: "one", label: "overview" }]],
    ["invalid image", [{ ...photos[0], imageBase64: "not-an-image" }]],
    ["malformed base64", [{ ...photos[0], imageBase64: "data:image/jpeg;base64,=" }]],
  ])("rejects %s before any provider call", async (_name, invalidPhotos) => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await expect(createIdentifyResponse({ photos: invalidPhotos }, { GEMINI_API_KEY: "test-key" })).resolves.toMatchObject({
      status: 400,
      body: { error: { code: "invalid_input" } },
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects mixed second-image input and mismatched compatibility covers", () => {
    for (const body of [
      { photos, imageBase64_2: photos[1].imageBase64 },
      { photos, imageBase64: photos[1].imageBase64 },
      { photos, imageBase64: null },
    ]) {
      expect(validateIdentifyRequest(body)).toMatchObject({ status: 400, body: { error: { code: "invalid_input" } } });
    }
  });

  it("accepts one to four photos, all labels, and an 80-character id", () => {
    expect(validateIdentifyRequest({ photos: [{ ...photos[0], id: "a".repeat(80), label: "other" }] })).toBeNull();
    expect(validateIdentifyRequest({ photos })).toBeNull();
    expect(validateIdentifyRequest({ photos, imageBase64: photos[0].imageBase64 })).toBeNull();
  });

  it("enforces the aggregate image budget including a transmitted compatibility cover", () => {
    const largeImage = `data:image/jpeg;base64,${"A".repeat(2_000_000)}`;
    const oneLargePhoto = [{ ...photos[0], imageBase64: largeImage }];
    expect(validateIdentifyRequest({ photos: oneLargePhoto })).toBeNull();
    for (const body of [
      { photos: [...oneLargePhoto, { ...photos[1], imageBase64: largeImage }] },
      { photos: oneLargePhoto, imageBase64: largeImage },
    ]) {
      expect(validateIdentifyRequest(body)).toMatchObject({ status: 400, body: { error: { code: "image_too_large" } } });
    }
  });

  it.each([false, true])("sends four labeled images to Gemini without duplicating the compatibility cover (%s)", async (includeCover) => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => geminiResponse());
    const response = await createIdentifyResponse({ photos, ...(includeCover ? { imageBase64: photos[0].imageBase64 } : {}) }, { GEMINI_API_KEY: "test-key" });
    expect(response.status).toBe(200);
    const body = JSON.parse(String(fetchSpy.mock.calls[0][1]?.body));
    expect(body.contents[0].parts.filter((part: Record<string, unknown>) => part.inline_data)).toHaveLength(4);
    photos.forEach((photo) => {
      expect(JSON.stringify(body)).toContain(photo.id);
      expect(JSON.stringify(body)).toContain(photo.label);
    });
    expect(JSON.stringify(body)).toContain("contradict");
    expect(JSON.stringify(body)).toContain("depth");
    expect(JSON.stringify(body)).toContain("possible causes");
    expect(JSON.stringify(body)).toContain("rocker");
  });

  it("keeps all photos and labels in Gemini rescue after invalid model responses", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockImplementationOnce(async () => jsonResponse({ candidates: [{ content: { parts: [{ text: "not JSON" }] } }] }))
      .mockImplementationOnce(async () => geminiResponse());
    const response = await createIdentifyResponse({ photos }, {
      GEMINI_API_KEY: "test-key",
    });
    expect(response.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    for (const call of fetchSpy.mock.calls) {
      const body = JSON.parse(String(call[1]?.body));
      expect(body.contents[0].parts.filter((part: Record<string, unknown>) => part.inline_data)).toHaveLength(4);
      expect(JSON.stringify(body)).toContain("photo-4");
    }
  });

  it.each(["huggingface", "groq", "ollama"])("sends all images and labels to %s", async (provider) => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => provider === "ollama"
      ? jsonResponse({ message: { content: JSON.stringify(result) } })
      : jsonResponse({ choices: [{ message: { content: JSON.stringify(result) } }] }));
    const env = provider === "huggingface"
      ? { DEEPSPEC_ENABLE_HF_IDENTIFY_FALLBACK: "true", HF_TOKEN: "test-token" }
      : provider === "groq"
        ? { DEEPSPEC_ENABLE_GROQ_IDENTIFY_FALLBACK: "true", GROQ_API_KEY: "test-key", GROQ_IDENTIFY_MODEL: "meta-models/muse-spark-open" }
        : { DEEPSPEC_ENABLE_OLLAMA_IDENTIFY_FALLBACK: "true" };
    const response = await createIdentifyResponse({ photos }, env);
    expect(response.status).toBe(200);
    const body = JSON.parse(String(fetchSpy.mock.calls[0][1]?.body));
    const images = provider === "ollama" ? body.messages[0].images
      : body.messages[1].content.filter((part: Record<string, unknown>) => part.type === "image_url");
    expect(images).toHaveLength(4);
    photos.forEach((photo) => expect(JSON.stringify(body)).toContain(photo.id));
  });

  it("fails explicitly when only the default three-image Groq model is configured", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await expect(createIdentifyResponse({ photos }, {
      DEEPSPEC_ENABLE_GROQ_IDENTIFY_FALLBACK: "true", GROQ_API_KEY: "test-key",
    })).resolves.toMatchObject({ status: 422, body: { error: { code: "unsupported_photo_count" } } });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("passes three photos to the default Groq model", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => jsonResponse({ choices: [{ message: { content: JSON.stringify(result) } }] }));
    await expect(createIdentifyResponse({ photos: photos.slice(0, 3) }, {
      DEEPSPEC_ENABLE_GROQ_IDENTIFY_FALLBACK: "true", GROQ_API_KEY: "test-key",
    })).resolves.toMatchObject({ status: 200 });
    const body = JSON.parse(String(fetchSpy.mock.calls[0][1]?.body));
    expect(body.messages[1].content.filter((part: Record<string, unknown>) => part.type === "image_url")).toHaveLength(3);
  });

  it("falls back from the three-image Groq model with the full four-photo group", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => geminiResponse());
    await expect(createIdentifyResponse({ photos }, {
      GEMINI_API_KEY: "test-key", DEEPSPEC_ENABLE_GROQ_IDENTIFY_FALLBACK: "true", GROQ_API_KEY: "test-key",
    })).resolves.toMatchObject({ status: 200, body: { modelRun: { provider: "gemini", fallbackReason: "unsupported_photo_count" } } });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0][0])).toContain("generativelanguage.googleapis.com");
    const body = JSON.parse(String(fetchSpy.mock.calls[0][1]?.body));
    expect(body.contents[0].parts.filter((part: Record<string, unknown>) => part.inline_data)).toHaveLength(4);
  });

  it("retains the complete group when Gemini fails over to Hugging Face", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockImplementationOnce(async () => jsonResponse({ error: { message: "quota exhausted" } }, 429))
      .mockImplementationOnce(async () => jsonResponse({ choices: [{ message: { content: JSON.stringify(result) } }] }));
    const response = await createIdentifyResponse({ photos }, {
      GEMINI_API_KEY: "test-key", DEEPSPEC_ENABLE_HF_IDENTIFY_FALLBACK: "true", HF_TOKEN: "test-token",
    });
    expect(response.status).toBe(200);
    const body = JSON.parse(String(fetchSpy.mock.calls.at(-1)?.[1]?.body));
    expect(body.messages[1].content.filter((part: Record<string, unknown>) => part.type === "image_url")).toHaveLength(4);
  });

  it("returns an explicit error when the configured provider rejects multiple images", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => jsonResponse({ error: { message: "This model supports only one image" } }, 400));
    const response = await createIdentifyResponse({ photos }, {
      DEEPSPEC_ENABLE_HF_IDENTIFY_FALLBACK: "true", HF_TOKEN: "test-token",
    });
    expect(response).toMatchObject({ status: 400, body: { error: { code: "provider_error", message: "This model supports only one image" } } });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(fetchSpy.mock.calls[0][1]?.body));
    expect(body.messages[1].content.filter((part: Record<string, unknown>) => part.type === "image_url")).toHaveLength(4);
  });
});
