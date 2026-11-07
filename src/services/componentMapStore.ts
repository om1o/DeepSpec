import { getAccountScope, isAccountScopeCurrent, type AccountScope } from "../lib/accountScope";
import { ComponentMapError, componentMapBindingsPreserved, linkComponentMapDocument, mapOverviewSourcesMatch, normalizeComponentCaptureTarget, normalizeComponentMap, normalizeComponentMapRecord } from "../lib/componentMap";
import type { ComponentCaptureTarget, ComponentMap, ComponentMapGroupBinding, ComponentMapRecord } from "../types/componentMap";
import { COMPONENT_MAP_STORE, EVIDENCE_STORAGE_TIMEOUT_MS, openEvidenceDatabase } from "./evidenceDb";
import { assertMapOverviewGuardCurrent, type MapOverviewSaveGuard } from "./mapOverviewEvidence";
import { assertLinkedPhotoGuardCurrent, type LinkedPhotoSaveGuard } from "./linkedPhotoEvidence";

export { ComponentMapError } from "../lib/componentMap";
export const COMPONENT_MAPS_CHANGED = "deep-spec:component-maps-changed";
const CHANNEL = "deep-spec:component-maps";
type Change = { owner: string; mapId: string };

function requireScope(scope: AccountScope) {
  if (!isAccountScopeCurrent(scope)) throw new ComponentMapError("account_changed", "Sign in to the account that owns this component map.");
}

function validMapId(mapId: string) {
  if (!/^[a-zA-Z0-9._:-]{1,160}$/.test(mapId)) throw new ComponentMapError("invalid_map", "This component map reference is invalid.");
}

function notify(mapId: string, scope: AccountScope) {
  if (!isAccountScopeCurrent(scope)) return;
  const detail: Change = { owner: scope.userId!, mapId };
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(COMPONENT_MAPS_CHANGED, { detail }));
  if (typeof BroadcastChannel !== "undefined") {
    try { const channel = new BroadcastChannel(CHANNEL); channel.postMessage(detail); channel.close(); }
    catch { /* A committed local write must not fail because notifications are unavailable. */ }
  }
}

export function subscribeComponentMaps(listener: (mapId: string) => void, scope = getAccountScope()): () => void {
  const receive = (value: unknown) => {
    if (!isAccountScopeCurrent(scope) || !value || typeof value !== "object") return;
    const change = value as Partial<Change>;
    if (change.owner === scope.userId && typeof change.mapId === "string") listener(change.mapId);
  };
  const onLocal = (event: Event) => receive((event as CustomEvent).detail);
  if (typeof window !== "undefined") window.addEventListener(COMPONENT_MAPS_CHANGED, onLocal);
  let channel: BroadcastChannel | undefined;
  if (typeof BroadcastChannel !== "undefined") {
    try { channel = new BroadcastChannel(CHANNEL); channel.onmessage = (event) => receive(event.data); }
    catch { /* Same-tab notification still works without BroadcastChannel. */ }
  }
  return () => { if (typeof window !== "undefined") window.removeEventListener(COMPONENT_MAPS_CHANGED, onLocal); channel?.close(); };
}

type Mutation<T> = (current: ComponentMapRecord | null) => { record: ComponentMapRecord | null; result: T };

function hasNewBoundGroups(before: ComponentMap | undefined, after: ComponentMap) {
  return after.components.some((component) => component.scanGroups.some((group) => group.binding
    && !before?.components.find((item) => item.id === component.id)?.scanGroups.some((prior) => prior.linkId === group.linkId && prior.binding)));
}

