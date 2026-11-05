import type { SupabaseClient } from "@supabase/supabase-js";
import { getAccountScope, isAccountScopeCurrent, type AccountScope } from "../lib/accountScope";
import { MAX_DIAGNOSTIC_BUNDLE_BYTES, MAX_DIAGNOSTIC_DOCUMENTS, MAX_DIAGNOSTIC_ASSOCIATIONS, mergeDiagnosticBundles, normalizeDiagnosticAssociation } from "../lib/diagnosticAssociation";
import { normalizeDiagnosticDocument } from "../lib/diagnosticReport";
import type { DiagnosticBundle, DiagnosticDocument, DiagnosticAssociation } from "../types/diagnosticReport";
import { getAuthClient } from "./auth";
import { assertCloudSyncEnabled } from "./cloudSyncPolicy";
import { importDiagnosticBundle, verifyDiagnosticBundle } from "./diagnosticReportStore";

const TABLE = "diagnostic_reports";
const PAGE_SIZE = 4;
const TIMEOUT_MS = 20_000;
type Row = { user_id: string; id: string; lookup_id: string; kind: "document" | "association"; record_json: DiagnosticDocument | DiagnosticAssociation };
const invalid = () => new Error("Cloud diagnostic records are invalid, incomplete or exceed their limits. Your device evidence is preserved.");
function guard(scope: AccountScope, signal?: AbortSignal) {
  if (!isAccountScopeCurrent(scope)) throw new Error("Account changed. Reopen this inspection in its original account.");
  if (signal?.aborted) throw new Error("Diagnostic loading was canceled.");
}
function requireId(id: string) {
  if (typeof id !== "string" || !/^[A-Za-z0-9._:-]{1,160}$/.test(id) || id === "." || id === "..") throw new Error("Reopen a valid saved scan before loading diagnostics.");
}
async function bounded<T>(scope: AccountScope, signal: AbortSignal | undefined, operation: (signal: AbortSignal) => PromiseLike<T>): Promise<T> {
  guard(scope, signal);
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined, cancel: (() => void) | undefined;
  try {
    const deadline = new Promise<never>((_, reject) => {
      cancel = () => { controller.abort(); reject(new Error("Diagnostic loading was canceled.")); };
      signal?.addEventListener("abort", cancel, { once: true });
      timer = setTimeout(() => { controller.abort(); reject(new Error("Cloud diagnostics timed out. Your device records are preserved; retry to check what was accepted.")); }, TIMEOUT_MS);
    });
    const result = await Promise.race([Promise.resolve(operation(controller.signal)), deadline]);
    guard(scope, signal); return result;
  } finally { clearTimeout(timer); if (cancel) signal?.removeEventListener("abort", cancel); }
}
/** Rejected SDK/transport promises can contain private URLs or response details.
 * Keep those out of user-facing errors; our own timeout/account guards stay intact. */
function remoteRequest<T>(scope: AccountScope, signal: AbortSignal | undefined, operation: (signal: AbortSignal) => PromiseLike<T>): Promise<T> {
  return bounded(scope, signal, async (requestSignal) => {
    try { return await operation(requestSignal); }
    catch { throw databaseError({}); }
  });
}
async function verifiedClient(scope: AccountScope, signal?: AbortSignal): Promise<SupabaseClient> {
  assertCloudSyncEnabled();
  const client = await remoteRequest(scope, signal, () => getAuthClient());
  if (!client) throw new Error("Cloud diagnostic storage is not configured for this build. Your device evidence is preserved.");
  const verified = await remoteRequest(scope, signal, () => client.auth.getUser());
  const user = verified.data.user;
  if (verified.error || !user || user.id !== scope.userId || user.is_anonymous === true || (!user.email_confirmed_at && !user.phone_confirmed_at)) {
    throw new Error("Sign in to the verified account that owns this inspection before loading or syncing diagnostics.");
  }
  return client;
}
function databaseError(error: { code?: string }) {
  if (["42P01", "PGRST205", "42703", "PGRST204"].includes(error.code ?? "")) return new Error("Cloud diagnostics require the diagnostic-reports database migration. Your device records are preserved.");
  if (error.code === "23503") return new Error("Save this scan to the cloud in this account, then retry diagnostic sync. Your device records are preserved.");
  return new Error("Cloud diagnostics could not be read or saved. Check your connection and account access; your device records are preserved.");
}
function checkedRow(value: unknown, lookupId: string, scope: AccountScope): Row {
  if (!value || typeof value !== "object") throw invalid();
  const row = value as Partial<Row>;
  const record = row.kind === "document" ? normalizeDiagnosticDocument(row.record_json, lookupId)
    : row.kind === "association" ? normalizeDiagnosticAssociation(row.record_json) : null;
  if (!record || row.user_id !== scope.userId || row.lookup_id !== lookupId || record.lookupId !== lookupId || record.id !== row.id) throw invalid();
  return { user_id: row.user_id, lookup_id: lookupId, id: record.id, kind: row.kind!, record_json: record };
}
function rows(bundle: DiagnosticBundle, scope: AccountScope): Row[] {
  return [
    ...bundle.documents.map((record): Row => ({ user_id: scope.userId!, id: record.id, lookup_id: record.lookupId, kind: "document", record_json: record })),
    ...bundle.associations.map((record): Row => ({ user_id: scope.userId!, id: record.id, lookup_id: record.lookupId, kind: "association", record_json: record })),
  ];
}
function bundleOf(values: Row[]): DiagnosticBundle {
  return { documents: values.filter((row) => row.kind === "document").map((row) => row.record_json as DiagnosticDocument),
    associations: values.filter((row) => row.kind === "association").map((row) => row.record_json as DiagnosticAssociation) };
}
async function readRemote(client: SupabaseClient, lookupId: string, scope: AccountScope, signal?: AbortSignal): Promise<DiagnosticBundle> {
  const records: Row[] = [];
  let cursor: string | undefined, bytes = 0, documents = 0, associations = 0;
  while (true) {
    const response = await remoteRequest(scope, signal, (requestSignal) => {
      let query = client.from(TABLE).select("id,user_id,lookup_id,kind,record_json").eq("user_id", scope.userId).eq("lookup_id", lookupId)
        .order("id", { ascending: true }).limit(PAGE_SIZE).abortSignal(requestSignal);
      if (cursor) query = query.gt("id", cursor);
      return query;
    });
    if (response.error) throw databaseError(response.error);
    if (!Array.isArray(response.data) || response.data.length > PAGE_SIZE) throw invalid();
    for (const value of response.data) {
      const row = checkedRow(value, lookupId, scope);
      if (cursor && row.id <= cursor) throw invalid();
      if (row.kind === "document") documents += 1; else associations += 1;
      bytes += new TextEncoder().encode(JSON.stringify(row.record_json)).byteLength;
      if (bytes > MAX_DIAGNOSTIC_BUNDLE_BYTES || documents > MAX_DIAGNOSTIC_DOCUMENTS || associations > MAX_DIAGNOSTIC_ASSOCIATIONS) throw invalid();
      records.push(row); cursor = row.id;
    }
    if (response.data.length < PAGE_SIZE) break;
  }
  const verified = await bounded(scope, signal, () => verifyDiagnosticBundle(bundleOf(records), lookupId));
  guard(scope, signal); return verified;
}

