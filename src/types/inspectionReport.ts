import type { Lookup } from "./index";
import type { ComponentMapRecord } from "./componentMap";

export type InspectionReportIssue = {
  kind: "map" | "lookup" | "photo" | "cutout";
  lookupId: string;
  photoId?: string;
  selectionName?: string;
  message: string;
};

/** A frozen export snapshot. Image fields contain embedded safe raster data or an empty string, never remote URLs. */
export type InspectionReportSnapshot = {
  version: 1;
  createdAt: string;
  rootLookupId: string;
  map: ComponentMapRecord | null;
  scans: Lookup[];
  missing: InspectionReportIssue[];
  embeddedBytes: number;
};

export type InspectionReportOptions = {
  includeVin: boolean;
  includePrivateNotes: boolean;
};

export const DEFAULT_INSPECTION_REPORT_OPTIONS: InspectionReportOptions = { includeVin: false, includePrivateNotes: false };
