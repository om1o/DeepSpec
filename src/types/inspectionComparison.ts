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
  version: 1;
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
};

/** Stored with the actual photo draft, including the reserved destination IDs. */
export type ComparisonCaptureTarget = {
  version: 1;
  comparisonId: string;
  lookupId: string;
  earlier: ComparisonSide;
  subject: string;
};