/** Explicit read; never imports a response or uploads parent scans implicitly. */
export async function readCloudDiagnosticBundle(lookupId: string, scope = getAccountScope(), signal?: AbortSignal): Promise<DiagnosticBundle> {
  requireId(lookupId); guard(scope, signal);
  const client = await verifiedClient(scope, signal);
  return readRemote(client, lookupId, scope, signal);
}

export async function syncDiagnosticReports(lookupId: string, scope = getAccountScope()): Promise<{ synced: number; message: string }> {
  requireId(lookupId); guard(scope);
  const client = await verifiedClient(scope);
  const remote = await readRemote(client, lookupId, scope);
  const snapshot = await importDiagnosticBundle(lookupId, remote, scope); guard(scope);
  const known = new Map(rows(remote, scope).map((row) => [row.id, row]));
  const pending = rows(snapshot, scope).filter((row) => !known.has(row.id));
  if (pending.length) {
    const parent = await remoteRequest(scope, undefined, (signal) => client.from("scan_lookups").select("user_id,local_id")
      .eq("user_id", scope.userId).eq("local_id", lookupId).abortSignal(signal).maybeSingle());
    if (parent.error) throw databaseError(parent.error);
    if (!parent.data || parent.data.user_id !== scope.userId || parent.data.local_id !== lookupId) throw new Error("Save this scan to the cloud in this account before diagnostic sync. No photos were uploaded; your device evidence is preserved.");
  }
  let synced = 0;
  while (pending.length) {
    guard(scope);
    const index = pending.findIndex((row) => row.kind === "document" || (() => {
      const association = row.record_json as DiagnosticAssociation;
      return known.has(association.documentId) && (!association.supersedesId || known.has(association.supersedesId));
    })());
    if (index < 0) throw invalid();
    const row = pending[index];
    const inserted = await remoteRequest(scope, undefined, (signal) => client.from(TABLE).insert(row)
      .select("id,user_id,lookup_id,kind,record_json").abortSignal(signal).maybeSingle());
    if (inserted.error && inserted.error.code !== "23505") throw databaseError(inserted.error);
    let saved: Row;
    if (inserted.error?.code === "23505") {
      const existing = await remoteRequest(scope, undefined, (signal) => client.from(TABLE).select("id,user_id,lookup_id,kind,record_json")
        .eq("user_id", scope.userId).eq("id", row.id).abortSignal(signal).maybeSingle());
      if (existing.error) throw databaseError(existing.error);
      saved = checkedRow(existing.data, lookupId, scope);
    } else saved = checkedRow(inserted.data, lookupId, scope);
    if (saved.kind !== row.kind || JSON.stringify(saved.record_json) !== JSON.stringify(row.record_json)) throw new Error("A cloud diagnostic ID has conflicting content. Neither immutable version was overwritten.");
    known.set(saved.id, saved); pending.splice(index, 1); synced += 1;
  }
  const confirmed = await readRemote(client, lookupId, scope);
  const combined = mergeDiagnosticBundles(snapshot, confirmed, lookupId);
  const confirmedIds = new Set(rows(confirmed, scope).map((row) => row.id));
  if (rows(snapshot, scope).some((row) => !confirmedIds.has(row.id))) throw new Error("Cloud diagnostics were not fully confirmed. Your device records remain; retry to verify the accepted entries.");
  await importDiagnosticBundle(lookupId, combined, scope); guard(scope);
  return { synced, message: `Cloud confirmed ${snapshot.documents.length} original report(s) and ${snapshot.associations.length} human association(s). Later device changes require another sync.` };
}
