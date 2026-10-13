import { beforeEach, describe, expect, it } from "vitest";
import { getEntitlementState, getRemainingScans, getRevenuePlan, hasScanEntitlement } from "./revenue";

describe("revenue", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("does not invent free usage while server verification is unavailable", () => {
    const entitlement = getEntitlementState();

    expect(entitlement).toEqual({
      planName: "Access unavailable",
      scanAllowance: null,
      scansUsed: null,
      status: "unknown",
    });
    expect(getRemainingScans(entitlement)).toBeNull();
    expect(hasScanEntitlement(entitlement)).toBe(false);
  });

  it("shows verification-required without an allowance", () => {
    const entitlement = getEntitlementState(null, "verification_required");

    expect(entitlement).toMatchObject({
      planName: "Verification required",
      scanAllowance: null,
      scansUsed: null,
      status: "verification_required",
    });
    expect(getRemainingScans(entitlement)).toBeNull();
    expect(hasScanEntitlement(entitlement)).toBe(false);
  });

  it("uses active server entitlement for paid access", () => {
    const entitlement = getEntitlementState({
      planId: "plus_monthly",
      planName: "DeepSpec Plus",
      scanAllowance: 100,
      scansUsed: 12,
      status: "active",
      verifiedAt: "2026-06-15T00:00:00.000Z",
    });

    expect(entitlement).toMatchObject({
      planId: "plus_monthly",
      planName: "DeepSpec Plus",
      scanAllowance: 100,
      scansUsed: 12,
      status: "active",
    });
    expect(hasScanEntitlement(entitlement)).toBe(true);
  });

  it("does not trust local storage for paid entitlement state", () => {
    localStorage.setItem("deep-spec:billing:entitlement", JSON.stringify({
      planName: "DeepSpec Plus",
      scanAllowance: 100,
    }));

    const entitlement = getEntitlementState();

    expect(entitlement.status).toBe("unknown");
    expect(entitlement.scanAllowance).toBeNull();
    expect(hasScanEntitlement(entitlement)).toBe(false);
  });

  it("uses server free usage rather than another device's local count", () => {
    const entitlement = getEntitlementState({ status: "free", scanAllowance: 5, scansUsed: 5, verifiedAt: "2026-10-07" });
    expect(hasScanEntitlement(entitlement)).toBe(false);
    expect(entitlement.scansUsed).toBe(5);
  });

  it("finds configured paid plans by stable id", () => {
    expect(getRevenuePlan("plus_monthly")).toMatchObject({
      name: "DeepSpec Plus",
      scanAllowance: 100,
      billingMode: "subscription",
    });
    expect(getRevenuePlan("scan_pack")).toMatchObject({
      scanAllowance: 20,
      billingMode: "payment",
    });
    expect(getRevenuePlan("bad-plan")).toBeNull();
  });
});
