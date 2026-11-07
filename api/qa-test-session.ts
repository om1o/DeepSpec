/// <reference types="node" />

import { createQaTestSessionResponse, type QaTestSessionRequest } from "../server/qaTestSession.shared.js";
import { QA_TEST_COOKIE_CLEAR } from "../server/qaTestGate.shared.js";

type Response = {
  status: (code: number) => Response;
  json: (body: unknown) => void;
  setHeader: (name: string, value: string) => void;
};

export default async function handler(request: QaTestSessionRequest, response: Response) {
  response.setHeader("Cache-Control", "no-store");
  const result = await createQaTestSessionResponse(request, process.env);
  if (request.method === "DELETE" && result.status === 200 && result.body.cleaned === true) response.setHeader("Set-Cookie", QA_TEST_COOKIE_CLEAR);
  response.status(result.status).json(result.body);
}
