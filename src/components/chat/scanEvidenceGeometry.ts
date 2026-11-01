import type { VisualFocusBox } from "../../types";

export function getTrustedFocusBox(box: VisualFocusBox | undefined) {
  if (!box || box.confidence < 0.6) return null;
  const values = [box.x, box.y, box.width, box.height, box.confidence];
  if (!values.every(Number.isFinite) || box.x < 0 || box.y < 0 || box.width < 0.03 || box.height < 0.03) return null;
  if (box.x + box.width > 1 || box.y + box.height > 1) return null;
  return box;
}
