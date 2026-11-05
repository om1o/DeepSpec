import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getAccountScope, isAccountScopeCurrent, withAccountRouteState } from "../../lib/accountScope";
import { vehicleContextDetails } from "../../lib/vehicleContext";
import { comparisonSideMatches, inspectionComparisonStatus, inspectionComparisonValidationError, normalizeInspectionComparison } from "../../lib/inspectionComparison";
import { comparisonPhotos, comparisonSideForLookup, resolveComparisonSide } from "../../services/comparisonEvidence";
import { getLookup, readLookups } from "../../services/storage";
import { readCloudLookups } from "../../services/cloudHistory";
import { downloadTextFile } from "../../services/report";
import { appendInspectionComparison, importInspectionComparisons, readInspectionComparisons, subscribeInspectionComparisons } from "../../services/inspectionComparisonStore";
import { readCloudInspectionComparisons, syncInspectionComparisons } from "../../services/inspectionComparisonCloud";
import { changeComparisonPair, correctionComparisonDraft, newComparisonDraft, readComparisonDraft, writeComparisonDraft, type ComparisonDraft, type ComparisonDraftRead } from "../../services/inspectionComparisonDraft";
import type { Lookup } from "../../types";
import type { ComparisonCaptureTarget, ComparisonSide, InspectionComparison } from "../../types/inspectionComparison";

const fieldClass = "mt-1 w-full min-w-0 rounded-xl border border-[var(--ds-border)] bg-[var(--ds-page)] p-3 text-sm";
const buttonClass = "min-h-11 rounded-full border border-[var(--ds-border)] px-4 py-2 text-sm font-bold disabled:opacity-50";
const date = (value: string) => new Date(value).toLocaleString();
const label = (value: string) => value.replaceAll("_", " ");

/** Human comparison history, independent of diagnosis and inspection status. */
export function ScanComparisonReview({ lookup, disabled = false }: { lookup: Lookup; disabled?: boolean }) {
  const [opened, setOpened] = useState(false);
  return <details className="rounded-[22px] border border-[var(--ds-border)] bg-[var(--ds-elevated)] p-4" onToggle={(event) => { if (event.currentTarget.open) setOpened(true); }}>
    <summary className="cursor-pointer font-extrabold">Compare dated inspections</summary>
    {opened ? <ComparisonEditor key={lookup.id} lookup={lookup} disabled={disabled} /> : <p className="mt-2 text-sm">Choose an earlier saved scan and compare its original photo with this inspection.</p>}
  </details>;
}

