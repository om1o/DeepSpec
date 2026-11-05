import type { Lookup } from "../../types";
import { buildConditionHandoff } from "../../lib/conditionHandoff";

export function ConditionEvidenceReview({ lookup, onSelectPhoto }: { lookup: Lookup; onSelectPhoto: (id: string) => void }) {
  const review = buildConditionHandoff(lookup);
  if (!review.assessment) return null;
  return <section aria-label="Condition evidence" className="rounded-2xl border border-[var(--ds-border)] bg-[var(--ds-elevated)] p-4 text-sm text-[var(--ds-fg-2)]">
    <h2 className="font-bold">Condition evidence</h2>
    <p className="mt-1 text-xs text-[var(--ds-fg-3)]">AI-reported appearance. Review the original photos; record your inspection separately below.</p>
    <h3 className="mt-4 font-semibold">Observed appearance</h3>
    {review.observations.length ? <ul className="mt-2 space-y-3">{review.observations.map((item) => <li key={item.id}>
      <p><span className="font-semibold">{item.id}.</span> {item.text}</p>
      {item.regionLabel ? <p className="text-xs text-[var(--ds-fg-3)]">Area described: {item.regionLabel}</p> : null}
      <div className="mt-1 flex flex-wrap gap-2">{item.photoIds.map((id) => <button key={id} type="button" className="min-h-10 rounded-lg border border-[var(--ds-border)] px-3 text-xs underline" onClick={() => onSelectPhoto(id)} aria-label={`View ${review.photos.find((photo) => photo.id === id)!.label} for observation ${item.id}`}>
        {review.photos.find((photo) => photo.id === id)!.label}
      </button>)}</div>
    </li>)}</ul> : <p className="mt-1">No photo-linked observations returned.</p>}
    <h3 className="mt-4 font-semibold">Possible causes — unconfirmed</h3>
    {review.possibleCauses.length ? <ul className="mt-2 list-disc space-y-2 pl-5">{review.possibleCauses.map((item, index) => <li key={index}>{item.text}<p className="text-xs text-[var(--ds-fg-3)]">Based on observations {item.observationIds.join(", ")}</p></li>)}</ul> : <p className="mt-1">Cause not established.</p>}
    <h3 className="mt-4 font-semibold">Still unknown</h3>
    {review.unknowns.length ? <ul className="mt-2 list-disc space-y-1 pl-5">{review.unknowns.map((item, index) => <li key={index}>{item}</li>)}</ul> : <p className="mt-1">No unknowns listed; this is not proof of condition, function or safety.</p>}
    {review.nextEvidence ? <div className="mt-4 rounded-xl border border-[var(--ds-border)] p-3">
      <h3 className="font-semibold">Priority next evidence</h3>
      <p className="mt-1">{review.nextEvidence.request}</p>
      <p className="mt-1 text-xs text-[var(--ds-fg-3)]">Why: {review.nextEvidence.purpose}</p>
    </div> : null}
    <p className="mt-4 text-xs text-[var(--ds-fg-3)]">Functional checks: {review.functionStatus}</p>
  </section>;
}
