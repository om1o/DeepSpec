import { describe, expect, it } from "vitest";
import { applyVehicleReferenceField, confirmVehicleContextField, normalizeVehicleContext, providerVehicleContext, updateVehicleContextField } from "./vehicleContext";
import { referenceVehicleContext, vehicleReferenceFixture } from "../test/vehicleReferenceFixture";

describe("saved vehicle reference origins", () => {
  it("retains the exact source snapshot through a JSON save and restore", () => {
    const context = referenceVehicleContext();
    expect(normalizeVehicleContext(JSON.parse(JSON.stringify(context)))).toEqual(context);
  });

  it("clears only the edited field's attribution while retaining other source-backed fields", () => {
    const context = referenceVehicleContext();
    const edited = updateVehicleContextField(context, "make", "Other");
    expect(normalizeVehicleContext(edited)).toMatchObject({
      make: "Other", referenceOrigins: { fields: { year: context.referenceOrigins.fields.year } },
    });
    expect(JSON.stringify(edited)).not.toContain('"make":"b0cbf559');
    expect(context.referenceOrigins.fields.make).toBeDefined();
  });

  it("clears attribution on an explicit edit even when the value is unchanged, and clears all sources on a VIN edit", () => {
    const context = referenceVehicleContext();
    expect(updateVehicleContextField(context, "make", "HONDA").referenceOrigins?.fields).toEqual({ year: context.referenceOrigins.fields.year });
    expect(updateVehicleContextField(context, "vin", context.vin).referenceOrigins).toBeUndefined();
    expect(updateVehicleContextField(context, "notes", "Checked the label").referenceOrigins).toEqual(context.referenceOrigins);
  });

  it("retains other source fields when one value changes outside the editor, but rejects another vehicle's sources", () => {
    const context = referenceVehicleContext();
    expect(normalizeVehicleContext({ ...context, make: "Other" })?.referenceOrigins?.fields).toEqual({ year: context.referenceOrigins.fields.year });
    expect(normalizeVehicleContext({ ...context, vin: "2T1BURHE6JC003971" })?.referenceOrigins).toBeUndefined();
  });

  it("rejects duplicate, dangling and unsafe sources while keeping usable manually supplied facts", () => {
    const context = referenceVehicleContext();
    const reference = vehicleReferenceFixture();
    for (const referenceOrigins of [
      { references: [reference, reference], fields: { make: reference.id } },
      { references: [reference], fields: { make: "missing" } },
      { references: [{ ...reference, sourceUrl: "javascript:alert(1)" }], fields: { make: reference.id } },
      { references: [{ ...reference, decode: { codes: ["5"], messages: ["Incomplete decode"] } }], fields: { make: reference.id } },
    ]) {
      expect(normalizeVehicleContext({ ...context, referenceOrigins })).toEqual({ vin: context.vin, year: "2003", make: "HONDA" });
    }
  });

  it("copies a matching source without confirming it or sending its snapshot to the AI provider", () => {
    const context = confirmVehicleContextField(referenceVehicleContext(), "make", true);
    const applied = applyVehicleReferenceField(context, "make", vehicleReferenceFixture());
    expect(applied?.referenceOrigins).toEqual(referenceVehicleContext().referenceOrigins);
    expect(applied?.confirmedFields?.make).toBeUndefined();
    expect(providerVehicleContext(applied)).toEqual({ vin: context.vin, year: "2003", make: "HONDA" });
    expect(context.confirmedFields?.make).toBeDefined();
  });

  it("refuses mismatched VINs, failed decodes and changed content under an existing source identity", () => {
    const context = referenceVehicleContext();
    expect(applyVehicleReferenceField(undefined, "make", vehicleReferenceFixture())).toBeNull();
    expect(applyVehicleReferenceField({ vin: "2T1BURHE6JC003971" }, "make", vehicleReferenceFixture())).toBeNull();
    expect(applyVehicleReferenceField(context, "make", vehicleReferenceFixture({ decode: { codes: ["0", "5"], messages: [] } }))).toBeNull();
    expect(applyVehicleReferenceField(context, "make", vehicleReferenceFixture({ retrievedAt: "2026-11-06T12:00:00.000Z" }))).toBeNull();
  });
});
