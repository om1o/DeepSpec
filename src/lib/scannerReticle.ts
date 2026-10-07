export type RectLike = {
  height: number;
  left: number;
  top: number;
  width: number;
};

export const SCANNER_RETICLE_WIDTH_RATIO = 0.72;
export const SCANNER_RETICLE_HEIGHT_RATIO = 0.52;
export const SCANNER_RETICLE_MAX_WIDTH_PX = 320;
export const SCANNER_RETICLE_MAX_HEIGHT_PX = 240;
export const SCANNER_RETICLE_CENTER_Y_RATIO = 0.5;

const MIN_TARGET_OVERLAP_RATIO = 0.55;

export function getScannerReticleBounds(viewportWidth: number, viewportHeight: number): RectLike {
  const width = Math.min(viewportWidth * SCANNER_RETICLE_WIDTH_RATIO, SCANNER_RETICLE_MAX_WIDTH_PX);
  const height = Math.min(viewportWidth * SCANNER_RETICLE_HEIGHT_RATIO, SCANNER_RETICLE_MAX_HEIGHT_PX);

  return {
    height,
    left: viewportWidth / 2 - width / 2,
    top: viewportHeight * SCANNER_RETICLE_CENTER_Y_RATIO - height / 2,
    width,
  };
}

export function isTargetInsideScannerBox(target: RectLike, scannerBox: RectLike) {
  if (target.width <= 0 || target.height <= 0 || scannerBox.width <= 0 || scannerBox.height <= 0) {
    return false;
  }

  const targetCenterX = target.left + target.width / 2;
  const targetCenterY = target.top + target.height / 2;
  if (
    targetCenterX < scannerBox.left ||
    targetCenterX > scannerBox.left + scannerBox.width ||
    targetCenterY < scannerBox.top ||
    targetCenterY > scannerBox.top + scannerBox.height
  ) {
    return false;
  }

  const overlapWidth = Math.max(
    0,
    Math.min(target.left + target.width, scannerBox.left + scannerBox.width) - Math.max(target.left, scannerBox.left),
  );
  const overlapHeight = Math.max(
    0,
    Math.min(target.top + target.height, scannerBox.top + scannerBox.height) - Math.max(target.top, scannerBox.top),
  );
  const smallerArea = Math.min(target.width * target.height, scannerBox.width * scannerBox.height);

  return smallerArea > 0 && (overlapWidth * overlapHeight) / smallerArea >= MIN_TARGET_OVERLAP_RATIO;
}
