import { EVIDENCE_ANCHORS, type EvidenceAnchor, type EvidenceRegion } from "../types";

export function getEvidenceRegionAnchor(region: Pick<EvidenceRegion, "anchor" | "regionLabel">): EvidenceAnchor {
  return isEvidenceAnchor(region.anchor) ? region.anchor : inferEvidenceAnchor(region.regionLabel);
}

export function inferEvidenceAnchor(regionLabel: string): EvidenceAnchor {
  const label = regionLabel.toLowerCase();
  const isUpper = /upper|top/.test(label);
  const isLower = /lower|bottom/.test(label);
  const isLeft = /left/.test(label);
  const isRight = /right/.test(label);

  if (isUpper && isLeft) return "upper_left";
  if (isUpper && isRight) return "upper_right";
  if (isLower && isLeft) return "lower_left";
  if (isLower && isRight) return "lower_right";
  if (isLeft) return "left";
  if (isRight) return "right";
  if (isLower) return "lower";
  if (isUpper) return "upper";
  if (/center|middle/.test(label)) return "center";
  return "scanned_area";
}

export function isEvidenceAnchor(value: unknown): value is EvidenceAnchor {
  return typeof value === "string" && EVIDENCE_ANCHORS.includes(value as EvidenceAnchor);
}
