import { getLocalDateStamp } from "../lib/utils";
import { formatIntakeDraft } from "../lib/intakeDraft";
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
    formatIntakeDraft(lookup),
    "",
    "AI scan summary:",
    `${result?.partName ?? "Unidentified part"} - ${result?.confidence ?? "unknown"} confidence - ${lookup.scanCategory}`,
    result?.safetyTriage === "needs_professional" || result?.isSafetyCritical
      ? "Safety: check this before driving or repairing."
      : result ? "Safety: no immediate safety-critical flag from the scan." : "Safety: not assessed; no AI result saved.",
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
    formatList(result?.concerns, "No concerns recorded; this does not establish condition."),
    "",
    "Dataset evidence:",
    formatList(datasetEvidence, "No local labeled dataset evidence matched this result."),
    "",
    "Ranked sources:",
    formatSourceLinks(result?.sourceLinks),
    "",
    "Next action:",
    result?.nextAction ?? "Scan again or inspect this before driving if it looks unsafe.",
    "",
    "Human inspection (self-reported, separate from AI):",
    ...(lookup.inspection ? [
      `Inspector: ${lookup.inspection.inspectorName}`,
      `Recorded: ${formatDate(lookup.inspection.inspectedAt)}`,
      `Confirmed part: ${lookup.inspection.confirmedPartName || "Not confirmed"}`,
      `Part number: ${lookup.inspection.partNumber || "Not recorded"}`,
      `Identity evidence: ${lookup.inspection.identityEvidence || "None recorded"}`,
      `Visible condition: ${lookup.inspection.visibleCondition.replaceAll("_", " ")}`,
      `Visible notes: ${lookup.inspection.visibleNotes || "None recorded"}`,
      `Functional test: ${lookup.inspection.functionalStatus.replaceAll("_", " ")}`,
      `Test method and result: ${lookup.inspection.functionalNotes || "None recorded"}`,
      "No visible damage does not establish function. Recorded tests are not safety certification.",
    ] : ["No human inspection recorded. Function not verified."]),
    "",
    "User correction:",
    lookup.correction?.trim() || "None",
    "",
    "Private notes:",
    lookup.notes.trim() || "None",
    "",
    "Safety note:",
    "Deep Spec is not a repair certification tool. Safety-critical items should be checked before driving or repairing.",
  ];

  return lines.join("\n");
}

export function getScanReportFilename(lookup: Lookup) {
  const part = (lookup.result?.partName ?? "scan")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  const date = getLocalDateStamp(lookup.createdAt);

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
        .map((candidate) => `- ${trimReportLine(`${candidate.partName} (${candidate.confidence}): ${candidate.reason}`)}`)
        .join("\n")
    : "None";
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
