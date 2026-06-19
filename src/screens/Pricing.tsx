import { useState } from "react";
import { Link } from "react-router-dom";
import { getAuthClient } from "../services/auth";
import { REVENUE_PLANS, type PlanId } from "../services/revenue";

type CheckoutResponse =
  | { url: string }
  | { error: { code: string; message: string } };

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
    <main className="min-h-dvh bg-[var(--ds-page)] px-4 pb-8 pt-[max(18px,env(safe-area-inset-top))] text-slate-950">
      <div className="mx-auto w-full max-w-5xl">
        <header className="flex items-center justify-between gap-3">
          <Link to="/scan" className="inline-flex items-center gap-2 text-sm font-bold text-[var(--ds-accent)]">
            Scan
          </Link>
          <Link to="/account" className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-900">
            Account
          </Link>
        </header>

        <section className="mt-8 max-w-3xl">
          <p className="text-sm font-extrabold uppercase tracking-[0.14em] text-[var(--ds-accent)]">DeepSpec paid beta</p>
          <h1 className="mt-3 text-4xl font-black tracking-tight sm:text-5xl">Charge for useful part identification, not fake certainty.</h1>
          <p className="mt-4 text-base leading-7 text-slate-600">
            DeepSpec ranks likely part names, preserves scan evidence, and adds measurement/reference workflows.
            Exact OEM fitment still requires VIN, readable labels, second angles, or verified sources.
          </p>
        </section>

        {checkoutStatus ? (
          <div className="mt-6 rounded-[16px] border border-blue-100 bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-900">
            {checkoutStatus}
          </div>
        ) : null}

        <section className="mt-6 grid gap-4 lg:grid-cols-4">
          {REVENUE_PLANS.map((plan) => (
            <article key={plan.id} className="flex min-h-[360px] flex-col rounded-[8px] border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-xs font-extrabold uppercase tracking-[0.14em] text-slate-400">{plan.audience}</p>
              <h2 className="mt-3 text-xl font-black tracking-tight">{plan.name}</h2>
              <p className="mt-2 text-3xl font-black">{plan.price}</p>
              <p className="text-sm font-bold text-slate-500">{plan.cadence}</p>
              <p className="mt-3 rounded-[8px] bg-slate-50 px-3 py-2 text-sm font-bold text-slate-700">
                {plan.scanAllowance} scans
              </p>
              <ul className="mt-4 flex-1 space-y-2 text-sm leading-6 text-slate-600">
                {plan.value.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
              <button
                className="mt-5 h-11 rounded-full bg-[var(--ds-accent)] px-4 text-sm font-bold text-white disabled:opacity-50"
                disabled={activePlanId !== null}
                onClick={() => void startCheckout(plan.id)}
                type="button"
              >
                {activePlanId === plan.id ? "Starting..." : "Start checkout"}
              </button>
            </article>
          ))}
        </section>

        <section className="mt-6 rounded-[8px] border border-slate-200 bg-white p-5 text-sm leading-6 text-slate-600">
          <h2 className="text-lg font-black tracking-tight text-slate-950">Paid beta rules</h2>
          <p className="mt-2">
            A paid scan should never be consumed when the AI provider fails, billing is not configured, or the result cannot be parsed.
            The app must show uncertainty, required next evidence, and measurement caveats before asking users to pay.
          </p>
        </section>
      </div>
    </main>
  );
}
