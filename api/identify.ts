import { createIdentifyResponse } from "./identify.shared";
import { consumeReservedScanCredit, reserveScanCredit } from "./billing.shared";

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

  const reservation = await reserveScanCredit(request.headers ?? {}, process.env);
  if (!reservation.ok) {
    response.status(reservation.error.status).json(reservation.error.body);
    return;
  }

  const result = await createIdentifyResponse(request.body, process.env);
  if (result.status === 200) {
    await consumeReservedScanCredit(reservation, process.env);
  }
  response.status(result.status).json(result.body);
}
