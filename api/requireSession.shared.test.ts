import { afterEach, describe, expect, it, vi } from "vitest";
import { requireSession } from "./requireSession.shared";

const supabaseMock = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("@supabase/supabase-js", () => supabaseMock);

const ENV_ON = {
  DEEPSPEC_REQUIRE_SESSION: "true",
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role",
};

afterEach(() => {
  supabaseMock.createClient.mockReset();
});

describe("requireSession", () => {
  it("passes through when the gate is off (default)", async () => {
    await expect(requireSession({ authorization: "Bearer x" }, {})).resolves.toEqual({ ok: true });
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

  it("passes with the user id for a valid session (anonymous included)", async () => {
    supabaseMock.createClient.mockReturnValue({
      auth: { getUser: vi.fn(async () => ({ data: { user: { id: "anon-1" } }, error: null })) },
    });
    await expect(requireSession({ authorization: "Bearer good" }, ENV_ON)).resolves.toEqual({ ok: true, userId: "anon-1" });
  });

  it("500s when enforced but Supabase is not configured", async () => {
    await expect(requireSession({ authorization: "Bearer x" }, { DEEPSPEC_REQUIRE_SESSION: "true" })).resolves.toMatchObject({
      ok: false,
      status: 500,
      body: { error: { code: "not_configured" } },
    });
  });
});
