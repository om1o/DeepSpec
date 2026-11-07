import { useLayoutEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getAccountScope, isAccountScopeCurrent, withAccountRouteState } from "../../lib/accountScope";
import { buildConditionHandoff } from "../../lib/conditionHandoff";
import { prepareRequestedEvidenceCapture, requestedEvidenceGuideForLookup } from "../../services/requestedEvidenceCapture";
import type { Lookup } from "../../types";

const buttonClass = "min-h-11 rounded-xl border border-[var(--ds-border)] px-4 py-2 text-sm font-bold disabled:opacity-50";

function captureSource(lookup: Lookup) {
  return { id: lookup.id, createdAt: lookup.createdAt, attemptId: lookup.analysisAttemptId,
    frame: { ...lookup.frame }, photos: lookup.photos?.map((photo) => ({ ...photo })),
    result: JSON.stringify(lookup.result), vehicle: JSON.stringify(lookup.vehicleContext), relationship: lookup.photoRelationship };
}
type CaptureSource = ReturnType<typeof captureSource>;
type CaptureForm = { source: CaptureSource; opened: boolean; selected: string; busy: boolean; message: string; signal?: AbortSignal };
function sameSource(a: CaptureSource, b: CaptureSource) {
  return a.id === b.id && a.createdAt === b.createdAt && a.attemptId === b.attemptId && a.result === b.result
    && a.vehicle === b.vehicle && a.relationship === b.relationship
    && a.frame.imageBase64 === b.frame.imageBase64 && a.frame.capturedAt === b.frame.capturedAt
    && (a.photos === undefined) === (b.photos === undefined) && a.photos?.length === b.photos?.length
    && (a.photos ?? []).every((photo, index) => {
      const other = b.photos?.[index];
      return other?.id === photo.id && other.label === photo.label && other.capturedAt === photo.capturedAt && other.imageBase64 === photo.imageBase64;
    });
}

/** A new capture starts only after an explicit choice and verification of saved source pixels. */
export function RequestedEvidenceCapture({ lookup, disabled = false, onSelectPhoto }: {
  lookup: Lookup; disabled?: boolean; onSelectPhoto: (photoId: string) => void;
}) {
  const guide = requestedEvidenceGuideForLookup(lookup);
  const photos = buildConditionHandoff(lookup).photos;
  if (!guide || !photos.length) return null;
  return <CaptureChoice key={lookup.id} lookup={lookup} guide={guide} photos={photos} disabled={disabled} onSelectPhoto={onSelectPhoto} />;
}

function CaptureChoice({ lookup, guide, photos, disabled, onSelectPhoto }: {
  lookup: Lookup;
  guide: NonNullable<ReturnType<typeof requestedEvidenceGuideForLookup>>;
  photos: { id: string; label: string }[];
  disabled: boolean;
  onSelectPhoto: (photoId: string) => void;
}) {
  const navigate = useNavigate();
  const [scope] = useState(getAccountScope);
  const choices = guide.photoIds.length ? photos.filter((photo) => guide.photoIds.includes(photo.id)) : photos;
  const initialSelection = guide.photoIds.length === 1 ? guide.photoIds[0] : "";
  const source = captureSource(lookup);
  const [form, setForm] = useState<CaptureForm>(() => ({ source, opened: false, selected: initialSelection, busy: false, message: "" }));
  const active = sameSource(form.source, source);
  const opened = active && form.opened;
  const selected = active ? form.selected : initialSelection;
  const busy = active && form.busy && !form.signal?.aborted;
  const message = active ? form.message : "";
  const mounted = useRef(true);
  const pending = useRef<{ controller: AbortController; source: CaptureSource } | null>(null);
  const latest = useRef({ source, disabled });
  useLayoutEffect(() => {
    latest.current = { source, disabled };
    if (pending.current && (disabled || !sameSource(pending.current.source, source))) {
      pending.current.controller.abort(); pending.current = null;
    }
  });
  useLayoutEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; pending.current?.controller.abort(); };
  }, []);
  const current = () => mounted.current && isAccountScopeCurrent(scope) && !latest.current.disabled && sameSource(source, latest.current.source);

  function cancel() {
    pending.current?.controller.abort(); pending.current = null;
    setForm({ source, opened: false, selected: initialSelection, busy: false, message: "" });
  }
  async function start() {
    if (!current() || pending.current || !choices.some((photo) => photo.id === selected)) return;
    const controller = new AbortController(); pending.current = { controller, source };
    setForm({ source, opened: true, selected, busy: true, message: "", signal: controller.signal });
    try {
      const target = await prepareRequestedEvidenceCapture(lookup, guide, selected, scope, controller.signal);
      if (!current() || controller.signal.aborted || pending.current?.controller !== controller) return;
      navigate("/scan", { state: withAccountRouteState({ comparisonCaptureTarget: target }) });
    } catch (error) {
      if (current() && !controller.signal.aborted && pending.current?.controller === controller) {
        setForm((prior) => ({ ...prior, message: error instanceof Error ? error.message : "The saved source image could not be verified. No capture started; reopen the saved scan and retry." }));
      }
    } finally {
      if (mounted.current && pending.current?.controller === controller) {
        pending.current = null;
        setForm((prior) => ({ ...prior, busy: false }));
      }
    }
  }
  if (!isAccountScopeCurrent(scope)) return null;
  return <div className="mt-3 space-y-2">
    {!opened ? <button type="button" className={buttonClass} disabled={disabled} onClick={() => { if (current()) setForm({ source, opened: true, selected: initialSelection, busy: false, message: "" }); }}>Collect requested {guide.kind === "marking" ? "marking photo" : "photo"}</button> : <div role="group" aria-label="Choose source for requested photo" className="space-y-3 rounded-xl border border-[var(--ds-border)] p-3">
      <p className="text-sm">Choose the earlier photo to keep beside your new photos.</p>
      <p className="text-xs">{guide.photoIds.length ? "The request cites these photos." : "The request did not cite a photo. Choose the relevant earlier photo."}</p>
      <fieldset disabled={busy || disabled} className="space-y-2">
        <legend className="font-semibold">Source image</legend>
        {choices.map((photo) => <label key={photo.id} className="flex min-h-11 cursor-pointer items-center gap-2"><input type="radio" name={`requested-source-${lookup.id}`} value={photo.id} checked={selected === photo.id} onChange={() => setForm((prior) => ({ ...prior, selected: photo.id, message: "" }))} />{photo.label}</label>)}
      </fieldset>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={buttonClass} disabled={!selected || busy || disabled} onClick={() => { if (current() && selected) onSelectPhoto(selected); }}>View selected source image</button>
        <button type="button" className={buttonClass} disabled={!selected || busy || disabled} onClick={() => void start()}>{busy ? "Checking saved source…" : "Start requested photo capture"}</button>
        <button type="button" className={buttonClass} onClick={cancel}>Cancel requested capture</button>
      </div>
      {message ? <p role="status" className="text-sm font-semibold">{message}</p> : null}
    </div>}
    {disabled ? <p className="text-xs">Save this scan on this device and finish any pending retry or save before collecting requested evidence.</p> : null}
    <p className="text-xs">Taking a photo does not resolve the finding or replace the safety action. AI runs only when you explicitly choose Analyze in the scanner.</p>
  </div>;
}
