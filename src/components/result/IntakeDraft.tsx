import { buildIntakeDraft } from "../../lib/intakeDraft";
import type { Lookup } from "../../types";

export function IntakeDraft({ lookup }: { lookup: Lookup }) {
  const draft = buildIntakeDraft(lookup);
  return (
    <section aria-label="Automatic intake draft" className="rounded-2xl border border-[var(--ds-border)] bg-[var(--ds-elevated)] p-4 text-sm text-[var(--ds-fg-2)]">
      <h2 className="font-bold">Automatic intake draft</h2>
      <p className="mt-1 text-xs text-[var(--ds-fg-3)]">Prepared from this saved scan. Included in your report export.</p>
      <p className="mt-3 font-semibold">{draft.review.label}</p>
      {draft.review.reasons.length ? <ul className="mt-2 list-disc space-y-1 pl-5">{draft.review.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul> : null}
      <dl className="mt-3 space-y-2">
        <div><dt className="font-semibold">Part</dt><dd>{draft.name}</dd><dd className="text-xs text-[var(--ds-fg-3)]">{draft.identitySource}</dd></div>
        <div><dt className="font-semibold">Part number</dt><dd>{draft.partNumber}</dd></div>
        <div><dt className="font-semibold">Function</dt><dd>{draft.functionStatus}</dd></div>
      </dl>
      <details className="mt-3" open>
        <summary className="cursor-pointer font-semibold">Checks before ordering, listing or use ({draft.checks.length})</summary>
        <ul className="mt-2 list-disc space-y-2 pl-5">{draft.checks.map((check) => <li key={check}>{check}</li>)}</ul>
      </details>
      <p className="mt-3 text-xs text-[var(--ds-fg-3)]">This draft does not certify condition, fitment or safety.</p>
    </section>
  );
}
