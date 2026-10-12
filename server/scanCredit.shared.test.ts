import { afterEach, describe, expect, it, vi } from "vitest";
import { consumeReservedScanCredit, createAccountEntitlementResponse, reserveScanCredit } from "./billing.shared";

const supabaseMock = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("@supabase/supabase-js", () => supabaseMock);
const ENV = { DEEPSPEC_ENFORCE_SCAN_CREDITS: "true", SUPABASE_SERVICE_ROLE_KEY: "service-role", SUPABASE_URL: "https://example.supabase.co" };
const HEADERS = { authorization: "Bearer token-1" };

function setup(result: unknown = { ok: true, reservation_id: null }) {
  const rpc = vi.fn(async () => ({ data: result, error: null as unknown }));
  const getUser = vi.fn(async () => ({ data: { user: { id: "user-1", is_anonymous: false, email_confirmed_at: "2026-10-01" } as Record<string, unknown> | null }, error: null }));
  supabaseMock.createClient.mockReturnValue({ auth: { getUser }, rpc });
  return { rpc, getUser };
}

describe("server scan credit gate", () => {
  afterEach(() => supabaseMock.createClient.mockReset());

  it("passes only the server-verified account to the atomic reservation", async () => {
    const { rpc } = setup();
    await expect(reserveScanCredit(HEADERS, ENV)).resolves.toEqual({ ok: true, enforced: true, userId: "user-1", reservationId: null });
    expect(rpc).toHaveBeenCalledWith("reserve_scan_credit", { p_user_id: "user-1", p_free_eligible: true });
  });

  it.each(["anonymous", "unconfirmed"])("does not grant a fresh free allowance to an %s account", async (kind) => {
    const { getUser, rpc } = setup({ ok: false });
    getUser.mockResolvedValue({ data: { user: { id: "user-1", is_anonymous: kind === "anonymous" } }, error: null });
    await expect(reserveScanCredit(HEADERS, ENV)).resolves.toMatchObject({ ok: false, error: { status: 402 } });
    expect(rpc).toHaveBeenCalledWith("reserve_scan_credit", { p_user_id: "user-1", p_free_eligible: false });
  });

  it("returns the limit response when the database rejects the sixth scan", async () => {
    setup({ ok: false });
    await expect(reserveScanCredit(HEADERS, ENV)).resolves.toMatchObject({ ok: false, error: { status: 402, body: { error: { code: "scan_limit_reached" } } } });
  });

  it("finalizes successful paid scans and releases failed holds", async () => {
    const { rpc } = setup({ ok: true, reservation_id: "hold-1" });
    const reservation = await reserveScanCredit(HEADERS, ENV);
    await consumeReservedScanCredit(reservation, ENV);
    expect(rpc).toHaveBeenLastCalledWith("finalize_scan_credit", { p_user_id: "user-1", p_reservation_id: "hold-1", p_succeeded: true });
    await consumeReservedScanCredit(reservation, ENV, false);
    expect(rpc).toHaveBeenLastCalledWith("finalize_scan_credit", { p_user_id: "user-1", p_reservation_id: "hold-1", p_succeeded: false });
  });

  it("does not finalize or refund free provider attempts", async () => {
    const { rpc } = setup();
    const reservation = await reserveScanCredit(HEADERS, ENV);
    await consumeReservedScanCredit(reservation, ENV, false);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  const qaEnv = () => ({ ...ENV, NODE_ENV: "production", VERCEL_ENV: "preview", DEEPSPEC_ENFORCE_SCAN_CREDITS: "false", DEEPSPEC_QA_SCAN_USER_ID: "user-1", DEEPSPEC_QA_SCAN_EXPIRES_AT: new Date(Date.now() + 3_600_000).toISOString() });
  const qaUser = { id: "user-1", email_confirmed_at: "2026-10-01", app_metadata: { deepspec_scan_qa: true } };

  it("allows two eight-case runs and failed attempts without changing free or paid counters", async () => {
    const { getUser, rpc } = setup({ ok: false }); // The same user's normal credits are exhausted.
    getUser.mockResolvedValue({ data: { user: qaUser }, error: null });
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const reservation = await reserveScanCredit(HEADERS, qaEnv());
      expect(reservation).toEqual({ ok: true, enforced: false });
      await consumeReservedScanCredit(reservation, qaEnv(), attempt % 2 === 0);
    }
    expect(getUser).toHaveBeenCalledTimes(20);
    expect(getUser).toHaveBeenCalledWith("token-1");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("keeps the free limit for ordinary customers even with the QA switch configured", async () => {
    const { rpc } = setup({ ok: false });
    await expect(reserveScanCredit({ ...HEADERS, "x-deepspec-qa": "true" }, qaEnv())).resolves.toMatchObject({ ok: false, error: { status: 402 } });
    expect(rpc).toHaveBeenCalledWith("reserve_scan_credit", { p_user_id: "user-1", p_free_eligible: true });
  });

  it("keeps paid holds and finalization for ordinary customers on a QA preview", async () => {
    const { rpc } = setup({ ok: true, reservation_id: "paid-hold" });
    const reservation = await reserveScanCredit(HEADERS, qaEnv());
    await consumeReservedScanCredit(reservation, qaEnv(), true);
    expect(rpc).toHaveBeenLastCalledWith("finalize_scan_credit", { p_user_id: "user-1", p_reservation_id: "paid-hold", p_succeeded: true });
  });

  it("reinstates accounting in production, after expiry, and after admin revocation", async () => {
    const { getUser, rpc } = setup({ ok: false });
    getUser.mockResolvedValue({ data: { user: qaUser }, error: null });
    for (const override of [
      { VERCEL_ENV: "production" },
      { VERCEL_ENV: undefined },
      { DEEPSPEC_QA_SCAN_EXPIRES_AT: new Date(Date.now() - 1).toISOString() },
    ]) {
      await expect(reserveScanCredit(HEADERS, { ...qaEnv(), ...override })).resolves.toMatchObject({ ok: false, error: { status: 402 } });
    }
    getUser.mockResolvedValue({ data: { user: { ...qaUser, app_metadata: {} } }, error: null });
    await expect(reserveScanCredit(HEADERS, qaEnv())).resolves.toMatchObject({ ok: false, error: { status: 402 } });
    expect(rpc).toHaveBeenCalledTimes(4);
  });

  it("requires a valid authenticated session even when all QA flags are set", async () => {
    const { rpc, getUser } = setup();
    await expect(reserveScanCredit({}, qaEnv())).resolves.toMatchObject({ ok: false, error: { status: 401 } });
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    await expect(reserveScanCredit(HEADERS, qaEnv())).resolves.toMatchObject({ ok: false, error: { status: 401 } });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("advertises QA access separately without inventing a paid entitlement or altering counts", async () => {
    const { getUser } = setup();
    getUser.mockResolvedValue({ data: { user: qaUser }, error: null });
    const from = vi.fn((table: string) => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: table === "free_scan_usage" ? { scans_used: 5 } : null, error: null }) }) }) }));
    supabaseMock.createClient.mockReturnValue({ auth: { getUser }, from });
    const result = await createAccountEntitlementResponse(HEADERS, qaEnv());
    expect(result).toMatchObject({ status: 200, body: { qaScanAccess: { mode: "non-production", userId: "user-1" }, entitlement: { status: "free", scanAllowance: 5, scansUsed: 5 } } });
    const production = await createAccountEntitlementResponse(HEADERS, { ...qaEnv(), VERCEL_ENV: "production" });
    expect(production.body).not.toHaveProperty("qaScanAccess", expect.anything());
  });

  it.each([{ NODE_ENV: "production" }, { VERCEL_ENV: "production" }, {}])("defaults to enforcement and fails closed without configuration: %j", async (production) => {
    const env = Object.keys(production).length ? { ...production, DEEPSPEC_ENFORCE_SCAN_CREDITS: "false" } : {};
    await expect(reserveScanCredit(HEADERS, env)).resolves.toMatchObject({ ok: false, error: { status: 500 } });
  });

  it("does not call the database without a valid session", async () => {
    const { rpc, getUser } = setup();
    await expect(reserveScanCredit({}, ENV)).resolves.toMatchObject({ ok: false, error: { status: 401 } });
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    await expect(reserveScanCredit(HEADERS, ENV)).resolves.toMatchObject({ ok: false, error: { status: 401 } });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("fails closed when the RPC is missing or returns a database error", async () => {
    const { rpc } = setup();
    rpc.mockResolvedValue({ data: null, error: { code: "PGRST202" } });
    await expect(reserveScanCredit(HEADERS, ENV)).resolves.toMatchObject({ ok: false, error: { status: 503 } });
  });
});
