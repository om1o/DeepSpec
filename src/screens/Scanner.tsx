import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import Webcam from "react-webcam";
import { Link, useLocation, useNavigate } from "react-router-dom";
import Button from "../components/ui/Button";
import { useCamera, type CameraDevice } from "../hooks/useCamera";
import { useObjectTarget, type CameraObjectTarget } from "../hooks/useObjectTarget";
import { useStillness } from "../hooks/useStillness";
import { assessImageQuality, type ImageQualityIssue, type ImageQualityResult } from "../lib/imageQuality";
import { createFocusedScanCrop } from "../lib/focusCrop";
import { getCachedScanResult, hashImageDataUrl, setCachedScanResult } from "../lib/scanCache";
import { getScanCardPreferences, type ScanCardPreferences, updateScanCardPreferences } from "../lib/scanResultCardSettings";
import { detectObjectTargetFromImageData, type ObjectTargetBox } from "../lib/objectTargeting";
import { compressImageDataUrl, saveLatestScanState } from "../lib/utils";
import { AIServiceError, getAIErrorMessage, identifyCapturedFrame } from "../services/aiService";
import { onOnDeviceModelProgress } from "../services/onDeviceIdentify";
import { getCloudSyncStatus, syncLookupToCloud } from "../services/cloudSync";
import { attachScanToJob, buildCustomerVisibleReport, getShopJob, getVehicleContextForJob } from "../services/shop";
import {
  recordAcceptableScan,
  recordIdentifyLatency,
  recordManualCorrection,
  recordNeedsBetterPhoto,
  recordScanAttempt,
  recordScanQualityFailure,
  recordScanQualityRetake,
} from "../services/scanQualityMetrics";
import { createLookup, updateLookup } from "../services/storage";
import type { Confidence, IdentificationResult, CapturedFrame, Lookup, ScanAnalysisSource, ScanAnalysisState, ScanCaptureMode, ScanQualitySnapshot, ShopJob, ShopVehicleContext } from "../types";

const AUTO_SCAN_HOLD_MS = 5000;
const SECOND_FRAME_DELAY_MS = 120;
const IDENTIFY_BUDGET_WARN_MS = 15000;
const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;
const COMPRESS_UPLOAD_OVER_BYTES = 1024 * 1024;
const SCAN_CARD_WIDTH_PX = 340;
const SCAN_CARD_SAFE_HEIGHT_PX = 560;
const MIN_TARGET_WIDTH_PX = 96;
const MIN_TARGET_HEIGHT_PX = 72;
const MIN_TARGET_AREA_RATIO = 0.018;
const MIN_AUTOSCAN_OBJECT_AREA_RATIO = 0.045;
const MIN_AUTOSCAN_CENTERED_SCORE = 68;
const MIN_AUTOSCAN_CONFIDENCE = 0.55;
const MATCH_THRESHOLD = 140;
const METRIC_FASTENER_WIDTHS_MM = [6, 7, 8, 10, 12, 13, 14, 16, 17, 18, 19, 21, 22, 24];
const SAE_FASTENER_WIDTHS = [
  { label: "1/4 in", mm: 6.35 },
  { label: "5/16 in", mm: 7.94 },
  { label: "3/8 in", mm: 9.53 },
  { label: "7/16 in", mm: 11.11 },
  { label: "1/2 in", mm: 12.7 },
  { label: "9/16 in", mm: 14.29 },
  { label: "5/8 in", mm: 15.88 },
  { label: "11/16 in", mm: 17.46 },
  { label: "3/4 in", mm: 19.05 },
];

const DEFAULT_VIDEO_CONSTRAINTS: MediaTrackConstraints = {
  facingMode: { ideal: "environment" },
  width: { ideal: 1920 },
  height: { ideal: 1080 },
};

type ScanReviewResultSource = "AI detection" | "metadata" | "user correction";

type ScanReviewTarget = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
  normalized?: ObjectTargetBox;
};

type ScanReviewState = {
  lookup: Lookup | null;
  scanState: ScanAnalysisState;
  correction: string | null;
  source: ScanReviewResultSource;
  sourceUpdatedAt: string;
  reviewTarget: ScanReviewTarget | null;
};

type ReviewCardPlacement = {
  left: number;
  top: number;
  anchorSide: "left" | "right";
};

type ScanQualityCoachIssue = ImageQualityIssue | "object_too_small";

type ScanQualityCoachState = {
  action: string;
  issue: ScanQualityCoachIssue;
  progress: string;
  title: string;
};

type SizeReferencePreset = "card_short_edge" | "card_long_edge" | "us_quarter" | "us_nickel";

type AutoScanGuide = "move_closer" | "center_part" | "hold_still" | null;

type SizeCalibration = {
  capturedAt: string;
  guidance: string;
  preset: SizeReferencePreset;
  referenceMm: number;
  referencePx: number;
};

type MeasurementGateResult =
  | {
      ok: true;
      uncertainty: string;
    }
  | {
      ok: false;
      message: string;
    };

function buildShopScanContext(job: ShopJob | null, vehicleContext: ShopVehicleContext | undefined): Partial<ScanAnalysisState> {
  if (!job) {
    return {};
  }

  return {
    customerVisibleReport: buildCustomerVisibleReport(job),
    jobId: job.id,
    orgId: job.orgId,
    reviewStatus: "needs_review",
    vehicleContext,
  };
}

function applyShopFitmentContext(result: IdentificationResult, vehicleContext: ShopVehicleContext | undefined): IdentificationResult {
  if (!vehicleContext) {
    return result;
  }

  const requiredNextEvidence = Array.from(new Set([
    ...(result.requiredNextEvidence ?? []),
    ...(!vehicleContext.vin ? ["VIN"] : []),
    "label photo or second angle if the part number is not visible",
  ]));

  return {
    ...result,
    fitmentConfidence: vehicleContext.vin ? result.fitmentConfidence ?? "possible" : "needs_vehicle_context",
    requiredNextEvidence,
  };
}

