import { accountStorageKey, getAccountScope, hasUnassignedDeviceRecords, isAccountScopeCurrent, isCurrentAccountRouteState, setActiveAccount, setActiveGuestPreview, withAccountRouteState } from "./accountScope";

afterEach(() => vi.unstubAllEnvs());

it("keeps accounts separate and preserves raw legacy records without adopting them", () => {
  localStorage.clear();
  const legacy = "{legacy bytes that must remain untouched}";
  localStorage.setItem("deep-spec:lookups", legacy);
  setActiveAccount("a");
  const keyA = accountStorageKey("deep-spec:lookups");
  localStorage.setItem(keyA, "A records");
  setActiveAccount("b");
  expect(localStorage.getItem(accountStorageKey("deep-spec:lookups"))).toBeNull();
  expect(hasUnassignedDeviceRecords()).toBe(true);
  setActiveAccount("a");
  expect(localStorage.getItem(accountStorageKey("deep-spec:lookups"))).toBe("A records");
  expect(localStorage.getItem("deep-spec:lookups")).toBe(legacy);
});

it("fails closed before verification or after sign-out", () => {
  setActiveAccount(null);
  expect(() => accountStorageKey("deep-spec:lookups")).toThrow(/Sign in/);
  expect(isCurrentAccountRouteState({ accountId: null })).toBe(false);
});

it("invalidates old work even after A to B to A", () => {
  setActiveAccount("a");
  const old = getAccountScope();
  setActiveAccount("b");
  setActiveAccount("a");
  expect(isAccountScopeCurrent(old)).toBe(false);
  expect(isAccountScopeCurrent(getAccountScope())).toBe(true);
});

it("rejects old router payloads and untagged legacy payloads", () => {
  setActiveAccount("a");
  const state = withAccountRouteState({ savedLookup: { id: "a-scan" } });
  expect(isCurrentAccountRouteState(state)).toBe(true);
  setActiveAccount("b");
  expect(isCurrentAccountRouteState(state)).toBe(false);
  expect(isCurrentAccountRouteState({ savedLookup: { id: "a-scan" } })).toBe(false);
});

it("never enables a guest workspace in a normal build", () => {
  vi.stubEnv("VITE_DEEPSPEC_GUEST_PREVIEW", "false");
  setActiveAccount(null);
  expect(setActiveGuestPreview()).toBe(false);
  expect(getAccountScope()).toMatchObject({ kind: "none", userId: null });
  expect(() => accountStorageKey("deep-spec:lookups")).toThrow(/Sign in/);
});

it("gives guests a separate local identity and invalidates work across guest/account switches", () => {
  vi.stubEnv("VITE_DEEPSPEC_GUEST_PREVIEW", "true");
  setActiveAccount("owner");
  const owner = getAccountScope();
  const ownerKey = accountStorageKey("deep-spec:lookups");
  const ownerRoute = withAccountRouteState({ savedLookup: { id: "owner-scan" } });
  localStorage.setItem(ownerKey, "private scans");
  expect(setActiveGuestPreview()).toBe(true);
  const guest = getAccountScope();
  expect(guest).toMatchObject({ kind: "guest", userId: null, guestId: expect.any(String) });
  expect(accountStorageKey("deep-spec:lookups")).toMatch(/^deep-spec:guest-preview:/);
  expect(accountStorageKey("deep-spec:lookups")).not.toBe(ownerKey);
  expect(localStorage.getItem(accountStorageKey("deep-spec:lookups"))).toBeNull();
  expect(localStorage.getItem(ownerKey)).toBe("private scans");
  expect(isAccountScopeCurrent(owner)).toBe(false);
  expect(isCurrentAccountRouteState(ownerRoute)).toBe(false);
  const guestRoute = withAccountRouteState({ savedLookup: { id: "guest-scan" } });
  expect(isCurrentAccountRouteState(guestRoute)).toBe(true);
  expect(isCurrentAccountRouteState({ accountId: null })).toBe(false);
  setActiveAccount("owner");
  expect(isAccountScopeCurrent(guest)).toBe(false);
  expect(isCurrentAccountRouteState(guestRoute)).toBe(false);
  setActiveGuestPreview();
  expect(isAccountScopeCurrent(guest)).toBe(false);
  expect(isAccountScopeCurrent(getAccountScope())).toBe(true);
});
