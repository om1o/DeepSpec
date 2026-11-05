import { TextDecoder, TextEncoder } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAuthClient } from "./auth";
import { getAccountScope, setActiveAccount } from "../lib/accountScope";
import { requestVehicleReference, VEHICLE_REFERENCE_REQUEST_TIMEOUT_MS } from "./vehicleReference";
import { VEHICLE_REFERENCE_SOURCE_URL, type VehicleIdentityReference } from "../types/vehicleReference";

vi.mock("./auth", () => ({ getAuthClient: vi.fn() }));
const getClient = vi.mocked(getAuthClient);
const query = { vin: "1HGCM82633A000000", modelYear: 2003 };
const reference = (): VehicleIdentityReference => ({
  version: 1, id: "42a23634-e887-41c6-9109-c846d724387f", provider: "nhtsa-vpic", adapterVersion: "nhtsa-vpic-v1",
  retrievedAt: "2026-11-05T12:00:00.000Z", sourceUrl: VEHICLE_REFERENCE_SOURCE_URL,
  query, facts: { year: "2003", make: "SYNTHETIC" }, decode: { codes: ["0"], messages: ["Synthetic result."] },
});
const getSession = vi.fn();
const transport = vi.fn();
const response = (value: unknown) => new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }

beforeEach(() => {
  setActiveAccount("reference-owner");
  vi.stubGlobal("TextEncoder", TextEncoder); vi.stubGlobal("TextDecoder", TextDecoder); vi.stubGlobal("fetch", transport);
  getSession.mockReset().mockResolvedValue({ data: { session: { access_token: "synthetic-token", user: { id: "reference-owner", is_anonymous: false } } }, error: null });
  getClient.mockReset().mockResolvedValue({ auth: { getSession } } as unknown as Awaited<ReturnType<typeof getAuthClient>>);
  transport.mockReset().mockImplementation(async () => response({ reference: reference() }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("explicit vehicle reference request", () => {
  it("sends only normalized VIN/year to the same-origin authenticated POST", async () => {
    expect(await requestVehicleReference({ ...query, vin: query.vin.toLowerCase() })).toEqual(reference());
    expect(transport).toHaveBeenCalledOnce();
    const [url, init] = transport.mock.calls[0];
    expect(url).toBe("/api/vehicle-reference"); expect(url).not.toContain(query.vin);
    expect(JSON.parse(init.body)).toEqual(query);
    expect(init).toMatchObject({ method: "POST", cache: "no-store", credentials: "same-origin", redirect: "error", headers: { Authorization: "Bearer synthetic-token" } });
  });
  it("rejects expanded requests before authentication or transport", async () => {
    await expect(requestVehicleReference({ ...query, notes: "private" } as typeof query)).rejects.toThrow("17-character");
    expect(getClient).not.toHaveBeenCalled(); expect(transport).not.toHaveBeenCalled();
  });
  it.each([null, { access_token: "token", user: { id: "other" } }, { access_token: "token", user: { id: "reference-owner", is_anonymous: true } }, { access_token: "token" }])("rejects missing/foreign/anonymous sessions %#", async (session) => {
    getSession.mockResolvedValue({ data: { session }, error: null });
    await expect(requestVehicleReference(query)).rejects.toThrow("Sign in"); expect(transport).not.toHaveBeenCalled();
  });
  it("does not send a stale request after account changes during authentication", async () => {
    const pending = deferred<Awaited<ReturnType<typeof getAuthClient>>>(); getClient.mockReturnValue(pending.promise);
    const result = requestVehicleReference(query); const rejection = expect(result).rejects.toThrow("Account changed");
    setActiveAccount("other"); pending.resolve({ auth: { getSession } } as unknown as Awaited<ReturnType<typeof getAuthClient>>);
    await rejection; expect(transport).not.toHaveBeenCalled();
  });
  it("rejects delayed results after account changes", async () => {
    const pending = deferred<Response>(); transport.mockReturnValue(pending.promise);
    const result = requestVehicleReference(query); const rejection = expect(result).rejects.toThrow("Account changed");
    await vi.waitFor(() => expect(transport).toHaveBeenCalledOnce());
    const signal = transport.mock.calls[0][1].signal as AbortSignal;
    setActiveAccount("other"); pending.resolve(response({ reference: reference() })); await rejection;
    expect(signal.aborted).toBe(true);
  });
  it("rejects an explicitly stale scope before accessing authentication", async () => {
    const scope = getAccountScope(); setActiveAccount(null); setActiveAccount("reference-owner");
    await expect(requestVehicleReference(query, scope)).rejects.toThrow("Account changed"); expect(getClient).not.toHaveBeenCalled();
  });
  it.each([401, 403, 429, 400, 500])("returns a bounded actionable error for HTTP %s without echoing provider data or retrying", async (status) => {
    transport.mockResolvedValue(new Response("private-token-and-vin", { status }));
    const error = await requestVehicleReference(query).catch((value: Error) => value);
    expect(error).toBeInstanceOf(Error); expect((error as Error).message).not.toContain("private"); expect(transport).toHaveBeenCalledOnce();
  });
  it.each([
    { ...reference(), query: { ...query, vin: "1HGCM82633A000001" } },
    { ...reference(), query: { vin: query.vin } },
    { ...reference(), sourceUrl: "https://evil.test/" },
  ])("rejects a mismatched or malformed source response %#", async (value) => {
    transport.mockResolvedValue(response({ reference: value }));
    await expect(requestVehicleReference(query)).rejects.toThrow("unavailable");
  });
  it("preserves provider warnings as evidence without treating them as HTTP failure", async () => {
    const value = reference(); value.decode = { codes: ["1", "14"], messages: ["Synthetic VIN warning."] };
    transport.mockResolvedValue(response({ reference: value }));
    expect(await requestVehicleReference(query)).toEqual(value);
  });
  it.each(["not-json", "x".repeat(32 * 1024 + 1)])("rejects malformed or oversized bodies %#", async (body) => {
    transport.mockResolvedValue(new Response(body)); await expect(requestVehicleReference(query)).rejects.toThrow("unavailable");
  });
  it("sanitizes thrown transport errors", async () => {
    transport.mockRejectedValue(new Error("private token secret"));
    await expect(requestVehicleReference(query)).rejects.toThrow("Vehicle lookup is unavailable");
  });
  it("covers a stalled authentication wait with the total deadline and never sends afterward", async () => {
    vi.useFakeTimers(); const pending = deferred<Awaited<ReturnType<typeof getAuthClient>>>(); getClient.mockReturnValue(pending.promise);
    const result = requestVehicleReference(query); const rejection = expect(result).rejects.toThrow("unavailable");
    await vi.advanceTimersByTimeAsync(VEHICLE_REFERENCE_REQUEST_TIMEOUT_MS); await rejection;
    pending.resolve({ auth: { getSession } } as unknown as Awaited<ReturnType<typeof getAuthClient>>);
    await Promise.resolve(); await Promise.resolve(); expect(transport).not.toHaveBeenCalled();
  });
});