export default function Scanner() {
  const location = useLocation();
  const navigate = useNavigate();
  const activeShopJob = useMemo(() => {
    const jobId = new URLSearchParams(location.search).get("jobId");
    return jobId ? getShopJob(jobId) : null;
  }, [location.search]);
  const activeShopVehicleContext = useMemo(
    () => (activeShopJob ? getVehicleContextForJob(activeShopJob) : undefined),
    [activeShopJob],
  );
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisStep, setAnalysisStep] = useState<string | null>(null);
  const [autoScanPaused, setAutoScanPaused] = useState(false);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [scanReview, setScanReview] = useState<ScanReviewState | null>(null);
  const [scanCardPrefs, setScanCardPrefs] = useState<ScanCardPreferences>(() => getScanCardPreferences(location.pathname));
  const [scanCardStatusMessage, setScanCardStatusMessage] = useState<string | null>(null);
  const [isCardExpanded, setIsCardExpanded] = useState(false);
  const [isReplacingLabel, setIsReplacingLabel] = useState(false);
  const [replacementLabel, setReplacementLabel] = useState("");
  const [qualityCoach, setQualityCoach] = useState<ScanQualityCoachState | null>(null);
  const [sizeReferencePreset, setSizeReferencePreset] = useState<SizeReferencePreset>("card_short_edge");
  const [sizeCalibration, setSizeCalibration] = useState<SizeCalibration | null>(null);
  const cancelScanRef = useRef(false);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const activeIdentifyRef = useRef(false);
  const autoScanStartedRef = useRef(false);
  const lastAutoScanTargetIdRef = useRef<string | null>(null);
  const qualityFailureInAttemptRef = useRef(false);
  const lastQualityFailureRef = useRef<ScanQualityCoachIssue | null>(null);
  const activeScanStartedAtRef = useRef(0);
  const scanRequestIdRef = useRef(0);

  useEffect(() => {
    performance.mark("scanner:route-ready");
    if (import.meta.env.DEV) {
      try {
        const measure = performance.measure("boot-to-scanner", "app:boot", "scanner:route-ready");
        console.log(`[DeepSpec] scanner route ready in ${Math.round(measure.duration)}ms`);
      } catch {
        // app:boot may be absent outside a full app boot (e.g. unit tests).
      }
    }
  }, []);

  const {
    cameraDevices,
    cameraError,
    cameraRequestId,
    cameraState,
    captureFrame,
    markError,
    markReady,
    retryCamera,
    selectCamera,
    selectedCameraId,
    webcamRef,
  } = useCamera();
  const activeVideoConstraints = useMemo(
    () => getVideoConstraints(selectedCameraId),
    [selectedCameraId],
  );
  const isRetakeGuide = useMemo(() => new URLSearchParams(location.search).get("guide") === "retake", [location.search]);
  const { isStable, usesFallback } = useStillness();
  const objectTarget = useObjectTarget(webcamRef, {
    enabled: cameraState === "ready" && !isAnalyzing && !scanReview,
    holdDurationMs: cameraState === "ready" && isStable && !isAnalyzing && !autoScanPaused && !scanReview
      ? AUTO_SCAN_HOLD_MS
      : undefined,
    holdEnabled: cameraState === "ready" && isStable && !isAnalyzing && !autoScanPaused && !scanReview,
  });
  const targetProgress = objectTarget?.holdProgress ?? 0;
  const hasTargetLock = Boolean(objectTarget?.isLocked);
  const isTargetTooSmallNow = objectTarget ? isObjectTargetTooSmall(objectTarget) : false;
  const autoScanReadiness = getAutoScanReadiness(objectTarget, {
    isStable,
    isTargetTooSmall: isTargetTooSmallNow,
    usesFallback,
  });
  const isAutoScanReady = autoScanReadiness.isReady;
  const autoScanGuide = autoScanReadiness.guide;
  const autoScanSeconds = Math.max(1, Math.ceil((1 - targetProgress) * (AUTO_SCAN_HOLD_MS / 1000)));
  const scannerStatus = getScannerStatus({
    autoScanGuide,
    autoScanPaused,
    autoScanSeconds,
    cameraState,
    hasTarget: Boolean(objectTarget),
    hasTargetLock,
    isStable,
    isTargetTooSmall: isTargetTooSmallNow,
    qualityCoach,
    scanReview,
    usesFallback,
  });

  const anchoredReviewTarget = useMemo(
    () => getAnchoredReviewTarget(scanReview?.reviewTarget ?? null, objectTarget),
    [objectTarget, scanReview?.reviewTarget],
  );

  const isMismatch = scanReview?.reviewTarget && objectTarget
    ? isTargetMismatch(scanReview.reviewTarget, objectTarget)
    : false;

  const reviewCardPlacement = getReviewCardPlacement(anchoredReviewTarget);

  const pauseAutoScan = useCallback((message?: string) => {
    const shouldPause = Boolean(message);
    setAutoScanPaused(shouldPause);
    setCaptureError(message ?? null);
    autoScanStartedRef.current = false;
    if (shouldPause) {
      window.setTimeout(() => setAutoScanPaused(false), 1800);
    }
  }, []);

  const stopForQualityCoach = useCallback((issue: ScanQualityCoachIssue) => {
    qualityFailureInAttemptRef.current = true;
    lastQualityFailureRef.current = issue;
    recordScanQualityFailure(issue);
    setQualityCoach(getScanQualityCoach(issue));
    setCaptureError(null);
    setAutoScanPaused(true);
    autoScanStartedRef.current = false;
    window.setTimeout(() => setAutoScanPaused(false), 1800);
  }, []);

  const beginScanRequest = useCallback(() => {
    cancelScanRef.current = false;
    setAutoScanPaused(false);
    setCaptureError(null);
    const previousQualityIssue = qualityCoach?.issue ?? null;
    if (qualityCoach) {
      recordScanQualityRetake(qualityCoach.issue);
    } else {
      lastQualityFailureRef.current = null;
    }
    setQualityCoach(null);
    recordScanAttempt();
    qualityFailureInAttemptRef.current = Boolean(previousQualityIssue);
    activeScanStartedAtRef.current = Date.now();
    scanRequestIdRef.current += 1;
    return scanRequestIdRef.current;
  }, [qualityCoach]);

  const recordScanOutcome = useCallback((result: IdentificationResult) => {
    if (result.needsBetterPhoto || result.safetyTriage === "needs_better_photo") {
      recordNeedsBetterPhoto(selectedCameraId);
      return;
    }

    recordAcceptableScan({
      cameraId: selectedCameraId,
      firstPass: !qualityFailureInAttemptRef.current,
      timeToAcceptableMs: activeScanStartedAtRef.current ? Date.now() - activeScanStartedAtRef.current : 0,
    });
  }, [selectedCameraId]);

  const syncSavedLookup = useCallback((lookup: Lookup) => {
    if (!getCloudSyncStatus().configured) {
      return;
    }

    setScanCardStatusMessage("Saving to cloud dataset.");
    void syncLookupToCloud(lookup)
      .then((result) => {
        setScanCardStatusMessage(result.ok ? "Saved to cloud dataset." : result.message);
      });
  }, []);

  const isScanRequestActive = useCallback((requestId: number) => (
    scanRequestIdRef.current === requestId && !cancelScanRef.current
  ), []);

  const persistAndShowReview = useCallback((
    scanState: ScanAnalysisState,
    options: {
      captureMode: ScanCaptureMode;
      requestId: number;
      reviewTarget: ScanReviewTarget | null;
      source: ScanReviewResultSource;
      analysisSource: ScanAnalysisSource;
      sourceUpdatedAt: string;
      correction?: string | null;
    },
  ) => {
    const source = options.source;
    const sourceUpdatedAt = options.sourceUpdatedAt;
    if (!isScanRequestActive(options.requestId)) {
      return;
    }

    const saved = createLookup(scanState);
    if (saved.ok) {
      if (activeShopJob) {
        attachScanToJob(activeShopJob.id, saved.value.id);
      }
      saveLatestScanState(scanState);
      setIsCardExpanded(!scanCardPrefs.compactCardsByDefault);
      setScanReview({
        correction: options.correction ?? saved.value.correction,
        lookup: saved.value,
        reviewTarget: options.reviewTarget,
        scanState,
        source,
        sourceUpdatedAt,
      });
      syncSavedLookup(saved.value);
      return;
    }

    const fallbackState = {
      ...scanState,
      storageWarning: saved.message,
    };
    saveLatestScanState(fallbackState);
    setIsCardExpanded(!scanCardPrefs.compactCardsByDefault);
    setScanReview({
      correction: options.correction ?? null,
      lookup: null,
      reviewTarget: options.reviewTarget,
      scanState: fallbackState,
      source,
      sourceUpdatedAt,
    });
  }, [activeShopJob, isScanRequestActive, scanCardPrefs.compactCardsByDefault, syncSavedLookup]);

  const analyzeImageBase64 = useCallback(async (
    imageBase64: string,
    requestId: number,
    captureMode: ScanCaptureMode,
    secondFrameProvider?: () => Promise<string>,
    reviewTargetOverride?: CameraObjectTarget,
  ) => {
    const sourceUpdatedAt = new Date().toISOString();
    const uploadReviewTarget = !reviewTargetOverride && captureMode === "upload"
      ? await getReviewTargetFromUploadedImage(imageBase64)
      : null;
    if (!isScanRequestActive(requestId)) return;
    const reviewTarget = reviewTargetOverride ? getReviewTargetFromObject(reviewTargetOverride) : uploadReviewTarget;

    if (reviewTarget && isReviewTargetTooSmall(reviewTarget)) {
      stopForQualityCoach("object_too_small");
      return;
    }

    setAnalysisStep("Checking photo quality");
    const quality = await assessImageQuality(imageBase64);
    if (!isScanRequestActive(requestId)) return;
    if (!quality.ok) {
      stopForQualityCoach(quality.issue);
      return;
    }
    const scanQuality = buildScanQualitySnapshot({
      cameraId: selectedCameraId,
      firstPass: !qualityFailureInAttemptRef.current,
      motionFallback: true,
      motionStable: true,
      previousFailureReason: lastQualityFailureRef.current,
      quality,
      target: reviewTargetOverride ?? null,
    });

    const frame: CapturedFrame = {
      imageBase64,
      capturedAt: new Date().toISOString(),
    };
    saveLatestScanState({ frame, scanQuality });

    setAnalysisStep("Checking saved matches");
    const imageHash = await hashImageDataUrl(imageBase64);
    if (!isScanRequestActive(requestId)) return;
    if (imageHash && !activeShopJob) {
      const cached = getCachedScanResult(imageHash);
      if (cached) {
        const shopScanContext = buildShopScanContext(activeShopJob, activeShopVehicleContext);
        const contextualResult = applyShopFitmentContext(cached, activeShopVehicleContext);
        setAnalysisStep("Opening review");
        recordScanOutcome(contextualResult);
        await persistAndShowReview(
          {
            frame,
            result: contextualResult,
            analyzedAt: new Date().toISOString(),
            scanQuality,
            ...shopScanContext,
            provenance: {
              analysisSource: "cached_match",
              captureMode,
              savedAt: new Date().toISOString(),
            },
          },
          {
            captureMode,
            requestId,
            reviewTarget,
            analysisSource: "cached_match",
            source: "metadata",
            sourceUpdatedAt,
          },
        );
        return;
      }
    }

    let focusedFrame: CapturedFrame | undefined;
    let secondFrame: CapturedFrame | undefined;
    const focusedCropTarget = reviewTargetOverride?.normalized ?? uploadReviewTarget?.normalized ?? null;
    const focusedCrop = focusedCropTarget
      ? await createFocusedScanCrop(imageBase64, focusedCropTarget)
      : null;
    if (!isScanRequestActive(requestId)) return;
    if (focusedCrop) {
      const cropQuality = await assessImageQuality(focusedCrop);
      if (!isScanRequestActive(requestId)) return;
      if (cropQuality.ok) {
        focusedFrame = { imageBase64: focusedCrop, capturedAt: new Date().toISOString() };
      } else {
        stopForQualityCoach(cropQuality.issue);
        return;
      }
    }

    if (!focusedFrame && !secondFrame && secondFrameProvider) {
      await new Promise<void>((resolve) => setTimeout(resolve, SECOND_FRAME_DELAY_MS));
      if (!isScanRequestActive(requestId)) return;
      try {
        const second = await secondFrameProvider();
        const secondQuality = await assessImageQuality(second);
        if (secondQuality.ok) {
          secondFrame = { imageBase64: second, capturedAt: new Date().toISOString() };
        }
      } catch {
        // A second frame helps confidence but is not required.
      }
    }

    try {
      setAnalysisStep("Matching vehicle data");
      const identifyStartedAt = performance.now();
      const result = applyShopFitmentContext(
        await identifyCapturedFrame(frame, focusedFrame ?? secondFrame, undefined, {
          vehicleContext: activeShopVehicleContext,
        }),
        activeShopVehicleContext,
      );
      const identifyMs = Math.round(performance.now() - identifyStartedAt);
      recordIdentifyLatency(identifyMs, identifyMs > IDENTIFY_BUDGET_WARN_MS);
      if (identifyMs > IDENTIFY_BUDGET_WARN_MS) {
        console.warn(`[DeepSpec] Identify took ${identifyMs}ms (over ${IDENTIFY_BUDGET_WARN_MS}ms budget).`);
      }
      if (!isScanRequestActive(requestId)) return;
      if (imageHash && !activeShopJob) setCachedScanResult(imageHash, result);
      recordScanOutcome(result);
      setAnalysisStep("Saving result");
      const shopScanContext = buildShopScanContext(activeShopJob, activeShopVehicleContext);
      await persistAndShowReview(
        {
          frame,
          result,
          analyzedAt: new Date().toISOString(),
          scanQuality,
          ...shopScanContext,
          provenance: {
            analysisSource: "ai_detection",
            captureMode,
            savedAt: new Date().toISOString(),
          },
        },
        {
          captureMode,
          requestId,
          reviewTarget,
          analysisSource: "ai_detection",
          source: "AI detection",
          sourceUpdatedAt,
        },
      );
    } catch (analysisError) {
      if (!isScanRequestActive(requestId)) return;
      await persistAndShowReview(
        {
          frame,
          errorMessage: getAIErrorMessage(analysisError),
          errorCode: analysisError instanceof AIServiceError ? analysisError.code : "analysis_failed",
          analyzedAt: new Date().toISOString(),
          scanQuality,
          ...buildShopScanContext(activeShopJob, activeShopVehicleContext),
          provenance: {
            analysisSource: "ai_detection",
            captureMode,
            savedAt: new Date().toISOString(),
          },
        },
        {
          captureMode,
          requestId,
          reviewTarget,
          analysisSource: "ai_detection",
          source: "AI detection",
          sourceUpdatedAt,
        },
      );
    }
  }, [activeShopJob, activeShopVehicleContext, isScanRequestActive, persistAndShowReview, recordScanOutcome, selectedCameraId, stopForQualityCoach]);

  const handleIdentify = useCallback(async (reviewTargetOverride?: CameraObjectTarget) => {
    if (isAnalyzing || activeIdentifyRef.current) {
      return;
    }

    activeIdentifyRef.current = true;
    const reviewTarget = reviewTargetOverride ?? objectTarget ?? undefined;
    const requestId = beginScanRequest();
    try {
      setIsAnalyzing(true);
      setAnalysisStep("Capturing photo");
      setCaptureError(null);
      const imageBase64 = await captureFrame();
      if (!isScanRequestActive(requestId)) return;

      await analyzeImageBase64(imageBase64, requestId, "camera", captureFrame, reviewTarget);
    } catch (error) {
      if (isScanRequestActive(requestId)) {
        pauseAutoScan(error instanceof Error ? error.message : "Capture failed. Try again.");
      }
    } finally {
      if (isScanRequestActive(requestId)) {
        setIsAnalyzing(false);
        setAnalysisStep(null);
      }
      activeIdentifyRef.current = false;
    }
  }, [analyzeImageBase64, beginScanRequest, captureFrame, isAnalyzing, isScanRequestActive, objectTarget, pauseAutoScan]);

  const handleGalleryFile = useCallback(async (file: File) => {
    if (isAnalyzing) {
      return;
    }

    const requestId = beginScanRequest();
    try {
      setIsAnalyzing(true);
      setAnalysisStep("Loading photo");
      setCaptureError(null);
      const rawImageBase64 = await readImageFileAsDataUrl(file);
      if (!isScanRequestActive(requestId)) return;
      const imageBase64 = file.size > COMPRESS_UPLOAD_OVER_BYTES
        ? await compressImageDataUrl(rawImageBase64, 1024, 0.8)
        : rawImageBase64;
      if (!isScanRequestActive(requestId)) return;
      await analyzeImageBase64(imageBase64, requestId, "upload");
    } catch (error) {
      if (isScanRequestActive(requestId)) {
        pauseAutoScan(error instanceof Error ? error.message : "Could not read that photo.");
      }
    } finally {
      if (isScanRequestActive(requestId)) {
        setIsAnalyzing(false);
        setAnalysisStep(null);
      }
    }
  }, [analyzeImageBase64, beginScanRequest, isAnalyzing, isScanRequestActive, pauseAutoScan]);

  const retryReviewScan = useCallback(async () => {
    if (!scanReview?.reviewTarget) {
      return;
    }

    setScanCardStatusMessage("Rescanning this point.");
    const override = getObjectTargetFromReviewTarget(scanReview.reviewTarget);
    await handleIdentify(override);
  }, [handleIdentify, scanReview]);

  const handleFlipCamera = useCallback(() => {
    if (cameraDevices.length < 2) return;
    const currentIndex = cameraDevices.findIndex((d) => d.deviceId === selectedCameraId);
    const nextIndex = (currentIndex + 1) % cameraDevices.length;
    selectCamera(cameraDevices[nextIndex].deviceId);
  }, [cameraDevices, selectedCameraId, selectCamera]);

  const applyLabelCorrection = useCallback((correction: string) => {
    if (!scanReview) return;

    if (!scanReview.lookup) {
      recordManualCorrection();
      setScanReview({
        ...scanReview,
        correction,
        source: "user correction",
        sourceUpdatedAt: new Date().toISOString(),
      });
      setScanCardStatusMessage("Label replacement saved locally.");
      return;
    }

    const lookupUpdate = updateLookup(scanReview.lookup.id, { correction });
    if (!lookupUpdate.ok) {
      setScanCardStatusMessage(lookupUpdate.message);
      return;
    }
    if (!lookupUpdate.value) {
      setScanCardStatusMessage("This saved scan was not found.");
      return;
    }

    setScanReview({
      ...scanReview,
      correction,
      lookup: lookupUpdate.value,
      source: "user correction",
      sourceUpdatedAt: new Date().toISOString(),
    });
    recordManualCorrection();
    setScanCardStatusMessage("Label replacement applied.");
    syncSavedLookup(lookupUpdate.value);
  }, [scanReview, syncSavedLookup]);

  const handleReportReplace = useCallback(() => {
    const trimmed = replacementLabel.trim();
    if (!trimmed) {
      setScanCardStatusMessage("Enter the replacement label.");
      return;
    }

    applyLabelCorrection(trimmed);
    setIsReplacingLabel(false);
    setReplacementLabel("");
  }, [applyLabelCorrection, replacementLabel]);

  const handleUndoCorrection = useCallback(() => {
    if (!scanReview) {
      return;
    }

    if (!scanReview.lookup) {
      setScanReview({
        ...scanReview,
        correction: null,
        source: "AI detection",
        sourceUpdatedAt: new Date().toISOString(),
      });
      setScanCardStatusMessage("Label correction removed.");
      return;
    }

    const result = updateLookup(scanReview.lookup.id, { correction: null });
    if (!result.ok) {
      setScanCardStatusMessage(result.message);
      return;
    }
    if (!result.value) {
      setScanCardStatusMessage("This saved scan was not found.");
      return;
    }

    setScanReview({
      ...scanReview,
      correction: null,
      lookup: result.value,
      source: "AI detection",
      sourceUpdatedAt: new Date().toISOString(),
    });
    setScanCardStatusMessage("Label correction removed.");
    syncSavedLookup(result.value);
  }, [scanReview, syncSavedLookup]);

  const handleCopyLabel = useCallback(async () => {
    if (!scanReview) {
      return;
    }

    const label = getReviewDisplayLabel(scanReview);
    const confidence = scanReview.scanState.result?.confidence;
    const copied = await copyText(
      confidence ? `${label} | ${scanReview.scanState.result?.scanCategory ?? "unknown"} | ${confidence}` : label,
    );
    setScanCardStatusMessage(copied ? "Label copied." : "Copy blocked. Try again.");
  }, [scanReview]);

  const handleSetSizeReference = useCallback(() => {
    if (!scanReview?.reviewTarget) {
      setScanCardStatusMessage("No target lock yet. Center a reference object first.");
      return;
    }

    const referenceMm = getSizeReferenceMm(sizeReferencePreset);
    const referencePx = getReferencePixels(scanReview.reviewTarget, sizeReferencePreset);
    if (referencePx < 36) {
      setScanCardStatusMessage("Reference target is too small. Move closer and lock the object.");
      return;
    }

    setSizeCalibration({
      capturedAt: new Date().toISOString(),
      guidance: getSizeReferenceGuidance(sizeReferencePreset),
      preset: sizeReferencePreset,
      referenceMm,
      referencePx,
    });
    setScanCardStatusMessage(`${getSizeReferenceLabel(sizeReferencePreset)} saved. ${getSizeReferenceGuidance(sizeReferencePreset)}`);
  }, [scanReview, sizeReferencePreset]);

  const handleReviewMeasure = useCallback(async () => {
    if (!scanReview?.reviewTarget) {
      setScanCardStatusMessage("No point to measure yet.");
      return;
    }

    if (!sizeCalibration) {
      setScanCardStatusMessage("Set a reference first (card or coin) to estimate mm size.");
      return;
    }

    const measurementGate = getMeasurementGate(scanReview.reviewTarget, sizeCalibration);
    if (!measurementGate.ok) {
      setScanCardStatusMessage(measurementGate.message);
      return;
    }

    const widthMm = estimateMm(scanReview.reviewTarget.width, sizeCalibration);
    const heightMm = estimateMm(scanReview.reviewTarget.height, sizeCalibration);
    const longestEdgeMm = Math.max(widthMm, heightMm);
    const label = getReviewDisplayLabel(scanReview);
    const fastenerHint = /nut|bolt|screw|stud|thread|fastener/i.test(label)
      ? getFastenerSizeHint(Math.max(widthMm, heightMm))
      : null;
    const summary = fastenerHint
      ? `${label}: ${widthMm.toFixed(1)} x ${heightMm.toFixed(1)} mm (same-plane estimate). Longest edge ${longestEdgeMm.toFixed(1)} mm. ${fastenerHint} ${sizeCalibration.guidance} Uncertainty: ${measurementGate.uncertainty}.`
      : `${label}: ${widthMm.toFixed(1)} x ${heightMm.toFixed(1)} mm (same-plane estimate). Longest edge ${longestEdgeMm.toFixed(1)} mm. ${sizeCalibration.guidance} Uncertainty: ${measurementGate.uncertainty}.`;

    const copied = await copyText(summary);
    setScanCardStatusMessage(
      copied
        ? "Same-plane size estimate copied. Verify with a caliper before ordering parts."
        : summary,
    );
  }, [scanReview, sizeCalibration]);

  const handleOpenDetails = useCallback(() => {
    if (!scanReview) {
      return;
    }

    saveLatestScanState(scanReview.scanState);
    if (scanReview.lookup) {
      navigate(`/result/${scanReview.lookup.id}`);
      return;
    }

    navigate("/result", { state: scanReview.scanState });
  }, [navigate, scanReview]);

  useEffect(() => {
    if (!isAutoScanReady || cameraState !== "ready" || isAnalyzing || autoScanPaused || scanReview) {
      return;
    }

    const autoTargetId = objectTarget?.id ?? null;
    if (!autoTargetId || autoScanStartedRef.current || lastAutoScanTargetIdRef.current === autoTargetId) {
      return;
    }

    autoScanStartedRef.current = true;
    lastAutoScanTargetIdRef.current = autoTargetId;
    pulseTargetLock();
    void handleIdentify();
  }, [autoScanPaused, cameraState, handleIdentify, isAnalyzing, isAutoScanReady, objectTarget?.id, scanReview]);

  useEffect(() => {
    if (!hasTargetLock && !isAnalyzing) {
      autoScanStartedRef.current = false;
      lastAutoScanTargetIdRef.current = null;
    }
  }, [hasTargetLock, isAnalyzing]);

  const toggleCompactCardMode = useCallback(() => {
    const updated = updateScanCardPreferences(location.pathname, {
      compactCardsByDefault: !scanCardPrefs.compactCardsByDefault,
    });
    setScanCardPrefs(updated);
    if (scanReview) {
      setIsCardExpanded(!updated.compactCardsByDefault);
    }
  }, [location.pathname, scanCardPrefs.compactCardsByDefault, scanReview]);

  const toggleHideConfidence = useCallback(() => {
    const updated = updateScanCardPreferences(location.pathname, {
      hideConfidence: !scanCardPrefs.hideConfidence,
    });
    setScanCardPrefs(updated);
  }, [location.pathname, scanCardPrefs.hideConfidence]);

  function cancelCurrentScan() {
    cancelScanRef.current = true;
    scanRequestIdRef.current += 1;
    setIsAnalyzing(false);
    setAnalysisStep(null);
    pauseAutoScan("Scan canceled. Hold the right item steady to try again.");
  }

  function closeScanReview() {
    setScanReview(null);
    setCaptureError(null);
    setIsReplacingLabel(false);
    setReplacementLabel("");
    setScanCardStatusMessage(null);
    pauseAutoScan();
    setIsCardExpanded(false);
  }

  return (
    <main className="relative min-h-dvh overflow-hidden bg-[var(--ds-bg)] text-white">
      {cameraState !== "blocked" ? (
        <Webcam
          key={cameraRequestId}
          ref={webcamRef}
          audio={false}
          className="absolute inset-0 h-full w-full object-cover"
          mirrored={false}
          screenshotFormat="image/jpeg"
          screenshotQuality={0.92}
          videoConstraints={activeVideoConstraints}
          onUserMedia={markReady}
          onUserMediaError={markError}
        />
      ) : null}
      {scanReview?.scanState.frame.imageBase64 ? (
        <img
          alt="Reviewed scan photo"
          className="pointer-events-none absolute inset-0 z-[1] h-full w-full object-cover"
          src={scanReview.scanState.frame.imageBase64}
        />
      ) : null}

      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_bottom,rgba(4,7,14,0.72),rgba(4,7,14,0)_28%,rgba(4,7,14,0)_55%,rgba(4,7,14,0.78))]" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[46dvh] bg-[radial-gradient(ellipse_at_50%_80%,rgba(0,170,255,0.12),rgba(4,7,14,0)_42%),linear-gradient(to_top,rgba(4,7,14,0.90),rgba(4,7,14,0))]" />

      <header className="fixed left-0 right-0 top-0 z-20 flex items-center justify-between px-4 pb-3 pt-[max(16px,env(safe-area-inset-top))]">
        <Link
          to="/history"
          aria-label="Open saved scan history"
          className="grid size-10 place-items-center rounded-full text-white"
          style={{
            background: "rgba(7,16,30,0.58)",
            border: "1px solid rgba(255,255,255,0.14)",
            backdropFilter: "blur(16px)",
          }}
        >
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
            <rect x="2" y="2" width="6" height="6" rx="1.5" fill="currentColor" opacity="0.85" />
            <rect x="10" y="2" width="6" height="6" rx="1.5" fill="currentColor" opacity="0.85" />
            <rect x="2" y="10" width="6" height="6" rx="1.5" fill="currentColor" opacity="0.85" />
            <rect x="10" y="10" width="6" height="6" rx="1.5" fill="currentColor" opacity="0.85" />
          </svg>
        </Link>
        <div className="flex flex-col items-center">
          <span
            className="text-[15px] font-black tracking-[-0.02em] text-white"
            style={{ textShadow: "0 1px 8px rgba(0,0,0,0.5)" }}
          >
            Deep Spec
          </span>
        </div>
        <button
          type="button"
          aria-label="Switch camera"
          onClick={handleFlipCamera}
          className="grid size-10 place-items-center rounded-full text-white"
          style={{
            background: "rgba(7,16,30,0.58)",
            border: "1px solid rgba(255,255,255,0.14)",
            backdropFilter: "blur(16px)",
          }}
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
            <path d="M6 4H14M14 4L11 1M14 4L11 7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M14 16H6M6 16L9 19M6 16L9 13" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </header>

      {activeShopJob ? (
        <Link
          to={`/shop/jobs/${encodeURIComponent(activeShopJob.id)}`}
          className="fixed left-4 right-4 top-[calc(max(16px,env(safe-area-inset-top))+56px)] z-20 rounded-[8px] border border-white/14 bg-slate-950/68 px-3 py-2 text-white shadow-[0_14px_34px_rgba(0,0,0,0.24)] backdrop-blur-md"
        >
          <p className="truncate text-xs font-extrabold uppercase tracking-[0.14em] text-[var(--ds-accent)]">Shop job</p>
          <p className="mt-1 truncate text-sm font-black">{activeShopJob.title}</p>
          <p className="mt-0.5 truncate text-xs font-semibold text-white/72">
            {activeShopJob.year} {activeShopJob.make} {activeShopJob.model} / {activeShopJob.technicianName}
          </p>
        </Link>
      ) : null}

      {cameraState === "loading" && !scanReview ? <CameraLoading /> : null}
      {cameraState === "blocked" && !scanReview ? (
        <CameraBlocked
          devices={cameraDevices}
          isRetakeGuide={isRetakeGuide}
          onGallery={() => galleryInputRef.current?.click()}
          message={cameraError}
          onRetry={retryCamera}
          onSelectCamera={selectCamera}
          selectedCameraId={selectedCameraId}
        />
      ) : null}

      {cameraState !== "blocked" ? (
        <>
          {cameraState === "ready" && !scanReview ? <ScannerHUD isAnalyzing={isAnalyzing} /> : null}
          {cameraState === "ready" && !scanReview ? (
            <>
              <LensViewfinderBrackets isAnalyzing={isAnalyzing} label={getReticleLabel({
                autoScanGuide,
                autoScanSeconds,
                hasTarget: Boolean(objectTarget),
                hasTargetLock,
                isTargetTooSmall: isTargetTooSmallNow,
                qualityCoach,
              })} progress={targetProgress} />
              <ScannerTargetStatus status={scannerStatus} />
            </>
          ) : null}
          {cameraState === "ready" && objectTarget && !scanReview && !isAnalyzing ? (
            <TapTargetButton
              isLocked={isAutoScanReady}
              isTooSmall={isTargetTooSmallNow}
              onSelect={() => void handleIdentify(objectTarget)}
              target={objectTarget}
            />
          ) : null}
          {qualityCoach ? (
            <ScanQualityCoachNotice
              coach={qualityCoach}
              onTryAgain={() => void handleIdentify()}
            />
          ) : null}
          {captureError ? <CaptureErrorNotice message={captureError} onTryAgain={() => setCaptureError(null)} /> : null}
          {isRetakeGuide && !qualityCoach && !isAnalyzing && !scanReview ? <RetakeGuideNotice /> : null}
        </>
      ) : null}

      {scanReview?.scanState.result ? (
        <LensPartOverlays result={scanReview.scanState.result} target={anchoredReviewTarget} />
      ) : null}
      {isAnalyzing ? <AnalyzingOverlay onCancel={cancelCurrentScan} step={analysisStep} /> : null}
      {scanReview ? (
        <ScanResultCard
          isExpanded={isCardExpanded}
          isMismatch={Boolean(isMismatch)}
          isReplacing={isReplacingLabel}
          target={anchoredReviewTarget}
          onCancelReplace={() => setIsReplacingLabel(false)}
          onClose={closeScanReview}
          onCopyValue={handleCopyLabel}
          onMeasure={handleReviewMeasure}
          onOpenDetails={handleOpenDetails}
          onRetryMismatch={retryReviewScan}
          onReportReplace={handleReportReplace}
          onUndoCorrection={handleUndoCorrection}
          onToggleExpand={() => setIsCardExpanded((value) => !value)}
          onToggleCompactMode={toggleCompactCardMode}
          onToggleHideConfidence={toggleHideConfidence}
          onSetSizeReference={handleSetSizeReference}
          onSizeReferencePresetChange={(preset) => setSizeReferencePreset(preset)}
          placement={reviewCardPlacement}
          prefs={scanCardPrefs}
          replacementLabel={replacementLabel}
          review={scanReview}
          scanCardStatusMessage={scanCardStatusMessage}
          sizeCalibration={sizeCalibration}
          sizeReferencePreset={sizeReferencePreset}
          onWrongLabel={() => {
            setReplacementLabel(scanReview?.scanState.result?.partName ?? "");
            setIsReplacingLabel(true);
            setScanCardStatusMessage(null);
          }}
          onReplacementLabelChange={setReplacementLabel}
        />
      ) : null}

      <input
        ref={galleryInputRef}
        aria-label="Upload photo"
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        disabled={isAnalyzing}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (file) void handleGalleryFile(file);
        }}
        type="file"
      />
      {!scanReview ? (
        <LensBottomBar
          isAnalyzing={isAnalyzing}
          isShutterDisabled={cameraState !== "ready" || isAnalyzing || isTargetTooSmallNow}
          onShutter={() => void handleIdentify()}
          onGallery={() => galleryInputRef.current?.click()}
          onFlip={handleFlipCamera}
        />
      ) : null}
    </main>
  );
}