async function transaction<T>(mapId: string, mode: IDBTransactionMode, mutate: Mutation<T>, scope: AccountScope): Promise<T> {
  validMapId(mapId);
  requireScope(scope);
  const database = await openEvidenceDatabase().catch((error: unknown) => {
    throw new ComponentMapError("storage_unavailable", error instanceof Error ? error.message : "Inspection storage is unavailable.");
  });
  try { requireScope(scope); } catch (error) { database.close(); throw error; }
  return new Promise<T>((resolve, reject) => {
    let tx: IDBTransaction | undefined;
    let settled = false;
    let result: T;
    let changed = false;
    let failure: Error | undefined;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      database.close();
      if (error) reject(error); else { if (changed) notify(mapId, scope); resolve(result); }
    };
    const fail = (error: unknown) => {
      failure = error instanceof Error ? error : new ComponentMapError("storage_unavailable", "The map could not be saved. Its previous version is preserved.");
      try { tx?.abort(); } catch { /* Already completed or aborted. */ }
      finish(failure);
    };
    const timer = setTimeout(() => fail(new ComponentMapError("storage_unavailable", "Saving the component map stalled. Reopen DeepSpec and retry.")), EVIDENCE_STORAGE_TIMEOUT_MS);
    try {
      tx = database.transaction(COMPONENT_MAP_STORE, mode);
      const store = tx.objectStore(COMPONENT_MAP_STORE);
      const key = [scope.userId!, mapId];
      const request = store.get(key);
      request.onsuccess = () => {
        try {
          requireScope(scope);
          const current = request.result === undefined ? null : normalizeComponentMapRecord(request.result);
          if (current === undefined || (current && current.document.id !== mapId)) {
            throw new ComponentMapError("invalid_map", "The saved component map could not be read safely. It has been preserved for recovery.");
          }
          // Preserve an independent before-image, even if a caller mutates its supplied copy.
          const update = mutate(current ? structuredClone(current) : null);
          if (!update || typeof update !== "object" || !("record" in update) || !("result" in update)) {
            throw new ComponentMapError("invalid_map", "Component map transactions must complete synchronously.");
          }
          result = update.result;
          if (update.record !== null) {
            const next = normalizeComponentMapRecord(update.record);
            if (current && current.document.version >= 3 && (!next || next.document.version < current.document.version
              || !mapOverviewSourcesMatch(current.document.overview.source, next.document.overview.source))) {
              throw new ComponentMapError("invalid_map", "This map's saved overview binding cannot be replaced or removed. Both map versions were preserved; reopen the original source.");
            }
            if (current && next && !componentMapBindingsPreserved(current.document, next.document)) {
              throw new ComponentMapError("link_conflict", "A saved linked-photo binding cannot be replaced, moved, removed or retrofitted. Both map versions were preserved.");
            }
            if (mode !== "readwrite" || !next || next.document.id !== mapId
              || (current && (next.document.overview.photoId !== current.document.overview.photoId || next.localRevision < current.localRevision
                || (JSON.stringify(next.document) !== JSON.stringify(current.document) && next.localRevision <= current.localRevision)))) {
              throw new ComponentMapError("invalid_map", "This component map update has invalid revision or document metadata.");
            }
            requireScope(scope);
            if (JSON.stringify(next) !== JSON.stringify(current)) { store.put(next, key); changed = true; }
          }
        } catch (error) { fail(error); }
      };
      tx.oncomplete = () => { try { requireScope(scope); finish(); } catch (error) { finish(error as Error); } };
      tx.onerror = () => finish(failure ?? new ComponentMapError("storage_unavailable", "The component map could not be saved. Free device space and retry."));
      tx.onabort = () => finish(failure ?? new ComponentMapError("storage_unavailable", "Component map storage was interrupted. Your previous map is preserved."));
    } catch (error) { fail(error); }
  });
}

// Synchronous callback runs after a fresh read in one readwrite transaction. Cloud
// acknowledgements must update this current record, never replace it with their sent snapshot.
// record:null means no write, not deletion. This API never removes a map.
export function transactComponentMap<T>(mapId: string, mutate: Mutation<T>, scope = getAccountScope()): Promise<T> {
  return transaction(mapId, "readwrite", mutate, scope);
}

export function readComponentMap(mapId: string, scope = getAccountScope()): Promise<ComponentMapRecord | null> {
  return transaction(mapId, "readonly", (current) => ({ record: null, result: current }), scope);
}