function ComparisonEditor({ lookup, disabled }: { lookup: Lookup; disabled: boolean }) {
  const navigate = useNavigate(); const [scope] = useState(getAccountScope); const [openedId] = useState(lookup.id);
  const [deviceOrigin] = useState(() => Boolean(getLookup(lookup.id)));
  const initial = () => newComparisonDraft(lookup.id, comparisonPhotos(lookup)[0]?.id ?? "");
  const [draft, setDraft] = useState<ComparisonDraft>(initial); const draftRef = useRef(draft);
  const [initialChoices] = useState(readLookups);
  const [choices, setChoices] = useState<Lookup[]>(() => initialChoices.ok ? initialChoices.value.filter((entry) => entry.id !== openedId) : []); const [records, setRecords] = useState<InspectionComparison[]>([]);
  const [loaded, setLoaded] = useState(false); const [ready, setReady] = useState(false); const [dirty, setDirty] = useState(false);
  const [recovery, setRecovery] = useState<ComparisonDraftRead>({ ok: false, raw: null, draft: null, message: "" });
  const [recovering, setRecovering] = useState(false); const [busy, setBusy] = useState(false); const operation = useRef(false);
  const raw = useRef<string | null>(null); const queue = useRef<Promise<void>>(Promise.resolve()); const blocked = useRef(false); const [draftBlocked, setDraftBlocked] = useState(false);
  const generation = useRef(0); const readGeneration = useRef(0); const mounted = useRef(true); const latestLookup = useRef(lookup);
  const [message, setMessage] = useState(initialChoices.ok ? "" : initialChoices.message); const [notice, setNotice] = useState("");
  const [cloudMessage, setCloudMessage] = useState("Cloud not checked. Device saves are not a cloud backup.");
  const current = () => mounted.current && isAccountScopeCurrent(scope) && openedId === latestLookup.current.id;
  useLayoutEffect(() => { latestLookup.current = lookup; }, [lookup]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    let live = true;
    void readComparisonDraft(scope, openedId).then((value) => {
      if (!live || !isAccountScopeCurrent(scope)) return;
      raw.current = value.raw; setRecovery(value); setRecovering(value.raw !== null); setReady(value.ok); setNotice(value.message);
    });
    const reload = async () => {
      const version = ++readGeneration.current;
      try { const saved = await readInspectionComparisons(openedId, scope); if (live && isAccountScopeCurrent(scope) && version === readGeneration.current) { setRecords(saved); setLoaded(true); } }
      catch (error) { if (live && isAccountScopeCurrent(scope)) { setLoaded(false); setMessage(error instanceof Error ? error.message : "Comparison history could not be read. Reopen this scan to retry."); } }
    };
    void reload(); const unsubscribe = subscribeInspectionComparisons((id) => { if (id === openedId) void reload(); }, scope);
    return () => { live = false; readGeneration.current += 1; unsubscribe(); };
  }, [openedId, scope]);
  useEffect(() => {
    if (!dirty) return;
    const prevent = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", prevent); return () => window.removeEventListener("beforeunload", prevent);
  }, [dirty]);

  function blockDraft(value: boolean) { blocked.current = value; if (current()) setDraftBlocked(value); }

  function keep(next: ComparisonDraft) {
    if (!current() || !ready || recovering || operation.current || disabled) return;
    const updated = { ...next, updatedAt: new Date().toISOString() };
    draftRef.current = updated; setDraft(updated); setDirty(true); const version = ++generation.current;
    setNotice("Keeping comparison draft on this device…"); setMessage("");
    queue.current = queue.current.then(async () => {
      if (blocked.current) { if (current() && version === generation.current) setNotice("Draft recovery changed or could not be saved. Your entered text remains here; download it before reopening."); return; }
      const saved = await writeComparisonDraft(scope, openedId, raw.current, updated);
      if (saved.ok) raw.current = saved.raw; else blockDraft(true);
      if (!current() || version !== generation.current) return;
      setNotice(saved.ok ? "Draft kept on this device; it is not a saved comparison or cloud backup." : saved.message);
    });
  }
  const edit = (record: ComparisonDraft["record"]) => keep({ ...draftRef.current, record });
  function pair(selection: Parameters<typeof changeComparisonPair>[1]) { keep(changeComparisonPair(draftRef.current, selection)); setMessage("Photo pair changed. Confirmations, outcome and alignment were reset. Review the retained notes for this new pair."); }
  function download(saved = false) {
    if (!current()) return;
    const value = saved ? recovery.raw : JSON.stringify(draftRef.current, null, 2);
    if (!value) return;
    try { downloadTextFile("deep-spec-unsaved-comparison.txt", `DeepSpec — UNSAVED COMPARISON DRAFT\nHuman notes, not a diagnosis.\n\n${value}`); }
    catch { setMessage("Download could not start. Copy your entered notes before leaving."); }
  }
  async function discard() {
    if (!current() || !ready || operation.current || disabled) return;
    operation.current = true; setBusy(true);
    try {
      await queue.current;
      const saved = await writeComparisonDraft(scope, openedId, raw.current, null);
      if (!current()) return;
      if (!saved.ok) { setMessage(saved.message); return; }
      raw.current = null; blockDraft(false); const next = initial(); draftRef.current = next; setDraft(next);
      setDirty(false); setRecovering(false); setRecovery({ ok: true, raw: null, draft: null, message: "" }); setNotice(""); setMessage("Draft discarded. Saved comparison history is unchanged.");
    } finally { operation.current = false; if (current()) setBusy(false); }
  }
  async function restore() {
    if (!current() || !ready || !recovery.draft || operation.current || disabled) return;
    operation.current = true; setBusy(true);
    try {
      const saved = await readComparisonDraft(scope, openedId);
      if (!current()) return;
      if (!saved.ok || saved.raw !== raw.current) { setMessage("Recovery changed in another tab. Download this copy and reopen; neither draft was overwritten."); return; }
      draftRef.current = recovery.draft; setDraft(recovery.draft); setRecovering(false); setDirty(true); blockDraft(false);
      setNotice("Draft restored. Original photos and saved context must still verify before it can be saved.");
    } finally { operation.current = false; if (current()) setBusy(false); }
  }
  async function prepare() {
    if (!current() || operation.current || disabled || !ready || recovering || blocked.current) return;
    const snapshot = draftRef.current; const reference = getLookup(snapshot.earlierLookupId) ?? choices.find((entry) => entry.id === snapshot.earlierLookupId);
    if (!reference) { setMessage("Choose an earlier saved scan first."); return; }
    operation.current = true; setBusy(true);
    try {
      const earlier = await comparisonSideForLookup(reference, snapshot.earlierPhotoId, scope);
      const followup = await comparisonSideForLookup(getLookup(openedId) ?? latestLookup.current, snapshot.currentPhotoId, scope);
      if (!current()) return;
      operation.current = false;
      const unchanged = snapshot.record.earlier && snapshot.record.current && comparisonSideMatches(snapshot.record.earlier, earlier) && comparisonSideMatches(snapshot.record.current, followup);
      const next = unchanged ? snapshot : changeComparisonPair(snapshot, {});
      keep({ ...next, record: { ...next.record, earlier: { ...earlier, observedOn: unchanged ? snapshot.record.earlier!.observedOn : null }, current: { ...followup, observedOn: unchanged ? snapshot.record.current!.observedOn : null } } });
    } catch (error) { if (current()) setMessage(error instanceof Error ? error.message : "Original photos could not be checked. Your selections remain available."); }
    finally { operation.current = false; if (current()) setBusy(false); }
  }
  async function verifyCurrent(side: ComparisonSide) {
    const local = getLookup(openedId);
    if (deviceOrigin && !local) throw new Error("The original device scan was removed. Download your draft and reopen the saved scan.");
    for (const source of local ? [latestLookup.current, local] : [latestLookup.current]) {
      const fresh = await comparisonSideForLookup(source, side.photoId, scope);
      if (!comparisonSideMatches(side, fresh)) throw new Error("The current original or saved vehicle/analysis context changed. Your draft is preserved; choose and check the pair again.");
    }
  }
  async function save() {
    if (!current() || operation.current || disabled || !loaded || !ready || recovering) return;
    const snapshot = draftRef.current; const error = inspectionComparisonValidationError(snapshot.record); const record = normalizeInspectionComparison(snapshot.record);
    if (error || !record) { setMessage(error ?? "Choose and check both originals before saving."); return; }
    operation.current = true; setBusy(true);
    try {
      await queue.current;
      if (blocked.current) throw new Error("Draft recovery changed or could not be saved. Download your entered draft and reopen before saving a comparison.");
      const kept = await writeComparisonDraft(scope, openedId, raw.current, snapshot);
      if (!kept.ok) { blockDraft(true); throw new Error(kept.message); }
      raw.current = kept.raw;
      const deviceBefore = JSON.stringify(getLookup(openedId)); const referenceBefore = JSON.stringify(getLookup(record.earlier.lookupId)); const propBefore = JSON.stringify(latestLookup.current);
      await verifyCurrent(record.current);
      for (const side of [record.earlier, record.current]) {
        const resolved = await resolveComparisonSide(side, scope);
        if (resolved.status !== "unchanged") throw new Error(resolved.message);
      }
      if (!current()) return;
      if (deviceBefore !== JSON.stringify(getLookup(openedId)) || referenceBefore !== JSON.stringify(getLookup(record.earlier.lookupId)) || propBefore !== JSON.stringify(latestLookup.current)) throw new Error("One of the saved scans changed while its originals were being checked. Your draft remains available; review and retry.");
      const saved = await appendInspectionComparison(record, scope);
      if (!current()) return;
      readGeneration.current += 1; setRecords(saved);
      const cleared = await writeComparisonDraft(scope, openedId, raw.current, null);
      if (!current()) return;
      if (cleared.ok) {
        raw.current = null; const next = initial(); draftRef.current = next; setDraft(next); setDirty(false); setNotice("");
      } else { blockDraft(true); setNotice(`Comparison saved; recovery could not be cleared. ${cleared.message}`); }
      setMessage("Comparison saved on this device. AI findings and inspection status are unchanged."); setCloudMessage("New device comparison has not been cloud-confirmed. Sync explicitly for a backup.");
    } catch (error) { if (current()) setMessage(error instanceof Error ? error.message : "Save failed. Your entered draft remains available; retry uses the same ID."); }
    finally { operation.current = false; if (current()) setBusy(false); }
  }
  async function cloud(action: "scans" | "read" | "sync") {
    if (!current() || operation.current || disabled) return;
    operation.current = true; setBusy(true);
    try {
      if (action === "scans") {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const remote = await Promise.race([
          readCloudLookups(),
          new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error("Cloud scan choices timed out. Your device draft and history are unchanged; retry when the connection is available.")), 20_000); }),
        ]).finally(() => clearTimeout(timer));
        // A timed-out request may settle later; only this bounded result can
        // update choices, and the account generation must still match.
        if (!current()) return;
        if (!remote.ok) throw new Error(remote.message);
        const local = readLookups(); if (!local.ok) throw new Error(local.message);
        const merged = new Map(remote.value.map((entry) => [entry.id, entry])); local.value.forEach((entry) => merged.set(entry.id, entry));
        setChoices([...merged.values()].filter((entry) => entry.id !== openedId)); setCloudMessage("Cloud scan choices loaded. No scan or comparison was uploaded.");
      } else if (action === "read") {
        const remote = await readCloudInspectionComparisons(openedId, scope); if (!current()) return;
        const saved = await importInspectionComparisons(openedId, remote, scope); if (!current()) return;
        readGeneration.current += 1; setRecords(saved); setLoaded(true); setCloudMessage("Cloud comparison history retained on this device. Drafts and correction forks are preserved; device-only entries may still need syncing.");
      } else { const result = await syncInspectionComparisons(openedId, scope); if (current()) setCloudMessage(result.message); }
    } catch (error) { if (current()) setCloudMessage(error instanceof Error ? error.message : "Cloud action failed. Device history and draft remain available."); }
    finally { operation.current = false; if (current()) setBusy(false); }
  }
  async function repeat() {
    if (!current() || operation.current || disabled || !ready || recovering) return;
    if (!draftRef.current.record.subject.trim()) { setMessage("Name the part or location before taking repeat photos."); return; }
    operation.current = true; setBusy(true);
    try {
      await queue.current; if (blocked.current) throw new Error("Keep or download your comparison draft before leaving; device recovery is not confirmed.");
      const earlier = await comparisonSideForLookup(getLookup(openedId) ?? latestLookup.current, draftRef.current.currentPhotoId, scope);
      await verifyCurrent(earlier); if (!current()) return;
      const target: ComparisonCaptureTarget = { version: 1, comparisonId: crypto.randomUUID(), lookupId: crypto.randomUUID(), earlier, subject: draftRef.current.record.subject };
      navigate("/scan", { state: withAccountRouteState({ comparisonCaptureTarget: target }) });
    } catch (error) { if (current()) setMessage(error instanceof Error ? error.message : "This reference could not be prepared. No new capture started."); }
    finally { operation.current = false; if (current()) setBusy(false); }
  }

  if (!isAccountScopeCurrent(scope) || lookup.id !== openedId) return <p role="status">Account or scan changed. Comparison notes are hidden; reopen the original account and scan.</p>;
  const r = draft.record; const locked = busy || disabled || !ready || recovering;
  const reference = choices.find((entry) => entry.id === draft.earlierLookupId);
  const earlierPhotos = reference ? comparisonPhotos(reference) : [];
  return <div className="mt-3 min-w-0 space-y-4">
    <p className="text-sm">Compare the same location over time using original photos. Dates below are when photos were added or scans saved, not proven exposure dates. Lighting, angle, distance, cleaning and wetness can change appearance; this does not measure damage growth or prove safety.</p>
    <div className="flex flex-wrap gap-2"><button type="button" className={buttonClass} disabled={busy || disabled} onClick={() => void cloud("scans")}>Load cloud scan choices</button><button type="button" className={buttonClass} disabled={busy || disabled} onClick={() => void cloud("read")}>Read cloud comparisons</button><button type="button" className={buttonClass} disabled={busy || disabled || !loaded} onClick={() => void cloud("sync")}>Sync comparisons</button></div>
    <p role="status" className="text-sm">{cloudMessage}</p>
    {recovering ? <aside className="rounded-xl border border-amber-500 p-3" aria-label="Comparison draft recovery"><p>Unfinished comparison found. Restore it explicitly, or download and discard it; saved history is unchanged.</p><div className="mt-2 flex flex-wrap gap-2"><button type="button" className={buttonClass} disabled={!recovery.draft || !ready || busy || disabled} onClick={() => void restore()}>Restore comparison draft</button><button type="button" className={buttonClass} onClick={() => download(true)}>Download comparison recovery</button><button type="button" className={buttonClass} disabled={!ready || busy || disabled} onClick={() => void discard()}>Discard comparison draft</button></div></aside> : null}
    <fieldset disabled={locked} className="min-w-0 space-y-3">
      <legend className="font-bold">{r.supersedesId ? "Correct a saved comparison" : "New comparison"}</legend>
      <ComparisonText title="Part or location" value={r.subject} onChange={(subject) => edit({ ...r, subject })} max={200} />
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        <label className="min-w-0 text-sm font-semibold">Earlier saved scan<select className={fieldClass} value={draft.earlierLookupId} onChange={(e) => { const selected = choices.find((item) => item.id === e.target.value); pair({ earlierLookupId: e.target.value, earlierPhotoId: selected ? comparisonPhotos(selected)[0]?.id ?? "" : "" }); }}><option value="">Choose a saved scan</option>{draft.earlierLookupId && !reference ? <option value={draft.earlierLookupId}>Saved reference unavailable in this list</option> : null}{choices.map((entry) => <option key={entry.id} value={entry.id}>{entry.result?.partName ?? "Saved scan"} — saved {date(entry.createdAt)}</option>)}</select></label>
        <label className="min-w-0 text-sm font-semibold">Earlier original photo<select className={fieldClass} value={draft.earlierPhotoId} onChange={(e) => pair({ earlierPhotoId: e.target.value })}><option value="">Choose an original</option>{earlierPhotos.map((photo) => <option key={photo.id} value={photo.id}>{label(photo.label)} — {photo.id}</option>)}{draft.earlierPhotoId && !earlierPhotos.some((p) => p.id === draft.earlierPhotoId) ? <option value={draft.earlierPhotoId}>Saved original reference</option> : null}</select></label>
      </div>
      <label className="block text-sm font-semibold">Current original photo<select className={fieldClass} value={draft.currentPhotoId} onChange={(e) => pair({ currentPhotoId: e.target.value })}>{comparisonPhotos(lookup).map((photo) => <option key={photo.id} value={photo.id}>{label(photo.label)} — {photo.id}</option>)}</select></label>
      <div className="flex flex-wrap gap-2"><button type="button" className={buttonClass} onClick={() => void prepare()}>Check selected originals</button><button type="button" className={buttonClass} onClick={() => void repeat()}>Photograph this location again</button></div>
      {r.earlier && r.current ? <>
        <OriginalPair earlier={r.earlier} current={r.current} alignment={r.alignment} />
        <div className="grid gap-3 sm:grid-cols-2">{(["earlier", "current"] as const).map((side) => <label key={side} className="text-sm font-semibold">{side === "earlier" ? "Earlier" : "Current"} observation date (self-reported, optional)<input className={fieldClass} type="date" value={r[side]?.observedOn ?? ""} onChange={(e) => edit({ ...r, [side]: { ...r[side]!, observedOn: e.target.value || null } })} /></label>)}</div>
        <details className="rounded-xl border border-[var(--ds-border)] p-3"><summary className="cursor-pointer text-sm font-bold">Align display only</summary><p className="mt-2 text-xs">Reversible viewing aids; originals are unchanged. Alignment is not a calibrated measurement.</p><div className="grid gap-3 sm:grid-cols-2">{([ ["rotation", "Rotate current photo", -180, 180, 1], ["scale", "Scale current photo", .25, 4, .05], ["offsetX", "Pan current photo horizontally", -1, 1, .01], ["offsetY", "Pan current photo vertically", -1, 1, .01] ] as const).map(([key, title, min, max, step]) => <label className="mt-2 text-sm" key={key}>{title}<input aria-label={title} className="block min-h-11 w-full" type="range" min={min} max={max} step={step} value={r.alignment[key]} onChange={(e) => edit({ ...r, alignment: { ...r.alignment, [key]: Number(e.target.value) } })} /></label>)}</div><button type="button" className={buttonClass} onClick={() => edit({ ...r, alignment: { rotation: 0, scale: 1, offsetX: 0, offsetY: 0 } })}>Reset alignment</button></details>
      </> : <p className="text-sm">Check both originals to freeze their photo and vehicle context. Changing the pair resets identity confirmations and outcome; retained notes need review.</p>}
      <label className="flex min-h-11 items-center gap-3 text-sm font-semibold"><input type="checkbox" checked={r.relationship.sameVehicle} onChange={(e) => edit({ ...r, relationship: { ...r.relationship, sameVehicle: e.target.checked }, observation: { ...r.observation, outcome: "not_reviewed" } })} />I confirm these show the same vehicle</label>
      <label className="block text-sm font-semibold">Component relationship<select className={fieldClass} value={r.relationship.component} onChange={(e) => edit({ ...r, relationship: { ...r.relationship, component: e.target.value as InspectionComparison["relationship"]["component"] }, observation: { ...r.observation, outcome: "not_reviewed" } })}><option value="unconfirmed">Not confirmed</option><option value="same_part">I confirm this is the same physical part</option><option value="replacement_same_location">Replacement part in the same location</option><option value="different">Different part / location</option></select></label>
      <ComparisonText title="How you know the vehicle / part relationship" value={r.relationship.basis} onChange={(basis) => edit({ ...r, relationship: { ...r.relationship, basis } })} max={1000} multiline />
      <div className="grid gap-3 sm:grid-cols-2">{(["angle", "lighting"] as const).map((key) => <label key={key} className="text-sm font-semibold">{key === "angle" ? "Viewing angle" : "Lighting"}<select className={fieldClass} value={r.conditions[key]} onChange={(e) => edit({ ...r, conditions: { ...r.conditions, [key]: e.target.value } })}><option value="unknown">Unknown / not checked</option><option value="similar">Appears similar</option><option value="different">Different</option></select></label>)}</div>
      <ComparisonText title="Surface, cleaning, wetness and distance differences" value={r.conditions.surfaceNotes} onChange={(surfaceNotes) => edit({ ...r, conditions: { ...r.conditions, surfaceNotes } })} max={2000} multiline />
      <label className="block text-sm font-semibold">Your comparison outcome<select className={fieldClass} value={r.observation.outcome} onChange={(e) => edit({ ...r, observation: { ...r.observation, outcome: e.target.value as InspectionComparison["observation"]["outcome"] } })}><option value="not_reviewed">Not reviewed</option><option value="inconclusive">Inconclusive</option><option value="change_observed" disabled={!r.relationship.sameVehicle || r.relationship.component !== "same_part"}>Visible change observed</option><option value="no_obvious_change" disabled={!r.relationship.sameVehicle || r.relationship.component !== "same_part"}>No obvious change in these photos</option></select></label>
      <ComparisonText title="Human observations (included in reports)" value={r.observation.notes} onChange={(notes) => edit({ ...r, observation: { ...r.observation, notes } })} max={2000} multiline />
      <p className="text-xs">Free text may identify people. Identity confirmation is your statement; matching vehicle details or AI labels do not prove it. No obvious change is not proof of no damage.</p>
      {r.supersedesId ? <ComparisonText title="Reason for correction" value={r.correctionReason ?? ""} onChange={(correctionReason) => edit({ ...r, correctionReason })} max={1000} multiline /> : null}
      <button type="button" className={buttonClass} disabled={!loaded || draftBlocked} onClick={() => void save()}>Save comparison on this device</button>
    </fieldset>
    {!ready || !loaded ? <p className="text-sm">Device history and draft recovery must load before saving. Reopen this scan to retry unavailable storage.</p> : null}
    {dirty && !recovering ? <div className="flex flex-wrap gap-2"><button type="button" className={buttonClass} onClick={() => download()}>Download unsaved comparison</button><button type="button" className={buttonClass} disabled={busy || disabled || !ready} onClick={() => void discard()}>Discard comparison draft</button></div> : null}
    <p role="status" className="text-sm">{notice}</p>{message ? <p role="status" className="text-sm font-semibold">{message}</p> : null}
    <ol aria-label="Saved comparisons" className="space-y-3">{records.map((record) => {
      const status = inspectionComparisonStatus(record, records);
      return <li key={record.id} className="min-w-0 rounded-xl border border-[var(--ds-border)] p-3"><h3 className="font-bold">{record.subject}</h3><p className="text-xs">Recorded {date(record.recordedAt)} · {label(status)}</p>{status === "conflicting_correction" ? <p className="text-sm">Correction fork: review all versions; none is silently preferred.</p> : null}<OriginalPair earlier={record.earlier} current={record.current} alignment={record.alignment} /><p className="mt-2 text-sm">Same vehicle: {record.relationship.sameVehicle ? "user confirmed" : "not confirmed"}. Component: {label(record.relationship.component)}. {record.relationship.basis}</p><p className="text-sm">Angle: {record.conditions.angle}; lighting: {record.conditions.lighting}. {record.conditions.surfaceNotes}</p><p className="whitespace-pre-wrap text-sm">Human outcome: {label(record.observation.outcome)}. {record.observation.notes}</p>{record.correctionReason ? <><p className="text-sm">Correction reason: {record.correctionReason}</p><p className="text-sm">Earlier version remains in this history.</p></> : null}<button type="button" className={`${buttonClass} mt-2`} disabled={busy || disabled || dirty || recovering || !ready || status !== "current"} onClick={() => keep(correctionComparisonDraft(record))}>Correct comparison</button></li>;
    })}</ol>
  </div>;
}

