/**
 * Local dev API — Gemini runs only here. Browser uses /api via Vite proxy.
 * Prod / previews: identical handler in ../api/ai.ts (Vercel serverless).
 */

import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { invokeAiPost } from "./invoke-ai";

export type { AiRequestBody } from "./invoke-ai";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "..", ".env") });

const PORT = Number(process.env.DEEP_SPEC_API_PORT ?? 8788);

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
app.use(express.json({ limit: "8mb" }));

app.use((req, res, next) => {
  const rid = randomUUID();
  (req as express.Request & { requestId?: string }).requestId = rid;
  res.setHeader("x-request-id", rid);
  const t0 = performance.now();
  res.on("finish", () => {
    if (req.path.startsWith("/api/")) {
      console.log(
        JSON.stringify({
          severity: "info",
          topic: "http_access",
          requestId: rid,
          method: req.method,
          path: req.path,
          status: res.statusCode,
          ms: Math.round(performance.now() - t0),
        }),
      );
    }
  });
  next();
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "deep-spec-api" });
});

app.post("/api/ai", async (req, res) => {
  const out = await invokeAiPost(req.body);
  res.status(out.status).json(out.json);
});

app.listen(PORT, "127.0.0.1", () => {
  console.log(`[deep-spec api] http://127.0.0.1:${PORT} (Gemini key from server env only)`);
  console.log(`[deep-spec api] Hint: npm run web starts this + Vite together.`);
});
