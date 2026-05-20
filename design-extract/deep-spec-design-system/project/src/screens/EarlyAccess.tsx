import { FormEvent, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Button from "../components/ui/Button";
import { getCloudSyncStatus, syncFeedbackToCloud, syncWaitlistSignupToCloud } from "../services/cloudSync";
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
  const demandSignals = useMemo(
    () => [
      { label: "Local waitlist entries", value: String(stats.waitlist.length) },
      { label: "Feedback notes", value: String(stats.feedback.length) },
      { label: "Cloud sync", value: cloudSync.configured ? "Ready" : "Off" },
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

    if (cloudSync.configured && result.value) {
      const cloudResult = await syncWaitlistSignupToCloud(result.value);
      setWaitlistStatus(`Saved on this device. ${cloudResult.message}`);
      return;
    }

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

    if (cloudSync.configured && result.value) {
      const cloudResult = await syncFeedbackToCloud(result.value);
      setFeedbackStatus(`Feedback saved locally. ${cloudResult.message}`);
      return;
    }

    setFeedbackStatus("Feedback saved locally.");
  }

  return (
    <main className="min-h-dvh bg-[#0A0A0A] px-4 pb-8 pt-[max(18px,env(safe-area-inset-top))] text-white">
      <div className="mx-auto w-full max-w-md">
        <header className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[13px] font-extrabold uppercase tracking-[0.18em] text-white/70">Deep Spec</p>
            <h1 className="mt-2 text-2xl font-extrabold tracking-tight">Early access</h1>
          </div>
          <Link to="/" className="rounded-full bg-white/10 px-4 py-2 text-sm font-bold text-white">
            Scan
          </Link>
        </header>

        <section className="mt-6 rounded-[24px] border border-white/10 bg-[#171717] p-5">
          <p className="text-sm font-bold text-[#FACC15]">Business experiment</p>
          <h2 className="mt-2 text-2xl font-extrabold tracking-tight">Prove people want this before charging.</h2>
          <p className="mt-3 text-sm leading-6 text-[#A1A1AA]">
            Deep Spec is testing demand with waitlist signups, feedback, saved scan reports, and mechanic escalation CTAs.
            Payments, accounts, domains, and legal docs need parent review later.
          </p>
          <p className="mt-3 rounded-2xl border border-white/10 bg-white/[0.04] p-3 text-sm leading-6 text-[#A1A1AA]">
            {cloudSync.message}
          </p>
          <div className="mt-4 grid grid-cols-1 gap-3">
            {demandSignals.map((item) => (
              <div key={item.label} className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
                <p className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-white/42">{item.label}</p>
                <p className="mt-1 text-lg font-extrabold text-white">{item.value}</p>
              </div>
            ))}
          </div>
        </section>

        <form className="mt-4 rounded-[24px] border border-white/10 bg-[#171717] p-5" onSubmit={handleWaitlistSubmit}>
          <h2 className="text-lg font-extrabold tracking-tight">Join the waitlist</h2>
          <p className="mt-2 text-sm leading-6 text-[#A1A1AA]">
            This saves locally right now. A real launch waitlist needs parent-approved privacy terms and backend storage.
          </p>
          <label className="mt-4 block">
            <span className="text-xs font-extrabold uppercase tracking-[0.14em] text-white/42">Email</span>
            <input
              className="mt-2 h-12 w-full rounded-2xl border border-white/10 bg-black/28 px-3 text-sm text-white outline-none placeholder:text-white/32 focus:border-[#FACC15]/50"
              inputMode="email"
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              type="email"
              value={email}
            />
          </label>
          <label className="mt-4 block">
            <span className="text-xs font-extrabold uppercase tracking-[0.14em] text-white/42">I am a</span>
            <select
              className="mt-2 h-12 w-full rounded-2xl border border-white/10 bg-black/28 px-3 text-sm text-white outline-none focus:border-[#FACC15]/50"
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
            <span className="text-xs font-extrabold uppercase tracking-[0.14em] text-white/42">What problem should Deep Spec solve?</span>
            <textarea
              className="mt-2 min-h-24 w-full resize-none rounded-2xl border border-white/10 bg-black/28 p-3 text-sm leading-6 text-white outline-none placeholder:text-white/32 focus:border-[#FACC15]/50"
              maxLength={240}
              onChange={(event) => setMainProblem(event.target.value)}
              placeholder="Example: I want to know if a used car leak is serious before buying."
              value={mainProblem}
            />
          </label>
          {waitlistStatus ? <p className="mt-3 text-sm font-semibold text-[#FACC15]">{waitlistStatus}</p> : null}
          <Button className="mt-4 w-full" type="submit">
            Save waitlist entry
          </Button>
        </form>

        <form className="mt-4 rounded-[24px] border border-white/10 bg-[#171717] p-5" onSubmit={handleFeedbackSubmit}>
          <h2 className="text-lg font-extrabold tracking-tight">Send product feedback</h2>
          <p className="mt-2 text-sm leading-6 text-[#A1A1AA]">
            Tell us what would make Deep Spec worth coming back to. This is local-only until backend sync exists.
          </p>
          <label className="mt-4 block">
            <span className="text-xs font-extrabold uppercase tracking-[0.14em] text-white/42">Topic</span>
            <select
              className="mt-2 h-12 w-full rounded-2xl border border-white/10 bg-black/28 px-3 text-sm text-white outline-none focus:border-[#FACC15]/50"
              onChange={(event) => setFeedbackCategory(event.target.value as FeedbackSubmission["category"])}
              value={feedbackCategory}
            >
              <option value="scanner">Scanner</option>
              <option value="ai_result">AI result</option>
              <option value="saved_scans">Saved scans</option>
              <option value="chat">Follow-up chat</option>
              <option value="business">Would pay for</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label className="mt-4 block">
            <span className="text-xs font-extrabold uppercase tracking-[0.14em] text-white/42">Feedback</span>
            <textarea
              className="mt-2 min-h-28 w-full resize-none rounded-2xl border border-white/10 bg-black/28 p-3 text-sm leading-6 text-white outline-none placeholder:text-white/32 focus:border-[#FACC15]/50"
              maxLength={800}
              onChange={(event) => setFeedbackMessage(event.target.value)}
              placeholder="What felt useful, confusing, unsafe, or worth paying for?"
              value={feedbackMessage}
            />
          </label>
          <label className="mt-4 block">
            <span className="text-xs font-extrabold uppercase tracking-[0.14em] text-white/42">Contact email optional</span>
            <input
              className="mt-2 h-12 w-full rounded-2xl border border-white/10 bg-black/28 px-3 text-sm text-white outline-none placeholder:text-white/32 focus:border-[#FACC15]/50"
              inputMode="email"
              onChange={(event) => setContactEmail(event.target.value)}
              placeholder="only if you want a follow-up"
              type="email"
              value={contactEmail}
            />
          </label>
          {feedbackStatus ? <p className="mt-3 text-sm font-semibold text-[#FACC15]">{feedbackStatus}</p> : null}
          <Button className="mt-4 w-full" type="submit">
            Save feedback
          </Button>
        </form>

        <Link className="mt-5 block rounded-full bg-white/10 px-5 py-3 text-center text-sm font-bold text-white" to="/history">
          View saved scans
        </Link>
      </div>
    </main>
  );
}
