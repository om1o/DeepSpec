/**
 * Gemini runs only here — the browser never sees GEMINI_API_KEY.
 * Env: GEMINI_API_KEY (required), optional GEMINI_VISION_MODEL / GEMINI_TEXT_MODEL
 */

import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import { GoogleGenerativeAI } from "@google/generative-ai";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "..", ".env") });

const PORT = Number(process.env.DEEP_SPEC_API_PORT ?? 8788);
const VISION_MODEL = process.env.GEMINI_VISION_MODEL ?? "gemini-2.5-pro";
const TEXT_MODEL = process.env.GEMINI_TEXT_MODEL ?? "gemini-2.5-flash";

export type AiRequestBody = {
  type: "vision" | "text";
  imageBase64?: string;
  userMessage: string;
  systemPrompt: string;
  responseAsJson?: boolean;
};

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
  const name = input.type === "vision" ? VISION_MODEL : TEXT_MODEL;
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

const app = express();
app.use(
  cors({
    origin(origin, cb) {
      if (!origin) return cb(null, true);
      if (/^https?:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)) return cb(null, true);
      cb(null, false);
    },
  }),
);
app.use(express.json({ limit: "22mb" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "deep-spec-api" });
});

app.post("/api/ai", async (req, res) => {
  const t0 = performance.now();
  const body = req.body as Partial<AiRequestBody>;
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    console.error("[api/ai] missing GEMINI_API_KEY");
    return res.status(500).json({
      error: {
        code: "config",
        message: "Server missing GEMINI_API_KEY. Create apps/deep-spec/.env (see .env.example).",
      },
    });
  }

  if (body.type !== "vision" && body.type !== "text") {
    return res.status(400).json({ error: { code: "bad_request", message: "type must be vision or text" } });
  }
  if (typeof body.userMessage !== "string" || typeof body.systemPrompt !== "string") {
    return res
      .status(400)
      .json({ error: { code: "bad_request", message: "userMessage and systemPrompt (strings) are required" } });
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
      return res.json({ kind: "json", value: parsed });
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
    return res.json({ kind: "text", value: text });
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
    return res.status(rate ? 429 : 500).json({
      error: {
        code: rate ? "rate_limit" : "unknown",
        message: rate ? "Too many lookups right now. Try again in a few minutes." : msg,
      },
    });
  }
});

app.listen(PORT, "127.0.0.1", () => {
  console.log(`[deep-spec api] http://127.0.0.1:${PORT} (Gemini key from server env only)`);
});
