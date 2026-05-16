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
dotenv.config({ path: path.join(__dirname, "..", "..", "..", ".env") });
dotenv.config({ path: path.join(__dirname, "..", ".env"), override: true });

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

app.get("/", (_req, res) => {
  res.type("html").send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>DeepSpec API</title>
    <style>
      :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, sans-serif; }
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #0a0a0a; color: #f5f5f5; }
      main { width: min(520px, calc(100vw - 32px)); border: 1px solid #262626; border-radius: 18px; background: #171717; padding: 28px; }
      h1 { margin: 0 0 8px; font-size: 28px; letter-spacing: 0; }
      p { color: #a1a1aa; line-height: 1.5; }
      a { color: #60a5fa; font-weight: 700; }
      code { color: #d4d4d8; }
      .ok { color: #10b981; font-weight: 800; text-transform: uppercase; font-size: 12px; letter-spacing: .08em; }
    </style>
  </head>
  <body>
    <main>
      <div class="ok">API online</div>
      <h1>DeepSpec API</h1>
      <p>This is the local AI proxy on <code>127.0.0.1:${PORT}</code>. It is not the app UI.</p>
      <p>Open the mobile app preview at <a href="http://localhost:19006">http://localhost:19006</a>.</p>
      <p>Health check: <a href="/health">/health</a>. AI route: <code>POST /api/ai</code>.</p>
    </main>
  </body>
</html>`);
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
