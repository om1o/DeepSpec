import type { CSSProperties } from "react";
import type { IsolatedObject } from "../../types";

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
  const containerAspect = containerSize.width / containerSize.height;
  const [width, height] = containerAspect > frameAspect
    ? [containerSize.height * frameAspect, containerSize.height]
    : [containerSize.width, containerSize.width / frameAspect];
  return { position: "relative", width: `${width}px`, height: `${height}px` };
}
