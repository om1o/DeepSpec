import { FormEvent, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import Button from "../components/ui/Button";
import { getAccountScope, isAccountScopeCurrent } from "../lib/accountScope";
import { getCloudSyncStatus, syncFeedbackToCloud, syncWaitlistSignupToCloud } from "../services/cloudSync";
import { saveFeedbackSubmission, saveWaitlistSignup } from "../services/engagement";
import { FEEDBACK_ISSUES, getFeedbackIssue, type FeedbackIssue } from "../services/feedbackDetails";
import { getLookup } from "../services/storage";
import type { FeedbackSubmission, WaitlistSignup } from "../types";

const TESTER_AUDIENCES = [
  {
    title: "DIY owners",
    body: "Understand an unfamiliar visible part and learn what evidence to photograph next.",
  },
  {
    title: "Mechanics and trainees",
    body: "Use a second opinion for unusual parts and keep a scan that can support teaching or review.",
  },
  {
    title: "Parts sellers and salvage teams",
    body: "Document uncertain inventory and keep the evidence behind an intake or listing decision.",
  },
  {
    title: "Shop advisors and marketplace sellers",
    body: "Turn a scan into a clearer customer explanation or a more useful listing note.",
  },
];

const TESTER_STEPS = [
  { number: "01", title: "Scan 10 real parts", body: "Use ordinary shop, driveway, or inventory photos." },
  { number: "02", title: "Judge every result", body: "Mark it right, wrong, or unresolved." },
  { number: "03", title: "Send 3 useful notes", body: "Tell us what helped, failed, or caused doubt." },
  { number: "04", title: "Reopen 3 records", body: "Confirm the photo, result, and feedback stayed together." },
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
  const [email, setEmail] = useState("");
  const [userType, setUserType] = useState<WaitlistSignup["userType"]>("car_owner");
  const [mainProblem, setMainProblem] = useState("");
  const [feedbackCategory, setFeedbackCategory] = useState<FeedbackSubmission["category"]>("scanner");
  const [feedbackMessage, setFeedbackMessage] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [waitlistStatus, setWaitlistStatus] = useState<string | null>(null);
  const [feedbackStatus, setFeedbackStatus] = useState<string | null>(null);
  const cloudSync = getCloudSyncStatus();

  useEffect(() => {
    const previousTitle = document.title;
    const description = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    const previousDescription = description?.content;
    document.title = "DeepSpec Private V1 Test";
    description?.setAttribute(
      "content",
      "Test DeepSpec on real vehicle parts, report wrong or uncertain results, and help shape the first public version.",
    );

    return () => {
      document.title = previousTitle;
      if (description && previousDescription) description.content = previousDescription;
    };
  }, []);

  useEffect(() => {
    if (!scanId) return;
    window.requestAnimationFrame(() => reportForm.current?.scrollIntoView?.({ block: "start" }));
  }, [scanId]);

  async function handleWaitlistSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = saveWaitlistSignup({ email, mainProblem, userType });

    if (!result.ok) {
      setWaitlistStatus(result.message);
      return;
    }

    setEmail("");
    setMainProblem("");

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
    setWaitlistStatus(syncResult.ok ? "Application received." : `Saved on this device. ${syncResult.message}`);
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
      if (isAccountScopeCurrent(mountedScope)) {
        setFeedbackStatus("Feedback saved on this device. Cloud delivery could not be confirmed.");
      }
    } finally {
      feedbackPending.current = false;
      setSendingFeedback(false);
    }
  }

  return (
    <main className="min-h-dvh bg-[var(--ds-page)] text-white">
      <section className="relative min-h-[min(74dvh,650px)] overflow-hidden border-b border-white/10">
        <img
          src="/brand/alternator-workbench.webp"
          alt="Alternator on a workbench"
          className="absolute inset-0 h-full w-full object-cover object-center"
          width="1086"
          height="1448"
        />
        <div className="absolute inset-0 bg-[#06101bd9]" />

        <div className="relative mx-auto flex min-h-[min(74dvh,650px)] w-full max-w-6xl flex-col px-5 pb-10 pt-[max(18px,env(safe-area-inset-top))] sm:px-8">
          <header className="flex items-center justify-between gap-3">
            <img
              src="/brand/deepspec-logo.webp"
              alt="DeepSpec"
              className="h-11 w-36 rounded-[8px] bg-white object-contain p-1 shadow-sm"
            />
            <nav className="flex items-center gap-2" aria-label="V1 test navigation">
              <Link to="/auth" className="rounded-[8px] border border-white/25 px-3 py-2 text-sm font-bold text-white">
                Sign in
              </Link>
              <Link to="/scan" className="rounded-[8px] bg-[#a8d2dc] px-3 py-2 text-sm font-black text-[#071520]">
                Try scanner
              </Link>
            </nav>
          </header>

          <div className="my-auto max-w-3xl py-12">
            <p className="text-sm font-black text-[#a8d2dc]">DEEPSPEC BETA</p>
            <h1 className="mt-4 max-w-2xl text-4xl font-black leading-[1.04] text-white sm:text-5xl lg:text-6xl">
              Private V1 Test
            </h1>
            <p className="mt-5 max-w-2xl text-base font-semibold leading-7 text-slate-200 sm:text-lg">
              Scan real vehicle parts. Tell us where DeepSpec is wrong, confusing, or uncertain. Help decide what is ready before public promotion begins.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <a href="#feedback" className="rounded-[8px] bg-white px-5 py-3 text-sm font-black text-[#071520] shadow-lg">
                Report a test
              </a>
              <a href="#test-plan" className="rounded-[8px] border border-white/30 px-5 py-3 text-sm font-black text-white">
                See the test plan
              </a>
            </div>
          </div>

          <div className="grid gap-4 border-t border-white/20 pt-5 text-sm sm:grid-cols-2">
            <p><strong className="block text-white">Invite-only V1</strong><span className="text-slate-300">Family and trusted reviewers test first.</span></p>
            <p><strong className="block text-white">No paid tester program</strong><span className="text-slate-300">The goal is honest evidence, not a reward campaign.</span></p>
          </div>
          <p className="mt-4 text-xs text-slate-400">Illustrative part image. Not a scan result.</p>
        </div>
      </section>

      <section id="test-plan" className="bg-[#f4f6f7] py-14 text-slate-950">
        <div className="mx-auto w-full max-w-5xl px-5 sm:px-8">
          <div className="max-w-3xl">
            <p className="text-sm font-black text-[#416b78]">THE V1 TEST</p>
            <h2 className="mt-3 text-3xl font-black leading-tight">A useful result needs more than a part name</h2>
            <p className="mt-4 text-base leading-7 text-slate-600">
              DeepSpec should help someone inspect the visible evidence, ask a better follow-up, and keep a record they can reopen. It should also make uncertainty obvious.
            </p>
          </div>

          <div className="mt-10 grid border-y border-slate-300 md:grid-cols-2">
            {TESTER_STEPS.map((step, index) => (
              <div
                key={step.number}
                className={`grid grid-cols-[48px_1fr] gap-4 py-6 ${index % 2 === 0 ? "md:border-r md:border-slate-300 md:pr-8" : "md:pl-8"} ${index < 2 ? "border-b border-slate-300" : ""}`}
              >
                <span className="text-sm font-black text-[#416b78]">{step.number}</span>
                <div>
                  <h3 className="text-base font-black">{step.title}</h3>
                  <p className="mt-1 text-sm leading-6 text-slate-600">{step.body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-[#dce9ed] py-14 text-[#071520]">
        <div className="mx-auto grid w-full max-w-5xl gap-10 px-5 sm:px-8 lg:grid-cols-[0.82fr_1.18fr]">
          <div>
            <p className="text-sm font-black text-[#416b78]">WHO IT HELPS</p>
            <h2 className="mt-3 text-3xl font-black leading-tight">One visual record, several real jobs</h2>
            <p className="mt-4 text-sm leading-6 text-[#37505a]">
              An experienced engineer may already know the part. DeepSpec can still help document the evidence, explain it to someone else, or train a newer teammate.
            </p>
          </div>
          <div className="divide-y divide-[#9bb3bb] border-y border-[#9bb3bb]">
            {TESTER_AUDIENCES.map((audience) => (
              <div key={audience.title} className="grid gap-1 py-4 sm:grid-cols-[190px_1fr] sm:gap-6">
                <h3 className="text-sm font-black">{audience.title}</h3>
                <p className="text-sm leading-6 text-[#37505a]">{audience.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="updates" className="bg-white py-14 text-slate-950">
        <div className="mx-auto grid w-full max-w-5xl gap-10 px-5 sm:px-8 lg:grid-cols-[0.8fr_1.2fr]">
          <div>
            <p className="text-sm font-black text-[#416b78]">LAUNCH UPDATES</p>
            <h2 className="mt-3 text-3xl font-black leading-tight">Test privately, promote after the evidence</h2>
            <p className="mt-4 text-sm leading-6 text-slate-600">
              V1 testing starts with family and trusted reviewers. DeepSpec is not promising cash, free years, or special pricing for testing. Public promotion starts after the core flow works on real phones and real parts.
            </p>
            <p className="mt-6 border-l-4 border-[#b56b32] pl-4 text-sm leading-6 text-slate-600">
              DeepSpec is an identification and documentation aid. A photo cannot prove exact fitment, hidden condition, or repair safety.
            </p>
          </div>

          <form className="rounded-[8px] border border-slate-200 bg-[#f8fafb] p-5 shadow-sm sm:p-7" onSubmit={handleWaitlistSubmit}>
            <h2 className="text-xl font-black">Get DeepSpec launch updates</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">Tell us what kind of parts or workflow you want DeepSpec to support.</p>
            <label className="mt-5 block">
              <span className="text-sm font-bold">Email</span>
              <input
                className="mt-2 h-12 w-full rounded-[8px] border border-slate-300 bg-white px-3 text-sm text-slate-950 outline-none placeholder:text-slate-400 focus:border-[#416b78]"
                inputMode="email"
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                required
                type="email"
                value={email}
              />
            </label>
            <label className="mt-4 block">
              <span className="text-sm font-bold">Your role</span>
              <select
                className="mt-2 h-12 w-full rounded-[8px] border border-slate-300 bg-white px-3 text-sm text-slate-950 outline-none focus:border-[#416b78]"
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
              <span className="text-sm font-bold">What would you use DeepSpec for?</span>
              <textarea
                className="mt-2 min-h-24 w-full resize-none rounded-[8px] border border-slate-300 bg-white p-3 text-sm leading-6 text-slate-950 outline-none placeholder:text-slate-400 focus:border-[#416b78]"
                maxLength={240}
                onChange={(event) => setMainProblem(event.target.value)}
                placeholder="Example: identifying alternators and starters during parts intake."
                required
                value={mainProblem}
              />
            </label>
            {waitlistStatus ? <p role="status" className="mt-3 text-sm font-bold text-[#416b78]">{waitlistStatus}</p> : null}
            <Button className="mt-5 w-full" type="submit">Join launch updates</Button>
          </form>
        </div>
      </section>

      <section id="feedback" className="bg-[#f4f6f7] py-14 text-slate-950">
        <div className="mx-auto grid w-full max-w-5xl gap-10 px-5 sm:px-8 lg:grid-cols-[0.75fr_1.25fr]">
          <div>
            <p className="text-sm font-black text-[#416b78]">FAST TEST REPORT</p>
            <h2 className="mt-3 text-3xl font-black leading-tight">
              {reportScan ? "Report this scan" : "Tell us what broke or caused doubt"}
            </h2>
            <p className="mt-4 text-sm leading-6 text-slate-600">
              Pick the closest problem. Notes are optional for a specific issue, so a report can take less than a minute.
            </p>
          </div>
          <form ref={reportForm} className="rounded-[8px] border border-slate-200 bg-white p-5 shadow-sm sm:p-7" onSubmit={handleFeedbackSubmit}>
              <p className="text-sm leading-6 text-slate-600">
                Tell us what worked, what failed, or what would make DeepSpec worth keeping. Feedback saves on this device first and syncs when cloud delivery is available.
              </p>
              <label className="mt-5 block">
                <span className="text-sm font-bold">What went wrong?</span>
                <select
                  className="mt-2 h-12 w-full rounded-[8px] border border-slate-300 bg-white px-3 text-sm text-slate-950"
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
              <p className="mt-2 text-xs leading-5 text-slate-500">
                Details are optional when a specific problem is selected. Reporting does not give permission to train on your photos.
              </p>
              <label className="mt-4 block">
                <span className="text-sm font-bold">Topic</span>
                <select
                  className="mt-2 h-12 w-full rounded-[8px] border border-slate-300 bg-white px-3 text-sm text-slate-950"
                  onChange={(event) => setFeedbackCategory(event.target.value as FeedbackSubmission["category"])}
                  value={getFeedbackIssue(feedbackIssue)?.category ?? feedbackCategory}
                  disabled={Boolean(feedbackIssue)}
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
                <span className="text-sm font-bold">Feedback</span>
                <textarea
                  className="mt-2 min-h-28 w-full resize-none rounded-[8px] border border-slate-300 bg-white p-3 text-sm leading-6 text-slate-950 outline-none placeholder:text-slate-400 focus:border-[#416b78]"
                  maxLength={feedbackIssue || includeContext ? 450 : 800}
                  onChange={(event) => setFeedbackMessage(event.target.value)}
                  placeholder="What worked, what got in the way, or what would make this useful?"
                  value={feedbackMessage}
                />
              </label>
              <label className="mt-4 block">
                <span className="text-sm font-bold">Contact email, optional</span>
                <input
                  className="mt-2 h-12 w-full rounded-[8px] border border-slate-300 bg-white px-3 text-sm text-slate-950 outline-none placeholder:text-slate-400 focus:border-[#416b78]"
                  inputMode="email"
                  onChange={(event) => setContactEmail(event.target.value)}
                  placeholder="Only if you want a reply"
                  type="email"
                  value={contactEmail}
                />
              </label>
              {feedbackStatus ? <p role="status" className="mt-3 text-sm font-bold text-[#416b78]">{feedbackStatus}</p> : null}
              <Button className="mt-5" type="submit" disabled={sendingFeedback}>
                {sendingFeedback ? "Sending feedback..." : "Save feedback"}
              </Button>
          </form>
        </div>
      </section>

      <footer className="border-t border-white/10 px-5 py-8 text-center text-xs leading-5 text-slate-400">
        DeepSpec suggestions can be wrong. Check the visible evidence and use qualified help for safety-critical work.
      </footer>
    </main>
  );
}
