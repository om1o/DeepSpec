import { accountStorageKey, getAccountScope, hasUnassignedDeviceRecords, isAccountScopeCurrent, isCurrentAccountRouteState, setActiveAccount, withAccountRouteState } from "./accountScope";

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

it("ignores obsolete preview flags and preserves guest namespaces without adopting them", () => {
  vi.stubEnv("VITE_DEEPSPEC_GUEST_PREVIEW", "true");
  const key = "deep-spec:guest-preview:retired-browser-id:deep-spec:lookups";
  const guestBytes = "[{guest records remain unchanged}]";
  localStorage.setItem(key, guestBytes);
  setActiveAccount(null);
  expect(() => accountStorageKey("deep-spec:lookups")).toThrow(/Sign in/);
  expect(isCurrentAccountRouteState({ accountId: null, guestId: "retired-browser-id" })).toBe(false);
  setActiveAccount("owner");
  expect(accountStorageKey("deep-spec:lookups")).toBe("deep-spec:account:owner:deep-spec:lookups");
  expect(localStorage.getItem(accountStorageKey("deep-spec:lookups"))).toBeNull();
  expect(localStorage.getItem(key)).toBe(guestBytes);
});
