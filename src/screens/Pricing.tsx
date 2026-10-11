import { BrandLockup } from "../components/BrandLockup";
import { useState } from "react";
import { Link } from "react-router-dom";
import { getAuthClient } from "../services/auth";
import { REVENUE_PLANS, type PlanId } from "../services/revenue";

type CheckoutResponse =
  | { url: string }
  | { error: { code: string; message: string } };

const PREVIEW_LIMITS = [
  "Review AI suggestions",
  "Confirm fitment independently",
  "No functional diagnosis from a photo",
  "Paid plans are not available yet",
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
        <header className="ds-app-header">
          <BrandLockup size="sm" />
          <nav className="flex items-center gap-4" aria-label="Pricing navigation">
            <Link to="/scan" className="inline-flex items-center gap-2 text-sm font-bold text-[var(--electric-300)]">
              Scan
            </Link>
            <Link to="/account" className="rounded-full border border-white/[0.12] bg-white/[0.08] px-4 py-2 text-sm font-bold text-white">
              Account
            </Link>
          </nav>
        </header>

        <section className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)] lg:items-end">
          <div>
            <p className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--electric-300)]">DeepSpec preview plans</p>
            <h1 className="mt-3 max-w-4xl text-4xl font-black tracking-tight sm:text-6xl">
              From a part photo to a useful inspection record.
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-7 text-[var(--slate-200)]">
              Review likely part names, visible details, and the evidence behind each suggestion. Keep your inspection together so you can return to it later.
              These plans are being evaluated during the preview; pricing and allowances are not a live offer.
            </p>
          </div>

          <div className="rounded-[14px] border border-white/[0.12] bg-white/[0.07] p-4 shadow-[0_18px_60px_rgba(0,0,0,0.35)]">
            <div className="flex items-center justify-between gap-3">
              <p className="font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--slate-200)]">Preview availability</p>
              <span className="rounded-full border border-amber-300/[0.30] bg-amber-300/[0.10] px-2.5 py-1 text-[11px] font-black uppercase tracking-[0.08em] text-amber-100">
                Sandbox only
              </span>
            </div>
            <p className="mt-4 text-sm leading-6 text-[var(--slate-200)]">
              Paid plans are not available yet. Checkout is a Polar sandbox test, not a live payment. Your account will show verified access and remaining scans when available.
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
            <h2 className="text-lg font-black tracking-tight text-white">Before you rely on a result</h2>
            <p className="mt-2">
              AI suggestions are a starting point for your inspection. Check labels, vehicle details, and other evidence before choosing a replacement.
              A photo cannot confirm that a part fits or works, or reveal every hidden fault.
            </p>
          </div>
          <div className="rounded-[8px] border border-white/[0.10] bg-white/[0.055] p-5">
            <h2 className="text-lg font-black tracking-tight text-white">Preview limits</h2>
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {PREVIEW_LIMITS.map((check) => (
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
