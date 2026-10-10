export type PlanId = "plus_monthly" | "plus_yearly" | "scan_pack" | "pro_beta";

export type RevenuePlan = {
  id: PlanId;
  name: string;
  price: string;
  cadence: string;
  scanAllowance: number;
  audience: string;
  value: string[];
  billingMode: "payment" | "subscription";
  /**
   * @deprecated Use billingMode. Kept temporarily so older tests/build paths do
   * not misread persisted plan objects during the provider-neutral migration.
   */
  stripeMode: "payment" | "subscription";
};

export type EntitlementState = {
  currentPeriodEnd?: string;
  planId?: PlanId;
  planName: string;
  scanAllowance: number | null;
  scansUsed: number | null;
  status: "unknown" | "free" | "verification_required" | "active";
};

export type ServerEntitlement = {
  billingProvider?: string;
  currentPeriodEnd?: string;
  planId?: PlanId;
  planName?: string;
  scanAllowance?: number;
  scansUsed?: number;
  status: "free" | "verification_required" | "active" | "past_due" | "canceled" | "inactive";
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
    billingMode: "subscription",
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
    billingMode: "subscription",
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
    billingMode: "payment",
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
    billingMode: "subscription",
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

export function getEntitlementState(
  serverEntitlement?: ServerEntitlement | null,
  fallbackStatus: "unknown" | "verification_required" = "unknown",
): EntitlementState {
  if (!serverEntitlement) {
    return fallbackStatus === "verification_required"
      ? {
          planName: "Verification required",
          scanAllowance: null,
          scansUsed: null,
          status: "verification_required",
        }
      : {
          planName: "Access unavailable",
          scanAllowance: null,
          scansUsed: null,
          status: "unknown",
        };
  }

  if (serverEntitlement.status === "verification_required") {
    return {
      planName: "Verification required",
      scanAllowance: null,
      scansUsed: null,
      status: "verification_required",
    };
  }

  if (
    serverEntitlement.status === "active" &&
    serverEntitlement.planId &&
    typeof serverEntitlement.scanAllowance === "number" &&
    Number.isFinite(serverEntitlement.scanAllowance) &&
    serverEntitlement.scanAllowance > 0 &&
    typeof serverEntitlement.scansUsed === "number" &&
    Number.isFinite(serverEntitlement.scansUsed) &&
    serverEntitlement.scansUsed >= 0
  ) {
    const plan = getRevenuePlan(serverEntitlement.planId);
    return {
      currentPeriodEnd: serverEntitlement.currentPeriodEnd,
      planId: serverEntitlement.planId,
      planName: serverEntitlement.planName || plan?.name || "Verified paid plan",
      scanAllowance: serverEntitlement.scanAllowance,
      scansUsed: Math.floor(serverEntitlement.scansUsed),
      status: "active",
    };
  }

  if (serverEntitlement.status === "active") {
    return {
      planName: "Access unavailable",
      scanAllowance: null,
      scansUsed: null,
      status: "unknown",
    };
  }

  const scanAllowance = serverEntitlement.scanAllowance;
  const scansUsed = serverEntitlement.scansUsed;
  const hasAuthoritativeCounts =
    typeof scanAllowance === "number" &&
    Number.isFinite(scanAllowance) &&
    scanAllowance >= 0 &&
    typeof scansUsed === "number" &&
    Number.isFinite(scansUsed) &&
    scansUsed >= 0;

  return {
    planName: "Free preview",
    scanAllowance: hasAuthoritativeCounts ? Math.floor(scanAllowance) : null,
    scansUsed: hasAuthoritativeCounts ? Math.floor(scansUsed) : null,
    status: "free",
  };
}

export function hasScanEntitlement(state: EntitlementState) {
  return state.scansUsed !== null && state.scanAllowance !== null && state.scansUsed < state.scanAllowance;
}

export function getRemainingScans(state: EntitlementState) {
  if (state.scansUsed === null || state.scanAllowance === null) {
    return null;
  }

  return Math.max(0, state.scanAllowance - state.scansUsed);
}
