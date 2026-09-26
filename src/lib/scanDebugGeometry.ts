type ParsedBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type SamGeometryVerdict =
  | "frame/model dims mismatch"
  | "mask missed target"
  | "mask much smaller than target"
  | "mask much larger than target"
  | "mask overlaps target"
  | "need geometry";

// A mask box under this share of the target box's area is treated as SAM grabbing a sub-part (a
// label, a connector) rather than the object — the "tiny blob" failure. It still overlaps the
// target, so the overlap check alone reads it as fine.
const UNDERSIZED_MASK_AREA_RATIO = 0.25;

// A mask box over this multiple of the target box's area is treated as SAM grabbing the object
// plus its surroundings (the whole engine around an engine cover) — the "spill" failure. It
// contains the target, so the overlap check alone reads it as fine. Tighter than mirroring the
// undersized ratio (4x): target boxes are drawn around the object, so a correct mask box should
// rarely be much bigger than the target at all.
const OVERSIZED_MASK_AREA_RATIO = 2;

type SamGeometryInput = {
  frameDims?: string;
  modelDims?: string;
  targetBoxNorm?: string;
  maskBoxNorm?: string;
};

export function getSamGeometryVerdict(input: SamGeometryInput): SamGeometryVerdict {
  const frameDims = parseDims(input.frameDims);
  const modelDims = parseDims(input.modelDims);
  if (!frameDims || !modelDims) {
    return "need geometry";
  }
  if (frameDims.width !== modelDims.width || frameDims.height !== modelDims.height) {
    return "frame/model dims mismatch";
  }

  const targetBox = parseBox(input.targetBoxNorm);
  const maskBox = parseBox(input.maskBoxNorm);
  if (!targetBox || !maskBox) {
    return "need geometry";
  }

  const intersection = getIntersectionArea(targetBox, maskBox);
  const smallerBoxArea = Math.min(getBoxArea(targetBox), getBoxArea(maskBox));
  const overlapRatio = smallerBoxArea > 0 ? intersection / smallerBoxArea : 0;
  const maskCenterX = maskBox.x + maskBox.width / 2;
  const maskCenterY = maskBox.y + maskBox.height / 2;

  if (overlapRatio < 0.25 && !isPointInsideBox(maskCenterX, maskCenterY, targetBox)) {
    return "mask missed target";
  }
  const maskArea = getBoxArea(maskBox);
  const targetArea = getBoxArea(targetBox);
  if (maskArea < targetArea * UNDERSIZED_MASK_AREA_RATIO) {
    return "mask much smaller than target";
  }
  if (maskArea > targetArea * OVERSIZED_MASK_AREA_RATIO) {
    return "mask much larger than target";
  }
  return "mask overlaps target";
}

function parseDims(value?: string): { width: number; height: number } | null {
  const match = value?.trim().match(/^(\d+(?:\.\d+)?)\s*[xX×]\s*(\d+(?:\.\d+)?)$/);
  if (!match) {
    return null;
  }
  const width = Number(match[1]);
  const height = Number(match[2]);
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0 ? { width, height } : null;
}

function parseBox(value?: string): ParsedBox | null {
  if (!value || value === "empty") {
    return null;
  }
  const parts = value.split(",").map((part) => Number(part.trim()));
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) {
    return null;
  }
  const [x, y, width, height] = parts;
  return width > 0 && height > 0 ? { x, y, width, height } : null;
}

function getBoxArea(box: ParsedBox): number {
  return box.width * box.height;
}

function getIntersectionArea(a: ParsedBox, b: ParsedBox): number {
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  return Math.max(0, right - left) * Math.max(0, bottom - top);
}

function isPointInsideBox(x: number, y: number, box: ParsedBox): boolean {
  return x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height;
}
