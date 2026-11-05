import { SCAN_PHOTO_LABELS, type PhotoRelationship, type ScanPhoto, type ScanPhotoLabel, type ShopVehicleContext } from "../../types";
import { photoRelationshipDescription, photoRelationshipOrUnknown } from "../../lib/photoRelationship";
import { vehicleContextDetails } from "../../lib/vehicleContext";
import { PHOTO_LABEL_TEXT } from "../../lib/photoLabels";
import { Link } from "react-router-dom";
import type { ReactNode } from "react";

export function PhotoGroupReview({ photos, photoRelationship, busy, message, componentMapId, savedForComponent, vehicleContext, referenceNode, savedActionLabel, onChange, onRelationshipChange, onAdd, onAnalyze, onClose, onDiscard }: {
  photos: ScanPhoto[]; busy: boolean; message: string | null;
  photoRelationship?: PhotoRelationship;
  componentMapId?: string; savedForComponent?: boolean;
  vehicleContext?: ShopVehicleContext | null;
  referenceNode?: ReactNode; savedActionLabel?: string;
  onChange: (photos: ScanPhoto[]) => void; onAdd: () => void; onAnalyze: () => void;
  onRelationshipChange: (relationship: PhotoRelationship) => void;
  onClose: () => void; onDiscard: () => void;
}) {
  return <section role="dialog" aria-modal="true" aria-label="Review inspection photos" className="fixed inset-0 z-[75] overflow-y-auto bg-slate-950 p-5 text-white">
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="flex items-center justify-between gap-3"><h2 className="text-xl font-semibold">Inspection photos</h2><button type="button" disabled={busy} onClick={onClose} className="rounded border px-3 py-2">Keep draft and close</button></div>
      <p>For several views of one part, start with an overview, then add a close-up, a readable marking and mounting points. Label each photo and state whether the photos belong together.</p>
      {photos.length > 1 ? <fieldset className="rounded border border-white/20 p-3">
        <legend className="px-1 font-semibold">How are these photos related?</legend>
        <select aria-label="Photo relationship" value={photoRelationshipOrUnknown(photoRelationship)} disabled={busy || savedForComponent || Boolean(savedActionLabel)} onChange={(event) => onRelationshipChange(event.target.value as PhotoRelationship)} className="mt-1 block w-full rounded bg-slate-800 p-2">
          <option value="unknown">Not sure / not stated</option>
          <option value="same_part_or_area">Same part or area of one car</option>
          <option value="independent">Independent examples</option>
        </select>
        <p className="mt-2 text-sm text-slate-300">{photoRelationshipDescription(photoRelationship)}</p>
        {photoRelationshipOrUnknown(photoRelationship) !== "same_part_or_area" ? <p className="mt-2 text-sm text-slate-300">The main identification, selected area and supplied car details or complaint apply to Photo 1. Other photos are separate evidence.</p> : null}
      </fieldset> : null}
      {referenceNode}
      {componentMapId ? <p className="rounded border border-white/20 p-3">This scan is linked to a component in your saved overview. The photo relationship is recorded separately. <Link to={`/result/${encodeURIComponent(componentMapId)}`} className="underline">Open component map</Link>{savedForComponent ? " The scan is already saved. Resume its link without running AI again." : ""}</p> : null}
      {vehicleContext ? <details className="rounded border border-white/20 p-3"><summary className="cursor-pointer font-semibold">{photos.length > 1 && photoRelationshipOrUnknown(photoRelationship) !== "same_part_or_area" ? "Car details for Photo 1" : "Car details saved with these photos"}</summary><dl className="mt-2 space-y-2">{vehicleContextDetails(vehicleContext).map(([label, value]) => <div key={label}><dt className="font-semibold">{label}</dt><dd>{value}</dd></div>)}</dl></details> : <p className="text-sm text-slate-300">{vehicleContext === undefined && componentMapId ? "These older component photos use the saved overview's vehicle details." : "No vehicle details were saved with these photos. Analysis can describe visible features; vehicle-specific details need confirmation."}</p>}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">{photos.map((photo, index) => <article key={photo.id} className="rounded-xl border border-white/20 p-3">
        <img src={photo.imageBase64} alt={`Photo ${index + 1}: ${PHOTO_LABEL_TEXT[photo.label]}`} className="h-44 w-full rounded object-contain" />
        <label className="mt-2 block">Photo {index + 1}<select aria-label={`Photo ${index + 1} view`} disabled={busy} value={photo.label} onChange={(event) => onChange(photos.map((item) => item.id === photo.id ? { ...item, label: event.target.value as ScanPhotoLabel } : item))} className="mt-1 block w-full rounded bg-slate-800 p-2">{SCAN_PHOTO_LABELS.map((label) => <option key={label} value={label}>{PHOTO_LABEL_TEXT[label]}</option>)}</select></label>
        {photos.length > 1 ? <button type="button" disabled={busy} onClick={() => onChange(photos.filter((item) => item.id !== photo.id))} className="mt-2 underline">Remove photo {index + 1}</button> : null}
      </article>)}</div>
      {message ? <p role="status" className="rounded border border-white/20 p-3">{message}</p> : null}
      <div className="flex flex-wrap gap-3">
        <button type="button" disabled={busy || photos.length >= 4} onClick={onAdd} className="rounded border px-4 py-3 disabled:opacity-40">Add another photo</button>
        <button type="button" disabled={busy} onClick={onAnalyze} className="rounded bg-white px-4 py-3 font-semibold text-slate-950 disabled:opacity-40">{savedActionLabel ?? (savedForComponent ? "Finish component link" : `Analyze ${photos.length} ${photos.length === 1 ? "photo" : "photos"}`)}</button>
        <button type="button" disabled={busy} onClick={onDiscard} className="rounded border px-4 py-3">Discard draft</button>
      </div>
      <p className="text-sm text-slate-300">Photos are saved on this device before analysis. Component and comparison drafts clear after their saved scan and links are complete. Other upload drafts stay until discarded; capture drafts clear after the inspection is saved on this device. Device settings can remove browser data. Cloud save status is shown separately.</p>
    </div>
  </section>;
}
