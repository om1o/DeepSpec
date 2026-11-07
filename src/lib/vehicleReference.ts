import {
  VEHICLE_REFERENCE_ADAPTER_VERSION, VEHICLE_REFERENCE_SOURCE_URL,
  type VehicleIdentityReference, type VehicleReferenceFacts, type VehicleReferenceQuery, type VehicleReferenceOrigins, type VehicleReferenceField,
} from "../types/vehicleReference.js";

const VIN = /^[A-HJ-NPR-Z0-9]{17}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FACT_KEYS = ["year", "make", "model", "engineModel", "engineManufacturer", "cylinders", "displacementL", "fuelType"] as const;
const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const onlyKeys = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).every((key) => keys.includes(key));
const hasControl = (value: string, multiline = false) => Array.from(value).some((character) => {
  const code = character.charCodeAt(0);
  return (code < 32 && !(multiline && [9, 10, 13].includes(code))) || (code >= 127 && code <= 159);
});

export function normalizeVehicleReferenceQuery(value: unknown): VehicleReferenceQuery | null {
  if (!record(value) || !onlyKeys(value, ["vin", "modelYear"]) || typeof value.vin !== "string") return null;
  const vin = value.vin.trim().toUpperCase();
  if (!VIN.test(vin)) return null;
  if (value.modelYear !== undefined && (typeof value.modelYear !== "number" || !Number.isInteger(value.modelYear) || value.modelYear < 1981 || value.modelYear > 2099)) return null;
  return { vin, ...(value.modelYear !== undefined ? { modelYear: value.modelYear as number } : {}) };
}

function timestamp(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === (value.includes(".") ? value : value.replace("Z", ".000Z"));
}

/** Validate the stored snapshot without truncating or silently changing source strings. */
export function normalizeVehicleIdentityReference(value: unknown): VehicleIdentityReference | null {
  if (!record(value) || !onlyKeys(value, ["version", "id", "provider", "adapterVersion", "retrievedAt", "sourceUrl", "query", "facts", "decode"])) return null;
  if (value.version !== 1 || typeof value.id !== "string" || !UUID.test(value.id) || value.provider !== "nhtsa-vpic" || value.adapterVersion !== VEHICLE_REFERENCE_ADAPTER_VERSION || value.sourceUrl !== VEHICLE_REFERENCE_SOURCE_URL || !timestamp(value.retrievedAt)) return null;
  const query = normalizeVehicleReferenceQuery(value.query);
  if (!query || !record(value.query) || value.query.vin !== query.vin || !record(value.facts) || !onlyKeys(value.facts, FACT_KEYS)) return null;
  const facts: VehicleReferenceFacts = {};
  for (const key of FACT_KEYS) {
    const field = value.facts[key];
    if (field === undefined) continue;
    if (typeof field !== "string" || !field.trim() || field.length > 120 || hasControl(field)) return null;
    if (key === "year" && (!/^\d{4}$/.test(field) || Number(field) < 1981 || Number(field) > 2099)) return null;
    facts[key] = field;
  }
  if (!record(value.decode) || !onlyKeys(value.decode, ["codes", "messages"])) return null;
  const { codes, messages } = value.decode;
  if (!Array.isArray(codes) || codes.length > 32 || codes.some((code) => typeof code !== "string" || !/^\d{1,3}$/.test(code))) return null;
  if (!Array.isArray(messages) || messages.length > 8 || messages.some((message) => typeof message !== "string" || !message.trim() || message.length > 2000 || hasControl(message, true))) return null;
  const result: VehicleIdentityReference = {
    version: 1, id: value.id, provider: "nhtsa-vpic", adapterVersion: VEHICLE_REFERENCE_ADAPTER_VERSION,
    retrievedAt: value.retrievedAt, sourceUrl: VEHICLE_REFERENCE_SOURCE_URL,
    query, facts, decode: { codes: [...codes], messages: [...messages] },
  };
  return new TextEncoder().encode(JSON.stringify(result)).byteLength <= 20 * 1024 ? result : null;
}

/** A successful decode permits review, never automatic confirmation or fitment advice. */
export function referenceAllowsSuggestions(reference: VehicleIdentityReference): boolean {
  return reference.decode.codes.length === 1 && reference.decode.codes[0] === "0";
}

export const VEHICLE_REFERENCE_FIELD_FACTS = { year: "year", make: "make", model: "model", engine: "engineModel" } as const;

/** Validate sources and prune attributions whose exact value or VIN no longer matches. */
export function normalizeVehicleReferenceOrigins(value: unknown, context: { vin?: string } & Partial<Record<VehicleReferenceField, string>>): VehicleReferenceOrigins | undefined {
  if (!record(value) || !onlyKeys(value, ["references", "fields"]) || !Array.isArray(value.references) || value.references.length > 4
    || !record(value.fields) || !onlyKeys(value.fields, Object.keys(VEHICLE_REFERENCE_FIELD_FACTS))) return undefined;
  const references = new Map<string, VehicleIdentityReference>();
  for (const raw of value.references) {
    const reference = normalizeVehicleIdentityReference(raw);
    if (!reference || references.has(reference.id)) return undefined;
    references.set(reference.id, reference);
  }
  const fields: VehicleReferenceOrigins["fields"] = {};
  for (const field of Object.keys(VEHICLE_REFERENCE_FIELD_FACTS) as VehicleReferenceField[]) {
    const id = value.fields[field];
    if (id === undefined) continue;
    if (typeof id !== "string" || !references.has(id)) return undefined;
    const reference = references.get(id)!;
    if (reference.query.vin === context.vin?.trim().toUpperCase() && referenceAllowsSuggestions(reference)
      && context[field]?.trim() && reference.facts[VEHICLE_REFERENCE_FIELD_FACTS[field]]?.trim() === context[field]?.trim()) fields[field] = id;
  }
  const used = new Set(Object.values(fields));
  return used.size ? { references: [...references.values()].filter(reference => used.has(reference.id)).sort((a, b) => a.id.localeCompare(b.id)), fields } : undefined;
}
