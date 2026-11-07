export const VEHICLE_REFERENCE_SOURCE_URL = "https://vpic.nhtsa.dot.gov/api/";
export const VEHICLE_REFERENCE_ADAPTER_VERSION = "nhtsa-vpic-v1";

export type VehicleReferenceQuery = { vin: string; modelYear?: number };
export type VehicleReferenceField = "year" | "make" | "model" | "engine";
/** Exact reviewed sources for current values; not human confirmation or repair data. */
export type VehicleReferenceOrigins = {
  references: VehicleIdentityReference[];
  fields: Partial<Record<VehicleReferenceField, string>>;
};
export type VehicleReferenceFacts = {
  year?: string;
  make?: string;
  model?: string;
  engineModel?: string;
  engineManufacturer?: string;
  cylinders?: string;
  displacementL?: string;
  fuelType?: string;
};

/** Manufacturer-reported identity, separate from human confirmation or installed equipment. */
export type VehicleIdentityReference = {
  version: 1;
  id: string;
  provider: "nhtsa-vpic";
  adapterVersion: typeof VEHICLE_REFERENCE_ADAPTER_VERSION;
  retrievedAt: string;
  sourceUrl: typeof VEHICLE_REFERENCE_SOURCE_URL;
  query: VehicleReferenceQuery;
  facts: VehicleReferenceFacts;
  decode: { codes: string[]; messages: string[] };
};
