import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Lookup, VisualFocusBox } from "../../types";
import type { ComponentMap, ComponentMapComponent, ComponentMapRecord, ComponentMapStatus, ComponentMapScanGroup } from "../../types/componentMap";
import { createMapComponent, mapOverviewSourcesMatch, reviewMapComponent, seedMapFromLookup } from "../../lib/componentMap";
import { getAccountScope, isAccountScopeCurrent, withAccountRouteState } from "../../lib/accountScope";
import { createComponentMap, readComponentMap, subscribeComponentMaps, updateComponentMap } from "../../services/componentMapStore";
import { loadComponentMapFromCloud, readComponentMapLookup, resolveComponentMapCloudConflict, syncComponentMapToCloud } from "../../services/componentMapCloud";
import { isEvidenceImage } from "../../services/visualEvidence";
import { isCloudSyncEnabled } from "../../services/cloudSyncPolicy";
import { getLookup, subscribeToLookupChanges } from "../../services/storage";
import { assertMapOverviewGuardCurrent, resolveMapOverview, type MapOverviewSaveGuard, type MapOverviewVerification } from "../../services/mapOverviewEvidence";
import { FocusAreaEditor } from "./FocusAreaEditor";

const STATUS_TEXT: Record<ComponentMapStatus, string> = { needs_view: "Needs view", inspected: "Inspected", not_visible: "Not visible" };
const BUTTON = "min-h-11 rounded-lg border border-[var(--ds-border)] px-3 py-2 text-sm disabled:opacity-50";
const FIELD = "mt-1 block w-full rounded-lg border border-[var(--ds-border)] bg-[var(--ds-surface)] p-2";
const DEFAULT_BOX: VisualFocusBox = { x: 0.2, y: 0.2, width: 0.3, height: 0.3, confidence: 0 };
const errorText = (error: unknown) => error instanceof Error ? error.message : "The map could not be saved. Your edits remain here.";
const availableImage = (value: unknown): value is string => isEvidenceImage(value)
  && (isCloudSyncEnabled() || value.startsWith("data:"));
type AreaTarget = { mapId: string; revision: number; componentId: string; guard: MapOverviewSaveGuard; image: string; initialBox: VisualFocusBox };

