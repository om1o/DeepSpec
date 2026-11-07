import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Lookup } from "../../types";
import type { DiagnosticAssociation, DiagnosticBundle, DiagnosticDocument, DiagnosticEncoding, ParsedDiagnosticReport } from "../../types/diagnosticReport";
import { getAccountScope, isAccountScopeCurrent } from "../../lib/accountScope";
import { diagnosticAssociationStatus, diagnosticAssociationValidationError, normalizeDiagnosticAssociation } from "../../lib/diagnosticAssociation";
import { createDiagnosticDocument, diagnosticSourceBytes, diagnosticSourceText, verifyDiagnosticDocument } from "../../lib/diagnosticReport";
import { comparisonSideMatches } from "../../lib/inspectionComparison";
import { downloadTextFile } from "../../services/report";
import { comparisonPhotos, comparisonSideForLookup, resolveComparisonSide } from "../../services/comparisonEvidence";
import { getLookup } from "../../services/storage";
import { appendDiagnosticAssociation, appendDiagnosticDocument, importDiagnosticBundle, readDiagnosticBundle, subscribeDiagnosticReports } from "../../services/diagnosticReportStore";
import { readCloudDiagnosticBundle, syncDiagnosticReports } from "../../services/diagnosticReportCloud";
import { isCloudSyncEnabled } from "../../services/cloudSyncPolicy";
import { correctionDiagnosticDraft, newDiagnosticDraft, readDiagnosticDraft, writeDiagnosticDraft, type DiagnosticDraft, type DiagnosticDraftRead } from "../../services/diagnosticDraft";

const buttonClass = "min-h-11 rounded-xl border border-[var(--ds-border)] px-3 py-2 text-sm font-semibold disabled:opacity-50";
const fieldClass = "mt-1 min-h-11 w-full min-w-0 rounded-xl border border-[var(--ds-border)] bg-[var(--ds-surface)] px-3 py-2 text-base";
const label = (value: string) => value.replaceAll("_", " ");
const emptyBundle = (): DiagnosticBundle => ({ documents: [], associations: [] });
const errorText = (error: unknown) => error instanceof Error ? error.message : "This action failed. Your original file and entered fields were not discarded.";

export function DiagnosticReportReview({ lookup, disabled = false }: { lookup: Lookup; disabled?: boolean }) {
  const [opened, setOpened] = useState(false);
  return <details className="min-w-0 rounded-2xl border border-[var(--ds-border)] p-4" onToggle={(event) => { if (event.currentTarget.open) setOpened(true); }}>
    <summary className="min-h-11 cursor-pointer font-bold">Diagnostic report imports</summary>
    {opened ? <DiagnosticEditor key={lookup.id} lookup={lookup} disabled={disabled} /> : null}
  </details>;
}

