import type { AuthChangeEvent, Session, SupabaseClient, User } from "@supabase/supabase-js";
import type { Provider } from "@supabase/supabase-js";

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
let verifiedAuthUserCache: { user: User; verifiedAt: number } | null = null;

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
  const client = await getAuthClient();
  if (!client) {
    return null;
  }

  return verifyAuthUser(client);
}

async function verifyAuthUser(client: SupabaseClient): Promise<User | null> {
  const redirectReady = await completeAuthRedirectIfNeeded(client);
  if (!redirectReady) {
    clearVerifiedAuthUserCache();
    return null;
  }

  const cachedUser = getCachedVerifiedAuthUser();
  if (cachedUser) {
    return cachedUser;
  }

  const result = await withTimeout(client.auth.getUser().catch(() => null), AUTH_VERIFY_TIMEOUT_MS);
  if (!result) {
    clearVerifiedAuthUserCache();
    return null;
  }

  const { data, error } = result;
  if (error || !data.user) {
    clearVerifiedAuthUserCache();
    return null;
  }

  verifiedAuthUserCache = { user: data.user, verifiedAt: Date.now() };
  return data.user;
}

export async function sendEmailSignInLink(email: string, redirectPath?: string): Promise<EmailSignInResult> {
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
  const client = await getRequiredAuthClient();
  const result = await client.auth.verifyOtp({
    email,
    token,
    type: "email",
  });

  if (result.error) {
    throw new Error(result.error.message);
  }

  const user = await getVerifiedAuthUser();
  if (!user) {
    throw new Error("Could not verify this session. Request a new code and try again.");
  }

  return user;
}

export async function signInWithPassword(email: string, password: string) {
  const client = await getRequiredAuthClient();
  const result = await client.auth.signInWithPassword({
    email,
    password,
  });

  if (result.error) {
    throw new Error(result.error.message);
  }

  const user = await getVerifiedAuthUser();
  if (!user) {
    throw new Error("Could not verify this session. Check your email and password and try again.");
  }

  return user;
}

export async function signUpWithPassword(email: string, password: string, redirectPath?: string) {
  const client = await getRequiredAuthClient();
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

  if (!result.data.session) {
    throw new Error("Supabase still requires email confirmation for new password accounts. Disable Confirm Email in the Supabase Email provider, then create the account again.");
  }

  const user = await getVerifiedAuthUser();
  if (!user) {
    throw new Error("Could not verify this new account session. Try signing in again.");
  }

  return user;
}

export async function signInAnonymously() {
  const client = await getRequiredAuthClient();
  const result = await client.auth.signInAnonymously();

  if (result.error) {
    throw new Error(result.error.message);
  }

  const user = await getVerifiedAuthUser();
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

export async function signOut() {
  const client = await getAuthClient();
  if (!client) {
    return;
  }

  const result = await client.auth.signOut();
  if (result.error) {
    throw new Error(result.error.message);
  }

  clearVerifiedAuthUserCache();
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

export async function subscribeToAuthChanges(onChange: (user: User | null) => void) {
  const client = await getAuthClient();
  if (!client) {
    return () => undefined;
  }

  const subscription = client.auth.onAuthStateChange((_event: AuthChangeEvent, session: Session | null) => {
    if (!session?.user) {
      clearVerifiedAuthUserCache();
      onChange(null);
      return;
    }

    setTimeout(() => {
      clearVerifiedAuthUserCache();
      void verifyAuthUser(client)
        .then(onChange)
        .catch(() => {
          clearVerifiedAuthUserCache();
          onChange(null);
        });
    }, 0);
  });

  return () => subscription.data.subscription.unsubscribe();
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
  if (!trimmed) {
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

  if (Date.now() - verifiedAuthUserCache.verifiedAt > AUTH_VERIFIED_CACHE_MS) {
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
      .catch(() => false);
  }

  return authRedirectPromise;
}

async function exchangeAuthCodeForSession(client: SupabaseClient, authCode: string, url: URL) {
  const result = await client.auth.exchangeCodeForSession(authCode);
  if (result.error) {
    throw new Error(result.error.message);
  }

  url.searchParams.delete("code");
  window.history.replaceState(window.history.state, document.title, `${url.pathname}${url.search}${url.hash}`);
  return true;
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
