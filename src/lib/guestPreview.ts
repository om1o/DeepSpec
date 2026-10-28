const GUEST_BROWSER_KEY = "deep-spec:guest-preview:browser-id";
let memoryBrowserId: string | null = null;

/** Vite emits this flag only for the explicitly enabled preview deployment. */
export function isGuestPreview() {
  return import.meta.env.VITE_DEEPSPEC_GUEST_PREVIEW === "true";
}

/** A local storage namespace, never an account ID or an authorization token. */
export function getGuestPreviewBrowserId() {
  if (!isGuestPreview()) throw new Error("Guest access is not enabled for this build.");
  try {
    const stored = localStorage.getItem(GUEST_BROWSER_KEY);
    if (stored && /^[a-z0-9-]{16,80}$/i.test(stored)) {
      memoryBrowserId = stored;
      return stored;
    }
  } catch { /* The current visit can still use an in-memory namespace. */ }
  memoryBrowserId ??= crypto.randomUUID();
  try { localStorage.setItem(GUEST_BROWSER_KEY, memoryBrowserId); } catch { /* Browser storage may be blocked. */ }
  return memoryBrowserId;
}