function DiagnosticEditor({ lookup, disabled }: { lookup: Lookup; disabled: boolean }) {
  const [scope] = useState(getAccountScope), [openedId] = useState(lookup.id);
  const [deviceOrigin] = useState(() => Boolean(getLookup(lookup.id)));
  const [draft, setDraft] = useState(() => newDiagnosticDraft(lookup.id));
  const draftRef = useRef(draft), raw = useRef<string | null>(null), queue = useRef<Promise<void>>(Promise.resolve());
  const blocked = useRef(false), operation = useRef(0), sequence = useRef(0), readSequence = useRef(0), mounted = useRef(true);
  const latest = useRef({ lookup, disabled });
  const [draftBlocked, setDraftBlocked] = useState(false), [busy, setBusy] = useState(false), [ready, setReady] = useState(false), [loaded, setLoaded] = useState(false), [dirty, setDirty] = useState(false);
  const [bundle, setBundle] = useState<DiagnosticBundle>(emptyBundle);
  const [recovery, setRecovery] = useState<DiagnosticDraftRead>({ ok: false, raw: null, draft: null, message: "" });
  const [recovering, setRecovering] = useState(false), [message, setMessage] = useState(""), [notice, setNotice] = useState("");
  const [cloudMessage, setCloudMessage] = useState("Cloud not checked. Device imports are not a cloud backup.");
  const [file, setFile] = useState<File | null>(null), [encoding, setEncoding] = useState<DiagnosticEncoding>("utf-8");
  const importAttempt = useRef<{ file: File; encoding: DiagnosticEncoding; id: string; document?: DiagnosticDocument } | null>(null);
  const current = () => mounted.current && isAccountScopeCurrent(scope) && latest.current.lookup.id === openedId;
  useLayoutEffect(() => { latest.current = { lookup, disabled }; }, [lookup, disabled]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; operation.current = 0; }; }, []);
  useEffect(() => {
    let live = true;
    void readDiagnosticDraft(scope, openedId).then((value) => {
      if (!live || !isAccountScopeCurrent(scope)) return;
      raw.current = value.raw; setRecovery(value); setRecovering(value.raw !== null); setReady(value.ok); setNotice(value.message);
    });
    const reload = async () => {
      const seq = ++readSequence.current;
      try { const result = await readDiagnosticBundle(openedId, scope); if (live && isAccountScopeCurrent(scope) && seq === readSequence.current) { setBundle(result); setLoaded(true); } }
      catch (error) { if (live && isAccountScopeCurrent(scope) && seq === readSequence.current) { setLoaded(false); setMessage(errorText(error)); } }
    };
    void reload(); const unsubscribe = subscribeDiagnosticReports((id) => { if (id === openedId) void reload(); }, scope);
    return () => { live = false; readSequence.current += 1; unsubscribe(); };
  }, [scope, openedId]);
  useEffect(() => {
    if (!dirty && !file) return;
    const prevent = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", prevent); return () => window.removeEventListener("beforeunload", prevent);
  }, [dirty, file]);

  function block(value: boolean) { blocked.current = value; if (current()) setDraftBlocked(value); }
  function replaceDraft(next: DiagnosticDraft) { draftRef.current = next; setDraft(next); }
  function keep(next: DiagnosticDraft) {
    if (!current() || latest.current.disabled || !ready || recovering || operation.current) return;
    const updated = { ...next, updatedAt: new Date().toISOString() };
    replaceDraft(updated); setDirty(true); setMessage(""); setNotice("Keeping association draft on this device…");
    queue.current = queue.current.then(async () => {
      // Navigation can unmount this editor while an earlier IDB write is pending.
      // Retain already-entered edits in their original account; only UI updates
      // depend on the editor still being mounted. The store also guards scope.
      if (blocked.current || !isAccountScopeCurrent(scope)) return;
      const saved = await writeDiagnosticDraft(scope, openedId, raw.current, updated);
      if (saved.ok) raw.current = saved.raw; else block(true);
      if (!current() || draftRef.current !== updated) return;
      setNotice(saved.ok ? "Draft kept on this device; it is not a saved association or cloud backup." : saved.message);
    }).catch((error) => { block(true); if (current()) setNotice(errorText(error)); });
  }
  function edit(record: DiagnosticAssociation) { keep({ ...draftRef.current, record }); }

  /** Every async stage checks this token before beginning another write. A timed-out
   * storage acknowledgement may still arrive; retry retains the immutable ID. */
  async function act(task: (check: () => void, signal: AbortSignal) => Promise<void>) {
    if (!current() || latest.current.disabled || operation.current) return;
    const token = ++sequence.current; operation.current = token; setBusy(true); setMessage("");
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
    const check = () => { if (!current() || latest.current.disabled || operation.current !== token) throw new Error("Account, scan or action changed. Reopen the original scan; no further action was started."); };
    try {
      await Promise.race([task(check, controller.signal), new Promise<never>((_, reject) => {
        timer = setTimeout(() => { if (operation.current === token) operation.current = 0; controller.abort(); reject(new Error("This action took too long. Your file and draft remain available. A save may have completed; reload history before retrying, which keeps the same ID.")); }, 20_000);
      })]);
    } catch (error) { if (current()) setMessage(errorText(error)); }
    finally { clearTimeout(timer); controller.abort(); if (operation.current === token) operation.current = 0; if (current() && !operation.current) setBusy(false); }
  }
  function showBundle(value: DiagnosticBundle) { readSequence.current += 1; setBundle(value); setLoaded(true); }
  function sourceSnapshot() { return { prop: JSON.stringify(latest.current.lookup), device: JSON.stringify(getLookup(openedId)) }; }
  function requireSource(snapshot: ReturnType<typeof sourceSnapshot>) {
    if (deviceOrigin && !getLookup(openedId)) throw new Error("The original device scan was removed. Download your draft and reopen the saved scan.");
    const now = sourceSnapshot();
    if (now.prop !== snapshot.prop || now.device !== snapshot.device) throw new Error("This scan changed while evidence was checked. Your draft remains available; review its originals before retrying.");
  }
  function downloadDraft(saved = false) {
    if (!current()) return;
    const text = saved ? recovery.raw : JSON.stringify(draftRef.current, null, 2);
    if (text) { try { downloadTextFile("deep-spec-unsaved-diagnostic-association.txt", `UNSAVED human diagnostic association — not a diagnosis\n${text}`); } catch { setMessage("Download could not start. Copy your entered fields before leaving."); } }
  }
  function discard() { void act(async (check) => {
    await queue.current; check(); const saved = await writeDiagnosticDraft(scope, openedId, raw.current, null); check();
    if (!saved.ok) throw new Error(saved.message);
    raw.current = null; block(false); replaceDraft(newDiagnosticDraft(openedId)); setDirty(false); setRecovering(false); setRecovery({ ok: true, raw: null, draft: null, message: "" }); setNotice("Draft discarded. Imported originals and saved associations remain.");
  }); }
  function restore() { void act(async (check) => {
    const saved = await readDiagnosticDraft(scope, openedId); check();
    if (!saved.ok || saved.raw !== raw.current || !saved.draft) throw new Error("Recovery changed or is unreadable. Download this copy before reopening; neither draft was overwritten.");
    replaceDraft(saved.draft); setRecovering(false); setDirty(true); block(false); setNotice("Draft restored. Its exact report and originals must verify before saving.");
  }); }
  function importFile() {
    if (!file || !loaded || !ready || dirty || recovering) return;
    void act(async (check) => {
      if (!/\.txt$/i.test(file.name)) throw new Error("Choose a plain-text .txt report. No file was imported.");
      if (file.size > 2 * 1024 * 1024) throw new Error("The report exceeds the 2 MiB limit. No file was imported.");
      let attempt = importAttempt.current;
      if (!attempt || attempt.file !== file || attempt.encoding !== encoding) { attempt = { file, encoding, id: crypto.randomUUID() }; importAttempt.current = attempt; }
      const document = attempt.document ?? await createDiagnosticDocument(file, openedId, encoding, attempt.id); check(); attempt.document = document;
      const saved = await appendDiagnosticDocument(document, scope); check(); showBundle(saved);
      setFile(null); importAttempt.current = null; setMessage("Original bytes saved on this device. Review the parser coverage before linking this report to photos."); setCloudMessage("New device import has not been cloud-confirmed. Sync explicitly for a backup.");
    });
  }
  function chooseDocument(id: string) {
    const document = bundle.documents.find((item) => item.id === id); if (!document) return;
    const r = draftRef.current.record;
    keep({ ...draftRef.current, record: { ...r, documentId: document.id, sourceSha256: document.sha256, entryIds: [], vehicleRelationship: "unconfirmed", basis: "" } });
  }
  function choosePhoto(id: string, selected: boolean) {
    const next = selected ? [...draftRef.current.photoIds, id] : draftRef.current.photoIds.filter((item) => item !== id);
    if (next.length > 4) { setMessage("Choose at most four saved originals."); return; }
    keep({ ...draftRef.current, photoIds: next, record: { ...draftRef.current.record, photos: [], vehicleRelationship: "unconfirmed", basis: "" } });
  }
  function preparePhotos() {
    const snapshot = draftRef.current;
    if (!snapshot.photoIds.length) { setMessage("Select at least one original photo first."); return; }
    void act(async (check) => {
      await queue.current; check(); if (blocked.current) throw new Error("Draft recovery could not be kept. Download your entered fields before reopening.");
      const before = sourceSnapshot(); requireSource(before); const photos = [];
      for (const id of snapshot.photoIds) { photos.push(await comparisonSideForLookup(latest.current.lookup, id, scope)); check(); }
      requireSource(before); operation.current = 0;
      const same = photos.length === snapshot.record.photos.length && photos.every((photo, i) => comparisonSideMatches(photo, snapshot.record.photos[i]));
      keep({ ...snapshot, record: { ...snapshot.record, photos, ...(same ? {} : { vehicleRelationship: "unconfirmed" as const, basis: "" }) } });
    });
  }
  function save() {
    if (!loaded || !ready || recovering || blocked.current) return;
    const snapshot = draftRef.current, record = normalizeDiagnosticAssociation(snapshot.record), invalid = diagnosticAssociationValidationError(snapshot.record);
    if (!record || invalid) { setMessage(invalid ?? "Choose a report and check its selected original photos before saving."); return; }
    void act(async (check, signal) => {
      await queue.current; check(); if (blocked.current) throw new Error("Draft recovery changed. Download your entered fields and reopen before saving.");
      const kept = await writeDiagnosticDraft(scope, openedId, raw.current, snapshot); check();
      if (!kept.ok) { block(true); throw new Error(kept.message); } raw.current = kept.raw;
      const before = sourceSnapshot(); requireSource(before);
      for (const photo of record.photos) {
        for (const source of getLookup(openedId) ? [latest.current.lookup, getLookup(openedId)!] : [latest.current.lookup]) {
          const fresh = await comparisonSideForLookup(source, photo.photoId, scope); check();
          if (!comparisonSideMatches(photo, fresh)) throw new Error("An original or saved vehicle/analysis context changed. Review and check the selected originals again; your draft is preserved.");
        }
        const resolved = await resolveComparisonSide(photo, scope, signal); check(); if (resolved.status !== "unchanged") throw new Error(resolved.message);
      }
      requireSource(before); check(); const saved = await appendDiagnosticAssociation(record, scope); check(); showBundle(saved);
      const cleared = await writeDiagnosticDraft(scope, openedId, raw.current, null); check();
      if (cleared.ok) { raw.current = null; replaceDraft(newDiagnosticDraft(openedId)); setDirty(false); setNotice(""); }
      else { block(true); setNotice(`Association saved; draft recovery could not be cleared. ${cleared.message}`); }
      setMessage("Human association saved on this device. Original diagnostic output, AI findings and inspection status are unchanged."); setCloudMessage("New device association has not been cloud-confirmed. Sync explicitly for a backup.");
    });
  }
  function cloud(action: "read" | "sync") { if (!isCloudSyncEnabled()) return; void act(async (check, signal) => {
    if (action === "read") { const incoming = await readCloudDiagnosticBundle(openedId, scope, signal); check(); const merged = await importDiagnosticBundle(openedId, incoming, scope); check(); showBundle(merged); setCloudMessage("Cloud originals and associations read and retained on this device. Unsaved draft fields were not replaced."); }
    else { const result = await syncDiagnosticReports(openedId, scope); check(); setCloudMessage(result.message); }
  }); }

  if (!isAccountScopeCurrent(scope) || lookup.id !== openedId) return <p role="status">Account or scan changed. Diagnostic content is hidden; reopen the original account and scan.</p>;
  const r = draft.record, locked = disabled || busy || !ready || !loaded || recovering;
  const selected = bundle.documents.find((document) => document.id === r.documentId);
  return <div className="mt-3 min-w-0 space-y-4">
    <p className="text-sm">Import a diagnostic tool’s plain-text report locally. Codes describe reported conditions, not proof of a failed part. Parser coverage describes this file, not vehicle health. No AI or provider processes the file.</p>
    <p className="text-xs">Reports may contain VINs and other identifiers. Raw content is excluded from exported inspection reports unless you explicitly include it. Sync uploads the originals and saved associations to your account.</p>
    <div className="flex flex-wrap gap-2"><button type="button" className={buttonClass} disabled={!isCloudSyncEnabled() || busy || disabled} onClick={() => cloud("read")}>Read cloud diagnostic reports</button><button type="button" className={buttonClass} disabled={!isCloudSyncEnabled() || busy || disabled || !loaded} onClick={() => cloud("sync")}>Sync diagnostic reports</button></div><p role="status" className="text-sm">{isCloudSyncEnabled() ? cloudMessage : "Cloud sync is off. Import and review diagnostic reports on this device."}</p>
    {recovering ? <aside aria-label="Diagnostic draft recovery" className="rounded-xl border border-amber-500 p-3"><p>Unfinished association found. Restore it explicitly, or download and discard it. Imported originals are unchanged.</p><div className="mt-2 flex flex-wrap gap-2"><button type="button" className={buttonClass} disabled={!ready || !recovery.draft || busy || disabled} onClick={restore}>Restore diagnostic draft</button><button type="button" className={buttonClass} onClick={() => downloadDraft(true)}>Download diagnostic recovery</button><button type="button" className={buttonClass} disabled={!ready || busy || disabled} onClick={discard}>Discard diagnostic draft</button></div></aside> : null}
    <fieldset disabled={locked || dirty} className="space-y-3"><legend className="font-bold">Import an original report</legend><label className="block text-sm font-semibold">Plain-text report (.txt, up to 2 MiB)<input className={fieldClass} type="file" accept=".txt,text/plain" onChange={(event) => { setFile(event.target.files?.[0] ?? null); importAttempt.current = null; }} /></label><label className="block text-sm font-semibold">File encoding<select className={fieldClass} value={encoding} onChange={(event) => setEncoding(event.target.value as DiagnosticEncoding)}><option value="utf-8">UTF-8</option><option value="windows-1252">Windows-1252</option></select></label><p className="text-xs">Encoding is your explicit choice; original bytes are never converted. If UTF-8 fails, choose Windows-1252 only when appropriate for that file.</p><button className={buttonClass} type="button" disabled={!file} onClick={importFile}>Import original on this device</button>{file ? <p className="text-sm">Selected: {file.name}</p> : null}</fieldset>
    {dirty ? <p className="text-xs">Save or explicitly discard the unfinished association before importing another file.</p> : null}
    <fieldset disabled={locked} className="min-w-0 space-y-3"><legend className="font-bold">{r.supersedesId ? "Correct a saved association" : "Link diagnostic evidence to this scan"}</legend>
      <label className="block text-sm font-semibold">Imported report<select className={fieldClass} value={r.documentId} onChange={(event) => chooseDocument(event.target.value)}><option value="">Choose an imported report</option>{bundle.documents.map((document) => <option key={document.id} value={document.id}>{document.fileName} — imported {new Date(document.importedAt).toLocaleString()}</option>)}{r.documentId && !selected ? <option value={r.documentId}>Original report unavailable</option> : null}</select></label>
      {selected ? <DocumentView document={selected} entryIds={r.entryIds} onEntries={(entryIds) => edit({ ...r, entryIds })} disabled={locked} /> : null}
      <TextField title="Part or location associated with the report" value={r.subject} max={200} onChange={(subject) => edit({ ...r, subject })} />
      <fieldset><legend className="text-sm font-semibold">Saved original photos (one to four)</legend>{comparisonPhotos(lookup).map((photo) => <label className="flex min-h-11 items-center gap-3 text-sm" key={photo.id}><input type="checkbox" checked={draft.photoIds.includes(photo.id)} onChange={(event) => choosePhoto(photo.id, event.target.checked)} />{label(photo.label)} — {photo.id}</label>)}</fieldset>
      <button type="button" className={buttonClass} onClick={preparePhotos}>Check selected originals</button><p className="text-xs">{r.photos.length ? `${r.photos.length} original photo references checked. They must still match when saving.` : "Check the selected originals to freeze their photo and vehicle context. Changing photos or reports resets vehicle confirmation."}</p>
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">{r.photos.map((photo) => <CheckedPhoto key={photo.photoId} photo={photo} />)}</div>
      <label className="block text-sm font-semibold">Report’s relationship to this vehicle<select className={fieldClass} value={r.vehicleRelationship} onChange={(event) => edit({ ...r, vehicleRelationship: event.target.value as DiagnosticAssociation["vehicleRelationship"] })}><option value="unconfirmed">Not confirmed</option><option value="same_vehicle">I confirm this report is from the same vehicle</option><option value="different_vehicle">Different vehicle</option></select></label>
      <TextField title="How you know the vehicle relationship" value={r.basis} max={1000} onChange={(basis) => edit({ ...r, basis })} multiline />
      <TextField title="Human association notes (included in reports)" value={r.notes} max={4000} onChange={(notes) => edit({ ...r, notes })} multiline /><p className="text-xs">Free text may identify people. Matching VINs or a selected code do not automatically confirm the vehicle or diagnose the photographed part.</p>
      {r.supersedesId ? <TextField title="Reason for correction" value={r.correctionReason ?? ""} max={1000} onChange={(correctionReason) => edit({ ...r, correctionReason })} multiline /> : null}
      <button type="button" className={buttonClass} disabled={draftBlocked} onClick={save}>Save human association on this device</button>
    </fieldset>
    {!ready || !loaded ? <p className="text-sm">Device history and draft recovery must load before importing or saving. Reopen this scan to retry unavailable storage.</p> : null}
    {dirty && !recovering ? <div className="flex flex-wrap gap-2"><button type="button" className={buttonClass} onClick={() => downloadDraft()}>Download unsaved diagnostic association</button><button type="button" className={buttonClass} disabled={busy || disabled || !ready} onClick={discard}>Discard diagnostic draft</button></div> : null}
    <p role="status" className="text-sm">{notice}</p>{message ? <p role="status" className="text-sm font-semibold">{message}</p> : null}
    <OriginalLibrary documents={bundle.documents} disabled={disabled || busy} />
    <ol aria-label="Saved diagnostic associations" className="space-y-3">{bundle.associations.map((record) => { const status = diagnosticAssociationStatus(record, bundle.associations); return <li key={record.id} className="min-w-0 rounded-xl border border-[var(--ds-border)] p-3"><h3 className="font-bold">{record.subject}</h3><p className="text-xs">Recorded {new Date(record.recordedAt).toLocaleString()} · {label(status)}</p>{status === "conflicting_correction" ? <p className="text-sm">Correction fork: review all versions; none is silently preferred.</p> : null}<p className="text-sm">Report: {bundle.documents.find((document) => document.id === record.documentId)?.fileName ?? "Original unavailable"}. Entries: {record.entryIds.length ? record.entryIds.join(", ") : "Whole report"}.</p><p className="text-sm">Original photos: {record.photos.map((photo) => `${label(photo.photoLabel)} (${photo.photoId})`).join(", ")}.</p><p className="text-sm">Vehicle relationship (human statement): {label(record.vehicleRelationship)}. {record.basis}</p><p className="whitespace-pre-wrap text-sm">{record.notes}</p>{record.correctionReason ? <><p className="text-sm">Correction reason: {record.correctionReason}</p><p className="text-sm">Earlier version remains in this history.</p></> : null}<button type="button" className={`${buttonClass} mt-2`} disabled={locked || dirty || status !== "current"} onClick={() => keep(correctionDiagnosticDraft(record))}>Correct diagnostic association</button></li>; })}</ol>
  </div>;
}

