import { orderSceneObjects } from "../components/result/isolatedPartViewGeometry";
import type { ScanAnalysisState, VisualFocusBox } from "../types";
import { validFocusBox } from "../services/visualEvidence";

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
