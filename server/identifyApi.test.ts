import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import handler from "../api/identify";
import { consumeReservedScanCredit, reserveScanCredit } from "./billing.shared";
import { createIdentifyResponse, validateIdentifyRequest } from "./identify.shared";
import { enforceRateLimit } from "./rateLimit.shared";
import { requireSession } from "./requireSession.shared";

vi.mock("./billing.shared", () => ({
  consumeReservedScanCredit: vi.fn(),
  reserveScanCredit: vi.fn(),
}));
vi.mock("./identify.shared", () => ({
  createIdentifyResponse: vi.fn(),
  validateIdentifyRequest: vi.fn(),
}));
vi.mock("./rateLimit.shared", () => ({ enforceRateLimit: vi.fn() }));
vi.mock("./requireSession.shared", () => ({ requireSession: vi.fn() }));

const request = {
  method: "POST",
  headers: { authorization: "Bearer test-session" },
  body: { imageBase64: "data:image/jpeg;base64,aGVsbG8=" },
};
const reservation = {
  enforced: true as const,
  ok: true as const,
  reservationId: "paid-hold",
  userId: "verified-user",
};

function createResponse() {
  const response = {
    status: vi.fn(),
    json: vi.fn(),
    setHeader: vi.fn(),
  };
  response.status.mockReturnValue(response);
  return response;
}

describe("identify reservation finalization", () => {
  beforeEach(() => {
    vi.mocked(enforceRateLimit).mockResolvedValue({ ok: true });
    vi.mocked(requireSession).mockResolvedValue({ ok: true, userId: "verified-user" });
    vi.mocked(validateIdentifyRequest).mockReturnValue(null);
    vi.mocked(reserveScanCredit).mockResolvedValue(reservation);
    vi.mocked(consumeReservedScanCredit).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("finalizes a reservation as failed when identification throws", async () => {
    vi.mocked(createIdentifyResponse).mockRejectedValue(new Error("private provider detail"));
    const response = createResponse();

    await handler(request, response);

    expect(consumeReservedScanCredit).toHaveBeenCalledWith(reservation, process.env, false);
    expect(response.status).toHaveBeenCalledWith(500);
    expect(response.json).toHaveBeenCalledWith({
      error: {
        code: "unexpected_error",
        message: "DeepSpec could not complete this identification. Try again.",
      },
    });
    expect(JSON.stringify(response.json.mock.calls)).not.toContain("private provider detail");
  });

  it("authenticates before consuming a shared IP rate-limit slot", async () => {
    vi.mocked(requireSession).mockResolvedValueOnce({
      ok: false,
      status: 401,
      body: { error: { code: "missing_session", message: "Sign in to use DeepSpec." } },
    });
    const response = createResponse();

    await handler({ method: "POST", body: request.body }, response);

    expect(response.status).toHaveBeenCalledWith(401);
    expect(enforceRateLimit).not.toHaveBeenCalled();
    expect(reserveScanCredit).not.toHaveBeenCalled();
    expect(createIdentifyResponse).not.toHaveBeenCalled();
  });

  it("preserves the safe provider response when finalization throws", async () => {
    const providerFailure = {
      status: 502,
      body: {
        error: {
          code: "provider_error",
          message: "The AI provider could not complete this request.",
        },
      },
    };
    vi.mocked(createIdentifyResponse).mockResolvedValue(providerFailure);
    vi.mocked(consumeReservedScanCredit).mockRejectedValue(new Error("private database detail"));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const response = createResponse();

    await handler(request, response);

    expect(consumeReservedScanCredit).toHaveBeenCalledWith(reservation, process.env, false);
    expect(response.status).toHaveBeenCalledWith(providerFailure.status);
    expect(response.json).toHaveBeenCalledWith(providerFailure.body);
    expect(JSON.stringify(response.json.mock.calls)).not.toContain("private database detail");
  });

  it("finalizes before a response-write failure can exit the handler", async () => {
    vi.mocked(createIdentifyResponse).mockResolvedValue({
      status: 502,
      body: { error: { code: "provider_error", message: "Provider unavailable." } },
    });
    const responseFailure = new Error("response closed");
    const response = createResponse();
    response.status.mockImplementation(() => { throw responseFailure; });

    await expect(handler(request, response)).rejects.toBe(responseFailure);

    expect(consumeReservedScanCredit).toHaveBeenCalledWith(reservation, process.env, false);
    expect(vi.mocked(consumeReservedScanCredit).mock.invocationCallOrder[0])
      .toBeLessThan(response.status.mock.invocationCallOrder[0]);
  });
});
