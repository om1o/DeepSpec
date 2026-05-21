import { useMemo } from "react";
import { Link } from "react-router-dom";
import Button from "../components/ui/Button";
import { getLookups } from "../services/storage";
import type { Lookup } from "../types";

export default function History() {
  const lookups = useMemo(() => getLookups(), []);

  return (
    <main className="min-h-dvh bg-[var(--ds-page)] px-4 pb-8 pt-[max(18px,env(safe-area-inset-top))] text-slate-950">
      <div className="mx-auto w-full max-w-md">
        <header className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <img src="/brand/deepspec-logo.png" alt="Deep Spec" className="h-12 w-36 rounded-xl bg-white object-contain p-1 shadow-sm ring-1 ring-[var(--ds-accent-line)]" />
            <h1 className="mt-2 text-2xl font-extrabold tracking-tight">Saved scans</h1>
          </div>
          <div className="flex items-center gap-2">
            <Link to="/early-access" className="rounded-full bg-white px-4 py-2 text-sm font-bold text-slate-700 shadow-sm ring-1 ring-slate-200">
              Join
            </Link>
            <Link to="/" className="rounded-full bg-[var(--ds-accent)] px-4 py-2 text-sm font-bold text-white shadow-sm">
              Scan
            </Link>
          </div>
        </header>

        {lookups.length > 0 ? (
          <div className="mt-6 space-y-3">
            {lookups.map((lookup) => (
              <LookupCard key={lookup.id} lookup={lookup} />
            ))}
          </div>
        ) : (
          <section className="mt-8 rounded-[24px] border border-dashed border-slate-200 bg-white p-6 text-center shadow-sm">
            <p className="text-sm font-bold text-[var(--ds-accent)]">No saved scans yet</p>
            <h2 className="mt-2 text-xl font-extrabold tracking-tight">Scan your first part</h2>
            <p className="mt-3 text-sm leading-6 text-neutral-500">
              Deep Spec will save the photo, AI result, rating, correction, and notes on this device.
            </p>
            <Button className="mt-5 w-full" onClick={() => window.location.assign("/")}>
              Open scanner
            </Button>
          </section>
        )}
      </div>
    </main>
  );
}

function LookupCard({ lookup }: { lookup: Lookup }) {
  const title = lookup.result?.partName ?? (lookup.errorMessage ? "AI lookup failed" : "Captured frame");
  const createdAt = new Date(lookup.createdAt).toLocaleString();
  const status = getStatusLabel(lookup);

  return (
    <Link
      to={`/result/${lookup.id}`}
      className="grid grid-cols-[88px_1fr] gap-3 rounded-[24px] border border-slate-200 bg-white p-3 text-slate-950 shadow-sm transition hover:border-blue-200"
    >
      <img
        alt=""
        className="aspect-square w-full rounded-[18px] border border-neutral-200 bg-neutral-100 object-cover"
        src={lookup.frame.imageBase64}
      />
      <div className="min-w-0 py-1">
        <div className="flex items-start justify-between gap-2">
          <h2 className="truncate text-base font-extrabold tracking-tight">{title}</h2>
          {lookup.rating ? <span className="shrink-0 text-xs font-bold text-neutral-400">{lookup.rating === "up" ? "Helpful" : "Wrong"}</span> : null}
        </div>
        <p className="mt-1 truncate text-xs font-semibold text-neutral-400">{createdAt}</p>
        <p className="mt-3 text-sm font-semibold text-neutral-500">{status}</p>
        <p className="mt-1 text-xs font-semibold uppercase tracking-[0.12em] text-neutral-400">{lookup.scanCategory}</p>
      </div>
    </Link>
  );
}

function getStatusLabel(lookup: Lookup) {
  if (lookup.errorMessage) {
    return "AI error saved";
  }

  if (!lookup.result) {
    return "Not analyzed";
  }

  if (lookup.result.safetyTriage === "needs_professional" || lookup.result.isSafetyCritical) {
    return "Professional verification needed";
  }

  if (lookup.result.needsBetterPhoto || lookup.result.safetyTriage === "needs_better_photo") {
    return "Better photo needed";
  }

  return `${lookup.result.confidence} confidence`;
}
