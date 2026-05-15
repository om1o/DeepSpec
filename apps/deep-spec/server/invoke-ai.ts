/**
 * Shared Gemini invocation for local Express (`server/index.ts`) and Vercel (`api/ai.ts`).
 * Env: GEMINI_API_KEY — never exposed to the browser.
 */

import { GoogleGenerativeAI } from "@google/generative-ai";

export type AiRequestBody = {
  type: "vision" | "text";
  imageBase64?: string;
  userMessage: string;
  systemPrompt: string;
  responseAsJson?: boolean;
};

export type AiHandlerResult = { status: number; json: Record<string, unknown> };

function visionModel(): string {
  return process.env.GEMINI_VISION_MODEL ?? "gemini-2.5-pro";
}

function textModel(): string {
  return process.env.GEMINI_TEXT_MODEL ?? "gemini-2.5-flash";
}

function stripBase64(data: string): { mimeType: string; data: string } {
  if (data.startsWith("data:")) {
    const comma = data.indexOf(",");
    if (comma !== -1 && data.slice(0, comma).includes("base64")) {
      const mimeType = data.slice(5, comma).split(";")[0] || "image/jpeg";
      return { mimeType, data: data.slice(comma + 1).replace(/\s+/g, "") };
    }
  }
  return { mimeType: "image/jpeg", data: data.replace(/\s+/g, "") };
}

function isTransient(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /429|503|UNAVAILABLE|overloaded|ECONNRESET|ETIMEDOUT|fetch failed|network/i.test(msg);
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

async function executeOnce(genAI: GoogleGenerativeAI, input: AiRequestBody): Promise<string> {
  const name = input.type === "vision" ? visionModel() : textModel();
  const generationConfig = {
    temperature: 0.4,
    ...(input.responseAsJson ? { responseMimeType: "application/json" as const } : {}),
  };

  const model = genAI.getGenerativeModel({
    model: name,
    systemInstruction: input.systemPrompt,
    generationConfig,
  });

  if (input.type === "vision") {
    if (!input.imageBase64) throw new Error("imageBase64 is required when type is vision");
    const { mimeType, data } = stripBase64(input.imageBase64);
    const res = await model.generateContent([
      { inlineData: { mimeType, data } },
      { text: input.userMessage || "Analyze this automotive part photo." },
    ]);
    return res.response.text();
  }

  const res = await model.generateContent(input.userMessage);
  return res.response.text();
}

async function executeWithRetry(genAI: GoogleGenerativeAI, input: AiRequestBody): Promise<string> {
  try {
    return await executeOnce(genAI, input);
  } catch (e) {
    if (!isTransient(e)) throw e;
    await sleep(1500);
    return executeOnce(genAI, input);
  }
}

export async function invokeAiPost(rawBody: unknown): Promise<AiHandlerResult> {
  const t0 = performance.now();
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    console.error("[invokeAiPost] missing GEMINI_API_KEY");
    return {
      status: 500,
      json: {
        error: {
          code: "config",
          message: "Server missing GEMINI_API_KEY. Set GEMINI_API_KEY in Vercel env or apps/deep-spec/.env for local.",
        },
      },
    };
  }

  const body = rawBody as Partial<AiRequestBody>;
  if (body.type !== "vision" && body.type !== "text") {
    return { status: 400, json: { error: { code: "bad_request", message: "type must be vision or text" } } };
  }
  if (typeof body.userMessage !== "string" || typeof body.systemPrompt !== "string") {
    return {
      status: 400,
      json: {
        error: {
          code: "bad_request",
          message: "userMessage and systemPrompt (strings) are required",
        },
      },
    };
  }

  const input: AiRequestBody = {
    type: body.type,
    imageBase64: body.imageBase64,
    userMessage: body.userMessage,
    systemPrompt: body.systemPrompt,
    responseAsJson: Boolean(body.responseAsJson),
  };

  const genAI = new GoogleGenerativeAI(apiKey);

  try {
    let text = await executeWithRetry(genAI, input);

    if (input.responseAsJson) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        text = await executeWithRetry(genAI, input);
        parsed = JSON.parse(text);
      }
      console.log(
        JSON.stringify({
          route: "api/ai",
          type: input.type,
          ok: true,
          ms: Math.round(performance.now() - t0),
          response: "json",
        }),
      );
      return { status: 200, json: { kind: "json", value: parsed } as Record<string, unknown> };
    }

    console.log(
      JSON.stringify({
        route: "api/ai",
        type: input.type,
        ok: true,
        ms: Math.round(performance.now() - t0),
        response: "text",
      }),
    );
    return { status: 200, json: { kind: "text", value: text } as Record<string, unknown> };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const rate = /429|resource.*exhaust|quota/i.test(msg);
    console.error(
      JSON.stringify({
        route: "api/ai",
        type: input.type,
        ok: false,
        ms: Math.round(performance.now() - t0),
        error: msg.slice(0, 500),
      }),
    );
    return {
      status: rate ? 429 : 500,
      json: {
        error: {
          code: rate ? "rate_limit" : "unknown",
          message: rate ? "Too many lookups right now. Try again in a few minutes." : msg,
        },
      },
    };
  }
}