function getVideoConstraints(deviceId: string): MediaTrackConstraints {
  if (!deviceId) {
    return DEFAULT_VIDEO_CONSTRAINTS;
  }

  return {
    deviceId: { exact: deviceId },
    width: DEFAULT_VIDEO_CONSTRAINTS.width,
    height: DEFAULT_VIDEO_CONSTRAINTS.height,
  };
}

function getScannerStatus({
  autoScanGuide,
  autoScanPaused,
  autoScanSeconds,
  cameraState,
  hasTarget,
  hasTargetLock,
  isStable,
  isTargetTooSmall,
  qualityCoach,
  scanReview,
  usesFallback,
}: {
  autoScanGuide: AutoScanGuide;
  autoScanPaused: boolean;
  autoScanSeconds: number;
  cameraState: string;
  hasTarget: boolean;
  hasTargetLock: boolean;
  isStable: boolean;
  isTargetTooSmall: boolean;
  qualityCoach: ScanQualityCoachState | null;
  scanReview: ScanReviewState | null;
  usesFallback: boolean;
}) {
  if (scanReview) {
    return "Review scan";
  }

  if (cameraState === "loading") {
    return "Opening camera";
  }

  if (autoScanPaused) {
    return "Scan paused";
  }

  if (qualityCoach) {
    return qualityCoach.action;
  }

  if (isTargetTooSmall || autoScanGuide === "move_closer") {
    return "Move closer";
  }

  if (autoScanGuide === "center_part") {
    return "Center part";
  }

  if (autoScanGuide === "hold_still") {
    return "Hold still";
  }

  if (hasTargetLock) {
    return "Locked";
  }

  if (hasTarget) {
    return getHoldStillCommand(autoScanSeconds);
  }

  if (!usesFallback && !isStable) {
    return "Hold still";
  }

  return "Center part";
}

