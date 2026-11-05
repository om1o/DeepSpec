import type { ScanAnalysisState } from "../../types";
import { buildPhotoReviewState, photoReviewStatusLabel } from "../../lib/photoReview";
import { PHOTO_LABEL_TEXT } from "../../lib/photoLabels";
import { isEvidenceImage, normalizeVisualEvidence } from "../../services/visualEvidence";

export function PhotoReviewPanel({ scan, onSelectPhoto }: {
  scan: Pick<ScanAnalysisState, "frame" | "photos" | "result">;
  onSelectPhoto: (id: string) => void;
}) {
  const evidence = normalizeVisualEvidence({ photos: scan.photos });
  const photos = evidence?.photos
    ? evidence.photos.map((photo, index) => ({ id: photo.id, label: `Photo ${index + 1} — ${PHOTO_LABEL_TEXT[photo.label]}` }))
    : evidence && isEvidenceImage(scan.frame.imageBase64) ? [{ id: "photo-1", label: "Photo 1" }] : [];
  const state = buildPhotoReviewState(scan.result?.photoReview, photos, Boolean(scan.result));
  return <section aria-label="Photo review" className="rounded-2xl border border-[var(--ds-border)] bg-[var(--ds-elevated)] p-4 text-sm text-[var(--ds-fg-2)]">
    <h2 className="font-bold">Photo review</h2>
    <p className="mt-1 text-xs text-[var(--ds-fg-3)]">AI-reported observations and limits. Check the saved images; these entries do not confirm identity, condition, function or a shared vehicle.</p>
    <p className="mt-1 text-xs text-[var(--ds-fg-3)]">{state.sourceMessage}</p>
    <p className="mt-3">{state.message}</p>
    {!photos.length ? <p className="mt-2">Saved photo references are unavailable. Review entries cannot be checked against the images.</p> : null}
    <ul className="mt-3 space-y-3">{state.rows.map((row) => <li key={row.id} className="rounded-lg border border-[var(--ds-border)] p-3">
      <button type="button" className="min-h-11 text-left font-semibold underline" onClick={() => onSelectPhoto(row.id)} aria-label={`View saved ${row.label}`}>{row.label}</button>
      <p className="mt-1 font-semibold">{photoReviewStatusLabel(row.status)}</p>
      {row.summary ? <p className="mt-1 whitespace-pre-wrap break-words">{row.summary}</p> : null}
    </li>)}</ul>
    <h3 className="mt-4 font-semibold">Reported disagreements</h3>
    <p className="mt-1">{state.disagreementMessage}</p>
    {state.review?.disagreements.length ? <ul className="mt-3 space-y-3">{state.review.disagreements.map((item) => <li key={item.id} className="rounded-lg border border-[var(--ds-border)] p-3">
      <p className="whitespace-pre-wrap break-words">{item.description}</p>
      <div className="mt-2 flex flex-wrap gap-2">{item.photoIds.map((id) => <button key={id} type="button" className="min-h-11 rounded-lg border border-[var(--ds-border)] px-3 underline" onClick={() => onSelectPhoto(id)} aria-label={`View ${photos.find((photo) => photo.id === id)!.label} for disagreement ${item.id}`}>
        {photos.find((photo) => photo.id === id)!.label}
      </button>)}</div>
      <p className="mt-2 whitespace-pre-wrap break-words"><strong>Next evidence:</strong> {item.nextEvidence.request}</p>
      <p className="mt-1 whitespace-pre-wrap break-words"><strong>Why:</strong> {item.nextEvidence.purpose}</p>
    </li>)}</ul> : null}
  </section>;
}
