import { SCAN_CATEGORIES } from "../types";
import type { IdentificationResult, SceneObject, VisualFocusBox } from "../types";
import type { SimpleResultSummary } from "./simpleResultSummary";

// Kept identical to the regex inside simpleResultSummary.ts so the issue pointer
// fires exactly when that helper sets the "Visible issue" eyebrow.
const DAMAGE_WORDS = /\b(dent|scratch|crack|broken|damage|damaged|missing|detached|chip|rust|corrosion|leak|stain)\b/i;

/** The first sentence describing visible damage, or null when nothing looks wrong. */
export function findVisibleIssue(result: IdentificationResult): string | null {
  const concern = result.concerns.find((item) => DAMAGE_WORDS.test(item));
  return concern ?? result.visibleObservations.find((item) => DAMAGE_WORDS.test(item)) ?? null;
}

export function summarize(value: string, limit: number) {
  const trimmed = value.trim();
  if (trimmed.length <= limit) {
    return trimmed;
  }
  return `${trimmed.slice(0, Math.max(12, limit - 1)).trimEnd()}...`;
}

// Internal provenance strings that should never surface as user-facing evidence.
const PROVENANCE_PREFIX = /^(ocr label text|local dataset match|dataset source)\s*:/i;

export function getVisibleFacts(result: IdentificationResult | undefined, compact: boolean) {
  if (!result) {
    return [];
  }
  return result.visibleObservations
    .map((item) => summarize(item, compact ? 85 : 130))
    .filter(Boolean)
    .slice(0, compact ? 3 : 5);
}

export function getConcernFacts(result: IdentificationResult | undefined, compact: boolean) {
  if (!result) {
    return [];
  }

  return result.concerns
    .map((item) => summarize(item, compact ? 85 : 130))
    .filter(Boolean)
    .slice(0, compact ? 3 : 5);
}

export function getEvidenceFacts(result: IdentificationResult | undefined, compact: boolean) {
  if (!result) {
    return [];
  }

  return [
    ...result.evidence.filter((item) => !PROVENANCE_PREFIX.test(item.trim())),
    ...result.evidenceRegions.map((item) => `${item.regionLabel}: ${item.observation}`),
  ]
    .filter(Boolean)
    .map((item) => summarize(item, compact ? 90 : 145))
    .slice(0, compact ? 3 : 6);
}

/** Plain-language body line that names what the part does, without repeating the issue line. */
export function getAnswerBody(result: IdentificationResult, summary: SimpleResultSummary): string {
  if (findVisibleIssue(result)) {
    const what = result.whatItDoes?.trim();
    return what ? summarize(what, 150) : summary.body;
  }
  return summary.body;
}

// Only tools, car parts, and tech/electronics are treated as real, focusable detected objects.
// People, furniture, and room/environment are dropped so they never get a label, cutout, or card —
// they simply remain part of the dimmed background photo. The AI's `category` is a free-ish string,
// so we key off name + category keywords (whole-word matched, so "hand" never matches "handle").
// Order matters: a real car-part category wins first; then a hard block; then the allow list.
const RELEVANCE_BLOCK = [
  // people
  "person", "people", "boy", "girl", "man", "woman", "men", "women", "child", "children", "kid", "kids",
  "baby", "toddler", "human", "adult", "face", "guy", "lady",
  // furniture
  "couch", "sofa", "chair", "table", "desk", "bed", "shelf", "cabinet", "drawer", "stool", "bench",
  "furniture", "dresser", "wardrobe", "nightstand", "ottoman",
  // room / environment / decor
  "wall", "floor", "ceiling", "carpet", "rug", "plant", "tree", "grass", "sky", "cloud", "room",
  "background", "poster", "painting", "picture", "mirror", "vase", "clock", "curtain", "blanket",
  "pillow", "towel", "book", "food", "plate", "cup", "bottle", "clothing", "shirt", "hat", "shoe", "jacket",
  // animals
  "dog", "cat", "pet", "bird", "animal",
];
const RELEVANCE_ALLOW = [
  // tools
  "tool", "wrench", "spanner", "screwdriver", "plier", "pliers", "hammer", "drill", "socket", "ratchet",
  "clamp", "jack", "gauge", "meter", "multimeter", "torque", "saw", "blade", "cutter", "knife", "file",
  "punch", "chisel", "level", "caliper",
  // tech / electronics
  "remote", "phone", "smartphone", "tablet", "laptop", "computer", "camera", "battery", "charger", "cable",
  "wire", "wiring", "connector", "plug", "sensor", "module", "ecu", "controller", "circuit", "board", "pcb",
  "chip", "device", "electronic", "electronics", "gadget", "speaker", "monitor", "screen", "display",
  "headphone", "earbud", "drone", "router", "adapter", "fuse", "relay", "switch", "motor", "actuator",
  "harness", "alternator", "starter", "coil", "solenoid",
  // generic part / component words (for parts the AI tags with a free-string category)
  "part", "component", "assembly", "bracket", "mount", "housing", "panel", "hose", "belt", "pipe", "valve",
  "filter", "pump", "cap", "bolt", "nut", "clip", "seal", "gasket", "bearing", "pulley", "gear", "fitting",
  "rotor", "caliper", "manifold", "radiator", "compressor", "injector", "spark", "spring", "shock", "strut",
];
const RELEVANCE_BLOCK_RE = new RegExp(`\\b(${RELEVANCE_BLOCK.join("|")})\\b`, "i");
const RELEVANCE_ALLOW_RE = new RegExp(`\\b(${RELEVANCE_ALLOW.join("|")})\\b`, "i");

