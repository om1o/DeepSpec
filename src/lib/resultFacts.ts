import { SCAN_CATEGORIES } from "../types";
import type { IdentificationResult, SceneObject, VisualFocusBox } from "../types";
import type { SimpleResultSummary } from "./simpleResultSummary";
import { describesVisibleDamage } from "./damageWords";

/** The first sentence describing visible damage, or null when nothing looks wrong. */
export function findVisibleIssue(result: IdentificationResult): string | null {
  return result.visibleObservations.find((item) => describesVisibleDamage(item))
    ?? result.evidenceRegions.find((item) => describesVisibleDamage(item.observation))?.observation
    ?? null;
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
  if (summary.eyebrow === "Identity unresolved") return summary.body;
  if (findVisibleIssue(result)) {
    const what = result.whatItDoes?.trim();
    return what ? summarize(what, 150) : summary.body;
  }
  return summary.body;
}

// Only tools, car parts, and tech/electronics are treated as real, focusable detected objects.
// Everything else is dropped so it never gets a label, cutout, or card — it simply remains part
// of the dimmed background photo. The AI's `category` is a free-ish string, so we key off name +
// category keywords, whole-word matched ("hand" never matches "handle") with an optional plural
// ending ("wrenches", "tools").
//
// The default is DROP: an object is kept only when an allow word matches. So a block list is only
// needed where an allow word would otherwise keep a non-target — and furniture/room/decor words
// must NOT block by name, because they are common modifiers in tool and part names ("floor jack",
// "table saw", "side mirror", "brake shoe", "skid plate"). Order:
//   1. a people word anywhere → drop ("Person holding phone")
//   2. a car-part scan category (any casing) → keep
//   3. a non-target category ("clothing", "food", "furniture") → drop; category only, never name
//   4. a body-part word → drop, unless the category itself vouches for a tool/part/device —
//      "Hand holding wrench / hand" drops, but "Control arm / part" and "Hand brake / part" stay.
//      "body part" doesn't vouch — it's the anatomical sense, so "Hand / body part" drops.
//   5. otherwise keep only on an allow word
const PEOPLE_WORDS = [
  "person", "people", "boy", "girl", "man", "woman", "men", "women", "child", "children", "kid",
  "baby", "toddler", "human", "adult", "guy", "lady", "ladies",
];
// Soft-blocked (rule 4): these double as car-part / tool names (control arm, hand brake, face shield).
const BODY_PART_WORDS = ["hand", "arm", "finger", "face"];
// Matched against the category only (rule 3).
const NON_TARGET_CATEGORIES = [
  "furniture", "decor", "decoration", "room", "environment", "background", "home", "household",
  "kitchen", "food", "clothing", "apparel", "personal", "plant", "animal", "pet", "poster", "art",
];
const RELEVANCE_ALLOW = [
  // tools
  "tool", "wrench", "spanner", "screwdriver", "plier", "hammer", "drill", "socket", "ratchet",
  "clamp", "jack", "gauge", "meter", "multimeter", "torque", "saw", "blade", "cutter", "knife", "knives",
  "file", "punch", "chisel", "level", "caliper",
  // tech / electronics
  "remote", "phone", "smartphone", "tablet", "laptop", "computer", "camera", "battery", "batteries",
  "charger", "cable", "wire", "wiring", "connector", "plug", "sensor", "module", "ecu", "controller",
  "circuit", "board", "pcb", "chip", "device", "electronic", "electronics", "gadget", "speaker", "monitor",
  "screen", "display", "headphone", "earbud", "drone", "router", "adapter", "fuse", "relay", "switch",
  "motor", "actuator", "harness", "alternator", "starter", "coil", "solenoid",
  // generic part / component words (for parts the AI tags with a free-string category)
  "part", "component", "assembly", "assemblies", "bracket", "mount", "housing", "panel", "hose", "belt",
  "pipe", "valve", "filter", "pump", "cap", "bolt", "nut", "clip", "seal", "gasket", "bearing", "pulley",
  "gear", "fitting", "rotor", "manifold", "radiator", "compressor", "injector", "spark", "spring",
  "shock", "strut",
];

