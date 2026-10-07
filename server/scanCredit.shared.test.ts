import { afterEach, describe, expect, it, vi } from "vitest";
import { consumeReservedScanCredit, reserveScanCredit } from "./billing.shared";

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

  it("bypasses enforcement only when explicitly disabled in development", async () => {
    await expect(reserveScanCredit({}, { DEEPSPEC_ENFORCE_SCAN_CREDITS: "false", NODE_ENV: "development" })).resolves.toEqual({ enforced: false, ok: true });
    expect(supabaseMock.createClient).not.toHaveBeenCalled();
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
