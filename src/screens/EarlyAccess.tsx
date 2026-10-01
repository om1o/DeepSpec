import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import CloudHealthCard from "../components/CloudHealthCard";
import Button from "../components/ui/Button";
import { getCloudSyncStatus, syncFeedbackToCloud, syncWaitlistSignupToCloud } from "../services/cloudSync";
import { getEngagementData, saveFeedbackSubmission, saveWaitlistSignup } from "../services/engagement";
import type { FeedbackSubmission, WaitlistSignup } from "../types";
import { FEEDBACK_ISSUES, getFeedbackIssue, type FeedbackIssue } from "../services/feedbackDetails";
import { getLookup } from "../services/storage";
import { getAccountScope, isAccountScopeCurrent } from "../lib/accountScope";

const TESTER_AUDIENCES = [
  {
    title: "DIY owners",
    body: "Name an unfamiliar visible part, understand its role, and know what evidence to capture next.",
  },
  {
    title: "Mechanics and trainees",
    body: "Use a second opinion for unusual parts, train newer staff, and keep a searchable scan record.",
  },
  {
    title: "Parts sellers and salvage teams",
    body: "Speed up intake, organize uncertain inventory, and preserve evidence for listings and handoffs.",
  },
  {
    title: "Shop advisors and marketplace sellers",
    body: "Turn a scan into a clearer customer explanation or a more useful listing note.",
  },
];

const TESTER_CHECKLIST = [
  "Scan 10 real vehicle parts.",
  "Mark every result right, wrong, or unresolved.",
  "Send at least 3 useful feedback notes.",
  "Save and reopen at least 3 scan results.",
];

