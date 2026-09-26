import type { AuthChangeEvent, Session, SupabaseClient, User } from "@supabase/supabase-js";
import type { Provider } from "@supabase/supabase-js";
import { getAccountScope, setActiveAccount } from "../lib/accountScope";

type SupabaseAuthConfig = {
  key: string;
  url: string;
};

export type EmailSignInDelivery = "link" | "code";
export type EmailSignInResult = {
  delivery: EmailSignInDelivery;
  emailRedirectTo?: string;
};

const AUTH_VERIFY_TIMEOUT_MS = 8_000;
const AUTH_VERIFIED_CACHE_MS = 30_000;
const DEFAULT_POST_AUTH_PATH = "/scan";
let clientPromise: Promise<SupabaseClient> | null = null;
let authRedirectPromise: Promise<boolean> | null = null;
let verifiedAuthUserCache: { user: User; verifiedAt: number; generation: string | null } | null = null;
let authRevision = 0;
let signOutRevision = 0;
let pendingSignOuts = 0;
const SIGN_OUT_LOCK_KEY = "deep-spec:sign-out-pending";
const SIGN_OUT_GENERATION_KEY = "deep-spec:sign-out-generation";
let signOutLock: string | null = null;
const signOutListeners = new Set<() => void>();
const signOutStateListeners = new Set<() => void>();

export function hasPendingSignOut() {
  return readSignOutLock() !== null;
}

export function subscribeToPendingSignOut(onChange: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === SIGN_OUT_LOCK_KEY || event.key === null) onChange();
  };
  signOutStateListeners.add(onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    signOutStateListeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
}

function readSignOutLock() {
  try { return localStorage.getItem(SIGN_OUT_LOCK_KEY) ?? signOutLock; }
  catch { return signOutLock; }
}

function readSignOutGeneration() {
  try { return localStorage.getItem(SIGN_OUT_GENERATION_KEY); }
  catch { return String(signOutRevision); }
}

function setSignOutLock(locked: boolean) {
  signOutLock = locked ? crypto.randomUUID() : null;
  try {
    if (signOutLock) {
      localStorage.setItem(SIGN_OUT_GENERATION_KEY, signOutLock);
      localStorage.setItem(SIGN_OUT_LOCK_KEY, signOutLock);
    }
    else localStorage.removeItem(SIGN_OUT_LOCK_KEY);
  } catch { /* In-memory protection remains when browser storage is unavailable. */ }
  signOutStateListeners.forEach((listener) => listener());
}

export function isSupabaseAuthConfigured() {
  return Boolean(getSupabaseAuthConfig());
}

export function isGoogleAuthEnabled() {
  return isOAuthProviderEnabled(import.meta.env.VITE_ENABLE_GOOGLE_AUTH);
}

export function isGitHubAuthEnabled() {
  return isOAuthProviderEnabled(import.meta.env.VITE_ENABLE_GITHUB_AUTH);
}

export async function getVerifiedAuthUser(): Promise<User | null> {
  const revision = authRevision;
  const generation = readSignOutGeneration();
  if (pendingSignOuts || hasPendingSignOut()) return null;
  const client = await getAuthClient();
  if (pendingSignOuts || revision !== authRevision || generation !== readSignOutGeneration()) return null;
  if (!client) {
    setActiveAccount(null);
    return null;
  }

  return verifyAuthUser(client, revision);
}

async function verifyAuthUser(client: SupabaseClient, revision = authRevision, expectedUserId?: string, explicitSignIn = false): Promise<User | null> {
  const initialLock = readSignOutLock();
  const generation = readSignOutGeneration();
  const isCurrent = () => !pendingSignOuts && revision === authRevision
    && generation === readSignOutGeneration()
    && (explicitSignIn ? readSignOutLock() === initialLock : !hasPendingSignOut());
  if (pendingSignOuts || revision !== authRevision || (!explicitSignIn && hasPendingSignOut())) return null;
  const redirectReady = await completeAuthRedirectIfNeeded(client);
  if (!isCurrent()) return null;
  if (!redirectReady) {
    clearVerifiedAuthUserCache();
    setActiveAccount(null);
    return null;
  }

  const cachedUser = getCachedVerifiedAuthUser();
  if (cachedUser) {
    setActiveAccount(cachedUser.id);
    return cachedUser;
  }

  const result = await withTimeout(client.auth.getUser().catch(() => null), AUTH_VERIFY_TIMEOUT_MS);
  if (!isCurrent()) return null;
  if (!result) {
    clearVerifiedAuthUserCache();
    setActiveAccount(null);
    return null;
  }

  const { data, error } = result;
  if (error || !data.user || (expectedUserId && data.user.id !== expectedUserId)) {
    clearVerifiedAuthUserCache();
    setActiveAccount(null);
    return null;
  }

  if (explicitSignIn) setSignOutLock(false);
  verifiedAuthUserCache = { user: data.user, verifiedAt: Date.now(), generation };
  setActiveAccount(data.user.id);
  return data.user;
}

