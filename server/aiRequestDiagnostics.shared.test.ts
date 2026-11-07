import { withAIRequestDiagnostics } from "./aiRequestDiagnostics.shared";

const requestId = "a5a11bb3-c67c-4b5c-9b20-e21b16655b51";
const response = () => ({ status: vi.fn().mockReturnThis(), json: vi.fn(), setHeader: vi.fn() });
afterEach(() => vi.restoreAllMocks());

it("correlates a request and response without logging payloads or credentials", async () => {
  const log = vi.spyOn(console, "info").mockImplementation(() => {});
  const res = response();
  const handler = withAIRequestDiagnostics("/api/chat", async (_req, reply) => { reply.status(401).json({ error: { code: "invalid_session", message: "private response" } }); });
  await handler({ method: "POST", headers: { "x-deepspec-request-id": requestId, authorization: "private credential" }, body: { imageBase64: "private photo", userMessage: "private question" } }, res);
  expect(res.setHeader).toHaveBeenCalledWith("X-DeepSpec-Request-Id", requestId);
  expect(log).toHaveBeenNthCalledWith(1, "[DeepSpec Request]", { requestId, route: "/api/chat", event: "received" });
  expect(log).toHaveBeenNthCalledWith(2, "[DeepSpec Request]", { requestId, route: "/api/chat", event: "responded", status: 401, durationMs: expect.any(Number) });
  expect(JSON.stringify(log.mock.calls)).not.toContain("private");
  expect(res.json).toHaveBeenCalledWith({ error: { code: "invalid_session", message: "private response" } });
});

it.each([undefined, "private secret", [requestId], "a".repeat(500), requestId + "\nprivate injection"])("replaces an invalid correlation header", async (supplied) => {
  const log = vi.spyOn(console, "info").mockImplementation(() => {});
  const res = response();
  await withAIRequestDiagnostics("/api/identify", async (_req, reply) => { reply.status(200).json({ result: "private result" }); })({ headers: { "x-deepspec-request-id": supplied } }, res);
  const generated = res.setHeader.mock.calls[0][1];
  expect(generated).toMatch(/^[0-9a-f-]{36}$/);
  expect(generated).not.toBe(supplied);
  expect(JSON.stringify(log.mock.calls)).not.toContain("private");
});

it("returns a correlated generic error if an upstream gate throws", async () => {
  const log = vi.spyOn(console, "info").mockImplementation(() => {});
  const res = response();
  await withAIRequestDiagnostics("/api/chat", async () => { throw new Error("private backend error"); })({ headers: { "x-deepspec-request-id": requestId } }, res);
  expect(res.status).toHaveBeenCalledWith(500);
  expect(res.json).toHaveBeenCalledWith({ error: { code: "unexpected_error", message: "DeepSpec could not complete this request. Try again." } });
  expect(log).toHaveBeenLastCalledWith("[DeepSpec Request]", expect.objectContaining({ requestId, event: "responded", status: 500 }));
  expect(JSON.stringify(log.mock.calls)).not.toContain("private");
});
