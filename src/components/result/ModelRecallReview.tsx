import { useEffect, useRef, useState } from "react";
import { isVehicleFieldConfirmed } from "../../lib/vehicleContext";
import { NHTSA_VIN_RECALL_URL, normalizeModelRecallQuery, requestModelRecalls, type ModelRecallQuery, type ModelRecallResult } from "../../services/modelRecalls";
import type { VehicleContext } from "../../types";

type Props = { vehicleContext?: VehicleContext };
type State = { queryKey: string; status: "loading" | "ready" | "error"; result?: ModelRecallResult; message?: string };

export function ModelRecallReview({ vehicleContext }: Props) {
  const query = normalizeModelRecallQuery(vehicleContext);
  const queryKey = query ? `${query.year}\n${query.make}\n${query.model}` : "";
  return <ModelRecallLookup key={queryKey} vehicleContext={vehicleContext} query={query} queryKey={queryKey} />;
}

function ModelRecallLookup({ vehicleContext, query, queryKey }: Props & { query: ModelRecallQuery | null; queryKey: string }) {
  const requestGeneration = useRef(0);
  const [state, setState] = useState<State | null>(null);
  useEffect(() => () => { requestGeneration.current += 1; }, []);
  const current = state?.queryKey === queryKey ? state : null;
  const confirmed = (["year", "make", "model"] as const).every((field) => isVehicleFieldConfirmed(vehicleContext, field));

  async function lookup() {
    if (!query || !vehicleContext || current?.status === "loading") return;
    const generation = ++requestGeneration.current;
    setState({ queryKey, status: "loading" });
    try {
      const result = await requestModelRecalls(vehicleContext);
      if (generation === requestGeneration.current) setState({ queryKey, status: "ready", result });
    } catch (error) {
      if (generation === requestGeneration.current) setState({ queryKey, status: "error", message: error instanceof Error ? error.message : "Recall lookup failed." });
    }
  }

  return <section aria-label="Safety recalls" className="break-words rounded-xl border border-[var(--ds-border)] bg-[var(--ds-surface)] p-4 text-sm">
    <h2 className="font-bold">Safety recalls</h2>
    <p className="mt-1 text-[var(--ds-fg-3)]">A model-wide campaign may not apply to this vehicle. Use NHTSA&apos;s VIN lookup to check listed unrepaired recalls for a specific VIN; its coverage has limits.</p>
    <p className="mt-1 text-[var(--ds-fg-3)]">This search sends the displayed year, make, and model to NHTSA. Remove private identifiers from those fields before searching.</p>
    <a className="mt-2 inline-block min-h-11 content-center font-semibold underline" href={NHTSA_VIN_RECALL_URL} target="_blank" rel="noopener noreferrer">Check this vehicle&apos;s VIN at NHTSA</a>
    {query ? <>
      <p className="mt-2">Model search: {query.year} {query.make} {query.model}.</p>
      {!confirmed ? <p className="mt-1 text-[var(--ds-fg-3)]">These vehicle details are not all user-confirmed. Review them before relying on this model search.</p> : null}
      <button type="button" className="mt-3 min-h-11 rounded-lg border border-[var(--ds-border)] px-4 py-2 font-semibold disabled:opacity-50"
        disabled={current?.status === "loading"} onClick={() => void lookup()}>
        {current?.status === "loading" ? "Checking NHTSA…" : "Search model-wide recalls"}
      </button>
    </> : <p className="mt-2 text-[var(--ds-fg-3)]">Add a valid year, make, and model to the vehicle details to search model-wide recalls.</p>}
    <div aria-live="polite" className="mt-3">
      {current?.status === "error" ? <p role="status">{current.message}</p> : null}
      {current?.status === "ready" && current.result ? <RecallResults result={current.result} /> : null}
    </div>
  </section>;
}

function RecallResults({ result }: { result: ModelRecallResult }) {
  const count = result.recalls.length;
  return <div>
    <p>{count === 0
      ? "NHTSA returned no model-wide campaigns for this search. This does not clear the VIN or establish that the vehicle is safe."
      : `NHTSA returned ${count} model-wide campaign${count === 1 ? "" : "s"}. Some may not apply to this VIN or may already be repaired.`}</p>
    <p className="mt-1 text-[var(--ds-fg-3)]">Retrieved <time dateTime={result.retrievedAt}>{new Date(result.retrievedAt).toLocaleString()}</time>. <a href={result.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline">NHTSA model data</a></p>
    {count > 0 ? <ol className="mt-3 space-y-2">
      {result.recalls.slice(0, 5).map((recall) => <li key={recall.campaignNumber} className="rounded-lg border border-[var(--ds-border)] p-3">
        <p className="font-semibold">{recall.component} · {recall.campaignNumber}</p>
        <details className="mt-1"><summary className="min-h-11 cursor-pointer content-center underline">Read model-wide campaign details</summary>
          <p className="mt-2"><strong>Summary:</strong> {recall.summary || "Not provided in this response; see NHTSA for details."}</p>
          <p className="mt-2"><strong>Consequence:</strong> {recall.consequence || "Not provided in this response; see NHTSA for details."}</p>
          <p className="mt-2"><strong>Remedy:</strong> {recall.remedy || "Not provided in this response; see NHTSA for details."}</p>
        </details>
      </li>)}
    </ol> : null}
    {count > 5 ? <p className="mt-2">Showing the first 5 of {count} campaigns. Open NHTSA model data for the full list.</p> : null}
  </div>;
}
