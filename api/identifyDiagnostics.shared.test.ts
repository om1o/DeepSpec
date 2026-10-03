import { observeIdentification } from "../server/identifyDiagnostics.shared";
import { createIdentifyResponse } from "../server/identify.shared";

describe("identify diagnostics", () => {
  afterEach(() => vi.restoreAllMocks());

  it("is off unless explicitly enabled", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    const result = { status: 200, body: { result: "private" } };
    expect(await observeIdentification(async () => result, {})).toBe(result);
    expect(log).not.toHaveBeenCalled();
  });

  it("records a real synthetic configuration failure without request or response content", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    const response = await createIdentifyResponse({ imageBase64: "data:image/png;base64,aGVsbG8=" }, {
      DEEPSPEC_DIAGNOSTICS: "1", VERCEL_GIT_COMMIT_SHA: "a".repeat(40),
    });
    expect(response.status).toBe(500);
    expect(log).toHaveBeenCalledTimes(1);
    const event = JSON.parse(log.mock.calls[0][0].slice("[DeepSpec diagnostics] ".length));
    expect(event).toEqual({
      schema: 1, eventId: expect.any(String), occurredAt: expect.any(String),
      release: "a".repeat(40), stage: "identify", code: "not_configured", status: 500,
      durationMs: expect.any(Number),
    });
    expect(event.durationMs).toBeGreaterThanOrEqual(0);
    expect(log.mock.calls[0][0]).not.toContain("aGVsbG8");
  });

  it("drops unknown error codes, release text and all additional fields", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    const secret = "Bearer private-token https://private.example/photo?token=secret";
    const response = { status: 502, body: { error: { code: secret, message: secret }, photo: secret, email: secret } };
    expect(await observeIdentification(async () => response, {
      DEEPSPEC_DIAGNOSTICS: "1", VERCEL_GIT_COMMIT_SHA: secret,
    })).toBe(response);
    expect(log.mock.calls[0][0]).not.toContain(secret);
    expect(log.mock.calls[0][0]).toContain('"code":"other_error"');
    expect(log.mock.calls[0][0]).toContain('"release":"unknown"');
  });

  it("preserves unexpected exceptions without logging their messages", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    const error = new Error("private-photo-token");
    await expect(observeIdentification(async () => { throw error; }, { DEEPSPEC_DIAGNOSTICS: "1" })).rejects.toBe(error);
    expect(log.mock.calls[0][0]).toContain('"code":"unexpected_error"');
    expect(log.mock.calls[0][0]).not.toContain(error.message);
  });

  it("does not retry work or change results when the log sink fails", async () => {
    vi.spyOn(console, "info").mockImplementation(() => { throw new Error("sink failed"); });
    const result = { status: 200, body: { result: "private" } };
    const run = vi.fn().mockResolvedValue(result);
    expect(await observeIdentification(run, { DEEPSPEC_DIAGNOSTICS: "1" })).toBe(result);
    expect(run).toHaveBeenCalledTimes(1);
    const error = new Error("original");
    await expect(observeIdentification(async () => { throw error; }, { DEEPSPEC_DIAGNOSTICS: "1" })).rejects.toBe(error);
  });
});