export default function EarlyAccess() {
  const [mountedScope] = useState(getAccountScope);
  const [searchParams] = useSearchParams();
  const scanId = searchParams.get("scan");
  const reportScan = scanId ? getLookup(scanId) : null;
  const [feedbackIssue, setFeedbackIssue] = useState<FeedbackIssue | "">("");
  const [includeContext, setIncludeContext] = useState(false);
  const [sendingFeedback, setSendingFeedback] = useState(false);
  const feedbackPending = useRef(false);
  const reportForm = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (scanId) reportForm.current?.scrollIntoView?.({ block: "start" });
  }, [scanId]);
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
  const cloudStatusMessage = cloudSync.message;
  const demandSignals = useMemo(
    () => [
      { label: "Tester applications", value: String(stats.waitlist.length) },
      { label: "Feedback notes", value: String(stats.feedback.length) },
      { label: "Cloud sync", value: cloudSync.configured ? "On" : "Off" },
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

    if (!result.value) {
      setWaitlistStatus("Saved on this device. Cloud sync skipped this entry.");
      return;
    }

    if (!cloudSync.configured) {
      setWaitlistStatus("Saved on this device. Cloud sync is off for this build.");
      return;
    }

    setWaitlistStatus("Saved on this device. Syncing.");
    const syncResult = await syncWaitlistSignupToCloud(result.value);
    setWaitlistStatus(syncResult.ok ? "Saved on this device and synced to cloud." : `Saved on this device. ${syncResult.message}`);
  }

  async function handleFeedbackSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (feedbackPending.current || !isAccountScopeCurrent(mountedScope)) return;
    const result = saveFeedbackSubmission({
      issue: feedbackIssue || undefined,
      context: includeContext && reportScan ? { scanId: reportScan.id, predictedPart: reportScan.result?.partName ?? "" } : undefined,
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

    if (!result.value) {
      setFeedbackStatus("Feedback saved on this device. Cloud sync skipped it.");
      return;
    }

    if (!cloudSync.configured) {
      setFeedbackStatus("Feedback saved on this device. Cloud sync is off for this build.");
      return;
    }

    setFeedbackStatus("Feedback saved on this device. Syncing.");
    feedbackPending.current = true;
    setSendingFeedback(true);
    try {
      const syncResult = await syncFeedbackToCloud(result.value);
      if (isAccountScopeCurrent(mountedScope)) {
        setFeedbackStatus(`Feedback saved on this device. ${syncResult.message}`);
      }
    } catch {
      if (isAccountScopeCurrent(mountedScope)) setFeedbackStatus("Feedback saved on this device. Cloud delivery could not be confirmed.");
    } finally {
      feedbackPending.current = false;
      setSendingFeedback(false);
    }
  }

  return (
    <main className="min-h-dvh bg-[var(--ds-page)] px-4 pb-8 pt-[max(18px,env(safe-area-inset-top))] text-slate-950">
      <div className="mx-auto w-full max-w-2xl">
        <header className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <img src="/brand/deepspec-logo.webp" alt="Deep Spec" className="h-12 w-36 rounded-xl bg-white object-contain p-1 shadow-sm ring-1 ring-[var(--ds-accent-line)]" />
            <h1 className="mt-2 text-2xl font-extrabold tracking-tight text-white">Early access</h1>
          </div>
          <Link to="/scan" className="rounded-full bg-[var(--ds-accent)] px-4 py-2 text-sm font-bold text-white shadow-sm">
            Scan
          </Link>
          <Link to="/pricing" className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-900 shadow-sm">
            Pricing
          </Link>
        </header>

        <section className="mt-6 rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm font-bold text-[var(--ds-accent)]">Founding Tester Program</p>
          <h2 className="mt-2 text-2xl font-extrabold tracking-tight">Use it on real parts. Tell us where it fails.</h2>
          <p className="mt-3 text-sm leading-6 text-neutral-500">
            Deep Spec turns a part photo into a cautious identification, visible evidence, saved history, and
            follow-up answers. Testers help decide what is reliable enough to ship.
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
          <CloudHealthCard className="mt-4" />
        </section>

        <section className="mt-6 text-white" aria-labelledby="who-uses-deepspec">
          <p className="text-xs font-extrabold uppercase tracking-[0.14em] text-[var(--electric-300)]">Who it is for</p>
          <h2 id="who-uses-deepspec" className="mt-2 text-xl font-extrabold tracking-tight text-white">Different jobs, one visual record</h2>
          <div className="mt-4 divide-y divide-white/[0.14] border-y border-white/[0.14]">
            {TESTER_AUDIENCES.map((audience) => (
              <div key={audience.title} className="grid gap-1 py-4 sm:grid-cols-[180px_1fr] sm:gap-5">
                <h3 className="text-sm font-extrabold text-slate-100">{audience.title}</h3>
                <p className="text-sm leading-6 text-slate-300">{audience.body}</p>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs leading-5 text-slate-400">
            Deep Spec is an identification and documentation aid. It does not prove exact fitment, hidden condition, or repair safety.
          </p>
        </section>

        <section className="mt-6 border-y border-white/[0.14] bg-white/[0.06] px-4 py-5 text-white" aria-labelledby="tester-reward">
          <p className="text-xs font-extrabold uppercase tracking-[0.14em] text-[var(--electric-300)]">Tester reward</p>
          <h2 id="tester-reward" className="mt-2 text-xl font-extrabold tracking-tight text-white">Free beta access, then six months free</h2>
          <p className="mt-2 text-sm leading-6 text-slate-200">
            Founding testers who complete the checklist receive six months of Deep Spec access after paid launch.
            Approved seller and shop pilots can receive up to one year when the testing scope is agreed first.
          </p>
          <ul className="mt-4 grid gap-2 text-sm font-semibold text-slate-100 sm:grid-cols-2">
            {TESTER_CHECKLIST.map((item) => <li key={item}>{item}</li>)}
          </ul>
          <p className="mt-3 text-xs leading-5 text-slate-400">
            Rewards apply to the accepted tester account, have no cash value, and start only when paid access launches.
          </p>
        </section>

        <form id="join-testing" className="mt-6 rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm" onSubmit={handleWaitlistSubmit}>
          <h2 className="text-lg font-extrabold tracking-tight">Apply to test Deep Spec</h2>
          <p className="mt-2 text-sm leading-6 text-neutral-500">
            Tell us what kind of parts you can test. Applications save on this device first and sync to the private tester list when cloud is on.
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
              <option value="car_owner">DIY car owner</option>
              <option value="van_life">Van life owner</option>
              <option value="used_car_buyer">Used car buyer</option>
              <option value="weekend_wrencher">Weekend wrenching beginner</option>
              <option value="mechanic">Mechanic or technician</option>
              <option value="mechanic_student">Mechanic trainee or student</option>
              <option value="parts_seller">Parts seller</option>
              <option value="salvage_yard">Salvage yard team</option>
              <option value="marketplace_seller">Marketplace seller</option>
              <option value="shop_advisor">Shop advisor</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label className="mt-4 block">
            <span className="text-xs font-extrabold uppercase tracking-[0.14em] text-neutral-400">What will you test?</span>
            <textarea
              className="mt-2 min-h-24 w-full resize-none rounded-2xl border border-slate-200 bg-white p-3 text-sm leading-6 text-slate-950 outline-none placeholder:text-slate-400 focus:border-[var(--ds-accent)]"
              maxLength={240}
              onChange={(event) => setMainProblem(event.target.value)}
              placeholder="Example: alternators and starters during parts intake."
              value={mainProblem}
            />
          </label>
          {waitlistStatus ? <p className="mt-3 text-sm font-semibold text-[var(--ds-accent)]">{waitlistStatus}</p> : null}
          <Button className="mt-4 w-full" type="submit">
            Apply for tester access
          </Button>
        </form>

        <form ref={reportForm} id="feedback" className="mt-4 rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm" onSubmit={handleFeedbackSubmit}>
          <h2 className="text-lg font-extrabold tracking-tight">Send product feedback</h2>
          <p className="mt-2 text-sm leading-6 text-neutral-500">
            Tell us what worked, what failed, or what would make Deep Spec worth keeping. Saved on this device first, synced when cloud is on.
          </p>
          <label className="mt-4 block">
            <span className="text-sm font-bold">What went wrong?</span>
            <select
              className="mt-2 h-12 w-full rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-950"
              value={feedbackIssue}
              onChange={(event) => setFeedbackIssue(event.target.value as FeedbackIssue | "")}
            >
              <option value="">General feedback</option>
              {FEEDBACK_ISSUES.map((issue) => <option key={issue.id} value={issue.id}>{issue.label}</option>)}
            </select>
          </label>
          {reportScan ? (
            <label className="mt-4 flex items-start gap-3 text-sm leading-6">
              <input className="mt-1" type="checkbox" checked={includeContext} onChange={(event) => setIncludeContext(event.target.checked)} />
              <span>Include scan ID and prediction ({reportScan.result?.partName || "no prediction"}). No photo or chat is attached.</span>
            </label>
          ) : null}
          <p className="mt-2 text-xs leading-5 text-neutral-500">Choose a problem for a quick report. Details are optional when a problem is selected. Reporting does not give permission to train on your photos.</p>
          <label className="mt-4 block">
            <span className="text-xs font-extrabold uppercase tracking-[0.14em] text-neutral-400">Topic</span>
            <select
              className="mt-2 h-12 w-full rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-950 outline-none focus:border-[var(--ds-accent)]"
              onChange={(event) => setFeedbackCategory(event.target.value as FeedbackSubmission["category"])}
              value={getFeedbackIssue(feedbackIssue)?.category ?? feedbackCategory}
              disabled={Boolean(feedbackIssue)}
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
              maxLength={feedbackIssue || includeContext ? 450 : 800}
              onChange={(event) => setFeedbackMessage(event.target.value)}
              placeholder="What worked, what got in the way, what's worth paying for."
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
          {feedbackStatus ? <p role="status" className="mt-3 text-sm font-semibold text-[var(--ds-accent)]">{feedbackStatus}</p> : null}
          <Button className="mt-4 w-full" type="submit" disabled={sendingFeedback}>
            {sendingFeedback ? "Sending feedback…" : "Save feedback"}
          </Button>
        </form>
      </div>
    </main>
  );
}
