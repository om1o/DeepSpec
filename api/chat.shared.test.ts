import { createChatResponse } from "./chat.shared";

describe("createChatResponse", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("requires a server-side Gemini key", async () => {
    await expect(createChatResponse({ userMessage: "What does it do?" }, {})).resolves.toMatchObject({
      status: 500,
      body: {
        error: {
          code: "not_configured",
        },
      },
    });
  });

  it("rejects empty chat messages", async () => {
    await expect(createChatResponse({ userMessage: "   " }, { GEMINI_API_KEY: "test-key" })).resolves.toMatchObject({
      status: 400,
      body: {
        error: {
          code: "invalid_input",
        },
      },
    });
  });

  it("returns a cleaned Gemini chat answer", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: " The alternator charges the battery while the engine runs.  ",
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

    await expect(createChatResponse({ userMessage: "Part name: Alternator\nUser question: What does it do?" }, { GEMINI_API_KEY: "test-key" })).resolves.toMatchObject({
      status: 200,
      body: {
        message: "The alternator charges the battery while the engine runs.",
        modelRun: {
          kind: "chat",
          model: "gemini-2.5-flash",
          ocrUsed: false,
          promptVersion: "followup-v1",
          provider: "gemini",
        },
      },
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining("/models/gemini-2.5-flash:generateContent"),
      expect.objectContaining({
        method: "POST",
      }),
    );
  });

  it("falls back to flash lite when the default Gemini chat model is quota limited", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: "quota exhausted" } }), {
          status: 429,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: "Use a belt-routing diagram before loosening the tensioner." }] } }],
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      );

    await expect(createChatResponse({ userMessage: "How do I inspect this belt?" }, { GEMINI_API_KEY: "test-key" })).resolves.toMatchObject({
      status: 200,
      body: {
        message: "Use a belt-routing diagram before loosening the tensioner.",
        modelRun: {
          kind: "chat",
          model: "gemini-flash-lite-latest",
          promptVersion: "followup-v1",
        },
      },
    });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy.mock.calls[0][0]).toEqual(expect.stringContaining("/models/gemini-2.5-flash:generateContent"));
    expect(fetchSpy.mock.calls[1][0]).toEqual(expect.stringContaining("/models/gemini-flash-lite-latest:generateContent"));
  });

  it("falls back to flash lite when the default Gemini chat model is temporarily overloaded", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: "This model is currently experiencing high demand." } }), {
          status: 503,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: "Check the belt after the engine is off and cool." }] } }],
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      );

    await expect(createChatResponse({ userMessage: "Can I inspect this now?" }, { GEMINI_API_KEY: "test-key" })).resolves.toMatchObject({
      status: 200,
      body: {
        message: "Check the belt after the engine is off and cool.",
        modelRun: {
          kind: "chat",
          model: "gemini-flash-lite-latest",
        },
      },
    });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy.mock.calls[1][0]).toEqual(expect.stringContaining("/models/gemini-flash-lite-latest:generateContent"));
  });

  it("falls back to flash lite when the default Gemini chat model returns an empty answer", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: "   " }] } }],
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: "Use a mechanic if this is near brakes or steering." }] } }],
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      );

    await expect(createChatResponse({ userMessage: "What if it looks unsafe?" }, { GEMINI_API_KEY: "test-key" })).resolves.toMatchObject({
      status: 200,
      body: {
        message: "Use a mechanic if this is near brakes or steering.",
        modelRun: {
          kind: "chat",
          model: "gemini-flash-lite-latest",
        },
      },
    });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy.mock.calls[1][0]).toEqual(expect.stringContaining("/models/gemini-flash-lite-latest:generateContent"));
  });

  it("returns rate_limited only after all chat models are quota limited", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: { message: "quota exhausted" } }), {
        status: 429,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(createChatResponse({ userMessage: "What should I do next?" }, { GEMINI_API_KEY: "test-key" })).resolves.toMatchObject({
      status: 429,
      body: {
        error: {
          code: "rate_limited",
        },
      },
    });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