function TextField({ title, value, max, onChange, multiline = false }: { title: string; value: string; max: number; onChange: (value: string) => void; multiline?: boolean }) {
  return <label className="block text-sm font-semibold">{title}{multiline ? <textarea className={fieldClass} value={value} maxLength={max} onChange={(event) => onChange(event.target.value)} /> : <input className={fieldClass} value={value} maxLength={max} onChange={(event) => onChange(event.target.value)} />}</label>;
}

function OriginalLibrary({ documents, disabled }: { documents: DiagnosticDocument[]; disabled: boolean }) {
  const [opened, setOpened] = useState(false);
  return <details onToggle={(event) => setOpened(event.currentTarget.open)}><summary className="min-h-11 cursor-pointer font-bold">Imported originals ({documents.length})</summary>{opened ? <div className="space-y-3">{documents.map((document) => <details key={document.id}><summary className="min-h-11 cursor-pointer break-words">Read {document.fileName}</summary><LazyDocument document={document} disabled={disabled} /></details>)}</div> : null}</details>;
}

function LazyDocument({ document, disabled }: { document: DiagnosticDocument; disabled: boolean }) {
  // Only parse a library original once its own details is opened, not every stored file.
  const host = useRef<HTMLDivElement>(null); const [opened, setOpened] = useState(false);
  useEffect(() => { const details = host.current?.closest("details"); if (!details) return; const toggle = () => setOpened(details.open); details.addEventListener("toggle", toggle); return () => details.removeEventListener("toggle", toggle); }, []);
  return <div ref={host}>{opened ? <DocumentView document={document} disabled={disabled} /> : null}</div>;
}

