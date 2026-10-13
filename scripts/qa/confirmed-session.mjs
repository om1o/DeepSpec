import { randomUUID } from "node:crypto";

export function readTestCredentials(env = process.env, prefix = "DEEPSPEC_AUTH_TEST") {
  const email = env[`${prefix}_EMAIL`]?.trim();
  const password = env[`${prefix}_PASSWORD`];
  if (!email || !password) {
    throw new Error(`Set ${prefix}_EMAIL and ${prefix}_PASSWORD for a dedicated confirmed QA account. Anonymous access is not supported.`);
  }
  return { email, password };
}

export function assertConfirmedSession(data) {
  if (!data?.session?.access_token || !data.user?.id || data.user.is_anonymous === true
      || (!data.user.email_confirmed_at && !data.user.phone_confirmed_at)) {
    throw new Error("QA requires a non-anonymous, confirmed user session.");
  }
  return data;
}

export async function signInConfirmed(client, credentials = readTestCredentials()) {
  const { data, error } = await client.auth.signInWithPassword(credentials);
  if (error) throw new Error("Confirmed QA account sign-in failed. Check credentials and Supabase Auth configuration.");
  return assertConfirmedSession(data);
}

export function assertDistinctUsers(owner, other) {
  if (owner.id === other.id) throw new Error("Cross-account isolation requires two distinct confirmed QA accounts.");
}

// Only a newly created disposable identity may receive synthetic billing grants.
// The callback records its ID before login so the caller can clean up on failure.
export async function createConfirmedReplaySession(adminClient, publicClient, onCreated) {
  const credentials = { email: `deepspec-replay-${randomUUID()}@example.test`, password: randomUUID() + randomUUID() };
  const { data, error } = await adminClient.auth.admin.createUser({ ...credentials, email_confirm: true });
  if (error || !data?.user?.id) throw new Error("Could not create the disposable confirmed billing replay account.");
  onCreated(data.user.id);
  const session = await signInConfirmed(publicClient, credentials);
  if (session.user.id !== data.user.id) throw new Error("Billing replay session does not match the disposable account.");
  return session;
}
