import { AIServiceError, getAIErrorDetails, getAIErrorMessage, isAIRequestCanceled, runAI } from "./aiService";

vi.mock("./auth", () => ({ getAuthClient: async () => null }));

const input = { type: "text" as const, userMessage: "private question", systemPrompt: "private prompt" };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

it("distinguishes a browser fetch failure from a provider failure and supplies a safe reference", async () => {
  const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
  const fetchMock = vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("private transport detail"));
  const error = await runAI(input).catch((value) => value) as AIServiceError & { requestId: string };
  expect(error.code).toBe("connection_failed");
  expect(error.requestId).toMatch(uuid);
  expect(getAIErrorDetails(error.code).category).toBe("connection");
  expect(getAIErrorMessage(error)).toContain(error.requestId);
  expect(fetchMock).toHaveBeenCalledOnce();
  expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({ "X-DeepSpec-Request-Id": error.requestId });
  expect(JSON.stringify(warning.mock.calls)).not.toContain("private");
});

it("preserves a server-reported provider connection failure", async () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ error: { code: "network", message: "Provider connection failed" } }), { status: 502 }));
  const error = await runAI(input).catch((value) => value) as AIServiceError;
  expect(error.code).toBe("network");
  expect(getAIErrorDetails(error.code).category).toBe("provider_unavailable");
});

it.each([200, 502])("does not blame model output for a non-JSON HTTP %i response", async (status) => {
  const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("<html>private proxy error</html>", { status }));
  const error = await runAI(input).catch((value) => value) as AIServiceError;
  expect(error.code).toBe("service_response_error");
  expect(getAIErrorDetails(error.code).category).toBe("connection");
  expect(JSON.stringify(warning.mock.calls)).not.toContain("private");
});

function pendingResponseBody() {
  let signal: AbortSignal;
  let rejectBody: (error: unknown) => void;
  let started: () => void;
  const reading = new Promise<void>((resolve) => { started = resolve; });
  vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
    signal = init!.signal!;
    return {
      ok: true, status: 200,
      json: () => {
        started();
        return new Promise((_resolve, reject) => {
          rejectBody = reject;
          signal.addEventListener("abort", () => reject(new DOMException("Request aborted", "AbortError")), { once: true });
        });
      },
    } as Response;
  });
  return { reading, aborted: () => signal.aborted, stop: () => rejectBody(new DOMException("Test cleanup", "AbortError")) };
}

it("keeps the deadline active while reading the body after response headers arrive", async () => {
  vi.useFakeTimers();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const body = pendingResponseBody();
  const result = runAI(input).catch((error) => error);
  await body.reading;
  try {
    await vi.advanceTimersByTimeAsync(30_001);
    expect(body.aborted()).toBe(true);
    expect(await result).toMatchObject({ code: "request_timeout", requestId: expect.stringMatching(uuid) });
  } finally { body.stop(); await result; }
});

it("preserves caller cancellation while reading the response body", async () => {
  const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
  const body = pendingResponseBody();
  const controller = new AbortController();
  const result = runAI(input, { signal: controller.signal }).catch((error) => error);
  await body.reading;
  try {
    controller.abort();
    expect(body.aborted()).toBe(true);
    expect(isAIRequestCanceled(await result)).toBe(true);
    expect(warning).not.toHaveBeenCalled();
  } finally { body.stop(); await result; }
});

it("reports a body transport interruption as a connection error", async () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true, status: 200, json: async () => { throw new TypeError("private stream details"); } } as Response);
  await expect(runAI(input)).rejects.toMatchObject({ code: "connection_failed" });
});

it("clears the deadline on a successful response without extra requests", async () => {
  vi.useFakeTimers();
  const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ message: "Read the marking." })));
  await expect(runAI(input)).resolves.toBe("Read the marking.");
  expect(vi.getTimerCount()).toBe(0);
  expect(fetchMock).toHaveBeenCalledOnce();
});
