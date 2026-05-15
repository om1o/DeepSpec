import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Button, Card } from "../components/ui";
import { CorrectionField } from "./CorrectionField";
import { cn } from "../lib/utils";
import { deleteLookup, getLookup, updateLookup } from "../services/storage";
import type { Lookup } from "../types";

function confidenceStyle(c: Lookup["result"]["confidence"]) {
  if (c === "high") return "bg-emerald-500/18 text-emerald-700 dark:text-emerald-300";
  if (c === "medium") return "bg-amber-500/18 text-amber-900 dark:text-amber-400";
  return "bg-orange-600/22 text-orange-900 dark:text-orange-300";
}

export default function Result() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [reload, setReload] = useState(0);
  const bump = () => setReload((x) => x + 1);

  const lookup = useMemo(
    () => (id ? getLookup(id) : undefined),
    // reload intentionally busts stale reads after localStorage writes
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [id, reload],
  );

  const stateNote = useMemo(() => {
    if (!lookup) return null;
    if (lookup.result.needsBetterPhoto) {
      return "The photo looks hard to analyze. A clearer angle and more light will help.";
    }
    return null;
  }, [lookup]);

  if (!lookup) {
    return (
      <div className="px-4 py-14 text-center">
        <p className="mb-6 text-neutral-900 dark:text-ds-text">That lookup wasn&apos;t found.</p>
        <Link className="text-ds-primary" to="/">
          Home
        </Link>
      </div>
    );
  }

  const onRate = (rating: NonNullable<Lookup["rating"]>) => {
    updateLookup(lookup.id, { rating });
    bump();
  };


  return (
    <div className="flex min-h-screen flex-col pb-36">
      <header className="flex items-start justify-between gap-3 px-4 pt-4">
        <Button variant="ghost" className="-ml-2 px-2" type="button" onClick={() => navigate(-1)}>
          Back
        </Button>
        <div className="flex gap-2">
          <button
            type="button"
            className="text-[14px] text-ds-primary hover:underline"
            onClick={() => navigate(`/result/${lookup.id}/chat`)}
          >
            Tell me more
          </button>
          <details className="relative text-[14px]">
            <summary className="cursor-pointer select-none rounded-lg px-2 py-1 text-ds-muted-light hover:bg-neutral-100 dark:text-ds-muted dark:hover:bg-neutral-800">
              ⋮
            </summary>
            <div className="absolute right-0 z-10 mt-1 min-w-[160px] overflow-hidden rounded-lg border border-ds-border-light bg-white py-1 shadow-lg dark:border-ds-border dark:bg-ds-card">
              <button
                type="button"
                className="flex w-full px-4 py-2 text-left text-[14px] hover:bg-neutral-100 dark:hover:bg-neutral-900"
                onClick={() => {
                  deleteLookup(lookup.id);
                  navigate("/", { replace: true });
                }}
              >
                Delete
              </button>
              <button
                type="button"
                className="flex w-full px-4 py-2 text-left text-[14px] hover:bg-neutral-100 dark:hover:bg-neutral-900"
                onClick={() => {
                  navigator.clipboard.writeText(`${lookup.result.partName} — Deep Spec`).catch(() => {});
                }}
              >
                Share text
              </button>
              <button
                type="button"
                className="flex w-full px-4 py-2 text-left text-[14px] text-neutral-600 hover:bg-neutral-100 dark:text-ds-muted dark:hover:bg-neutral-900"
              >
                Report issue
              </button>
            </div>
          </details>
        </div>
      </header>

      <div className="px-4 pb-6">
        <button type="button" className="w-full overflow-hidden rounded-xl bg-black/5 dark:bg-neutral-900">
          <img src={lookup.imageBase64} alt="" className="mx-auto block max-h-[38vh] w-full object-contain" />
        </button>
      </div>

      <div className="px-4 pb-4">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold tracking-tight text-neutral-900 dark:text-ds-text">
            {lookup.result.partName}
          </h1>
          <span
            className={cn(
              "rounded-full px-2 py-1 text-[12px] font-semibold capitalize",
              confidenceStyle(lookup.result.confidence),
            )}
          >
            {lookup.result.confidence}
          </span>
        </div>

        {stateNote ? (
          <Card className="mb-4 border border-amber-900/35 bg-amber-500/10 text-[14px] text-amber-950 dark:text-amber-200">
            {stateNote}
          </Card>
        ) : null}

        {lookup.result.isSafetyCritical ? (
          <Card className="mb-4 border border-amber-700/55 bg-[#78350f]/15 text-[14px] text-amber-100">
            ⚠️ Safety-critical part. Verify with a mechanic before relying on any guess from a photo alone.
          </Card>
        ) : null}

        <Card className="mb-4">
          <h2 className="mb-3 text-[12px] font-semibold uppercase tracking-wider text-ds-muted-light dark:text-ds-muted">
            What it does
          </h2>
          <p className="text-[15px] leading-relaxed text-neutral-800 dark:text-neutral-100">
            {lookup.result.whatItDoes}
          </p>
        </Card>

        <Card className="mb-4">
          <h2 className="mb-3 text-[12px] font-semibold uppercase tracking-wider text-ds-muted-light dark:text-ds-muted">
            What I see
          </h2>
          <ul className="list-disc space-y-2 pl-5 text-[14px] text-neutral-800 dark:text-neutral-100">
            {lookup.result.conditionObservations.length === 0 ? (
              <li className="list-none text-ds-muted-light dark:text-ds-muted">No details listed.</li>
            ) : (
              lookup.result.conditionObservations.map((t) => <li key={t}>{t}</li>)
            )}
          </ul>
        </Card>

        <Card className="mb-4">
          <h2 className="mb-3 text-[12px] font-semibold uppercase tracking-wider text-ds-muted-light dark:text-ds-muted">
            Concerns
          </h2>
          <ul className="list-disc space-y-2 pl-5 text-[14px] text-neutral-800 dark:text-neutral-100">
            {lookup.result.concerns.length === 0 ? (
              <li className="text-ds-muted-light dark:list-none dark:text-ds-muted">
                Nothing concerning visible from what we can see.
              </li>
            ) : (
              lookup.result.concerns.map((t) => <li key={t}>{t}</li>)
            )}
          </ul>
        </Card>

        <Card className="mb-4">
          <h2 className="mb-3 text-[12px] font-semibold uppercase tracking-wider text-ds-muted-light dark:text-ds-muted">
            What to do next
          </h2>
          <p className="text-[15px] leading-relaxed text-neutral-800 dark:text-neutral-100">
            {lookup.result.nextSteps}
          </p>
          {lookup.result.followUpQuestions.length > 0 ? (
            <ul className="mt-3 space-y-1 text-[13px] text-ds-muted-light dark:text-ds-muted">
              {lookup.result.followUpQuestions.map((q) => (
                <li key={q}>• {q}</li>
              ))}
            </ul>
          ) : null}
        </Card>

        {lookup.rating === "down" || lookup.correction ? (
          <CorrectionField
            key={`${lookup.id}-${lookup.rating}`}
            lookupId={lookup.id}
            initial={lookup.correction}
            onCommitted={bump}
          />
        ) : null}
      </div>

      <footer className="fixed bottom-0 left-0 right-0 border-t border-ds-border-light bg-white/90 px-4 py-3 backdrop-blur dark:border-ds-border dark:bg-neutral-950/90">
        <div className="mx-auto mb-3 flex items-center gap-6">
          <span className="text-[13px] text-ds-muted-light dark:text-ds-muted">Helpful?</span>
          <div className="flex gap-4">
            <button
              type="button"
              className={cn(
                "min-h-[44px] rounded-full px-5 text-xl leading-none opacity-85 transition-colors",
                lookup.rating === "up" ? "bg-emerald-500/25" : "hover:bg-neutral-200 dark:hover:bg-neutral-900",
              )}
              aria-label="Thumbs up"
              onClick={() => onRate("up")}
            >
              👍
            </button>
            <button
              type="button"
              className={cn(
                "min-h-[44px] rounded-full px-5 text-xl leading-none opacity-85 transition-colors",
                lookup.rating === "down" ? "bg-orange-600/35" : "hover:bg-neutral-200 dark:hover:bg-neutral-900",
              )}
              aria-label="Thumbs down"
              onClick={() => onRate("down")}
            >
              👎
            </button>
          </div>
        </div>
        <div className="mx-auto grid grid-cols-2 gap-2">
          <Button variant="ghost" type="button" onClick={() => navigate(`/result/${lookup.id}/chat`)}>
            Questions
          </Button>
          <Button variant="primary" type="button" onClick={() => navigate("/capture", { replace: true })}>
            New photo
          </Button>
        </div>
      </footer>
    </div>
  );
}
