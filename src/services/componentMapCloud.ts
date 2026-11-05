import type { SupabaseClient } from "@supabase/supabase-js";
import { getAccountScope, isAccountScopeCurrent, type AccountScope } from "../lib/accountScope";
import { normalizeComponentMap } from "../lib/componentMap";
import { mergeCloudLookup } from "../lib/lookupMerge";
import type { ComponentMap, ComponentMapRecord } from "../types/componentMap";
import type { Lookup } from "../types";
import { getAuthClient } from "./auth";
import { readCloudLookup } from "./cloudHistory";
import { syncLookupToCloud } from "./cloudSync";
import { readComponentMap, transactComponentMap } from "./componentMapStore";
import { getLookup } from "./storage";

export type ComponentMapCloudResult =
  | { ok: true; value: ComponentMapRecord | null; message: string }
  | { ok: false; message: string };
export type ComponentMapLookupResult =
  | { ok: true; value: Lookup | null }
  | { ok: false; message: string };
const SYNC_LEASE_MS = 2 * 60 * 1000;
const CLOUD_REQUEST_TIMEOUT_MS = 20_000;
const CONFLICT_MESSAGE = "The cloud map changed. Both versions are preserved. Compare them and choose which version to keep before saving again.";
const CHANGED_MESSAGE = "Account changed. Reopen this component map in its original account.";
type RemoteMap = { document: ComponentMap; revision: number };

async function boundedRequest<T>(request: (signal: AbortSignal) => PromiseLike<T>): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([Promise.resolve(request(controller.signal)), new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error("The cloud map request timed out. Its final cloud state is uncertain; your device map is preserved. Retry to check for a conflict."));
      }, CLOUD_REQUEST_TIMEOUT_MS);
    })]);
  } finally { clearTimeout(timer); }
}

function assertAccount(scope: AccountScope) {
  if (!isAccountScopeCurrent(scope)) throw new Error(CHANGED_MESSAGE);
}

async function verifiedClient(scope: AccountScope): Promise<SupabaseClient> {
  assertAccount(scope);
  const client = await boundedRequest(() => getAuthClient());
  assertAccount(scope);
  if (!client) throw new Error("Cloud component maps are not configured for this build. Your device map is preserved.");
  const session = await boundedRequest(() => client.auth.getSession());
  assertAccount(scope);
  const user = session.data.session?.user;
  if (session.error || !user || user.id !== scope.userId || user.is_anonymous === true
    || (!user.email_confirmed_at && !user.phone_confirmed_at)) {
    throw new Error("Sign in to the verified account that owns this map before syncing.");
  }
  return client;
}

function failure(error: unknown): { ok: false; message: string } {
  return { ok: false, message: error instanceof Error ? error.message : "The component map could not sync. Your device map is preserved." };
}

function databaseFailure(error: { code?: string; message?: string }) {
  if (error.code === "42P01" || error.code === "PGRST205" || error.code === "42703" || error.code === "PGRST204") {
    return new Error("Cloud component maps require the component-map database migration. Your device map is preserved.");
  }
  return new Error("The cloud map could not be saved or loaded. Check your connection and retry; your device map is preserved.");
}

async function readRemote(client: SupabaseClient, mapId: string, scope: AccountScope): Promise<RemoteMap | null> {
  assertAccount(scope);
  const response = await boundedRequest((signal) => client.from("component_maps").select("map_id,document_json,revision")
    .eq("user_id", scope.userId).eq("map_id", mapId).abortSignal(signal).maybeSingle());
  assertAccount(scope);
  if (response.error) throw databaseFailure(response.error);
  if (!response.data) return null;
  const document = normalizeComponentMap(response.data.document_json);
  const revision: unknown = response.data.revision;
  if (!document || document.id !== mapId || response.data.map_id !== mapId
    || typeof revision !== "number" || !Number.isSafeInteger(revision) || revision < 1) {
    throw new Error("The cloud map is invalid or incomplete. It was not imported; your device map is preserved.");
  }
  return { document, revision };
}

/** A cloud read may create a missing device map, but never replace device work. */
export async function loadComponentMapFromCloud(mapId: string, scope = getAccountScope()): Promise<ComponentMapCloudResult> {
  try {
    assertAccount(scope);
    const local = await readComponentMap(mapId, scope);
    if (local) return { ok: true, value: local, message: "Component map loaded from this device." };
    const remote = await readRemote(await verifiedClient(scope), mapId, scope);
    if (!remote) return { ok: true, value: null, message: "No cloud component map is saved for this overview." };
    const value = await transactComponentMap(mapId, (current) => {
      if (current) return { record: null, result: current };
      const imported: ComponentMapRecord = { document: remote.document, localRevision: 1, cloudRevision: remote.revision, syncedLocalRevision: 1 };
      return { record: imported, result: imported };
    }, scope);
    return { ok: true, value, message: "Component map is available on this device." };
  } catch (error) { return failure(error); }
}

