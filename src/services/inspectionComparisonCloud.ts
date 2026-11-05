import type { SupabaseClient } from "@supabase/supabase-js";
import { getAccountScope, isAccountScopeCurrent, type AccountScope } from "../lib/accountScope";
import { MAX_INSPECTION_COMPARISON_BYTES, MAX_INSPECTION_COMPARISONS, mergeInspectionComparisons, normalizeInspectionComparison, normalizeInspectionComparisons } from "../lib/inspectionComparison";
import type { InspectionComparison } from "../types/inspectionComparison";
import { getAuthClient } from "./auth";
import { assertCloudSyncEnabled } from "./cloudSyncPolicy";
import { importInspectionComparisons } from "./inspectionComparisonStore";

const TABLE = "inspection_comparisons";
const PAGE_SIZE = 25;
const TIMEOUT_MS = 20_000;
const changed = () => new Error("Account changed. Reopen the scan in the account that owns these comparisons.");
const invalid = () => new Error("Cloud comparisons are invalid, incomplete or exceed their limits. Nothing was discarded; your device history is preserved.");
function guard(scope: AccountScope, signal?: AbortSignal) {
  if (!isAccountScopeCurrent(scope)) throw changed();
  if (signal?.aborted) throw new Error("Comparison loading was canceled.");
}
function requireId(id: string) {
  if (!/^[A-Za-z0-9._:-]{1,160}$/.test(id) || id === "." || id === "..") throw new Error("This saved scan reference is invalid.");
}
async function bounded<T>(scope: AccountScope, signal: AbortSignal | undefined, operation: (signal: AbortSignal) => PromiseLike<T>): Promise<T> {
  guard(scope, signal);
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined, cancel: (() => void) | undefined;
  try {
    const deadline = new Promise<never>((_, reject) => {
      cancel = () => { controller.abort(); reject(new Error("Comparison loading was canceled.")); };
      signal?.addEventListener("abort", cancel, { once: true });
      timer = setTimeout(() => { controller.abort(); reject(new Error("The cloud comparison request timed out. Your device history is preserved. Retry to check whether any immutable records were accepted.")); }, TIMEOUT_MS);
    });
    const result = await Promise.race([Promise.resolve(operation(controller.signal)), deadline]);
    guard(scope, signal); return result;
  } finally { clearTimeout(timer); if (cancel) signal?.removeEventListener("abort", cancel); }
}
async function verifiedClient(scope: AccountScope, signal?: AbortSignal): Promise<SupabaseClient> {
  assertCloudSyncEnabled();
  const client = await bounded(scope, signal, () => getAuthClient());
  if (!client) throw new Error("Cloud comparisons are not configured for this build. Your device history is preserved.");
  // getUser validates the session with Auth, rather than trusting cached claims.
  const verified = await bounded(scope, signal, () => client.auth.getUser());
  const user = verified.data.user;
  if (verified.error || !user || user.id !== scope.userId || user.is_anonymous === true
    || (!user.email_confirmed_at && !user.phone_confirmed_at)) {
    throw new Error("Sign in to the verified account that owns this scan before loading or syncing comparisons.");
  }
  return client;
}
function databaseError(error: { code?: string }) {
  if (["42P01", "PGRST205", "42703", "PGRST204"].includes(error.code ?? "")) return new Error("Cloud comparisons require the inspection-comparisons database migration. Your device history is preserved.");
  if (error.code === "23503") return new Error("Save both source scans to the cloud in this account, then retry syncing the comparison. Your device history is preserved.");
  return new Error("Cloud comparisons could not be loaded or saved. Check your connection and account access, then retry. Your device history is preserved.");
}
function checkedRow(row: unknown, lookupId: string, scope: AccountScope): InspectionComparison {
  if (!row || typeof row !== "object") throw invalid();
  const value = row as { id?: unknown; user_id?: unknown; lookup_id?: unknown; record_json?: unknown };
  const record = normalizeInspectionComparison(value.record_json);
  if (!record || value.user_id !== scope.userId || value.lookup_id !== lookupId || record.lookupId !== lookupId || record.id !== value.id) throw invalid();
  return record;
}
async function readRemote(client: SupabaseClient, lookupId: string, scope: AccountScope, signal?: AbortSignal): Promise<InspectionComparison[]> {
  const records: InspectionComparison[] = [];
  let cursor: string | undefined;
  while (true) {
    const response = await bounded(scope, signal, (requestSignal) => {
      let query = client.from(TABLE).select("id,user_id,lookup_id,record_json").eq("user_id", scope.userId)
        .eq("lookup_id", lookupId).order("id", { ascending: true }).limit(PAGE_SIZE).abortSignal(requestSignal);
      if (cursor) query = query.gt("id", cursor);
      return query;
    });
    if (response.error) throw databaseError(response.error);
    if (!Array.isArray(response.data) || response.data.length > PAGE_SIZE) throw invalid();
    for (const row of response.data) {
      const record = checkedRow(row, lookupId, scope);
      if (cursor && record.id <= cursor) throw invalid();
      records.push(record); cursor = record.id;
      if (records.length > MAX_INSPECTION_COMPARISONS || new TextEncoder().encode(JSON.stringify(records)).byteLength > MAX_INSPECTION_COMPARISON_BYTES) throw invalid();
    }
    if (response.data.length < PAGE_SIZE) break;
  }
  const normalized = normalizeInspectionComparisons(records, lookupId);
  if (!normalized) throw invalid();
  return normalized;
}

