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

  it("sends the saved photo alongside the question to the vision-capable chat model", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: "The visible belt has frayed edges." }] } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    await expect(createChatResponse({ userMessage: "What do you see on this belt?", imageBase64: "data:image/png;base64,aGVsbG8=" }, { GEMINI_API_KEY: "test-key" })).resolves.toMatchObject({ status: 200 });
    const sent = JSON.parse(String(fetchSpy.mock.calls[0][1]?.body));
    expect(sent.contents[0].parts).toEqual([
      { text: "What do you see on this belt?" },
      { inlineData: { mimeType: "image/png", data: "aGVsbG8=" } },
    ]);
    expect(sent).not.toHaveProperty("tools");
  });

  it.each(["https://internal.example/photo.jpg", "data:image/svg+xml;base64,aGVsbG8=", "data:image/png;base64,abc", "data:image/png;base64,a=b="])("rejects an unsafe or malformed photo without fetching it: %s", async (imageBase64) => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await expect(createChatResponse({ userMessage: "Inspect this", imageBase64 }, { GEMINI_API_KEY: "test-key" })).resolves.toMatchObject({ status: 400, body: { error: { code: "invalid_input" } } });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects an oversized photo before provider or remote image requests", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await expect(createChatResponse({ userMessage: "Inspect this", imageBase64: "data:image/png;base64," + "a".repeat(4_000_000) }, { GEMINI_API_KEY: "test-key" })).resolves.toMatchObject({ status: 400, body: { error: { code: "image_too_large" } } });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("keeps useful detailed paragraphs instead of flattening and cutting the answer at 1200 characters", async () => {
    const answer = "Visible observations\n\n" + "The belt has visible edge wear. ".repeat(45).trimEnd() + "\n\nNext checks\n- Read the belt marking.\n- Compare the tensioner position.";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: answer }] } }] }), { status: 200, headers: { "Content-Type": "application/json" } }));
    await expect(createChatResponse({ userMessage: "Explain the visible concerns and next checks." }, { GEMINI_API_KEY: "test-key" })).resolves.toMatchObject({ status: 200, body: { message: answer } });
  });

  it("uses real research tools only on request and returns provider-grounded sources and suggestions", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ candidates: [{
      content: { parts: [{ text: "Compare the visible belt with the manufacturer's reference." }] },
      groundingMetadata: {
        groundingChunks: [{ web: { uri: "https://example.com/belt-guide", title: "Belt guide" } }, { web: { uri: "javascript:bad", title: "Unsafe" } }],
        searchEntryPoint: { renderedContent: "<div>Search suggestions</div>" },
      },
      urlContextMetadata: { urlMetadata: [
        { retrievedUrl: "https://example.com/manual", urlRetrievalStatus: "URL_RETRIEVAL_STATUS_SUCCESS" },
        { retrievedUrl: "https://example.com/not-retrieved", urlRetrievalStatus: "URL_RETRIEVAL_STATUS_ERROR" },
      ] },
    }] }), { status: 200, headers: { "Content-Type": "application/json" } }));
    await expect(createChatResponse({ userMessage: "Research this belt", research: true, sourceUrls: ["https://www.youtube.com/watch?v=abcdefghijk"] }, { GEMINI_API_KEY: "test-key" })).resolves.toEqual({
      status: 200,
      body: {
        message: "Compare the visible belt with the manufacturer's reference.",
        sources: [
          { label: "Belt guide", url: "https://example.com/belt-guide", sourceType: "reference" },
          { label: "example.com", url: "https://example.com/manual", sourceType: "reference" },
        ],
        searchSuggestions: "<div>Search suggestions</div>",
      },
    });
    const sent = JSON.parse(String(fetchSpy.mock.calls[0][1]?.body));
    expect(sent.tools).toEqual([{ googleSearch: {} }, { urlContext: {} }]);
    expect(sent.contents[0].parts[0].text).toContain("https://www.youtube.com/watch?v=abcdefghijk");
    expect(sent.contents[0].parts[0].text).toContain("do not claim to have watched");
  });

  it("does not invent verified research sources when the provider supplies no grounding", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "See https://example.com/unverified" }] } }] }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const response = await createChatResponse({ userMessage: "Research this part", research: true }, { GEMINI_API_KEY: "test-key" });
    expect(response).toMatchObject({ status: 200 });
    expect(response.body).not.toHaveProperty("sources");
  });

  it.each(["http://127.0.0.1/", "https://127.0.0.1/", "https://site.local/", "https://user:secret@example.com/"])("rejects non-public research references without network access: %s", async (url) => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await expect(createChatResponse({ userMessage: "Research", research: true, sourceUrls: [url] }, { GEMINI_API_KEY: "test-key" })).resolves.toMatchObject({ status: 400 });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