export async function sendEmailSignInLink(email: string, redirectPath?: string): Promise<EmailSignInResult> {
  if (hasPendingSignOut()) await signOut();
  const client = await getRequiredAuthClient();
  const emailRedirectTo = getAuthRedirectUrl(redirectPath);
  const result = await client.auth.signInWithOtp({
    email,
    options: {
      ...(emailRedirectTo ? { emailRedirectTo } : {}),
      shouldCreateUser: true,
    },
  });

  if (!result.error) {
    return {
      delivery: emailRedirectTo ? "link" : "code",
      ...(emailRedirectTo ? { emailRedirectTo } : {}),
    };
  }

  if (emailRedirectTo && isEmailRedirectRejected(result.error.message)) {
    const codeOnlyResult = await client.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: true,
      },
    });

    if (!codeOnlyResult.error) {
      return { delivery: "code" };
    }

    throw new Error(codeOnlyResult.error.message);
  }

  if (result.error) {
    throw new Error(result.error.message);
  }

  return { delivery: "code" };
}

export async function verifyEmailCode(email: string, token: string) {
  const signOutAtStart = { revision: signOutRevision, lock: readSignOutLock(), generation: readSignOutGeneration() };
  assertSignInCurrent(signOutAtStart);
  const client = await getRequiredAuthClient();
  assertSignInCurrent(signOutAtStart);
  const result = await client.auth.verifyOtp({
    email,
    token,
    type: "email",
  });

  if (result.error) {
    throw new Error(result.error.message);
  }

  assertSignInCurrent(signOutAtStart);
  clearVerifiedAuthUserCache();
  const user = await verifyAuthUser(client, ++authRevision, result.data?.user?.id, true);
  if (!user) {
    throw new Error("Could not verify this session. Request a new code and try again.");
  }

  return user;
}

export async function signInWithPassword(email: string, password: string) {
  const signOutAtStart = { revision: signOutRevision, lock: readSignOutLock(), generation: readSignOutGeneration() };
  assertSignInCurrent(signOutAtStart);
  const client = await getRequiredAuthClient();
  assertSignInCurrent(signOutAtStart);
  const result = await client.auth.signInWithPassword({
    email,
    password,
  });

  if (result.error) {
    throw new Error(result.error.message);
  }

  assertSignInCurrent(signOutAtStart);
  clearVerifiedAuthUserCache();
  const user = await verifyAuthUser(client, ++authRevision, result.data?.user?.id, true);
  if (!user) {
    throw new Error("Could not verify this session. Check your email and password and try again.");
  }

  return user;
}

export async function signUpWithPassword(email: string, password: string, redirectPath?: string) {
  const signOutAtStart = { revision: signOutRevision, lock: readSignOutLock(), generation: readSignOutGeneration() };
  assertSignInCurrent(signOutAtStart);
  const client = await getRequiredAuthClient();
  assertSignInCurrent(signOutAtStart);
  const result = await client.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: getAuthRedirectUrl(redirectPath),
    },
  });

  if (result.error) {
    throw new Error(result.error.message);
  }

  assertSignInCurrent(signOutAtStart);
  // A successful signup without a session requires inbox confirmation, not
  // weaker provider settings. Do not activate the unverified account.
  if (!result.data.session) return null;

  clearVerifiedAuthUserCache();
  const user = await verifyAuthUser(client, ++authRevision, result.data?.user?.id, true);
  if (!user) {
    throw new Error("Could not verify this new account session. Try signing in again.");
  }

  return user;
}

export async function signInAnonymously() {
  const signOutAtStart = { revision: signOutRevision, lock: readSignOutLock(), generation: readSignOutGeneration() };
  assertSignInCurrent(signOutAtStart);
  const client = await getRequiredAuthClient();
  assertSignInCurrent(signOutAtStart);
  const result = await client.auth.signInAnonymously();

  if (result.error) {
    throw new Error(result.error.message);
  }

  assertSignInCurrent(signOutAtStart);
  clearVerifiedAuthUserCache();
  const user = await verifyAuthUser(client, ++authRevision, result.data?.user?.id, true);
  if (!user) {
    throw new Error("Could not verify this session. Try again.");
  }

  return user;
}

