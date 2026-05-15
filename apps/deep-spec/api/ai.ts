/**
 * Vercel Serverless route — mirrors local Express POST /api/ai.
 * Set GEMINI_API_KEY in Vercel project → Environment Variables.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { invokeAiPost } from "../server/invoke-ai";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: { code: "method_not_allowed", message: "Use POST." } });
  }

  const out = await invokeAiPost(req.body);
  return res.status(out.status).json(out.json);
}
