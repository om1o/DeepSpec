import { createIdentifyResponse } from "./identify.shared";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const imageBase64 =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";
const engineFixtureBase64 = `data:image/jpeg;base64,${readFileSync(resolve(process.cwd(), "public/test-fixtures/engine-scan-test.jpg")).toString("base64")}`;
const blurryLabelFixturePath = resolve(process.cwd(), "public/test-fixtures/blurry-label-ocr-test.png");
const blurryLabelFixtureBytes = readFileSync(blurryLabelFixturePath);
const blurryLabelFixtureBase64 = `data:image/png;base64,${blurryLabelFixtureBytes.toString("base64")}`;

const result = {
  partName: "Alternator",
  confidence: "high",
  scanCategory: "electrical",
  candidateMatches: [
    {
      partName: "Starter motor",
      confidence: "low",
      scanCategory: "electrical",
      reason: "Also mounted in the engine bay, but the belt pulley points to alternator.",
    },
  ],
  whatItDoes: "It charges the battery while the engine runs.",
  visibleObservations: ["Belt-driven metal housing is visible."],
  evidenceRegions: [
    {
      label: "Pulley",
      observation: "Belt-driven pulley is visible on the front of the housing.",
      regionLabel: "Scanned area",
    },
  ],
  concerns: [],
  safetyTriage: "can_help",
  isSafetyCritical: false,
  nextAction: "Take another photo of the label if you need more detail.",
  needsBetterPhoto: false,
  evidence: ["The pulley and vented housing match common alternator shapes."],
  sourceLinks: [
    {
      label: "Search this part",
      url: "https://www.google.com/search?q=Alternator%20car%20part",
      sourceType: "search",
    },
    {
      label: "NHTSA recalls",
      url: "https://www.nhtsa.gov/recalls",
      sourceType: "safety",
    },
  ],
};