function getAutoScanReadiness(
  target: CameraObjectTarget | null,
  {
    isStable,
    isTargetTooSmall,
    usesFallback,
  }: {
    isStable: boolean;
    isTargetTooSmall: boolean;
    usesFallback: boolean;
  },
): { guide: AutoScanGuide; isReady: boolean } {
  if (!target) {
    return { guide: null, isReady: false };
  }

  if (isTargetTooSmall) {
    return { guide: "move_closer", isReady: false };
  }

  const objectSizeRatio = getObjectSizeRatio(target);
  if (objectSizeRatio !== null && objectSizeRatio < MIN_AUTOSCAN_OBJECT_AREA_RATIO) {
    return { guide: "move_closer", isReady: false };
  }

  const centeredScore = getTargetCenteredScore(target);
  if (centeredScore !== null && centeredScore < MIN_AUTOSCAN_CENTERED_SCORE) {
    return { guide: "center_part", isReady: false };
  }

  if (target.confidence < MIN_AUTOSCAN_CONFIDENCE) {
    return { guide: "center_part", isReady: false };
  }

  if (!target.isLocked || target.holdProgress < 1) {
    return { guide: !usesFallback && !isStable ? "hold_still" : null, isReady: false };
  }

  if (!usesFallback && !isStable) {
    return { guide: "hold_still", isReady: false };
  }

  return { guide: null, isReady: true };
}

function getReticleLabel({
  autoScanGuide,
  autoScanSeconds,
  hasTarget,
  hasTargetLock,
  isTargetTooSmall,
  qualityCoach,
}: {
  autoScanGuide: AutoScanGuide;
  autoScanSeconds: number;
  hasTarget: boolean;
  hasTargetLock: boolean;
  isTargetTooSmall: boolean;
  qualityCoach: ScanQualityCoachState | null;
}) {
  if (qualityCoach) {
    return qualityCoach.action;
  }

  if (isTargetTooSmall || autoScanGuide === "move_closer") {
    return "Move closer";
  }

  if (autoScanGuide === "center_part") {
    return "Center part";
  }

  if (autoScanGuide === "hold_still") {
    return "Hold still";
  }

  if (hasTargetLock) {
    return "Locked";
  }

  if (hasTarget) {
    return getHoldStillCommand(autoScanSeconds);
  }

  return "Center part";
}

function getHoldStillCommand(autoScanSeconds: number) {
  return `Hold still ${Math.max(1, autoScanSeconds)}s`;
}

function buildScanQualitySnapshot({
  cameraId,
  firstPass,
  motionFallback,
  motionStable,
  previousFailureReason,
  quality,
  target,
}: {
  cameraId: string;
  firstPass: boolean;
  motionFallback: boolean;
  motionStable: boolean;
  previousFailureReason: ScanQualityCoachIssue | null;
  quality: Extract<ImageQualityResult, { ok: true }>;
  target: CameraObjectTarget | null;
}): ScanQualitySnapshot {
  const metrics = quality.metrics;
  const targetScore = getTargetCenteredScore(target);

  return {
    accepted: true,
    averageLuminance: metrics?.averageLuminance ?? null,
    brightPixelRatio: metrics?.brightPixelRatio ?? null,
    brightnessScore: metrics?.brightnessScore ?? null,
    cameraId: cameraId.trim() || "unknown",
    checkedAt: new Date().toISOString(),
    darkPixelRatio: metrics?.darkPixelRatio ?? null,
    firstPass,
    ...(previousFailureReason ? { fixAction: getScanQualityCoach(previousFailureReason).action } : {}),
    glareScore: metrics?.glareScore ?? null,
    gradientVariance: metrics?.gradientVariance ?? null,
    motionFallback,
    motionScore: motionFallback ? null : (motionStable ? 100 : 0),
    motionStable,
    objectSizeRatio: getObjectSizeRatio(target),
    ...(previousFailureReason ? { previousFailureReason } : {}),
    sampleHeight: metrics?.sampleHeight ?? null,
    sampleWidth: metrics?.sampleWidth ?? null,
    sharpnessScore: metrics?.sharpnessScore ?? null,
    targetCenteredScore: targetScore,
    targetConfidence: target?.confidence ?? null,
    targetLocked: Boolean(target?.isLocked),
  };
}

function getObjectSizeRatio(target: CameraObjectTarget | null) {
  if (!target) {
    return null;
  }

  if (target.normalized) {
    return roundRatio(clampNumber(target.normalized.width * target.normalized.height, 0, 1));
  }

  const viewportArea = window.innerWidth * window.innerHeight;
  return viewportArea > 0 ? roundRatio(clampNumber((target.width * target.height) / viewportArea, 0, 1)) : null;
}

function getTargetCenteredScore(target: CameraObjectTarget | null) {
  if (!target) {
    return null;
  }

  const center = target.normalized
    ? {
        x: target.normalized.x + target.normalized.width / 2,
        y: target.normalized.y + target.normalized.height / 2,
      }
    : {
        x: (target.left + target.width / 2) / window.innerWidth,
        y: (target.top + target.height / 2) / window.innerHeight,
      };
  const distance = Math.hypot(center.x - 0.5, center.y - 0.5);
  return Math.round(clampNumber((1 - distance / Math.SQRT1_2) * 100, 0, 100));
}

function pulseTargetLock() {
  if (typeof navigator !== "undefined" && "vibrate" in navigator) {
    try {
      navigator.vibrate([18, 36, 24]);
    } catch {
      // Haptics are optional scanner feedback.
    }
  }
}

function roundRatio(value: number) {
  return Math.round(value * 1000) / 1000;
}

function CameraLoading() {
  return (
    <div className="fixed inset-0 z-10 grid place-items-center bg-[var(--ds-bg)] px-6 text-center">
      <div className="rounded-[24px] border border-white/10 bg-white/8 p-5 shadow-2xl backdrop-blur-md" style={{ borderColor: "rgba(0,194,255,0.18)" }}>
        <div
          className="mx-auto size-12 animate-spin rounded-full border-2"
          style={{ borderColor: "rgba(0,194,255,0.14)", borderTopColor: "rgba(0,194,255,0.85)" }}
        />
        <p className="mt-4 text-sm font-extrabold text-white">Opening camera</p>
      </div>
    </div>
  );
}

