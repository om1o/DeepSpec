import type { ScanPhoto } from "../../types";
import { PHOTO_LABEL_TEXT } from "../../lib/photoLabels";

export function PhotoEvidenceStrip({ photos, selectedId, onSelect }: { photos?: ScanPhoto[]; selectedId?: string; onSelect: (id: string) => void }) {
  if (!photos?.length) return null;
  return <nav aria-label="Inspection photos" className="relative z-10 flex shrink-0 gap-2 overflow-x-auto border-y border-white/15 bg-slate-950 p-2 text-white">
    {photos.map((photo, index) => <button type="button" key={photo.id} aria-pressed={selectedId === photo.id || (!selectedId && index === 0)} onClick={() => onSelect(photo.id)} className="min-w-28 rounded-lg border border-white/25 p-2 text-left text-xs aria-pressed:border-white aria-pressed:bg-slate-700">
      <img src={photo.imageBase64} alt="" className="mb-1 h-12 w-full rounded object-contain" />
      {index + 1}. {PHOTO_LABEL_TEXT[photo.label]}
    </button>)}
  </nav>;
}
