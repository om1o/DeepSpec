import { getAccountScope, isAccountScopeCurrent, type AccountScope } from "../lib/accountScope";
import { mergeDiagnosticBundles, normalizeDiagnosticAssociation, normalizeDiagnosticBundle } from "../lib/diagnosticAssociation";
import { diagnosticEntryIds, normalizeDiagnosticDocument, verifyDiagnosticDocument } from "../lib/diagnosticReport";
import type { DiagnosticAssociation, DiagnosticBundle, DiagnosticDocument, ParsedDiagnosticReport } from "../types/diagnosticReport";
import { DIAGNOSTIC_REPORT_STORE, EVIDENCE_STORAGE_TIMEOUT_MS, openEvidenceDatabase } from "./evidenceDb";

export const DIAGNOSTIC_REPORTS_CHANGED = "deep-spec:diagnostic-reports-changed";
const CHANNEL = "deep-spec:diagnostic-reports";
const invalid = () => new Error("Saved diagnostic originals or associations could not be verified. They were preserved; do not clear browser data. Recover the original files before retrying.");
const empty = (): DiagnosticBundle => ({ documents: [], associations: [] });
function requireScope(scope: AccountScope) {
  if (!scope.userId || !isAccountScopeCurrent(scope)) throw new Error("Account changed. Reopen the scan in the account that owns these diagnostic reports.");
}
function requireId(id: string) {
  if (!/^[A-Za-z0-9._:-]{1,160}$/.test(id) || id === "." || id === "..") throw new Error("This saved scan reference is invalid.");
}
function notify(lookupId: string, scope: AccountScope) {
  if (!isAccountScopeCurrent(scope)) return;
  const detail = { owner: scope.userId, lookupId };
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(DIAGNOSTIC_REPORTS_CHANGED, { detail }));
  if (typeof BroadcastChannel !== "undefined") {
    try { const channel = new BroadcastChannel(CHANNEL); channel.postMessage(detail); channel.close(); }
    catch { /* Notification failure cannot undo committed evidence. */ }
  }
}
export function subscribeDiagnosticReports(listener: (lookupId: string) => void, scope = getAccountScope()): () => void {
  const receive = (value: unknown) => {
    if (!isAccountScopeCurrent(scope) || !value || typeof value !== "object") return;
    const change = value as { owner?: unknown; lookupId?: unknown };
    if (change.owner === scope.userId && typeof change.lookupId === "string") listener(change.lookupId);
  };
  const local = (event: Event) => receive((event as CustomEvent).detail);
  if (typeof window !== "undefined") window.addEventListener(DIAGNOSTIC_REPORTS_CHANGED, local);
  let channel: BroadcastChannel | undefined;
  if (typeof BroadcastChannel !== "undefined") {
    try { channel = new BroadcastChannel(CHANNEL); channel.onmessage = (event) => receive(event.data); }
    catch { /* Same-tab events remain available. */ }
  }
  return () => { if (typeof window !== "undefined") window.removeEventListener(DIAGNOSTIC_REPORTS_CHANGED, local); channel?.close(); };
}

type VerificationCache = Map<string, Promise<ParsedDiagnosticReport>>;
async function verify(bundle: DiagnosticBundle, lookupId: string, cache: VerificationCache): Promise<DiagnosticBundle> {
  const normalized = normalizeDiagnosticBundle(bundle, lookupId);
  if (!normalized) throw invalid();
  const entries = new Map<string, Set<string>>();
  // Sequential verification bounds temporary parser/decoder memory for large imports.
  for (const document of normalized.documents) {
    const key = JSON.stringify(document);
    let pending = cache.get(key);
    if (!pending) { pending = verifyDiagnosticDocument(document); cache.set(key, pending); }
    entries.set(document.id, new Set(diagnosticEntryIds(await pending)));
  }
  for (const association of normalized.associations) if (association.entryIds.some((id) => !entries.get(association.documentId)?.has(id))) {
    throw new Error("A diagnostic association names entries that are absent from its exact original report. The original and saved history were preserved.");
  }
  return normalized;
}

/** No storage mutation or account lookup: callers own their account-boundary checks. */
export function verifyDiagnosticBundle(bundle: DiagnosticBundle, lookupId: string): Promise<DiagnosticBundle> {
  return verify(structuredClone(bundle), lookupId, new Map());
}

type Snapshot = { raw: unknown; signature: string | undefined };
type TransactionResult = Snapshot & { matched: boolean };
function signature(raw: unknown): string | undefined { try { return JSON.stringify(raw); } catch { throw invalid(); } }

/** Only synchronous IDB callbacks. Hashing/parsing always happens after the read
 * transaction closes; a second transaction compares the exact bucket before use. */