export function createComponentMap(document: ComponentMap, scope = getAccountScope(), sourceGuard?: MapOverviewSaveGuard): Promise<ComponentMapRecord> {
  const checked = normalizeComponentMap(document);
  if (!checked) return Promise.reject(new ComponentMapError("invalid_map", "The component map contains invalid or incomplete evidence."));
  return transactComponentMap(checked.id, (current) => {
    if (hasNewBoundGroups(current?.document, checked)) throw new ComponentMapError("invalid_map", "Attach new bound photo groups through the verified capture-link workflow. The map was preserved.");
    if (checked.version >= 3) {
      if (!sourceGuard) throw new ComponentMapError("invalid_map", "Verify the saved overview before creating its map. The scan was preserved.");
      assertMapOverviewGuardCurrent(sourceGuard, checked, scope);
    }
    if (current) {
      if (current.document.overview.photoId !== checked.overview.photoId) throw new ComponentMapError("invalid_map", "This overview already has a map tied to a different original photo.");
      if (current.document.version >= 3 && (checked.version < current.document.version || !mapOverviewSourcesMatch(current.document.overview.source, checked.overview.source))) {
        throw new ComponentMapError("invalid_map", "This overview already has a map bound to different source evidence. Its existing map was preserved.");
      }
      return { record: null, result: current };
    }
    const record: ComponentMapRecord = { document: checked, localRevision: 1, cloudRevision: null, syncedLocalRevision: 0 };
    return { record, result: record };
  }, scope);
}

export function updateComponentMap(mapId: string, expectedLocalRevision: number, document: ComponentMap, scope = getAccountScope(), sourceGuard?: MapOverviewSaveGuard): Promise<ComponentMapRecord> {
  const checked = normalizeComponentMap(document);
  if (!checked || checked.id !== mapId) return Promise.reject(new ComponentMapError("invalid_map", "The component map contains invalid or incomplete evidence."));
  return transactComponentMap(mapId, (current) => {
    if (!current) throw new ComponentMapError("missing_map", "This component map is missing. Reopen its overview scan.");
    if (current.localRevision !== expectedLocalRevision) throw new ComponentMapError("stale_revision", "This map changed in another view. Your edits were not applied. Keep or copy them before loading the saved map.");
    if (hasNewBoundGroups(current.document, checked)) throw new ComponentMapError("invalid_map", "Attach new bound photo groups through the verified capture-link workflow. Your draft was preserved.");
    if (checked.overview.photoId !== current.document.overview.photoId) throw new ComponentMapError("invalid_map", "A component map cannot be moved to a different original photo.");
    if (checked.version >= 3) {
      if (!sourceGuard) throw new ComponentMapError("invalid_map", "Verify the saved overview before saving map edits. Your draft was preserved.");
      assertMapOverviewGuardCurrent(sourceGuard, checked, scope);
    }
    if (JSON.stringify(checked) === JSON.stringify(current.document)) return { record: null, result: current };
    const record = { ...current, document: checked, localRevision: current.localRevision + 1 };
    return { record, result: record };
  }, scope);
}

export function linkComponentMap(target: ComponentCaptureTarget, photoIds: readonly string[], scope = getAccountScope(), prepared?: { binding: ComponentMapGroupBinding; guard: LinkedPhotoSaveGuard }, assertContextCurrent?: () => void): Promise<ComponentMapRecord> {
  const checked = normalizeComponentCaptureTarget(target);
  if (!checked) return Promise.reject(new ComponentMapError("invalid_map", "This component capture target is invalid."));
  return transactComponentMap(checked.mapId, (current) => {
    assertContextCurrent?.();
    if (!current) throw new ComponentMapError("missing_map", "This component map is missing. Its saved scan is still available in history.");
    const document = linkComponentMapDocument(current.document, checked, photoIds, prepared?.binding);
    const linked = document.components.find((component) => component.id === checked.componentId)?.scanGroups.find((group) => group.linkId.toLowerCase() === checked.linkAttemptId.toLowerCase());
    if (linked?.binding) {
      if (!prepared?.guard) throw new ComponentMapError("invalid_map", "Verify the saved linked photos before attaching this group. Its scan and draft were preserved.");
      assertLinkedPhotoGuardCurrent(prepared.guard, checked.lookupId, linked.binding, scope);
    }
    if (JSON.stringify(document) === JSON.stringify(current.document)) return { record: null, result: current };
    const record = { ...current, document, localRevision: current.localRevision + 1 };
    return { record, result: record };
  }, scope);
}
