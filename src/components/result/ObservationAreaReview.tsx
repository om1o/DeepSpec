import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Lookup, VisualFocusBox } from "../../types";
import type { ObservationAreaBinding, ObservationAreaDraft, ObservationAreaRecord, ObservationAreaRectangle } from "../../types/observationArea";
import { getAccountScope, isAccountScopeCurrent } from "../../lib/accountScope";
import { observationAreaBindingKey, observationAreaGroups, observationAreaRecordStatus } from "../../lib/observationArea";
import { prepareObservationAreaBinding, verifyObservationAreaBinding, assertObservationAreaGuardCurrent, type ObservationAreaGuard } from "../../services/observationAreaEvidence";
import { readObservationAreas, subscribeObservationAreas, readObservationAreaDraft, writeObservationAreaDraft, commitObservationAreaDraft } from "../../services/observationAreaStore";
import { downloadTextFile } from "../../services/report";
import { subscribeToLookupChanges } from "../../services/storage";
import { FocusAreaEditor } from "./FocusAreaEditor";

export type ObservationAreaSelection = { observationId: string; photoId: string };
type Review = { binding: ObservationAreaBinding; image?: string; source: string; guard?: ObservationAreaGuard; invalidated?: boolean; historical?: boolean; record?: ObservationAreaRecord };
type Recovery = Awaited<ReturnType<typeof readObservationAreaDraft>>;
const START_AREA: VisualFocusBox = { x: 0.2, y: 0.2, width: 0.6, height: 0.6, confidence: 0 };
const buttonClass = "min-h-11 rounded-lg border border-[var(--ds-border)] px-3 py-2 text-sm disabled:opacity-50";
function sourceKey(lookup: Lookup) {
  return JSON.stringify({ id: lookup.id, createdAt: lookup.createdAt, frame: lookup.frame, photos: lookup.photos, result: lookup.result, analysisAttemptId: lookup.analysisAttemptId, photoRelationship: lookup.photoRelationship, vehicleContext: lookup.vehicleContext });
}
function rectangle(box: VisualFocusBox): ObservationAreaRectangle { return { x: box.x, y: box.y, width: box.width, height: box.height }; }
function position(box: ObservationAreaRectangle) { return { left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.width * 100}%`, height: `${box.height * 100}%` }; }

/** Observation geometry is separate from first-photo part isolation and from AI findings. */
export function ObservationAreaReview(props: { lookup: Lookup; selection?: ObservationAreaSelection; disabled?: boolean }) {
  const scope = getAccountScope();
  return <ObservationAreaReviewContent key={`${scope.userId}:${scope.generation}:${props.lookup.id}`} {...props} />;
}

function ObservationAreaReviewContent({ lookup, selection, disabled = false }: { lookup: Lookup; selection?: ObservationAreaSelection; disabled?: boolean }) {
  const [scope] = useState(getAccountScope);
  const source = useMemo(() => sourceKey(lookup), [lookup]);
  const latest = useRef({ source, disabled });
  const mounted = useRef(true), controller = useRef<AbortController | null>(null), operation = useRef(false);
  const [records, setRecords] = useState<ObservationAreaRecord[]>([]);
  const [loaded, setLoaded] = useState(false), [ready, setReady] = useState(false), [busy, setBusy] = useState(false);
  const [review, setReview] = useState<Review | null>(null), [view, setView] = useState<"original" | "outline">("outline");
  const reviewRef = useRef<Review | null>(null);
  const [draft, setDraft] = useState<ObservationAreaDraft | null>(null), draftRef = useRef<ObservationAreaDraft | null>(null);
  const raw = useRef<string | null>(null), writes = useRef(Promise.resolve()), writeGeneration = useRef(0);
  const [recovery, setRecovery] = useState<Recovery | null>(null), [recovering, setRecovering] = useState(false);
  const [editing, setEditing] = useState(false), [notice, setNotice] = useState(""), [message, setMessage] = useState("");
  const [refresh, setRefresh] = useState(0);
  const panel = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    if (latest.current.source !== source || disabled) controller.current?.abort();
    latest.current = { source, disabled };
  }, [source, disabled]);
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; controller.current?.abort(); }; }, []);
  function current(expected = source) {
    if (!mounted.current || !isAccountScopeCurrent(scope) || latest.current.source !== expected || latest.current.disabled) throw new Error("The scan, source photo or account changed. Your area draft is retained; reopen the original inspection before saving.");
  }
  function begin() {
    if (operation.current) return null;
    current(); const active = new AbortController(); controller.current?.abort(); controller.current = active;
    operation.current = true; setBusy(true); return active;
  }
  function finish(active: AbortController) {
    // A completed verification remains usable for display notifications. Only
    // still-pending work belongs in the cancellation slot; starting a later
    // operation must not abort the signal behind an already verified image.
    if (controller.current === active) controller.current = null;
    operation.current = false; if (mounted.current && isAccountScopeCurrent(scope)) setBusy(false);
  }
  const fail = useCallback((error: unknown) => { if (mounted.current && isAccountScopeCurrent(scope)) setMessage(error instanceof Error ? error.message : "The area could not be saved safely. Its draft and history were kept."); }, [scope]);
  function showReview(value: Review) { reviewRef.current = value; setReview(value); }

  useEffect(() => {
    if (!isAccountScopeCurrent(scope)) return;
    return subscribeToLookupChanges(() => {
      if (!mounted.current || !isAccountScopeCurrent(scope)) return;
      const displayed = reviewRef.current;
      if (!displayed?.guard) return;
      try { assertObservationAreaGuardCurrent(displayed.guard, displayed.binding, scope); }
      catch {
        controller.current?.abort(); setEditing(false);
        const invalid = { ...displayed, image: undefined, guard: undefined, invalidated: true };
        reviewRef.current = invalid; setReview(invalid);
        setMessage("The saved photo or AI result changed elsewhere. The displayed image and areas were hidden; your draft is retained. Verify the original again before continuing.");
      }
    });
  }, [scope]);

  useEffect(() => {
    let live = true;
    if (!isAccountScopeCurrent(scope)) return;
    void readObservationAreaDraft(scope, lookup.id).then((value) => {
      if (!live || !isAccountScopeCurrent(scope)) return;
      raw.current = value.raw; setRecovery(value); setRecovering(value.raw !== null); setReady(value.ok); setNotice(value.message);
    }).catch((error) => { if (live) fail(error); });
    return () => { live = false; };
  }, [lookup.id, scope, fail]);
  useEffect(() => {
    let live = true, historyGeneration = 0;
    if (!isAccountScopeCurrent(scope)) return;
    const reload = async () => {
      const generation = ++historyGeneration;
      try {
        const saved = await readObservationAreas(lookup.id, scope);
        if (live && isAccountScopeCurrent(scope) && generation === historyGeneration) { setRecords(saved); setLoaded(true); }
      } catch (error) { if (live && generation === historyGeneration) { setLoaded(false); fail(error); } }
    };
    void reload(); const unsubscribe = subscribeObservationAreas((id) => { if (id === lookup.id) void reload(); }, scope);
    return () => { live = false; unsubscribe(); };
  }, [lookup.id, scope, fail]);

  const openSelection = useEffectEvent(async (chosen: ObservationAreaSelection) => {
    await Promise.resolve();
    if (!mounted.current || !isAccountScopeCurrent(scope) || disabled) return;
    panel.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
    if (draftRef.current || raw.current !== null || recovering) { setMessage("An unfinished area draft is retained. Restore, save or explicitly discard it before reviewing another observation or photo."); return; }
    if (!ready || !loaded) return;
    // A newer selection cancels only a read, never a draft write or commit.
    controller.current?.abort();
    const active = new AbortController(); controller.current = active;
    setMessage("Checking the exact original for this observation…");
    try {
      const prepared = await prepareObservationAreaBinding(lookup, chosen.observationId, chosen.photoId, scope, active.signal);
      current(source); active.signal.throwIfAborted();
      showReview({ binding: prepared.binding, image: prepared.image, guard: prepared.guard, source });
      setEditing(false); setView("outline"); setMessage("");
    } catch (error) { if (!active.signal.aborted) fail(error); }
    finally { if (controller.current === active) controller.current = null; }
  });
  useEffect(() => {
    let live = true;
    void Promise.resolve().then(() => { if (live && selection) void openSelection(selection); });
    return () => { live = false; };
  }, [selection, source, ready, loaded, refresh]);

  function keep(next: ObservationAreaDraft) {
    const updated = { ...next, updatedAt: new Date().toISOString() };
    draftRef.current = updated; setDraft(updated); setNotice("Keeping area draft on this device…");
    const generation = ++writeGeneration.current;
    writes.current = writes.current.then(async () => {
      const saved = await writeObservationAreaDraft(scope, lookup.id, raw.current, updated);
      if (saved.ok) raw.current = saved.raw;
      if (!mounted.current || !isAccountScopeCurrent(scope) || generation !== writeGeneration.current) return;
      setNotice(saved.ok ? "Area draft kept on this device. It is not a saved mark or cloud backup." : saved.message);
    }).catch(fail);
  }
  async function edit(record?: ObservationAreaRecord, retract = false) {
    if (!ready || !loaded || recovering || draftRef.current || raw.current !== null || disabled) { setMessage("Finish or explicitly discard the existing area draft first."); return; }
    const selected = record?.binding ?? review?.binding;
    if (!selected) return;
    let active: AbortController | null = null;
    try {
      active = begin(); if (!active) return;
      const mode = record ? retract ? "retraction" : "historical" : "current";
      const verified = await verifyObservationAreaBinding(selected, scope, active.signal, mode);
      current(); active.signal.throwIfAborted(); assertObservationAreaGuardCurrent(verified.guard, selected, scope);
      const at = new Date().toISOString();
      const next: ObservationAreaDraft = { version: 1, id: crypto.randomUUID(), lookupId: lookup.id, recordedAt: at, updatedAt: at, binding: selected, expectedHeadId: record?.id ?? null, kind: retract ? "retraction" : "mark", rectangle: record?.kind === "mark" && !retract ? record.rectangle : null, notes: record?.notes ?? "", correctionReason: "" };
      draftRef.current = next; setDraft(next); showReview({ binding: selected, image: verified.image, guard: verified.guard, source, record }); setView("outline");
      const saved = await writeObservationAreaDraft(scope, lookup.id, raw.current, next);
      if (saved.ok) raw.current = saved.raw;
      current(); active.signal.throwIfAborted();
      setEditing(saved.ok && !retract); setNotice(saved.ok ? "Area draft kept. Draw or adjust its area, then save the human mark." : saved.message);
      setMessage(retract ? "Retraction preserves the earlier mark and its observation/photo reference. Explain why it is being withdrawn." : "Your mark locates this observation; it does not confirm the AI claim.");
    } catch (error) { fail(error); } finally { if (active) finish(active); }
  }
  async function restore() {
    if (!recovery?.draft || !ready) return;
    let active: AbortController | null = null;
    try {
      active = begin(); if (!active) return;
      const saved = await readObservationAreaDraft(scope, lookup.id);
      current(); active.signal.throwIfAborted();
      if (saved.raw !== raw.current || !saved.draft) throw new Error("The area draft changed elsewhere. Download the recovery copy before reopening; nothing was overwritten.");
      const mode = saved.draft.kind === "retraction" ? "retraction" : saved.draft.expectedHeadId ? "historical" : "current";
      const verified = await verifyObservationAreaBinding(saved.draft.binding, scope, active.signal, mode);
      current(); active.signal.throwIfAborted(); assertObservationAreaGuardCurrent(verified.guard, saved.draft.binding, scope);
      const final = await readObservationAreaDraft(scope, lookup.id); current(); active.signal.throwIfAborted();
      if (final.raw !== saved.raw) throw new Error("The area draft changed elsewhere. Its recovery copy was preserved.");
      draftRef.current = saved.draft; setDraft(saved.draft); setRecovering(false); showReview({ binding: saved.draft.binding, image: verified.image, guard: verified.guard, source }); setView("outline"); setEditing(false); setMessage("Area draft restored. Review it before saving.");
    } catch (error) { fail(error); } finally { if (active) finish(active); }
  }
  async function discard() {
    let active: AbortController | null = null;
    try {
      active = begin(); if (!active) return;
      await writes.current; current(); active.signal.throwIfAborted();
      const result = await writeObservationAreaDraft(scope, lookup.id, raw.current, null);
      if (!result.ok) throw new Error(result.message);
      raw.current = null; draftRef.current = null; setDraft(null); setRecovery(null); setRecovering(false); setEditing(false); setNotice(""); setMessage("Area draft discarded. Saved history is unchanged."); setRefresh((value) => value + 1);
    } catch (error) { fail(error); } finally { if (active) finish(active); }
  }
  async function save() {
    let active: AbortController | null = null;
    try {
      active = begin(); if (!active) return;
      await writes.current; current(); active.signal.throwIfAborted();
      const value = draftRef.current; if (!value) return;
      // Retry a failed draft write without changing the immutable attempt id.
      const saved = await writeObservationAreaDraft(scope, lookup.id, raw.current, value);
      if (!saved.ok) throw new Error(saved.message);
      raw.current = saved.raw;
      if (!saved.raw) throw new Error("The area draft was not acknowledged. Your entered mark is retained.");
      const verified = await verifyObservationAreaBinding(value.binding, scope, active.signal, value.kind === "retraction" ? "retraction" : value.expectedHeadId ? "historical" : "current");
      current(); active.signal.throwIfAborted();
      const committed = await commitObservationAreaDraft(scope, lookup.id, saved.raw, (binding) => { current(source); active!.signal.throwIfAborted(); assertObservationAreaGuardCurrent(verified.guard, binding, scope); });
      raw.current = null;
      if (!mounted.current || !isAccountScopeCurrent(scope)) return;
      draftRef.current = null; setDraft(null); setRecovery(null); setRecovering(false); setEditing(false); setRecords(committed.records);
      showReview({ binding: committed.record.binding, image: verified.image, guard: verified.guard, source });
      setNotice(""); setMessage("Human area record saved on this device. The AI finding and part isolation are unchanged.");
    } catch (error) { fail(error); } finally { if (active) finish(active); }
  }
  async function showHistory(record: ObservationAreaRecord) {
    if (draftRef.current || raw.current !== null) { setMessage("Finish or explicitly discard the unfinished area draft before opening historical evidence."); return; }
    let active: AbortController | null = null;
    try {
      active = begin(); if (!active) return;
      showReview({ binding: record.binding, source, record, historical: true }); setEditing(false);
      const verified = await verifyObservationAreaBinding(record.binding, scope, active.signal, record.kind === "retraction" ? "retraction" : "historical");
      current(); active.signal.throwIfAborted(); showReview({ binding: record.binding, image: verified.image, guard: verified.guard, source, record, historical: true }); setView("outline"); setMessage("Historical observation and photo reference retained. This is not a new AI review.");
    } catch (error) { fail(error); } finally { if (active) finish(active); }
  }
  function download() {
    if (!isAccountScopeCurrent(scope)) return;
    const content = draftRef.current ? JSON.stringify(draftRef.current, null, 2) : recovery?.raw;
    if (content) downloadTextFile("deep-spec-unsaved-observation-area.json", content);
  }
  async function reverify() {
    const selected = reviewRef.current; if (!selected) return;
    let active: AbortController | null = null;
    try {
      active = begin(); if (!active) return;
      const pending = draftRef.current;
      const mode = pending ? pending.kind === "retraction" ? "retraction" : pending.expectedHeadId ? "historical" : "current"
        : selected.historical ? selected.record?.kind === "retraction" ? "retraction" : "historical" : "current";
      const verified = await verifyObservationAreaBinding(selected.binding, scope, active.signal, mode);
      current(); active.signal.throwIfAborted();
      showReview({ ...selected, image: verified.image, guard: verified.guard, source, invalidated: false });
      setMessage("Original reference checked again. Unsaved draft edits and saved history are unchanged.");
    } catch (error) { fail(error); } finally { if (active) finish(active); }
  }
  const visible = review?.source === source && !review.invalidated && isAccountScopeCurrent(scope) ? review : null;
  const currentGroup = visible && loaded ? observationAreaGroups(records).find((group) => group.key === observationAreaBindingKey(visible.binding)) : undefined;
  const selectedRecord = visible?.historical ? records.find((record) => record.id === visible.record?.id) ?? visible.record : currentGroup?.head;
  const selectedStatus = selectedRecord ? observationAreaRecordStatus(selectedRecord, records) : undefined;
  const canChangeSelected = !visible?.historical || currentGroup?.head?.id === selectedRecord?.id;
  const matchesDraft = Boolean(visible && draft && observationAreaBindingKey(visible.binding) === observationAreaBindingKey(draft.binding));
  const humanArea = matchesDraft ? draft?.rectangle : selectedRecord?.kind === "mark" ? selectedRecord.rectangle : null;
  const suggested = visible?.binding.observation.areas?.find((area) => area.photoId === visible.binding.reference.photoId)?.rectangle;
  const formBlocked = disabled || busy || recovering || !ready || !visible;
  if (!isAccountScopeCurrent(scope)) return <p>Sign in to the original account to review its observation areas.</p>;
  return <section ref={panel} aria-label="Observation areas" className="rounded-2xl border border-[var(--ds-border)] p-4 text-sm text-[var(--ds-fg-2)]">
    <h2 className="font-bold">Observation areas</h2>
    <p className="mt-1 text-xs">Select a named observation and cited photo above. AI-suggested and human-marked areas locate a claim; neither confirms condition, function or safety.</p>
    <p className="mt-1 text-xs">Human area history is stored on this device. No cloud backup is claimed.</p>
    {message ? <p role="status" className="mt-3">{message}</p> : null}
    {notice ? <p className="mt-2 text-xs">{notice}</p> : null}
    {review && (!visible || review.invalidated) ? <button className={`${buttonClass} mt-3`} disabled={disabled || busy} onClick={() => void reverify()}>Verify original again</button> : null}
    {recovering ? <div className="mt-3 rounded-xl border border-amber-500/40 p-3"><p>An unfinished area draft is available. It has not been applied to this observation.</p>
      <div className="mt-2 flex flex-wrap gap-2"><button className={buttonClass} disabled={!recovery?.draft || busy || disabled} onClick={() => void restore()}>Restore area draft</button><button className={buttonClass} onClick={download}>Download area recovery</button><button className={buttonClass} disabled={busy || disabled} onClick={() => void discard()}>Discard area draft</button></div>
    </div> : null}
    {visible ? <div className="mt-4">
      <p className="font-semibold">{visible.binding.observation.id}: {visible.binding.observation.text}</p>
      {visible.historical ? <p role="note" className="mt-1 text-xs">Historical human area · {selectedStatus?.replaceAll("_", " ") ?? "history unavailable"}. This view stays on the chosen record; its status reflects the latest device history.</p> : null}
      {!visible.historical && currentGroup?.status === "retracted" ? <p className="mt-1 text-xs">The current human area was retracted. No human outline is displayed.</p> : null}
      {!visible.historical && currentGroup?.status === "conflicting" ? <p className="mt-1 text-xs">Conflicting area corrections are retained below. No current outline was selected.</p> : null}
      <p className="mt-1 text-xs">Photo: {visible.binding.reference.photoId} · {visible.binding.reference.photoLabel.replaceAll("_", " ")} · Added {visible.binding.reference.photoAddedAt}</p>
      {visible.binding.observation.regionLabel ? <p className="mt-1 text-xs">AI textual area: {visible.binding.observation.regionLabel}; text alone does not establish a rectangle.</p> : null}
      <div className="my-3 flex gap-2" role="group" aria-label="Observation photo view">
        <button className={buttonClass} aria-pressed={view === "original"} onClick={() => { setEditing(false); setView("original"); }}>Original</button>
        <button className={buttonClass} aria-pressed={view === "outline"} onClick={() => setView("outline")}>Outline</button>
      </div>
      {visible.image ? <div className="relative w-full overflow-hidden rounded-xl bg-slate-950" style={{ aspectRatio: `${visible.binding.reference.width}/${visible.binding.reference.height}` }}>
        <img src={visible.image} alt={`Original for observation ${visible.binding.observation.id}, photo ${visible.binding.reference.photoId}`} className="block h-full w-full object-contain" />
        {view === "outline" && !editing && suggested ? <div data-testid="observation-ai-area" aria-label="AI-suggested area, unverified" className="pointer-events-none absolute border-2 border-dashed border-amber-400" style={position(suggested)} /> : null}
        {view === "outline" && !editing && humanArea ? <div data-testid="observation-human-area" aria-label="Human-marked area" className="pointer-events-none absolute border-2 border-cyan-300" style={position(humanArea)} /> : null}
        {editing && matchesDraft && draft?.kind === "mark" && !formBlocked ? <FocusAreaEditor key={draft.id} box={draft.rectangle ? { ...draft.rectangle, confidence: 0 } : START_AREA}
          onChange={(box) => { const value = draftRef.current; if (value) keep({ ...value, rectangle: rectangle(box) }); }}
          onCancel={() => setEditing(false)} onApply={(box) => { const value = draftRef.current; if (value) keep({ ...value, rectangle: rectangle(box) }); setEditing(false); }} /> : null}
      </div> : <p className="rounded-xl border border-[var(--ds-border)] p-3">This historical original is unavailable or not verified. No substitute photo or area is displayed.</p>}
      <p className="mt-2 text-xs">{suggested ? "Dashed amber: AI-suggested area—unverified. " : "No AI rectangle is available for this observation/photo. "}{humanArea ? matchesDraft ? "Cyan: unsaved human draft area, not a saved record or confirmation." : visible.historical ? "Cyan: retained historical human area, not the current mark." : "Cyan: human-marked area, not confirmation of the claim." : "No human area is selected."}</p>
      {!draft && !recovering && canChangeSelected && currentGroup?.status !== "conflicting" ? <button className={`${buttonClass} mt-3`} disabled={disabled || busy || !ready || !loaded || !visible.image} onClick={() => void edit(selectedRecord ?? undefined)}> {selectedRecord?.kind === "mark" ? "Correct human area" : selectedRecord ? "Mark area again" : "Mark observation area"}</button> : null}
    </div> : <p className="mt-3">No verified observation photo is open. Select an observation to review its cited original.</p>}
    {draft && !recovering ? <fieldset className="mt-4 space-y-3" disabled={formBlocked}>
      <legend className="font-semibold">{draft.kind === "retraction" ? "Retract human area" : draft.expectedHeadId ? "Correct human area" : "New human area"}</legend>
      <p className="text-xs">Exact retained observation: {draft.binding.observation.text} · Photo {draft.binding.reference.photoId}. Notes are included in reports and may identify people.</p>
      {draft.kind === "mark" ? <button type="button" className={buttonClass} disabled={formBlocked || !visible?.image} onClick={() => { setView("outline"); setEditing(true); }}>Draw or adjust human area</button> : null}
      <label className="block">Area notes (included in reports)<textarea className="mt-1 block min-h-20 w-full rounded border border-[var(--ds-border)] bg-[var(--ds-elevated)] p-2" maxLength={1000} value={draft.notes} onChange={(event) => keep({ ...draft, notes: event.target.value })} /></label>
      {draft.expectedHeadId ? <label className="block">Reason for area correction or retraction<textarea className="mt-1 block min-h-20 w-full rounded border border-[var(--ds-border)] bg-[var(--ds-elevated)] p-2" maxLength={1000} value={draft.correctionReason} onChange={(event) => keep({ ...draft, correctionReason: event.target.value })} /></label> : null}
      <button type="button" className={buttonClass} disabled={formBlocked || (draft.kind === "mark" && !draft.rectangle)} onClick={() => void save()}>Save human area record</button>
    </fieldset> : null}
    {draft && !recovering ? <div className="mt-3 flex flex-wrap gap-2"><button className={buttonClass} onClick={download}>Download entered area draft</button><button className={buttonClass} disabled={busy || disabled} onClick={() => void discard()}>Discard area draft</button></div> : null}
    <h3 className="mt-5 font-semibold">Retained human area history</h3>
    {!loaded ? <p>Device history has not been read successfully.</p> : !records.length ? <p>No human area records saved on this device.</p> : <ol className="mt-2 space-y-3">{records.map((record) => {
      const status = observationAreaRecordStatus(record, records);
      return <li key={record.id} className="rounded-xl border border-[var(--ds-border)] p-3"><p className="font-semibold">{record.kind === "mark" ? "Human area" : "Human area retraction"} · {status.replaceAll("_", " ")}</p><p>{record.binding.observation.text}</p><p className="text-xs">Photo {record.binding.reference.photoId} · Recorded {record.recordedAt}</p>{record.notes ? <p className="mt-1 whitespace-pre-wrap">{record.notes}</p> : null}{record.correctionReason ? <p className="mt-1">Reason: {record.correctionReason}</p> : null}
        <div className="mt-2 flex flex-wrap gap-2"><button className={buttonClass} disabled={disabled || busy} onClick={() => void showHistory(record)}>View retained observation/photo</button>{record.kind === "mark" && status === "current" ? <><button className={buttonClass} disabled={disabled || busy || Boolean(draft) || recovering} onClick={() => void edit(record)}>Correct saved area</button><button className={buttonClass} disabled={disabled || busy || Boolean(draft) || recovering} onClick={() => void edit(record, true)}>Retract saved area</button></> : null}{record.kind === "retraction" && status === "retracted" ? <button className={buttonClass} disabled={disabled || busy || Boolean(draft) || recovering} onClick={() => void edit(record)}>Mark this area again</button> : null}</div>
      </li>;
    })}</ol>}
  </section>;
}