export async function signInWithGoogle(redirectPath?: string) {
  return signInWithOAuthProvider("google", redirectPath);
}

export async function signInWithGitHub(redirectPath?: string) {
  return signInWithOAuthProvider("github", redirectPath);
}

async function signInWithOAuthProvider(provider: Provider, redirectPath?: string) {
  if (hasPendingSignOut()) await signOut();
  const client = await getRequiredAuthClient();
  const result = await client.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo: getAuthRedirectUrl(redirectPath),
    },
  });

  if (result.error) {
    throw new Error(result.error.message);
  }
}

function assertSignInCurrent(signOutAtStart: { revision: number; lock: string | null; generation: string | null }) {
  if (pendingSignOuts || signOutAtStart.revision !== signOutRevision || signOutAtStart.lock !== readSignOutLock() || signOutAtStart.generation !== readSignOutGeneration()) throw new Error("Session changed. Try signing in again.");
}

export async function signOut() {
  signOutRevision += 1;
  pendingSignOuts += 1;
  authRevision += 1;
  clearVerifiedAuthUserCache();
  setActiveAccount(null);
  setSignOutLock(true);
  const ownLock = readSignOutLock();
  signOutListeners.forEach((listener) => listener());
  try {
    const client = await getAuthClient();
    if (!client) throw new Error("Sign-out cannot be confirmed because authentication is not configured.");
    const result = await client.auth.signOut();
    if (result.error) throw new Error(result.error.message);
    if (readSignOutLock() === ownLock) setSignOutLock(false);
  } finally {
    pendingSignOuts -= 1;
    authRevision += 1;
    clearVerifiedAuthUserCache();
    setActiveAccount(null);
  }
}

export async function getAuthClient() {
  const config = getSupabaseAuthConfig();
  if (!config) {
    return null;
  }

  if (!clientPromise) {
    clientPromise = import("@supabase/supabase-js")
      .then(({ createClient }) =>
        createClient(config.url, config.key, {
          auth: {
            autoRefreshToken: true,
            persistSession: true,
          },
        }),
      )
      .catch((error) => {
        clientPromise = null;
        throw error;
      });
  }

  return clientPromise;
}

export async function subscribeToAuthChanges(
  onChange: (user: User | null) => void,
  onVerifying?: (userId: string) => void,
) {
  const client = await getAuthClient();
  if (!client) {
    return () => undefined;
  }

  let active = true;
  const lockScreen = () => {
    if (!active || !hasPendingSignOut()) return;
    authRevision += 1;
    clearVerifiedAuthUserCache();
    setActiveAccount(null);
    onChange(null);
  };
  const onStorage = (event: StorageEvent) => {
    if (event.key === SIGN_OUT_LOCK_KEY || event.key === null) lockScreen();
  };
  signOutListeners.add(lockScreen);
  window.addEventListener("storage", onStorage);
  const subscription = client.auth.onAuthStateChange((_event: AuthChangeEvent, session: Session | null) => {
    const revision = ++authRevision;
    clearVerifiedAuthUserCache();
    if (pendingSignOuts || hasPendingSignOut()) { setActiveAccount(null); onChange(null); return; }
    if (getAccountScope().userId !== (session?.user?.id ?? null)) {
      setActiveAccount(null);
    }
    if (!session?.user) {
      clearVerifiedAuthUserCache();
      onChange(null);
      return;
    }

    onVerifying?.(session.user.id);
    setTimeout(() => {
      if (!active || revision !== authRevision) return;
      void verifyAuthUser(client)
        .then((user) => { if (active && revision === authRevision) onChange(user); })
        .catch(() => {
          if (!active || revision !== authRevision) return;
          clearVerifiedAuthUserCache();
          setActiveAccount(null);
          onChange(null);
        });
    }, 0);
  });

  return () => {
    active = false;
    signOutListeners.delete(lockScreen);
    window.removeEventListener("storage", onStorage);
    subscription.data.subscription.unsubscribe();
  };
}

function getSupabaseAuthConfig(): SupabaseAuthConfig | null {
  const url = import.meta.env.VITE_SUPABASE_URL?.trim();
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();

  if (!url || !key) {
    return null;
  }

  return { key, url };
}