/** A user-maintained index of evidence, separate from AI analysis and safety certification. */
export function ComponentMapReview({ lookup }: { lookup: Lookup }) {
  const navigate = useNavigate();
  const cloudEnabled = isCloudSyncEnabled();
  const [scope] = useState(getAccountScope);
  const [record, setRecord] = useState<ComponentMapRecord | null>(null);
  const [draft, setDraft] = useState<ComponentMap | null>(null);
  const [preservedDraft, setPreservedDraft] = useState<ComponentMap | null>(null);
  const [selectedId, setSelectedId] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [stale, setStale] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [editingArea, setEditingArea] = useState<AreaTarget | null>(null);
  const [verification, setVerification] = useState<{ key: string; value: MapOverviewVerification } | null>(null);
  const [verificationAttempt, setVerificationAttempt] = useState(0);
  const [failedImage, setFailedImage] = useState<string>();
  const [linkErrors, setLinkErrors] = useState<Record<string, string>>({});
  const mounted = useRef(true);
  const generation = useRef(0);
  const writing = useRef(false);
  const saveController = useRef<AbortController | null>(null);
  const requireLocal = useRef({ lookupId: lookup.id, required: Boolean(getLookup(lookup.id)) });
  if (requireLocal.current.lookupId !== lookup.id) requireLocal.current = { lookupId: lookup.id, required: Boolean(getLookup(lookup.id)) };
  const recordRef = useRef(record);
  useEffect(() => { recordRef.current = record; }, [record]);
  const current = () => mounted.current && isAccountScopeCurrent(scope);
  const dirty = Boolean(draft && record && JSON.stringify(draft) !== JSON.stringify(record.document));
  const selected = draft?.components.find((component) => component.id === selectedId);
  const sourcePhotoId = record?.document.overview.photoId ?? lookup.photos?.[0]?.id ?? "photo-1";
  const sourcePhoto = lookup.photos !== undefined ? lookup.photos.find((photo) => photo.id === sourcePhotoId)
    : sourcePhotoId === "photo-1" ? lookup.frame : undefined;
  // A changed prop must hide earlier verified pixels immediately, before effects run.
  const sourceKey = JSON.stringify([lookup.id, lookup.createdAt, lookup.photos?.[0]?.id, sourcePhotoId,
    sourcePhoto?.capturedAt, sourcePhoto?.imageBase64, record?.localRevision, record?.document.version, record?.document.overview.source]);
  const sourceKeyRef = useRef(sourceKey);
  sourceKeyRef.current = sourceKey;
  const evidence = verification?.key === sourceKey ? verification.value : undefined;
  const verificationRef = useRef(evidence);
  verificationRef.current = evidence;
  const image = evidence?.image && evidence.image !== failedImage ? evidence.image : undefined;
  const boundOverview = draft?.version === 3 && evidence?.status === "unchanged" && Boolean(image)
    && draft.id === evidence.guard?.lookupId && draft.overview.photoId === evidence.guard?.photoId
    && mapOverviewSourcesMatch(draft.overview.source, evidence.guard?.source);
  const canSeed = evidence?.status === "unchanged" && Boolean(evidence.source && evidence.guard);
  const editorState = useRef({ lookupId: lookup.id, selectedId, draft, record, editingArea, sourceKey, stale, busy, image, boundOverview });
  editorState.current = { lookupId: lookup.id, selectedId, draft, record, editingArea, sourceKey, stale, busy, image, boundOverview };

  const load = useCallback(async () => {
    const request = ++generation.current;
    const valid = () => mounted.current && request === generation.current && isAccountScopeCurrent(scope);
    setLoading(true);
    setLoadFailed(false);
    try {
      let saved = await readComponentMap(lookup.id, scope);
      let notice: string | null = null;
      if (!saved && isCloudSyncEnabled()) {
        const cloud = await loadComponentMapFromCloud(lookup.id, scope);
        if (!cloud.ok) notice = cloud.message;
        else saved = cloud.value;
      }
      if (!valid()) return;
      setRecord(saved);
      setDraft(saved?.document ?? null);
      setSelectedId(saved?.document.components[0]?.id);
      setStale(false);
      setEditingArea(null);
      setMessage(notice);
    } catch (error) {
      if (valid()) { setLoadFailed(true); setMessage(errorText(error)); }
    } finally {
      if (valid()) setLoading(false);
    }
  }, [lookup.id, scope]);

  useEffect(() => {
    mounted.current = true;
    void load();
    const unsubscribe = subscribeComponentMaps((mapId) => {
      if (mapId !== lookup.id || writing.current || !recordRef.current) return;
      void readComponentMap(mapId, scope).then((saved) => {
        if (!mounted.current || !isAccountScopeCurrent(scope) || writing.current) return;
        if (saved?.localRevision !== recordRef.current?.localRevision) {
          setStale(true);
          setEditingArea(null);
          setMessage("This map changed elsewhere. Your draft is still here. Load the saved version before saving again.");
        }
      }).catch((error: unknown) => { if (mounted.current && isAccountScopeCurrent(scope)) setMessage(errorText(error)); });
    }, scope);
    return () => { mounted.current = false; generation.current += 1; saveController.current?.abort(); unsubscribe(); };
  }, [load, lookup.id, scope]);

  useEffect(() => {
    if (loading || loadFailed) return;
    const controller = new AbortController();
    setVerification(null);
    setEditingArea(null);
    void resolveMapOverview(lookup, record?.document, scope, controller.signal, requireLocal.current.required).then((value) => {
      if (controller.signal.aborted || !mounted.current || !isAccountScopeCurrent(scope) || sourceKeyRef.current !== sourceKey) return;
      if (value.guard && value.guard.deviceSignature !== "absent") requireLocal.current.required = true;
      setVerification({ key: sourceKey, value });
    });
    return () => { controller.abort(); };
  }, [lookup, record, scope, sourceKey, loading, loadFailed, verificationAttempt]);

  useEffect(() => {
    return () => { saveController.current?.abort(); };
  }, [sourceKey]);

  useEffect(() => subscribeToLookupChanges(() => {
    if (!mounted.current || !isAccountScopeCurrent(scope)) return;
    const verified = verificationRef.current;
    if (verified?.guard && recordRef.current) {
      try { assertMapOverviewGuardCurrent(verified.guard, recordRef.current.document, scope); return; }
      catch { /* Keep the draft, but stop using its now-unverified geometry. */ }
    }
    saveController.current?.abort();
    setEditingArea(null);
    setVerification(null);
    setVerificationAttempt((attempt) => attempt + 1);
  }), [scope]);

  function accept(saved: ComponentMapRecord) {
    recordRef.current = saved;
    setRecord(saved);
    setDraft(saved.document);
    setSelectedId((id) => saved.document.components.some((component) => component.id === id) ? id : saved.document.components[0]?.id);
    setStale(false);
    setEditingArea(null);
  }

  async function save(create = false) {
    if (!current() || busy || writing.current || stale || (!create && (!record || !draft))) return;
    writing.current = true;
    setBusy(true);
    setEditingArea(null);
    const controller = new AbortController();
    saveController.current = controller;
    const saveGeneration = generation.current;
    try {
      let document = draft;
      let guard: MapOverviewSaveGuard | undefined;
      if (create || document?.version === 3) {
        const checked = await resolveMapOverview(lookup, create ? undefined : document!, scope, controller.signal, requireLocal.current.required);
        if (!current()) return;
        if (controller.signal.aborted || sourceKeyRef.current !== sourceKey) throw new Error("The overview changed while saving. Your draft is retained; check the saved original before retrying.");
        if (checked.status !== "unchanged" || !checked.source || !checked.guard) {
          setVerification({ key: sourceKey, value: checked });
          throw new Error(checked.message);
        }
        guard = checked.guard;
        if (guard.deviceSignature !== "absent") requireLocal.current.required = true;
        if (create) document = seedMapFromLookup(lookup, checked.source);
      }
      const saved = create
        ? await createComponentMap(document!, scope, guard)
        : await updateComponentMap(lookup.id, record!.localRevision, document!, scope, guard);
      if (!current() || saveGeneration !== generation.current || editorState.current.lookupId !== lookup.id) return;
      let notice = "Map saved on this device.";
      if (guard) {
        try {
          if (controller.signal.aborted || sourceKeyRef.current !== sourceKey) throw new Error();
          assertMapOverviewGuardCurrent(guard, saved.document, scope);
        } catch { notice = "Map saved with its original source binding, but the overview changed during completion. Recheck the source before using its areas. Your saved notes are retained."; }
      }
      accept(saved);
      setMessage(notice);
    } catch (error) {
      if (!current() || saveGeneration !== generation.current || editorState.current.lookupId !== lookup.id) return;
      if (typeof error === "object" && error !== null && "code" in error && error.code === "stale_revision") setStale(true);
      setMessage(errorText(error));
    } finally { if (saveController.current === controller) saveController.current = null; writing.current = false; if (current()) setBusy(false); }
  }

  async function cloudAction(choice?: "local" | "cloud") {
    if (!isCloudSyncEnabled() || !record || !draft || !current() || busy || dirty || stale) return;
    writing.current = true;
    setBusy(true);
    const previous = draft;
    const cloudGeneration = generation.current;
    const valid = () => current() && cloudGeneration === generation.current && editorState.current.lookupId === lookup.id;
    try {
      const result = choice
        ? await resolveComponentMapCloudConflict(lookup.id, record.localRevision, choice, scope)
        : await syncComponentMapToCloud(lookup.id, record.localRevision, scope);
      if (!valid()) return;
      const saved = result.ok && result.value ? result.value : await readComponentMap(lookup.id, scope);
      if (!valid()) return;
      if (saved) {
        // A conflicting device write is never silently adopted into the editor.
        if (!result.ok && JSON.stringify(saved.document) !== JSON.stringify(previous)) {
          setStale(true);
        } else {
          if (choice === "cloud" && result.ok) setPreservedDraft(previous);
          accept(saved);
        }
      }
      setMessage(result.message);
    } catch (error) { if (valid()) setMessage(errorText(error)); }
    finally { writing.current = false; if (current()) setBusy(false); }
  }

  function changeComponent(update: (component: ComponentMapComponent) => ComponentMapComponent) {
    if (!selected || !current()) return;
    setDraft((previous) => previous ? { ...previous, components: previous.components.map((component) => component.id === selected.id ? update(component) : component) } : previous);
    setMessage(null);
  }

  function addComponent() {
    if (!draft || draft.components.length >= 100 || !current()) return;
    const component = createMapComponent("New component");
    setDraft({ ...draft, components: [...draft.components, component] });
    setSelectedId(component.id);
    setEditingArea(null);
  }

  function startArea() {
    if (!current() || busy || stale || !record || !draft || !selected || !boundOverview || !evidence?.guard || !image) return;
    try {
      assertMapOverviewGuardCurrent(evidence.guard, draft, scope);
      setEditingArea({ mapId: draft.id, revision: record.localRevision, componentId: selected.id, guard: evidence.guard,
        image, initialBox: selected.region?.box ?? DEFAULT_BOX });
    } catch (error) { setVerification(null); setMessage(errorText(error)); setVerificationAttempt((attempt) => attempt + 1); }
  }

  function applyArea(box: VisualFocusBox) {
    const target = editingArea;
    const latest = editorState.current;
    if (!target || target !== latest.editingArea) return;
    editorState.current = { ...latest, editingArea: null };
    setEditingArea(null);
    if (!current() || latest.busy || latest.stale || !latest.draft || !latest.record) return;
    try {
      if (!latest.boundOverview || latest.image !== target.image || latest.draft.id !== target.mapId || latest.record.localRevision !== target.revision
        || latest.selectedId !== target.componentId || latest.draft.components.find((component) => component.id === target.componentId)?.status === "not_visible") throw new Error("The area target changed. Your notes are retained; reopen the area editor after checking the original.");
      assertMapOverviewGuardCurrent(target.guard, latest.draft, scope);
      setDraft((previous) => previous === latest.draft ? { ...previous, components: previous.components.map((component) => component.id === target.componentId
        ? { ...component, region: { sourcePhotoId: previous.overview.photoId, box } } : component) } : previous);
    } catch (error) { setVerification(null); setMessage(errorText(error)); setVerificationAttempt((attempt) => attempt + 1); }
  }

  function captureComponent() {
    if (!record || !selected || dirty || stale || busy || !current()) return;
    navigate("/scan", { state: withAccountRouteState({
      componentCaptureTarget: { mapId: record.document.id, componentId: selected.id, linkAttemptId: crypto.randomUUID(), lookupId: crypto.randomUUID() },
      componentLabel: selected.label,
      ...(lookup.vehicleContext ? { vehicleContext: lookup.vehicleContext } : {}),
    }) });
  }

  async function openGroup(group: ComponentMapScanGroup) {
    if (!current() || busy || dirty || stale) return;
    setBusy(true);
    const groupGeneration = generation.current;
    const valid = () => current() && groupGeneration === generation.current && editorState.current.lookupId === lookup.id;
    try {
      const loaded = isCloudSyncEnabled()
        ? await readComponentMapLookup(group.lookupId, scope)
        : { ok: true as const, value: getLookup(group.lookupId) };
      if (!valid()) return;
      const target = loaded.ok ? loaded.value : null;
      const ids = target?.photos?.filter((photo) => availableImage(photo.imageBase64)).map((photo) => photo.id)
        ?? (target && availableImage(target.frame.imageBase64) ? ["photo-1"] : []);
      if (!target || group.photoIds.some((id) => !ids.includes(id))) {
        setLinkErrors((previous) => ({ ...previous, [group.linkId]: loaded.ok ? "Linked scan or photos unavailable. The map link has been kept." : loaded.message }));
        return;
      }
      navigate(`/result/${encodeURIComponent(group.lookupId)}`, { state: withAccountRouteState({ savedLookup: target }) });
    } catch (error) {
      if (valid()) setLinkErrors((previous) => ({ ...previous, [group.linkId]: errorText(error) }));
    } finally { if (current()) setBusy(false); }
  }

  return <section aria-label="Component map" className="rounded-2xl border border-[var(--ds-border)] bg-[var(--ds-elevated)] p-4 text-sm text-[var(--ds-fg-2)]">
    <h2 className="font-bold">Component map</h2>
    {!cloudEnabled ? <p className="mt-2 text-sm">Cloud sync is off. Map edits and available photo groups stay on this device.</p> : null}
    <p className="mt-1 text-xs text-[var(--ds-fg-3)]">Organize component photos and your review. Suggested labels and areas can be wrong. Suggestions may repeat the same part when their identity is uncertain; check each against the overview. Inspected is your recorded status, not a statement that a part is safe or working. This is not a complete engine inspection.</p>
    {message ? <p role="status" className="mt-3 rounded-lg border p-2">{message}</p> : null}
    {!loading && !loadFailed ? <div className="mt-3 rounded-lg border p-2" aria-label="Overview source verification">
      <p>{evidence?.message ?? "Checking the saved original overview…"}</p>
      {evidence && evidence.status !== "unchanged" ? <button type="button" className={`${BUTTON} mt-2`} disabled={busy} onClick={() => { setFailedImage(undefined); setVerificationAttempt((attempt) => attempt + 1); }}>Recheck overview source</button> : null}
      {draft ? <p className="mt-1 text-xs">Linked photo groups are associated by scan and photo IDs. Their file contents are not bound by this overview check.</p> : null}
    </div> : null}
    {loading ? <p className="mt-3">Loading component map…</p> : !draft ? <div className="mt-3">
      <p>{loadFailed ? "The saved component map could not be loaded." : "No component map is saved on this device."}</p>
      {loadFailed ? <button type="button" className={BUTTON} onClick={() => void load()}>Retry loading map</button>
        : <button type="button" disabled={busy || !canSeed} className={`${BUTTON} mt-2`} onClick={() => void save(true)}>Create component map</button>}
      {evidence && !canSeed ? <p className="mt-2">A verified saved original is required to create this map.</p> : null}
    </div> : <>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className={BUTTON} disabled={busy || !dirty || stale} onClick={() => void save()}>Save changes</button>
        <button type="button" className={BUTTON} disabled={!cloudEnabled || busy || dirty || stale || Boolean(record?.conflict)} onClick={() => void cloudAction()}>Save map to cloud</button>
        <button type="button" className={BUTTON} disabled={busy || draft.components.length >= 100} onClick={addComponent}>Add component</button>
      </div>
      <p className="mt-2 text-xs">{dirty ? "Unsaved map changes." : record && record.syncedLocalRevision === record.localRevision ? cloudEnabled ? "This map version is saved to cloud." : "This map version was previously saved to cloud." : "Map saved on this device; cloud save is separate."} {draft.components.length}/100 components.</p>
      {stale ? <button type="button" className={`${BUTTON} mt-2`} disabled={busy} onClick={() => { setPreservedDraft(draft); void load(); }}>Load saved map and keep draft</button> : null}
      {preservedDraft ? <details className="mt-3 rounded-lg border p-2">
        <summary>Preserved draft</summary>
        <MapVersionPreview document={preservedDraft} />
        <button type="button" className={`${BUTTON} mt-2`} disabled={busy || stale} onClick={() => { setPreservedDraft(draft); setDraft(preservedDraft); setEditingArea(null); }}>Restore preserved draft for editing</button>
      </details> : null}
      {record?.conflict ? <div className="mt-3 rounded-lg border border-[var(--ds-warn-line)] p-3">
        <h3 className="font-semibold">Cloud map differs</h3>
        <p className="mt-1 text-xs">Both versions are retained. Review them before choosing; choosing does not upload again.</p>
        <details className="mt-2"><summary>Review cloud version</summary><MapVersionPreview document={record.conflict.document} /></details>
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" className={BUTTON} disabled={!cloudEnabled || busy || dirty || stale} onClick={() => void cloudAction("local")}>Keep device version</button>
          <button type="button" className={BUTTON} disabled={!cloudEnabled || busy || dirty || stale} onClick={() => void cloudAction("cloud")}>Use cloud version</button>
        </div>
      </div> : null}
      {image ? <div className="relative mt-4 overflow-hidden rounded-xl bg-black" aria-label={boundOverview ? "Original overview with component areas" : "Unannotated original overview"}>
        <img className="block h-auto w-full" src={image} alt="Original component overview" onError={() => { setFailedImage(image); setEditingArea(null); }} />
        {boundOverview && !editingArea ? draft.components.map((component, index) => component.status !== "not_visible" && component.region?.sourcePhotoId === draft.overview.photoId ? <button
          key={component.id} type="button" aria-label={`Select component ${index + 1}: ${component.label}`} aria-pressed={selectedId === component.id}
          className="absolute border-2 border-cyan-300 bg-cyan-300/10 text-white" style={{ left: `${component.region.box.x * 100}%`, top: `${component.region.box.y * 100}%`, width: `${component.region.box.width * 100}%`, height: `${component.region.box.height * 100}%` }}
          onClick={() => { setSelectedId(component.id); setEditingArea(null); }}><span className="absolute left-0 top-0 rounded bg-slate-950 px-2 py-1 font-bold">{index + 1}</span></button> : null) : null}
        {boundOverview && !stale && !busy && editingArea && editingArea.image === image && editingArea.componentId === selectedId ? <FocusAreaEditor
          key={`${editingArea.componentId}:${editingArea.revision}:${editingArea.guard.source.sha256}`} box={editingArea.initialBox}
          onCancel={() => setEditingArea(null)} onApply={applyArea} /> : null}
      </div> : <p className="mt-4 rounded-lg border p-3">Original overview unavailable. Component records and links are retained.</p>}
      <ol className="mt-3 max-h-64 space-y-1 overflow-y-auto" aria-label="Mapped components">
        {draft.components.map((component, index) => <li key={component.id}><button type="button" aria-pressed={selectedId === component.id} className={`${BUTTON} w-full text-left aria-pressed:bg-[var(--ds-surface)]`} onClick={() => { setSelectedId(component.id); setEditingArea(null); }}>
          {index + 1}. {component.label} — {STATUS_TEXT[component.status]}{component.region ? "" : " · No overview area"}
          {component.suggestedLocation ? <span className="mt-1 block text-xs">AI-suggested location — unverified: {component.suggestedLocation.text}</span> : null}
        </button></li>)}
      </ol>
      {!draft.components.length ? <p className="mt-2">Add a component to start your review.</p> : null}
      {selected ? <fieldset disabled={busy} className="mt-4 space-y-3 rounded-xl border border-[var(--ds-border)] p-3">
        <legend className="px-1 font-semibold">Selected component</legend>
        <label className="block">Component label<input className={FIELD} maxLength={120} value={selected.label} onChange={(event) => changeComponent((component) => ({ ...component, label: event.target.value }))} /></label>
        {selected.suggestedLocation ? <div className="rounded-lg border border-[var(--ds-border)] p-2 text-xs" aria-label="AI-suggested location">
          <p className="font-semibold">AI-suggested location — unverified</p>
          <p className="mt-1">{selected.suggestedLocation.text}</p>
          <p className="mt-1 text-[var(--ds-fg-3)]">This text came from the scan. It does not establish an outline or confirm the component's identity. Your notes and marked area are separate.</p>
        </div> : null}
        <label className="block">Your review status<select className={FIELD} value={selected.status} onChange={(event) => { const status = event.target.value as ComponentMapStatus; changeComponent((component) => reviewMapComponent(component, status)); setEditingArea(null); }}>
          <option value="needs_view">Needs view</option><option value="inspected">Inspected</option><option value="not_visible">Not visible</option>
        </select></label>
        <p className="text-xs text-[var(--ds-fg-3)]">{selected.reviewedAt ? `User review recorded: ${new Date(selected.reviewedAt).toLocaleString()}` : "No human review recorded. Suggestions from the scan are not an inspection."}</p>
        <label className="block">Component notes<textarea className={FIELD} maxLength={2000} rows={3} value={selected.notes} onChange={(event) => changeComponent((component) => ({ ...component, notes: event.target.value }))} /></label>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={BUTTON} disabled={!boundOverview || stale || Boolean(editingArea) || selected.status === "not_visible"} onClick={startArea}>{selected.region ? "Adjust map area" : "Mark map area"}</button>
          {selected.region ? <button type="button" className={BUTTON} onClick={() => { changeComponent((component) => { const updated = { ...component }; delete updated.region; return updated; }); setEditingArea(null); }}>Remove map area</button> : null}
          <button type="button" className={BUTTON} disabled={dirty || stale} onClick={captureComponent}>Take component photos</button>
        </div>
        {selected.status === "not_visible" ? <p className="text-xs">The overview marker is hidden while this component is marked Not visible.</p> : null}
        {dirty ? <p className="text-xs">Save changes before taking or opening component photos.</p> : null}
        <h3 className="font-semibold">Linked photo groups</h3>
        {selected.scanGroups.length ? <ul className="space-y-2">{selected.scanGroups.map((group, index) => <li key={group.linkId}>
          <button type="button" className={BUTTON} disabled={dirty || stale} onClick={() => void openGroup(group)}>Open photo group {index + 1} ({group.photoIds.length} photos)</button>
          {linkErrors[group.linkId] ? <p role="status" className="mt-1 text-xs">{linkErrors[group.linkId]}</p> : null}
        </li>)}</ul> : <p>No component photos linked yet.</p>}
      </fieldset> : null}
    </>}
  </section>;
}

function MapVersionPreview({ document }: { document: ComponentMap }) {
  return <ol className="mt-2 max-h-48 space-y-2 overflow-auto text-xs">{document.components.map((component, index) => <li key={component.id}>
    <p className="font-semibold">{index + 1}. {component.label} — {STATUS_TEXT[component.status]}</p>
    {component.suggestedLocation ? <p>AI-suggested location — unverified: {component.suggestedLocation.text}</p> : null}
    <p>{component.notes || "No notes."}</p>
    <p>{component.region ? component.status === "not_visible" ? "Previous overview area retained; marker hidden." : "Overview area marked." : "No overview area."} {component.scanGroups.length} linked photo groups.</p>
  </li>)}</ol>;
}
