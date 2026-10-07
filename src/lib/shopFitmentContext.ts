import type { IdentificationResult, ShopVehicleContext } from "../types";

export function applyShopFitmentContext(result: IdentificationResult, vehicleContext: ShopVehicleContext | undefined): IdentificationResult {
  if (!vehicleContext) return result;
  return {
    ...result,
    fitmentConfidence: vehicleContext.vin ? result.fitmentConfidence ?? "possible" : "needs_vehicle_context",
    requiredNextEvidence: Array.from(new Set([
      ...(result.requiredNextEvidence ?? []),
      ...(!vehicleContext.vin ? ["VIN"] : []),
      "label photo or second angle if the part number is not visible",
    ])),
  };
}
