import type { ComparisonSide } from "./inspectionComparison";

/** Historical AI request text; recording a response does not resolve it. */
export type RequestedMeasurementGuide = {
  version: 1;
  kind: "measurement";
  request: string;
  purpose: string;
  photoIds: string[];
  analysisAttemptId?: string;
};

/** Exact request/result association, with every cited original in citation order. */
export type RequestedMeasurementReceipt = {
  version: 1;
  guide: RequestedMeasurementGuide;
  analysisSha256: string;
  references: ComparisonSide[];
};
