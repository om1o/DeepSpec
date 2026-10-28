import { afterEach, beforeEach, expect, it, vi } from "vitest";

beforeEach(() => { vi.resetModules(); localStorage.clear(); });
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

it("requires an explicit build flag and never treats other truthy values as enabled", async () => {
  const { isGuestPreview, getGuestPreviewBrowserId } = await import("./guestPreview");
  for (const value of ["", "false", "1", "TRUE"]) {
    vi.stubEnv("VITE_DEEPSPEC_GUEST_PREVIEW", value);
    expect(isGuestPreview()).toBe(false);
    expect(() => getGuestPreviewBrowserId()).toThrow(/not enabled/);
  }
});

it("reuses only its browser-local namespace ID without touching an existing auth session", async () => {
  vi.stubEnv("VITE_DEEPSPEC_GUEST_PREVIEW", "true");
  localStorage.setItem("sb-existing-auth-token", "existing private session");
  const { getGuestPreviewBrowserId } = await import("./guestPreview");
  const id = getGuestPreviewBrowserId();
  expect(getGuestPreviewBrowserId()).toBe(id);
  vi.resetModules();
  expect((await import("./guestPreview")).getGuestPreviewBrowserId()).toBe(id);
  expect(localStorage.getItem("sb-existing-auth-token")).toBe("existing private session");
});

it("can keep a visit-local identity when browser storage is blocked", async () => {
  vi.stubEnv("VITE_DEEPSPEC_GUEST_PREVIEW", "true");
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("Blocked"); });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Blocked"); });
  const { getGuestPreviewBrowserId } = await import("./guestPreview");
  const id = getGuestPreviewBrowserId();
  expect(id).toMatch(/^[a-z0-9-]{16,80}$/i);
  expect(getGuestPreviewBrowserId()).toBe(id);
});
