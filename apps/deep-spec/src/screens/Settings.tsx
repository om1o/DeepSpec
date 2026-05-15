import { Link } from "react-router-dom";
import { useState } from "react";
import type { ReactNode } from "react";

function Disclosure({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="rounded-xl border border-ds-border-light dark:border-ds-border">
      <summary className="cursor-pointer px-5 py-4 text-[15px] font-medium text-neutral-900 dark:text-ds-text">
        {title}
      </summary>
      <div className="border-t border-ds-border-light px-5 py-5 text-neutral-900 dark:border-ds-border dark:text-neutral-200">
        {children}
      </div>
    </details>
  );
}

export default function Settings() {
  const [darkMode, setDarkMode] = useState(() =>
    typeof document !== "undefined" ? document.documentElement.classList.contains("dark") : true,
  );

  const toggleDark = () => {
    document.documentElement.classList.toggle("dark");
    const isDark = document.documentElement.classList.contains("dark");
    setDarkMode(isDark);
    localStorage.setItem("deep-spec:dark", isDark ? "on" : "off");
  };

  return (
    <div className="flex min-h-screen flex-col px-4 pb-10 pt-4">
      <Link className="mb-10 text-[15px] font-medium text-ds-primary hover:underline" to="/">
        ← Home
      </Link>

      <h1 className="mb-10 text-xl font-semibold tracking-tight">Settings</h1>

      <div className="mb-10 flex flex-col gap-5">
        <div className="flex items-center justify-between gap-6">
          <div>
            <div className="font-medium text-neutral-900 dark:text-ds-text">Dark mode</div>
            <div className="text-[13px] text-ds-muted-light dark:text-ds-muted">Default stays on-brand</div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={darkMode}
            aria-label="Toggle dark mode"
            className={`relative h-11 w-[52px] rounded-full transition-colors ${darkMode ? "bg-ds-primary" : "bg-neutral-400"}`}
            onClick={toggleDark}
          >
            <span
              className={`absolute top-[5px] h-8 w-8 rounded-full bg-white shadow-md transition-[left] duration-200 ${darkMode ? "left-[calc(100%-32px)]" : "left-[6px]"}`}
            />
          </button>
        </div>

        <div>
          <h2 className="mb-3 text-[12px] font-semibold uppercase tracking-wider text-ds-muted-light dark:text-ds-muted">
            About Deep Spec
          </h2>
          <p className="text-[14px] leading-relaxed text-neutral-800 dark:text-neutral-300">
            Deep Spec turns a photo into plain-language guesses about what kind of part you&apos;re looking at. Built for
            vans, weekend wrenchers, and anyone who wants to walk into a shop with more context.
          </p>
        </div>

        <Disclosure title="Privacy (draft — not legal advice)">
          <pre className="whitespace-pre-wrap font-sans text-[14px] leading-relaxed text-neutral-800 dark:text-neutral-200">
            {`What we collect:\n- Compressed part photos you choose to analyze\n- Notes you type (car + problem context)\n- AI output, your ratings, and correction text\n\nCloud mode (Supabase): data is stored under an anonymous account bound to this browser until you clear site data. Row-level security keeps each user isolated; object storage is private with per-user prefixes.\n\nModeration: we may introduce human review for obvious abuse or legally sensitive content. Rows include a moderation_status field reserved for that workflow.\n\nWe do not sell personal data. Deletion: contact the operator (your parent/guardian until you have a formal business) until a self-serve delete portal ships.\n\nReplace this block with a lawyer-reviewed Privacy Policy before GA.`}
          </pre>
        </Disclosure>

        <Disclosure title="Terms & safety (draft — not legal advice)">
          <pre className="whitespace-pre-wrap font-sans text-[14px] leading-relaxed text-neutral-800 dark:text-neutral-200">
            {`Age: You must be 13+ or use the product with a supervising adult. This app is not COPPA-ready for under-13 standalone use.\n\nNo warranty: AI guesses can be wrong—do not rely on them for braking, steering, suspension, fuel systems, or airbags without a mechanic.\n\nPricing & fitment: Deep Spec does not provide OEM part numbers or live pricing.\n\nHave counsel review these terms before you onboard real customers.`}
          </pre>
        </Disclosure>

        <Disclosure title="Abuse & safety rails (product + engineering)">
          <pre className="whitespace-pre-wrap font-sans text-[14px] leading-relaxed text-neutral-800 dark:text-neutral-200">
            {`Already in the stack:\n- Server caps on /api/ai body size (configure AI_MAX_BODY_BYTES)\n- Structured JSON logs around HTTP + Gemini failures (hook up Sentry / Datadog / Supabase Log Drains)\n- Device-scoped anonymous Supabase sessions instead of sharing one global key client-side\n\nStill to wire for production scale:\n- Per-user quotas (Edge Function or Redis) for vision calls\n- Automated blocklists for policy-violating uploads\n- Parent/guardian-visible opt-in if you target younger audiences with supervision\n`}
          </pre>
        </Disclosure>
      </div>

      <p className="mt-auto pt-14 text-[12px] text-ds-muted-light dark:text-ds-muted">Deep Spec preview — v1</p>
    </div>
  );
}
