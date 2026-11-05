import { orderSceneObjects } from "../components/result/isolatedPartViewGeometry";
import type { ScanAnalysisState, VisualFocusBox } from "../types";
import { normalizeVisualEvidence, validFocusBox } from "../services/visualEvidence";
import { getAccountScope, isAccountScopeCurrent, type AccountScope } from "./accountScope";

type SelectionSourceContext = { lookupId: string; scope?: AccountScope };

/** Only the renewable token of an owned, untransformed Storage object may differ.
 * This compares saved references, not fetched bytes or the validity of a signed token.
 * Supabase embeds transformation options in signed tokens, so render/image URLs are
 * deliberately excluded: https://supabase.com/docs/guides/storage/serving/image-transformations
 */
function renewableImageReference(value: string, context: SelectionSourceContext): string | null {
  const scope = context.scope ?? getAccountScope();
  if (!isAccountScopeCurrent(scope) || !context.lookupId || /[\\\s]/.test(value)) return null;
  try {
    const base = new URL(import.meta.env.VITE_SUPABASE_URL ?? "");
    const url = new URL(value);
    const prefix = "/storage/v1/object/sign/scan-images/";
    const rawPath = /^https:\/\/[^/?#]+([^?#]*)/i.exec(value)?.[1];
    if (base.protocol !== "https:" || base.username || base.password || base.pathname !== "/" || base.search || base.hash
      || url.protocol !== "https:" || url.origin !== base.origin || url.username || url.password || url.hash
      || rawPath !== url.pathname || !url.pathname.startsWith(prefix)) return null;
    const parts = url.pathname.slice(prefix.length).split("/").map(decodeURIComponent);
    if (parts.length < 3 || parts[0] !== scope.userId || parts[1] !== context.lookupId
      || parts.some((part) => !part || part === "." || part === ".." || /[\\/%\s]/.test(part))) return null;
    const tokens = url.searchParams.getAll("token");
    if (tokens.length !== 1 || !tokens[0].trim()) return null;
    url.searchParams.delete("token");
    return `${url.origin}${url.pathname}?${url.searchParams.toString()}`;
  } catch {
    return null;
  }
}

function sameImageReference(a: string | undefined, b: string | undefined, context?: SelectionSourceContext): boolean {
  if (a === b) return true;
  if (!a || !b || !context) return false;
  const current = renewableImageReference(a, context);
  return current !== null && current === renewableImageReference(b, context);
}

/** Compare the displayed photo/selection with the latest saved version before applying an index. */
export function visualSelectionSourceMatches(current: ScanAnalysisState, expected: ScanAnalysisState, context?: SelectionSourceContext): boolean {
  const currentEvidence = normalizeVisualEvidence(current);
  const expectedEvidence = normalizeVisualEvidence(expected);
  if (!currentEvidence || !expectedEvidence) return false;
  const sameBox = (a?: VisualFocusBox, b?: VisualFocusBox) => a === b || Boolean(a && b
    && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height && a.confidence === b.confidence);
  const sameList = <T,>(a: T[] | undefined, b: T[] | undefined, same: (left: T, right: T) => boolean) =>
    a === b || Boolean(a && b && a.length === b.length && a.every((entry, index) => same(entry, b[index])));
  return sameImageReference(current.frame.imageBase64, expected.frame.imageBase64, context)
    && current.frame.capturedAt === expected.frame.capturedAt
    && current.analysisAttemptId === expected.analysisAttemptId
    && current.analyzedAt === expected.analyzedAt
    && current.result?.partName === expected.result?.partName
    && sameBox(currentEvidence.focusBox, expectedEvidence.focusBox)
    && currentEvidence.focusMode === expectedEvidence.focusMode
    && sameImageReference(currentEvidence.isolatedImageBase64, expectedEvidence.isolatedImageBase64, context)
    && sameList(currentEvidence.photos, expectedEvidence.photos, (a, b) => a.id === b.id && a.label === b.label
      && a.capturedAt === b.capturedAt && sameImageReference(a.imageBase64, b.imageBase64, context))
    && sameList(currentEvidence.isolatedObjects, expectedEvidence.isolatedObjects, (a, b) => a.name === b.name
      && a.category === b.category && a.primary === b.primary && sameBox(a.focusBox, b.focusBox)
      && a.focusMode === b.focusMode && a.correctedAt === b.correctedAt && sameImageReference(a.isolatedImageBase64, b.isolatedImageBase64, context));
}

/** Change human-selected geometry without changing the captured image or AI result. */
export function correctScanSelection<T extends ScanAnalysisState>(state: T, box: VisualFocusBox, objectIndex: number | null): T {
  if (!validFocusBox(box)) throw new Error("Select a valid area inside the original photo.");
  const focusBox = { ...box, width: Math.min(box.width, 1 - box.x), height: Math.min(box.height, 1 - box.y) };
  if (focusBox.width <= 0 || focusBox.height <= 0) throw new Error("Select a valid area inside the original photo.");
  const selected = objectIndex === null ? state.isolatedObjects?.find((o) => o.primary)
    : Number.isInteger(objectIndex) && objectIndex >= 0 ? orderSceneObjects(state.isolatedObjects ?? [])[objectIndex] : undefined;
  if (objectIndex !== null && !selected) throw new Error("The selected part is no longer available. Reopen the scan.");
  const updatePrimary = objectIndex === null || selected?.primary;
  return { ...state,
    ...(updatePrimary ? { focusBox, focusMode: "crop", isolatedImageBase64: "" } : {}),
    ...(selected ? { isolatedObjects: state.isolatedObjects!.map((o) => o === selected
      ? { ...o, focusBox, focusMode: "crop" as const, isolatedImageBase64: "", correctedAt: new Date().toISOString() } : o) } : {}),
  };
}
