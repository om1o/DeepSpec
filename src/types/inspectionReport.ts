import type { Lookup } from "./index";
import type { ComponentMapRecord } from "./componentMap";
import type { ServiceRecord } from "./serviceRecord";
import type { InspectionComparison, RequestedInspectionComparison } from "./inspectionComparison";
import type { DiagnosticBundle, ParsedDiagnosticReport } from "./diagnosticReport";

export type InspectionReportIssue = {
  kind: "map" | "lookup" | "photo" | "cutout" | "service_records" | "comparisons" | "diagnostics";
  lookupId: string;
  photoId?: string;
  selectionName?: string;
  message: string;
};

export type MapOverviewReportEvidence = {
  status: "unchanged" | "source_changed" | "missing_photo" | "verification_unavailable" | "legacy_unverified";
  message: string;
};

/** A frozen export snapshot. Image fields contain embedded safe raster data or an empty string, never remote URLs. */
export type InspectionReportSnapshot = {
  version: 1;
  createdAt: string;
  rootLookupId: string;
  map: ComponentMapRecord | null;
  mapOverviewEvidence?: MapOverviewReportEvidence;
  linkedPhotoEvidence?: {
    componentId: string;
    linkId: string;
    lookupId: string;
    photoId: string;
    status: MapOverviewReportEvidence["status"];
    message: string;
    currentMetadataChanged?: boolean;
  }[];
  scans: Lookup[];
  missing: InspectionReportIssue[];
  embeddedBytes: number;
  serviceLogs?: { lookupId: string; records: ServiceRecord[]; cloudChecked: boolean }[];
  comparisonLogs?: { lookupId: string; records: InspectionComparison[]; cloudChecked: boolean }[];
  /** Reverse discovery is device-only; complete never means all cloud/device history. */
  requestedEvidenceHistory?: {
    originLookupId: string;
    source: "device";
    cloudSearched: false;
    records: RequestedInspectionComparison[];
    complete: boolean;
    reason?: string;
    scannedBuckets: number;
  };
  diagnosticLogs?: { lookupId: string; bundle: DiagnosticBundle; parsed: { id: string; report: ParsedDiagnosticReport }[]; cloudChecked: boolean }[];
  diagnosticEvidence?: { lookupId: string; recordId: string; photoId: string; status: "unchanged" | "source_changed" | "missing_photo" | "verification_unavailable" }[];
  comparisonEvidence?: {
    lookupId: string;
    recordId: string;
    side: "earlier" | "current";
    status: "unchanged" | "source_changed" | "missing_photo" | "verification_unavailable";
  }[];
};

export type InspectionReportOptions = {
  includeVin: boolean;
  includePrivateNotes: boolean;
  includeDiagnosticOriginals?: boolean;
};

export const DEFAULT_INSPECTION_REPORT_OPTIONS: InspectionReportOptions = { includeVin: false, includePrivateNotes: false, includeDiagnosticOriginals: false };
