import { getAccountScope, type AccountScope } from "../lib/accountScope";
import type { Lookup } from "../types";
import { readComponentMapLookup } from "./componentMapCloud";
import { guardOriginalEvidence } from "./originalImageEvidence";
import { readShopJob } from "./shop";
import { getLookup, readLookups } from "./storage";

const changed = "The source inspection's job membership changed. Your photos were kept; reopen the original inspection before continuing.";
const membership = (source: Lookup | null) => source ? JSON.stringify({ id: source.id, createdAt: source.createdAt, jobId: source.jobId ?? null, orgId: source.orgId ?? null }) : null;

function localSource(lookupId: string, scope: AccountScope, signal?: AbortSignal): Lookup | null {
  guardOriginalEvidence(scope, signal);
  const read = readLookups();
  if (!read.ok) throw new Error(read.message);
  return getLookup(lookupId, read.value);
}

/** Capture the actual source association, never the job selected on the scanner route. */
export async function readCaptureSource(lookupId: string, scope = getAccountScope()): Promise<Lookup> {
  const local = localSource(lookupId, scope);
  if (local) return structuredClone(local);
  const read = await readComponentMapLookup(lookupId, scope);
  guardOriginalEvidence(scope);
  if (!read.ok || !read.value || read.value.id !== lookupId) throw new Error(read.ok ? "The source inspection is unavailable. Reopen its original scan before continuing." : read.message);
  return structuredClone(read.value);
}

/** Compare the persisted draft association, then recheck observable membership at every write boundary. */
export async function verifyCaptureJobContext(lookupId: string, jobId: string | undefined, scope = getAccountScope(), signal?: AbortSignal): Promise<() => void> {
  const before = membership(localSource(lookupId, scope, signal));
  const source = await readCaptureSource(lookupId, scope);
  guardOriginalEvidence(scope, signal);
  if (source.jobId !== jobId) throw new Error(changed);
  const readJob = () => {
    if (!jobId) return null;
    const read = readShopJob(jobId, scope);
    if (!read.ok) throw new Error(read.message);
    if (!read.value) throw new Error("The original job is unavailable. Your photos were kept; reopen that job before continuing.");
    if (source.orgId && source.orgId !== read.value.orgId) throw new Error(changed);
    return JSON.stringify({ id: read.value.id, orgId: read.value.orgId, createdAt: read.value.createdAt });
  };
  const job = readJob();
  const assertCurrent = () => {
    if (membership(localSource(lookupId, scope, signal)) !== before || readJob() !== job) throw new Error(changed);
  };
  assertCurrent();
  return assertCurrent;
}