function CheckedPhoto({ photo }: { photo: DiagnosticAssociation["photos"][number] }) {
  const [scope] = useState(getAccountScope), key = JSON.stringify(photo);
  const [value, setValue] = useState<{ key: string; result: Awaited<ReturnType<typeof resolveComparisonSide>> } | null>(null);
  useEffect(() => { const controller = new AbortController(); let live = true;
    void resolveComparisonSide(photo, scope, controller.signal).then((result) => { if (live && isAccountScopeCurrent(scope)) setValue({ key, result }); }).catch(() => { if (live && isAccountScopeCurrent(scope)) setValue({ key, result: { status: "verification_unavailable", message: "Original could not be checked. No substitute is shown." } }); });
    return () => { live = false; controller.abort(); };
  }, [photo, scope, key]);
  if (!isAccountScopeCurrent(scope)) return null;
  const result = value?.key === key ? value.result : null;
  return <figure className="min-w-0"><figcaption className="text-sm">Checked original — {label(photo.photoLabel)} ({photo.photoId})</figcaption>{result?.status === "unchanged" && result.image ? <img src={result.image} alt={`Diagnostic association original ${photo.photoId}`} className="mt-1 max-h-64 w-full rounded-xl object-contain" /> : <p className="text-sm" role="status">{result?.message ?? "Checking original…"}</p>}</figure>;
}

