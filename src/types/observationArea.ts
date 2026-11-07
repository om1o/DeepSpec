import type { ConditionObservation } from "./index";
import type { ComparisonSide } from "./inspectionComparison";

/** Human geometry in the selected original's coordinate space, without confidence. */
export type ObservationAreaRectangle = { x: number; y: number; width: number; height: number };
export type ObservationAreaBinding = {
  version: 1;
  observation: ConditionObservation;
  analysisSha256: string;
  analysisAttemptId?: string;
  reference: ComparisonSide;
};
type Common = {
  version: 1;
  id: string;
  lookupId: string;
  recordedAt: string;
  binding: ObservationAreaBinding;
  notes: string;
};
export type ObservationAreaRecord = Common & (
  | { kind: "mark"; rectangle: ObservationAreaRectangle; supersedesId?: string; correctionReason?: string }
  | { kind: "retraction"; rectangle?: never; supersedesId: string; correctionReason: string }
);
/** A pending area is not a saved annotation or evidence that its source is current. */
export type ObservationAreaDraft = {
  version: 1;
  id: string;
  lookupId: string;
  recordedAt: string;
  updatedAt: string;
  binding: ObservationAreaBinding;
  expectedHeadId: string | null;
  kind: "mark" | "retraction";
  rectangle: ObservationAreaRectangle | null;
  notes: string;
  correctionReason: string;
};
export type ObservationAreaRecordStatus = "current" | "superseded" | "retracted" | "conflicting";
export type ObservationAreaGroup = {
  key: string;
  binding: ObservationAreaBinding;
  records: ObservationAreaRecord[];
  heads: ObservationAreaRecord[];
  /** Null for a fork. Never select a winner using device timestamps. */
  head: ObservationAreaRecord | null;
  status: "current" | "retracted" | "conflicting";
};
