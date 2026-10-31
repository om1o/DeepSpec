import { afterEach, describe, expect, it, vi } from "vitest";
import { requireSession } from "./requireSession.shared";

const supabaseMock = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("@supabase/supabase-js", () => supabaseMock);

const ENV_ON = {
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role",
};

afterEach(() => {
  supabaseMock.createClient.mockReset();
});

describe("requireSession", () => {
  it("fails closed when Supabase is not configured", async () => {
    await expect(requireSession({ authorization: "Bearer x" }, {})).resolves.toMatchObject({
      ok: false,
      status: 500,
      body: { error: { code: "not_configured" } },
    });
    expect(supabaseMock.createClient).not.toHaveBeenCalled();
  });

  it("401s when enforced and no bearer token is present", async () => {
    await expect(requireSession({}, ENV_ON)).resolves.toMatchObject({
      ok: false,
      status: 401,
      body: { error: { code: "missing_session" } },
    });
  });

  it("401s when the token cannot be verified", async () => {
    supabaseMock.createClient.mockReturnValue({
      auth: { getUser: vi.fn(async () => ({ data: { user: null }, error: { message: "bad token" } })) },
    });
    await expect(requireSession({ authorization: "Bearer nope" }, ENV_ON)).resolves.toMatchObject({
      ok: false,
      status: 401,
      body: { error: { code: "invalid_session" } },
    });
  });

  it("rejects a verified anonymous session", async () => {
    supabaseMock.createClient.mockReturnValue({
      auth: { getUser: vi.fn(async () => ({ data: { user: { id: "anon-1", is_anonymous: true } }, error: null })) },
    });
    await expect(requireSession({ authorization: "Bearer good" }, ENV_ON)).resolves.toMatchObject({
      ok: false,
      status: 401,
      body: { error: { code: "invalid_session" } },
    });
  });

  it("passes with the user id for a valid authenticated session", async () => {
    supabaseMock.createClient.mockReturnValue({
      auth: { getUser: vi.fn(async () => ({ data: { user: { id: "user-1", is_anonymous: false } }, error: null })) },
    });
    await expect(requireSession({ authorization: "Bearer good" }, ENV_ON)).resolves.toEqual({ ok: true, userId: "user-1" });
  });
});