function DocumentView({ document, entryIds = [], onEntries, disabled }: { document: DiagnosticDocument; entryIds?: string[]; onEntries?: (ids: string[]) => void; disabled: boolean }) {
  const [scope] = useState(getAccountScope), sourceKey = JSON.stringify(document);
  const [checked, setChecked] = useState<{ key: string; parsed?: ParsedDiagnosticReport; error?: string } | null>(null);
  const [downloadError, setDownloadError] = useState("");
  const [textOpened, setTextOpened] = useState(false);
  useEffect(() => { let live = true; void verifyDiagnosticDocument(document).then((parsed) => { if (live && isAccountScopeCurrent(scope)) setChecked({ key: sourceKey, parsed }); }).catch((error) => { if (live && isAccountScopeCurrent(scope)) setChecked({ key: sourceKey, error: errorText(error) }); }); return () => { live = false; }; }, [document, scope, sourceKey]);
  if (!isAccountScopeCurrent(scope)) return null;
  const value = checked?.key === sourceKey ? checked : null, parsed = value?.parsed;
  const choose = (id: string, selected: boolean) => { if (!disabled && onEntries) onEntries(selected ? [...entryIds, id] : entryIds.filter((entry) => entry !== id)); };
  const entry = (id: string, title: string) => onEntries ? <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" checked={entryIds.includes(id)} disabled={disabled || (!entryIds.includes(id) && entryIds.length >= 100)} onChange={(event) => choose(id, event.target.checked)} />{title}</label> : null;
  function download() {
    if (disabled || !parsed || !isAccountScopeCurrent(scope)) return;
    try { const bytes = diagnosticSourceBytes(document); const url = URL.createObjectURL(new Blob([bytes.slice().buffer as ArrayBuffer], { type: "application/octet-stream" })); const link = window.document.createElement("a"); link.href = url; link.download = document.fileName; link.rel = "noopener"; window.document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
    catch { setDownloadError("The original download could not start. The saved report was not changed."); }
  }
  return <section aria-label={`Diagnostic original ${document.fileName}`} className="min-w-0 rounded-xl border border-[var(--ds-border)] p-3">
    <h3 className="break-words font-bold">{document.fileName}</h3><p className="text-xs">{document.byteLength} original bytes · {document.encoding} · imported {new Date(document.importedAt).toLocaleString()}</p>
    {!parsed ? <p role="status">{value?.error ?? "Verifying original and parsing locally…"}</p> : <>
      <p className="text-sm">Parser: {parsed.parser}. Source version: {parsed.sourceVersion ?? "not reported"}. Parsing coverage: {parsed.coverage}. {parsed.lineCount} source lines.</p>
      <p className="text-xs">File coverage is not vehicle health. A reported fault or status does not prove the pictured part has failed.</p>
      {parsed.warnings.length ? <ul aria-label="Parser warnings" className="my-2 list-disc pl-5 text-sm">{parsed.warnings.map((warning, index) => <li key={index}>{warning.line ? `Line ${warning.line}: ` : ""}{warning.message}</li>)}</ul> : null}
      {parsed.format === "unrecognized" ? <p className="text-sm font-semibold">Unsupported report format. The original is retained; no structured diagnostic success is claimed.</p> : null}
      <p className="text-sm">Reported time: {parsed.reportedTime ?? "unknown"}; reported mileage: {parsed.reportedMileage ?? "unknown"}. These are report text, not independently verified.</p>
      {parsed.reportedVin ? <details><summary className="min-h-11 cursor-pointer text-sm">Reported VIN (private identifier)</summary><p className="break-all text-sm">{parsed.reportedVin}</p></details> : null}
      {onEntries ? <label className="flex min-h-11 items-center gap-3 text-sm font-semibold"><input type="checkbox" checked={entryIds.length === 0} disabled={disabled} onChange={(event) => { if (event.target.checked) onEntries([]); }} />Use the whole report (select specific entries below to narrow it)</label> : null}
      {parsed.inventory.length ? <details><summary className="min-h-11 cursor-pointer text-sm">Reported controller inventory</summary><ul>{parsed.inventory.map((item, index) => <li className="whitespace-pre-wrap text-sm" key={index}>Line {item.line}: {item.text}</li>)}</ul></details> : null}
      {parsed.controllers.map((controller) => <article className="mt-3 min-w-0 rounded-xl border border-[var(--ds-border)] p-3" key={controller.id}>
        <h4 className="font-semibold">Module {controller.address}: {controller.name}</h4><p className="text-xs">Lines {controller.startLine}–{controller.endLine}; declared faults: {controller.declaredFaultCount ?? "unknown"}; fault coverage: {label(controller.faultCoverage)}.</p>{entry(controller.id, `Select module at line ${controller.startLine}`)}
        {controller.faults.map((fault) => <section className="mt-2 min-w-0" key={fault.id}><h5 className="break-words font-semibold">{fault.vendorCode}{fault.genericCode ? ` / ${fault.genericCode}` : ""} — {fault.description}</h5><p className="text-xs">Lines {fault.startLine}–{fault.endLine}</p>{entry(fault.id, `Select fault at line ${fault.startLine}`)}<ul>{fault.details.map((detail, index) => <li key={index} className="whitespace-pre-wrap text-sm">Line {detail.line}: {detail.text}</li>)}</ul>{fault.freezeFrames.map((frame) => <div key={frame.id} className="mt-2 pl-2"><p className="text-sm font-semibold">Freeze frame — line {frame.line}</p>{entry(frame.id, `Select freeze frame at line ${frame.line}`)}<ul>{frame.readings.map((reading) => <li className="break-words text-sm" key={reading.id}><p>Line {reading.line}: {reading.label}: {reading.rawValue}</p>{entry(reading.id, `Select reading at line ${reading.line}`)}</li>)}</ul></div>)}</section>)}
        <ul>{controller.readiness.map((item, index) => <li key={index} className="whitespace-pre-wrap text-sm">Line {item.line}: {item.text}</li>)}</ul>
      </article>)}
      <details className="mt-3" onToggle={(event) => setTextOpened(event.currentTarget.open)}><summary className="min-h-11 cursor-pointer font-semibold">Read original text with line numbers</summary>{textOpened ? <><p className="text-xs">Decoded using {document.encoding}. Displayed text is escaped; downloading preserves the exact original bytes.</p><ol className="list-decimal overflow-x-auto pl-12 font-mono text-xs">{diagnosticSourceText(document).split(/\r\n|\n|\r/).map((line, index) => <li key={index} className="whitespace-pre-wrap break-words pl-2">{line || "\u00a0"}</li>)}</ol></> : null}</details>
      <button type="button" className={`${buttonClass} mt-2`} disabled={disabled} onClick={download}>Download exact original bytes</button>
    </>}{downloadError ? <p role="status">{downloadError}</p> : null}
  </section>;
}
