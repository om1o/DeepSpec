import { createIdentifyResponse } from "./identify.shared";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const imageBase64 =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";
const engineFixtureBase64 = `data:image/jpeg;base64,${readFileSync(resolve(process.cwd(), "public/test-fixtures/engine-scan-test.jpg")).toString("base64")}`;
const blurryLabelFixturePath = resolve(process.cwd(), "public/test-fixtures/blurry-label-ocr-test.png");
const blurryLabelFixtureBytes = readFileSync(blurryLabelFixturePath);
const blurryLabelFixtureBase64 = `data:image/png;base64,${blurryLabelFixtureBytes.toString("base64")}`;
const tempDatasetRoots = new Set<string>();

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

function makeTempDatasetRoot(prefix: string) {
  const root = mkdtempSync(resolve(process.cwd(), `${prefix}-`));
  tempDatasetRoots.add(root);
  return root;
}

describe("createIdentifyResponse", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    rmSync(resolve(process.cwd(), "tmp-test-dataset"), { force: true, recursive: true });
    rmSync(resolve(process.cwd(), "tmp-test-dataset-index"), { force: true, recursive: true });
    for (const path of tempDatasetRoots) {
      rmSync(path, { force: true, recursive: true });
    }
    tempDatasetRoots.clear();
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

    await expect(createIdentifyResponse({ imageBase64 }, { GEMINI_API_KEY: "test-key" })).resolves.toMatchObject({
      status: 200,
      body: {
        result,
        modelRun: {
          provider: "gemini",
          model: "gemini-2.5-flash",
          ocrUsed: false,
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

  it("normalizes loose Gemini JSON into a usable identify result", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      partName: "Engine Assembly",
                      scanCategory: "engine",
                      whatItDoes: "The engine converts fuel into mechanical energy.",
                      visibleObservations: "A silver engine block and black plastic intake manifold are visible.",
                      concerns: [],
                      evidence: "The block, cylinder head, intake manifold, and oil pan are visible.",
                      candidateMatches: [
                        {
                          partName: "Intake Manifold",
                          evidence: "The black plastic runners are visible on the upper side.",
                        },
                      ],
                      evidenceRegions: [
                        {
                          regionLabel: "center",
                          visualEvidence: "Entire engine assembly",
                        },
                      ],
                      sourceLinks: ["https://www.google.com/search?q=car+engine+assembly+parts"],
                      isSafetyCritical: false,
                      nextAction: "Verify fitment with vehicle context.",
                      confidenceScore: 95,
                      confidenceRange: { low: 90, high: 98 },
                      confirmationNeed: "none",
                      needsBetterPhoto: false,
                      fitmentConfidence: "needs_vehicle_context",
                    }),
                  },
                ],
              },
              finishReason: "STOP",
            },
          ],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    const response = await createIdentifyResponse({ imageBase64 }, { GEMINI_API_KEY: "test-key" });

    expect(response).toMatchObject({
      status: 200,
      body: {
        result: {
          partName: "Engine Assembly",
          confidence: "high",
          confidenceScore: 95,
          scanCategory: "engine",
          visibleObservations: ["A silver engine block and black plastic intake manifold are visible."],
          candidateMatches: [
            {
              partName: "Intake Manifold",
              confidence: "medium",
              scanCategory: "engine",
              reason: "The black plastic runners are visible on the upper side.",
            },
          ],
          evidenceRegions: [
            {
              label: "Engine Assembly",
              observation: "Entire engine assembly",
              regionLabel: "center",
            },
          ],
        },
      },
    });
  });

  it("normalizes Gemini JSON when the answer is nested under primaryPart", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      primaryPart: {
                        partName: "Internal Combustion Engine Assembly",
                        scanCategory: "engine",
                        confidenceScore: 90,
                        confidenceRange: { low: 85, high: 95 },
                        confirmationNeed: "none",
                        isSafetyCritical: true,
                        visibleObservations: [
                          "Upper section features a black plastic intake manifold.",
                          "Lower section is a silver-colored metal block and oil pan.",
                        ],
                        evidence: "The engine block, cylinder head, intake manifold, and oil pan are visible.",
                        evidenceRegions: [
                          {
                            regionLabel: "upper section",
                            visualClue: "black plastic intake manifold",
                          },
                        ],
                        whatItDoes: "An internal combustion engine converts fuel into mechanical energy.",
                      },
                      nextAction: "Inspect specific components for a more precise diagnosis.",
                      needsBetterPhoto: false,
                      sourceLinks: [
                        "https://www.google.com/search?q=internal+combustion+engine+assembly",
                      ],
                      fitmentConfidence: "needs_vehicle_context",
                    }),
                  },
                ],
              },
              finishReason: "STOP",
            },
          ],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    const response = await createIdentifyResponse({ imageBase64 }, { GEMINI_API_KEY: "test-key" });

    expect(response).toMatchObject({
      status: 200,
      body: {
        result: {
          partName: "Internal Combustion Engine Assembly",
          confidence: "high",
          confidenceScore: 90,
          scanCategory: "engine",
          whatItDoes: "An internal combustion engine converts fuel into mechanical energy.",
          evidenceRegions: [
            {
              label: "Internal Combustion Engine Assembly",
              observation: "black plastic intake manifold",
              regionLabel: "upper section",
            },
          ],
        },
      },
    });
  });

  it("normalizes compact Gemini JSON with loose casing and string arrays", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      partName: "Engine Assembly",
                      confidence: "High",
                      confidenceScore: 0.95,
                      confidenceRange: "0.90-0.99",
                      confirmationNeed: "None",
                      scanCategory: "engine",
                      whatItDoes: "Converts fuel into mechanical energy to power the vehicle.",
                      visibleObservations: [
                        "Complete engine assembly visible",
                        "Intake manifold visible on top",
                        "Oil pan visible at the bottom",
                      ],
                      evidence: [
                        "Overall shape and components consistent with an internal combustion engine.",
                        "Presence of intake manifold, cylinder head area, and oil pan.",
                      ],
                      evidenceRegions: ["Entire object in the image"],
                      concerns: [],
                      candidateMatches: [
                        "Internal Combustion Engine",
                        "Gasoline Engine",
                        "Diesel Engine",
                      ],
                      primaryPart: true,
                      candidateParts: [
                        {
                          partName: "Engine Block",
                          confidence: "High",
                        },
                      ],
                      possibleVehicleContexts: [
                        "Any vehicle requiring an internal combustion engine for propulsion.",
                      ],
                      measurements: [],
                      requiredNextEvidence: [],
                      fitmentConfidence: "Not applicable without vehicle context",
                      safetyTriage: "No immediate safety concern visible",
                      isSafetyCritical: false,
                      nextAction: "Further inspection if specific issues are suspected or for installation.",
                      needsBetterPhoto: false,
                      sourceLinks: [],
                    }),
                  },
                ],
              },
              finishReason: "STOP",
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
          partName: "Engine Assembly",
          confidence: "high",
          confidenceScore: 95,
          confidenceRange: { low: 90, high: 99 },
          confirmationNeed: "none",
          scanCategory: "engine",
          candidateMatches: [
            {
              partName: "Internal Combustion Engine",
              confidence: "medium",
              scanCategory: "engine",
            },
            {
              partName: "Gasoline Engine",
              confidence: "medium",
              scanCategory: "engine",
            },
            {
              partName: "Diesel Engine",
              confidence: "medium",
              scanCategory: "engine",
            },
          ],
          evidenceRegions: [
            {
              label: "Engine Assembly",
              observation: "Entire object in the image",
              regionLabel: "Scanned area",
            },
          ],
          safetyTriage: "can_help",
          isSafetyCritical: false,
        },
      },
    });
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

    await expect(createIdentifyResponse({ imageBase64 }, { GEMINI_API_KEY: "test-key" })).resolves.toMatchObject({
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

    await expect(createIdentifyResponse({ imageBase64 }, { GEMINI_API_KEY: "test-key" })).resolves.toMatchObject({
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
    ).resolves.toMatchObject({
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
    ).resolves.toMatchObject({
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

  it("falls back to Hugging Face after Gemini identify models are rate limited", async () => {
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
            choices: [{ message: { content: JSON.stringify(result) } }],
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
          DEEPSPEC_ENABLE_HF_IDENTIFY_FALLBACK: "true",
          GEMINI_API_KEY: "test-key",
          HF_TOKEN: "hf-test",
        },
      ),
    ).resolves.toMatchObject({
      status: 200,
      body: {
        result: {
          ...result,
          modelRun: {
            provider: "huggingface",
            model: "Qwen/Qwen2.5-VL-7B-Instruct",
            fallbackReason: "rate_limited",
            ocrUsed: false,
          },
        },
        modelRun: {
          provider: "huggingface",
          model: "Qwen/Qwen2.5-VL-7B-Instruct",
          fallbackReason: "rate_limited",
          ocrUsed: false,
        },
      },
    });

    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(fetchSpy.mock.calls[2][0]).toBe("https://router.huggingface.co/v1/chat/completions");
    expect(fetchSpy.mock.calls[2][1]).toMatchObject({
      method: "POST",
      headers: expect.objectContaining({
        Authorization: "Bearer hf-test",
      }),
    });
    const body = JSON.parse((fetchSpy.mock.calls[2][1] as RequestInit).body as string);
    expect(body.model).toBe("Qwen/Qwen2.5-VL-7B-Instruct");
    expect(body.messages[1].content).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "image_url",
        image_url: {
          url: imageBase64,
        },
      }),
    ]));
  });

  it("does not use Hugging Face when fallback is disabled", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ error: { message: "quota exhausted" } }), {
          status: 429,
          headers: { "Content-Type": "application/json" },
        }),
      );

    await expect(createIdentifyResponse({ imageBase64 }, { GEMINI_API_KEY: "test-key", HF_TOKEN: "hf-test" })).resolves.toMatchObject({
      status: 429,
      body: {
        error: {
          code: "rate_limited",
        },
      },
    });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("can force Hugging Face identify for provider health checks", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(result) } }],
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
          DEEPSPEC_FORCE_HF_IDENTIFY: "true",
          HF_IDENTIFY_MODEL: "Qwen/Qwen2.5-VL-3B-Instruct",
          HF_TOKEN: "hf-test",
        },
      ),
    ).resolves.toMatchObject({
      status: 200,
      body: {
        modelRun: {
          provider: "huggingface",
          model: "Qwen/Qwen2.5-VL-3B-Instruct",
          fallbackReason: "forced_hf_health",
        },
      },
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("reports missing Hugging Face token as setup failure in forced mode", async () => {
    await expect(
      createIdentifyResponse(
        { imageBase64 },
        {
          DEEPSPEC_FORCE_HF_IDENTIFY: "true",
        },
      ),
    ).resolves.toMatchObject({
      status: 500,
      body: {
        error: {
          code: "not_configured",
        },
      },
    });
  });

  it("maps Hugging Face rate limit and invalid JSON responses", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { message: "Too many requests" } }), {
        status: 429,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(
      createIdentifyResponse(
        { imageBase64 },
        {
          DEEPSPEC_FORCE_HF_IDENTIFY: "true",
          HF_TOKEN: "hf-test",
        },
      ),
    ).resolves.toMatchObject({
      status: 429,
      body: {
        error: {
          code: "rate_limited",
        },
      },
    });

    vi.restoreAllMocks();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ choices: [{ message: { content: "not json" } }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(
      createIdentifyResponse(
        { imageBase64 },
        {
          DEEPSPEC_FORCE_HF_IDENTIFY: "true",
          HF_TOKEN: "hf-test",
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

  it("retries the OpenRouter/HF backup on a transient 429 before succeeding", async () => {
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
        new Response(JSON.stringify({ error: { message: "busy" } }), {
          status: 429,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(result) } }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

    await expect(
      createIdentifyResponse(
        { imageBase64 },
        {
          DEEPSPEC_ENABLE_HF_IDENTIFY_FALLBACK: "true",
          GEMINI_API_KEY: "test-key",
          HF_TOKEN: "hf-test",
          DEEPSPEC_BACKUP_RETRY_BACKOFF_MS: "0",
        },
      ),
    ).resolves.toMatchObject({
      status: 200,
      body: { modelRun: { provider: "huggingface" } },
    });

    expect(fetchSpy).toHaveBeenCalledTimes(4);
  });

  it("tries Groq first, then falls through to the OpenRouter/HF backup when Groq is rate limited", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: "groq busy" } }), {
          status: 429,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(result) } }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

    await expect(
      createIdentifyResponse(
        { imageBase64 },
        {
          DEEPSPEC_ENABLE_HF_IDENTIFY_FALLBACK: "true",
          HF_TOKEN: "hf-test",
          GROQ_API_KEY: "groq-test",
          DEEPSPEC_BACKUP_RATE_LIMIT_RETRIES: "0",
        },
      ),
    ).resolves.toMatchObject({
      status: 200,
      body: { modelRun: { provider: "huggingface" } },
    });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy.mock.calls[0][0]).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect(fetchSpy.mock.calls[1][0]).toBe("https://router.huggingface.co/v1/chat/completions");
  });

  it("uses Groq before Gemini when Groq is configured", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(result) } }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

    await expect(
      createIdentifyResponse(
        { imageBase64 },
        {
          GEMINI_API_KEY: "test-key",
          GROQ_API_KEY: "groq-test",
          DEEPSPEC_BACKUP_RATE_LIMIT_RETRIES: "0",
        },
      ),
    ).resolves.toMatchObject({
      status: 200,
      body: { modelRun: { provider: "groq" } },
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][0]).toBe("https://api.groq.com/openai/v1/chat/completions");
  });

  it("falls back to Gemini when the configured Groq provider is unavailable", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: "groq unavailable" } }), {
          status: 503,
          headers: { "Content-Type": "application/json" },
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

    await expect(
      createIdentifyResponse(
        { imageBase64 },
        {
          GEMINI_API_KEY: "test-key",
          GROQ_API_KEY: "groq-test",
        },
      ),
    ).resolves.toMatchObject({
      status: 200,
      body: { modelRun: { provider: "gemini" } },
    });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy.mock.calls[0][0]).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect(fetchSpy.mock.calls[1][0]).toEqual(expect.stringContaining("/models/gemini-2.5-flash:generateContent"));
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
    ).resolves.toMatchObject({
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

    await expect(createIdentifyResponse({ imageBase64: engineFixtureBase64 }, { GEMINI_API_KEY: "test-key" })).resolves.toMatchObject({
      status: 200,
      body: {
        result,
      },
    });

    const geminiCalls = fetchSpy.mock.calls.filter((call) => String(call[0]).includes("generativelanguage.googleapis.com"));
    expect(geminiCalls).toHaveLength(1);
    expect(geminiCalls[0][0]).toEqual(expect.stringContaining("/models/gemini-2.5-flash:generateContent"));
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
    expect(fetchSpy.mock.calls[0][0]).toEqual(expect.stringContaining("api-inference.huggingface.co/models/microsoft%2Ftrocr-large-printed"));
    expect((fetchSpy.mock.calls[0][1] as RequestInit).headers).toEqual(
      expect.objectContaining({ "Content-Type": "image/png" }),
    );
    expect(Buffer.compare((fetchSpy.mock.calls[0][1] as RequestInit).body as Buffer, blurryLabelFixtureBytes)).toBe(0);
    const geminiCalls = fetchSpy.mock.calls.slice(1).filter((call) => String(call[0]).includes("generativelanguage.googleapis.com"));
    expect(geminiCalls).toHaveLength(1);
    const geminiBody = JSON.parse((geminiCalls[0][1] as RequestInit).body as string);
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
    expect(body.generationConfig.thinkingConfig).toEqual({ thinkingBudget: 0 });
    expect(body.generationConfig.responseSchema).toBeUndefined();
    expect(body.generationConfig.responseJsonSchema).toBeUndefined();
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

  it("does not keep an unsupported professional safety flag for ordinary body damage", async () => {
    const bodyDamageResult = {
      ...result,
      partName: "Front right collision damage",
      scanCategory: "body",
      safetyTriage: "needs_professional",
      isSafetyCritical: true,
      concerns: ["The bumper cover and hood are visibly dented, with possible structural damage."],
      evidence: ["Front bumper and hood collision deformation are visible."],
      nextAction: "Have a mechanic inspect this before driving.",
    };

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: JSON.stringify(bodyDamageResult) }] } }],
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
          scanCategory: "body",
          safetyTriage: "can_help",
          isSafetyCritical: false,
          nextAction: "Use this as a visual identification and inspect the area more closely before making repair decisions.",
        },
      },
    });
  });

  it("does not trust a leak category without visible fluid evidence", async () => {
    const bodyPanelResult = {
      ...result,
      partName: "Rocker-panel",
      scanCategory: "leak",
      candidateMatches: [],
      whatItDoes: "The rocker panel is a lower exterior body panel below the door opening.",
      safetyTriage: "can_help",
      isSafetyCritical: false,
      visibleObservations: ["The lower body panel below the door is centered in the photo."],
      concerns: ["The lower body panel has visible dents and scrape marks."],
      evidence: ["The rocker panel below the door is visibly deformed."],
    };

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: JSON.stringify(bodyPanelResult) }] } }],
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
          partName: "Rocker-panel",
          scanCategory: "body",
          safetyTriage: "can_help",
          isSafetyCritical: false,
        },
      },
    });
  });

  it("does not classify an engine assembly as a leak just because an oil pan is visible", async () => {
    const engineAssemblyResult = {
      ...result,
      partName: "Engine Assembly",
      scanCategory: "engine",
      candidateMatches: [],
      whatItDoes: "The engine converts fuel into mechanical energy.",
      visibleObservations: ["The silver engine block, intake manifold, and black oil pan are visible."],
      evidence: ["The engine block, cylinder head, intake manifold, and oil pan identify a complete engine assembly."],
      concerns: [],
      safetyTriage: "can_help",
      isSafetyCritical: false,
    };

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: JSON.stringify(engineAssemblyResult) }] } }],
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
          partName: "Engine Assembly",
          scanCategory: "engine",
          safetyTriage: "can_help",
          isSafetyCritical: false,
        },
      },
    });

    vi.restoreAllMocks();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  partName: "unlabeled",
                  confidence: "low",
                  scanCategory: "unknown",
                  whatItDoes: "Unsupported pipeline: image-text-to-text. Must be one of [image-to-text, object-detection].",
                  visibleObservations: ["Unsupported pipeline: image-text-to-text."],
                  evidence: ["Provider diagnostic, not a vehicle-part observation."],
                  concerns: [],
                  nextAction: "Try again later.",
                }),
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

    await expect(
      createIdentifyResponse(
        { imageBase64 },
        {
          DEEPSPEC_FORCE_HF_IDENTIFY: "true",
          HF_TOKEN: "hf-test",
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

  it("keeps a complete engine assembly in the engine category when connectors are visible", async () => {
    const engineAssemblyResult = {
      ...result,
      partName: "Internal Combustion Engine",
      scanCategory: "electrical",
      primaryPart: {
        partName: "Internal Combustion Engine",
        confidence: "high",
        scanCategory: "engine",
        evidence: [
          "The engine block, intake manifold, cylinder head, and oil pan are visible.",
        ],
      },
      candidateMatches: [],
      whatItDoes: "An internal combustion engine converts fuel into mechanical energy.",
      visibleObservations: [
        "The silver engine block and black intake manifold are visible.",
        "Various hoses and electrical connectors are attached.",
      ],
      evidence: [
        "The engine block, intake manifold, cylinder head, and oil pan identify a complete engine assembly.",
      ],
      concerns: [],
      safetyTriage: "can_help",
      isSafetyCritical: false,
    };

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: JSON.stringify(engineAssemblyResult) }] } }],
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
          partName: "Internal Combustion Engine",
          scanCategory: "engine",
          safetyTriage: "can_help",
          isSafetyCritical: false,
        },
      },
    });
  });

  it("turns a generic engine label into a specific engine assembly when engine-bay evidence is clear", async () => {
    const engineAssemblyResult = {
      ...result,
      partName: "Engine",
      scanCategory: "electrical",
      primaryPart: {
        partName: "Engine",
        confidence: "high",
        scanCategory: "electrical",
        evidence: [
          "The engine cover, intake duct, alternator, radiator hose, and electrical connectors are visible.",
        ],
      },
      candidateMatches: [],
      whatItDoes: "The engine assembly converts fuel into mechanical power and supports charging and intake accessories.",
      visibleObservations: [
        "A large engine cover is centered in the engine bay.",
        "The intake duct, alternator, hoses, and wiring harnesses are visible around it.",
      ],
      evidence: [
        "Multiple engine-bay features identify this as the complete engine assembly, not only an electrical connector.",
      ],
      evidenceRegions: [
        {
          label: "Engine",
          observation: "Black and silver color",
          regionLabel: "Scanned area",
        },
        {
          label: "Engine",
          observation: "Black and silver color",
          regionLabel: "Scanned area",
        },
      ],
      concerns: [],
      safetyTriage: "can_help",
      isSafetyCritical: false,
    };

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: JSON.stringify(engineAssemblyResult) }] } }],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    const response = await createIdentifyResponse({ imageBase64 }, { GEMINI_API_KEY: "test-key" });

    expect(response).toMatchObject({
      status: 200,
      body: {
        result: {
          partName: "Engine assembly",
          scanCategory: "engine",
          whatItDoes: expect.stringContaining("engine assembly"),
          nextAction: expect.stringContaining("vehicle year"),
          primaryPart: {
            partName: "Engine assembly",
            scanCategory: "engine",
          },
          safetyTriage: "can_help",
          isSafetyCritical: false,
        },
      },
    });

    expect(response.body.result.whatItDoes).not.toMatch(/visible vehicle component/i);
    expect(response.body.result.nextAction).not.toMatch(/owner.?s manual|specific engine details/i);
    expect(response.body.result.evidenceRegions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "Engine cover",
        }),
        expect.objectContaining({
          label: "Intake duct",
        }),
      ]),
    );
  });

  it("replaces generic body-part explanation with a specific recognized-part description", async () => {
    const bumperResult = {
      ...result,
      partName: "front bumper",
      scanCategory: "body",
      primaryPart: {
        partName: "front bumper",
        confidence: "high",
        scanCategory: "body",
        evidence: ["The front bumper cover and lower grille opening are visible."],
      },
      candidateMatches: [],
      whatItDoes: "This is a visible vehicle component that should be verified with vehicle-specific context before ordering or repair.",
      visibleObservations: [
        "The front bumper cover is visible below the grille and headlight area.",
      ],
      evidence: [
        "The part spans the front lower exterior and aligns with the grille and lamps.",
      ],
      concerns: ["Damage is visible near the bumper cover."],
      safetyTriage: "can_help",
      isSafetyCritical: false,
      nextAction: "Inspect the bumper and surrounding area for further damage.",
    };

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
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

    const response = await createIdentifyResponse({ imageBase64 }, { GEMINI_API_KEY: "test-key" });

    expect(response).toMatchObject({
      status: 200,
      body: {
        result: {
          partName: "front bumper",
          scanCategory: "body",
          whatItDoes: expect.stringContaining("exterior impact cover"),
        },
      },
    });
    expect(response.body.result.whatItDoes).not.toMatch(/visible vehicle component/i);
  });

  it("keeps a complete engine assembly in the engine category when fuel is mentioned generically", async () => {
    const engineAssemblyResult = {
      ...result,
      partName: "Engine Assembly",
      scanCategory: "fuel",
      primaryPart: {
        partName: "Engine Assembly",
        confidence: "high",
        scanCategory: "engine",
        evidence: [
          "The engine block, intake manifold, cylinder head, and oil pan are visible.",
        ],
      },
      candidateMatches: [],
      whatItDoes: "The engine converts fuel into mechanical energy.",
      visibleObservations: [
        "The silver engine block and black intake manifold are visible.",
        "The oil pan is visible at the bottom.",
      ],
      evidence: [
        "The engine block, intake manifold, cylinder head, and oil pan identify a complete engine assembly.",
      ],
      concerns: [],
      safetyTriage: "needs_professional",
      isSafetyCritical: true,
    };

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: JSON.stringify(engineAssemblyResult) }] } }],
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
          partName: "Engine Assembly",
          scanCategory: "engine",
          safetyTriage: "can_help",
          isSafetyCritical: false,
        },
      },
    });
  });

  it("clears needsBetterPhoto when the model returns a usable medium-confidence part", async () => {
    const usableMediumResult = {
      ...result,
      partName: "Front-door",
      confidence: "medium",
      scanCategory: "body",
      safetyTriage: "can_help",
      isSafetyCritical: false,
      needsBetterPhoto: true,
      visibleObservations: ["The front door panel is centered and visible."],
      evidence: ["Door seam and handle location point to the front door."],
      nextAction: "Take another angle if you need more damage detail.",
    };

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: JSON.stringify(usableMediumResult) }] } }],
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
          partName: "Front-door",
          confidence: "medium",
          safetyTriage: "can_help",
          needsBetterPhoto: false,
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
          DEEPSPEC_ENABLE_DATASET_SOURCE_CONTEXT: "true",
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
    const datasetRoot = makeTempDatasetRoot("tmp-test-dataset-index");
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
          DEEPSPEC_ENABLE_DATASET_SOURCE_CONTEXT: "true",
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
    const datasetRoot = makeTempDatasetRoot("tmp-test-dataset-index");
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
    const datasetRoot = makeTempDatasetRoot("tmp-test-dataset-index");
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
