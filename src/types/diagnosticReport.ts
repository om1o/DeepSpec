import type { ComparisonSide } from "./inspectionComparison";

export type DiagnosticEncoding = "utf-8" | "windows-1252";

/** Immutable original. Parsed fields are derived again from these exact bytes. */
export type DiagnosticDocument = {
  version: 1;
  id: string;
  lookupId: string;
  importedAt: string;
  fileName: string;
  mime: string;
  byteLength: number;
  sha256: string;
  encoding: DiagnosticEncoding;
  sourceBase64: string;
};

export type DiagnosticReading = {
  id: string;
  label: string;
  rawValue: string;
  line: number;
};

export type DiagnosticFault = {
  id: string;
  vendorCode: string;
  genericCode: string | null;
  description: string;
  /** The exact report's status/elaboration lines, without inferring absent flags. */
  details: { text: string; line: number }[];
  freezeFrames: { id: string; line: number; readings: DiagnosticReading[] }[];
  startLine: number;
  endLine: number;
};

export type DiagnosticController = {
  id: string;
  address: string;
  name: string;
  declaredFaultCount: number | null;
  faultCoverage: "present" | "explicitly_absent" | "unknown";
  faults: DiagnosticFault[];
  readiness: { text: string; line: number }[];
  startLine: number;
  endLine: number;
};

export type ParsedDiagnosticReport = {
  parser: "vcds-autoscan-text-v1";
  format: "vcds_autoscan" | "unrecognized";
  /** Completeness describes parsing of this file, never health of the car. */
  coverage: "complete" | "incomplete" | "unrecognized";
  sourceVersion: string | null;
  exampleVersionMatched: boolean;
  reportedTime: string | null;
  reportedVin: string | null;
  reportedMileage: string | null;
  inventory: { text: string; line: number }[];
  controllers: DiagnosticController[];
  warnings: { message: string; line?: number }[];
  lineCount: number;
};

/** Human association only. Original diagnostic output and AI results stay separate. */
export type DiagnosticAssociation = {
  version: 1;
  id: string;
  lookupId: string;
  documentId: string;
  sourceSha256: string;
  recordedAt: string;
  subject: string;
  /** Empty means the whole report, otherwise exact parsed controller/fault/reading IDs. */
  entryIds: string[];
  photos: ComparisonSide[];
  vehicleRelationship: "unconfirmed" | "same_vehicle" | "different_vehicle";
  basis: string;
  notes: string;
  supersedesId?: string;
  correctionReason?: string;
};

export type DiagnosticBundle = {
  documents: DiagnosticDocument[];
  associations: DiagnosticAssociation[];
};
