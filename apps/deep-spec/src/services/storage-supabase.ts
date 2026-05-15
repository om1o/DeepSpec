import { emitStorageCommit } from "../lib/storageEvents";
import { getSupabase } from "../lib/supabase/client";
import type { ChatMessage, Lookup, LookupResultPayload } from "../types";

const BUCKET = "part-photos";
const SIGNED_TTL = 60 * 60 * 24 * 365;

type DbRow = {
  id: string;
  user_id: string;
  created_at: string;
  image_storage_path: string;
  user_car_context: string;
  user_problem_context: string;
  result: LookupResultPayload;
  rating: "up" | "down" | null;
  correction: string | null;
  chat_history: ChatMessage[];
};

async function pathToDisplayUrl(path: string): Promise<string> {
  const sb = getSupabase()!;
  const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(path, SIGNED_TTL);
  if (error || !data?.signedUrl) {
    console.error("[storage] signed url failed", error);
    return "";
  }
  return data.signedUrl;
}

async function rowToLookup(row: DbRow): Promise<Lookup> {
  const imageBase64 = await pathToDisplayUrl(row.image_storage_path);
  return {
    id: row.id,
    createdAt: row.created_at,
    imageBase64,
    userCarContext: row.user_car_context,
    userProblemContext: row.user_problem_context,
    result: row.result,
    rating: row.rating,
    correction: row.correction,
    chatHistory: Array.isArray(row.chat_history) ? row.chat_history : [],
  };
}

export async function listLookupsRemote(): Promise<Lookup[]> {
  const sb = getSupabase()!;
  const { data, error } = await sb.from("lookups").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  const rows = (data ?? []) as DbRow[];
  return Promise.all(rows.map((r) => rowToLookup(r)));
}

export async function getLookupRemote(id: string): Promise<Lookup | undefined> {
  const sb = getSupabase()!;
  const { data, error } = await sb.from("lookups").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) return undefined;
  return rowToLookup(data as DbRow);
}

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const r = await fetch(dataUrl);
  return r.blob();
}

export async function saveNewLookupRemote(lookup: Lookup): Promise<void> {
  const sb = getSupabase()!;
  const {
    data: { user },
    error: userErr,
  } = await sb.auth.getUser();
  if (userErr || !user) throw new Error("Not signed in (anonymous auth should have created a session).");

  const path = `${user.id}/${lookup.id}.jpg`;
  const blob = await dataUrlToBlob(lookup.imageBase64);

  const { error: upErr } = await sb.storage.from(BUCKET).upload(path, blob, {
    upsert: true,
    contentType: "image/jpeg",
  });
  if (upErr) throw upErr;

  const payload = {
    id: lookup.id,
    user_id: user.id,
    image_storage_path: path,
    user_car_context: lookup.userCarContext,
    user_problem_context: lookup.userProblemContext,
    result: lookup.result,
    rating: lookup.rating,
    correction: lookup.correction,
    chat_history: lookup.chatHistory,
    moderation_status: "none",
  };

  const { error: insErr } = await sb.from("lookups").insert(payload);
  if (insErr) throw insErr;
  emitStorageCommit();
}

export async function updateLookupRemote(id: string, patch: Partial<Lookup>): Promise<void> {
  const sb = getSupabase()!;
  const dbPatch: Record<string, unknown> = {};
  if (patch.userCarContext !== undefined) dbPatch.user_car_context = patch.userCarContext;
  if (patch.userProblemContext !== undefined) dbPatch.user_problem_context = patch.userProblemContext;
  if (patch.result !== undefined) dbPatch.result = patch.result;
  if (patch.rating !== undefined) dbPatch.rating = patch.rating;
  if (patch.correction !== undefined) dbPatch.correction = patch.correction;
  if (patch.chatHistory !== undefined) dbPatch.chat_history = patch.chatHistory;

  if (Object.keys(dbPatch).length === 0) return;

  const { error } = await sb.from("lookups").update(dbPatch).eq("id", id);
  if (error) throw error;
  emitStorageCommit();
}

export async function deleteLookupRemote(id: string): Promise<void> {
  const sb = getSupabase()!;
  const { data: row, error: fErr } = await sb.from("lookups").select("image_storage_path").eq("id", id).maybeSingle();
  if (fErr) throw fErr;
  const p = row?.image_storage_path as string | undefined;
  if (p) {
    const { error: rmErr } = await sb.storage.from(BUCKET).remove([p]);
    if (rmErr) console.warn("[storage] remove object:", rmErr.message);
  }
  const { error } = await sb.from("lookups").delete().eq("id", id);
  if (error) throw error;
  emitStorageCommit();
}

export async function appendChatMessageRemote(lookupId: string, message: ChatMessage): Promise<void> {
  const sb = getSupabase()!;
  const { data: row, error } = await sb.from("lookups").select("chat_history").eq("id", lookupId).maybeSingle();
  if (error) throw error;
  if (!row) return;
  const history = (row.chat_history as ChatMessage[]) ?? [];
  await updateLookupRemote(lookupId, { chatHistory: [...history, message] });
}
