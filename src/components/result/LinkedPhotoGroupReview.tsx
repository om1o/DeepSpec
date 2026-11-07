import { useEffect, useRef, useState } from "react";
import type { AccountScope } from "../../lib/accountScope";
import { isAccountScopeCurrent } from "../../lib/accountScope";
import { photoRelationshipDescription } from "../../lib/photoRelationship";
import type { ComponentMapScanGroup } from "../../types/componentMap";
import { resolveLinkedPhotoGroup, type LinkedPhotoGroupVerification, type LinkedPhotoVerification } from "../../services/linkedPhotoEvidence";
import { getLookup, subscribeToLookupChanges } from "../../services/storage";
import { isEvidenceImage } from "../../services/visualEvidence";

const STATUS: Record<LinkedPhotoVerification["status"], string> = {
  unchanged: "Original file matches", source_changed: "Original file changed", missing_photo: "Original file missing",
  verification_unavailable: "Could not verify original", legacy_unverified: "Historical file unverified",
};
const BUTTON = "min-h-11 rounded-lg border border-[var(--ds-border)] px-3 py-2 text-sm";

/** Resolve each bound original independently; never show replacement pixels as historical evidence. */
export function LinkedPhotoGroupReview({ group, scope, onClose }: { group: ComponentMapScanGroup; scope: AccountScope; onClose: () => void }) {
  const key = JSON.stringify([scope, group]);
  const [attempt, setAttempt] = useState(0);
  const [verified, setVerified] = useState<{ key: string; attempt: number; value: LinkedPhotoGroupVerification } | null>(null);
  const [error, setError] = useState<{ key: string; attempt: number; message: string } | null>(null);
  const [failedImages, setFailedImages] = useState<Set<string>>(new Set());
  const localRequired = useRef({ key, value: Boolean(getLookup(group.lookupId)) });
  const controller = useRef<AbortController | null>(null);
  const active = isAccountScopeCurrent(scope);
  const result = active && verified?.key === key && verified.attempt === attempt ? verified.value : undefined;
  const failure = active && error?.key === key && error.attempt === attempt ? error.message : undefined;

  function recheck() {
    controller.current?.abort();
    setVerified(null);
    setError(null);
    setFailedImages(new Set());
    setAttempt((previous) => previous + 1);
  }

  useEffect(() => {
    const request = new AbortController();
    controller.current = request;
    if (localRequired.current.key !== key) localRequired.current = { key, value: Boolean(getLookup(group.lookupId)) };
    if (getLookup(group.lookupId)) localRequired.current.value = true;
    void resolveLinkedPhotoGroup(group, scope, request.signal, localRequired.current.value).then((value) => {
      if (request.signal.aborted || !isAccountScopeCurrent(scope)) return;
      setVerified({ key, attempt, value });
    }).catch(() => {
      if (!request.signal.aborted && isAccountScopeCurrent(scope)) {
        setError({ key, attempt, message: "These originals could not be checked. The map links and saved labels are retained. Recheck when the saved photos are available." });
      }
    });
    return () => { request.abort(); };
  }, [group, scope, key, attempt]);

  useEffect(() => subscribeToLookupChanges(() => {
    controller.current?.abort();
    setVerified(null);
    setError(null);
    setFailedImages(new Set());
    setAttempt((previous) => previous + 1);
  }), []);

  return <section aria-label="Linked original photos" className="mt-3 space-y-3 rounded-lg border border-[var(--ds-border)] p-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h4 className="font-semibold">Linked original photos</h4>
      <button type="button" className={BUTTON} onClick={onClose}>Close photo group</button>
    </div>
    <p>Relationship at linking: {photoRelationshipDescription(group.binding?.photoRelationship)}</p>
    <p className="text-xs">A file match does not establish which component or car is shown, or whether it is safe. These labels record what was selected at linking.</p>
    {!active ? <p role="status">The account changed. Reopen this map in the current account.</p> : <>
      {failure ? <p role="status">{failure}</p> : !result ? <p role="status">Checking each linked original…</p> : null}
      <ol className="space-y-3">{group.photoIds.map((photoId, index) => {
        const saved = group.binding?.photos.find((photo) => photo.photoId === photoId);
        const photo = result?.photos.find((row) => row.photoId === photoId);
        const imageFailed = failedImages.has(`${key}:${photoId}`);
        const original = photo?.status === "unchanged" && photo.image?.startsWith("data:") && isEvidenceImage(photo.image) && !imageFailed ? photo.image : undefined;
        return <li key={photoId} className="space-y-1 rounded-lg border border-[var(--ds-border)] p-2">
          <p className="font-medium">Photo {index + 1} — {saved?.label.replaceAll("_", " ") ?? "label not recorded"}</p>
          <p className="break-all text-xs">Photo ID: {photoId}</p>
          <p>{imageFailed ? "Original image could not be displayed. Recheck this photo." : photo ? STATUS[photo.status] : "Original verification pending"}</p>
          {photo ? <p className="text-xs">{photo.message}</p> : null}
          {photo?.currentMetadataChanged ? <p className="text-xs">The current scan's labels or relationship changed. The labels and relationship shown here are the ones saved at linking.</p> : null}
          {original ? <img src={original} alt={`Linked original photo ${index + 1}: ${saved?.label.replaceAll("_", " ") ?? photoId}`} className="max-h-96 w-full rounded-lg object-contain" onError={() => setFailedImages((previous) => new Set(previous).add(`${key}:${photoId}`))} /> : null}
        </li>;
      })}</ol>
      <button type="button" className={BUTTON} onClick={recheck}>Recheck linked originals</button>
    </>}
  </section>;
}
