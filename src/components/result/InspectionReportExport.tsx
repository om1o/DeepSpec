import { useEffect, useRef, useState } from "react";
import { getAccountScope, isAccountScopeCurrent } from "../../lib/accountScope";
import { buildInspectionReportHtml, getInspectionReportFilename } from "../../lib/inspectionReportHtml";
import { collectInspectionReport } from "../../services/inspectionReport";
import { downloadHtmlFile } from "../../services/report";
import { DEFAULT_INSPECTION_REPORT_OPTIONS, type InspectionReportOptions, type InspectionReportSnapshot } from "../../types/inspectionReport";
import Button from "../ui/Button";

export function InspectionReportExport({ lookupId, disabled = false }: { lookupId: string; disabled?: boolean }) {
  const [scope] = useState(getAccountScope);
  const [open, setOpen] = useState(false);
  const [working, setWorking] = useState(false);
  const [snapshot, setSnapshot] = useState<InspectionReportSnapshot | null>(null);
  const [options, setOptions] = useState<InspectionReportOptions>({ ...DEFAULT_INSPECTION_REPORT_OPTIONS });
  const [status, setStatus] = useState("");
  const request = useRef(0);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => () => { request.current += 1; controller.current?.abort(); }, []);

  async function prepare() {
    if (disabled) return;
    if (!isAccountScopeCurrent(scope)) { setStatus("Account changed. Reopen this inspection before exporting."); return; }
    controller.current?.abort();
    const active = new AbortController();
    controller.current = active;
    const generation = ++request.current;
    setWorking(true);
    setSnapshot(null);
    setStatus("Loading saved inspection and photos…");
    try {
      const prepared = await collectInspectionReport(lookupId, { signal: active.signal, onProgress: (message) => {
        if (generation === request.current && !active.signal.aborted && isAccountScopeCurrent(scope)) setStatus(message);
      } }, scope);
      if (generation !== request.current || active.signal.aborted) return;
      if (!isAccountScopeCurrent(scope)) throw new Error("Account changed. Reopen this inspection before exporting.");
      setSnapshot(prepared);
      setStatus(prepared.missing.length ? "Review the missing evidence before downloading." : "Snapshot ready. Review its contents before downloading.");
    } catch (error) {
      if (generation !== request.current || active.signal.aborted) return;
      setStatus(error instanceof Error ? error.message : "The report could not be prepared. Your saved inspection is unchanged.");
    } finally {
      if (generation === request.current) { setWorking(false); controller.current = null; }
    }
  }

  function cancel() {
    request.current += 1;
    controller.current?.abort();
    controller.current = null;
    setWorking(false);
    setSnapshot(null);
    setStatus("Report preparation canceled.");
  }

  function download() {
    if (!snapshot || disabled || working) return;
    if (!isAccountScopeCurrent(scope)) {
      setSnapshot(null);
      setStatus("Account changed. Reopen this inspection before exporting.");
      return;
    }
    try {
      const html = buildInspectionReportHtml(snapshot, options);
      if (!isAccountScopeCurrent(scope)) throw new Error("Account changed. Reopen this inspection before exporting.");
      downloadHtmlFile(getInspectionReportFilename(snapshot), html);
      setStatus("Download started. The HTML file includes the listed photos and can be opened without a connection.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "The report could not be downloaded. Try preparing it again.");
    }
  }

  if (!isAccountScopeCurrent(scope)) return <section aria-label="Inspection report export"><p role="status">Account changed. Reopen this inspection before exporting.</p></section>;
  const photoCount = snapshot?.scans.reduce((total, scan) => total + (scan.photos?.length || 1), 0) ?? 0;
  return <section className="mt-3 rounded-2xl border border-[var(--ds-border)] p-4" aria-label="Inspection report export" aria-busy={working}>
    <button type="button" className="min-h-11 w-full text-left text-sm font-bold" aria-expanded={open} onClick={() => {
      if (open && working) cancel();
      setOpen(!open);
    }}>Inspection report with photos</button>
    {open ? <div className="mt-3 space-y-3 text-sm text-[var(--ds-fg-2)]">
      <p>Export this saved scan, its component map, linked photo groups, dated comparisons and saved human measurement, repair and follow-up history. Only saved changes are included.</p>
      <p className="text-xs text-[var(--ds-fg-3)]">The file includes photos, component notes, corrections and inspection findings. Photos may show identifiers or retain image metadata. Anyone you give the file to can open it.</p>
      <fieldset className="space-y-2" disabled={working}>
        <legend className="mb-2 font-semibold">Optional details</legend>
        <label className="flex min-h-10 items-center gap-3"><input type="checkbox" checked={options.includeVin} onChange={(event) => setOptions({ ...options, includeVin: event.target.checked })} />Include saved VIN</label>
        <label className="flex min-h-10 items-center gap-3"><input type="checkbox" checked={options.includePrivateNotes} onChange={(event) => setOptions({ ...options, includePrivateNotes: event.target.checked })} />Include private scan and vehicle notes</label>
      </fieldset>
      <p className="text-xs text-[var(--ds-fg-3)]">Customer details, registration plate fields and chat messages are excluded. Check the photos and inspection notes before sharing.</p>
      {disabled ? <p role="alert">Save the pending changes before preparing or downloading this report.</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={working || disabled} onClick={prepare}>{snapshot ? "Refresh saved snapshot" : "Prepare report"}</Button>
        {working ? <Button type="button" variant="ghost" onClick={cancel}>Cancel preparation</Button> : null}
      </div>
      {snapshot ? <div className="space-y-3 rounded-xl border border-[var(--ds-border)] p-3" aria-label="Prepared report contents">
        <h3 className="font-bold">Review this snapshot</h3>
        <p>{snapshot.map?.document.components.length ?? 0} mapped components · {snapshot.scans.length} saved scan groups · {photoCount} photo references · {snapshot.serviceLogs?.reduce((count, log) => count + log.records.length, 0) ?? 0} human-service entries · {snapshot.comparisonLogs?.reduce((count, log) => count + log.records.length, 0) ?? 0} comparison entries</p>
        <p className="text-xs">Prepared {new Date(snapshot.createdAt).toLocaleString()}. Later edits require a refreshed snapshot.</p>
        {snapshot.map?.conflict ? <p className="font-semibold">The map has an unresolved cloud conflict. This report uses the saved device version and records the conflict.</p> : null}
        <details>
          <summary className="cursor-pointer py-2 font-semibold">Review included photos</summary>
          <div className="mt-2 space-y-4">{snapshot.scans.map((scan) => <section key={scan.id}>
            <h4 className="font-semibold">{scan.inspection?.confirmedPartName || scan.result?.partName || "Unidentified scan"}</h4>
            <div className="mt-2 grid grid-cols-2 gap-2">{(scan.photos?.length ? scan.photos : [{ id: "photo-1", label: "overview", ...scan.frame }]).map((photo, index) => <figure key={photo.id}>
              {/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/.test(photo.imageBase64)
                ? <img src={photo.imageBase64} alt={`${scan.result?.partName || "Scan"}, photo ${index + 1}: ${photo.label.replaceAll("_", " ")}`} className="max-h-36 w-full rounded-lg object-contain" />
                : <p className="rounded-lg border border-[var(--ds-border)] p-3 text-xs">Photo unavailable</p>}
              <figcaption className="mt-1 break-words text-xs">{index + 1}. {photo.label.replaceAll("_", " ")} · {photo.id}</figcaption>
            </figure>)}</div>
          </section>)}</div>
        </details>
        {snapshot.missing.length ? <div role="alert">
          <h4 className="font-bold">Missing evidence ({snapshot.missing.length})</h4>
          <ul className="mt-2 list-disc space-y-1 break-words pl-5">{snapshot.missing.map((issue, index) => <li key={index}>{issue.lookupId}{issue.photoId ? ` / ${issue.photoId}` : ""}{issue.selectionName ? ` / ${issue.selectionName}` : ""}: {issue.message}</li>)}</ul>
          <p className="mt-2">The file will explicitly list these gaps. It will not be labeled a complete inspection.</p>
        </div> : null}
        <Button type="button" disabled={working || disabled} onClick={download}>{snapshot.missing.length ? "Download with missing evidence" : "Download inspection HTML"}</Button>
      </div> : null}
      {status ? <p role="status" className="break-words text-xs text-[var(--ds-fg-3)]">{status}</p> : null}
    </div> : null}
  </section>;
}
