import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import handler, { handleVehicleReference, VEHICLE_REFERENCE_GATE_TIMEOUT_MS } from "../api/vehicle-reference";
import { createVehicleReferenceResponse } from "./vehicleReference.shared";
import { enforceRateLimit } from "./rateLimit.shared";
import { requireSession } from "./requireSession.shared";

vi.mock("./vehicleReference.shared", async (original) => ({ ...await original<typeof import("./vehicleReference.shared")>(), createVehicleReferenceResponse: vi.fn() }));
vi.mock("./rateLimit.shared", () => ({ enforceRateLimit: vi.fn() }));
vi.mock("./requireSession.shared", () => ({ requireSession: vi.fn() }));

const VIN = "1HGCM82633A004352";
const request = { method: "POST", headers: { authorization: "Bearer synthetic-session", "x-forwarded-for": "203.0.113.9" }, body: { vin: VIN, modelYear: 2003 } };
const providerFailure = { status: 502, body: { error: { code: "vehicle_reference_unavailable", message: "NHTSA vehicle information could not be read." } } };
function createResponse() {
  const response = { status: vi.fn(), json: vi.fn(), setHeader: vi.fn() };
  response.status.mockReturnValue(response);
  return response;
}

beforeEach(() => {
  vi.mocked(requireSession).mockResolvedValue({ ok: true, userId: "verified-user" });
  vi.mocked(enforceRateLimit).mockResolvedValue({ ok: true });
  vi.mocked(createVehicleReferenceResponse).mockResolvedValue(providerFailure);
});
afterEach(() => { vi.resetAllMocks(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe("vehicle reference API authorization and privacy", () => {
  it.each([undefined, "GET", "PUT", "OPTIONS"])("rejects %s before auth, quota or upstream", async (method) => {
    const response = createResponse();
    await handler({ ...request, method }, response);
    expect(response.status).toHaveBeenCalledWith(405);
    expect(response.setHeader).toHaveBeenCalledWith("Cache-Control", "no-store");
    expect(response.setHeader).toHaveBeenCalledWith("Allow", "POST");
    expect(requireSession).not.toHaveBeenCalled();
    expect(enforceRateLimit).not.toHaveBeenCalled();
    expect(createVehicleReferenceResponse).not.toHaveBeenCalled();
  });

  it.each([
    { status: 401, body: { error: { code: "missing_session", message: "Sign in to use DeepSpec." } } },
    { status: 401, body: { error: { code: "invalid_session", message: "DeepSpec could not verify your session." } } },
    { status: 503, body: { error: { code: "session_unavailable", message: "DeepSpec cannot verify your session right now." } } },
  ])("rejects an unverified session before quota or provider: $body.error.code", async (failure) => {
    vi.mocked(requireSession).mockResolvedValue({ ok: false, ...failure });
    const response = createResponse();
    await handler({ method: "POST", body: request.body }, response);
    expect(requireSession).toHaveBeenCalledWith({}, process.env);
    expect(response.status).toHaveBeenCalledWith(failure.status);
    expect(response.json).toHaveBeenCalledWith(failure.body);
    expect(enforceRateLimit).not.toHaveBeenCalled();
    expect(createVehicleReferenceResponse).not.toHaveBeenCalled();
  });

  it("does not start quota or provider while session verification is pending", async () => {
    let release!: (decision: Awaited<ReturnType<typeof requireSession>>) => void;
    vi.mocked(requireSession).mockImplementation(() => new Promise((resolve) => { release = resolve; }));
    const response = createResponse();
    const pending = handler(request, response);
    await Promise.resolve();
    expect(enforceRateLimit).not.toHaveBeenCalled();
    expect(createVehicleReferenceResponse).not.toHaveBeenCalled();
    release({ ok: true, userId: "verified-user" });
    await pending;
    expect(enforceRateLimit).toHaveBeenCalledWith("vehicle-reference", request.headers, process.env);
    expect(vi.mocked(requireSession).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(enforceRateLimit).mock.invocationCallOrder[0]);
    expect(vi.mocked(enforceRateLimit).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(createVehicleReferenceResponse).mock.invocationCallOrder[0]);
  });

  it("validates the body after authentication and rejects unknown private fields without consuming quota", async () => {
    const response = createResponse();
    await handler({ ...request, body: { ...request.body, customerName: "private canary" } }, response);
    expect(requireSession).toHaveBeenCalledTimes(1);
    expect(response.status).toHaveBeenCalledWith(400);
    expect(enforceRateLimit).not.toHaveBeenCalled();
    expect(createVehicleReferenceResponse).not.toHaveBeenCalled();
    expect(JSON.stringify(response.json.mock.calls)).not.toContain("private canary");
    expect(JSON.stringify(response.json.mock.calls)).not.toContain(VIN);
  });

  it.each([429, 503] as const)("returns quota denial %s and Retry-After without upstream", async (status) => {
    const failure = { ok: false as const, status, retryAfterSeconds: 60, body: { error: { code: "rate_limited", message: "Try again later." } } };
    vi.mocked(enforceRateLimit).mockResolvedValue(failure);
    const response = createResponse();
    await handler(request, response);
    expect(response.status).toHaveBeenCalledWith(status);
    expect(response.setHeader).toHaveBeenCalledWith("Retry-After", "60");
    expect(response.json).toHaveBeenCalledWith(failure.body);
    expect(createVehicleReferenceResponse).not.toHaveBeenCalled();
  });

  it("passes the shared response and never passes auth headers or environment to the NHTSA adapter", async () => {
    const response = createResponse();
    await handler(request, response);
    expect(createVehicleReferenceResponse).toHaveBeenCalledExactlyOnceWith(request.body);
    expect(response.status).toHaveBeenCalledWith(providerFailure.status);
    expect(response.json).toHaveBeenCalledWith(providerFailure.body);
    expect(response.setHeader).toHaveBeenCalledWith("Cache-Control", "no-store");
  });

  it("uses an explicit environment for Vite parity without altering process.env", async () => {
    const environment = { NODE_ENV: "development", SUPABASE_URL: "https://synthetic.invalid" };
    const previous = process.env.SUPABASE_URL;
    await handleVehicleReference(request, createResponse(), environment);
    expect(requireSession).toHaveBeenCalledWith(request.headers, environment);
    expect(enforceRateLimit).toHaveBeenCalledWith("vehicle-reference", request.headers, environment);
    expect(process.env.SUPABASE_URL).toBe(previous);
  });

  it.each(["auth", "quota", "provider"])("sanitizes thrown %s errors without logging or echoing private data", async (stage) => {
    const failure = new Error(`private ${VIN} token=synthetic-secret`);
    if (stage === "auth") vi.mocked(requireSession).mockRejectedValue(failure);
    if (stage === "quota") vi.mocked(enforceRateLimit).mockRejectedValue(failure);
    if (stage === "provider") vi.mocked(createVehicleReferenceResponse).mockRejectedValue(failure);
    const logs = [vi.spyOn(console, "log"), vi.spyOn(console, "warn"), vi.spyOn(console, "error")];
    const response = createResponse();
    await handler(request, response);
    expect(response.status).toHaveBeenCalledWith(stage === "provider" ? 502 : 503);
    expect(JSON.stringify(response.json.mock.calls)).not.toContain(VIN);
    expect(JSON.stringify(response.json.mock.calls)).not.toContain("synthetic-secret");
    for (const log of logs) expect(log).not.toHaveBeenCalled();
    if (stage !== "provider") expect(createVehicleReferenceResponse).not.toHaveBeenCalled();
    if (stage === "auth") expect(enforceRateLimit).not.toHaveBeenCalled();
  });

  it.each(["auth", "quota"])("bounds hanging %s verification and ignores its later success", async (stage) => {
    vi.useFakeTimers();
    let release!: () => void;
    if (stage === "auth") vi.mocked(requireSession).mockImplementation(() => new Promise((resolve) => { release = () => resolve({ ok: true, userId: "verified-user" }); }));
    else vi.mocked(enforceRateLimit).mockImplementation(() => new Promise((resolve) => { release = () => resolve({ ok: true }); }));
    const response = createResponse();
    const pending = handler(request, response);
    await vi.advanceTimersByTimeAsync(VEHICLE_REFERENCE_GATE_TIMEOUT_MS);
    await pending;
    expect(response.status).toHaveBeenCalledWith(503);
    release();
    await Promise.resolve();
    expect(createVehicleReferenceResponse).not.toHaveBeenCalled();
    if (stage === "auth") expect(enforceRateLimit).not.toHaveBeenCalled();
    expect(response.json).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
