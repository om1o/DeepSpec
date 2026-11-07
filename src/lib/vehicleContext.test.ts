import { confirmVehicleContextField, formatVehicleContext, isVehicleFieldConfirmed, normalizeVehicleContext, providerVehicleContext, updateVehicleContextField, vehicleContextDetails, vehicleContextsMatch } from "./vehicleContext";
import type { ShopVehicleContext } from "../types";

const now = "2026-11-05T12:00:00.000Z";

describe("vehicle context confirmation", () => {
  it("preserves legacy and shop facts without promoting VIN, review or training flags", () => {
    expect(normalizeVehicleContext({ year: " 2014 ", make: "Toyota", vin: "VIN123", mileage: "120000 miles", notes: "Owner notes", customerName: "Private customer", plate: "Private plate", technicianName: "Private technician", reviewStatus: "confirmed", trainingStatus: "user_confirmed" })).toEqual({ vin: "VIN123", year: "2014", make: "Toyota", mileage: "120000 miles", notes: "Owner notes", customerName: "Private customer", plate: "Private plate", technicianName: "Private technician" });
  });

  it("retains exact confirmations through serialization and deterministic normalization", () => {
    let context: ShopVehicleContext = { year: " 2014 ", mileage: "120000", mileageUnit: "mi", modifications: { status: "modified", details: "Aftermarket intake" } };
    for (const field of ["year", "mileage", "modifications"] as const) context = confirmVehicleContextField(context, field, true, now);
    const restored = normalizeVehicleContext(JSON.parse(JSON.stringify(context)));
    expect(restored).toEqual(context);
    expect(restored?.confirmedFields).toEqual({ year: { value: "2014", confirmedAt: now }, mileage: { value: '["120000","mi"]', confirmedAt: now }, modifications: { value: '["modified","Aftermarket intake"]', confirmedAt: now } });
  });

  it.each(["year", "engine"] as const)("invalidates only the edited %s and preserves raw multiword typing", (field) => {
    let context = confirmVehicleContextField({ year: "2014", engine: "2.5L inline four" }, "year", true, now);
    context = confirmVehicleContextField(context, "engine", true, now);
    const changed = updateVehicleContextField(context, field, "New value ");
    expect(changed[field]).toBe("New value ");
    expect(changed.confirmedFields?.[field]).toBeUndefined();
    expect(isVehicleFieldConfirmed(changed, field === "year" ? "engine" : "year")).toBe(true);
    expect(context.confirmedFields?.[field]).toBeDefined();
  });

  it("invalidates mileage when units change, including tampered persisted metadata", () => {
    const context = confirmVehicleContextField({ mileage: "120000", mileageUnit: "mi" }, "mileage", true, now);
    expect(updateVehicleContextField(context, "mileageUnit", "km").confirmedFields).toBeUndefined();
    expect(normalizeVehicleContext({ ...context, mileageUnit: "km" })?.confirmedFields).toBeUndefined();
    expect(normalizeVehicleContext({ ...context, mileage: "125000" })?.confirmedFields).toBeUndefined();
  });

  it("invalidates modifications when either details or status changes", () => {
    const context = confirmVehicleContextField({ modifications: { status: "modified", details: "Engine swap" } }, "modifications", true, now);
    expect(isVehicleFieldConfirmed({ ...context, modifications: { status: "modified", details: "Intake" } }, "modifications")).toBe(false);
    expect(isVehicleFieldConfirmed({ ...context, modifications: { status: "none_known" } }, "modifications")).toBe(false);
    expect(isVehicleFieldConfirmed(confirmVehicleContextField({ modifications: { status: "none_known" } }, "modifications", true, now), "modifications")).toBe(true);
  });

  it.each([
    { context: {}, field: "year" as const },
    { context: { engine: "unknown" }, field: "engine" as const },
    { context: { mileage: "120000", mileageUnit: "unknown" as const }, field: "mileage" as const },
    { context: { modifications: { status: "unknown" as const } }, field: "modifications" as const },
    { context: { modifications: { status: "modified" as const } }, field: "modifications" as const },
  ])("does not confirm unknown or incomplete details ($field)", ({ context, field }) => {
    expect(confirmVehicleContextField(context, field, true, now).confirmedFields).toBeUndefined();
  });

  it("explicitly removes confirmation without deleting the fact", () => {
    const confirmed = confirmVehicleContextField({ model: "Camry" }, "model", true, now);
    expect(confirmVehicleContextField(confirmed, "model", false, now)).toEqual({ model: "Camry" });
  });

  it("canonicalizes VIN case before confirmation so shop persistence retains the exact fact", () => {
    const context = confirmVehicleContextField({ vin: " 1hgcm82633a004352 " }, "vin", true, now);
    expect(context.vin).toBe("1HGCM82633A004352");
    expect(normalizeVehicleContext({ ...context, vin: "1HGCM82633A004352" })).toEqual(context);
    expect(context.confirmedFields?.vin?.value).toBe("1HGCM82633A004352");
  });

  it("strips malformed or stale metadata independently of usable legacy facts", () => {
    expect(normalizeVehicleContext({ make: "Toyota", engine: "2.5L", mileageUnit: "yards", modifications: { status: "made_up" }, confirmedFields: { make: { value: "Honda", confirmedAt: now }, engine: { value: "2.5L", confirmedAt: "yesterday" }, customerName: { value: "Private", confirmedAt: now } } })).toEqual({ make: "Toyota", engine: "2.5L" });
  });

  it("never truncates an oversized value into a different confirmed fact", () => {
    const engine = "x".repeat(121);
    expect(normalizeVehicleContext({ year: "2014", engine, confirmedFields: { engine: { value: engine.slice(0, 120), confirmedAt: now } } })).toEqual({ year: "2014" });
  });

  it("preserves the existing 500-character shop complaint and notes bounds", () => {
    const symptom = "r".repeat(500);
    const notes = "n".repeat(500);
    expect(normalizeVehicleContext({ symptom, notes })).toEqual({ symptom, notes });
    expect(providerVehicleContext({ symptom, notes })).toEqual({ symptom });
  });

  it("does not silently accept contradictory modification details as none known", () => {
    expect(normalizeVehicleContext({ make: "Toyota", modifications: { status: "none_known", details: "Engine swap" }, confirmedFields: { modifications: { value: '["none_known",""]', confirmedAt: now } } })).toEqual({ make: "Toyota" });
  });

  it("does not forward shop identifiers or freeform notes to providers", () => {
    const context = { year: "2014", engine: "2.5L", customerName: "Secret customer", plate: "Secret plate", technicianName: "Secret technician", jobTitle: "Secret job", bayOrRo: "Secret RO", notes: "Secret notes", symptom: "Rattle under load" };
    expect(providerVehicleContext(context)).toEqual({ year: "2014", engine: "2.5L", symptom: "Rattle under load" });
    expect(formatVehicleContext(context)).not.toContain("Secret");
    expect(formatVehicleContext(context)).toContain("User-supplied complaint (unconfirmed; not a visual observation): Rattle under load");
    expect(providerVehicleContext({ customerName: "Only private context" })).toBeUndefined();
  });

  it("labels confirmed, supplied and unknown facts while retaining targeted guidance", () => {
    const context = confirmVehicleContextField({ year: "2014", engine: "2.5L" }, "year", true, now);
    const formatted = formatVehicleContext(context);
    expect(formatted).toContain("Year: 2014 — user-confirmed (self-reported)");
    expect(formatted).toContain("Engine: 2.5L — supplied, unconfirmed");
    expect(formatted).toContain("Mileage: Unknown — not confirmed");
    expect(formatted).toContain("ask the user to confirm that detail");
    expect(formatted).toContain("do not establish exact part fitment");
    expect(formatVehicleContext(undefined)).toContain("Year: Unknown");
  });

  it("retains notes and symptoms separately for reports without relabeling them as modifications", () => {
    const details = vehicleContextDetails({ notes: "Previous owner notes", symptom: "Rattle", modifications: { status: "unknown" } } as ShopVehicleContext);
    expect(details).toContainEqual(["Notes", "Previous owner notes"]);
    expect(details).toContainEqual(["Symptoms", "Rattle"]);
    expect(details).toContainEqual(["Modifications", "Unknown — not confirmed"]);
  });

  it("compares canonical snapshots irrespective of property order while keeping confirmation and units meaningful", () => {
    expect(vehicleContextsMatch(null, undefined)).toBe(true);
    expect(vehicleContextsMatch({ make: " Toyota ", mileageUnit: "mi", mileage: "120" }, { mileage: "120", make: "Toyota", mileageUnit: "mi" })).toBe(true);
    expect(vehicleContextsMatch({ mileage: "120", mileageUnit: "mi" }, { mileage: "120", mileageUnit: "km" })).toBe(false);
    expect(vehicleContextsMatch({ year: "2014" }, confirmVehicleContextField({ year: "2014" }, "year", true, now))).toBe(false);
  });
});
