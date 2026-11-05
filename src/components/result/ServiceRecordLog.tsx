import { useEffect, useRef, useState } from "react";
import { getAccountScope, isAccountScopeCurrent } from "../../lib/accountScope";
import { normalizeServiceRecord, serviceRecordRows, serviceRecordStatus, serviceRecordValidationError } from "../../lib/serviceRecord";
import { vehicleContextDetails } from "../../lib/vehicleContext";
import { getLookup } from "../../services/storage";
import { downloadTextFile } from "../../services/report";
import { appendServiceRecord, importServiceRecords, readServiceRecords, subscribeServiceRecords } from "../../services/serviceRecordStore";
import { readCloudServiceRecords, syncServiceRecords } from "../../services/serviceRecordCloud";
import { correctionServiceRecordDraft, newServiceRecordDraft, readServiceRecordDraft, serviceRecordContextForLookup, serviceRecordContextsMatch, serviceRecordDraftVehicleContext, serviceRecordFromDraft, writeServiceRecordDraft, type ServiceRecordContext, type ServiceRecordDraft, type ServiceRecordDraftRead, type ServiceRecordFields } from "../../services/serviceRecordDraft";
import type { Lookup } from "../../types";
import type { ServiceRecord } from "../../types/serviceRecord";

const fieldClass = "mt-1 w-full rounded-xl border border-[var(--ds-border)] bg-[var(--ds-page)] p-3 text-sm text-[var(--ds-fg-1)]";
const buttonClass = "min-h-11 rounded-full border border-[var(--ds-border)] px-4 py-2 text-sm font-bold disabled:opacity-50";
const kindLabels = { measurement: "Measurement", repair: "Repair / work", follow_up: "Follow-up check", retraction: "Retraction" };