/** Whole-word match on any of `words`, each optionally followed by a plural "s"/"es". */
function wordListRegex(words: string[]) {
  return new RegExp(`\\b(${words.join("|")})(?:s|es)?\\b`, "i");
}

const PEOPLE_RE = wordListRegex(PEOPLE_WORDS);
const BODY_PART_RE = wordListRegex(BODY_PART_WORDS);
const NON_TARGET_CATEGORY_RE = wordListRegex(NON_TARGET_CATEGORIES);
const RELEVANCE_ALLOW_RE = wordListRegex(RELEVANCE_ALLOW);
const ANATOMY_CATEGORY_RE = /\bbody[\s-]*parts?\b/g;

/** True only for tools, car parts, and tech/electronics — the objects we treat as real, focusable. */
export function isRelevantSceneObject(object: SceneObject): boolean {
  const category = object.category.trim().toLowerCase();
  const text = `${object.name} ${category}`.toLowerCase();
  if (PEOPLE_RE.test(text)) {
    return false;
  }
  if ((SCAN_CATEGORIES as readonly string[]).includes(category) && category !== "unknown") {
    return true; // AI classified it as a real car-part category
  }
  if (NON_TARGET_CATEGORY_RE.test(category)) {
    return false;
  }
  if (BODY_PART_RE.test(text) && !RELEVANCE_ALLOW_RE.test(category.replace(ANATOMY_CATEGORY_RE, " "))) {
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
    anchor: anchorForObservation(result, text),
  };
}

function anchorForObservation(result: IdentificationResult, text: string): VisualFocusBox | null {
  const normalized = (value: string) => value.trim().replace(/\s+/g, " ").toLowerCase();
  // Text and place must belong to the same evidence. Similar damage words or a
  // paraphrase are not enough to locate this particular observation safely.
  const matches = result.evidenceRegions.filter((item) => normalized(item.observation) === normalized(text));
  if (!matches.length) return null;
  const boxes = matches.map((item) => regionLabelToBox(item.regionLabel));
  const first = boxes[0];
  if (!first || boxes.some((box) => !box || box.x !== first.x || box.y !== first.y || box.width !== first.width || box.height !== first.height)) return null;
  return first;
}

/**
 * Recognize only an unambiguous coarse image area. A single direction spans the
 * unknown axis; it never invents a point there. Descriptions, alternatives and
 * conflicting directions remain unlocated. This is not a measured damage boundary.
 */
export function regionLabelToBox(regionLabel: string): VisualFocusBox | null {
  const label = regionLabel.trim().toLowerCase().replace(/-/g, " ").replace(/\s+/g, " ");
  const rows: Record<string, number> = { upper: 0, top: 0, middle: 1, center: 1, centre: 1, lower: 2, bottom: 2 };
  const columns: Record<string, number> = { left: 0, center: 1, centre: 1, right: 2 };
  let row: number | undefined, col: number | undefined;
  const corner = label.match(/^(upper|top|lower|bottom) (left|right) corner$/);
  const pair = label.match(/^(upper|top|middle|center|centre|lower|bottom) (left|center|centre|right)$/);
  if (corner || pair) {
    const match = (corner ?? pair)!;
    row = rows[match[1]]; col = columns[match[2]];
  } else if (/^(left|right)( side)?$/.test(label)) {
    col = columns[label.split(" ")[0]];
  } else if (/^(upper|top|lower|bottom)( side)?$/.test(label)) {
    row = rows[label.split(" ")[0]];
  } else if (/^(center|centre|middle)$/.test(label)) {
    row = 1; col = 1;
  } else {
    return null;
  }
  return {
    confidence: 0.5,
    height: row === undefined ? 1 : 1 / 3,
    width: col === undefined ? 1 : 1 / 3,
    x: col === undefined ? 0 : col / 3,
    y: row === undefined ? 0 : row / 3,
  };
}
