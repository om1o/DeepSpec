// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { consumeReservedScanCredit, createAccountEntitlementResponse, reserveScanCredit } from "./billing.shared";
import { enforceRateLimit } from "./rateLimit.shared";

const url = "https://project.supabase.co";
const opaqueKey = "sb_secret_test";
const legacyKey = "eyJhbGciOiJIUzI1NiJ9.legacy.signature";

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe.each([opaqueKey, legacyKey])("admin consumers with %s", (key) => {
  const env = { SUPABASE_URL: url, SUPABASE_SECRET_KEY: key, NODE_ENV: "production" };

  it("verifies each caller and scopes entitlement/credit requests to that caller", async () => {
    const requests: { url: URL; headers: Headers; body: Record<string, unknown> | null }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = {
        url: new URL(String(input)), headers: new Headers(init?.headers),
        body: init?.body ? JSON.parse(String(init.body)) : null,
      };
      requests.push(request);
      expect(request.url.origin).toBe(url);
      expect(request.headers.get("apikey")).toBe(key);
      if (request.url.pathname === "/auth/v1/user") {
        const id = request.headers.get("authorization") === "Bearer owner-jwt" ? "owner" : "other";
        return Response.json({ id, email_confirmed_at: "2026-10-11T00:00:00Z", is_anonymous: false });
      }
      expect(request.headers.get("authorization")).toBe(key === opaqueKey ? null : `Bearer ${key}`);
      if (request.url.pathname === "/rest/v1/billing_entitlements") {
        return Response.json([{ plan_id: "scan_pack", status: "active", scan_allowance: 20, scans_used: 1 }]);
      }
      if (request.url.pathname === "/rest/v1/rpc/reserve_scan_credit") {
        return Response.json({ ok: true, reservation_id: `reservation-${request.body?.p_user_id}` });
      }
      return Response.json(true);
    }));

    for (const id of ["owner", "other"]) {
      const headers = { authorization: `Bearer ${id}-jwt` };
      expect(await createAccountEntitlementResponse(headers, env)).toMatchObject({ status: 200, body: { entitlement: { status: "active" } } });
      const reservation = await reserveScanCredit(headers, env);
      expect(reservation).toMatchObject({ ok: true, userId: id, reservationId: `reservation-${id}` });
      await consumeReservedScanCredit(reservation, env);
    }
    expect(await enforceRateLimit("identify", { "x-forwarded-for": "192.0.2.1" }, env)).toEqual({ ok: true });

    const forPath = (path: string) => requests.filter((r) => r.url.pathname === path);
    expect(forPath("/auth/v1/user").map((r) => r.headers.get("authorization")))
      .toEqual(["Bearer owner-jwt", "Bearer owner-jwt", "Bearer other-jwt", "Bearer other-jwt"]);
    expect(forPath("/rest/v1/billing_entitlements").map((r) => r.url.searchParams.get("user_id")))
      .toEqual(["eq.owner", "eq.other"]);
    expect(forPath("/rest/v1/rpc/reserve_scan_credit").map((r) => r.body)).toEqual([
      { p_user_id: "owner", p_free_eligible: true }, { p_user_id: "other", p_free_eligible: true },
    ]);
    expect(forPath("/rest/v1/rpc/finalize_scan_credit").map((r) => r.body)).toEqual([
      { p_user_id: "owner", p_reservation_id: "reservation-owner", p_succeeded: true },
      { p_user_id: "other", p_reservation_id: "reservation-other", p_succeeded: true },
    ]);
    expect(forPath("/rest/v1/rpc/check_rate_limit")).toHaveLength(2);
  });

  it("does not turn a rejected user JWT into an administrative entitlement or scan", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(new URL(String(input)).pathname).toBe("/auth/v1/user");
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer invalid-user-jwt");
      return Response.json({ message: "Invalid JWT" }, { status: 401 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const headers = { authorization: "Bearer invalid-user-jwt" };
    expect(await createAccountEntitlementResponse(headers, env)).toMatchObject({ status: 401, body: { error: { code: "invalid_session" } } });
    expect(await reserveScanCredit(headers, env)).toMatchObject({ ok: false, error: { status: 401 } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("fails closed when the admin key is rejected by the rate-limit service", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchMock = vi.fn(async () => Response.json({ message: "Invalid API key" }, { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await enforceRateLimit("identify", { "x-forwarded-for": "192.0.2.1" }, env))
      .toMatchObject({ ok: false, status: 503, body: { error: { code: "rate_limit_unavailable" } } });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
