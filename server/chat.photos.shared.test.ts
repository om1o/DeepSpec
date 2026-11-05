import { createChatResponse } from "./chat.shared";

const photos = ["overview", "close_up", "marking", "mounting"].map((label, index) => ({
  id: `saved-${index + 1}`,
  label,
  imageBase64: `data:image/png;base64,${Buffer.from(`saved-${index + 1}`).toString("base64")}`,
}));
const userMessage = "Compare the corrosion in these saved views.";
const answer = () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "[saved-2] Surface rust is visible; deeper damage remains unknown." }] } }] }), {
  status: 200, headers: { "Content-Type": "application/json" },
});

describe("labeled chat photos", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  it.each([false, true])("sends all labeled views once, with compatibility cover %s", async (includeCover) => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => answer());
    const response = await createChatResponse({ userMessage, photos, ...(includeCover ? { imageBase64: photos[0].imageBase64 } : {}) }, { GEMINI_API_KEY: "test-key" });
    expect(response.status).toBe(200);
    const body = JSON.parse(String(fetchSpy.mock.calls[0][1]?.body));
    const parts = body.contents[0].parts;
    expect(parts.filter((part: Record<string, unknown>) => part.inlineData)).toHaveLength(4);
    photos.forEach((photo) => {
      expect(JSON.stringify(parts)).toContain(photo.id);
      expect(JSON.stringify(parts)).toContain(photo.label);
    });
    expect(parts[0].text).toContain("contradict");
    expect(parts[0].text).toContain("possible causes");
    expect(parts[0].text).toContain("rocker panel");
    expect(parts[0].text).toContain("depth");
  });

  it.each([
    { photos: [] },
    { photos: [...photos, { ...photos[0], id: "saved-5" }] },
    { photos: [{ ...photos[0], label: "unknown" }] },
    { photos: [{ ...photos[0], id: "x".repeat(81) }] },
    { photos: [photos[0], photos[0]] },
    { photos: [{ ...photos[0], imageBase64: "data:image/png;base64,abc" }] },
    { photos, imageBase64_2: photos[0].imageBase64 },
    { photos, imageBase64: photos[1].imageBase64 },
  ])("rejects invalid labeled input before fetching", async (input) => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await expect(createChatResponse({ userMessage, ...input }, { GEMINI_API_KEY: "test-key" })).resolves.toMatchObject({
      status: 400, body: { error: { code: "invalid_input" } },
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("enforces the combined image payload budget for saved views", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await expect(createChatResponse({
      userMessage, photos: photos.map((photo) => ({ ...photo, imageBase64: `data:image/png;base64,${"A".repeat(1_000_000)}` })),
    }, { GEMINI_API_KEY: "test-key" })).resolves.toMatchObject({ status: 400, body: { error: { code: "image_too_large" } } });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("keeps all images on the fallback model", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockImplementationOnce(async () => new Response(JSON.stringify({ error: { message: "Busy" } }), { status: 503, headers: { "Content-Type": "application/json" } }))
      .mockImplementationOnce(async () => answer());
    await expect(createChatResponse({ userMessage, photos }, {
      GEMINI_API_KEY: "test-key", GEMINI_CHAT_FALLBACK_MODELS: "gemini-2.5-flash-lite",
    })).resolves.toMatchObject({ status: 200 });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    for (const call of fetchSpy.mock.calls) {
      const body = JSON.parse(String(call[1]?.body));
      expect(body.contents[0].parts.filter((part: Record<string, unknown>) => part.inlineData)).toHaveLength(4);
      expect(JSON.stringify(body)).toContain("saved-4");
    }
  });

  it("reports unsupported-image errors without retrying a reduced set", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify({ error: { message: "Multiple images unsupported" } }), {
      status: 400, headers: { "Content-Type": "application/json" },
    }));
    await expect(createChatResponse({ userMessage, photos }, { GEMINI_API_KEY: "test-key" })).resolves.toMatchObject({
      status: 400, body: { error: { code: "provider_error", message: "Multiple images unsupported" } },
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
