import type { Lookup, ShopJob } from "./index";

/** Available eligible scans only; explicit conflicting membership is separate. */
export type JobInspectionContext = {
  job: ShopJob;
  scans: Lookup[];
  unavailableScanIds: string[];
  conflictingScanIds: string[];
};

/** IDs and difference field names only. This is coverage, never vehicle-match proof. */
export type JobInspectionReportScope = {
  version: 1;
  jobId: string;
  rootLookupId: string;
  jobScanIds: string[];
  includedJobScanIds: string[];
  excludedJobScanIds: string[];
  /** Unavailable in the device context and still absent from the completed snapshot. */
  unavailableJobScanIds: string[];
  outsideJobScanIds: string[];
  conflictingJobScanIds: string[];
  vehicleDifferences: { lookupId: string; fields: string[] }[];
};
