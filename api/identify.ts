/// <reference types="node" />

import { createIdentifyResponse, validateIdentifyRequest } from "../server/identify.shared.js";
import { consumeReservedScanCredit, reserveScanCredit } from "../server/billing.shared.js";
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
        message: "Use POST for AI identification.",
      },
    });
    return;
  }

  const headers = request.headers ?? {};

  const rateLimit = await enforceRateLimit("identify", headers, process.env);
  if (rateLimit.ok === false) {
    response.setHeader("Retry-After", String(rateLimit.retryAfterSeconds));
    response.status(rateLimit.status).json(rateLimit.body);
    return;
  }

  const guestPreview = isGuestPreviewRequest(headers, process.env);
  if (!guestPreview) {
    const session = await requireSession(headers, process.env);
    if (session.ok === false) {
      response.status(session.status).json(session.body);
      return;
    }
  }

  const invalid = validateIdentifyRequest(request.body, process.env);
  if (invalid) {
    response.status(invalid.status).json(invalid.body);
    return;
  }
  const reservation = guestPreview ? undefined : await reserveScanCredit(headers, process.env);
  if (reservation?.ok === false) {
    response.status(reservation.error.status).json(reservation.error.body);
    return;
  }

  const result = await createIdentifyResponse(request.body, process.env);
  if (reservation) await consumeReservedScanCredit(reservation, process.env, result.status === 200);
  response.status(result.status).json(result.body);
}
