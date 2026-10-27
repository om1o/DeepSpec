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

  it("disables production chat unless it is explicitly enabled", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await expect(createChatResponse(
      { userMessage: "What does it do?" },
      { GEMINI_API_KEY: "test-key", NODE_ENV: "production" },
    )).resolves.toMatchObject({ status: 503, body: { error: { code: "feature_disabled" } } });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("allows an explicitly enabled production chat request", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: "Check the belt tension." }] } }],
      }), { status: 200, headers: { "Content-Type": "application/json" } }),
    );
    await expect(createChatResponse(
      { userMessage: "What should I check?" },
      { DEEPSPEC_ENABLE_CHAT: "true", GEMINI_API_KEY: "test-key", NODE_ENV: "production" },
    )).resolves.toMatchObject({ status: 200, body: { message: "Check the belt tension." } });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
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

    await expect(createChatResponse({ userMessage: "Part name: Alternator\nUser question: What does it do?" }, { GEMINI_API_KEY: "test-key" })).resolves.toEqual({
      status: 200,
      body: {
        message: "The alternator charges the battery while the engine runs.",
      },
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining("/models/gemini-2.5-flash:generateContent"),
      expect.objectContaining({
        method: "POST",
      }),
    );
  });

  it("falls back when the default chat model is transiently unavailable", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response("<html>Service Unavailable</html>", {
          status: 503,
          headers: { "Content-Type": "text/html" },
        }),
      )
      .mockResolvedValueOnce(
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

    await expect(createChatResponse({ userMessage: "What does it do?" }, { GEMINI_API_KEY: "test-key" })).resolves.toEqual({
      status: 200,
      body: {
        message: "The alternator charges the battery while the engine runs.",
      },
    });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy.mock.calls[0][0]).toEqual(expect.stringContaining("/models/gemini-2.5-flash:generateContent"));
    expect(fetchSpy.mock.calls[1][0]).toEqual(expect.stringContaining("/models/gemini-2.5-flash-lite:generateContent"));
  });
});
