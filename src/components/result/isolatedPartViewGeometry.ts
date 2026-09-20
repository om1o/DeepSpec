import type { CSSProperties } from "react";
import type { IsolatedObject, VisualFocusBox } from "../../types";

/**
 * Edge-safe shift for a label positioned at `left: fraction*100%` of the stage. Translating by
 * the SAME fraction of the label's own width keeps it inside the stage at any anchor: flush-left
 * at the left edge, centred mid-stage, flush-right at the right edge — and the anchor point always
 * stays within the label. A fixed -50% centring pushed half an edge label past the stage, whose
 * overflow-hidden then clipped it.
 */
export function edgeSafeShift(fraction: number): string {
  return `${-clamp01(fraction) * 100}%`;
}

// Gap between the focus frame's edge and its label, and the minimum margin kept to the stage edge.
const LABEL_INSET_PX = 10;
const LABEL_EDGE_MARGIN_PX = 8;

/**
 * Where the focused part's label sits relative to its focus frame (the label's containing block):
 * above the box (below when the box hugs the top), hanging from whichever box edge has more stage
 * to that side, and capped to that room so a long name truncates instead of running off-stage.
 */
export function getFocusLabelPlacement(box: VisualFocusBox): CSSProperties {
  const left = clamp01(box.x);
  const right = clamp01(box.x + box.width);
  const boxWidth = Math.max(right - left, 0.01);
  const roomIfLeftAnchored = 1 - left;
  const roomIfRightAnchored = right;
  const anchorLeft = roomIfLeftAnchored >= roomIfRightAnchored;
  const room = anchorLeft ? roomIfLeftAnchored : roomIfRightAnchored;
  // % here is of the focus frame's width, so scale the stage-fraction room by 1/boxWidth.
  const roomPercent = ((room / boxWidth) * 100).toFixed(2);
  const horizontal: CSSProperties = anchorLeft ? { left: LABEL_INSET_PX } : { right: LABEL_INSET_PX };
  const vertical: CSSProperties = box.y > 0.16 ? { bottom: "calc(100% + 10px)" } : { top: "calc(100% + 10px)" };
  return {
    ...horizontal,
    ...vertical,
    maxWidth: `min(300px, calc(${roomPercent}% - ${LABEL_INSET_PX + LABEL_EDGE_MARGIN_PX}px))`,
  };
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

/** The order LensOverview renders objects in: primary first, capped at 4. */
export function orderSceneObjects(objects: IsolatedObject[]): IsolatedObject[] {
  return [...objects].sort((a, b) => Number(b.primary) - Number(a.primary)).slice(0, 4);
}

/** Contain-fit the stage to the container while preserving the frame's aspect ratio. */
export function getContainedStageStyle(
  containerSize: { width: number; height: number } | null,
  frameAspect: number | null,
): CSSProperties {
  if (!containerSize || !frameAspect || containerSize.width === 0 || containerSize.height === 0) {
    return { position: "absolute", inset: 0 };
  }
  const { width, height } = getContainedFrameSize(containerSize, frameAspect);
  return { position: "relative", width: `${width}px`, height: `${height}px` };
}

/**
 * The stage's size inside a container: the largest box with the frame's aspect ratio that fits.
 * The stage is centred (flex), so it is offset by half the leftover space on each axis.
 */
export function getContainedFrameSize(
  containerSize: { width: number; height: number },
  frameAspect: number,
): { width: number; height: number } {
  const containerAspect = containerSize.width / containerSize.height;
  return containerAspect > frameAspect
    ? { width: containerSize.height * frameAspect, height: containerSize.height }
    : { width: containerSize.width, height: containerSize.width / frameAspect };
}