function CameraBlocked({
  devices,
  isRetakeGuide,
  message,
  onGallery,
  onRetry,
  onSelectCamera,
  selectedCameraId,
}: {
  devices: CameraDevice[];
  isRetakeGuide: boolean;
  message: string | null;
  onGallery: () => void;
  onRetry: () => void;
  onSelectCamera: (deviceId: string) => void;
  selectedCameraId: string;
}) {
  const denied = /denied|notallowed/i.test(message ?? "");
  const waiting = /permission.*waiting|camera prompt/i.test(message ?? "");
  const hasCameraChoices = devices.length > 1;

  return (
    <div className="fixed inset-0 z-30 grid place-items-center bg-[var(--ds-bg)] px-6 text-center">
      <div className="max-w-sm">
        <div className="mx-auto mb-5 grid size-14 place-items-center rounded-2xl border border-[var(--ds-danger-line)] bg-[var(--ds-danger-soft)] text-[var(--ds-danger)]">
          !
        </div>
        <h1 className="text-2xl font-extrabold tracking-tight">Camera access needed</h1>
        <p className="mt-3 text-sm leading-6 text-[#A1A1AA]">
          Deep Spec needs your camera to scan parts. {denied || waiting ? "Allow camera access for this site, then try again." : "Check camera access, then try again."}
        </p>
        {isRetakeGuide ? (
          <div className="mt-5 rounded-[18px] border border-white/12 bg-white/[0.06] px-4 py-3">
            <p className="text-xs font-extrabold uppercase tracking-[0.16em] text-[var(--ds-accent)]">Retake guide</p>
            <p className="mt-1 text-sm font-black text-white">Fill the frame from a slight angle.</p>
            <p className="mt-1 text-xs font-semibold leading-5 text-white/64">Use upload if camera access is blocked.</p>
          </div>
        ) : null}
        {message ? <p className="mt-3 text-xs text-white/48">{message}</p> : null}
        {hasCameraChoices ? (
          <label className="mx-auto mt-5 block max-w-xs text-left">
            <span className="mb-2 block text-xs font-black uppercase tracking-[0.16em] text-white/54">Camera</span>
            <select
              className="h-11 w-full rounded-[8px] border border-white/12 bg-slate-950 px-3 text-sm font-bold text-white outline-none focus:border-[var(--ds-accent)]"
              onChange={(event) => onSelectCamera(event.target.value)}
              value={selectedCameraId}
            >
              <option value="">Default camera</option>
              {devices.map((device) => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <div className="mt-6 grid gap-3">
          <Button onClick={onGallery}>
            Upload photo
          </Button>
          <Button variant="ghost" onClick={onRetry}>
            Try camera again
          </Button>
        </div>
        <button className="mx-auto mt-4 block text-xs font-bold text-white/48 underline underline-offset-4" onClick={() => window.location.reload()}>
          Reload app
        </button>
      </div>
    </div>
  );
}

export function AnalyzingOverlay({ onCancel, step }: { onCancel: () => void; step: string | null }) {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [downloadPercent, setDownloadPercent] = useState<number | null>(null);
  useEffect(() => {
    const startedAt = Date.now();
    const interval = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, []);
  useEffect(
    () => onOnDeviceModelProgress((progress) => setDownloadPercent(progress.stage === "ready" ? null : progress.percent)),
    [],
  );
  const stillWorking = elapsedSeconds >= 8;
  const message =
    downloadPercent !== null
      ? `Downloading offline model… ${downloadPercent}% — one-time, keep this screen open.`
      : stillWorking
        ? "Still working — larger photos take a few more seconds."
        : step ?? "Matching the scan against vehicle data.";

  return (
    <div className="fixed inset-0 z-40 grid place-items-center px-6 text-center" style={{ background: "rgba(4,7,14,0.82)", backdropFilter: "blur(16px)" }}>
      <div className="w-full max-w-xs overflow-hidden rounded-[24px] p-6 shadow-2xl" style={{ background: "rgba(7,16,30,0.96)", border: "1px solid rgba(0,194,255,0.18)" }}>
        <div className="relative mx-auto grid size-24 place-items-center">
          <div className="absolute inset-0 rounded-full" style={{ border: "1px solid rgba(0,194,255,0.12)" }} />
          <div
            className="absolute inset-2 animate-spin rounded-full border-2"
            style={{ borderColor: "rgba(0,194,255,0.10)", borderTopColor: "rgba(0,194,255,0.82)" }}
          />
          <div className="absolute inset-7 rounded-full" style={{ background: "rgba(0,194,255,0.12)", boxShadow: "0 0 28px rgba(0,170,255,0.40)" }} />
          <div className="scanner-analysis-sweep absolute inset-x-3 top-1/2 h-0.5 rounded-full" style={{ background: "var(--electric-500)" }} />
        </div>
        <p className="mt-5 text-lg font-extrabold tracking-tight text-white">Analyzing photo</p>
        <p className="mt-2 text-sm leading-6" style={{ color: "var(--slate-300)" }}>
          {message}
        </p>
        <p className="mt-2 text-xs font-semibold tabular-nums" style={{ fontFamily: "var(--font-data)", color: "var(--slate-500)" }}>{elapsedSeconds}s elapsed</p>
        <Button className="mt-5 w-full" variant="ghost" onClick={onCancel}>
          Cancel scan
        </Button>
      </div>
    </div>
  );
}

function ScanQualityCoachNotice({
  coach,
  onTryAgain,
}: {
  coach: ScanQualityCoachState;
  onTryAgain: () => void;
}) {
  return (
    <div
      className="fixed bottom-[210px] left-1/2 z-30 w-[calc(100%-28px)] max-w-sm -translate-x-1/2 overflow-hidden rounded-[22px] text-center text-white"
      style={{
        background: "rgba(7,16,30,0.96)",
        border: "1px solid rgba(0,194,255,0.18)",
        backdropFilter: "blur(28px) saturate(1.4)",
        boxShadow: "0 24px 60px rgba(0,0,0,0.55)",
      }}
    >
      <div className="px-5 py-4" style={{ background: "rgba(0,194,255,0.07)", borderBottom: "1px solid rgba(0,194,255,0.12)" }}>
        <p style={{ fontFamily: "var(--font-data)", fontSize: 10, fontWeight: 600, letterSpacing: "0.14em", color: "#55C8FF", textTransform: "uppercase" }}>
          {coach.progress}
        </p>
        <h2 className="mt-1 text-[22px] font-black tracking-tight">{coach.title}</h2>
      </div>
      <div className="px-5 py-4">
        <p className="text-base font-black leading-6 text-white">{coach.action}</p>
        <p className="mt-1 text-sm font-medium leading-6" style={{ color: "var(--slate-300)" }}>
          Try this exact fix, then scan again.
        </p>
        <button
          className="mt-4 w-full rounded-[12px] py-3 text-[13px] font-bold text-white"
          style={{ background: "var(--blue-500)", boxShadow: "0 4px 18px rgba(20,105,236,0.30)" }}
          onClick={onTryAgain}
          type="button"
        >
          Scan again
        </button>
      </div>
    </div>
  );
}

function RetakeGuideNotice() {
  return (
    <div
      className="fixed bottom-[198px] left-1/2 z-20 w-[calc(100%-28px)] max-w-sm -translate-x-1/2 rounded-[18px] px-4 py-3 text-center text-white"
      style={{
        background: "rgba(7,16,30,0.90)",
        border: "1px solid rgba(0,194,255,0.16)",
        backdropFilter: "blur(20px) saturate(1.3)",
        boxShadow: "0 16px 44px rgba(0,0,0,0.45)",
      }}
    >
      <p style={{ fontFamily: "var(--font-data)", fontSize: 10, fontWeight: 600, letterSpacing: "0.14em", color: "#55C8FF", textTransform: "uppercase" }}>
        Retake guide
      </p>
      <p className="mt-1 text-sm font-black">Fill the frame from a slight angle.</p>
      <p className="mt-1 text-xs font-medium leading-5" style={{ color: "var(--slate-400)" }}>
        Keep labels, bolt heads, or connectors visible.
      </p>
    </div>
  );
}

type LensEvidenceChip = {
  id: string;
  label: string;
  detail: string;
};

function LensPartOverlays({ result, target }: { result: IdentificationResult; target: ScanReviewTarget | null }) {
  if (!target) {
    return null;
  }

  const focusTarget = getPartFocusedReviewTarget(target, result.partName);
  const contextBox = targetToLensBox(target);
  const targetBox = targetToLensBox(focusTarget);
  const showContextBox = isFocusedTargetDifferent(target, focusTarget);
  const evidenceChips = getLensEvidenceChips(result);

  return (
    <div className="pointer-events-none fixed inset-0 z-40" aria-label="Detected target overlay">
      {showContextBox ? (
        <div
          data-testid="lens-context-overlay"
          className="absolute rounded-[18px]"
          style={{
            height: contextBox.height,
            left: contextBox.left,
            top: contextBox.top,
            width: contextBox.width,
            border: "1px dashed rgba(125,211,252,0.34)",
            background: "rgba(0,194,255,0.018)",
            boxShadow: "inset 0 0 28px rgba(0,170,255,0.08)",
          }}
        />
      ) : null}

      <div
        data-testid="lens-part-overlay-0"
        className="absolute rounded-[16px]"
        style={{
          height: targetBox.height,
          left: targetBox.left,
          top: targetBox.top,
          width: targetBox.width,
          border: "1.5px solid rgba(0,194,255,0.78)",
          background: "rgba(0,194,255,0.045)",
          boxShadow: "0 0 18px rgba(0,170,255,0.22)",
        }}
      >
        <div
          className="absolute left-2 top-2 flex max-w-[min(220px,62vw)] items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-bold text-white shadow-[0_8px_20px_rgba(0,0,0,0.40)]"
          style={{
            backdropFilter: "blur(14px)",
            background: "rgba(0,170,255,0.82)",
          }}
        >
          <span data-testid="lens-primary-label" className="min-w-0 truncate">{result.partName}</span>
          <span
            className="shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.04em]"
            style={{ background: "rgba(0,0,0,0.28)", color: "rgba(255,255,255,0.80)" }}
          >
            {result.confidence}
          </span>
        </div>

        <div className="absolute left-1/2 top-1/2 h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/70 shadow-[0_0_18px_rgba(255,255,255,0.32)]">
          <span className="absolute left-1/2 top-[-10px] h-2.5 w-px -translate-x-1/2 bg-white/70" />
          <span className="absolute bottom-[-10px] left-1/2 h-2.5 w-px -translate-x-1/2 bg-white/70" />
          <span className="absolute left-[-10px] top-1/2 h-px w-2.5 -translate-y-1/2 bg-white/70" />
          <span className="absolute right-[-10px] top-1/2 h-px w-2.5 -translate-y-1/2 bg-white/70" />
        </div>

        {evidenceChips.length ? (
          <div className="absolute left-0 top-full mt-2 flex max-w-[min(320px,88vw)] flex-wrap gap-1.5">
            {evidenceChips.map((chip) => (
              <span
                key={chip.id}
                data-testid="lens-evidence-chip"
                className="rounded-full px-2.5 py-1 text-[10px] font-bold text-white shadow-[0_8px_18px_rgba(0,0,0,0.35)]"
                style={{
                  backdropFilter: "blur(12px)",
                  background: "rgba(7,16,30,0.82)",
                  border: "1px solid rgba(0,194,255,0.22)",
                }}
              >
                {chip.label}: {chip.detail}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function getLensEvidenceChips(result: IdentificationResult): LensEvidenceChip[] {
  const primaryLabel = result.partName.trim().toLowerCase();
  return result.evidenceRegions
    .filter((region) => region.label.trim().toLowerCase() !== primaryLabel)
    .slice(0, 5)
    .map((region) => ({
      id: `region:${region.regionLabel}:${region.label}`,
      label: region.label,
      detail: summarize(region.observation || region.regionLabel, 34),
    }));
}

function getPartFocusedReviewTarget(target: ScanReviewTarget, partName: string): ScanReviewTarget {
  const normalized = partName.toLowerCase().replace(/[-_]/g, " ");
  const focus = getPartFocusBox(normalized);

  if (!focus || target.width < 220 || target.height < 180) {
    return target;
  }

  return clampReviewTarget({
    ...target,
    height: target.height * focus.height,
    width: target.width * focus.width,
    x: target.x + target.width * focus.x,
    y: target.y + target.height * focus.y,
  });
}

function getPartFocusBox(partName: string) {
  if (/\b(front |rear |back )?bumper\b/.test(partName)) {
    return { height: 0.28, width: 0.72, x: 0.14, y: 0.64 };
  }

  if (/\bfront door\b/.test(partName)) {
    return { height: 0.44, width: 0.34, x: 0.50, y: 0.32 };
  }

  if (/\b(rear|back) door\b/.test(partName)) {
    return { height: 0.44, width: 0.34, x: 0.36, y: 0.34 };
  }

  if (/\b(car )?door\b/.test(partName)) {
    return { height: 0.42, width: 0.46, x: 0.26, y: 0.34 };
  }

  if (/\bquarter panel\b/.test(partName)) {
    return { height: 0.46, width: 0.32, x: 0.64, y: 0.36 };
  }

  if (/\bfender\b/.test(partName)) {
    return { height: 0.42, width: 0.32, x: 0.16, y: 0.40 };
  }

  if (/\bhead\s*light|headlamp\b/.test(partName)) {
    return { height: 0.22, width: 0.34, x: 0.50, y: 0.36 };
  }

  if (/\btail\s*light|taillight\b/.test(partName)) {
    return { height: 0.24, width: 0.30, x: 0.66, y: 0.38 };
  }

  if (/\bgrille\b/.test(partName)) {
    return { height: 0.30, width: 0.36, x: 0.34, y: 0.42 };
  }

  if (/\bhood\b/.test(partName)) {
    return { height: 0.32, width: 0.58, x: 0.22, y: 0.20 };
  }

  if (/^engine$|\bengine assembly\b|\bengine bay\b/.test(partName)) {
    return { height: 0.54, width: 0.70, x: 0.15, y: 0.26 };
  }

  if (/\bradiator\b/.test(partName)) {
    return { height: 0.42, width: 0.56, x: 0.22, y: 0.34 };
  }

  if (/\bmirror\b/.test(partName)) {
    return { height: 0.22, width: 0.24, x: 0.18, y: 0.24 };
  }

  if (/\bbrake\b|\brotor\b|\bcaliper\b|\bdisc\b|\bdisk\b/.test(partName)) {
    return { height: 0.62, width: 0.70, x: 0.04, y: 0.18 };
  }

  if (/\b(front |rear |back )?wheel\b/.test(partName)) {
    return { height: 0.34, width: 0.28, x: 0.10, y: 0.58 };
  }

  if (/\brocker panel\b/.test(partName)) {
    return { height: 0.18, width: 0.54, x: 0.24, y: 0.70 };
  }

  return null;
}

function isFocusedTargetDifferent(target: ScanReviewTarget, focusTarget: ScanReviewTarget) {
  const widthDelta = Math.abs(target.width - focusTarget.width);
  const heightDelta = Math.abs(target.height - focusTarget.height);
  const positionDelta = Math.hypot(target.x - focusTarget.x, target.y - focusTarget.y);
  return widthDelta > 8 || heightDelta > 8 || positionDelta > 8;
}

function targetToLensBox(target: ScanReviewTarget) {
  const viewportWidth = Math.max(1, window.innerWidth);
  const viewportHeight = Math.max(1, window.innerHeight);
  const left = clampNumber(target.x, 0, viewportWidth - 1);
  const top = clampNumber(target.y, 0, viewportHeight - 1);
  const right = clampNumber(target.x + target.width, left + 1, viewportWidth);
  const bottom = clampNumber(target.y + target.height, top + 1, viewportHeight);

  return {
    left,
    top,
    width: right - left,
    height: bottom - top,
  };
}

function StatTile({
  accent,
  label,
  value,
  warn,
}: {
  accent?: boolean;
  label: string;
  value: string;
  warn?: boolean;
}) {
  return (
    <div
      className="flex flex-col gap-1 rounded-xl px-3 py-2.5"
      style={{
        background: accent ? "rgba(0,194,255,0.07)" : warn ? "rgba(239,68,68,0.07)" : "rgba(255,255,255,0.04)",
        border: `1px solid ${accent ? "rgba(0,194,255,0.22)" : warn ? "rgba(239,68,68,0.20)" : "rgba(255,255,255,0.08)"}`,
      }}
    >
      <span
        style={{
          fontFamily: "var(--font-data)",
          fontSize: 9,
          fontWeight: 600,
          letterSpacing: "0.14em",
          color: accent ? "rgba(85,200,255,0.70)" : warn ? "rgba(239,68,68,0.65)" : "var(--slate-500)",
          textTransform: "uppercase",
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontFamily: "var(--font-data)",
          fontSize: 12,
          fontWeight: 600,
          color: accent ? "#55C8FF" : warn ? "var(--red-400)" : "var(--slate-100)",
          lineHeight: 1.2,
        }}
      >
        {value}
      </span>
    </div>
  );
}

function ScanResultCard({
  isExpanded,
  isMismatch,
  isReplacing,
  onCancelReplace,
  onClose,
  onCopyValue,
  onMeasure,
  onOpenDetails,
  onRetryMismatch,
  onReportReplace,
  onSetSizeReference,
  onSizeReferencePresetChange,
  onUndoCorrection,
  onToggleExpand,
  onToggleCompactMode,
  onToggleHideConfidence,
  onReplacementLabelChange,
  onWrongLabel,
  target,
  placement,
  prefs,
  replacementLabel,
  review,
  scanCardStatusMessage,
  sizeCalibration,
  sizeReferencePreset,
}: {
  isExpanded: boolean;
  isMismatch: boolean;
  isReplacing: boolean;
  onCancelReplace: () => void;
  onClose: () => void;
  onCopyValue: () => void;
  onMeasure: () => void;
  onOpenDetails: () => void;
  onRetryMismatch: () => void;
  onReportReplace: () => void;
  onSetSizeReference: () => void;
  onSizeReferencePresetChange: (preset: SizeReferencePreset) => void;
  onUndoCorrection: () => void;
  onToggleExpand: () => void;
  onToggleCompactMode: () => void;
  onToggleHideConfidence: () => void;
  onReplacementLabelChange: (value: string) => void;
  onWrongLabel: () => void;
  target: ScanReviewTarget | null;
  placement: ReviewCardPlacement;
  prefs: ScanCardPreferences;
  replacementLabel: string;
  review: ScanReviewState;
  scanCardStatusMessage: string | null;
  sizeCalibration: SizeCalibration | null;
  sizeReferencePreset: SizeReferencePreset;
}) {
  const result = review.scanState.result;
  const label = getReviewDisplayLabel(review);
  const confidence = result?.confidence;
  const confidenceRange = result ? getConfidenceRange(result) : null;
  const isFastener = result ? isFastenerResult(result, label) : false;
  const isCompact = prefs.compactCardsByDefault && !isExpanded;
  const statusStyle = getConfidenceStyle(confidence);
  const visibleFacts = getVisibleFacts(result, isCompact);
  const concernFacts = getConcernFacts(result, isCompact);
  const evidenceFacts = getEvidenceFacts(result, isCompact);
  const targetOverlayStyle = getReviewTargetOverlayStyle(target);
  const threeDSearchUrl = get3DSearchUrl(label);
  const referenceSummary = sizeCalibration
    ? `${getSizeReferenceLabel(sizeCalibration.preset)} (${sizeCalibration.referenceMm.toFixed(2)} mm). ${sizeCalibration.guidance}`
    : "Exact size needs a reference object.";
  const showPrecisionTools = isFastener || isExpanded;
  const matchPct = result?.confidenceScore
    ?? (confidence === "high" ? 84 : confidence === "medium" ? 72 : 48);
  const dotColor = confidence === "high" ? "var(--green-400)" : confidence === "medium" ? "var(--amber-400)" : "var(--red-400)";

  return (
    <section
      aria-live="polite"
      data-anchor-side={placement.anchorSide}
      className="scanner-result-panel no-scrollbar pointer-events-auto z-50 mx-auto flex max-h-[min(62dvh,560px)] max-w-[520px] flex-col overflow-y-auto px-4 pb-[max(20px,env(safe-area-inset-bottom))] pt-3 text-white"
      style={{
        bottom: "auto",
        left: placement.left,
        maxHeight: target && window.innerWidth < 520 ? "min(38dvh, 320px)" : target ? "min(62dvh, 560px)" : "min(42dvh, 420px)",
        right: "auto",
        top: placement.top,
        width: `min(calc(100vw - 28px), ${SCAN_CARD_WIDTH_PX}px)`,
      }}
    >
      {/* Drag handle */}
      <div className="mx-auto mb-3 h-1 w-10 shrink-0 rounded-full bg-white/18" />

      {/* Header */}
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          {result && !review.scanState.errorMessage ? (
            <div
              className="mb-2 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1"
              style={{ background: "rgba(0,194,255,0.08)", border: "1px solid rgba(0,194,255,0.24)" }}
            >
              <span className="block rounded-full" style={{ width: 5, height: 5, background: dotColor, flexShrink: 0 }} />
              <span
                style={{
                  fontFamily: "var(--font-data)",
                  fontSize: 10,
                  fontWeight: 600,
                  letterSpacing: "0.10em",
                  color: "#55C8FF",
                  textTransform: "uppercase",
                }}
              >
                {confidenceRange
                  ? `${confidenceRange.low}–${confidenceRange.high}% match`
                  : `${confidence} confidence`}
              </span>
            </div>
          ) : null}
          <h3 className="text-[18px] font-black leading-tight tracking-[-0.02em]">{label}</h3>
          <p
            className="mt-0.5"
            style={{ fontFamily: "var(--font-data)", fontSize: 11, color: "var(--slate-400)", letterSpacing: "0.05em" }}
          >
            <span>{result?.scanCategory ?? "unknown"}</span>
            <span aria-hidden="true"> · </span>
            <span>{review.source}</span>
          </p>
          {!prefs.hideConfidence && confidence ? (
            <span className={`mt-1.5 inline-block rounded-full border px-2.5 py-0.5 text-[10px] font-extrabold uppercase tracking-[0.08em] ${statusStyle.chip}`}>
              {confidenceRange ? `${confidenceRange.low}–${confidenceRange.high}% likely` : `${confidence}`}
            </span>
          ) : null}
        </div>
        <button
          className="grid size-8 shrink-0 place-items-center rounded-full text-white/50 transition-colors hover:text-white/80"
          style={{ border: "1px solid rgba(255,255,255,0.10)", background: "rgba(255,255,255,0.05)" }}
          onClick={onClose}
          type="button"
          aria-label="Close result card"
        >
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden>
            <path d="M1 1l9 9M10 1L1 10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {/* Key stat tiles */}
      {result && !review.scanState.errorMessage ? (
        <div className="mt-3 grid grid-cols-3 gap-1.5">
          <StatTile label="CATEGORY" value={result.scanCategory} />
          <StatTile
            label="SCORE"
            value={`${confidenceRange ? confidenceRange.low : matchPct}%`}
            accent
          />
          <StatTile
            label="CONCERNS"
            value={result.concerns.length ? String(result.concerns.length) : "None"}
            warn={result.concerns.length > 0}
          />
        </div>
      ) : null}

      {/* Content body */}
      <div className={`mt-3 ${statusStyle.accent}`}>
        {isMismatch ? (
          <div
            className="mb-3 rounded-xl px-3 py-2.5"
            style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.22)" }}
          >
            <p className="text-[10px] font-extrabold uppercase tracking-[0.14em]" style={{ color: "var(--red-400)" }}>Target changed</p>
            <p className="mt-1 text-xs leading-5" style={{ color: "var(--red-400)", opacity: 0.85 }}>
              The current object moved away from the saved scan point.
            </p>
            <button
              className="mt-2 rounded-full px-3 py-1.5 text-[11px] font-extrabold text-white"
              style={{ background: "var(--red-500)" }}
              onClick={onRetryMismatch}
              type="button"
            >
              Rescan this point
            </button>
          </div>
        ) : null}

        {review.scanState.errorMessage ? (
          <div
            className="rounded-xl px-3 py-2.5"
            style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.18)" }}
          >
            <p className="mb-1 text-[10px] font-extrabold uppercase tracking-[0.14em]" style={{ color: "var(--red-400)" }}>Scan issue</p>
            <p className="text-xs leading-5" style={{ color: "var(--red-400)", opacity: 0.9 }}>{review.scanState.errorMessage}</p>
          </div>
        ) : (
          <>
            {result?.whatItDoes ? (
              <BubbleSection title="What this is">
                <p>{summarize(result.whatItDoes, isCompact ? 150 : 220)}</p>
              </BubbleSection>
            ) : null}
            {result?.nextAction ? (
              <BubbleSection title="Next step">
                <p>{summarize(result.nextAction, 170)}</p>
              </BubbleSection>
            ) : null}
            {isExpanded ? (
              <>
                <BubbleSection title="What I can see">
                  <FactList facts={visibleFacts} />
                </BubbleSection>
                <BubbleSection title="Why Deep Spec matched it">
                  <FactList facts={evidenceFacts} />
                </BubbleSection>
                <BubbleSection title="Cautions">
                  <FactList facts={concernFacts} emptyText="No visible damage or safety concern was called out in this photo." />
                </BubbleSection>
              </>
            ) : null}
          </>
        )}
      </div>

      {isExpanded && result?.candidateMatches.length ? (
        <BubbleSection title="Related parts to compare">
          <div className="space-y-1.5">
            {result.candidateMatches.slice(0, 4).map((candidate) => (
              <div
                key={candidate.partName}
                className="rounded-xl px-3 py-2"
                style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
              >
                <p className="text-xs font-black text-white">{candidate.partName}</p>
                <p className="mt-0.5 text-[11px]" style={{ color: "var(--slate-400)" }}>{summarize(candidate.reason, isCompact ? 90 : 140)}</p>
              </div>
            ))}
          </div>
        </BubbleSection>
      ) : null}

      {isExpanded ? (
        <BubbleSection title="Image area">
          <div
            className="relative mt-1.5 overflow-hidden rounded-xl"
            style={{ border: "1px solid rgba(255,255,255,0.10)" }}
          >
            <img
              alt={`Scan photo for ${label}`}
              className="h-32 w-full object-cover"
              src={review.scanState.frame.imageBase64}
            />
            {targetOverlayStyle ? (
              <span
                aria-hidden
                className="absolute rounded-sm"
                style={{
                  border: "2px solid rgba(0,194,255,0.80)",
                  background: "rgba(0,194,255,0.15)",
                  height: `${targetOverlayStyle.height}%`,
                  left: `${targetOverlayStyle.left}%`,
                  top: `${targetOverlayStyle.top}%`,
                  width: `${targetOverlayStyle.width}%`,
                }}
              />
            ) : null}
          </div>
        </BubbleSection>
      ) : null}

      {isFastener && isExpanded ? (
        <BubbleSection title="Fastener mode">
          <p>Put a card or coin on the same flat plane as the fastener, then estimate size.</p>
          <p className="mt-2 text-white/60">Output stays an estimate until depth and angle are verified.</p>
        </BubbleSection>
      ) : null}

      {/* Actions */}
      <div className="mt-3 space-y-2">
        <button
          className="w-full rounded-[12px] py-3 text-[13px] font-bold text-white"
          style={{ background: "var(--blue-500)", boxShadow: "0 4px 20px rgba(20,105,236,0.32)" }}
          onClick={onOpenDetails}
          type="button"
        >
          Open details
        </button>

        {showPrecisionTools ? (
          <>
            <label className="block">
              <span
                className="mb-1 block text-[10px] font-bold uppercase tracking-[0.12em]"
                style={{ color: "var(--slate-500)" }}
              >
                Size reference
              </span>
              <select
                aria-label="Size reference preset"
                className="h-10 w-full rounded-[10px] px-3 text-[11px] font-bold text-white outline-none"
                style={{ border: "1px solid rgba(255,255,255,0.10)", background: "rgba(255,255,255,0.05)" }}
                onChange={(event) => onSizeReferencePresetChange(event.target.value as SizeReferencePreset)}
                value={sizeReferencePreset}
              >
                <option value="card_short_edge">Card short edge (53.98 mm)</option>
                <option value="card_long_edge">Card long edge (85.60 mm)</option>
                <option value="us_quarter">US quarter (24.26 mm)</option>
                <option value="us_nickel">US nickel (21.21 mm)</option>
              </select>
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                className="h-10 rounded-[10px] text-xs font-bold text-white/90"
                style={{ border: "1px solid rgba(255,255,255,0.10)", background: "rgba(255,255,255,0.05)" }}
                onClick={onSetSizeReference}
                type="button"
              >
                Set reference
              </button>
              <button
                className="h-10 rounded-[10px] text-xs font-bold text-white/90"
                style={{ border: "1px solid rgba(255,255,255,0.10)", background: "rgba(255,255,255,0.05)" }}
                onClick={onMeasure}
                type="button"
              >
                Estimate size
              </button>
            </div>
            <p className="text-[10px] leading-5" style={{ color: "var(--slate-500)" }}>{referenceSummary}</p>
          </>
        ) : null}

        {isExpanded ? (
          <button
            className="h-10 w-full rounded-[10px] text-xs font-bold text-white/90"
            style={{ border: "1px solid rgba(255,255,255,0.10)", background: "rgba(255,255,255,0.05)" }}
            onClick={onCopyValue}
            type="button"
          >
            Copy match
          </button>
        ) : null}

        {isExpanded && review.scanState.result ? (
          <a
            className="flex h-10 items-center justify-center rounded-[10px] text-xs font-bold text-white/78"
            style={{ border: "1px solid rgba(20,105,236,0.26)", background: "rgba(20,105,236,0.08)" }}
            href={threeDSearchUrl}
            rel="noreferrer"
            target="_blank"
          >
            Search 3D models for this part
          </a>
        ) : null}

        {isReplacing ? (
          <div className="space-y-2">
            <input
              aria-label="replacement label"
              className="w-full rounded-[10px] px-3 py-2.5 text-sm text-white outline-none placeholder:text-white/38"
              style={{ border: "1px solid rgba(255,255,255,0.14)", background: "rgba(255,255,255,0.05)" }}
              maxLength={80}
              onChange={(event) => onReplacementLabelChange(event.target.value)}
              placeholder="Example: coolant reservoir cap"
              value={replacementLabel}
            />
            <div className="grid grid-cols-2 gap-2">
              <button
                className="h-10 rounded-[10px] text-xs font-bold text-slate-900"
                style={{ background: "rgba(255,255,255,0.90)" }}
                onClick={onReportReplace}
                type="button"
              >
                Save correction
              </button>
              <button
                className="h-10 rounded-[10px] text-xs font-bold text-white/80"
                style={{ border: "1px solid rgba(255,255,255,0.14)" }}
                onClick={onCancelReplace}
                type="button"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            className="h-10 w-full rounded-[10px] text-xs font-bold text-white/90"
            style={{ border: "1px solid rgba(0,194,255,0.22)", background: "rgba(0,194,255,0.06)" }}
            onClick={onWrongLabel}
            type="button"
          >
            Correct label
          </button>
        )}

        {review.correction ? (
          <div
            className="flex items-center justify-between gap-2 rounded-[10px] px-3 py-2 text-xs"
            style={{ border: "1px solid rgba(255,255,255,0.10)", background: "rgba(255,255,255,0.04)" }}
          >
            <span className="font-bold text-white/90">Correction: {review.correction}</span>
            <button className="font-bold text-white/50 underline underline-offset-2" onClick={onUndoCorrection} type="button">
              Undo
            </button>
          </div>
        ) : null}
      </div>

      {/* Footer controls */}
      <div
        className="mt-3 flex items-center justify-between gap-3 pt-3 text-[11px]"
        style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}
      >
        <button className="text-white/40 underline underline-offset-2 hover:text-white/70" onClick={onToggleExpand} type="button">
          {isExpanded ? "Show less" : "Show more"}
        </button>
        <div className="flex flex-wrap items-center justify-end gap-3">
          <button className="text-white/40 underline underline-offset-2 hover:text-white/70" onClick={onToggleCompactMode} type="button">
            {prefs.compactCardsByDefault ? "Compact cards on" : "Compact cards off"}
          </button>
          <button className="text-white/40 underline underline-offset-2 hover:text-white/70" onClick={onToggleHideConfidence} type="button">
            {prefs.hideConfidence ? "Show confidence" : "Hide confidence"}
          </button>
        </div>
      </div>

      {scanCardStatusMessage ? (
        <p className="mt-2 text-xs font-bold" style={{ color: "var(--electric-300)" }}>
          {scanCardStatusMessage}
        </p>
      ) : null}
    </section>
  );
}

function BubbleSection({ children, title }: { children: ReactNode; title: string }) {
  return (
    <div className="border-t border-white/10 py-3 first:border-t-0 first:pt-0">
      <SectionTitle>{title}</SectionTitle>
      <div className="mt-1 text-xs leading-6 text-white/82">{children}</div>
    </div>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <p className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-white/48">{children}</p>
  );
}

function FactList({ emptyText, facts }: { emptyText?: string; facts: string[] }) {
  const items = facts.length ? facts : emptyText ? [emptyText] : [];
  return (
    <ul className="space-y-1.5">
      {items.map((fact) => (
        <li key={fact} className="pl-3 before:-ml-3 before:mr-2 before:text-[var(--ds-accent)] before:content-['-']">
          {fact}
        </li>
      ))}
    </ul>
  );
}

function CaptureErrorNotice({ message, onTryAgain }: { message: string; onTryAgain: () => void }) {
  return (
    <div
      className="fixed bottom-[220px] left-1/2 z-20 w-[calc(100%-28px)] max-w-sm -translate-x-1/2 rounded-[18px] p-4 text-center"
      style={{
        background: "rgba(30,8,10,0.94)",
        border: "1px solid rgba(239,68,68,0.28)",
        backdropFilter: "blur(20px)",
        boxShadow: "0 16px 44px rgba(0,0,0,0.50)",
      }}
    >
      <p className="text-sm font-bold" style={{ color: "var(--red-400)" }}>{message}</p>
      <button
        className="mt-3 w-full rounded-[10px] py-2.5 text-[13px] font-bold text-white"
        style={{ background: "rgba(239,68,68,0.18)", border: "1px solid rgba(239,68,68,0.30)" }}
        onClick={onTryAgain}
        type="button"
      >
        Try again
      </button>
    </div>
  );
}

function readImageFileAsDataUrl(file: File) {
  if (!file.type.startsWith("image/")) {
    return Promise.reject(new Error("Choose a JPEG, PNG, or WebP photo."));
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    return Promise.reject(new Error("Choose a photo under 12 MB."));
  }

  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === "string") {
        resolve(result);
        return;
      }

      reject(new Error("Could not read that photo."));
    };
    reader.onerror = () => reject(new Error("Could not read that photo."));
    reader.readAsDataURL(file);
  });
}

function getScanQualityCoach(issue: ScanQualityCoachIssue): ScanQualityCoachState {
  switch (issue) {
    case "too_dark":
      return {
        action: "Add light",
        issue,
        progress: "You're close",
        title: "Too dark",
      };
    case "lens_covered":
      return {
        action: "Uncover lens",
        issue,
        progress: "You're close",
        title: "Lens covered",
      };
    case "too_bright":
      return {
        action: "Reduce glare",
        issue,
        progress: "You're close",
        title: "Too much glare",
      };
    case "too_blurry":
      return {
        action: "Hold still 2s",
        issue,
        progress: "You're close",
        title: "Too blurry",
      };
    case "object_too_small":
      return {
        action: "Move closer",
        issue,
        progress: "You're 80% there",
        title: "Object too small",
      };
  }
}

function isObjectTargetTooSmall(target: CameraObjectTarget) {
  return isTargetBoxTooSmall(target.width, target.height);
}

function isReviewTargetTooSmall(target: ScanReviewTarget) {
  return isTargetBoxTooSmall(target.width, target.height);
}

function isTargetBoxTooSmall(width: number, height: number) {
  const viewportArea = Math.max(1, window.innerWidth * window.innerHeight);
  return (
    width < MIN_TARGET_WIDTH_PX ||
    height < MIN_TARGET_HEIGHT_PX ||
    (width * height) / viewportArea < MIN_TARGET_AREA_RATIO
  );
}

function clampReviewTarget(target: ScanReviewTarget): ScanReviewTarget {
  const viewportWidth = Math.max(1, window.innerWidth);
  const viewportHeight = Math.max(1, window.innerHeight);
  const width = clampNumber(target.width, 1, viewportWidth);
  const height = clampNumber(target.height, 1, viewportHeight);

  return {
    ...target,
    x: clampNumber(target.x, 0, Math.max(0, viewportWidth - width)),
    y: clampNumber(target.y, 0, Math.max(0, viewportHeight - height)),
    width,
    height,
    confidence: clampNumber(target.confidence, 0, 1),
  };
}

function isTargetMismatch(storedTarget: ScanReviewTarget, objectTarget: CameraObjectTarget) {
  const current = getReviewTargetFromObject(objectTarget);
  const distance = getTargetDistance(storedTarget, current);
  const sameId = storedTarget.id === current.id;
  return distance > MATCH_THRESHOLD || !sameId || storedTarget.confidence - objectTarget.confidence > 0.34;
}

function shouldTrackTarget(storedTarget: ScanReviewTarget, objectTarget: CameraObjectTarget | null) {
  if (!objectTarget) {
    return false;
  }
  if (storedTarget.id !== objectTarget.id) {
    return false;
  }
  return !isTargetMismatch(storedTarget, objectTarget);
}

function getAnchoredReviewTarget(
  storedTarget: ScanReviewTarget | null,
  objectTarget: CameraObjectTarget | null,
) {
  if (!storedTarget) {
    return null;
  }

  const nextTarget = shouldTrackTarget(storedTarget, objectTarget) && objectTarget
    ? getReviewTargetFromObject(objectTarget)
    : storedTarget;
  return clampReviewTarget(nextTarget);
}

function getReviewTargetFromObject(target: CameraObjectTarget): ScanReviewTarget {
  return {
    confidence: target.confidence,
    height: target.height,
    id: target.id,
    width: target.width,
    x: target.left,
    y: target.top,
  };
}

async function getReviewTargetFromUploadedImage(imageBase64: string): Promise<ScanReviewTarget | null> {
  if (typeof Image === "undefined" || typeof document === "undefined") {
    return null;
  }

  try {
    const image = await loadImageElement(imageBase64);
    const canvas = document.createElement("canvas");
    const maxAnalysisWidth = 480;
    const scale = Math.min(1, maxAnalysisWidth / Math.max(1, image.naturalWidth));
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) {
      return null;
    }

    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const detected = detectObjectTargetFromImageData(context.getImageData(0, 0, canvas.width, canvas.height));
    return detected ? mapImageTargetToViewport(detected, image.naturalWidth, image.naturalHeight) : null;
  } catch {
    return null;
  }
}

function loadImageElement(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    const timeoutId = window.setTimeout(() => reject(new Error("Timed out decoding uploaded scan image.")), 250);
    image.onload = () => {
      window.clearTimeout(timeoutId);
      resolve(image);
    };
    image.onerror = () => {
      window.clearTimeout(timeoutId);
      reject(new Error("Could not decode uploaded scan image."));
    };
    image.src = src;
  });
}

function mapImageTargetToViewport(target: ObjectTargetBox, imageWidth: number, imageHeight: number): ScanReviewTarget {
  const viewportWidth = Math.max(1, window.innerWidth);
  const viewportHeight = Math.max(1, window.innerHeight);
  const scale = Math.max(viewportWidth / Math.max(1, imageWidth), viewportHeight / Math.max(1, imageHeight));
  const renderedWidth = imageWidth * scale;
  const renderedHeight = imageHeight * scale;
  const offsetX = (viewportWidth - renderedWidth) / 2;
  const offsetY = (viewportHeight - renderedHeight) / 2;

  return clampReviewTarget({
    confidence: target.confidence,
    height: target.height * renderedHeight,
    id: "upload-target",
    normalized: target,
    width: target.width * renderedWidth,
    x: offsetX + target.x * renderedWidth,
    y: offsetY + target.y * renderedHeight,
  });
}

function getTargetDistance(a: ScanReviewTarget, b: ScanReviewTarget) {
  const centerXA = a.x + a.width / 2;
  const centerXB = b.x + b.width / 2;
  const centerYA = a.y + a.height / 2;
  const centerYB = b.y + b.height / 2;
  const centerDistance = Math.hypot(centerXA - centerXB, centerYA - centerYB);
  const sizeDistance = Math.abs(a.width - b.width) * 0.35 + Math.abs(a.height - b.height) * 0.35;
  return centerDistance + sizeDistance;
}

function getObjectTargetFromReviewTarget(reviewTarget: ScanReviewTarget): CameraObjectTarget {
  return {
    confidence: reviewTarget.confidence,
    height: reviewTarget.height,
    holdProgress: 1,
    id: reviewTarget.id,
    isLocked: true,
    left: reviewTarget.x,
    normalized: reviewTarget.normalized,
    top: reviewTarget.y,
    width: reviewTarget.width,
  };
}

function getReviewDisplayLabel(review: ScanReviewState) {
  return (
    review.correction?.trim()
    || review.scanState.result?.partName
    || review.lookup?.trainingLabel
    || "Captured part"
  );
}

function getReviewTargetOverlayStyle(target: ScanReviewTarget | null) {
  if (!target) {
    return null;
  }

  return {
    height: clampNumber((target.height / Math.max(1, window.innerHeight)) * 100, 1, 100),
    left: clampNumber((target.x / Math.max(1, window.innerWidth)) * 100, 0, 100),
    top: clampNumber((target.y / Math.max(1, window.innerHeight)) * 100, 0, 100),
    width: clampNumber((target.width / Math.max(1, window.innerWidth)) * 100, 1, 100),
  };
}

function get3DSearchUrl(label: string) {
  const encoded = encodeURIComponent(`${label} 3D model`);
  return `https://www.sketchfab.com/search?type=models&sort_by=-relevance&q=${encoded}`;
}

function getSizeReferenceMm(preset: SizeReferencePreset) {
  switch (preset) {
    case "card_long_edge":
      return 85.6;
    case "us_quarter":
      return 24.26;
    case "us_nickel":
      return 21.21;
    case "card_short_edge":
    default:
      return 53.98;
  }
}

function getSizeReferenceLabel(preset: SizeReferencePreset) {
  switch (preset) {
    case "card_long_edge":
      return "Card long edge";
    case "us_quarter":
      return "US quarter";
    case "us_nickel":
      return "US nickel";
    case "card_short_edge":
    default:
      return "Card short edge";
  }
}

function getReferencePixels(target: ScanReviewTarget, preset: SizeReferencePreset) {
  switch (preset) {
    case "card_short_edge":
      return Math.min(target.width, target.height);
    case "card_long_edge":
      return Math.max(target.width, target.height);
    case "us_quarter":
    case "us_nickel":
    default:
      return Math.max(target.width, target.height);
  }
}

function getSizeReferenceGuidance(preset: SizeReferencePreset) {
  switch (preset) {
    case "card_short_edge":
      return "Best for height when the short card edge matches the vertical edge in frame.";
    case "card_long_edge":
      return "Best for width when the long card edge matches the horizontal edge in frame.";
    case "us_quarter":
    case "us_nickel":
      return "Best when the coin is flat to the camera and on the same depth plane.";
    default:
      return "Keep the reference and target on the same depth plane.";
  }
}

function estimateMm(targetPixels: number, calibration: SizeCalibration) {
  const mmPerPixel = calibration.referenceMm / Math.max(1, calibration.referencePx);
  return targetPixels * mmPerPixel;
}

function getFastenerSizeHint(acrossMm: number) {
  const metric = findNearestMetricFastener(acrossMm);
  const sae = findNearestSaeFastener(acrossMm);
  return `Fastener guess: ${metric} wrench / ${sae} (approx).`;
}

function getMeasurementGate(target: ScanReviewTarget, calibration: SizeCalibration): MeasurementGateResult {
  const targetPx = Math.max(target.width, target.height);
  const ratio = targetPx / Math.max(1, calibration.referencePx);

  if (target.confidence < 0.72) {
    return {
      ok: false,
      message: "Target lock is not confident enough for AR sizing. Center the part and hold still again.",
    };
  }

  if (targetPx < 96) {
    return {
      ok: false,
      message: "Target is too small for a useful AR size estimate. Move closer and lock it again.",
    };
  }

  if (calibration.referencePx < 64) {
    return {
      ok: false,
      message: "Reference is too small. Fill more of the frame with the card or coin.",
    };
  }

  if (ratio < 0.6 || ratio > 1.7) {
    return {
      ok: false,
      message: "Reference scale is too different from the target. Use a same-plane card or coin closer to the part.",
    };
  }

  return {
    ok: true,
    uncertainty: "same-plane depth, camera angle, and target edge still need physical verification",
  };
}

function isFastenerResult(result: IdentificationResult, label: string) {
  return /\b(nut|bolt|screw|stud|thread|washer|fastener)\b/i.test(
    [
      label,
      result.partName,
      result.whatItDoes,
      result.nextAction,
      ...result.visibleObservations,
      ...result.evidence,
    ].join(" "),
  );
}

function getConfidenceRange(result: IdentificationResult) {
  if (result.confidenceRange) {
    return {
      high: clampNumber(result.confidenceRange.high, 0, 100),
      low: clampNumber(result.confidenceRange.low, 0, 100),
    };
  }

  const score = result.confidenceScore ?? (result.confidence === "high" ? 84 : result.confidence === "medium" ? 72 : 48);
  const spread = score >= 80 ? 6 : score >= 65 ? 8 : 12;
  return {
    high: clampNumber(Math.round(score + spread), 0, 100),
    low: clampNumber(Math.round(score - spread), 0, 100),
  };
}

function findNearestMetricFastener(widthMm: number) {
  const nearest = METRIC_FASTENER_WIDTHS_MM.reduce((best, current) => (
    Math.abs(current - widthMm) < Math.abs(best - widthMm) ? current : best
  ), METRIC_FASTENER_WIDTHS_MM[0]);
  return `${nearest} mm`;
}

function findNearestSaeFastener(widthMm: number) {
  const nearest = SAE_FASTENER_WIDTHS.reduce((best, current) => (
    Math.abs(current.mm - widthMm) < Math.abs(best.mm - widthMm) ? current : best
  ), SAE_FASTENER_WIDTHS[0]);
  return nearest.label;
}

function getVisibleFacts(result: IdentificationResult | undefined, compact: boolean) {
  if (!result) {
    return ["No AI result yet. Open the scan details to retry."];
  }
  const facts = result.visibleObservations
    .map((item) => summarize(item, compact ? 85 : 130))
    .filter(Boolean);

  return facts.length ? facts.slice(0, compact ? 3 : 5) : ["No visual observations were returned. Treat this as uncertain."];
}

function getConcernFacts(result: IdentificationResult | undefined, compact: boolean) {
  if (!result) {
    return [];
  }

  return result.concerns
    .map((item) => summarize(item, compact ? 85 : 130))
    .filter(Boolean)
    .slice(0, compact ? 3 : 5);
}

function getEvidenceFacts(result: IdentificationResult | undefined, compact: boolean) {
  if (!result) {
    return ["Deep Spec needs a completed AI result before it can explain the match."];
  }

  const facts = [
    ...result.evidence,
    ...result.evidenceRegions.map((item) => `${item.regionLabel}: ${item.observation}`),
  ]
    .filter(Boolean)
    .map((item) => summarize(item, compact ? 90 : 145));

  return facts.length ? facts.slice(0, compact ? 3 : 6) : ["No diagnostic evidence was returned by the model."];
}

function getConfidenceStyle(confidence: Confidence | undefined) {
  if (confidence === "high") {
    return {
      accent: "shadow-[0_0_0_1px_rgba(16,185,129,0.25)]",
      chip: "border-[var(--ds-ok-line)] bg-[var(--ds-ok-soft)] text-[var(--ds-ok-ink)]",
    };
  }

  if (confidence === "medium") {
    return {
      accent: "shadow-[0_0_0_1px_rgba(245,158,11,0.22)]",
      chip: "border-[var(--ds-warn-line)] bg-[var(--ds-warn-soft)] text-[var(--ds-warn-ink)]",
    };
  }

  return {
    accent: "shadow-[0_0_0_1px_rgba(248,113,113,0.22)]",
    chip: "border-[var(--ds-danger-line)] bg-[var(--ds-danger-soft)] text-[var(--ds-danger-ink)]",
  };
}

function getReviewCardPlacement(target: ScanReviewTarget | null): ReviewCardPlacement {
  if (window.innerWidth < 520 && target) {
    return {
      anchorSide: "right",
      left: 14,
      top: Math.max(72, window.innerHeight - 320),
    };
  }

  if (!target) {
    return {
      anchorSide: "right",
      left: 14,
      top: Math.max(72, window.innerHeight - 420),
    };
  }

  const margin = 12;
  const gap = 10;
  const canPlaceRight = target.x + target.width + SCAN_CARD_WIDTH_PX + gap < window.innerWidth;
  const anchorSide = canPlaceRight ? "left" : "right";
  const left = canPlaceRight
    ? clampNumber(target.x + target.width + gap, 14, window.innerWidth - SCAN_CARD_WIDTH_PX - 14)
    : clampNumber(target.x - SCAN_CARD_WIDTH_PX - gap, 14, window.innerWidth - SCAN_CARD_WIDTH_PX - 14);
  const rawTop = target.y + target.height / 2;
  const top = clampNumber(rawTop - margin, 72, Math.max(72, window.innerHeight - SCAN_CARD_SAFE_HEIGHT_PX));

  return { anchorSide, left, top };
}

async function copyText(value: string) {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }

    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const success = document.execCommand("copy");
    textarea.remove();
    return success;
  } catch {
    return false;
  }
}

