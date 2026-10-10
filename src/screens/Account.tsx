import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { getAuthClient } from "../services/auth";
import { getEntitlementState, getRemainingScans, hasScanEntitlement, type ServerEntitlement } from "../services/revenue";

type EntitlementVerification =
  | { status: "checking" }
  | { status: "verified"; entitlement: ServerEntitlement }
  | { status: "verification_required"; message: string }
  | { status: "unavailable"; message: string };

export default function Account() {
  const [params] = useSearchParams();
  const [verification, setVerification] = useState<EntitlementVerification>({ status: "checking" });
  const [portalStatus, setPortalStatus] = useState<string | null>(null);
  const entitlement = getEntitlementState(
    verification.status === "verified" ? verification.entitlement : null,
    verification.status === "verification_required" ? "verification_required" : "unknown",
  );
  const remaining = getRemainingScans(entitlement);
  const checkoutState = params.get("checkout");

  useEffect(() => {
    let isMounted = true;

    async function verifyEntitlement() {
      const client = await getAuthClient();
      const session = client ? await client.auth.getSession().catch(() => null) : null;
      const token = session?.data.session?.access_token;
      if (!token) {
        if (isMounted) {
          setVerification({ status: "verification_required", message: "Sign in with a verified account to check scan access." });
        }
        return;
      }

      const response = await fetch("/api/account-entitlement", {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }).catch(() => null);
      const body = await response?.json().catch(() => null);
      if (!response?.ok || !body?.entitlement) {
        if (isMounted) {
          setVerification({
            status: "unavailable",
            message: body?.error?.message ?? "Entitlement check unavailable. Scan access cannot be confirmed right now.",
          });
        }
        return;
      }

      if (isMounted) {
        setVerification({ status: "verified", entitlement: body.entitlement });
      }
    }

    void verifyEntitlement();

    return () => {
      isMounted = false;
    };
  }, []);

  async function openBillingPortal() {
    setPortalStatus("Opening billing portal...");

    const client = await getAuthClient();
    const session = client ? await client.auth.getSession().catch(() => null) : null;
    const token = session?.data.session?.access_token;
    if (!token) {
      setPortalStatus("Sign in to open billing.");
      return;
    }

    const response = await fetch("/api/billing-portal", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        origin: window.location.origin,
      }),
    }).catch(() => null);
    const body = await response?.json().catch(() => null);
    if (!response?.ok || !body?.url) {
      setPortalStatus(body?.error?.message ?? "Billing portal not configured yet.");
      return;
    }

    window.location.assign(body.url);
  }

  return (
    <main className="min-h-dvh bg-[var(--ds-page)] px-4 pb-8 pt-[max(18px,env(safe-area-inset-top))] text-slate-950">
      <div className="mx-auto w-full max-w-2xl">
        <header className="flex items-center justify-between gap-3">
          <Link to="/scan" className="text-sm font-bold text-[var(--ds-accent)]">
            Scan
          </Link>
          <Link to="/pricing" className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-900">
            Pricing
          </Link>
        </header>

        <section className="mt-8 rounded-[8px] border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-sm font-extrabold uppercase tracking-[0.14em] text-[var(--ds-accent)]">Account</p>
          <h1 className="mt-3 text-3xl font-black tracking-tight">Your DeepSpec access</h1>
          {checkoutState === "success" ? (
            <p className="mt-3 rounded-[8px] bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-900">
              Checkout complete. Paid scans unlock once entitlement verification confirms an active plan.
            </p>
          ) : null}
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <Metric label="Plan" value={entitlement.planName} />
            <Metric label="Scans used" value={formatMetric(entitlement.scansUsed)} />
            <Metric label="Remaining" value={formatMetric(remaining)} />
          </div>
          <p className="mt-5 text-sm leading-6 text-slate-600">
            Status: {getAccessStatus(entitlement)}.
            {" "}
            {verification.status === "checking" ? "Checking account access..." : getVerificationMessage(verification, entitlement.status)}
          </p>
          <button
            className="mt-5 h-11 rounded-full bg-slate-950 px-4 text-sm font-bold text-white disabled:opacity-50"
            disabled={verification.status === "checking"}
            onClick={() => void openBillingPortal()}
            type="button"
          >
            Manage billing
          </button>
          {portalStatus ? (
            <p className="mt-3 text-sm font-semibold text-slate-600">{portalStatus}</p>
          ) : null}
        </section>

        <section className="mt-4 rounded-[8px] border border-slate-200 bg-white p-6 text-sm leading-6 text-slate-600 shadow-sm">
          <h2 className="text-lg font-black tracking-tight text-slate-950">How access works</h2>
          <p className="mt-2">
            Free and paid scan usage must come from the server account record tied to your verified session. Saved scans in this browser do not determine your allowance.
          </p>
        </section>
      </div>
    </main>
  );
}

function getVerificationMessage(verification: EntitlementVerification, entitlementStatus: string) {
  if (verification.status === "verification_required" || verification.status === "unavailable") {
    return verification.message;
  }

  if (verification.status === "verified" && entitlementStatus === "active") {
    return "Entitlement verified.";
  }

  if (verification.status === "verified" && entitlementStatus === "free") {
    return "The server verified this account and its free-scan usage.";
  }

  if (verification.status === "verified" && entitlementStatus === "verification_required") {
    return "Confirm an email or phone identity before scanning.";
  }

  return "Scan access could not be verified.";
}

function getAccessStatus(entitlement: ReturnType<typeof getEntitlementState>) {
  if (hasScanEntitlement(entitlement)) return "Scanning allowed";
  if (entitlement.status === "verification_required") return "Verification required";
  if (entitlement.status === "free" && entitlement.scanAllowance === null) return "Scan allowance unavailable";
  if (entitlement.status === "unknown") return "Access unavailable";
  return "Scan limit reached";
}

function formatMetric(value: number | null) {
  return value === null ? "Unavailable" : String(value);
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[8px] border border-slate-100 bg-slate-50 p-3">
      <p className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-slate-400">{label}</p>
      <p className="mt-1 text-lg font-black text-slate-950">{value}</p>
    </div>
  );
}
