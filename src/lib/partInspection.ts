import type { Lookup, PartInspection, PartInspectionDraft } from "../types";

export const emptyPartInspection: PartInspectionDraft = {
  confirmedPartName: "", partNumber: "", identityEvidence: "",
  visibleCondition: "not_inspected", visibleNotes: "",
  functionalStatus: "not_tested", functionalNotes: "", inspectorName: "",
};

export function inspectionValidationError(draft: PartInspectionDraft): string | null {
  if (!draft.inspectorName.trim()) return "Enter the inspector's name.";
  if ((draft.confirmedPartName.trim() || draft.partNumber.trim()) && !draft.identityEvidence.trim()) {
    return "Describe how you confirmed the identity or part number.";
  }
  if ((draft.visibleCondition === "visible_damage" || draft.visibleCondition === "uncertain") && !draft.visibleNotes.trim()) {
    return "Describe the visible damage or uncertainty.";
  }
  if (draft.functionalStatus !== "not_tested" && !draft.functionalNotes.trim()) {
    return "Record the test performed and its result.";
  }
  return null;
}

export function normalizePartInspection(value: unknown): PartInspection | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(emptyPartInspection) as (keyof PartInspectionDraft)[];
  if (keys.some((key) => typeof record[key] !== "string")) return undefined;
  if (!["not_inspected", "no_visible_damage", "visible_damage", "uncertain"].includes(record.visibleCondition as string)
    || !["not_tested", "passed", "failed", "inconclusive"].includes(record.functionalStatus as string)
    || typeof record.inspectedAt !== "string" || !Number.isFinite(Date.parse(record.inspectedAt))) return undefined;
  const normalized = Object.fromEntries(keys.map((key) => [key, (record[key] as string).trim().slice(0, 1000)])) as PartInspectionDraft;
  if (inspectionValidationError(normalized)) return undefined;
  return { ...normalized, inspectedAt: new Date(record.inspectedAt).toISOString() };
}

export function withLatestInspection(local: Lookup, remote: Lookup): Lookup {
  if (remote.inspection && (!local.inspection
    || Date.parse(remote.inspection.inspectedAt) > Date.parse(local.inspection.inspectedAt))) {
    return { ...local, inspection: remote.inspection };
  }
  return local;
}
