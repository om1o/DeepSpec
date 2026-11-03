/// <reference types="node" />

import { createWebhookResponse } from "../server/billing.shared.js";

export const config = {
  api: {
    bodyParser: false,
  },
};

type VercelRequest = {
  body?: unknown;
  headers?: Record<string, string | string[] | undefined>;
  method?: string;
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
        message: "Use POST for billing provider webhooks.",
      },
    });
    return;
  }

  const rawBody = await readRawBody(request);
  const result = await createWebhookResponse(rawBody, request.headers ?? {}, process.env);
  response.status(result.status).json(result.body);
}

async function readRawBody(request: VercelRequest) {
  if (typeof request.body === "string") {
    return request.body;
  }

  if (Buffer.isBuffer(request.body)) {
    return request.body.toString("utf8");
  }

  if (isAsyncIterable(request)) {
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, "utf8"));
    }
    // Decode once: HTTP chunk boundaries can split a signed UTF-8 character.
    return Buffer.concat(chunks).toString("utf8");
  }

  return "";
}

function isAsyncIterable(value: unknown): value is AsyncIterable<Buffer | string> {
  return typeof value === "object"
    && value !== null
    && typeof (value as AsyncIterable<Buffer | string>)[Symbol.asyncIterator] === "function";
}
