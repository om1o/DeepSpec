import type { AuthChangeEvent, Session, SupabaseClient, User } from "@supabase/supabase-js";
import type { Provider } from "@supabase/supabase-js";

type SupabaseAuthConfig = {
  key: string;
  url: string;
};

const AUTH_VERIFY_TIMEOUT_MS = 8_000;
let clientPromise: Promise<SupabaseClient> | null = null;
let authRedirectPromise: Promise<boolean> | null = null;

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
    return null;
  }

  const result = await withTimeout(client.auth.getUser().catch(() => null), AUTH_VERIFY_TIMEOUT_MS);
  if (!result) {
    return null;
  }

  const { data, error } = result;
  if (error || !data.user) {
    return null;
  }

  return data.user;
}

export async function sendEmailVerificationCode(email: string) {
  const client = await getRequiredAuthClient();
  const emailRedirectTo = getAuthRedirectUrl();
  const result = await client.auth.signInWithOtp({
    email,
    options: {
      ...(emailRedirectTo ? { emailRedirectTo } : {}),
      shouldCreateUser: true,
    },
  });

  if (result.error) {
    throw new Error(result.error.message);
  }
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

export async function signUpWithPassword(email: string, password: string) {
  const client = await getRequiredAuthClient();
  const result = await client.auth.signUp({
    email,
    password,
  });

  if (result.error) {
    throw new Error(result.error.message);
  }

  return getVerifiedAuthUser();
}

export async function signInWithGoogle() {
  return signInWithOAuthProvider("google");
}

export async function signInWithGitHub() {
  return signInWithOAuthProvider("github");
}

async function signInWithOAuthProvider(provider: Provider) {
  const client = await getRequiredAuthClient();
  const result = await client.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo: new URL("/scan", window.location.origin).toString(),
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
      onChange(null);
      return;
    }

    setTimeout(() => {
      void verifyAuthUser(client)
        .then(onChange)
        .catch(() => {
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

function isOAuthProviderEnabled(flag: string | undefined) {
  if (!isSupabaseAuthConfigured()) {
    return false;
  }

  return flag?.trim().toLowerCase() === "true";
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

function getAuthRedirectUrl() {
  if (typeof window === "undefined") {
    return undefined;
  }

  return new URL("/scan", window.location.origin).toString();
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
