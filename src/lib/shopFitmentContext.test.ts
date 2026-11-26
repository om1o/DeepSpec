import { describe, expect, it } from "vitest";
import { confirmVehicleContextField } from "./vehicleContext";
import { applyShopFitmentContext, fitmentStatusLabel, getFitmentStatus } from "./shopFitmentContext";
import type { IdentificationResult } from "../types";

const result = { scanCategory: "electrical", fitmentConfidence: "supported", requiredNextEvidence: ["Read selected label"] } as IdentificationResult;

describe("fitment evidence boundary", () => {
  it("does not treat an AI-supported claim, visible marking, or unconfirmed VIN as catalog fitment", () => {
    const vehicle = { vin: "1HGCM82633A004352", year: "2003", make: "Honda", model: "Accord", engine: "2.4L" };
    expect(getFitmentStatus(result, vehicle)).toBe("needs_vehicle_context");
    expect(applyShopFitmentContext(result, vehicle)).toMatchObject({
      fitmentConfidence: "needs_vehicle_context",
      requiredNextEvidence: expect.arrayContaining(["Confirm the vehicle VIN", "Check the exact part number and vehicle options in an authorized parts catalog"]),
    });
    expect(result.fitmentConfidence).toBe("supported");
  });

  it("still requires a catalog match after the VIN and build details are user-confirmed", () => {
    let vehicle = confirmVehicleContextField({ vin: "1HGCM82633A004352", buildDetails: "LX, 2WD, built 03/2003" }, "vin", true);
    vehicle = confirmVehicleContextField(vehicle, "buildDetails", true);
    expect(getFitmentStatus(result, vehicle)).toBe("needs_catalog_verification");
    expect(fitmentStatusLabel(getFitmentStatus(result, vehicle))).toBe("Catalog verification needed");
    expect(applyShopFitmentContext(result, vehicle).fitmentConfidence).toBe("needs_catalog_verification");
  });

  it("does not revive a legacy supported claim when a saved scan has no vehicle snapshot", () => {
    expect(getFitmentStatus(result, undefined)).toBe("needs_vehicle_context");
    expect(applyShopFitmentContext(result, undefined).fitmentConfidence).toBe("needs_vehicle_context");
  });

  it("does not let an uncertain AI category suppress the fitment check", () => {
    const uncertain = { ...result, scanCategory: "unknown" as const, fitmentConfidence: "not_applicable" as const };
    expect(getFitmentStatus(uncertain, undefined)).toBe("needs_vehicle_context");
    expect(applyShopFitmentContext(uncertain, undefined).fitmentConfidence).toBe("needs_vehicle_context");
  });
});
