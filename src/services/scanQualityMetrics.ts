import type { ScanQualityFailureReason } from "../types";

export type { ScanQualityFailureReason };

export type ScanQualityMetrics = {
  acceptableScans: number;
  attempts: number;
  failuresByReason: Record<ScanQualityFailureReason, number>;
  firstPassSuccesses: number;
  identifyLatency: { count: number; totalMs: number; maxMs: number; overBudget: number };
  manualCorrections: number;
  needsBetterPhotoByCamera: Record<string, { needsBetterPhoto: number; total: number }>;
  retakesByReason: Record<ScanQualityFailureReason, number>;
  totalTimeToAcceptableMs: number;
  trustScores: { count: number; total: number };
  updatedAt: string | null;
};

export const SCAN_QUALITY_METRICS_KEY = "deep-spec:scan-quality-metrics";

const EMPTY_REASON_COUNTS: Record<ScanQualityFailureReason, number> = {
  lens_covered: 0,
  needs_better_photo: 0,
  object_too_small: 0,
  too_bright: 0,
  too_blurry: 0,
  too_dark: 0,
};

export function getScanQualityMetrics(): ScanQualityMetrics {
  if (!hasLocalStorage()) {
    return createEmptyMetrics();
  }

  try {
    const raw = localStorage.getItem(SCAN_QUALITY_METRICS_KEY);
    if (!raw) {
      return createEmptyMetrics();
    }

    return normalizeMetrics(JSON.parse(raw) as unknown);
  } catch {
    return createEmptyMetrics();
  }
}

export function recordScanAttempt() {
  updateMetrics((metrics) => ({
    ...metrics,
    attempts: metrics.attempts + 1,
  }));
}

export function recordScanQualityFailure(reason: ScanQualityFailureReason) {
  updateMetrics((metrics) => ({
    ...metrics,
    failuresByReason: incrementReason(metrics.failuresByReason, reason),
  }));
}

export function recordScanQualityRetake(reason: ScanQualityFailureReason) {
  updateMetrics((metrics) => ({
    ...metrics,
    retakesByReason: incrementReason(metrics.retakesByReason, reason),
  }));
}

export function recordAcceptableScan({
  cameraId,
  firstPass,
  timeToAcceptableMs,
}: {
  cameraId: string;
  firstPass: boolean;
  timeToAcceptableMs: number;
}) {
  updateMetrics((metrics) => {
    const cameraKey = getCameraKey(cameraId);
    const currentCamera = metrics.needsBetterPhotoByCamera[cameraKey] ?? { needsBetterPhoto: 0, total: 0 };

    return {
      ...metrics,
      acceptableScans: metrics.acceptableScans + 1,
      firstPassSuccesses: metrics.firstPassSuccesses + (firstPass ? 1 : 0),
      needsBetterPhotoByCamera: {
        ...metrics.needsBetterPhotoByCamera,
        [cameraKey]: {
          ...currentCamera,
          total: currentCamera.total + 1,
        },
      },
      totalTimeToAcceptableMs: metrics.totalTimeToAcceptableMs + Math.max(0, timeToAcceptableMs),
    };
  });
}

export function recordNeedsBetterPhoto(cameraId: string) {
  updateMetrics((metrics) => {
    const cameraKey = getCameraKey(cameraId);
    const currentCamera = metrics.needsBetterPhotoByCamera[cameraKey] ?? { needsBetterPhoto: 0, total: 0 };

    return {
      ...metrics,
      failuresByReason: incrementReason(metrics.failuresByReason, "needs_better_photo"),
      needsBetterPhotoByCamera: {
        ...metrics.needsBetterPhotoByCamera,
        [cameraKey]: {
          ...currentCamera,
          needsBetterPhoto: currentCamera.needsBetterPhoto + 1,
          total: currentCamera.total + 1,
        },
      },
    };
  });
}

export function recordIdentifyLatency(latencyMs: number, overBudget: boolean) {
  const normalized = Math.max(0, Math.round(latencyMs));
  updateMetrics((metrics) => ({
    ...metrics,
    identifyLatency: {
      count: metrics.identifyLatency.count + 1,
      totalMs: metrics.identifyLatency.totalMs + normalized,
      maxMs: Math.max(metrics.identifyLatency.maxMs, normalized),
      overBudget: metrics.identifyLatency.overBudget + (overBudget ? 1 : 0),
    },
  }));
}

