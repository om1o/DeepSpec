import { buildIntakeDraft } from "../../lib/intakeDraft";
import type { Lookup } from "../../types";

export function IntakeDraft({ lookup }: { lookup: Lookup }) {
  const draft = buildIntakeDraft(lookup);
  return (
    <section aria-label="Automatic intake draft" className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-800">
      <h2 className="font-bold">Automatic intake draft</h2>
      <p className="mt-1 text-xs text-slate-500">Prepared from this saved scan. Included in your report export.</p>
      <dl className="mt-3 space-y-2">
        <div><dt className="font-semibold">Part</dt><dd>{draft.name}</dd><dd className="text-xs text-slate-500">{draft.identitySource}</dd></div>
        <div><dt className="font-semibold">Part number</dt><dd>{draft.partNumber}</dd></div>
        <div><dt className="font-semibold">Function</dt><dd>{draft.functionStatus}</dd></div>
      </dl>
      <details className="mt-3" open>
        <summary className="cursor-pointer font-semibold">Checks before ordering, listing or use ({draft.checks.length})</summary>
        <ul className="mt-2 list-disc space-y-2 pl-5">{draft.checks.map((check) => <li key={check}>{check}</li>)}</ul>
      </details>
      <p className="mt-3 text-xs text-slate-500">This draft does not certify condition, fitment or safety.</p>
    </section>
  );
}