/** Explicit read only. No import, automatic parent upload or history replacement. */
export async function readCloudInspectionComparisons(lookupId: string, scope = getAccountScope(), signal?: AbortSignal): Promise<InspectionComparison[]> {
  requireId(lookupId); guard(scope, signal);
  const client = await verifiedClient(scope, signal);
  return readRemote(client, lookupId, scope, signal);
}

export async function syncInspectionComparisons(lookupId: string, scope = getAccountScope()): Promise<{ synced: number; message: string }> {
  requireId(lookupId); guard(scope);
  const client = await verifiedClient(scope);
  const remote = await readRemote(client, lookupId, scope);
  // Fresh transaction unions both sets. A concurrent local append cannot be lost
  // to this remote response or to a later upload acknowledgment.
  const snapshot = await importInspectionComparisons(lookupId, remote, scope); guard(scope);
  const known = new Map(remote.map((record) => [record.id, record]));
  const pending = snapshot.filter((record) => !known.has(record.id));
  // Historical comparisons remain readable after source removal. New entries
  // require both originals' scans to be owned and cloud-saved; never upload them here.
  const sourceIds = [...new Set(pending.flatMap((record) => [record.earlier.lookupId, record.current.lookupId]))];
  if (sourceIds.length) {
    const parents = await bounded(scope, undefined, (signal) => client.from("scan_lookups").select("user_id,local_id")
      .eq("user_id", scope.userId).in("local_id", sourceIds).limit(sourceIds.length + 1).abortSignal(signal));
    if (parents.error) throw databaseError(parents.error);
    if (!Array.isArray(parents.data) || parents.data.length !== sourceIds.length || new Set(parents.data.map((row) => row.local_id)).size !== sourceIds.length
      || parents.data.some((row) => row.user_id !== scope.userId || !sourceIds.includes(row.local_id))) {
      throw new Error("Save both source scans to the cloud in this account before syncing a new comparison. No source photos were uploaded; your device history is preserved.");
    }
  }
  let synced = 0;
  while (pending.length) {
    guard(scope);
    const index = pending.findIndex((record) => !record.supersedesId || known.has(record.supersedesId));
    if (index < 0) throw invalid();
    const record = pending[index];
    const inserted = await bounded(scope, undefined, (signal) => client.from(TABLE)
      .insert({ user_id: scope.userId, id: record.id, lookup_id: lookupId, record_json: record })
      .select("id,user_id,lookup_id,record_json").abortSignal(signal).maybeSingle());
    if (inserted.error && inserted.error.code !== "23505") throw databaseError(inserted.error);
    let saved: InspectionComparison;
    if (inserted.error?.code === "23505") {
      const existing = await bounded(scope, undefined, (signal) => client.from(TABLE).select("id,user_id,lookup_id,record_json")
        .eq("user_id", scope.userId).eq("id", record.id).abortSignal(signal).maybeSingle());
      if (existing.error) throw databaseError(existing.error);
      saved = checkedRow(existing.data, lookupId, scope);
    } else saved = checkedRow(inserted.data, lookupId, scope);
    // Union verifies canonical same-ID equality; collisions never become upserts.
    mergeInspectionComparisons(snapshot, [saved], lookupId);
    known.set(saved.id, saved); pending.splice(index, 1); synced += 1;
  }
  const confirmed = await readRemote(client, lookupId, scope);
  const combined = mergeInspectionComparisons(snapshot, confirmed, lookupId);
  if (snapshot.some((record) => !confirmed.some((entry) => entry.id === record.id))) {
    throw new Error("Cloud comparisons were not fully confirmed. Your device history is preserved. Retry to verify the accepted records.");
  }
  await importInspectionComparisons(lookupId, combined, scope); guard(scope);
  return { synced, message: `Cloud confirmed ${snapshot.length} comparison${snapshot.length === 1 ? "" : "s"} from this save. Later device records require another sync.` };
}