/** Append-only human history. Never updates AI output or PartInspection. */
export function ServiceRecordLog({ lookup, disabled = false }: { lookup: Lookup; disabled?: boolean }) {
  const [scope] = useState(getAccountScope);
  const [openedId] = useState(lookup.id);
  const [openedWithDeviceScan] = useState(() => Boolean(getLookup(lookup.id)));
  const [records, setRecords] = useState<ServiceRecord[]>([]);
  const [context, setContext] = useState<ServiceRecordContext | null>(null);
  const [draft, setDraft] = useState<ServiceRecordDraft | null>(null);
  const draftRef = useRef<ServiceRecordDraft | null>(null);
  const [recovery, setRecovery] = useState<ServiceRecordDraftRead>({ ok: false, raw: null, record: null, message: "" });
  const [recoveryPending, setRecoveryPending] = useState(false);
  const [draftReady, setDraftReady] = useState(false);
  const draftRaw = useRef<string | null>(null);
  const persistence = useRef<Promise<void>>(Promise.resolve());
  const persistenceGeneration = useRef(0);
  const mounted = useRef(true);
  const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState("");
  const [message, setMessage] = useState("");
  const [cloudMessage, setCloudMessage] = useState("Cloud not checked. Device saves are not a cloud backup.");
  const [busy, setBusy] = useState(false);
  const [savedAttempt, setSavedAttempt] = useState(false);
  const operation = useRef(false);
  const [loaded, setLoaded] = useState(false);
  const readGeneration = useRef(0);
  const current = isAccountScopeCurrent(scope) && openedId === lookup.id;

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    let live = true;
    void readServiceRecordDraft(scope, openedId).then((value) => {
      if (!live || !isAccountScopeCurrent(scope)) return;
      draftRaw.current = value.raw; setRecovery(value); setRecoveryPending(value.raw !== null);
      setDraftReady(value.ok); setNotice(value.message);
    });
    return () => { live = false; };
  }, [openedId, scope]);

  useEffect(() => {
    let live = true;
    void serviceRecordContextForLookup(lookup).then((next) => {
      if (!live || !isAccountScopeCurrent(scope) || openedId !== lookup.id) return;
      setContext(next);
      if (!draftRef.current) { const initial = newServiceRecordDraft(next); draftRef.current = initial; setDraft(initial); }
    }).catch(() => { if (live && isAccountScopeCurrent(scope)) setMessage("Photo context could not be checked. Reopen this scan before saving service records."); });
    return () => { live = false; };
  }, [lookup, openedId, scope]);

  useEffect(() => {
    let live = true;
    const reload = async () => {
      const generation = ++readGeneration.current;
      try {
        const saved = await readServiceRecords(openedId, scope);
        if (live && isAccountScopeCurrent(scope) && generation === readGeneration.current) { setRecords(saved); setLoaded(true); }
      } catch (error) { if (live && isAccountScopeCurrent(scope) && generation === readGeneration.current) { setLoaded(false); setMessage(error instanceof Error ? error.message : "Device service history could not be read. Retry before saving."); } }
    };
    void reload();
    const unsubscribe = subscribeServiceRecords((lookupId) => { if (lookupId === openedId) void reload(); }, scope);
    return () => { live = false; readGeneration.current += 1; unsubscribe(); };
  }, [openedId, scope]);

  function requireAccount() {
    if (isAccountScopeCurrent(scope) && openedId === lookup.id) return true;
    setMessage("Account or scan changed. Reopen the original scan to recover its service draft."); return false;
  }
  function keep(next: ServiceRecordDraft) {
    const updated = { ...next, updatedAt: new Date().toISOString() };
    draftRef.current = updated; setDraft(updated); setDirty(true);
    const generation = ++persistenceGeneration.current;
    setNotice("Keeping draft on this device…");
    // Serialize this view's keystrokes. Each CAS uses the last committed raw value;
    // a competing tab still fails inside the shared database transaction.
    persistence.current = persistence.current.then(async () => {
      const result = await writeServiceRecordDraft(scope, openedId, draftRaw.current, updated);
      if (result.ok) draftRaw.current = result.raw;
      if (!mounted.current || !isAccountScopeCurrent(scope) || generation !== persistenceGeneration.current) return;
      setNotice(result.ok ? "Draft kept on this device. It is not a saved service record or cloud backup." : result.message);
      if (result.ok && result.legacyRaw) setRecovery((previous) => ({ ...previous, legacyRaw: result.legacyRaw }));
    });
    setMessage("");
  }
  function change<K extends keyof ServiceRecordFields>(key: K, value: ServiceRecordFields[K]) {
    const previous = draftRef.current;
    if (!requireAccount() || !previous || !draftReady || recoveryPending || operation.current || savedAttempt) return;
    keep({ ...previous, fields: { ...previous.fields, [key]: value } });
  }
  function downloadRecovery(recovered = false, legacy = false) {
    if (!requireAccount()) return;
    const content = legacy ? recovery.legacyRaw : recovered ? recovery.raw : draft ? JSON.stringify(draft, null, 2) : null;
    if (!content) return;
    try { downloadTextFile("deep-spec-unsaved-service-draft.txt", `DeepSpec — UNSAVED HUMAN SERVICE DRAFT\nIncomplete recovery copy; not a saved record or safety certification.\n\n${content}`); }
    catch { setMessage("Draft download could not start. Your entered text is still here; copy it before leaving."); }
  }
  async function restore() {
    if (!requireAccount() || !context || !recovery.record || !draftReady || operation.current) return;
    operation.current = true; setBusy(true);
    try {
      const latest = await readServiceRecordDraft(scope, openedId);
      if (!mounted.current || !isAccountScopeCurrent(scope)) return;
      if (!latest.ok || latest.raw !== draftRaw.current || !serviceRecordContextsMatch(recovery.record.context, context)) {
        setMessage("The draft or scan context changed. Download the recovery copy before reopening; it was not overwritten."); return;
      }
      draftRef.current = recovery.record; setDraft(recovery.record); setRecoveryPending(false); setDirty(true);
      setNotice("Draft restored with its original photos and vehicle snapshot. Review it before saving.");
    } finally { operation.current = false; if (mounted.current && isAccountScopeCurrent(scope)) setBusy(false); }
  }
  async function discard() {
    if (!requireAccount() || !context || !draftReady || operation.current) return;
    operation.current = true; setBusy(true);
    try {
      await persistence.current;
      const result = await writeServiceRecordDraft(scope, openedId, draftRaw.current, null);
      if (!mounted.current || !isAccountScopeCurrent(scope)) return;
      if (!result.ok) { setMessage(result.message); return; }
      draftRaw.current = null; setRecovery({ ...result, record: null, message: "" }); setRecoveryPending(false);
      const next = newServiceRecordDraft(context); draftRef.current = next; setDraft(next);
      setDirty(false); setSavedAttempt(false); setNotice(""); setMessage("Draft discarded. Saved service history is unchanged.");
    } finally { operation.current = false; if (mounted.current && isAccountScopeCurrent(scope)) setBusy(false); }
  }
  function correct(record: ServiceRecord, retract: boolean) {
    if (!requireAccount() || !context || !draftReady || dirty || recoveryPending || operation.current) return;
    keep(correctionServiceRecordDraft(record, context, retract));
  }
  async function save() {
    if (!requireAccount() || operation.current || !draft || !context || !draftReady || recoveryPending || !loaded || disabled || savedAttempt) return;
    const input = serviceRecordFromDraft(draft);
    const error = serviceRecordValidationError(input);
    const record = normalizeServiceRecord(input);
    if (error || !record) { setMessage(error ?? "Review the required fields before saving."); return; }
    operation.current = true; setBusy(true);
    try {
      await persistence.current;
      if (!mounted.current || !isAccountScopeCurrent(scope)) return;
      const savedLookup = getLookup(openedId);
      if (openedWithDeviceScan && !savedLookup) throw new Error("The original device scan was removed. Download this draft before reopening; no service record was saved.");
      if ((savedLookup && !serviceRecordContextsMatch(draft.context, await serviceRecordContextForLookup(savedLookup)))
        || !serviceRecordContextsMatch(draft.context, await serviceRecordContextForLookup(lookup))) {
        throw new Error("The saved scan photos or vehicle context changed. Download this draft and reopen the scan; no service record was saved.");
      }
      if (!isAccountScopeCurrent(scope)) return;
      if (record.photoIds.some((id) => !draft.context.photos.some((photo) => photo.id === id))) throw new Error("A selected photo is no longer part of this scan.");
      if (draft.supersedesId) {
        const saved = await readServiceRecords(openedId, scope);
        const target = saved.find((item) => item.id === draft.supersedesId);
        if (!target || JSON.stringify(target) !== draft.baseRecord || saved.some((item) => item.supersedesId === target.id && item.id !== record.id)) {
          throw new Error("This record was corrected or retracted elsewhere. Your draft is preserved; reload the history before making a new correction.");
        }
      }
      const saved = await appendServiceRecord(record, scope);
      if (!isAccountScopeCurrent(scope)) return;
      readGeneration.current += 1; setRecords(saved); setLoaded(true);
      const cleared = await writeServiceRecordDraft(scope, openedId, draftRaw.current, null);
      if (!mounted.current || !isAccountScopeCurrent(scope)) return;
      if (cleared.ok) {
        draftRaw.current = null; const next = newServiceRecordDraft(context); draftRef.current = next; setDraft(next); setDirty(false);
        setRecovery({ ...cleared, record: null, message: "" }); setNotice("");
      } else { setSavedAttempt(true); setNotice(`Record saved. Download or discard this recovery copy before starting another entry. ${cleared.message}`); }
      setMessage("Service record saved on this device. AI findings and inspection status are unchanged.");
      setCloudMessage("New device record has not been confirmed in the cloud. Use Sync service history explicitly.");
    } catch (error) {
      if (isAccountScopeCurrent(scope)) setMessage(error instanceof Error ? error.message : "Device save failed. Your entered fields remain available; retry uses the same record ID.");
    } finally { operation.current = false; if (isAccountScopeCurrent(scope)) setBusy(false); }
  }
  async function cloud(action: "read" | "sync") {
    if (!requireAccount() || operation.current || disabled) return;
    operation.current = true; setBusy(true);
    try {
      if (action === "read") {
        const remote = await readCloudServiceRecords(openedId, scope);
        if (!isAccountScopeCurrent(scope)) return;
        const saved = await importServiceRecords(openedId, remote, scope);
        if (!isAccountScopeCurrent(scope)) return;
        readGeneration.current += 1; setRecords(saved); setLoaded(true);
        setCloudMessage("Cloud history read and retained on this device. Local drafts and correction forks were preserved. Device-only records may still need syncing.");
      } else {
        const response = await syncServiceRecords(openedId, scope);
        if (isAccountScopeCurrent(scope)) setCloudMessage(`${response.message} Acknowledged records: ${response.synced}. Records added later still need syncing.`);
      }
    } catch (error) { if (isAccountScopeCurrent(scope)) setCloudMessage(error instanceof Error ? error.message : "Cloud action failed. Device history and draft are unchanged; retry when available."); }
    finally { operation.current = false; if (isAccountScopeCurrent(scope)) setBusy(false); }
  }

  if (!current) return <p role="status">Account or scan changed. Service notes are hidden. Reopen the original account and scan to recover its draft.</p>;
  const mismatch = Boolean(draft && context && !serviceRecordContextsMatch(draft.context, context));
  const restoreMatches = Boolean(context && recovery.record && serviceRecordContextsMatch(context, recovery.record.context));
  const fields = draft?.fields;
  const input = (key: keyof ServiceRecordFields, label: string, max: number, multiline = false) => <label key={key} className="block text-sm font-semibold">{label}{multiline
    ? <textarea className={fieldClass} maxLength={max} value={String(fields?.[key] ?? "")} onChange={(event) => change(key, event.target.value)} />
    : <input className={fieldClass} maxLength={max} value={String(fields?.[key] ?? "")} onChange={(event) => change(key, event.target.value)} />}</label>;
  return <details className="rounded-[22px] border border-[var(--ds-border)] bg-[var(--ds-elevated)] p-4 shadow-sm">
    <summary className="cursor-pointer text-sm font-extrabold">Human service history{recoveryPending ? " — draft available" : ` — ${records.length} record${records.length === 1 ? "" : "s"}`}</summary>
    <p className="mt-3 text-sm text-[var(--ds-fg-3)]">Record measurements, work and follow-up checks. These are self-reported history, separate from AI findings and the human inspection summary. A completed action or symptom not observed during one check is not proof of repair or roadworthiness.</p>
    <div className="mt-3 flex flex-wrap gap-2"><button type="button" className={buttonClass} disabled={busy || disabled} onClick={() => void cloud("read")}>Read cloud service history</button><button type="button" className={buttonClass} disabled={busy || disabled || !loaded} onClick={() => void cloud("sync")}>Sync service history</button></div>
    <p role="status" className="mt-2 text-sm">{cloudMessage}</p>
    <ol className="mt-4 space-y-3" aria-label="Saved service records">{records.map((record) => {
      const status = serviceRecordStatus(record, records);
      return <li key={record.id} className="rounded-xl border border-[var(--ds-border)] p-3">
        <h3 className="font-bold">{kindLabels[record.kind]}: {record.subject}</h3>
        <p className="text-xs">{status.replaceAll("_", " ")} · Recorded {new Date(record.recordedAt).toLocaleString()}</p>
        {status === "conflicting_correction" ? <p className="mt-2 text-sm text-amber-700">Correction fork: multiple records revise the same entry. Review all versions; none is silently preferred.</p> : null}
        <dl className="mt-2 space-y-1 text-sm">{serviceRecordRows(record, { includeRecorder: true, includePrivateNotes: true }).map(([label, value], index) => <div key={`${label}-${index}`}><dt className="font-semibold">{label}</dt><dd className="whitespace-pre-wrap break-words">{value}</dd></div>)}</dl>
        {record.kind !== "retraction" ? <div className="mt-2 flex flex-wrap gap-2"><button type="button" className={buttonClass} disabled={busy || disabled || !draftReady || dirty || recoveryPending || status !== "current"} onClick={() => correct(record, false)}>Correct entry</button><button type="button" className={buttonClass} disabled={busy || disabled || !draftReady || dirty || recoveryPending || status !== "current"} onClick={() => correct(record, true)}>Retract entry</button></div> : null}
      </li>;
    })}</ol>
    {!loaded ? <p className="mt-3 text-sm">Device history must load before a record can be saved. Reopen this scan to retry a device read.</p> : null}
    {!draftReady ? <p className="mt-3 text-sm">Draft recovery must load before editing. If storage could not open, download any available recovery and reopen this scan.</p> : null}
    {recoveryPending ? <aside className="mt-4 rounded-xl border border-amber-400 p-3" aria-label="Service draft recovery">
      <p className="font-bold">Unfinished service record found</p><p className="text-sm">{restoreMatches ? "Restore it explicitly or download and discard it. Saved history has not changed." : "This draft is unreadable or its photo/vehicle context differs. Download it to compare; automatic restore is blocked."}</p>
      <div className="mt-2 flex flex-wrap gap-2"><button type="button" className={buttonClass} disabled={!restoreMatches || !draftReady || busy || disabled} onClick={() => void restore()}>Restore service draft</button><button type="button" className={buttonClass} onClick={() => downloadRecovery(true)}>Download recovery copy</button><button type="button" className={buttonClass} disabled={busy || disabled || !draftReady || !context} onClick={() => void discard()}>Discard service draft</button></div>
    </aside> : null}
    {dirty && !recoveryPending ? <div className="mt-3 flex flex-wrap gap-2"><button type="button" className={buttonClass} onClick={() => downloadRecovery()}>Download unsaved service draft</button><button type="button" className={buttonClass} disabled={busy || disabled || !draftReady || !context} onClick={() => void discard()}>Discard service draft</button></div> : null}
    {recovery.legacyRaw ? <aside className="mt-3 text-sm"><p>An earlier local recovery copy is retained separately. It is not the current draft or a saved service record.</p><button type="button" className={buttonClass} onClick={() => downloadRecovery(false, true)}>Download earlier recovery copy</button></aside> : null}
    {notice ? <p className="mt-2 text-sm">{notice}</p> : null}
    {mismatch ? <p className="mt-2 text-sm text-amber-700">Photo or vehicle context changed. Download this draft, then discard it to start against the current saved scan.</p> : null}
    {draft ? <form className="mt-4" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <fieldset disabled={busy || disabled || !draftReady || recoveryPending || !loaded || mismatch || savedAttempt} className="space-y-3">
        <legend className="mb-3 font-bold">{draft.supersedesId ? (fields?.kind === "retraction" ? "Append a retraction" : "Append a correction") : "Add a service record"}</legend>
        {draft.supersedesId ? <p className="text-sm">The original remains in history. Give a reason for this new entry.</p> : <label className="block text-sm font-semibold">Record type<select className={fieldClass} value={fields?.kind} onChange={(event) => change("kind", event.target.value as ServiceRecordFields["kind"])}><option value="measurement">Measurement</option><option value="repair">Repair / work</option><option value="follow_up">Follow-up check</option></select></label>}
        {input("subject", "Part or area checked", 200)}
        {input("recordedBy", "Recorded by (self-reported)", 120)}
        <label className="block text-sm font-semibold">Evidence basis<select className={fieldClass} value={fields?.basis} onChange={(event) => change("basis", event.target.value as ServiceRecordFields["basis"])}><option value="personally_performed">I personally performed this</option><option value="reported_by_another">Reported by another person</option><option value="transcribed_document">Transcribed from a document</option></select></label>
        <label className="block text-sm font-semibold">Date performed (leave blank if unknown)<input type="date" className={fieldClass} value={fields?.occurredOn} onChange={(event) => change("occurredOn", event.target.value)} /></label>
        {fields?.kind === "measurement" ? <>
          {input("quantity", "What was measured", 120)}
          <label className="block text-sm font-semibold">Reading state<select className={fieldClass} value={fields.readingState} onChange={(event) => change("readingState", event.target.value as ServiceRecordFields["readingState"])}><option value="obtained">Reading obtained</option><option value="not_obtained">Reading not obtained</option></select></label>
          {fields.readingState === "obtained" ? <>{input("reading", "Reading (exact numeric text)", 100)}{input("unit", "Unit", 40)}</> : input("noReadingReason", "Why no reading was obtained", 1000, true)}
          {input("method", "Method (Unknown is allowed)", 1000, true)}{input("instrument", "Instrument (Unknown is allowed)", 200)}{input("conditions", "Measurement conditions", 1000, true)}
        </> : null}
        {fields?.kind === "repair" ? <><label className="block text-sm font-semibold">Work status<select className={fieldClass} value={fields.repairStatus} onChange={(event) => change("repairStatus", event.target.value as ServiceRecordFields["repairStatus"])}><option value="unknown">Unknown</option><option value="planned">Planned</option><option value="attempted">Attempted</option><option value="completed">Completed (self-reported)</option></select></label>{input("action", "Action planned or performed", 2000, true)}{input("parts", "Parts used or proposed", 2000, true)}</> : null}
        {fields?.kind === "follow_up" ? <><label className="block text-sm font-semibold">Outcome of this check<select className={fieldClass} value={fields.outcome} onChange={(event) => change("outcome", event.target.value as ServiceRecordFields["outcome"])}><option value="not_checked">Not checked</option><option value="symptom_observed">Symptom observed</option><option value="symptom_not_observed">Symptom not observed during this check</option><option value="inconclusive">Inconclusive</option></select></label>{input("check", "Follow-up check performed", 2000, true)}{input("conditions", "Conditions during the check", 1000, true)}
          <fieldset className="space-y-2"><legend className="text-sm font-semibold">Related prior records (optional)</legend>{records.filter((record) => record.kind !== "retraction").map((record) => <label className="flex min-h-11 items-center gap-2 text-sm" key={record.id}><input type="checkbox" checked={fields.relatedRecordIds.includes(record.id)} onChange={(event) => change("relatedRecordIds", event.target.checked ? [...fields.relatedRecordIds, record.id] : fields.relatedRecordIds.filter((id) => id !== record.id))} />{kindLabels[record.kind]}: {record.subject} · {record.recordedAt}</label>)}</fieldset>
        </> : null}
        {draft.supersedesId ? input("correctionReason", "Reason for correction or retraction", 1000, true) : null}
        {input("notes", "Evidence notes (included in reports)", 2000, true)}
        <p className="text-xs text-[var(--ds-fg-3)]">Evidence notes and other service descriptions are shared in reports. Avoid entering private names or contact details into these fields.</p>
        <fieldset className="space-y-2"><legend className="text-sm font-semibold">Supporting saved photos (optional)</legend>{draft.context.photos.map((photo, index) => <label className="flex min-h-11 items-center gap-2 text-sm" key={photo.id}><input type="checkbox" checked={fields?.photoIds.includes(photo.id)} onChange={(event) => change("photoIds", event.target.checked ? [...(fields?.photoIds ?? []), photo.id] : (fields?.photoIds ?? []).filter((id) => id !== photo.id))} />Photo {index + 1}: {photo.label.replaceAll("_", " ")} ({photo.id})</label>)}</fieldset>
        <details className="text-xs"><summary>Vehicle snapshot attached to this record</summary><dl>{vehicleContextDetails(serviceRecordDraftVehicleContext(draft)).filter(([label]) => label !== "VIN").map(([label, value]) => <div key={label}><dt className="font-semibold">{label}</dt><dd>{value}</dd></div>)}</dl><p>Snapshot is frozen when this draft begins; corrections and retractions retain the original entry’s snapshot. Blank performed date remains unknown; dates and identity are self-reported.</p></details>
        <button type="submit" className="min-h-11 rounded-full bg-neutral-900 px-5 py-3 text-sm font-bold text-white">{busy ? "Saving…" : "Save service record on this device"}</button>
      </fieldset>
    </form> : <p className="mt-3 text-sm">Checking saved photo context…</p>}
    <p role="status" className="mt-3 text-sm">{message}</p>
    <p className="mt-2 text-xs text-[var(--ds-fg-3)]">AI result, confidence and inspection status are not changed by any entry in this log.</p>
  </details>;
}