export function normalizePostAuthRedirectPath(path: string | null | undefined) {
  if (!path) {
    return DEFAULT_POST_AUTH_PATH;
  }

  const trimmed = path.trim();
  if (!trimmed || hasUnsafeRedirectCharacters(trimmed)) {
    return DEFAULT_POST_AUTH_PATH;
  }

  if (trimmed.startsWith("/")) {
    return trimmed.startsWith("//") ? DEFAULT_POST_AUTH_PATH : trimmed;
  }

  if (typeof window !== "undefined") {
    try {
      const parsed = new URL(trimmed, window.location.origin);
      if (parsed.origin === window.location.origin) {
        return `${parsed.pathname}${parsed.search}${parsed.hash}` || DEFAULT_POST_AUTH_PATH;
      }
    } catch {
      return DEFAULT_POST_AUTH_PATH;
    }
  }

  return DEFAULT_POST_AUTH_PATH;
}

// The URL parser reads a backslash as a slash and silently drops tabs and newlines, so "/\evil.com"
// and "/<TAB>/evil.com" resolve to another origin although neither starts with "//". When pushState
// rejects a cross-origin URL, react-router falls back to window.location.assign, so this was a
// post-login open redirect. No legitimate app path contains a backslash or a control character.
function hasUnsafeRedirectCharacters(value: string) {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (character === "\\" || code < 0x20 || code === 0x7f) {
      return true;
    }
  }
  return false;
}

function isOAuthProviderEnabled(flag: string | undefined) {
  if (!isSupabaseAuthConfigured()) {
    return false;
  }

  return flag?.trim().toLowerCase() === "true";
}

function isEmailRedirectRejected(message: string) {
  return /redirect|redirect_to|emailRedirectTo|site url|url/i.test(message)
    && /not allowed|not.*allow|invalid|unauthori[sz]ed|forbidden/i.test(message);
}

function getCachedVerifiedAuthUser() {
  if (!verifiedAuthUserCache) {
    return null;
  }

  if (verifiedAuthUserCache.generation !== readSignOutGeneration() || Date.now() - verifiedAuthUserCache.verifiedAt > AUTH_VERIFIED_CACHE_MS) {
    clearVerifiedAuthUserCache();
    return null;
  }

  return verifiedAuthUserCache.user;
}

function clearVerifiedAuthUserCache() {
  verifiedAuthUserCache = null;
}

async function getRequiredAuthClient() {
  const client = await getAuthClient();
  if (!client) {
    throw new Error("Supabase auth is not configured for this build.");
  }

  return client;
}

async function completeAuthRedirectIfNeeded(client: SupabaseClient): Promise<boolean> {
  if (typeof window === "undefined") {
    return true;
  }

  const url = new URL(window.location.href);
  const authCode = url.searchParams.get("code");
  if (!authCode) {
    return true;
  }

  if (!authRedirectPromise) {
    authRedirectPromise = withTimeout(exchangeAuthCodeForSession(client, authCode, url), AUTH_VERIFY_TIMEOUT_MS)
      .then((result) => result === true)
      .catch(() => false)
      .then((exchanged) => {
        if (!exchanged) {
          // A spent or expired code must not keep failing every later verification.
          // Drop it from the URL and let the next attempt run without it.
          clearAuthCodeFromUrl(url);
          authRedirectPromise = null;
        }

        return exchanged;
      });
  }

  return authRedirectPromise;
}

async function exchangeAuthCodeForSession(client: SupabaseClient, authCode: string, url: URL) {
  const result = await client.auth.exchangeCodeForSession(authCode);
  if (result.error) {
    throw new Error(result.error.message);
  }

  clearAuthCodeFromUrl(url);
  return true;
}

function clearAuthCodeFromUrl(url: URL) {
  url.searchParams.delete("code");
  window.history.replaceState(window.history.state, document.title, `${url.pathname}${url.search}${url.hash}`);
}

function getAuthRedirectUrl(redirectPath?: string) {
  if (typeof window === "undefined") {
    return undefined;
  }

  const normalizedPath = normalizePostAuthRedirectPath(redirectPath);
  const redirectUrl = new URL("/auth", window.location.origin);
  redirectUrl.searchParams.set("next", normalizedPath);
  return redirectUrl.toString();
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timeoutId = setTimeout(() => resolve(null), timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  });
}
