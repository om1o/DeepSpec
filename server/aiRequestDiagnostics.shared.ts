import { randomUUID } from "node:crypto";
import { isAIRequestId } from "../src/lib/aiRequestId.js";

type Request = { headers?: Record<string, string | string[] | undefined>; method?: string; body?: unknown };
type Response = {
  status: (status: number) => Response;
  json: (body: unknown) => void;
  setHeader: (name: string, value: string) => void;
};

export function withAIRequestDiagnostics(route: "/api/chat" | "/api/identify", handler: (request: Request, response: Response) => Promise<void>) {
  return async (request: Request, response: Response) => {
    const supplied = request.headers?.["x-deepspec-request-id"] ?? request.headers?.["X-DeepSpec-Request-Id"];
    const requestId = isAIRequestId(supplied) ? supplied : randomUUID();
    const started = Date.now();
    response.setHeader("X-DeepSpec-Request-Id", requestId);
    // Keep logs independent of request/response bodies, credentials and user details.
    console.info("[DeepSpec Request]", { requestId, route, event: "received" });
    let status = 200;
    let completed = false;
    const tracked: Response = {
      status(value) { status = value; response.status(value); return tracked; },
      setHeader(name, value) { response.setHeader(name, value); },
      json(body) {
        completed = true;
        console.info("[DeepSpec Request]", { requestId, route, event: "responded", status, durationMs: Date.now() - started });
        response.json(body);
      },
    };
    try {
      await handler(request, tracked);
    } catch (error) {
      if (completed) throw error;
      tracked.status(500).json({ error: { code: "unexpected_error", message: "DeepSpec could not complete this request. Try again." } });
    }
  };
}
