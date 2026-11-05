import type { ScanPhotoLabel, VehicleContext } from "./index";

/** A historical reference to one original, never a generated crop or cutout. */
export type ComparisonSide = {
  lookupId: string;
  photoId: string;
  photoLabel: ScanPhotoLabel;
  photoAddedAt: string;
  scanSavedAt: string;
  sha256: string;
  width: number;
  height: number;
  observedOn: string | null;
  vehicleContext: VehicleContext | null;
  analysisAttemptId?: string;
};

export type InspectionComparison = {
  id: string;
  /** The follow-up scan owns this immutable history bucket. */
  lookupId: string;
  recordedAt: string;
  subject: string;
  earlier: ComparisonSide;
  current: ComparisonSide;
  relationship: {
    sameVehicle: boolean;
    component: "unconfirmed" | "same_part" | "replacement_same_location" | "different";
    basis: string;
  };
  conditions: {
    angle: "similar" | "different" | "unknown";
    lighting: "similar" | "different" | "unknown";
    surfaceNotes: string;
  };
  observation: {
    outcome: "not_reviewed" | "change_observed" | "no_obvious_change" | "inconclusive";
    notes: string;
  };
  /** Reversible display-only transform of the follow-up; originals are retained. */
  alignment: { rotation: number; scale: number; offsetX: number; offsetY: number };
  supersedesId?: string;
  correctionReason?: string;
} & (
  | { version: 1; requestedEvidence?: never; analysisSha256?: never }
  | { version: 2; requestedEvidence: RequestedEvidenceGuide; analysisSha256: string }
);

/** Immutable receipt of a requested photo capture; it does not resolve the request. */
export type RequestedInspectionComparison = Extract<InspectionComparison, { version: 2 }>;

/** A saved AI suggestion, not an instruction or evidence that it was resolved. */
export type RequestedEvidenceGuide = {
  version: 1;
  kind: "photo" | "marking";
  request: string;
  purpose: string;
  /** Empty means the saved request did not cite particular originals. */
  photoIds: string[];
  analysisAttemptId?: string;
};

/** Stored with the actual photo draft, including the reserved destination IDs. */
export type ComparisonCaptureTarget = {
  comparisonId: string;
  lookupId: string;
  earlier: ComparisonSide;
  subject: string;
} & (
  | { version: 1; requestedEvidence?: never; analysisSha256?: never }
  | { version: 2; requestedEvidence: RequestedEvidenceGuide; analysisSha256: string }
);