async function transaction(lookupId: string, scope: AccountScope, check?: { expected: string | undefined; next?: DiagnosticBundle }): Promise<TransactionResult> {
  requireId(lookupId); requireScope(scope);
  const database = await openEvidenceDatabase();
  try { requireScope(scope); } catch (error) { database.close(); throw error; }
  return new Promise((resolve, reject) => {
    let tx: IDBTransaction | undefined, failure: Error | undefined;
    let settled = false, changed = false;
    let result: TransactionResult = { raw: undefined, signature: undefined, matched: false };
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true; clearTimeout(timer); database.close();
      if (error) reject(error); else { if (changed) notify(lookupId, scope); resolve(result); }
    };
    const fail = (error: unknown) => { failure = error instanceof Error ? error : invalid(); try { tx?.abort(); } catch { /* Already settled. */ } finish(failure); };
    const timer = setTimeout(() => fail(new Error("Diagnostic storage stalled. Previous originals were preserved. Reopen the scan and retry.")), EVIDENCE_STORAGE_TIMEOUT_MS);
    try {
      tx = database.transaction(DIAGNOSTIC_REPORT_STORE, check?.next ? "readwrite" : "readonly");
      const store = tx.objectStore(DIAGNOSTIC_REPORT_STORE), key = [scope.userId!, lookupId], request = store.get(key);
      request.onsuccess = () => {
        try {
          requireScope(scope);
          const raw: unknown = request.result, currentSignature = signature(raw);
          result = { raw, signature: currentSignature, matched: !check || check.expected === currentSignature };
          if (check?.next && result.matched && JSON.stringify(check.next) !== currentSignature) {
            requireScope(scope); store.put(check.next, key); changed = true;
          }
        } catch (error) { fail(error); }
      };
      tx.oncomplete = () => { try { requireScope(scope); finish(); } catch (error) { finish(error as Error); } };
      tx.onerror = () => finish(failure ?? new Error("Diagnostic evidence could not be saved. Free device space and retry; previous originals were preserved."));
      tx.onabort = () => finish(failure ?? new Error("Diagnostic storage was interrupted. Previous originals were preserved."));
    } catch (error) { fail(error); }
  });
}

async function operate(lookupId: string, scope: AccountScope, merge?: (current: DiagnosticBundle) => DiagnosticBundle): Promise<DiagnosticBundle> {
  requireId(lookupId); requireScope(scope);
  const cache: VerificationCache = new Map();
  let snapshot: Snapshot = await transaction(lookupId, scope);
  for (let attempt = 0; attempt < 8; attempt++) {
    const normalized = normalizeDiagnosticBundle(snapshot.raw === undefined ? empty() : snapshot.raw, lookupId);
    if (!normalized) throw invalid();
    const current = await verify(normalized, lookupId, cache);
    requireScope(scope);
    const candidate = merge ? await verify(merge(current), lookupId, cache) : current;
    requireScope(scope);
    const checked = await transaction(lookupId, scope, { expected: snapshot.signature, ...(merge ? { next: candidate } : {}) });
    if (checked.matched) return structuredClone(candidate);
    // Another tab committed during crypto/parse. Verify and merge that exact
    // newer bucket, never replace it with the earlier snapshot.
    snapshot = checked;
  }
  throw new Error("Diagnostic history kept changing in another tab. Your existing originals are intact; reopen the history and retry.");
}

export function readDiagnosticBundle(lookupId: string, scope = getAccountScope()): Promise<DiagnosticBundle> {
  return operate(lookupId, scope);
}
export function appendDiagnosticDocument(document: DiagnosticDocument, scope = getAccountScope()): Promise<DiagnosticBundle> {
  const checked = normalizeDiagnosticDocument(document);
  if (!checked) return Promise.reject(new Error("This diagnostic original has invalid metadata or bytes. Keep the original file and import it again."));
  return operate(checked.lookupId, scope, (current) => mergeDiagnosticBundles(current, { documents: [checked], associations: [] }, checked.lookupId));
}
export function appendDiagnosticAssociation(record: DiagnosticAssociation, scope = getAccountScope()): Promise<DiagnosticBundle> {
  const checked = normalizeDiagnosticAssociation(record);
  if (!checked) return Promise.reject(new Error("Complete this diagnostic association and its supporting details before saving."));
  return operate(checked.lookupId, scope, (current) => {
    if (!current.associations.some((entry) => entry.id === checked.id) && checked.supersedesId
      && current.associations.some((entry) => entry.supersedesId === checked.supersedesId)) {
      throw new Error("This association was already corrected in another view. Your draft remains; reload the history before correcting its current version.");
    }
    return mergeDiagnosticBundles(current, { documents: [], associations: [checked] }, checked.lookupId);
  });
}
/** Union imports preserve divergent corrections instead of silently choosing one. */
export function importDiagnosticBundle(lookupId: string, bundle: DiagnosticBundle, scope = getAccountScope()): Promise<DiagnosticBundle> {
  const incoming = structuredClone(bundle);
  return operate(lookupId, scope, (current) => mergeDiagnosticBundles(current, incoming, lookupId));
}
