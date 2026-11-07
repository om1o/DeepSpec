import type { VehicleIdentityReference } from "../types/vehicleReference";
import { VEHICLE_REFERENCE_ADAPTER_VERSION, VEHICLE_REFERENCE_SOURCE_URL } from "../types/vehicleReference";

export function vehicleReferenceFixture(overrides: Partial<VehicleIdentityReference> = {}): VehicleIdentityReference {
  return {
    version: 1, id: "b0cbf559-868e-4f14-9755-7d22171ad102", provider: "nhtsa-vpic",
    adapterVersion: VEHICLE_REFERENCE_ADAPTER_VERSION, sourceUrl: VEHICLE_REFERENCE_SOURCE_URL,
    retrievedAt: "2026-11-05T12:00:00.000Z", query: { vin: "1HGCM82633A004352", modelYear: 2003 },
    facts: { year: "2003", make: "HONDA", model: "Accord", engineModel: "J30A4" },
    decode: { codes: ["0"], messages: ["VIN decoded cleanly."] }, ...overrides,
  };
}

export function referenceVehicleContext() {
  const reference = vehicleReferenceFixture();
  return {
    vin: reference.query.vin, year: "2003", make: "HONDA",
    referenceOrigins: { references: [reference], fields: { year: reference.id, make: reference.id } },
  };
}
