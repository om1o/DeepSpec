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
            Deep Spec helps nervous drivers decode what&apos;s under the hood — straight answers without shop talk theater.
          </p>
        </div>

        <Disclosure title="Privacy Policy">
          <pre className="whitespace-pre-wrap font-sans text-[14px] leading-relaxed text-neutral-800 dark:text-neutral-200">
            {`Photos may be reviewed to improve Deep Spec. We never sell your data.\nYou can request deletion anytime.\n\n(This is informal summary wording — replace with lawyer-reviewed policy when you publish.)`}
          </pre>
        </Disclosure>

        <Disclosure title="Terms of Service">
          <pre className="whitespace-pre-wrap font-sans text-[14px] leading-relaxed text-neutral-800 dark:text-neutral-200">
            {`Deep Spec uses AI guesses from photos—they can be wrong. You must be 13+ to use Deep Spec.\nFor safety-critical systems, rely on professional inspection.\n`}
          </pre>
        </Disclosure>
      </div>

      <p className="mt-auto pt-14 text-[12px] text-ds-muted-light dark:text-ds-muted">Deep Spec preview — v1</p>
    </div>
  );
}