/** Resolve original photo references through the normal owner-scoped scan path. */
export async function readComponentMapLookup(lookupId: string, scope = getAccountScope()): Promise<ComponentMapLookupResult> {
  try {
    assertAccount(scope);
    const local = getLookup(lookupId);
    const originals = local ? originalPhotos(local).map((photo) => photo.imageBase64) : [];
    if (local && originals.every((image) => /^data:image\//i.test(image))) return { ok: true, value: local };
    const remote = await boundedRequest(() => readCloudLookup(lookupId));
    assertAccount(scope);
    if (local && remote.ok) {
      const photoIds = new Set(local.photos?.length ? local.photos.map((photo) => photo.id) : ["photo-1"]);
      if (!remote.value || !hasPhotos(remote.value, photoIds)) return { ok: false, message: "The linked scan's original photos are unavailable. Its device record was preserved." };
      const remotePhotos = originalPhotos(remote.value);
      if (originalPhotos(local).some((photo) => {
        if (!/^https?:\/\//i.test(photo.imageBase64)) return false;
        const match = remotePhotos.find((candidate) => candidate.id === photo.id && candidate.capturedAt === photo.capturedAt);
        if (!match) return true;
        try {
          const previous = new URL(photo.imageBase64), refreshed = new URL(match.imageBase64);
          return previous.origin !== refreshed.origin || previous.pathname !== refreshed.pathname;
        } catch { return true; }
      })) return { ok: false, message: "The linked scan's original photo references changed. Its device record was preserved for review." };
      return { ok: true, value: mergeCloudLookup(local, remote.value) };
    }
    return remote;
  } catch (error) { return failure(error); }
}

function originalPhotos(lookup: Lookup) {
  return lookup.photos?.length ? lookup.photos : [{ id: "photo-1", ...lookup.frame }];
}

function hasPhotos(lookup: Lookup, photoIds: Set<string>) {
  const photos = originalPhotos(lookup);
  return [...photoIds].every((id) => photos.some((photo) => photo.id === id && /^(data:image\/(?:jpeg|png|webp);base64,|https?:\/\/)/i.test(photo.imageBase64)));
}

async function ensureReferencedEvidence(document: ComponentMap, scope: AccountScope) {
  const references = new Map<string, Set<string>>([[document.overview.lookupId, new Set([document.overview.photoId])]]);
  for (const component of document.components) for (const group of component.scanGroups) {
    const photos = references.get(group.lookupId) ?? new Set<string>();
    group.photoIds.forEach((id) => photos.add(id));
    references.set(group.lookupId, photos);
  }
  for (const [lookupId, photoIds] of references) {
    assertAccount(scope);
    let cloud = await boundedRequest(() => readCloudLookup(lookupId));
    assertAccount(scope);
    if (!cloud.ok) throw new Error(`Linked scan ${lookupId} is unavailable: ${cloud.message}`);
    if (cloud.value && hasPhotos(cloud.value, photoIds)) continue;
    const local = getLookup(lookupId);
    if (!local || !hasPhotos(local, photoIds)) throw new Error(`Linked scan ${lookupId} or its original photo IDs are unavailable. The map remains saved on this device.`);
    const saved = await syncLookupToCloud(local);
    assertAccount(scope);
    if (!saved.ok) throw new Error(`Linked scan ${lookupId} is not cloud-saved: ${saved.message}`);
    cloud = await boundedRequest(() => readCloudLookup(lookupId));
    assertAccount(scope);
    if (!cloud.ok || !cloud.value || !hasPhotos(cloud.value, photoIds)) {
      throw new Error(`The original photos for linked scan ${lookupId} could not be verified in the cloud. The map remains saved on this device.`);
    }
  }
}

/** Claim/acknowledgement use IndexedDB transactions, so other tabs retain their edits. */
export async function syncComponentMapToCloud(mapId: string, expectedLocalRevision: number, scope = getAccountScope()): Promise<ComponentMapCloudResult> {
  const attemptId = crypto.randomUUID();
  let claimed = false;
  try {
    const client = await verifiedClient(scope);
    const snapshot = await transactComponentMap(mapId, (current) => {
      if (!current) throw new Error("Save the component map on this device first.");
      if (current.localRevision !== expectedLocalRevision) throw new Error("This device map changed in another tab. Reload it before syncing.");
      if (current.conflict) throw new Error(CONFLICT_MESSAGE);
      if (current.syncAttempt && Date.now() - Date.parse(current.syncAttempt.startedAt) < SYNC_LEASE_MS) {
        throw new Error("A component-map save is still in progress. Wait before retrying.");
      }
      const record = { ...current, syncAttempt: { id: attemptId, localRevision: current.localRevision, startedAt: new Date().toISOString() } };
      return { record, result: record };
    }, scope);
    claimed = true;
    await ensureReferencedEvidence(snapshot.document, scope);
    assertAccount(scope);
    // An expired claim may be replaced by another tab. Never start its write afterward.
    const active = await readComponentMap(mapId, scope);
    if (active?.syncAttempt?.id !== attemptId) throw new Error("This map save was superseded. Reload the map before retrying.");
    const row = { user_id: scope.userId, map_id: mapId, document_json: snapshot.document, revision: (snapshot.cloudRevision ?? 0) + 1 };
    const table = client.from("component_maps");
    const response = await boundedRequest((signal) => snapshot.cloudRevision === null
      ? table.insert(row).select("revision").abortSignal(signal).maybeSingle()
      : table.update({ document_json: row.document_json, revision: row.revision }).eq("user_id", scope.userId)
        .eq("map_id", mapId).eq("revision", snapshot.cloudRevision).select("revision").abortSignal(signal).maybeSingle());
    assertAccount(scope);
    if (response.error && !["23505", "40001"].includes(response.error.code)) throw databaseFailure(response.error);
    if (response.error || !response.data) {
      const remote = await readRemote(client, mapId, scope);
      if (remote) await transactComponentMap(mapId, (current) => {
        if (!current || current.syncAttempt?.id !== attemptId) return { record: null, result: undefined };
        const record = { ...current, localRevision: current.localRevision + 1, conflict: remote, syncAttempt: undefined };
        return { record, result: undefined };
      }, scope);
      throw new Error(remote ? CONFLICT_MESSAGE : "The cloud map was removed or is unavailable. Your device version was preserved; no replacement was created.");
    }
    if (response.data.revision !== row.revision) throw new Error("The cloud save acknowledgement was invalid. Reload before retrying; your device map is preserved.");
    const value = await transactComponentMap(mapId, (current) => {
      if (!current || current.syncAttempt?.id !== attemptId || current.cloudRevision !== snapshot.cloudRevision) {
        throw new Error("The cloud save completed after this device map changed its sync state. Reload before retrying.");
      }
      const record = { ...current, cloudRevision: row.revision, syncedLocalRevision: snapshot.localRevision, syncAttempt: undefined };
      return { record, result: record };
    }, scope);
    return { ok: true, value, message: value.localRevision === value.syncedLocalRevision
      ? "Component map saved to your cloud account." : "The saved map version reached the cloud. Newer device edits still need saving." };
  } catch (error) { return failure(error); }
  finally {
    if (claimed && isAccountScopeCurrent(scope)) {
      try {
        await transactComponentMap(mapId, (current) => current?.syncAttempt?.id === attemptId
          ? { record: { ...current, syncAttempt: undefined }, result: undefined }
          : { record: null, result: undefined }, scope);
      } catch { /* Keep the durable claim if storage failed; it can be retried after its lease. */ }
    }
  }
}

/** Explicit resolution only. Neither choice starts a cloud write. */
export async function resolveComponentMapCloudConflict(mapId: string, expectedLocalRevision: number, choice: "local" | "cloud", scope = getAccountScope()): Promise<ComponentMapCloudResult> {
  try {
    const value = await transactComponentMap(mapId, (current) => {
      if (!current?.conflict) throw new Error("There is no saved cloud conflict to resolve.");
      if (current.localRevision !== expectedLocalRevision) throw new Error("This device map changed. Compare both versions again before resolving.");
      if (current.syncAttempt) throw new Error("Wait for the current map save before resolving this conflict.");
      const localRevision = current.localRevision + 1;
      const record: ComponentMapRecord = { document: choice === "cloud" ? current.conflict.document : current.document,
        localRevision, cloudRevision: current.conflict.revision,
        syncedLocalRevision: choice === "cloud" ? localRevision : current.syncedLocalRevision };
      return { record, result: record };
    }, scope);
    return { ok: true, value, message: choice === "cloud" ? "The reviewed cloud version is now on this device."
      : "Your device version is preserved. Save to cloud when you are ready to replace the reviewed cloud version." };
  } catch (error) { return failure(error); }
}
