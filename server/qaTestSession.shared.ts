import { createSupabaseAdminClient, getSupabaseAdminKey } from "./supabaseAdmin.shared.js";
import { QA_TEST_EMAIL } from "./qaTestConfig.shared.js";
import { qaTestFailure, readQaTestCapability, validateQaTestCapability } from "./qaTestGate.shared.js";

export type QaTestSessionRequest = {
  method?: string;
  headers?: Record<string, string | string[] | undefined>;
  body?: unknown;
};
type QaTestSessionResponse = { status: number; body: Record<string, unknown> };
type AdminClient = ReturnType<typeof createSupabaseAdminClient>;
type StorageBucket = ReturnType<AdminClient["storage"]["from"]>;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const PAGE_SIZE = 100;
const MAX_OBJECTS = 200;
const MAX_LIST_CALLS = 16;
const MAX_DEPTH = 3;

export async function createQaTestSessionResponse(request: QaTestSessionRequest, env: Record<string, string | undefined>, now = Date.now()): Promise<QaTestSessionResponse> {
  const fail = qaTestFailure;
  if (request.method !== "POST" && request.method !== "DELETE") return fail(405, "method_not_allowed");
  const gate = validateQaTestCapability(readQaTestCapability(request.headers), env, request.method, now);
  if (gate) return gate;
  if (!isEmptyBody(request.body)) return fail(400, "invalid_request");
  const session = request.headers?.["x-qa-session"];
  if (request.method === "DELETE" && (typeof session !== "string" || session.length > 16_384 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(session))) return fail(401, "missing_session");
  const url = env.SUPABASE_URL?.trim() || env.VITE_SUPABASE_URL?.trim();
  const key = getSupabaseAdminKey(env);
  if (!url || !key) return fail(500, "not_configured");

  try {
    const client = createSupabaseAdminClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    if (request.method === "POST") {
      // Admin generateLink creates a link only; it does not send an email.
      const { data, error } = await client.auth.admin.generateLink({ type: "magiclink", email: QA_TEST_EMAIL });
      const hash = data?.properties?.hashed_token;
      if (error || !isTestUser(data?.user) || typeof hash !== "string" || !/^[A-Za-z0-9_-]{16,512}$/.test(hash)) return fail(502, "test_session_failed");
      // Reserve only two of the ordinary five free scans for this disposable account.
      // On a repeat login, never reset usage or replenish consumed credits.
      const allowanceTable = client.from("free_scan_usage") as unknown as {
        upsert(values: { user_id: string; scans_used: number }, options: { onConflict: "user_id"; ignoreDuplicates: true }): PromiseLike<{ error: unknown }>;
      };
      const allowance = await allowanceTable.upsert(
        { user_id: data.user.id, scans_used: 3 },
        { onConflict: "user_id", ignoreDuplicates: true },
      );
      if (allowance.error) return fail(502, "test_session_failed");
      return { status: 200, body: { token_hash: hash, userId: data.user.id } };
    }

    const jwt = session as string;
    const { data, error } = await client.auth.getUser(jwt);
    if (error || !isTestUser(data?.user)) return fail(403, "wrong_test_account");
    const userId = data.user.id;
    const deadline = Date.now() + 60_000;
    const bucket = client.storage.from("scan-images");
    // Discover every safe path before any deletion; offsets cannot skip objects as they are removed.
    const paths = await collectOwnedPaths(bucket, userId, deadline);
    if ((await client.auth.admin.signOut(jwt, "global")).error) return fail(502, "test_cleanup_failed");
    for (let index = 0; index < paths.length; index += PAGE_SIZE) {
      checkDeadline(deadline);
      if ((await bucket.remove(paths.slice(index, index + PAGE_SIZE))).error) return fail(502, "test_cleanup_failed");
    }
    // These two foreign keys SET NULL; remove only this account's records before Auth deletion.
    for (const table of ["feedback_submissions", "waitlist_signups"]) {
      checkDeadline(deadline);
      if ((await client.from(table).delete().eq("user_id", userId)).error) return fail(502, "test_cleanup_failed");
    }
    checkDeadline(deadline);
    if ((await client.auth.admin.deleteUser(userId)).error) return fail(502, "test_cleanup_failed");
    return { status: 200, body: { cleaned: true, userId, removedObjects: paths.length } };
  } catch {
    return fail(502, request.method === "POST" ? "test_session_failed" : "test_cleanup_failed");
  }
}

function isEmptyBody(body: unknown) {
  if (body === undefined) return true;
  try {
    const value: unknown = typeof body === "string" && body.length <= 64 ? JSON.parse(body) : body;
    return Boolean(value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0);
  } catch { return false; }
}

function isTestUser(user: { id: string; email?: string; is_anonymous?: boolean } | null | undefined): user is { id: string; email: string; is_anonymous: false } {
  return Boolean(user && UUID.test(user.id) && user.email === QA_TEST_EMAIL && user.is_anonymous === false);
}

function checkDeadline(deadline: number) {
  if (Date.now() >= deadline) throw new Error("Cleanup deadline reached.");
}

async function collectOwnedPaths(bucket: StorageBucket, userId: string, deadline: number) {
  const paths: string[] = [];
  const visited = new Set<string>();
  const queue = [{ prefix: userId, depth: 0 }];
  let calls = 0;
  while (queue.length) {
    const { prefix, depth } = queue.shift()!;
    if (visited.has(prefix) || depth > MAX_DEPTH || (prefix !== userId && !prefix.startsWith(`${userId}/`))) throw new Error("Unsafe cleanup prefix.");
    visited.add(prefix);
    for (let offset = 0; ; offset += PAGE_SIZE) {
      checkDeadline(deadline);
      if (++calls > MAX_LIST_CALLS) throw new Error("Cleanup listing limit reached.");
      const { data, error } = await bucket.list(prefix, { limit: PAGE_SIZE, offset, sortBy: { column: "name", order: "asc" } });
      if (error || !Array.isArray(data) || data.length > PAGE_SIZE) throw new Error("Cleanup listing unavailable.");
      for (const entry of data) {
        if (!entry || typeof entry.name !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(entry.name)) throw new Error("Unsafe cleanup path.");
        const path = `${prefix}/${entry.name}`;
        if (entry.id === null) {
          if (queue.length + visited.size >= MAX_LIST_CALLS) throw new Error("Cleanup folder limit reached.");
          queue.push({ prefix: path, depth: depth + 1 });
        } else if (typeof entry.id === "string" && entry.id) {
          if (paths.length >= MAX_OBJECTS) throw new Error("Cleanup object limit reached.");
          paths.push(path);
        } else throw new Error("Unknown cleanup entry.");
      }
      if (data.length < PAGE_SIZE) break;
    }
  }
  return paths;
}