export function recordManualCorrection() {
  updateMetrics((metrics) => ({
    ...metrics,
    manualCorrections: metrics.manualCorrections + 1,
  }));
}

export function recordUserTrustScore(score: number) {
  const normalized = Math.max(1, Math.min(5, Math.round(score)));
  updateMetrics((metrics) => ({
    ...metrics,
    trustScores: {
      count: metrics.trustScores.count + 1,
      total: metrics.trustScores.total + normalized,
    },
  }));
}

function updateMetrics(update: (metrics: ScanQualityMetrics) => ScanQualityMetrics) {
  if (!hasLocalStorage()) {
    return;
  }

  try {
    const next = {
      ...update(getScanQualityMetrics()),
      updatedAt: new Date().toISOString(),
    };
    localStorage.setItem(SCAN_QUALITY_METRICS_KEY, JSON.stringify(next));
  } catch {
    // Metrics should never block scanning.
  }
}

function normalizeMetrics(value: unknown): ScanQualityMetrics {
  if (!isRecord(value)) {
    return createEmptyMetrics();
  }

  const empty = createEmptyMetrics();
  return {
    acceptableScans: getCount(value.acceptableScans),
    attempts: getCount(value.attempts),
    failuresByReason: normalizeReasonCounts(value.failuresByReason),
    firstPassSuccesses: getCount(value.firstPassSuccesses),
    identifyLatency: isRecord(value.identifyLatency)
      ? {
          count: getCount(value.identifyLatency.count),
          totalMs: getCount(value.identifyLatency.totalMs),
          maxMs: getCount(value.identifyLatency.maxMs),
          overBudget: getCount(value.identifyLatency.overBudget),
        }
      : empty.identifyLatency,
    manualCorrections: getCount(value.manualCorrections),
    needsBetterPhotoByCamera: normalizeCameraStats(value.needsBetterPhotoByCamera),
    retakesByReason: normalizeReasonCounts(value.retakesByReason),
    totalTimeToAcceptableMs: getCount(value.totalTimeToAcceptableMs),
    trustScores: isRecord(value.trustScores)
      ? {
          count: getCount(value.trustScores.count),
          total: getCount(value.trustScores.total),
        }
      : empty.trustScores,
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : null,
  };
}

function normalizeReasonCounts(value: unknown) {
  const counts = { ...EMPTY_REASON_COUNTS };
  if (!isRecord(value)) {
    return counts;
  }

  for (const reason of Object.keys(counts) as ScanQualityFailureReason[]) {
    counts[reason] = getCount(value[reason]);
  }

  return counts;
}

function normalizeCameraStats(value: unknown) {
  if (!isRecord(value)) {
    return {};
  }

  const stats: ScanQualityMetrics["needsBetterPhotoByCamera"] = {};
  for (const [cameraId, cameraStats] of Object.entries(value)) {
    if (!isRecord(cameraStats)) {
      continue;
    }

    stats[cameraId] = {
      needsBetterPhoto: getCount(cameraStats.needsBetterPhoto),
      total: getCount(cameraStats.total),
    };
  }

  return stats;
}

function incrementReason(
  counts: Record<ScanQualityFailureReason, number>,
  reason: ScanQualityFailureReason,
) {
  return {
    ...counts,
    [reason]: counts[reason] + 1,
  };
}

function createEmptyMetrics(): ScanQualityMetrics {
  return {
    acceptableScans: 0,
    attempts: 0,
    failuresByReason: { ...EMPTY_REASON_COUNTS },
    firstPassSuccesses: 0,
    identifyLatency: { count: 0, totalMs: 0, maxMs: 0, overBudget: 0 },
    manualCorrections: 0,
    needsBetterPhotoByCamera: {},
    retakesByReason: { ...EMPTY_REASON_COUNTS },
    totalTimeToAcceptableMs: 0,
    trustScores: { count: 0, total: 0 },
    updatedAt: null,
  };
}

function getCount(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

function getCameraKey(cameraId: string) {
  return cameraId.trim() || "unknown";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function hasLocalStorage() {
  return typeof localStorage !== "undefined";
}
