import { FormEvent, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Button from "../components/ui/Button";
import { getCloudSyncStatus } from "../services/cloudSync";
import { getEngagementData, saveFeedbackSubmission, saveWaitlistSignup } from "../services/engagement";
import type { FeedbackSubmission, WaitlistSignup } from "../types";

export default function EarlyAccess() {
  const [stats, setStats] = useState(() => getEngagementData());
  const [email, setEmail] = useState("");
  const [userType, setUserType] = useState<WaitlistSignup["userType"]>("car_owner");
  const [mainProblem, setMainProblem] = useState("");
  const [feedbackCategory, setFeedbackCategory] = useState<FeedbackSubmission["category"]>("scanner");
  const [feedbackMessage, setFeedbackMessage] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [waitlistStatus, setWaitlistStatus] = useState<string | null>(null);
  const [feedbackStatus, setFeedbackStatus] = useState<string | null>(null);
  const cloudSync = getCloudSyncStatus();
  const cloudStatusMessage = cloudSync.configured
    ? "Cloud sync is configured, but production readiness still depends on the Supabase verifier passing."
    : cloudSync.message;
  const demandSignals = useMemo(
    () => [
      { label: "Local waitlist entries", value: String(stats.waitlist.length) },
      { label: "Feedback notes", value: String(stats.feedback.length) },
      { label: "Cloud sync", value: cloudSync.configured ? "Verify" : "Off" },
    ],
    [cloudSync.configured, stats],
  );

  async function handleWaitlistSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = saveWaitlistSignup({ email, mainProblem, userType });

    if (!result.ok) {
      setWaitlistStatus(result.message);
      return;
    }

    setEmail("");
    setMainProblem("");
    setStats(getEngagementData());

    setWaitlistStatus("Saved on this device. Backend sync comes after privacy review.");
  }

  async function handleFeedbackSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = saveFeedbackSubmission({
      category: feedbackCategory,
      contactEmail,
      message: feedbackMessage,
    });

    if (!result.ok) {
      setFeedbackStatus(result.message);
      return;
    }

    setFeedbackMessage("");
    setStats(getEngagementData());

    setFeedbackStatus("Feedback saved locally.");
  }

  return (
    <main className="min-h-dvh bg-[var(--ds-page)] px-4 pb-8 pt-[max(18px,env(safe-area-inset-top))] text-slate-950">
      <div className="mx-auto w-full max-w-md">
        <header className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <img src="/brand/deepspec-logo.png" alt="Deep Spec" className="h-12 w-36 rounded-xl bg-white object-contain p-1 shadow-sm ring-1 ring-[var(--ds-accent-line)]" />
            <h1 className="mt-2 text-2xl font-extrabold tracking-tight">Early access</h1>
          </div>
          <Link to="/scan" className="rounded-full bg-[var(--ds-accent)] px-4 py-2 text-sm font-bold text-white shadow-sm">
            Scan
          </Link>
        </header>

        <section className="mt-6 rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm font-bold text-[var(--ds-accent)]">Business experiment</p>
          <h2 className="mt-2 text-2xl font-extrabold tracking-tight">Prove people want this before charging.</h2>
          <p className="mt-3 text-sm leading-6 text-neutral-500">
            Deep Spec is testing demand with waitlist signups, feedback, instant AI answers, and mechanic escalation CTAs.
            Payments, accounts, domains, and legal docs need parent review later.
          </p>
          <p className="mt-3 rounded-2xl border border-neutral-100 bg-neutral-50 p-3 text-sm leading-6 text-neutral-500">
            {cloudStatusMessage}
          </p>
          <div className="mt-4 grid grid-cols-1 gap-3">
            {demandSignals.map((item) => (
              <div key={item.label} className="rounded-2xl border border-neutral-100 bg-neutral-50 p-3">
                <p className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-neutral-400">{item.label}</p>
                <p className="mt-1 text-lg font-extrabold text-neutral-900">{item.value}</p>
              </div>
            ))}
          </div>
        </section>

        <form className="mt-4 rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm" onSubmit={handleWaitlistSubmit}>
          <h2 className="text-lg font-extrabold tracking-tight">Join the waitlist</h2>
          <p className="mt-2 text-sm leading-6 text-neutral-500">
            This saves locally right now. A real launch waitlist needs parent-approved privacy terms and backend storage.
          </p>
          <label className="mt-4 block">
            <span className="text-xs font-extrabold uppercase tracking-[0.14em] text-neutral-400">Email</span>
            <input
              className="mt-2 h-12 w-full rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-950 outline-none placeholder:text-slate-400 focus:border-[var(--ds-accent)]"
              inputMode="email"
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              type="email"
              value={email}
            />
          </label>
          <label className="mt-4 block">
            <span className="text-xs font-extrabold uppercase tracking-[0.14em] text-neutral-400">I am a</span>
            <select
              className="mt-2 h-12 w-full rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-950 outline-none focus:border-[var(--ds-accent)]"
              onChange={(event) => setUserType(event.target.value as WaitlistSignup["userType"])}
              value={userType}
            >
              <option value="car_owner">Car owner</option>
              <option value="van_life">Van life owner</option>
              <option value="used_car_buyer">Used car buyer</option>
              <option value="weekend_wrencher">Weekend wrenching beginner</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label className="mt-4 block">
            <span className="text-xs font-extrabold uppercase tracking-[0.14em] text-neutral-400">What problem should Deep Spec solve?</span>
            <textarea
              className="mt-2 min-h-24 w-full resize-none rounded-2xl border border-slate-200 bg-white p-3 text-sm leading-6 text-slate-950 outline-none placeholder:text-slate-400 focus:border-[var(--ds-accent)]"
              maxLength={240}
              onChange={(event) => setMainProblem(event.target.value)}
              placeholder="Example: I want to know if a used car leak is serious before buying."
              value={mainProblem}
            />
          </label>
          {waitlistStatus ? <p className="mt-3 text-sm font-semibold text-[var(--ds-accent)]">{waitlistStatus}</p> : null}
          <Button className="mt-4 w-full" type="submit">
            Save waitlist entry
          </Button>
        </form>

        <form className="mt-4 rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm" onSubmit={handleFeedbackSubmit}>
          <h2 className="text-lg font-extrabold tracking-tight">Send product feedback</h2>
          <p className="mt-2 text-sm leading-6 text-neutral-500">
            Tell us what would make Deep Spec worth coming back to. This is local-only until backend sync exists.
          </p>
          <label className="mt-4 block">
            <span className="text-xs font-extrabold uppercase tracking-[0.14em] text-neutral-400">Topic</span>
            <select
              className="mt-2 h-12 w-full rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-950 outline-none focus:border-[var(--ds-accent)]"
              onChange={(event) => setFeedbackCategory(event.target.value as FeedbackSubmission["category"])}
              value={feedbackCategory}
            >
              <option value="scanner">Scanner</option>
              <option value="ai_result">AI result</option>
              <option value="chat">Follow-up chat</option>
              <option value="business">Would pay for</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label className="mt-4 block">
            <span className="text-xs font-extrabold uppercase tracking-[0.14em] text-neutral-400">Feedback</span>
            <textarea
              className="mt-2 min-h-28 w-full resize-none rounded-2xl border border-slate-200 bg-white p-3 text-sm leading-6 text-slate-950 outline-none placeholder:text-slate-400 focus:border-[var(--ds-accent)]"
              maxLength={800}
              onChange={(event) => setFeedbackMessage(event.target.value)}
              placeholder="What felt useful, confusing, unsafe, or worth paying for?"
              value={feedbackMessage}
            />
          </label>
          <label className="mt-4 block">
            <span className="text-xs font-extrabold uppercase tracking-[0.14em] text-neutral-400">Contact email optional</span>
            <input
              className="mt-2 h-12 w-full rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-950 outline-none placeholder:text-slate-400 focus:border-[var(--ds-accent)]"
              inputMode="email"
              onChange={(event) => setContactEmail(event.target.value)}
              placeholder="only if you want a follow-up"
              type="email"
              value={contactEmail}
            />
          </label>
          {feedbackStatus ? <p className="mt-3 text-sm font-semibold text-[var(--ds-accent)]">{feedbackStatus}</p> : null}
          <Button className="mt-4 w-full" type="submit">
            Save feedback
          </Button>
        </form>
      </div>
    </main>
  );
}
