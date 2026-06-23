import { useState } from "react";
import { Link } from "react-router-dom";
import { getAuthClient } from "../services/auth";
import { REVENUE_PLANS, type PlanId } from "../services/revenue";

type CheckoutResponse =
  | { url: string }
  | { error: { code: string; message: string } };

const RELEASE_CHECKS = [
  "Polar sandbox only",
  "Webhook-entitlement proof",
  "Visual Evidence AR",
  "AI release gate required",
];

const EVIDENCE_STEPS = [
  "Checkout",
  "Webhook",
  "Entitlement",
  "Portal",
];

export default function Pricing() {
  const [checkoutStatus, setCheckoutStatus] = useState<string | null>(null);
  const [activePlanId, setActivePlanId] = useState<PlanId | null>(null);

  async function startCheckout(planId: PlanId) {
    setActivePlanId(planId);
    setCheckoutStatus("Starting secure provider checkout...");

    const client = await getAuthClient();
    const session = client ? await client.auth.getSession().catch(() => null) : null;
    const token = session?.data.session?.access_token;
    if (!token) {
      setActivePlanId(null);
      setCheckoutStatus("Sign in again before checkout. Paid access stays locked without a verified session.");
      return;
    }

    const response = await fetch("/api/billing-checkout", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        planId,
        origin: window.location.origin,
      }),
    }).catch(() => null);

    if (!response) {
      setActivePlanId(null);
      setCheckoutStatus("Checkout is unreachable. Keep scanning free until billing is configured.");
      return;
    }

    const body = (await response.json().catch(() => null)) as CheckoutResponse | null;
    if (!response.ok || !body || "error" in body) {
      setActivePlanId(null);
      setCheckoutStatus(body && "error" in body ? body.error.message : "Checkout is not configured yet.");
      return;
    }

    window.location.assign(body.url);
  }

  return (
    <main className="min-h-dvh bg-[var(--ds-page)] px-4 pb-10 pt-[max(18px,env(safe-area-inset-top))] text-white">
      <div className="mx-auto w-full max-w-6xl">
        <header className="flex items-center justify-between gap-3">
          <Link to="/scan" className="inline-flex items-center gap-2 text-sm font-bold text-[var(--electric-300)]">
            Scan
          </Link>
          <Link to="/account" className="rounded-full border border-white/[0.12] bg-white/[0.08] px-4 py-2 text-sm font-bold text-white">
            Account
          </Link>
        </header>

        <section className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)] lg:items-end">
          <div>
            <p className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--electric-300)]">DeepSpec Auto paid beta</p>
            <h1 className="mt-3 max-w-4xl text-4xl font-black tracking-tight sm:text-6xl">
              Engineer-grade scan evidence, not fake certainty.
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-7 text-[var(--slate-200)]">
              DeepSpec Auto ranks likely part names, preserves visible evidence, and asks for VIN, labels, second angles, or same-plane references when the scan is not ready.
              Paid access stays locked until Polar sandbox checkout, webhook, entitlement, and portal proof all pass.
            </p>
          </div>

          <div className="rounded-[14px] border border-white/[0.12] bg-white/[0.07] p-4 shadow-[0_18px_60px_rgba(0,0,0,0.35)]">
            <div className="flex items-center justify-between gap-3">
              <p className="font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--slate-200)]">Release rail</p>
              <span className="rounded-full border border-amber-300/[0.30] bg-amber-300/[0.10] px-2.5 py-1 text-[11px] font-black uppercase tracking-[0.08em] text-amber-100">
                Sandbox only
              </span>
            </div>
            <div className="mt-4 grid grid-cols-4 gap-2">
              {EVIDENCE_STEPS.map((step) => (
                <div key={step} className="rounded-[8px] border border-white/[0.10] bg-black/[0.24] px-2 py-3 text-center">
                  <p className="font-mono text-[10px] font-bold uppercase tracking-[0.06em] text-[var(--electric-300)]">{step}</p>
                </div>
              ))}
            </div>
            <p className="mt-4 text-sm leading-6 text-[var(--slate-200)]">
              The provider path is Polar testing only. No live payments, no Stripe setup, and no paid-beta claim until the gates prove it.
            </p>
          </div>
        </section>

        {checkoutStatus ? (
          <div className="mt-6 rounded-[10px] border border-[var(--ds-accent-line)] bg-[var(--ds-accent-soft)] px-4 py-3 text-sm font-semibold text-[var(--slate-050)]">
            {checkoutStatus}
          </div>
        ) : null}

        <section className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {REVENUE_PLANS.map((plan) => (
            <article key={plan.id} className="flex min-h-[370px] flex-col rounded-[8px] border border-white/[0.10] bg-white/[0.055] p-5 shadow-[0_14px_44px_rgba(0,0,0,0.28)]">
              <p className="min-h-[34px] text-xs font-extrabold uppercase tracking-[0.12em] text-[var(--slate-300)]">{plan.audience}</p>
              <h2 className="mt-3 text-xl font-black tracking-tight text-white">{plan.name}</h2>
              <p className="mt-2 text-3xl font-black text-white">{plan.price}</p>
              <p className="text-sm font-bold text-[var(--slate-300)]">{plan.cadence}</p>
              <p className="mt-3 rounded-[8px] border border-white/[0.10] bg-black/[0.20] px-3 py-2 text-sm font-bold text-[var(--slate-100)]">
                {plan.scanAllowance} scans
              </p>
              <ul className="mt-4 flex-1 space-y-2 text-sm leading-6 text-[var(--slate-200)]">
                {plan.value.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
              <button
                className="mt-5 h-11 rounded-[8px] border border-[var(--electric-300)] bg-[var(--electric-500)]/[0.14] px-4 text-sm font-bold text-white disabled:opacity-50"
                disabled={activePlanId !== null}
                onClick={() => void startCheckout(plan.id)}
                type="button"
              >
                {activePlanId === plan.id ? "Starting..." : "Start sandbox checkout"}
              </button>
            </article>
          ))}
        </section>

        <section className="mt-6 grid gap-3 lg:grid-cols-[0.9fr_1.1fr]">
          <div className="rounded-[8px] border border-white/[0.10] bg-white/[0.055] p-5 text-sm leading-6 text-[var(--slate-200)]">
            <h2 className="text-lg font-black tracking-tight text-white">Paid beta rules</h2>
            <p className="mt-2">
              A paid scan should never be consumed when the AI provider fails, billing is not configured, or the result cannot be parsed.
              The app must show uncertainty, required next evidence, and measurement caveats before asking users to pay.
            </p>
          </div>
          <div className="rounded-[8px] border border-white/[0.10] bg-white/[0.055] p-5">
            <h2 className="text-lg font-black tracking-tight text-white">Readiness checklist</h2>
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {RELEASE_CHECKS.map((check) => (
                <div key={check} className="rounded-[8px] border border-white/[0.10] bg-black/[0.20] px-3 py-2 text-sm font-bold text-[var(--slate-100)]">
                  {check}
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
