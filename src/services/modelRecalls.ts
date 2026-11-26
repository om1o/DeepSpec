import { getAccountScope, isAccountScopeCurrent, type AccountScope } from "../lib/accountScope";
import type { VehicleContext } from "../types";

export const NHTSA_VIN_RECALL_URL = "https://www.nhtsa.gov/recalls";
export const MODEL_RECALL_TIMEOUT_MS = 20_000;
export const MAX_MODEL_RECALL_RESPONSE_BYTES = 256 * 1024;
const API_URL = "https://api.nhtsa.gov/recalls/recallsByVehicle";

export type ModelRecallQuery = { year: number; make: string; model: string };
export type ModelRecall = { campaignNumber: string; component: string; summary: string; consequence: string; remedy: string };
export type ModelRecallResult = { query: ModelRecallQuery; retrievedAt: string; sourceUrl: string; recalls: ModelRecall[] };

const unavailable = () => new Error("NHTSA model recall data is unavailable. Check your VIN at NHTSA directly.");
const accountChanged = () => new Error("Account changed. Reopen this result before searching recalls.");

export function normalizeModelRecallQuery(value: VehicleContext | undefined): ModelRecallQuery | null {
  const yearText = value?.year?.trim();
  const make = value?.make?.trim().replace(/\s+/g, " ");
  const model = value?.model?.trim().replace(/\s+/g, " ");
  if (!yearText || !/^\d{4}$/.test(yearText) || !make || !model || make.length > 80 || model.length > 80) return null;
  const year = Number(yearText);
  if (year < 1949 || year > new Date().getUTCFullYear() + 1) return null;
  return { year, make, model };
}

export function modelRecallSourceUrl(query: ModelRecallQuery): string {
  return `${API_URL}?${new URLSearchParams({ make: query.make, model: query.model, modelYear: String(query.year) })}`;
}

/** Explicit model-wide lookup only. It never sends a VIN or photo to NHTSA. */
export async function requestModelRecalls(value: VehicleContext, scope: AccountScope = getAccountScope(), fetchImpl: typeof fetch = fetch): Promise<ModelRecallResult> {
  const query = normalizeModelRecallQuery(value);
  if (!query) throw new Error("Enter a valid year, make, and model before searching recalls.");
  if (!isAccountScopeCurrent(scope)) throw accountChanged();
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new Error("NHTSA model recall lookup timed out. Check your VIN at NHTSA directly.")); }, MODEL_RECALL_TIMEOUT_MS);
  });
  const operation = async () => {
    let response: Response;
    try {
      response = await fetchImpl(modelRecallSourceUrl(query), {
        method: "GET", credentials: "omit", cache: "no-store", redirect: "error", signal: controller.signal,
      });
    } catch { throw unavailable(); }
    if (!isAccountScopeCurrent(scope)) throw accountChanged();
    if (controller.signal.aborted) throw unavailable();
    if (response.status === 429) throw new Error("NHTSA is limiting recall lookups. Wait before trying again, or check your VIN at NHTSA directly.");
    if (response.status !== 200 || response.redirected || !/^application\/(?:[a-z0-9.+-]+\+)?json(?:\s*;|$)/i.test(response.headers.get("content-type") ?? "")) throw unavailable();
    const payload = await readJson(response, controller.signal);
    if (!isAccountScopeCurrent(scope)) throw accountChanged();
    const recalls = parseModelRecalls(payload, query);
    if (!recalls || controller.signal.aborted) throw unavailable();
    return { query, retrievedAt: new Date().toISOString(), sourceUrl: modelRecallSourceUrl(query), recalls };
  };
  try { return await Promise.race([operation(), deadline]); }
  finally { clearTimeout(timer); controller.abort(); }
}

function parseModelRecalls(value: unknown, query: ModelRecallQuery): ModelRecall[] | null {
  if (!isRecord(value) || !Number.isInteger(value.Count) || Number(value.Count) < 0 || Number(value.Count) > 150
    || !Array.isArray(value.results) || value.results.length !== value.Count) return null;
  const recalls: ModelRecall[] = [];
  for (const row of value.results) {
    if (!isRecord(row) || String(row.ModelYear).trim() !== String(query.year)
      || !sameName(row.Make, query.make) || !sameName(row.Model, query.model)) return null;
    const campaignNumber = field(row.NHTSACampaignNumber, 16);
    const component = field(row.Component, 250);
    const summary = optionalField(row.Summary, 4000);
    const consequence = optionalField(row.Consequence, 4000);
    const remedy = optionalField(row.Remedy, 4000);
    if (!campaignNumber || !/^\d{2}[A-Z]\d{6}$/.test(campaignNumber) || !component || summary === null || consequence === null || remedy === null) return null;
    recalls.push({ campaignNumber, component, summary, consequence, remedy });
  }
  return recalls;
}

function sameName(value: unknown, expected: string): boolean {
  return typeof value === "string" && value.trim().replace(/\s+/g, " ").toLocaleLowerCase() === expected.toLocaleLowerCase();
}

function field(value: unknown, limit: number): string | null {
  return typeof value === "string" && value.trim() && value.length <= limit ? value.trim() : null;
}

function optionalField(value: unknown, limit: number): string | null {
  return value === null || value === undefined || (typeof value === "string" && !value.trim()) ? "" : field(value, limit);
}

async function readJson(response: Response, signal: AbortSignal): Promise<unknown> {
  const advertised = response.headers.get("content-length");
  if (advertised !== null && (!/^\d+$/.test(advertised) || Number(advertised) > MAX_MODEL_RECALL_RESPONSE_BYTES) || !response.body) throw unavailable();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (signal.aborted) throw unavailable();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > MAX_MODEL_RECALL_RESPONSE_BYTES) throw unavailable();
      chunks.push(next.value);
    }
    const joined = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(joined));
  } catch { throw unavailable(); }
  finally { void reader.cancel().catch(() => undefined); reader.releaseLock(); }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