/** True only for tools, car parts, and tech/electronics — the objects we treat as real, focusable. */
export function isRelevantSceneObject(object: SceneObject): boolean {
  if ((SCAN_CATEGORIES as readonly string[]).includes(object.category) && object.category !== "unknown") {
    return true; // AI classified it as a real car-part category
  }
  const text = `${object.name} ${object.category}`.toLowerCase();
  if (RELEVANCE_BLOCK_RE.test(text)) {
    return false;
  }
  return RELEVANCE_ALLOW_RE.test(text);
}

/** Distinct visible objects besides the main part — filtered to relevant (tool/part/electronics) only. */
export function getSecondarySceneObjects(result: IdentificationResult): SceneObject[] {
  return (result.sceneObjects ?? []).filter(
    (object) => object.name && !object.primary && isRelevantSceneObject(object),
  );
}

export type SceneChip = {
  object: SceneObject;
  box: VisualFocusBox;
};

/** Secondary objects that have a placeable region, for labelling on the image (capped). */
export function getSceneChips(result: IdentificationResult): SceneChip[] {
  return getSecondarySceneObjects(result)
    .map((object) => {
      const box = regionLabelToBox(object.regionLabel);
      return box ? { object, box } : null;
    })
    .filter((chip): chip is SceneChip => Boolean(chip))
    .slice(0, 4);
}

export type DerivedIssue = {
  text: string;
  anchor: VisualFocusBox | null;
};

/** Pull the single most relevant visible issue plus a place to point at it, or null. */
export function deriveIssue(result: IdentificationResult): DerivedIssue | null {
  const text = findVisibleIssue(result);
  if (!text) {
    return null;
  }

  return {
    text: summarize(text, 96),
    anchor: anchorFromDamageRegion(result),
  };
}

function anchorFromDamageRegion(result: IdentificationResult): VisualFocusBox | null {
  const region = result.evidenceRegions.find((item) => DAMAGE_WORDS.test(item.observation));
  return region ? regionLabelToBox(region.regionLabel) : null;
}

/**
 * Map the model's coarse region vocabulary ("upper left", "center", "right side", ...)
 * to a normalized box centered on the matching 3x3 cell. Unknown labels return null so
 * callers can fall back to the focus box center.
 */
export function regionLabelToBox(regionLabel: string): VisualFocusBox | null {
  const label = regionLabel.toLowerCase();
  if (!/\b(left|right|upper|lower|top|bottom|center|centre|middle)\b/.test(label)) {
    return null;
  }

  const col = label.includes("left") ? 0 : label.includes("right") ? 2 : 1;
  const row = label.includes("upper") || label.includes("top")
    ? 0
    : label.includes("lower") || label.includes("bottom")
      ? 2
      : 1;

  const size = 0.32;
  const centerX = col * (1 / 3) + 1 / 6;
  const centerY = row * (1 / 3) + 1 / 6;

  return {
    confidence: 0.5,
    height: size,
    width: size,
    x: clamp01(centerX - size / 2),
    y: clamp01(centerY - size / 2),
  };
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}
