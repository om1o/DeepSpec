import type { IdentificationResult } from "../../types";
import { getSimpleResultSummary } from "../../lib/simpleResultSummary";
import { deriveIssue, getConcernFacts, getEvidenceFacts, getSecondarySceneObjects, getVisibleFacts } from "../../lib/resultFacts";

type Variant = "scanner" | "result";

type Theme = {
  issue: string;
  sectionTitle: string;
  fact: string;
  divider: string;
  marker: string;
  chip: string;
  chipMuted: string;
};

const THEME: Record<Variant, Theme> = {
  scanner: {
    issue: "text-white",
    sectionTitle: "text-white/48",
    fact: "text-white/82",
    divider: "border-white/10",
    marker: "text-[var(--electric-300)]",
    chip: "border-white/15 bg-white/10 text-white/90",
    chipMuted: "text-white/55",
  },
  result: {
    issue: "text-neutral-900",
    sectionTitle: "text-neutral-400",
    fact: "text-neutral-700",
    divider: "border-neutral-200",
    marker: "text-[var(--ds-accent)]",
    chip: "border-neutral-200 bg-neutral-50 text-neutral-700",
    chipMuted: "text-neutral-400",
  },
};

/** The single visible-issue sentence ("...a dent on the housing"), or nothing when all looks fine. */
export function IssueLine({ result, variant }: { result: IdentificationResult; variant: Variant }) {
  const issue = deriveIssue(result);
  if (!issue) {
    return null;
  }
  return (
    <p className={`mt-2 text-sm font-bold leading-6 ${THEME[variant].issue}`} data-testid="visible-issue-line">
      {issue.text}
    </p>
  );
}

/** "Also in view" — categories of the other objects in the photo (the posters on the side). */
export function SceneCategoryList({ result, variant }: { result: IdentificationResult; variant: Variant }) {
  const others = getSecondarySceneObjects(result).slice(0, 8);
  if (!others.length) {
    return null;
  }
  const theme = THEME[variant];
  return (
    <div className="mt-3" data-testid="also-in-view">
      <p className={`text-[11px] font-extrabold uppercase tracking-[0.12em] ${theme.sectionTitle}`}>Also in view</p>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {others.map((object, index) => {
          const category = String(object.category).replace(/_/g, " ");
          return (
            <span key={`${object.name}-${index}`} className={`rounded-full border px-2.5 py-1 text-[11px] font-bold ${theme.chip}`}>
              {object.name}
              {category && category !== "unknown" ? <span className={theme.chipMuted}> · {category}</span> : null}
            </span>
          );
        })}
      </div>
    </div>
  );
}

/**
 * The "scroll for more" engineer detail: what we see, match clues, flags, and the (neutral)
 * next step. Empty groups are omitted, so nothing reads as missing or negative.
 */
export function ResultDetailSections({
  result,
  variant,
  compact,
}: {
  result: IdentificationResult;
  variant: Variant;
  compact?: boolean;
}) {
  const isCompact = compact ?? variant === "scanner";
  const summary = getSimpleResultSummary(result);
  const theme = THEME[variant];
  const sections = [
    { title: "What we see", facts: getVisibleFacts(result, isCompact) },
    { title: "Match clues", facts: getEvidenceFacts(result, isCompact) },
    { title: "Flags", facts: getConcernFacts(result, isCompact) },
    { title: "Next step", facts: summary.nextAction ? [summary.nextAction] : [] },
  ].filter((section) => section.facts.length > 0);

  if (!sections.length) {
    return null;
  }

  return (
    <div className="mt-3" data-testid="result-details">
      {sections.map((section) => (
        <div key={section.title} className={`border-t py-3 first:border-t-0 first:pt-0 ${theme.divider}`}>
          <p className={`text-[11px] font-extrabold uppercase tracking-[0.12em] ${theme.sectionTitle}`}>
            {section.title}
          </p>
          <ul className={`mt-1 space-y-1.5 text-xs leading-6 ${theme.fact}`}>
            {section.facts.map((fact) => (
              <li key={fact} className="flex gap-2">
                <span aria-hidden className={theme.marker}>-</span>
                <span>{fact}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
