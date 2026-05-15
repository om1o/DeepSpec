/**
 * Lookups persistence: browser localStorage, or Supabase (Postgres + Storage + RLS)
 * once anonymous auth succeeds.
 */

import type { ChatMessage, Lookup } from "../types";
import { isSupabaseConfigured } from "../lib/supabase/config";
import { getSupabase } from "../lib/supabase/client";
import {
  appendChatMessageLocal,
  deleteLookupLocal,
  getLookupLocal,
  listLookupsLocal,
  saveNewLookupLocal,
  updateLookupLocal,
} from "./storage-local";
import {
  appendChatMessageRemote,
  deleteLookupRemote,
  getLookupRemote,
  listLookupsRemote,
  saveNewLookupRemote,
  updateLookupRemote,
} from "./storage-supabase";

export type StorageBackendKind = "local" | "remote";

let backend: StorageBackendKind = "local";

export function getActiveStorageBackend(): StorageBackendKind {
  return backend;
}

/** Call once on startup when using the app routes (after age gate). */
export async function bootstrapStorageBackend(): Promise<StorageBackendKind> {
  backend = "local";
  if (!isSupabaseConfigured()) return backend;

  const sb = getSupabase();
  if (!sb) return backend;

  try {
    const {
      data: { session },
    } = await sb.auth.getSession();
    if (!session) {
      const { error } = await sb.auth.signInAnonymously();
      if (error) throw error;
    }
    backend = "remote";
    return backend;
  } catch (e) {
    console.warn("[storage]", {
      severity: "warn",
      topic: "supabase_fallback",
      detail: e instanceof Error ? e.message : String(e),
    });
    backend = "local";
    return backend;
  }
}

export async function listLookups(): Promise<Lookup[]> {
  return backend === "remote" ? listLookupsRemote() : listLookupsLocal();
}

export async function getLookup(id: string): Promise<Lookup | undefined> {
  return backend === "remote" ? getLookupRemote(id) : getLookupLocal(id);
}

export async function saveNewLookup(lookup: Lookup): Promise<void> {
  return backend === "remote" ? saveNewLookupRemote(lookup) : saveNewLookupLocal(lookup);
}

export async function updateLookup(id: string, patch: Partial<Lookup>): Promise<void> {
  return backend === "remote" ? updateLookupRemote(id, patch) : updateLookupLocal(id, patch);
}

export async function deleteLookup(id: string): Promise<void> {
  return backend === "remote" ? deleteLookupRemote(id) : deleteLookupLocal(id);
}

export async function appendChatMessage(lookupId: string, message: ChatMessage): Promise<void> {
  return backend === "remote" ? appendChatMessageRemote(lookupId, message) : appendChatMessageLocal(lookupId, message);
}
