import type { VisualFocusBox } from "./index";

export type ComponentMapStatus = "needs_view" | "inspected" | "not_visible";

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
  version: 1 | 2;
  id: string;
  overview: { lookupId: string; photoId: string };
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
