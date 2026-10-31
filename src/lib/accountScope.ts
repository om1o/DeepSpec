export type AccountScope = { userId: string | null; generation: number };

let activeScope: AccountScope = { userId: null, generation: 0 };

export function setActiveAccount(userId: string | null) {
  if (activeScope.userId !== userId) activeScope = { userId, generation: activeScope.generation + 1 };
}

export function getAccountScope(): AccountScope {
  return { ...activeScope };
}

export function isAccountScopeCurrent(scope: AccountScope) {
  return Boolean(scope.userId && scope.userId === activeScope.userId && scope.generation === activeScope.generation);
}

export function accountStorageKey(key: string) {
  if (!activeScope.userId) throw new Error("Sign in before accessing private device records.");
  return `deep-spec:account:${encodeURIComponent(activeScope.userId)}:${key}`;
}

export function withAccountRouteState<T extends object>(state: T) {
  return { ...state, accountId: activeScope.userId };
}

export function isCurrentAccountRouteState(state: unknown): state is Record<string, unknown> {
  return Boolean(activeScope.userId && state && typeof state === "object" && "accountId" in state && state.accountId === activeScope.userId);
}

export function hasUnassignedDeviceRecords() {
  try {
    return localStorage.getItem("deep-spec:lookups") !== null || localStorage.getItem("deep-spec:shop:jobs") !== null;
  } catch {
    return false;
  }
}
