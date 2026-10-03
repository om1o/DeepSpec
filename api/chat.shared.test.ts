import { createChatResponse } from "../server/chat.shared";

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

    const request = JSON.parse(String(fetchSpy.mock.calls[0][1]?.body));
    expect(request.system_instruction.parts[0].text).toContain("Use 9-25 concise sentences");
    expect(request.system_instruction.parts[0].text).toContain("OVERVIEW, WHAT TO CHECK, MORE DETAIL");
    expect(request.generationConfig.maxOutputTokens).toBe(900);
  });

  it("preserves answer zones and hard-caps a provider answer at 25 sentences", async () => {
    const providerAnswer = [
      "OVERVIEW",
      Array.from({ length: 10 }, (_, index) => `Overview sentence ${index + 1}.`).join(" "),
      "WHAT TO CHECK",
      Array.from({ length: 10 }, (_, index) => `Check sentence ${index + 1}.`).join(" "),
      "MORE DETAIL",
      Array.from({ length: 10 }, (_, index) => `Detail sentence ${index + 1}.`).join(" "),
    ].join("\n");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ candidates: [{ content: { parts: [{ text: providerAnswer }] } }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const response = await createChatResponse({ userMessage: "Explain this part." }, { GEMINI_API_KEY: "test-key" });

    expect(response.status).toBe(200);
    if (response.status !== 200) throw new Error("Expected a successful chat response.");
    expect(response.body.message).toContain("OVERVIEW\n");
    expect(response.body.message).toContain("WHAT TO CHECK\n");
    expect(response.body.message).toContain("MORE DETAIL\n");
    expect(response.body.message.match(/[.!?](?=\s|$)/g)).toHaveLength(25);
    expect(response.body.message).toContain("Detail sentence 5.");
    expect(response.body.message).not.toContain("Detail sentence 6.");
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
