import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getAccountScope, isAccountScopeCurrent } from "../../lib/accountScope";
import { inspectionComparisonStatus } from "../../lib/inspectionComparison";
import { readRequestedEvidenceHistory } from "../../services/requestedEvidenceHistory";
import { subscribeInspectionComparisons } from "../../services/inspectionComparisonStore";
import { readLookups, subscribeToLookupChanges } from "../../services/storage";
import type { Lookup } from "../../types";
import type { RequestedEvidenceGuide } from "../../types/inspectionComparison";

const buttonClass = "min-h-11 rounded-full border border-[var(--ds-border)] px-4 py-2 text-sm font-bold disabled:opacity-50";
type History = Awaited<ReturnType<typeof readRequestedEvidenceHistory>>;

/** This is a retained AI suggestion, not a newly inferred request or a resolution. */
export function RequestedEvidenceReceipt({ guide }: { guide: RequestedEvidenceGuide }) {
  return <section aria-label="Saved photo request" className="my-3 rounded-xl border border-[var(--ds-border)] p-3">
    <h4 className="font-bold">AI-suggested {guide.kind === "marking" ? "marking photo" : "next photo"} — saved request</h4>
    <p className="whitespace-pre-wrap text-sm">{guide.request}</p>
    <p className="mt-2 whitespace-pre-wrap text-sm"><strong>Why it was requested: </strong>{guide.purpose}</p>
    <p className="mt-2 text-xs">{guide.photoIds.length ? `Request cited original photo IDs: ${guide.photoIds.join(", ")}.` : "The saved request did not cite particular original photos."}</p>
    <p className="mt-2 text-xs">Collecting photos does not mean this request was resolved. Human comparison conclusions are recorded separately.</p>
  </section>;
}

export function RequestedEvidenceHistory({ lookup, disabled = false }: { lookup: Lookup; disabled?: boolean }) {
  const [opened, setOpened] = useState(false);
  return <details className="rounded-[22px] border border-[var(--ds-border)] bg-[var(--ds-elevated)] p-4" onToggle={(event) => { if (event.currentTarget.open) setOpened(true); }}>
    <summary className="cursor-pointer font-extrabold">Requested-photo follow-ups</summary>
    {opened ? <DeviceHistory key={lookup.id} lookupId={lookup.id} disabled={disabled} /> : <p className="mt-2 text-sm">Find saved follow-ups to requests from this scan on this device. Cloud history is not searched.</p>}
  </details>;
}

function DeviceHistory({ lookupId, disabled }: { lookupId: string; disabled: boolean }) {
  const navigate = useNavigate();
  const [scope] = useState(getAccountScope);
  const [refresh, setRefresh] = useState(0);
  const [history, setHistory] = useState<History | null>(null);
  const [device, setDevice] = useState<ReturnType<typeof readLookups>>(readLookups);
  const [failure, setFailure] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let live = true; let revision = 0;
    const reload = async () => {
      if (!isAccountScopeCurrent(scope)) return;
      const request = ++revision;
      try {
        await Promise.resolve();
        if (!live || !isAccountScopeCurrent(scope) || request !== revision) return;
        setLoading(true);
        const result = await readRequestedEvidenceHistory(lookupId, scope);
        if (!live || !isAccountScopeCurrent(scope) || request !== revision) return;
        setHistory(result); setFailure(""); setDevice(readLookups());
      } catch (error) {
        if (live && isAccountScopeCurrent(scope) && request === revision) {
          setFailure(error instanceof Error ? error.message : "Device request history could not be read. Retry; no conclusion about missing follow-ups can be made.");
        }
      } finally {
        if (live && isAccountScopeCurrent(scope) && request === revision) setLoading(false);
      }
    };
    void reload();
    // Receipts live in the follow-up's bucket, not the originating scan's bucket.
    const unsubscribe = subscribeInspectionComparisons(() => { void reload(); }, scope);
    const unsubscribeLookups = isAccountScopeCurrent(scope) ? subscribeToLookupChanges(() => {
      if (live && isAccountScopeCurrent(scope)) setDevice(readLookups());
    }) : () => {};
    return () => { live = false; revision += 1; unsubscribe(); unsubscribeLookups(); };
  }, [lookupId, refresh, scope]);

  function openFollowup(id: string) {
    if (disabled || !isAccountScopeCurrent(scope)) return;
    const current = readLookups(); setDevice(current);
    if (!current.ok || !current.value.some((entry) => entry.id === id)) {
      setNotice("The follow-up is unavailable on this device. Its saved request receipt is retained; cloud history was not searched."); return;
    }
    navigate(`/result/${encodeURIComponent(id)}`);
  }

  if (!isAccountScopeCurrent(scope)) return <p role="status">Account changed. Request history is hidden; reopen the original account and scan.</p>;
  return <div className="mt-3 min-w-0 space-y-3">
    <p className="text-sm">Device history only. Cloud history is not searched. These receipts retain the request at capture time, even if the original AI answer later changed. They do not prove the request was answered.</p>
    <button type="button" className={buttonClass} disabled={disabled} onClick={() => { setNotice(""); setRefresh((value) => value + 1); }}>Refresh device request history</button>
    {failure ? <p role="status" className="text-sm">History may be incomplete. {failure} Previously loaded receipts below are retained.</p> : null}
    {loading ? <p role="status" className="text-sm">Reading device request history…</p> : null}
    {history && !history.complete ? <p role="status" className="text-sm">History is incomplete. {history.reason ?? "Not every device comparison bucket could be checked."} Additional follow-ups may exist.</p> : null}
    {history?.complete && !failure && !loading && history.records.length === 0 ? <p className="text-sm">No saved requested-photo receipts were found on this device. Older captures may not have retained the request; cloud history was not searched.</p> : null}
    {!device.ok ? <p role="status" className="text-sm">Follow-up availability could not be checked. {device.message}</p> : null}
    {notice ? <p role="status" className="text-sm">{notice}</p> : null}
    <ol aria-label="Requested-photo receipts" className="space-y-3">{history?.records.map((record) => {
      const status = inspectionComparisonStatus(record, history.records);
      const available = device.ok && device.value.some((entry) => entry.id === record.lookupId);
      return <li key={`${record.lookupId}:${record.id}`} className="min-w-0 rounded-xl border border-[var(--ds-border)] p-3">
        <h3 className="font-bold">{record.subject}</h3>
        <p className="text-xs">Receipt recorded {new Date(record.recordedAt).toLocaleString()} — this is not a proven photo exposure date.</p>
        <p className="text-xs">Status among loaded receipts: {status.replaceAll("_", " ")}.</p>
        {status === "conflicting_correction" ? <p className="text-sm">Correction fork: review all retained versions; none is silently preferred.</p> : null}
        <RequestedEvidenceReceipt guide={record.requestedEvidence} />
        <p className="whitespace-pre-wrap text-sm">Human outcome: {record.observation.outcome.replaceAll("_", " ")}. {record.observation.notes}</p>
        {record.correctionReason ? <p className="whitespace-pre-wrap text-sm">Correction reason: {record.correctionReason} Earlier versions remain in this history.</p> : null}
        <button type="button" className={`${buttonClass} mt-2`} disabled={disabled || !available} onClick={() => openFollowup(record.lookupId)}>Open follow-up</button>
        {!available ? <p className="mt-2 text-sm">Follow-up unavailable on this device. The historical request remains above; cloud history was not searched.</p> : <p className="mt-2 text-xs">Open the saved follow-up to review its originals and current result. This list does not verify that its photos are unchanged.</p>}
      </li>;
    })}</ol>
  </div>;
}
