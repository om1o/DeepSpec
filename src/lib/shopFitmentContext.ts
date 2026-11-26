import type { FitmentConfidence, IdentificationResult, ShopVehicleContext, VehicleContext } from "../types/index.js";
import { isVehicleFieldConfirmed } from "./vehicleContext.js";

/** AI output, a VIN, and a photographed label cannot establish a parts-catalog application. */
export function getFitmentStatus(_result: IdentificationResult | undefined, vehicleContext: VehicleContext | undefined): FitmentConfidence {
  return isVehicleFieldConfirmed(vehicleContext, "vin") ? "needs_catalog_verification" : "needs_vehicle_context";
}

export function fitmentStatusLabel(status: FitmentConfidence): string {
  if (status === "not_applicable") return "Not applicable";
  return status === "needs_catalog_verification" ? "Catalog verification needed" : "Vehicle context needed";
}

export function applyShopFitmentContext(result: IdentificationResult, vehicleContext: ShopVehicleContext | undefined): IdentificationResult {
  const fitmentConfidence = getFitmentStatus(result, vehicleContext);
  return {
    ...result,
    fitmentConfidence,
    requiredNextEvidence: Array.from(new Set([
      ...(result.requiredNextEvidence ?? []),
      ...(!vehicleContext?.vin ? ["VIN"] : []),
      ...(fitmentConfidence === "needs_vehicle_context" ? ["Confirm the vehicle VIN"] : []),
      "Check the exact part number and vehicle options in an authorized parts catalog",
      "label photo or second angle if the part number is not visible",
    ])),
  };
}
