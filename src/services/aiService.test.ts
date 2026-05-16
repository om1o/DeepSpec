import { AIServiceError, identifyCapturedFrame, runAI } from "./aiService";

const result = {
  partName: "Alternator",
  confidence: "high",
  whatItDoes: "It charges the battery while the engine runs.",
  visibleObservations: ["Belt-driven metal housing is visible."],
  concerns: [],
  safetyTriage: "can_help",
  isSafetyCritical: false,
  nextAction: "Take another photo of the label if you need more detail.",
  needsBetterPhoto: false,
  evidence: ["The pulley and vented housing match common alternator shapes."],
};

describe("aiService", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("routes vision calls through the identify API", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ result }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(
      identifyCapturedFrame({
        imageBase64: "data:image/jpeg;base64,test",
        capturedAt: "2026-05-16T00:00:00.000Z",
      }),
    ).resolves.toEqual(result);

    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/identify",
      expect.objectContaining({
        method: "POST",
      }),
    );
  });

  it("throws a clean service error when the API rejects the request", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: "rate_limited",
            message: "Too many AI lookups right now. Try again in a few minutes.",
          },
        }),
        {
          status: 429,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    await expect(
      identifyCapturedFrame({
        imageBase64: "data:image/jpeg;base64,test",
        capturedAt: "2026-05-16T00:00:00.000Z",
      }),
    ).rejects.toMatchObject({
      code: "rate_limited",
      message: "Too many AI lookups right now. Try again in a few minutes.",
    });
  });

  it("rejects non-vision calls until chat phase", async () => {
    await expect(
      runAI({
        type: "text",
        userMessage: "What is this?",
        systemPrompt: "test",
      }),
    ).rejects.toBeInstanceOf(AIServiceError);
  });
});
