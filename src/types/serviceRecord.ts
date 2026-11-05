import type { VehicleContext } from "./index";

/** Human-entered evidence, stored independently of AI results and inspection summaries. */
export type ServiceRecordCommon = {
  version: 1;
  id: string;
  lookupId: string;
  recordedAt: string;
  occurredOn: string | null;
  recordedBy: string;
  basis: "personally_performed" | "reported_by_another" | "transcribed_document";
  subject: string;
  photoIds: string[];
  analysisAttemptId?: string;
  vehicleContext?: VehicleContext;
  notes: string;
  supersedesId?: string;
  correctionReason?: string;
};

export type ServiceRecord = ServiceRecordCommon & (
  | { kind: "measurement"; quantity: string; reading: string | null; unit: string; method: string; instrument: string; conditions: string; noReadingReason: string }
  | { kind: "repair"; action: string; status: "planned" | "completed" | "attempted" | "unknown"; parts: string }
  | { kind: "follow_up"; check: string; outcome: "not_checked" | "symptom_observed" | "symptom_not_observed" | "inconclusive"; conditions: string; relatedRecordIds: string[] }
  | { kind: "retraction"; supersedesId: string; correctionReason: string }
);

export type ServiceRecordKind = ServiceRecord["kind"];
