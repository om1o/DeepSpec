import {
  SCAN_QUALITY_METRICS_KEY,
  getScanQualityMetrics,
  recordAcceptableScan,
  recordManualCorrection,
  recordNeedsBetterPhoto,
  recordScanAttempt,
  recordScanQualityFailure,
  recordScanQualityRetake,
  recordUserTrustScore,
} from "./scanQualityMetrics";

describe("scanQualityMetrics", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("records the quality coach metrics used by history", () => {
    recordScanAttempt();
    recordScanQualityFailure("too_blurry");
    recordScanQualityRetake("too_blurry");
    recordAcceptableScan({
      cameraId: "rear-camera",
      firstPass: false,
      timeToAcceptableMs: 2400,
    });
    recordNeedsBetterPhoto("rear-camera");
    recordManualCorrection();
    recordUserTrustScore(5);

    expect(getScanQualityMetrics()).toMatchObject({
      acceptableScans: 1,
      attempts: 1,
      failuresByReason: {
        needs_better_photo: 1,
        object_too_small: 0,
        too_bright: 0,
        too_blurry: 1,
        too_dark: 0,
      },
      firstPassSuccesses: 0,
      manualCorrections: 1,
      needsBetterPhotoByCamera: {
        "rear-camera": {
          needsBetterPhoto: 1,
          total: 2,
        },
      },
      retakesByReason: {
        needs_better_photo: 0,
        object_too_small: 0,
        too_bright: 0,
        too_blurry: 1,
        too_dark: 0,
      },
      totalTimeToAcceptableMs: 2400,
      trustScores: {
        count: 1,
        total: 5,
      },
    });
  });

  it("falls back to empty metrics when stored data is corrupt", () => {
    localStorage.setItem(SCAN_QUALITY_METRICS_KEY, "{bad-json");

    expect(getScanQualityMetrics()).toMatchObject({
      acceptableScans: 0,
      attempts: 0,
      manualCorrections: 0,
      updatedAt: null,
    });
  });
});
