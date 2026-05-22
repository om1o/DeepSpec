const TEST_MODE_SESSION_KEY = "deep-spec:test-mode";

/** Dev / QA: `?test=1` keeps scans in memory only. */
export function isTestMode(search?: string): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  const params = new URLSearchParams(search ?? window.location.search);
  if (params.get("test") === "1") {
    sessionStorage.setItem(TEST_MODE_SESSION_KEY, "1");
    return true;
  }

  return sessionStorage.getItem(TEST_MODE_SESSION_KEY) === "1";
}

export function clearTestMode() {
  if (typeof sessionStorage !== "undefined") {
    sessionStorage.removeItem(TEST_MODE_SESSION_KEY);
  }
}
