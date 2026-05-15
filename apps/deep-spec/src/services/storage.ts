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

export function listLookups(): Lookup[] {
  return readRaw().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export function getLookup(id: string): Lookup | undefined {
  return readRaw().find((x) => x.id === id);
}

export function upsertLookup(lookup: Lookup) {
  const all = readRaw().filter((x) => x.id !== lookup.id);
  all.push(lookup);
  writeRaw(all);
}

export function deleteLookup(id: string) {
  writeRaw(readRaw().filter((x) => x.id !== id));
}

export function updateLookup(id: string, patch: Partial<Lookup>) {
  const cur = getLookup(id);
  if (!cur) return;
  upsertLookup({ ...cur, ...patch, id: cur.id });
}

export function appendChatMessage(lookupId: string, message: ChatMessage) {
  const cur = getLookup(lookupId);
  if (!cur) return;
  upsertLookup({ ...cur, chatHistory: [...cur.chatHistory, message] });
}