function summarize(value: string, limit: number) {
  const trimmed = value.trim();
  if (trimmed.length <= limit) {
    return trimmed;
  }
  return `${trimmed.slice(0, Math.max(12, limit - 1)).trimEnd()}...`;
}

function clampNumber(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function ScannerHUD({ isAnalyzing }: { isAnalyzing: boolean }) {
  const statusLabel = isAnalyzing ? "CAPTURING" : "READY";
  return (
    <>
      <div className="scanner-hud" style={{ top: "max(52px, calc(env(safe-area-inset-top) + 52px))", left: 16 }}>
        <span className="scanner-hud-dot" />
        DEEPSPEC·LIVE
      </div>
      <div className="scanner-hud" style={{ top: "max(52px, calc(env(safe-area-inset-top) + 52px))", right: 16, textAlign: "right" }}>
        f/1.8·AUTO ISO
      </div>
      <div className="scanner-hud" style={{ bottom: "calc(env(safe-area-inset-bottom) + 130px)", left: 16 }}>
        SCAN MODE<br />IDENTIFY
      </div>
      <div className="scanner-hud" style={{ bottom: "calc(env(safe-area-inset-bottom) + 130px)", right: 16, textAlign: "right" }}>
        {statusLabel}
      </div>
    </>
  );
}

function ScannerTargetStatus({ status }: { status: string }) {
  return (
    <div className="pointer-events-none fixed left-1/2 top-[max(112px,calc(env(safe-area-inset-top)+88px))] z-20 -translate-x-1/2">
      <p className="scanner-status-pill">{status}</p>
    </div>
  );
}

function LensViewfinderBrackets({
  isAnalyzing,
  label,
  progress,
}: {
  isAnalyzing?: boolean;
  label: string;
  progress: number;
}) {
  const progressPercent = `${Math.round(clampNumber(progress, 0, 1) * 100)}%`;
  return (
    <div className="pointer-events-none fixed inset-0 z-10 flex items-center justify-center" data-testid="object-reticle">
      <div
        style={{ width: "min(72vw, 320px)", height: "min(52vw, 240px)" }}
        className={`relative${isAnalyzing ? " scanner-bracket-pulse" : ""}`}
      >
        <span className="scanner-corner scanner-corner-tl" />
        <span className="scanner-corner scanner-corner-tr" />
        <span className="scanner-corner scanner-corner-bl" />
        <span className="scanner-corner scanner-corner-br" />
        {isAnalyzing ? <div className="scanner-sweep-line" /> : null}
        <div className="absolute -bottom-9 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full bg-black/35 px-3 py-1.5 text-[11px] font-bold text-white backdrop-blur-md">
          <span>{label}</span>
          <span className="scanner-progress-track" aria-hidden>
            <span className="scanner-progress-fill block" style={{ width: progressPercent }} />
          </span>
        </div>
      </div>
    </div>
  );
}

function TapTargetButton({
  isLocked,
  isTooSmall,
  onSelect,
  target,
}: {
  isLocked: boolean;
  isTooSmall: boolean;
  onSelect: () => void;
  target: CameraObjectTarget;
}) {
  const label = isTooSmall ? "Move closer" : isLocked ? "Scan this part" : "Tap part";

  return (
    <button
      aria-label={isTooSmall ? "Selected part is too small" : "Scan selected part"}
      className="fixed z-20 rounded-[18px] border-2 bg-black/10 transition-[border-color,box-shadow,background-color]"
      disabled={isTooSmall}
      onClick={onSelect}
      style={{
        borderColor: isLocked ? "rgba(16,185,129,0.78)" : "rgba(0,194,255,0.58)",
        boxShadow: isLocked ? "0 0 38px rgba(16,185,129,0.34)" : "0 0 26px rgba(0,170,255,0.24)",
        height: target.height,
        left: target.left,
        top: target.top,
        width: target.width,
      }}
      type="button"
    >
      <span className="absolute left-1/2 top-full mt-2 -translate-x-1/2 whitespace-nowrap rounded-full bg-black/72 px-3 py-1.5 text-xs font-black text-white shadow-lg">
        {label}
      </span>
    </button>
  );
}

function LensBottomBar({
  isAnalyzing,
  isShutterDisabled,
  onFlip,
  onGallery,
  onShutter,
}: {
  isAnalyzing: boolean;
  isShutterDisabled: boolean;
  onFlip: () => void;
  onGallery: () => void;
  onShutter: () => void;
}) {
  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 flex items-center justify-between px-8 pb-[max(28px,env(safe-area-inset-bottom))] pt-4">
      <button
        type="button"
        aria-label="Open gallery"
        onClick={onGallery}
        disabled={isAnalyzing}
        className="grid size-12 place-items-center rounded-2xl text-white disabled:opacity-40"
        style={{
          background: "rgba(7,16,30,0.62)",
          border: "1px solid rgba(255,255,255,0.16)",
          backdropFilter: "blur(16px)",
        }}
      >
        <span className="sr-only">Upload photo</span>
        <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden>
          <rect x="2" y="5" width="18" height="14" rx="2.5" stroke="currentColor" strokeWidth="1.7" />
          <circle cx="7.5" cy="10.5" r="1.5" fill="currentColor" />
          <path d="M2 15l4-4 3 3 4-5 7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M7 5V3.5A1.5 1.5 0 018.5 2h5A1.5 1.5 0 0115 3.5V5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>

      <div className="flex items-center justify-center" style={{ width: 86, height: 86 }}>
        <div className="flex items-center justify-center rounded-full" style={{ width: 86, height: 86, background: "rgba(0,194,255,0.06)", border: "1px solid rgba(0,194,255,0.22)" }}>
          <button
            type="button"
            aria-label="Scan now"
            onClick={onShutter}
            disabled={isShutterDisabled}
            className="grid place-items-center rounded-full disabled:opacity-40"
            style={{
              width: 68,
              height: 68,
              border: "1px solid rgba(0, 194, 255, 0.60)",
              background: "rgba(0, 194, 255, 0.08)",
              color: "#39D0FF",
              boxShadow: "0 0 18px rgba(0,170,255,0.30)",
              animation: "ds-btn-pulse 2.4s ease-in-out infinite",
            }}
          >
            <svg width="26" height="26" viewBox="0 0 26 26" fill="none" aria-hidden>
              <circle cx="13" cy="13" r="5" fill="currentColor" opacity="0.90" />
              <circle cx="13" cy="13" r="10" stroke="currentColor" strokeWidth="1.8" opacity="0.45" />
              <path d="M9 3.5C9 3.5 10.8 2 13 2s4 1.5 4 1.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" opacity="0.6" />
            </svg>
          </button>
        </div>
      </div>

      <button
        type="button"
        aria-label="Switch camera"
        onClick={onFlip}
        className="grid size-12 place-items-center rounded-full text-white"
        style={{
          background: "rgba(7,16,30,0.62)",
          border: "1px solid rgba(255,255,255,0.16)",
          backdropFilter: "blur(16px)",
        }}
      >
        <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden>
          <path d="M7 4H15M15 4L12 1M15 4L12 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M15 18H7M7 18L10 21M7 18L10 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </div>
  );
}
