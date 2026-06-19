import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { getAuthClient } from "../services/auth";
import { getEntitlementState, getRemainingScans, hasScanEntitlement, type ServerEntitlement } from "../services/revenue";
import { getLookups } from "../services/storage";

type EntitlementVerification =
  | { status: "checking" }
  | { status: "verified"; entitlement: ServerEntitlement }
  | { status: "locked"; message: string };

export default function Account() {
  const [params] = useSearchParams();
  const [verification, setVerification] = useState<EntitlementVerification>({ status: "checking" });
  const [portalStatus, setPortalStatus] = useState<string | null>(null);
  const scansUsed = getLookups().length;
  const entitlement = getEntitlementState(scansUsed, verification.status === "verified" ? verification.entitlement : null);
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
          setVerification({ status: "locked", message: "Server entitlement verification needs a valid Supabase session." });
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
            status: "locked",
            message: body?.error?.message ?? "Server entitlement verification is unavailable. Paid access remains fail-closed.",
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
    setPortalStatus("Opening secure billing portal...");

    const client = await getAuthClient();
    const session = client ? await client.auth.getSession().catch(() => null) : null;
    const token = session?.data.session?.access_token;
    if (!token) {
      setPortalStatus("Sign in again before opening billing. Paid access stays locked without a verified session.");
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
      setPortalStatus(body?.error?.message ?? "Billing portal is not configured yet. Paid access remains fail-closed.");
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
              Checkout returned successfully. Paid scans unlock only after server entitlement verification returns an active provider-backed plan.
            </p>
          ) : null}
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <Metric label="Plan" value={entitlement.planName} />
            <Metric label="Scans used" value={String(entitlement.scansUsed)} />
            <Metric label="Remaining" value={String(remaining)} />
          </div>
          <p className="mt-5 text-sm leading-6 text-slate-600">
            Status: {hasScanEntitlement(entitlement) ? "Scanning allowed" : "Scan limit reached"}.
            {" "}
            {verification.status === "checking" ? "Checking server entitlement..." : getVerificationMessage(verification, entitlement.status)}
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
          <h2 className="text-lg font-black tracking-tight text-slate-950">What unlocks next</h2>
          <p className="mt-2">
            Paid access remains fail-closed. It is read from server entitlement storage tied to the verified Supabase session. Local browser data can show free-preview usage, but it cannot unlock paid plans.
          </p>
        </section>
      </div>
    </main>
  );
}

function getVerificationMessage(verification: EntitlementVerification, entitlementStatus: string) {
  if (verification.status === "locked") {
    return /fail-closed/i.test(verification.message)
      ? verification.message
      : `${verification.message} Paid access remains fail-closed.`;
  }

  if (verification.status === "verified" && entitlementStatus === "active") {
    return "Server entitlement verified.";
  }

  return "No active paid entitlement was found; paid scans remain fail-closed.";
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[8px] border border-slate-100 bg-slate-50 p-3">
      <p className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-slate-400">{label}</p>
      <p className="mt-1 text-lg font-black text-slate-950">{value}</p>
    </div>
  );
}
