import { getGuestPreviewBrowserId, isGuestPreview } from "./guestPreview";

export type AccountScope =
  | { kind: "account"; userId: string; generation: number; guestId?: never }
  | { kind: "guest"; userId: null; guestId: string; generation: number }
  | { kind: "none"; userId: null; generation: number; guestId?: never };

let activeScope: AccountScope = { kind: "none", userId: null, generation: 0 };

export function setActiveAccount(userId: string | null) {
  const kind = userId ? "account" : "none";
  if (activeScope.kind === kind && activeScope.userId === userId) return;
  activeScope = userId
    ? { kind: "account", userId, generation: activeScope.generation + 1 }
    : { kind: "none", userId: null, generation: activeScope.generation + 1 };
}

export function setActiveGuestPreview() {
  if (!isGuestPreview()) return false;
  const guestId = getGuestPreviewBrowserId();
  if (activeScope.kind !== "guest" || activeScope.guestId !== guestId) {
    activeScope = { kind: "guest", userId: null, guestId, generation: activeScope.generation + 1 };
  }
  return true;
}

export function getAccountScope(): AccountScope {
  return { ...activeScope };
}

export function isAccountScopeCurrent(scope: AccountScope) {
  if (scope.kind !== activeScope.kind || scope.generation !== activeScope.generation) return false;
  if (scope.kind === "account") return scope.userId === activeScope.userId;
  return scope.kind === "guest" && isGuestPreview() && scope.guestId === activeScope.guestId;
}

export function accountStorageKey(key: string) {
  if (activeScope.kind === "guest" && isGuestPreview()) return `deep-spec:guest-preview:${encodeURIComponent(activeScope.guestId)}:${key}`;
  if (!activeScope.userId) throw new Error("Sign in before accessing private device records.");
  return `deep-spec:account:${encodeURIComponent(activeScope.userId)}:${key}`;
}

export function withAccountRouteState<T extends object>(state: T) {
  return { ...state, accountId: activeScope.userId, ...(activeScope.kind === "guest" ? { guestId: activeScope.guestId } : {}) };
}

export function isCurrentAccountRouteState(state: unknown): state is Record<string, unknown> {
  if (!state || typeof state !== "object" || !("accountId" in state)) return false;
  if (activeScope.kind === "guest") return isGuestPreview() && state.accountId === null && "guestId" in state && state.guestId === activeScope.guestId;
  return Boolean(activeScope.userId && state.accountId === activeScope.userId);
}

export function hasUnassignedDeviceRecords() {
  if (isGuestPreview()) return false;
  try {
    return localStorage.getItem("deep-spec:lookups") !== null || localStorage.getItem("deep-spec:shop:jobs") !== null;
  } catch {
    return false;
  }
}
