import { createIdentifyResponse } from "./identify.shared";

const imageBase64 =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";

const result = {
  partName: "Alternator",
  confidence: "high",
  scanCategory: "electrical",
  whatItDoes: "It charges the battery while the engine runs.",
  visibleObservations: ["Belt-driven metal housing is visible."],
  concerns: [],
  safetyTriage: "can_help",
  isSafetyCritical: false,
  nextAction: "Take another photo of the label if you need more detail.",
  needsBetterPhoto: false,
  evidence: ["The pulley and vented housing match common alternator shapes."],
};

describe("createIdentifyResponse", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("requires a server-side Gemini key", async () => {
    await expect(createIdentifyResponse({ imageBase64 }, {})).resolves.toMatchObject({
      status: 500,
      body: {
        error: {
          code: "not_configured",
        },
      },
    });
  });

  it("rejects invalid image payloads", async () => {
    await expect(
      createIdentifyResponse(
        {
          imageBase64: "not-an-image",
        },
        { GEMINI_API_KEY: "test-key" },
      ),
    ).resolves.toMatchObject({
      status: 400,
      body: {
        error: {
          code: "invalid_input",
        },
      },
    });
  });

  it("returns validated Gemini JSON", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify(result),
                  },
                ],
              },
            },
          ],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    await expect(createIdentifyResponse({ imageBase64 }, { GEMINI_API_KEY: "test-key" })).resolves.toEqual({
      status: 200,
      body: {
        result,
      },
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining("/models/gemini-2.5-flash:generateContent"),
      expect.objectContaining({
        method: "POST",
      }),
    );
  });

  it("normalizes inconsistent safety-critical model output", async () => {
    const riskyResult = {
      ...result,
      partName: "Fuel line",
      scanCategory: "fuel",
      safetyTriage: "can_help",
      isSafetyCritical: true,
      nextAction: "Do not touch the damaged line.",
    };

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify(riskyResult),
                  },
                ],
              },
            },
          ],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    await expect(createIdentifyResponse({ imageBase64 }, { GEMINI_API_KEY: "test-key" })).resolves.toMatchObject({
      status: 200,
      body: {
        result: {
          safetyTriage: "needs_professional",
          isSafetyCritical: true,
          nextAction: expect.stringContaining("mechanic"),
        },
      },
    });
  });

  it("returns a network error when fetch fails", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network error"));

    await expect(createIdentifyResponse({ imageBase64 }, { GEMINI_API_KEY: "test-key" })).resolves.toMatchObject({
      status: 502,
      body: { error: { code: "network" } },
    });
  });

  it("returns a network error when fetch times out", async () => {
    const abort = new DOMException("The operation was aborted.", "AbortError");
    vi.spyOn(globalThis, "fetch").mockRejectedValue(abort);

    await expect(createIdentifyResponse({ imageBase64 }, { GEMINI_API_KEY: "test-key" })).resolves.toMatchObject({
      status: 502,
      body: { error: { code: "network" } },
    });
  });

  it("returns an invalid_response error when Gemini returns an empty candidates array", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ candidates: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(createIdentifyResponse({ imageBase64 }, { GEMINI_API_KEY: "test-key" })).resolves.toMatchObject({
      status: 502,
      body: { error: { code: "invalid_response" } },
    });
  });

  it("returns a provider_error and preserves HTTP status when Gemini responds with non-JSON", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("<html>Service Unavailable</html>", {
        status: 503,
        headers: { "Content-Type": "text/html" },
      }),
    );

    await expect(createIdentifyResponse({ imageBase64 }, { GEMINI_API_KEY: "test-key" })).resolves.toMatchObject({
      status: 503,
      body: { error: { code: "provider_error" } },
    });
  });

  it("rejects images over 10 MB before calling Gemini", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const bigImage = `data:image/jpeg;base64,${"A".repeat(14_000_001)}`;

    await expect(createIdentifyResponse({ imageBase64: bigImage }, { GEMINI_API_KEY: "test-key" })).resolves.toMatchObject({
      status: 400,
      body: { error: { code: "image_too_large" } },
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("includes a second inline_data part when imageBase64_2 is provided", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: JSON.stringify(result) }] } }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    await createIdentifyResponse(
      { imageBase64, imageBase64_2: imageBase64 },
      { GEMINI_API_KEY: "test-key" },
    );

    const callBody = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    const parts = callBody.contents[0].parts;
    const imageParts = parts.filter((p: { inline_data?: unknown }) => "inline_data" in p);
    expect(imageParts).toHaveLength(2);
  });

  it("proceeds with one image when imageBase64_2 is invalid", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: JSON.stringify(result) }] } }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    await createIdentifyResponse(
      { imageBase64, imageBase64_2: "not-a-valid-data-url" },
      { GEMINI_API_KEY: "test-key" },
    );

    const callBody = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    const parts = callBody.contents[0].parts;
    const imageParts = parts.filter((p: { inline_data?: unknown }) => "inline_data" in p);
    expect(imageParts).toHaveLength(1);
  });

  it("normalizes better-photo model output", async () => {
    const unclearResult = {
      ...result,
      confidence: "low",
      safetyTriage: "needs_better_photo",
      needsBetterPhoto: false,
    };

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify(unclearResult),
                  },
                ],
              },
            },
          ],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    await expect(createIdentifyResponse({ imageBase64 }, { GEMINI_API_KEY: "test-key" })).resolves.toMatchObject({
      status: 200,
      body: {
        result: {
          safetyTriage: "needs_better_photo",
          needsBetterPhoto: true,
        },
      },
    });
  });
});
