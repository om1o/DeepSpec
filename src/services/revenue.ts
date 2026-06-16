export type PlanId = "plus_monthly" | "plus_yearly" | "scan_pack" | "pro_beta";

export type RevenuePlan = {
  id: PlanId;
  name: string;
  price: string;
  cadence: string;
  scanAllowance: number;
  audience: string;
  value: string[];
  stripeMode: "payment" | "subscription";
};

export type EntitlementState = {
  currentPeriodEnd?: string;
  planId?: PlanId;
  planName: string;
  scanAllowance: number;
  scansUsed: number;
  status: "free" | "verification_required" | "active";
};

export type ServerEntitlement = {
  currentPeriodEnd?: string;
  planId?: PlanId;
  planName?: string;
  scanAllowance?: number;
  scansUsed?: number;
  status: "free" | "active" | "past_due" | "canceled" | "inactive";
  verifiedAt: string;
};

export const REVENUE_PLANS: RevenuePlan[] = [
  {
    id: "plus_monthly",
    name: "DeepSpec Plus",
    price: "$9.99",
    cadence: "monthly",
    scanAllowance: 100,
    audience: "DIY owners who scan more than once",
    stripeMode: "subscription",
    value: [
      "Ranked likely part candidates",
      "Saved cloud history",
      "Measurement tools",
      "Shareable scan reports",
    ],
  },
  {
    id: "plus_yearly",
    name: "DeepSpec Plus Yearly",
    price: "$59",
    cadence: "yearly",
    scanAllowance: 1200,
    audience: "Returning owners and weekend wrenchers",
    stripeMode: "subscription",
    value: [
      "All Plus features",
      "Lower yearly price",
      "More room for second-angle refinement",
    ],
  },
  {
    id: "scan_pack",
    name: "Scan Pack",
    price: "$4.99",
    cadence: "one time",
    scanAllowance: 20,
    audience: "One-off diagnosis before buying parts",
    stripeMode: "payment",
    value: [
      "20 AI part scans",
      "Saved local scan reports",
      "No subscription",
    ],
  },
  {
    id: "pro_beta",
    name: "DeepSpec Pro Beta",
    price: "$49",
    cadence: "monthly",
    scanAllowance: 500,
    audience: "Small shops and inspection workflows",
    stripeMode: "subscription",
    value: [
      "500 scans per month",
      "VIN/year/make/model context",
      "Intake reports",
      "Priority eval feedback",
    ],
  },
];

export function getRevenuePlan(planId: string | null | undefined) {
  return REVENUE_PLANS.find((plan) => plan.id === planId) ?? null;
}

export function getEntitlementState(scansUsed: number, serverEntitlement?: ServerEntitlement | null): EntitlementState {
  if (
    serverEntitlement?.status === "active" &&
    serverEntitlement.planId &&
    typeof serverEntitlement.scanAllowance === "number" &&
    Number.isFinite(serverEntitlement.scanAllowance) &&
    serverEntitlement.scanAllowance > 0
  ) {
    const plan = getRevenuePlan(serverEntitlement.planId);
    return {
      currentPeriodEnd: serverEntitlement.currentPeriodEnd,
      planId: serverEntitlement.planId,
      planName: serverEntitlement.planName || plan?.name || "Verified paid plan",
      scanAllowance: serverEntitlement.scanAllowance,
      scansUsed: Math.max(0, Math.floor(serverEntitlement.scansUsed ?? 0)),
      status: "active",
    };
  }

  return {
    planName: "Free preview",
    scanAllowance: 5,
    scansUsed,
    status: "free",
  };
}

export function hasScanEntitlement(state: EntitlementState) {
  return state.scansUsed < state.scanAllowance;
}

export function getRemainingScans(state: EntitlementState) {
  return Math.max(0, state.scanAllowance - state.scansUsed);
}
