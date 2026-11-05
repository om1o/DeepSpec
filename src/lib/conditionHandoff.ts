import type { Lookup } from "../types";
import { normalizeConditionAssessment } from "./conditionAssessment";
import { PHOTO_LABEL_TEXT } from "./photoLabels";
import { isEvidenceImage, normalizeVisualEvidence } from "../services/visualEvidence";
import { normalizeVehicleContext, vehicleContextDetails } from "./vehicleContext";

/** Derive the screen and export from the same saved evidence, never review ratings. */
export function buildConditionHandoff(lookup: Lookup) {
  const evidence = normalizeVisualEvidence(lookup);
  const photos = evidence?.photos
    ? evidence.photos.map((photo, index) => ({ id: photo.id, label: `${index + 1}. ${PHOTO_LABEL_TEXT[photo.label]}` }))
    : evidence && isEvidenceImage(lookup.frame.imageBase64) ? [{ id: "photo-1", label: "Original photo" }] : [];
  const assessment = normalizeConditionAssessment(lookup.result?.conditionAssessment, photos.map((photo) => photo.id));
  const vehicle = normalizeVehicleContext(lookup.vehicleContext);
  const vehicleName = vehicle ? [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ") : "";
  const vehicleDetails: [string, string][] = vehicle
    ? [...(vehicleName ? [["Vehicle", vehicleName] as [string, string]] : []), ...vehicleContextDetails(vehicle)] : [];
  return {
    assessment,
    photos,
    vehicleDetails,
    observations: assessment?.observations ?? [],
    possibleCauses: assessment?.possibleCauses ?? [],
    unknowns: assessment?.unknowns ?? [],
    nextEvidence: assessment?.nextEvidence,
    functionStatus: lookup.inspection
      ? `${lookup.inspection.functionalStatus.replaceAll("_", " ")} (self-reported by ${lookup.inspection.inspectorName || "unnamed inspector"})`
      : "Not tested; no human inspection recorded.",
  };
}

export function formatConditionHandoff(lookup: Lookup): string {
  const review = buildConditionHandoff(lookup);
  const vehicleLines = review.vehicleDetails.length
    ? ["Vehicle details supplied for this scan:", ...review.vehicleDetails.map(([label, value]) => `${label}: ${value}`)]
    : [];
  // Vehicle intake exists independently of a successful condition assessment.
  if (!review.assessment) return vehicleLines.join("\n");
  const photoLabel = (id: string) => `${review.photos.find((photo) => photo.id === id)!.label} [${id}]`;
  return [
    ...(vehicleLines.length ? [...vehicleLines, ""] : ["Vehicle details: not supplied.", ""]),
    "Condition evidence (AI-reported, not human confirmation):",
    "Observed appearance:",
    ...(review.observations.length ? review.observations.map((item) => `- [${item.id}] ${item.text} — ${item.photoIds.map(photoLabel).join(", ")}${item.regionLabel ? ` — area described: ${item.regionLabel}` : ""}`) : ["No photo-linked observations returned."]),
    "Possible causes — unconfirmed:",
    ...(review.possibleCauses.length ? review.possibleCauses.map((item) => `- ${item.text} — based on observations ${item.observationIds.join(", ")}`) : ["Cause not established."]),
    "Still unknown:",
    ...(review.unknowns.length ? review.unknowns.map((item) => `- ${item}`) : ["No unknowns listed; this is not proof of condition, function or safety."]),
    ...(review.nextEvidence ? ["Priority next evidence:", review.nextEvidence.request, `Why: ${review.nextEvidence.purpose}`] : ["Priority next evidence: not specified."]),
    `Functional checks: ${review.functionStatus}`,
    "Photo references are listed here; this text export does not embed the images.",
  ].join("\n");
}
