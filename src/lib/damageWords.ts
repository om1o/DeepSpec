// Shared by the result summary ("Visible issue" eyebrow) and the issue pointer, so both fire on
// exactly the same sentences.
//
// Matches the inflected forms the AI actually writes ("cracked", "leaking", "rusted", "dents"),
// not just base words. Bare "chip" is left out on purpose: in this app it is far more often an
// electronics part ("ECU chip") than damage; "chipped" still counts. A trailing hyphen means a
// compound ("stain-resistant", "rust-colored"), not damage.
const DAMAGE_RE =
  /\b(dent(?:s|ed)?|scratch(?:es|ed)?|crack(?:s|ed|ing)?|broken|break(?:s|age)?|damage[sd]?|missing|detached|chipped|chipping|rust(?:s|ed|y|ing)?|corrosion|corroded|corroding|leak(?:s|ed|ing|age)?|stain(?:s|ed)?|worn|frayed|bent|torn)\b(?!-)/gi;

// A damage word preceded by one of these in the same clause is a clean bill of health ("No visible
// damage", "shows no signs of rust", "does not appear damaged"), not an issue.
const NEGATION_RE = /\b(no|not|without|free of|none|nothing|never)\b|n't\b/i;
// Clause breaks that end a negation's reach. Commas deliberately don't: "No leaks, cracks, or
// corrosion" negates all three.
const CLAUSE_BREAK_RE = /[.;!?]|\b(but|however|although|though|yet|except)\b/gi;

/** True when the sentence reports visible damage — an un-negated damage word. */
export function describesVisibleDamage(text: string): boolean {
  for (const match of text.matchAll(DAMAGE_RE)) {
    const before = text.slice(0, match.index);
    const clauseStart = Math.max(0, ...[...before.matchAll(CLAUSE_BREAK_RE)].map((m) => (m.index ?? 0) + m[0].length));
    if (!NEGATION_RE.test(before.slice(clauseStart))) {
      return true;
    }
  }
  return false;
}
