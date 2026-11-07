import type { PhotoRelationship, ScanPhoto } from "../../types";
import { PHOTO_LABEL_TEXT } from "../../lib/photoLabels";
import { photoRelationshipDescription, photoRelationshipOrUnknown, photoRelationshipScopeDescription } from "../../lib/photoRelationship";

export function PhotoEvidenceStrip({ photos, photoRelationship, pipelineVersion, selectedId, onSelect }: { photos?: ScanPhoto[]; photoRelationship?: PhotoRelationship; pipelineVersion?: string | null; selectedId?: string; onSelect: (id: string) => void }) {
  if (!photos?.length) return null;
  const relationship = photoRelationshipOrUnknown(photoRelationship);
  const scope = photoRelationshipScopeDescription(relationship, pipelineVersion);
  return <nav aria-label="Inspection photos" className="relative z-10 flex shrink-0 flex-col gap-2 border-y border-white/15 bg-slate-950 p-2 text-white">
    <div className="flex gap-2 overflow-x-auto">
      {photos.map((photo, index) => <button type="button" key={photo.id} aria-pressed={selectedId === photo.id || (!selectedId && index === 0)} onClick={() => onSelect(photo.id)} className="min-w-28 rounded-lg border border-white/25 p-2 text-left text-xs aria-pressed:border-white aria-pressed:bg-slate-700">
        <img src={photo.imageBase64} alt="" className="mb-1 h-12 w-full rounded object-contain" />
        {index + 1}. {PHOTO_LABEL_TEXT[photo.label]}
      </button>)}
    </div>
    {photos.length > 1 ? <div className="text-xs leading-relaxed text-slate-200" aria-label="Photo relationship">
      <p><strong>{relationship === "unknown" ? "Photo relationship:" : "User-reported photo relationship:"}</strong> {photoRelationshipDescription(relationship)}</p>
      {scope ? <p>{scope}</p> : null}
    </div> : null}
  </nav>;
}
