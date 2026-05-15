import { useEffect, useState } from "react";
import { subscribeStorageCommit } from "../lib/storageEvents";

/** Bumps when any lookup write completes (local or Supabase). */
export function useStorageRevision(): number {
  const [rev, setRev] = useState(0);
  useEffect(() => subscribeStorageCommit(() => setRev((v) => v + 1)), []);
  return rev;
}
