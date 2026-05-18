import type { Lookup } from "../types";

export function buildScanReport(lookup: Lookup) {
  const result = lookup.result;
  const lines = [
    "Deep Spec Scan Report",
    `Created: ${formatDate(lookup.createdAt)}`,
    `Captured: ${formatDate(lookup.frame.capturedAt)}`,
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
    "Concerns:",
    formatList(result?.concerns, "Nothing concerning visible."),
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
  return visibleItems.length > 0 ? visibleItems.map((item) => `- ${item}`).join("\n") : emptyText;
}
