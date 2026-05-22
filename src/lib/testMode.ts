const TEST_MODE_SESSION_KEY = "deep-spec:test-mode";

/** Dev / QA: `?test=1` keeps scans in memory only. */
export function isTestMode(search?: string): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    const params = new URLSearchParams(search ?? window.location.search);
    if (params.get("test") === "1") {
      sessionStorage.setItem(TEST_MODE_SESSION_KEY, "1");
      return true;
    }

    return sessionStorage.getItem(TEST_MODE_SESSION_KEY) === "1";
  } catch {
    return false;
  }
}

/** Dev / QA: `?test=1&save=1` seeds a local saved fixture for review testing. */
export function isTestSaveMode(search?: string): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    const params = new URLSearchParams(search ?? window.location.search);
    return params.get("test") === "1" && params.get("save") === "1";
  } catch {
    return false;
  }
}

export function clearTestMode() {
  try {
    if (typeof sessionStorage !== "undefined") {
      sessionStorage.removeItem(TEST_MODE_SESSION_KEY);
    }
  } catch {
    // Test mode is optional; storage failures should not break the scanner.
  }
}
