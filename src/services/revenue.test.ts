import { beforeEach, describe, expect, it } from "vitest";
import { getEntitlementState, getRemainingScans, getRevenuePlan, hasScanEntitlement } from "./revenue";

describe("revenue", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("defaults to a limited free preview without local paid bypass", () => {
    const entitlement = getEntitlementState(2);

    expect(entitlement).toEqual({
      planName: "Free preview",
      scanAllowance: 5,
      scansUsed: 2,
      status: "free",
    });
    expect(getRemainingScans(entitlement)).toBe(3);
    expect(hasScanEntitlement(entitlement)).toBe(true);
  });

  it("blocks scans once the free preview limit is reached", () => {
    const entitlement = getEntitlementState(5);

    expect(getRemainingScans(entitlement)).toBe(0);
    expect(hasScanEntitlement(entitlement)).toBe(false);
  });

  it("uses active server entitlement for paid access", () => {
    const entitlement = getEntitlementState(5, {
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

    const entitlement = getEntitlementState(5);

    expect(entitlement.status).toBe("free");
    expect(entitlement.scanAllowance).toBe(5);
    expect(hasScanEntitlement(entitlement)).toBe(false);
  });

  it("finds configured paid plans by stable id", () => {
    expect(getRevenuePlan("plus_monthly")).toMatchObject({
      name: "DeepSpec Plus",
      scanAllowance: 100,
      stripeMode: "subscription",
    });
    expect(getRevenuePlan("scan_pack")).toMatchObject({
      scanAllowance: 20,
      stripeMode: "payment",
    });
    expect(getRevenuePlan("bad-plan")).toBeNull();
  });
});
