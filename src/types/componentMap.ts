import type { VisualFocusBox } from "./index";

export type ComponentMapStatus = "needs_view" | "inspected" | "not_visible";

/** Exact saved overview file identity; it does not verify the depicted component. */
export type MapOverviewSource = {
  sha256: string;
  width: number;
  height: number;
  photoAddedAt: string;
  scanSavedAt: string;
};

export type ComponentMapScanGroup = { linkId: string; lookupId: string; photoIds: string[] };

export type ComponentMapComponent = {
  id: string;
  label: string;
  status: ComponentMapStatus;
  notes: string;
  reviewedAt?: string;
  region?: { sourcePhotoId: string; box: VisualFocusBox };
  suggestedLocation?: { source: "ai_scene"; text: string };
  scanGroups: ComponentMapScanGroup[];
};

export type ComponentMap = {
  version: 1 | 2 | 3;
  id: string;
  overview: { lookupId: string; photoId: string; source?: MapOverviewSource };
  components: ComponentMapComponent[];
};

export type ComponentCaptureTarget = { mapId: string; componentId: string; linkAttemptId: string; lookupId: string };

export type ComponentMapRecord = {
  document: ComponentMap;
  localRevision: number;
  cloudRevision: number | null;
  syncedLocalRevision: number;
  syncAttempt?: { id: string; localRevision: number; startedAt: string };
  conflict?: { document: ComponentMap; revision: number };
};
