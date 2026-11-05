import { SCAN_PHOTO_LABELS, type ScanPhoto, type ScanPhotoLabel } from "../../types";
import { PHOTO_LABEL_TEXT } from "../../lib/photoLabels";
import { Link } from "react-router-dom";

export function PhotoGroupReview({ photos, busy, message, componentMapId, savedForComponent, onChange, onAdd, onAnalyze, onClose, onDiscard }: {
  photos: ScanPhoto[]; busy: boolean; message: string | null;
  componentMapId?: string; savedForComponent?: boolean;
  onChange: (photos: ScanPhoto[]) => void; onAdd: () => void; onAnalyze: () => void;
  onClose: () => void; onDiscard: () => void;
}) {
  return <section role="dialog" aria-modal="true" aria-label="Review inspection photos" className="fixed inset-0 z-[75] overflow-y-auto bg-slate-950 p-5 text-white">
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="flex items-center justify-between gap-3"><h2 className="text-xl font-semibold">Photos of one part or area</h2><button type="button" disabled={busy} onClick={onClose} className="rounded border px-3 py-2">Keep draft and close</button></div>
      <p>Start with an overview, then add a close-up, a readable marking and mounting points. Label each view. All photos should show the same part or area of the same car.</p>
      {componentMapId ? <p className="rounded border border-white/20 p-3">These photos belong to one component in your saved overview. <Link to={`/result/${encodeURIComponent(componentMapId)}`} className="underline">Open component map</Link>{savedForComponent ? " The scan is already saved. Resume its link without running AI again." : ""}</p> : null}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">{photos.map((photo, index) => <article key={photo.id} className="rounded-xl border border-white/20 p-3">
        <img src={photo.imageBase64} alt={`Photo ${index + 1}: ${PHOTO_LABEL_TEXT[photo.label]}`} className="h-44 w-full rounded object-contain" />
        <label className="mt-2 block">Photo {index + 1}<select aria-label={`Photo ${index + 1} view`} disabled={busy} value={photo.label} onChange={(event) => onChange(photos.map((item) => item.id === photo.id ? { ...item, label: event.target.value as ScanPhotoLabel } : item))} className="mt-1 block w-full rounded bg-slate-800 p-2">{SCAN_PHOTO_LABELS.map((label) => <option key={label} value={label}>{PHOTO_LABEL_TEXT[label]}</option>)}</select></label>
        {photos.length > 1 ? <button type="button" disabled={busy} onClick={() => onChange(photos.filter((item) => item.id !== photo.id))} className="mt-2 underline">Remove photo {index + 1}</button> : null}
      </article>)}</div>
      {message ? <p role="status" className="rounded border border-white/20 p-3">{message}</p> : null}
      <div className="flex flex-wrap gap-3">
        <button type="button" disabled={busy || photos.length >= 4} onClick={onAdd} className="rounded border px-4 py-3 disabled:opacity-40">Add another angle</button>
        <button type="button" disabled={busy} onClick={onAnalyze} className="rounded bg-white px-4 py-3 font-semibold text-slate-950 disabled:opacity-40">{savedForComponent ? "Finish component link" : `Analyze ${photos.length} ${photos.length === 1 ? "photo" : "photos"}`}</button>
        <button type="button" disabled={busy} onClick={onDiscard} className="rounded border px-4 py-3">Discard draft</button>
      </div>
      <p className="text-sm text-slate-300">Photos are saved on this device before analysis. Component drafts clear after their saved scan is linked to the map. Other upload drafts stay until discarded; capture drafts clear after the inspection is saved on this device. Device settings can remove browser data. Cloud save status is shown separately.</p>
    </div>
  </section>;
}
