import { TextEncoder } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeVehicleIdentityReference, normalizeVehicleReferenceQuery, referenceAllowsSuggestions } from "./vehicleReference";
import { VEHICLE_REFERENCE_SOURCE_URL, type VehicleIdentityReference } from "../types/vehicleReference";

// Entirely synthetic identity; no real vehicle or NHTSA response.
const sample = (): VehicleIdentityReference => ({
  version: 1, id: "42a23634-e887-41c6-9109-c846d724387f", provider: "nhtsa-vpic", adapterVersion: "nhtsa-vpic-v1",
  retrievedAt: "2026-11-05T12:00:00.000Z", sourceUrl: VEHICLE_REFERENCE_SOURCE_URL,
  query: { vin: "1HGCM82633A000000", modelYear: 2003 }, facts: { year: "2003", make: "SYNTHETIC", model: "Example", engineModel: "Example 1" },
  decode: { codes: ["0"], messages: ["Synthetic successful response."] },
});
beforeEach(() => vi.stubGlobal("TextEncoder", TextEncoder));
afterEach(() => vi.unstubAllGlobals());

describe("vehicle reference boundary", () => {
  it("canonicalizes only the deliberately supplied VIN/year", () => {
    expect(normalizeVehicleReferenceQuery({ vin: " 1hgcm82633a000000 ", modelYear: 2003 })).toEqual(sample().query);
    expect(normalizeVehicleReferenceQuery({ vin: sample().query.vin })).toEqual({ vin: sample().query.vin });
  });
  it.each([
    { vin: "1HGCM82633A00000" }, { vin: "1HGCM82633A00000Q" }, { vin: "1HGCM82633A00000*" },
    { vin: sample().query.vin, modelYear: "2003" }, { vin: sample().query.vin, modelYear: 1980 },
    { vin: sample().query.vin, modelYear: 2100 }, { vin: sample().query.vin, modelYear: 2003.5 },
    { vin: sample().query.vin, photos: ["private"] }, { vin: sample().query.vin, modelYear: null },
  ])("rejects incomplete/ambiguous or expanded query %#", (query) => expect(normalizeVehicleReferenceQuery(query)).toBeNull());
  it("retains exact source messages and separates unknown facts", () => {
    const value = sample(); value.facts = {}; value.decode = { codes: [], messages: ["Review\nthese exact details.\tNo match."] };
    expect(normalizeVehicleIdentityReference(value)).toEqual(value);
    expect(referenceAllowsSuggestions(value)).toBe(false);
  });
  it.each([
    { retrievedAt: "2026-02-30T12:00:00.000Z" }, { retrievedAt: "2026-11-05T12:00:00+01:00" },
    { sourceUrl: "https://example.test/?vin=private" }, { provider: "other" }, { adapterVersion: "future" },
    { id: "not-a-uuid" }, { facts: { year: "2003", hidden: "extra" } }, { facts: { engineModel: "x".repeat(121) } },
    { facts: { engineModel: "\u0000" } }, { facts: { year: "00" } }, { facts: { model: "" } },
    { decode: { codes: ["0"], messages: ["x".repeat(2001)] } }, { decode: { codes: ["0"], messages: ["\u0085"] } },
    { decode: { codes: ["other"], messages: [] } }, { decode: { codes: ["0"], messages: [], hidden: true } },
    { query: { ...sample().query, vin: "1hgcm82633a000000" } },
  ])("refuses malformed provenance without silently repairing it %#", (patch) => {
    expect(normalizeVehicleIdentityReference({ ...sample(), ...patch })).toBeNull();
  });
  it.each([[], ["1"], ["0", "14"], ["0", "0"]].map((codes) => ({ codes })))("keeps non-clean decode $codes as review-only", ({ codes }) => {
    const value = sample(); value.decode.codes = codes;
    expect(referenceAllowsSuggestions(value)).toBe(false);
  });
  it("allows reviewed suggestions only for the explicit clean code", () => expect(referenceAllowsSuggestions(sample())).toBe(true));
});
