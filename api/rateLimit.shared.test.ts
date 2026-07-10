import { afterEach, describe, expect, it, vi } from "vitest";
import { enforceRateLimit } from "./rateLimit.shared";

const supabaseMock = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("@supabase/supabase-js", () => supabaseMock);

const ENV = { SUPABASE_URL: "https://project.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service-role" };
const HEADERS = { "x-forwarded-for": "203.0.113.9, 10.0.0.1" };

type RpcResult = { data: unknown; error: unknown };

function mockRpc(impl: () => Promise<RpcResult>) {
  const rpc = vi.fn(impl);
  supabaseMock.createClient.mockReturnValue({ rpc });
  return rpc;
}

afterEach(() => {
  supabaseMock.createClient.mockReset();
  vi.restoreAllMocks();
});

describe("enforceRateLimit", () => {
  it("fails open when the backing store is not configured", async () => {
    const rpc = mockRpc(async () => ({ data: true, error: null }));
    await expect(enforceRateLimit("identify", HEADERS, {})).resolves.toEqual({ ok: true });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("fails open when there is no client IP to key on", async () => {
    const rpc = mockRpc(async () => ({ data: true, error: null }));
    await expect(enforceRateLimit("identify", {}, ENV)).resolves.toEqual({ ok: true });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("allows a request under the limit and keys by the first forwarded IP", async () => {
    const rpc = mockRpc(async () => ({ data: true, error: null }));
    await expect(enforceRateLimit("identify", HEADERS, ENV)).resolves.toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("check_rate_limit", { p_key: "identify:min:203.0.113.9", p_max: 15, p_window_seconds: 60 });
    expect(rpc).toHaveBeenCalledWith("check_rate_limit", { p_key: "identify:day:203.0.113.9", p_max: 150, p_window_seconds: 86_400 });
  });

  it("blocks with 429 + Retry-After when a window is exceeded", async () => {
    mockRpc(async () => ({ data: false, error: null }));
    const decision = await enforceRateLimit("chat", HEADERS, ENV);
    expect(decision).toMatchObject({
      ok: false,
      status: 429,
      retryAfterSeconds: 60,
      body: { error: { code: "rate_limited" } },
    });
  });

  it("applies the chat scope's own limits", async () => {
    const rpc = mockRpc(async () => ({ data: true, error: null }));
    await enforceRateLimit("chat", HEADERS, ENV);
    expect(rpc).toHaveBeenCalledWith("check_rate_limit", { p_key: "chat:min:203.0.113.9", p_max: 30, p_window_seconds: 60 });
    expect(rpc).toHaveBeenCalledWith("check_rate_limit", { p_key: "chat:day:203.0.113.9", p_max: 300, p_window_seconds: 86_400 });
  });

  it("fails open (and logs) when the limiter query errors", async () => {
    mockRpc(async () => ({ data: null, error: { message: "boom" } }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(enforceRateLimit("identify", HEADERS, ENV)).resolves.toEqual({ ok: true });
    expect(warn).toHaveBeenCalled();
  });
});
