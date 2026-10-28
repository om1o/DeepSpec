/// <reference types="node" />

import { createChatResponse, isChatEnabled } from "../server/chat.shared.js";
import { enforceRateLimit } from "../server/rateLimit.shared.js";
import { requireSession } from "../server/requireSession.shared.js";
import { isGuestPreviewRequest } from "../server/guestPreview.shared.js";

type VercelRequest = {
  headers?: Record<string, string | string[] | undefined>;
  method?: string;
  body?: unknown;
};

type VercelResponse = {
  status: (statusCode: number) => VercelResponse;
  json: (body: unknown) => void;
  setHeader: (name: string, value: string) => void;
};

export default async function handler(request: VercelRequest, response: VercelResponse) {
  response.setHeader("Cache-Control", "no-store");

  if (request.method !== "POST") {
    response.status(405).json({
      error: {
        code: "method_not_allowed",
        message: "Use POST for AI follow-up chat.",
      },
    });
    return;
  }

  const headers = request.headers ?? {};
  const guestPreview = isGuestPreviewRequest(headers, process.env);
  const chatEnv = guestPreview ? { ...process.env, DEEPSPEC_ENABLE_CHAT: "true" } : process.env;
  if (!isChatEnabled(chatEnv)) {
    const result = await createChatResponse(undefined, chatEnv);
    response.status(result.status).json(result.body);
    return;
  }

  const rateLimit = await enforceRateLimit("chat", headers, process.env);
  if (rateLimit.ok === false) {
    response.setHeader("Retry-After", String(rateLimit.retryAfterSeconds));
    response.status(rateLimit.status).json(rateLimit.body);
    return;
  }

  if (!guestPreview) {
    const session = await requireSession(headers, process.env);
    if (session.ok === false) {
      response.status(session.status).json(session.body);
      return;
    }
  }

  const result = await createChatResponse(request.body, chatEnv);
  response.status(result.status).json(result.body);
}
