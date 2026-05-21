import type { AuthChangeEvent, Session, SupabaseClient, User } from "@supabase/supabase-js";

const LOCAL_AUTH_KEY = "ds_auth_seen";

type SupabaseAuthConfig = {
  key: string;
  url: string;
};

let clientPromise: Promise<SupabaseClient> | null = null;

export function isSupabaseAuthConfigured() {
  return Boolean(getSupabaseAuthConfig());
}

export function isGoogleAuthEnabled() {
  return isSupabaseAuthConfigured() && import.meta.env.VITE_ENABLE_GOOGLE_AUTH?.trim().toLowerCase() === "true";
}

export function hasLocalAuthBypass() {
  return canUseLocalAuthBypass() && localStorage.getItem(LOCAL_AUTH_KEY) === "1";
}

export function markLocalAuthBypass() {
  localStorage.setItem(LOCAL_AUTH_KEY, "1");
}

export async function getVerifiedAuthUser(): Promise<User | null> {
  const client = await getAuthClient();
  if (!client) {
    return hasLocalAuthBypass() ? makeLocalUser() : null;
  }

  const { data, error } = await client.auth.getUser();
  if (error || !data.user) {
    return null;
  }

  return data.user;
}

export async function sendEmailVerificationCode(email: string) {
  const client = await getRequiredAuthClient();
  const result = await client.auth.signInWithOtp({
    email,
    options: {
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

export async function signInWithGoogle() {
  const client = await getRequiredAuthClient();
  const result = await client.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: new URL("/scan", window.location.origin).toString(),
    },
  });

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
    onChange(session?.user ?? null);
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

function canUseLocalAuthBypass() {
  return !isSupabaseAuthConfigured() || import.meta.env.DEV;
}

async function getRequiredAuthClient() {
  const client = await getAuthClient();
  if (!client) {
    throw new Error("Supabase auth is not configured for this build.");
  }

  return client;
}

function makeLocalUser(): User {
  return {
    app_metadata: {},
    aud: "authenticated",
    created_at: new Date(0).toISOString(),
    id: "local-device",
    user_metadata: {},
  } as User;
}
