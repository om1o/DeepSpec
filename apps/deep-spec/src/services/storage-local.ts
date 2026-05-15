import { emitStorageCommit } from "../lib/storageEvents";
import type { ChatMessage, Lookup } from "../types";

const STORAGE_KEY = "deep-spec:lookups";

function readRaw(): Lookup[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed as Lookup[];
  } catch {
    return [];
  }
}

function writeRaw(items: Lookup[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch (e) {
    console.error("localStorage write failed", e);
    throw new Error(
      "Storage is full or unavailable. Try deleting older lookups in the app (we will add a clearer UI for this).",
      { cause: e },
    );
  }
}

export async function listLookupsLocal(): Promise<Lookup[]> {
  return readRaw().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function getLookupLocal(id: string): Promise<Lookup | undefined> {
  return readRaw().find((x) => x.id === id);
}

export async function saveNewLookupLocal(lookup: Lookup): Promise<void> {
  const all = readRaw().filter((x) => x.id !== lookup.id);
  all.push(lookup);
  writeRaw(all);
  emitStorageCommit();
}

export async function updateLookupLocal(id: string, patch: Partial<Lookup>): Promise<void> {
  const cur = readRaw().find((x) => x.id === id);
  if (!cur) return;
  const next = { ...cur, ...patch, id: cur.id };
  const all = readRaw().filter((x) => x.id !== id);
  all.push(next);
  writeRaw(all);
  emitStorageCommit();
}

export async function deleteLookupLocal(id: string): Promise<void> {
  writeRaw(readRaw().filter((x) => x.id !== id));
  emitStorageCommit();
}

export async function appendChatMessageLocal(lookupId: string, message: ChatMessage): Promise<void> {
  const cur = readRaw().find((x) => x.id === lookupId);
  if (!cur) return;
  await updateLookupLocal(lookupId, { chatHistory: [...cur.chatHistory, message] });
}