describe("createIdentifyResponse", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    rmSync(resolve(process.cwd(), "tmp-test-dataset"), { force: true, recursive: true });
    rmSync(resolve(process.cwd(), "tmp-test-dataset-index"), { force: true, recursive: true });
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

  it("falls back to flash lite when the default Gemini model is quota limited", async () => {
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
            candidates: [{ content: { parts: [{ text: JSON.stringify(result) }] } }],
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

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy.mock.calls[0][0]).toEqual(expect.stringContaining("/models/gemini-2.5-flash:generateContent"));
    expect(fetchSpy.mock.calls[1][0]).toEqual(expect.stringContaining("/models/gemini-2.5-flash-lite:generateContent"));
  });

  it("falls back when the default Gemini model has a transient provider failure", async () => {
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
            candidates: [{ content: { parts: [{ text: JSON.stringify(result) }] } }],
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

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy.mock.calls[0][0]).toEqual(expect.stringContaining("/models/gemini-2.5-flash:generateContent"));
    expect(fetchSpy.mock.calls[1][0]).toEqual(expect.stringContaining("/models/gemini-2.5-flash-lite:generateContent"));
  });

  it("falls back to local Ollama when Gemini providers are unavailable and local fallback is enabled", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response("<html>Service Unavailable</html>", {
          status: 503,
          headers: { "Content-Type": "text/html" },
        }),
      )
      .mockResolvedValueOnce(
        new Response("<html>Service Unavailable</html>", {
          status: 503,
          headers: { "Content-Type": "text/html" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            message: {
              content: JSON.stringify(result),
            },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      );

    await expect(
      createIdentifyResponse(
        { imageBase64 },
        {
          GEMINI_API_KEY: "test-key",
          DEEPSPEC_ENABLE_OLLAMA_IDENTIFY_FALLBACK: "true",
        },
      ),
    ).resolves.toEqual({
      status: 200,
      body: {
        result,
      },
    });

    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(fetchSpy.mock.calls[2][0]).toBe("http://127.0.0.1:11434/api/chat");
    const ollamaBody = JSON.parse((fetchSpy.mock.calls[2][1] as RequestInit).body as string);
    expect(ollamaBody.model).toBe("llava:latest");
    expect(ollamaBody.stream).toBe(false);
    expect(ollamaBody.format).toBe("json");
    expect(ollamaBody.messages[0].images).toEqual([imageBase64.replace(/^data:image\/png;base64,/, "")]);
  });

  it("uses local Ollama when Gemini is not configured and local fallback is enabled", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          message: {
            content: JSON.stringify(result),
          },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    await expect(
      createIdentifyResponse(
        { imageBase64 },
        {
          DEEPSPEC_ENABLE_OLLAMA_IDENTIFY_FALLBACK: "true",
        },
      ),
    ).resolves.toEqual({
      status: 200,
      body: {
        result,
      },
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][0]).toBe("http://127.0.0.1:11434/api/chat");
  });

  it("normalizes concise local Ollama JSON into the full identify result shape", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          message: {
            content: JSON.stringify({
              partName: "Engine",
              confidence: 0.95,
              scanCategory: "engine",
              visibleObservations: ["Engine bay components are visible."],
            }),
          },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    await expect(
      createIdentifyResponse(
        { imageBase64 },
        {
          DEEPSPEC_ENABLE_OLLAMA_IDENTIFY_FALLBACK: "true",
        },
      ),
    ).resolves.toMatchObject({
      status: 200,
      body: {
        result: {
          partName: "Engine",
          confidence: "high",
          scanCategory: "engine",
          visibleObservations: ["Engine bay components are visible."],
        },
      },
    });
  });

  it("uses comma-separated identify fallback models before the built-in fallback", async () => {
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
            candidates: [{ content: { parts: [{ text: JSON.stringify(result) }] } }],
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      );

    await createIdentifyResponse(
      { imageBase64 },
      {
        GEMINI_API_KEY: "test-key",
        GEMINI_FALLBACK_MODELS: "gemini-custom-fast, gemini-2.5-flash-lite",
      },
    );

    expect(fetchSpy.mock.calls[0][0]).toEqual(expect.stringContaining("/models/gemini-2.5-flash:generateContent"));
    expect(fetchSpy.mock.calls[1][0]).toEqual(expect.stringContaining("/models/gemini-custom-fast:generateContent"));
  });

  it("uses local Ollama vision only after Gemini identify models are rate limited", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: "quota exhausted" } }), {
          status: 429,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: "fallback quota exhausted" } }), {
          status: 429,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            message: {
              content: JSON.stringify(result),
            },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      );

    await expect(
      createIdentifyResponse(
        { imageBase64 },
        {
          DEEPSPEC_ENABLE_OLLAMA_IDENTIFY_FALLBACK: "true",
          GEMINI_API_KEY: "test-key",
        },
      ),
    ).resolves.toEqual({
      status: 200,
      body: {
        result,
      },
    });

    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(fetchSpy.mock.calls[0][0]).toEqual(expect.stringContaining("/models/gemini-2.5-flash:generateContent"));
    expect(fetchSpy.mock.calls[1][0]).toEqual(expect.stringContaining("/models/gemini-2.5-flash-lite:generateContent"));
    expect(fetchSpy.mock.calls[2][0]).toBe("http://127.0.0.1:11434/api/chat");

    const ollamaBody = JSON.parse((fetchSpy.mock.calls[2][1] as RequestInit).body as string);
    expect(ollamaBody).toMatchObject({
      model: "llava:latest",
      stream: false,
      format: "json",
      options: {
        num_ctx: 2048,
      },
    });
    expect(ollamaBody.messages[0].images).toEqual(["iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII="]);
  });

  it("does not use Ollama when the local dev fallback flag is off", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: "quota exhausted" } }), {
          status: 429,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: "fallback quota exhausted" } }), {
          status: 429,
          headers: { "Content-Type": "application/json" },
        }),
      );

    await expect(createIdentifyResponse({ imageBase64 }, { GEMINI_API_KEY: "test-key" })).resolves.toMatchObject({
      status: 429,
      body: {
        error: {
          code: "rate_limited",
        },
      },
    });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("surfaces invalid Ollama JSON as a fallback failure instead of hiding it as rate limited", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: "quota exhausted" } }), {
          status: 429,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: "fallback quota exhausted" } }), {
          status: 429,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: { content: "not json" } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

    await expect(
      createIdentifyResponse(
        { imageBase64 },
        {
          DEEPSPEC_ENABLE_OLLAMA_IDENTIFY_FALLBACK: "true",
          GEMINI_API_KEY: "test-key",
        },
      ),
    ).resolves.toMatchObject({
      status: 502,
      body: {
        error: {
          code: "invalid_response",
        },
      },
    });
  });

  it("keeps the current engine QA fixture on the normal Gemini path", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: JSON.stringify(result) }] } }],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    await expect(createIdentifyResponse({ imageBase64: engineFixtureBase64 }, { GEMINI_API_KEY: "test-key" })).resolves.toEqual({
      status: 200,
      body: {
        result,
      },
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][0]).toEqual(expect.stringContaining("generativelanguage.googleapis.com"));
  });

  it("runs OCR on the real blurry-label fixture before Gemini and saves extracted text as evidence", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify([{ generated_text: "DENSO 104210-1230" }]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: JSON.stringify(result) }] } }],
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      );

    await expect(
      createIdentifyResponse(
        {
          imageBase64: blurryLabelFixtureBase64,
          labelRescueTrigger: "too_blurry",
        },
        {
          GEMINI_API_KEY: "test-key",
          HUGGINGFACE_API_KEY: "hf-test-key",
        },
      ),
    ).resolves.toMatchObject({
      status: 200,
      body: {
        result: {
          evidence: expect.arrayContaining(["OCR label text: DENSO 104210-1230"]),
        },
      },
    });

    expect(blurryLabelFixtureBytes.byteLength).toBeGreaterThan(1_000);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy.mock.calls[0][0]).toEqual(expect.stringContaining("api-inference.huggingface.co/models/microsoft%2Ftrocr-large-printed"));
    expect((fetchSpy.mock.calls[0][1] as RequestInit).headers).toEqual(
      expect.objectContaining({ "Content-Type": "image/png" }),
    );
    expect(Buffer.compare((fetchSpy.mock.calls[0][1] as RequestInit).body as Buffer, blurryLabelFixtureBytes)).toBe(0);
    expect(fetchSpy.mock.calls[1][0]).toEqual(expect.stringContaining("generativelanguage.googleapis.com"));
    const geminiBody = JSON.parse((fetchSpy.mock.calls[1][1] as RequestInit).body as string);
    expect(JSON.stringify(geminiBody)).toContain("DENSO 104210-1230");
  });

  it("gives Gemini enough output budget to finish structured identify JSON", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: JSON.stringify(result) }] } }],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    await createIdentifyResponse({ imageBase64 }, { GEMINI_API_KEY: "test-key" });

    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.generationConfig.maxOutputTokens).toBeGreaterThanOrEqual(2048);
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

  it("adds local dataset matches to result evidence when metadata is available", async () => {
    const datasetRoot = resolve(process.cwd(), "tmp-test-dataset");
    mkdirSync(resolve(datasetRoot, "Car damages dataset"), { recursive: true });
    mkdirSync(resolve(datasetRoot, "Car parts dataset"), { recursive: true });
    writeFileSync(
      resolve(datasetRoot, "Car damages dataset", "meta.json"),
      JSON.stringify({ classes: [{ title: "Dent" }, { title: "Scratch" }] }),
    );
    writeFileSync(
      resolve(datasetRoot, "Car parts dataset", "meta.json"),
      JSON.stringify({ classes: [{ title: "Front-bumper" }, { title: "Fender" }] }),
    );
    const bumperResult = {
      ...result,
      partName: "Front bumper",
      scanCategory: "body",
      visibleObservations: ["Large dent on the lower bumper cover."],
      concerns: ["Dent visible near the center."],
    };

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: JSON.stringify(bumperResult) }] } }],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    await expect(
      createIdentifyResponse(
        { imageBase64 },
        {
          DEEPSPEC_DATASET_ROOT: datasetRoot,
          DEEPSPEC_DATASET_INDEX_PATH: resolve(datasetRoot, "missing-records.jsonl"),
          GEMINI_API_KEY: "test-key",
        },
      ),
    ).resolves.toMatchObject({
      status: 200,
      body: {
        result: {
          evidence: expect.arrayContaining([
            "Local dataset match: Front-bumper (part)",
            "Local dataset match: Dent (damage)",
          ]),
        },
      },
    });

    const requestBody = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(JSON.stringify(requestBody)).toContain("Deep Spec local source context");
    expect(JSON.stringify(requestBody)).toContain("Front-bumper");
  });

  it("uses the sorted local dataset index and source links when available", async () => {
    const datasetRoot = resolve(process.cwd(), "tmp-test-dataset-index");
    const indexPath = resolve(datasetRoot, "records.jsonl");
    mkdirSync(datasetRoot, { recursive: true });
    writeFileSync(
      indexPath,
      [
        JSON.stringify({
          canonicalKind: "part",
          labels: ["Front-bumper"],
          links: {
            image:
              "https://huggingface.co/datasets/DrBimmer/car-parts-and-damage-dataset/resolve/main/Car%20damages%20dataset/File1/img/Car%20damages%20100.png",
          },
          primaryLabel: "Front-bumper",
        }),
        JSON.stringify({
          canonicalKind: "part",
          labels: ["Front-bumper"],
          links: {
            image:
              "https://huggingface.co/datasets/DrBimmer/car-parts-and-damage-dataset/resolve/main/Car%20damages%20dataset/File1/img/Car%20damages%20101.png",
          },
          primaryLabel: "Front-bumper",
        }),
      ].join("\n"),
    );
    const bumperResult = {
      ...result,
      partName: "Front bumper cover",
      scanCategory: "body",
      visibleObservations: ["Front bumper cover is centered in the photo."],
    };

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: JSON.stringify(bumperResult) }] } }],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    await expect(
      createIdentifyResponse(
        { imageBase64 },
        {
          DEEPSPEC_DATASET_INDEX_PATH: indexPath,
          GEMINI_API_KEY: "test-key",
        },
      ),
    ).resolves.toMatchObject({
      status: 200,
      body: {
        result: {
          evidence: expect.arrayContaining([
            "Local dataset match: Front-bumper (part, 2 labeled samples)",
            "Dataset source: https://huggingface.co/datasets/DrBimmer/car-parts-and-damage-dataset/resolve/main/Car%20damages%20dataset/File1/img/Car%20damages%20100.png",
          ]),
        },
      },
    });

    const requestBody = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(JSON.stringify(requestBody)).toContain("Deep Spec local source context");
    expect(JSON.stringify(requestBody)).toContain("Front-bumper");
    expect(JSON.stringify(requestBody)).toContain(
      "https://huggingface.co/datasets/DrBimmer/car-parts-and-damage-dataset/resolve/main/Car%20damages%20dataset/File1/img/Car%20damages%20100.png",
    );
  });

  it("promotes a strong local part match when Gemini returns a generic primary label", async () => {
    const datasetRoot = resolve(process.cwd(), "tmp-test-dataset-index");
    const indexPath = resolve(datasetRoot, "records.jsonl");
    mkdirSync(datasetRoot, { recursive: true });
    writeFileSync(
      indexPath,
      [
        JSON.stringify({
          canonicalKind: "damage",
          labels: ["Front-bumper"],
          links: {
            image:
              "https://huggingface.co/datasets/DrBimmer/car-parts-and-damage-dataset/resolve/main/Car%20damages%20dataset/File1/img/Car%20damages%20100.png",
          },
          primaryLabel: "Front-bumper",
        }),
        JSON.stringify({
          canonicalKind: "damage",
          labels: ["Fender"],
          links: {
            image:
              "https://huggingface.co/datasets/DrBimmer/car-parts-and-damage-dataset/resolve/main/Car%20damages%20dataset/File1/img/Car%20damages%20101.png",
          },
          primaryLabel: "Fender",
        }),
      ].join("\n"),
    );
    const genericBodyResult = {
      ...result,
      partName: "unknown component",
      confidence: "low",
      scanCategory: "body",
      visibleObservations: ["The front bumper cover is centered in the photo."],
      concerns: ["The front bumper has scuffs near the lower edge."],
      evidence: ["The front bumper is visible, but the image is pulled back."],
    };

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: JSON.stringify(genericBodyResult) }] } }],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    await expect(
      createIdentifyResponse(
        { imageBase64 },
        {
          DEEPSPEC_DATASET_INDEX_PATH: indexPath,
          GEMINI_API_KEY: "test-key",
        },
      ),
    ).resolves.toMatchObject({
      status: 200,
      body: {
        result: {
          partName: "Front-bumper",
          confidence: "medium",
          evidence: expect.arrayContaining(["Local dataset match: Front-bumper (damage, 1 labeled sample)"]),
        },
      },
    });
  });

  it("does not create a damage dataset match from negated damage text", async () => {
    const datasetRoot = resolve(process.cwd(), "tmp-test-dataset-index");
    const indexPath = resolve(datasetRoot, "records.jsonl");
    mkdirSync(datasetRoot, { recursive: true });
    writeFileSync(
      indexPath,
      JSON.stringify({
        canonicalKind: "damage",
        labels: ["Corrosion"],
        links: {
          image:
            "https://huggingface.co/datasets/DrBimmer/car-parts-and-damage-dataset/resolve/main/Car%20parts%20dataset/File1/img/Car%20damages%201075.png",
        },
        primaryLabel: "Corrosion",
      }),
    );
    const cleanResult = {
      ...result,
      concerns: ["The part appears clean and free of visible damage or corrosion."],
      evidence: ["No corrosion is visible on the housing."],
    };

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: JSON.stringify(cleanResult) }] } }],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    const response = await createIdentifyResponse(
      { imageBase64 },
      {
        DEEPSPEC_DATASET_INDEX_PATH: indexPath,
        GEMINI_API_KEY: "test-key",
      },
    );

    expect(response.status).toBe(200);
    if (response.status === 200) {
      expect(response.body.result.evidence).not.toEqual(expect.arrayContaining(["Local dataset match: Corrosion (damage, 1 labeled sample)"]));
    }
  });
});
