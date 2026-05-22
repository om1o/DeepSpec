import type { CandidateMatch, EvidenceRegion, Lookup, SourceLink } from "../types";

export function buildScanReport(lookup: Lookup) {
  const result = lookup.result;
  const datasetEvidence = getDatasetEvidence(result?.evidence ?? []);
  const detectedText = getDetectedTextEvidence(result?.evidence ?? []);
  const lines = [
    "Deep Spec Scan Report",
    `Created: ${formatDate(lookup.createdAt)}`,
    `Captured: ${formatDate(lookup.frame.capturedAt)}`,
    "",
    "Mechanic summary:",
    `${result?.partName ?? "Unidentified part"} - ${result?.confidence ?? "unknown"} confidence - ${lookup.scanCategory}`,
    result?.safetyTriage === "needs_professional" || result?.isSafetyCritical
      ? "Safety: verify with a qualified mechanic before driving or repairing."
      : "Safety: no immediate safety-critical flag from the scan.",
    "",
    `Part: ${result?.partName ?? "Not identified"}`,
    `Confidence: ${result?.confidence ?? "unknown"}`,
    `Category: ${lookup.scanCategory}`,
    `Safety triage: ${result?.safetyTriage ?? "unknown"}`,
    `Training label: ${lookup.trainingLabel}`,
    `Review status: ${lookup.trainingStatus.replaceAll("_", " ")}`,
    "",
    "What it does:",
    result?.whatItDoes ?? "No AI explanation saved.",
    "",
    "Visible observations:",
    formatList(result?.visibleObservations),
    "",
    "Other possible matches:",
    formatCandidateMatches(result?.candidateMatches),
    "",
    "Image evidence:",
    formatEvidenceRegions(result?.evidenceRegions),
    "",
    "Detected text:",
    formatList(detectedText, "None detected."),
    "",
    "Concerns:",
    formatList(result?.concerns, "Nothing concerning visible."),
    "",
    "Dataset evidence:",
    formatList(datasetEvidence, "No local labeled dataset evidence matched this result."),
    "",
    "Ranked sources:",
    formatSourceLinks(result?.sourceLinks),
    "",
    "Next action:",
    result?.nextAction ?? "Scan again or ask a professional if this looks unsafe.",
    "",
    "User correction:",
    lookup.correction?.trim() || "None",
    "",
    "Private notes:",
    lookup.notes.trim() || "None",
    "",
    "Safety note:",
    "Deep Spec is not a repair certification tool. Safety-critical parts should be verified with a mechanic.",
  ];

  return lines.join("\n");
}

export function getScanReportFilename(lookup: Lookup) {
  const part = (lookup.result?.partName ?? "scan")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  const date = lookup.createdAt.slice(0, 10);

  return `deep-spec-${part || "scan"}-${date}.txt`;
}

export function getMechanicSearchUrl(lookup: Lookup) {
  const category = lookup.scanCategory === "unknown" ? "auto repair" : `${lookup.scanCategory} auto repair`;
  return `https://www.google.com/maps/search/${encodeURIComponent(`${category} near me`)}`;
}

export function downloadTextFile(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function formatList(items: string[] | undefined, emptyText = "None") {
  const visibleItems = items?.filter(Boolean) ?? [];
  return visibleItems.length > 0 ? visibleItems.slice(0, 8).map((item) => `- ${trimReportLine(item)}`).join("\n") : emptyText;
}

function formatCandidateMatches(candidates: CandidateMatch[] | undefined) {
  const visibleCandidates = candidates?.filter((candidate) => candidate.partName && candidate.reason) ?? [];
  return visibleCandidates.length > 0
    ? visibleCandidates
        .slice(0, 4)
        .map((candidate) => {
          const lines = [`- ${trimReportLine(`${candidate.partName} (${candidate.confidence}): ${candidate.reason}`)}`];
          const sources = formatCandidateSourceLinks(candidate.sourceLinks);
          return sources.length ? [...lines, ...sources].join("\n") : lines.join("\n");
        })
        .join("\n")
    : "None";
}

function formatCandidateSourceLinks(links: SourceLink[] | undefined) {
  const visibleLinks = links?.filter((link) => link.label && link.url) ?? [];
  return visibleLinks
    .slice(0, 3)
    .map((link) => `  source: ${trimReportLine(`${link.label} (${link.sourceType}): ${link.url}`)}`);
}

function formatEvidenceRegions(regions: EvidenceRegion[] | undefined) {
  const visibleRegions = regions?.filter((region) => region.label && region.observation) ?? [];
  return visibleRegions.length > 0
    ? visibleRegions
        .slice(0, 4)
        .map((region) => `- ${trimReportLine(`${region.regionLabel}: ${region.label} - ${region.observation}`)}`)
        .join("\n")
    : "None";
}

function formatSourceLinks(links: SourceLink[] | undefined) {
  const visibleLinks = links?.filter((link) => link.label && link.url) ?? [];
  return visibleLinks.length > 0
    ? visibleLinks
        .slice(0, 6)
        .map((link) => `- ${trimReportLine(`${link.label} (${link.sourceType}): ${link.url}`)}`)
        .join("\n")
    : "None";
}

function getDatasetEvidence(evidence: string[]) {
  return evidence.filter((item) => /^Local dataset match:|^Dataset source:/i.test(item));
}

function getDetectedTextEvidence(evidence: string[]) {
  return evidence
    .map((item) => item.match(/^OCR label text:\s*(.+)$/i)?.[1]?.replace(/\s+/g, " ").trim() ?? "")
    .filter(Boolean);
}

function trimReportLine(value: string) {
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed.length > 220 ? `${trimmed.slice(0, 217)}...` : trimmed;
}