function ComparisonText({ title, value, onChange, max, multiline = false }: { title: string; value: string; onChange: (value: string) => void; max: number; multiline?: boolean }) {
  return <label className="block text-sm font-semibold">{title}{multiline ? <textarea className={fieldClass} maxLength={max} value={value} onChange={(event) => onChange(event.target.value)} /> : <input className={fieldClass} maxLength={max} value={value} onChange={(event) => onChange(event.target.value)} />}</label>;
}

function OriginalPair({ earlier, current, alignment }: Pick<InspectionComparison, "earlier" | "current" | "alignment">) {
  const contradictions = (["vin", "year", "make", "model", "engine"] as const).filter((key) => {
    const left = earlier.vehicleContext?.[key]?.trim(); const right = current.vehicleContext?.[key]?.trim();
    return left && right && left.toLocaleLowerCase() !== right.toLocaleLowerCase();
  });
  return <div className="mt-3 min-w-0">{contradictions.length ? <p className="mb-2 rounded-xl border border-amber-500 p-3 text-sm" role="status">Saved vehicle details differ: {contradictions.map((key) => key === "vin" ? "VIN" : key).join(", ")}. Check the records and explain any same-vehicle confirmation; do not assume these photographs belong to the same car.</p> : null}<div className="grid min-w-0 gap-3 sm:grid-cols-2"><Original side={earlier} title="Earlier original" /><Original side={current} title="Current original" alignment={alignment} /></div></div>;
}
function Original({ side, title, alignment }: { side: ComparisonSide; title: string; alignment?: InspectionComparison["alignment"] }) {
  const [scope] = useState(getAccountScope); const sourceKey = JSON.stringify(side);
  const [resolution, setResolution] = useState<{ key: string; result: Awaited<ReturnType<typeof resolveComparisonSide>> } | null>(null);
  const [originalView, setOriginalView] = useState<{ key: string; enabled: boolean } | null>(null);
  const showOriginal = originalView?.key === sourceKey && originalView.enabled;
  const resolved = resolution?.key === sourceKey ? resolution.result : null;
  useEffect(() => {
    const controller = new AbortController(); let live = true;
    void resolveComparisonSide(side, scope, controller.signal).then((result) => { if (live && isAccountScopeCurrent(scope)) setResolution({ key: sourceKey, result }); }).catch(() => { if (live && isAccountScopeCurrent(scope)) setResolution({ key: sourceKey, result: { status: "verification_unavailable", message: "Original could not be verified. No substitute is shown." } }); });
    return () => { live = false; controller.abort(); };
  }, [side, scope, sourceKey]);
  if (!isAccountScopeCurrent(scope)) return null;
  return <figure className="min-w-0"><figcaption className="text-sm font-semibold">{title} — {label(side.photoLabel)}</figcaption><div className="relative mt-1 flex aspect-[4/3] items-center justify-center overflow-hidden rounded-xl bg-black/10">{resolved?.status === "unchanged" && resolved.image ? <img alt={title} className="h-full w-full object-contain" src={resolved.image} style={alignment && !showOriginal ? { transform: `translate(${alignment.offsetX * 100}%, ${alignment.offsetY * 100}%) rotate(${alignment.rotation}deg) scale(${alignment.scale})` } : undefined} /> : <p className="p-3 text-sm" role="status">{resolved?.message ?? "Checking original…"}</p>}</div>{alignment && resolved?.status === "unchanged" && resolved.image ? <button type="button" className={`${buttonClass} mt-2`} onClick={() => setOriginalView({ key: sourceKey, enabled: !showOriginal })}>{showOriginal ? "Show saved alignment" : "Show unaligned original"}</button> : null}<p className="mt-1 text-xs">Photo added {date(side.photoAddedAt)}; scan saved {date(side.scanSavedAt)}. {side.observedOn ? `Observed ${side.observedOn} (user reported).` : "Observation date unknown."}</p><details className="mt-1 text-xs"><summary>Saved vehicle context</summary><dl>{vehicleContextDetails(side.vehicleContext ?? undefined).map(([name, value]) => <div key={name}><dt className="font-semibold">{name}</dt><dd>{value}</dd></div>)}</dl></details></figure>;
}
