import { createChatResponse } from "./chat.shared";
import { enforceRateLimit } from "./rateLimit.shared";
import { requireSession } from "./requireSession.shared";

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

  const rateLimit = await enforceRateLimit("chat", headers, process.env);
  if (!rateLimit.ok) {
    response.setHeader("Retry-After", String(rateLimit.retryAfterSeconds));
    response.status(rateLimit.status).json(rateLimit.body);
    return;
  }

  const session = await requireSession(headers, process.env);
  if (!session.ok) {
    response.status(session.status).json(session.body);
    return;
  }

  const result = await createChatResponse(request.body, process.env);
  response.status(result.status).json(result.body);
}
