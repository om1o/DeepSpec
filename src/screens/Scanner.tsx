import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import Webcam from "react-webcam";
import { Link, useLocation, useNavigate } from "react-router-dom";
import IdentifyButton from "../components/scanner/IdentifyButton";
import MotionPermissionModal from "../components/scanner/MotionPermissionModal";
import Reticle from "../components/scanner/Reticle";
import Button from "../components/ui/Button";
import HistoryDockButton from "../components/ui/HistoryDockButton";
import { useCamera, type CameraDevice } from "../hooks/useCamera";
import { useObjectTarget, type CameraObjectTarget } from "../hooks/useObjectTarget";
import { useStillness } from "../hooks/useStillness";
import { assessImageQuality, type ImageQualityIssue, type ImageQualityResult } from "../lib/imageQuality";
import { createFocusedScanCrop } from "../lib/focusCrop";
import { getCachedScanResult, hashImageDataUrl, setCachedScanResult } from "../lib/scanCache";
import { getScanCardPreferences, type ScanCardPreferences, updateScanCardPreferences } from "../lib/scanResultCardSettings";
import { saveLatestScanState } from "../lib/utils";
import { AIServiceError, getAIErrorMessage, identifyCapturedFrame } from "../services/aiService";
import { getCloudSyncStatus, syncLookupToCloud } from "../services/cloudSync";
import {
  recordAcceptableScan,
  recordManualCorrection,
  recordNeedsBetterPhoto,
  recordScanAttempt,
  recordScanQualityFailure,
  recordScanQualityRetake,
} from "../services/scanQualityMetrics";
import { createLookup, updateLookup } from "../services/storage";
import type { Confidence, IdentificationResult, CapturedFrame, Lookup, ScanAnalysisState, ScanQualitySnapshot } from "../types";

const AUTO_SCAN_HOLD_MS = 5000;
const SECOND_FRAME_DELAY_MS = 120;
const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;
const MATCH_THRESHOLD = 0.18;
const SCAN_CARD_WIDTH_PX = 340;
const SCAN_CARD_SAFE_HEIGHT_PX = 560;
const MIN_TARGET_WIDTH_PX = 96;
const MIN_TARGET_HEIGHT_PX = 72;
const MIN_TARGET_AREA_RATIO = 0.018;
const MIN_AUTOSCAN_OBJECT_AREA_RATIO = 0.035;
const MIN_AUTOSCAN_CENTERED_SCORE = 58;
const MIN_AUTOSCAN_CONFIDENCE = 0.48;
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

type ScanRewardState = {
  detail: string;
  message: string;
};

type AutoScanGuide = "move_closer" | "center_part" | "hold_still" | null;

type SizeReferencePreset = "card_short_edge" | "card_long_edge" | "us_quarter" | "us_nickel";

type SizeCalibration = {
  capturedAt: string;
  preset: SizeReferencePreset;
  referenceMm: number;
  referencePx: number;
};

export default function Scanner() {
  const location = useLocation();
  const navigate = useNavigate();
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
  const [scanReward, setScanReward] = useState<ScanRewardState | null>(null);
  const [sizeReferencePreset, setSizeReferencePreset] = useState<SizeReferencePreset>("card_short_edge");
  const [sizeCalibration, setSizeCalibration] = useState<SizeCalibration | null>(null);
  const autoScanStartedRef = useRef(false);
  const cancelScanRef = useRef(false);
  const qualityFailureInAttemptRef = useRef(false);
  const lastQualityFailureRef = useRef<ScanQualityCoachIssue | null>(null);
  const activeScanStartedAtRef = useRef(0);
  const scanRequestIdRef = useRef(0);
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
  const { error: motionError, isStable, needsPermission, requestPermission, usesFallback } =
    useStillness();
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
    isTargetTooSmall: isTargetTooSmallNow,
    isStable,
    qualityCoach,
    scanReview,
    targetProgress,
    usesFallback,
  });

  const anchoredReviewTarget = useMemo(
    () => getAnchoredReviewTarget(scanReview?.reviewTarget ?? null, objectTarget),
    [objectTarget, scanReview?.reviewTarget],
  );

  const isMismatch = scanReview?.reviewTarget && objectTarget
    ? isTargetMismatch(scanReview.reviewTarget, objectTarget)
    : false;

  const pauseAutoScan = useCallback((message?: string) => {
    const shouldPause = Boolean(message);
    setAutoScanPaused(shouldPause);
    setCaptureError(message ? message : null);
    autoScanStartedRef.current = false;
    if (shouldPause) {
      window.setTimeout(() => setAutoScanPaused(false), 1800);
    }
  }, []);

  const reviewCardPlacement = getReviewCardPlacement(anchoredReviewTarget);

  const stopForQualityCoach = useCallback((issue: ScanQualityCoachIssue) => {
    qualityFailureInAttemptRef.current = true;
    lastQualityFailureRef.current = issue;
    recordScanQualityFailure(issue);
    setQualityCoach(getScanQualityCoach(issue));
    setScanReward(null);
    setCaptureError(null);
    setAutoScanPaused(true);
    autoScanStartedRef.current = false;
    window.setTimeout(() => setAutoScanPaused(false), 1800);
  }, []);

  const beginScanRequest = useCallback(() => {
    cancelScanRef.current = false;
    setAutoScanPaused(false);
    setCaptureError(null);
    setScanReward(null);
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
      requestId: number;
      reviewTarget: ScanReviewTarget | null;
      source: ScanReviewResultSource;
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
  }, [isScanRequestActive, scanCardPrefs.compactCardsByDefault, syncSavedLookup]);

  const analyzeImageBase64 = useCallback(async (
    imageBase64: string,
    requestId: number,
    secondFrameProvider?: () => Promise<string>,
    reviewTargetOverride?: CameraObjectTarget,
  ) => {
    const sourceUpdatedAt = new Date().toISOString();
    const reviewTarget = reviewTargetOverride ? getReviewTargetFromObject(reviewTargetOverride) : null;

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
      motionFallback: usesFallback,
      motionStable: isStable,
      previousFailureReason: lastQualityFailureRef.current,
      quality,
      target: reviewTargetOverride ?? null,
    });
    setScanReward({
      detail: "Deep Spec can identify from this frame.",
      message: "Great - sharp enough",
    });
    pulseScanSuccess();

    const frame: CapturedFrame = {
      imageBase64,
      capturedAt: new Date().toISOString(),
    };
    saveLatestScanState({ frame, scanQuality });

    setAnalysisStep("Checking saved matches");
    const imageHash = await hashImageDataUrl(imageBase64);
    if (!isScanRequestActive(requestId)) return;
    if (imageHash) {
      const cached = getCachedScanResult(imageHash);
      if (cached) {
        setAnalysisStep("Opening review");
        recordScanOutcome(cached);
        await persistAndShowReview(
          { frame, result: cached, analyzedAt: new Date().toISOString(), scanQuality },
          {
            requestId,
            reviewTarget,
            source: "metadata",
            sourceUpdatedAt,
          },
        );
        return;
      }
    }

    let focusedFrame: CapturedFrame | undefined;
    let secondFrame: CapturedFrame | undefined;
    const focusedCrop = reviewTargetOverride?.normalized
      ? await createFocusedScanCrop(imageBase64, reviewTargetOverride.normalized)
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
      const result = await identifyCapturedFrame(focusedFrame ?? frame, focusedFrame ? undefined : secondFrame);
      if (!isScanRequestActive(requestId)) return;
      if (imageHash) setCachedScanResult(imageHash, result);
      recordScanOutcome(result);
      setAnalysisStep("Saving result");
      await persistAndShowReview(
        {
          frame,
          result,
          analyzedAt: new Date().toISOString(),
          scanQuality,
        },
        {
          requestId,
          reviewTarget,
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
        },
        {
          requestId,
          reviewTarget,
          source: "AI detection",
          sourceUpdatedAt,
        },
      );
    }
  }, [isScanRequestActive, isStable, persistAndShowReview, recordScanOutcome, selectedCameraId, stopForQualityCoach, usesFallback]);

  const handleIdentify = useCallback(async (reviewTargetOverride?: CameraObjectTarget) => {
    if (isAnalyzing) {
      return;
    }

    const reviewTarget = reviewTargetOverride ?? objectTarget ?? undefined;
    const requestId = beginScanRequest();
    try {
      setIsAnalyzing(true);
      setAnalysisStep("Capturing photo");
      setCaptureError(null);
      const imageBase64 = await captureFrame();
      if (!isScanRequestActive(requestId)) return;

      await analyzeImageBase64(imageBase64, requestId, captureFrame, reviewTarget);
    } catch (error) {
      if (isScanRequestActive(requestId)) {
        pauseAutoScan(error instanceof Error ? error.message : "Capture failed. Try again.");
      }
    } finally {
      if (isScanRequestActive(requestId)) {
        setIsAnalyzing(false);
        setAnalysisStep(null);
      }
    }
  }, [analyzeImageBase64, beginScanRequest, captureFrame, isAnalyzing, isScanRequestActive, objectTarget, pauseAutoScan]);

  const handleGalleryFile = useCallback(async (file: File) => {
    if (isAnalyzing) {
      return;
    }

    const requestId = beginScanRequest();
    try {
      autoScanStartedRef.current = false;
      setIsAnalyzing(true);
      setAnalysisStep("Loading photo");
      setCaptureError(null);
      const imageBase64 = await readImageFileAsDataUrl(file);
      if (!isScanRequestActive(requestId)) return;
      await analyzeImageBase64(imageBase64, requestId);
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
    const referencePx = Math.max(scanReview.reviewTarget.width, scanReview.reviewTarget.height);
    if (referencePx < 36) {
      setScanCardStatusMessage("Reference target is too small. Move closer and lock the object.");
      return;
    }

    setSizeCalibration({
      capturedAt: new Date().toISOString(),
      preset: sizeReferencePreset,
      referenceMm,
      referencePx,
    });
    setScanCardStatusMessage(`${getSizeReferenceLabel(sizeReferencePreset)} saved for AR size estimates.`);
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

    const widthMm = estimateMm(scanReview.reviewTarget.width, sizeCalibration);
    const heightMm = estimateMm(scanReview.reviewTarget.height, sizeCalibration);
    const label = getReviewDisplayLabel(scanReview);
    const fastenerHint = /nut|bolt|screw|stud|thread|fastener/i.test(label)
      ? getFastenerSizeHint(Math.max(widthMm, heightMm))
      : null;
    const uncertainty = getMeasurementUncertainty(scanReview.reviewTarget, sizeCalibration);
    const summary = fastenerHint
      ? `${label}: ${widthMm.toFixed(1)} x ${heightMm.toFixed(1)} mm (approx). ${fastenerHint} Uncertainty: ${uncertainty}.`
      : `${label}: ${widthMm.toFixed(1)} x ${heightMm.toFixed(1)} mm (approx). Uncertainty: ${uncertainty}.`;

    const copied = await copyText(summary);
    setScanCardStatusMessage(
      copied
        ? "AR size estimate copied. Keep reference and target on the same depth plane."
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

  useEffect(() => {
    if (!isAutoScanReady || cameraState !== "ready" || isAnalyzing || autoScanPaused || scanReview) {
      return;
    }

    if (autoScanStartedRef.current) {
      return;
    }

    autoScanStartedRef.current = true;
    pulseTargetLock();
    void handleIdentify();
  }, [autoScanPaused, cameraState, handleIdentify, isAnalyzing, isAutoScanReady, scanReview]);

  useEffect(() => {
    if (!hasTargetLock && !isAnalyzing) {
      autoScanStartedRef.current = false;
    }
  }, [hasTargetLock, isAnalyzing]);

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
    setScanReward(null);
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

      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_bottom,rgba(2,6,23,0.58),rgba(2,6,23,0)_30%,rgba(2,6,23,0)_58%,rgba(2,6,23,0.74))]" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[42dvh] bg-[radial-gradient(circle_at_50%_72%,rgba(11,116,255,0.18),rgba(2,6,23,0)_34%),linear-gradient(to_top,rgba(2,6,23,0.86),rgba(2,6,23,0))]" />

      <header className="fixed left-0 right-0 top-0 z-20 px-5 pt-[max(18px,env(safe-area-inset-top))]">
        <div className="grid grid-cols-[96px_1fr_44px] items-center gap-3">
          <div className="grid h-11 w-24 place-items-center overflow-hidden rounded-full bg-white/94 px-2 ring-1 ring-white/30 backdrop-blur-xl">
            <img src="/brand/deepspec-logo.png" alt="Deep Spec" className="h-9 w-full object-contain" />
          </div>
          <div className="rounded-full bg-slate-950/54 px-4 py-2 text-center ring-1 ring-white/12 backdrop-blur-xl">
            <p className="text-[13px] font-extrabold tracking-tight text-white">Deep Spec</p>
            <p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-[var(--ds-accent)]">AI part scanner</p>
          </div>
          <Link
            to="/early-access"
            aria-label="Early access"
            className="grid size-11 place-items-center rounded-full bg-slate-950/54 text-lg font-black leading-none text-white ring-1 ring-white/12 backdrop-blur-xl"
          >
            +
          </Link>
        </div>
        <p className="mx-auto mt-3 w-fit rounded-full bg-slate-950/42 px-3 py-2 text-center text-xs font-extrabold text-white/78 ring-1 ring-white/12 backdrop-blur-xl">
          {scannerStatus}
        </p>
      </header>

      {cameraState === "loading" ? <CameraLoading /> : null}
      {cameraState === "blocked" ? (
        <CameraBlocked
          devices={cameraDevices}
          isRetakeGuide={isRetakeGuide}
          message={cameraError}
          onRetry={retryCamera}
          onSelectCamera={selectCamera}
          selectedCameraId={selectedCameraId}
        />
      ) : null}

      {cameraState !== "blocked" ? (
        <>
          <Reticle
            isLocked={isAutoScanReady}
            isVisible={cameraState === "ready" && !scanReview}
            label={getReticleLabel({
              autoScanGuide,
              autoScanSeconds,
              hasTarget: Boolean(objectTarget),
              hasTargetLock,
              isTargetTooSmall: isTargetTooSmallNow,
              qualityCoach,
            })}
            progress={targetProgress}
          />
          {cameraState === "ready" && objectTarget && !scanReview && !isAnalyzing ? (
            <TapTargetButton
              isLocked={isAutoScanReady}
              isTooSmall={isTargetTooSmallNow}
              onSelect={() => void handleIdentify(objectTarget)}
              target={objectTarget}
            />
          ) : null}

          {needsPermission ? <MotionPermissionModal error={motionError} onAllow={requestPermission} /> : null}
          {qualityCoach ? (
            <ScanQualityCoachNotice
              coach={qualityCoach}
              onTryAgain={() => void handleIdentify()}
            />
          ) : null}
          {captureError ? <CaptureErrorNotice message={captureError} onTryAgain={() => setCaptureError(null)} /> : null}
          {scanReward && !qualityCoach ? <ScanRewardBadge reward={scanReward} /> : null}
          {isRetakeGuide && !scanReward && !qualityCoach && !isAnalyzing && !scanReview ? <RetakeGuideNotice /> : null}
        </>
      ) : null}
      {scanReview?.scanState.result ? (
        <LensPartOverlays result={scanReview.scanState.result} target={anchoredReviewTarget} />
      ) : null}
      <GalleryScanButton
        isDisabled={isAnalyzing}
        onFileSelected={(file) => void handleGalleryFile(file)}
      />
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
      <IdentifyButton
        isDisabled={cameraState !== "ready" || isAnalyzing || isTargetTooSmallNow}
        isReady={cameraState === "ready" && !isAnalyzing && !scanReview && !isTargetTooSmallNow && (hasTargetLock || usesFallback || isStable)}
        isVisible={cameraState !== "blocked" && !scanReview}
        onIdentify={() => void handleIdentify()}
      />
      <HistoryDockButton />
    </main>
  );
}

function getScannerStatus({
  autoScanGuide,
  autoScanPaused,
  autoScanSeconds,
  cameraState,
  hasTarget,
  hasTargetLock,
  isTargetTooSmall,
  isStable,
  qualityCoach,
  scanReview,
  targetProgress,
  usesFallback,
}: {
  autoScanGuide: AutoScanGuide;
  autoScanPaused: boolean;
  autoScanSeconds: number;
  cameraState: string;
  hasTarget: boolean;
  hasTargetLock: boolean;
  isTargetTooSmall: boolean;
  isStable: boolean;
  qualityCoach: ScanQualityCoachState | null;
  scanReview: ScanReviewState | null;
  targetProgress: number;
  usesFallback: boolean;
}) {
  if (cameraState !== "ready") {
    return "Opening camera";
  }

  if (qualityCoach) {
    return qualityCoach.action;
  }

  if (scanReview) {
    return "Review scan";
  }

  if (autoScanPaused) {
    return "Scan paused";
  }

  if (isTargetTooSmall) {
    return "Move closer";
  }

  if (autoScanGuide === "move_closer") {
    return "Move closer";
  }

  if (autoScanGuide === "center_part") {
    return "Center one part";
  }

  if (autoScanGuide === "hold_still") {
    return "Hold still";
  }

  if (hasTargetLock) {
    return "Locked";
  }

  if (hasTarget) {
    return `You're ${Math.max(10, Math.round(targetProgress * 100))}% there`;
  }

  if (!usesFallback && !isStable) {
    return "Hold still";
  }

  return autoScanSeconds > 1 ? "Center part" : "Hold still";
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
    return { guide: null, isReady: false };
  }

  if (!usesFallback && !isStable) {
    return { guide: "hold_still", isReady: false };
  }

  return { guide: null, isReady: true };
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

function roundRatio(value: number) {
  return Math.round(value * 1000) / 1000;
}

function pulseTargetLock() {
  vibrate([18, 36, 24]);
}

function pulseScanSuccess() {
  vibrate([12, 28, 18]);
}

function vibrate(pattern: VibratePattern) {
  if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
    navigator.vibrate(pattern);
  }
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

  if (isTargetTooSmall) {
    return "Move closer";
  }

  if (autoScanGuide === "move_closer") {
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
    return `Hold still ${autoScanSeconds}s`;
  }

  return "Center part";
}

function CameraLoading() {
  return (
    <div className="fixed inset-0 z-10 grid place-items-center bg-[var(--ds-bg)] px-6 text-center">
      <div className="rounded-[24px] border border-white/10 bg-white/10 p-5 shadow-2xl backdrop-blur-md">
        <div className="mx-auto grid size-12 place-items-center rounded-full border-2 border-white/10 border-t-[var(--ds-accent)]" />
        <p className="mt-4 text-sm font-extrabold text-white">Opening camera</p>
      </div>
    </div>
  );
}

function CameraBlocked({
  devices,
  isRetakeGuide,
  message,
  onRetry,
  onSelectCamera,
  selectedCameraId,
}: {
  devices: CameraDevice[];
  isRetakeGuide: boolean;
  message: string | null;
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
        <Button className="mt-6" onClick={onRetry}>
          Try camera again
        </Button>
        <button className="mx-auto mt-4 block text-xs font-bold text-white/48 underline underline-offset-4" onClick={() => window.location.reload()}>
          Reload app
        </button>
      </div>
    </div>
  );
}

function GalleryScanButton({
  isDisabled,
  onFileSelected,
}: {
  isDisabled: boolean;
  onFileSelected: (file: File) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <>
      <button
        type="button"
        aria-controls="scanner-gallery-upload"
        className={`fixed bottom-[112px] left-1/2 z-40 -translate-x-1/2 rounded-full bg-slate-950/62 px-4 py-2 text-xs font-extrabold text-white ring-1 ring-white/14 backdrop-blur-xl transition ${
          isDisabled ? "pointer-events-none opacity-45" : "cursor-pointer opacity-100"
        }`}
        disabled={isDisabled}
        onClick={() => inputRef.current?.click()}
      >
        Upload photo
      </button>
      <input
        ref={inputRef}
        id="scanner-gallery-upload"
        aria-label="Upload photo"
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        disabled={isDisabled}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (file) {
            onFileSelected(file);
          }
        }}
        type="file"
      />
    </>
  );
}

function AnalyzingOverlay({ onCancel, step }: { onCancel: () => void; step: string | null }) {
  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-slate-950/78 px-6 text-center backdrop-blur-md">
      <div className="w-full max-w-xs overflow-hidden rounded-[24px] border border-white/12 bg-slate-950/94 p-6 shadow-2xl">
        <div className="relative mx-auto grid size-24 place-items-center">
          <div className="absolute inset-0 rounded-full border border-white/10" />
          <div className="absolute inset-2 animate-spin rounded-full border-2 border-white/10 border-t-[var(--ds-accent)]" />
          <div className="absolute inset-7 rounded-full bg-[var(--ds-accent)]/16 shadow-[0_0_38px_rgba(11,116,255,0.45)]" />
          <div className="scanner-analysis-sweep absolute inset-x-3 top-1/2 h-0.5 rounded-full bg-[var(--ds-accent)]" />
        </div>
        <p className="mt-5 text-lg font-extrabold tracking-tight text-white">Analyzing photo</p>
        <p className="mt-2 text-sm leading-6 text-[#A1A1AA]">{step ?? "Matching the scan against vehicle data."}</p>
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
    <div className="fixed bottom-[210px] left-1/2 z-30 w-[calc(100%-32px)] max-w-sm -translate-x-1/2 overflow-hidden rounded-[24px] border border-white/14 bg-slate-950/94 text-center text-white shadow-[0_22px_70px_rgba(2,6,23,0.66)] backdrop-blur-xl">
      <div className="bg-[var(--ds-accent)]/12 px-5 py-4">
        <p className="text-xs font-extrabold uppercase tracking-[0.16em] text-[var(--ds-accent)]">{coach.progress}</p>
        <h2 className="mt-1 text-2xl font-black tracking-tight">{coach.title}</h2>
      </div>
      <div className="px-5 py-5">
        <p className="text-lg font-black leading-7 text-white">
          {coach.action}
        </p>
        <p className="mt-1 text-sm font-semibold leading-6 text-white/62">
          Try this exact fix, then scan again.
        </p>
        <Button className="mt-4 w-full" onClick={onTryAgain}>
          Scan again
        </Button>
      </div>
    </div>
  );
}

function ScanRewardBadge({ reward }: { reward: ScanRewardState }) {
  return (
    <div className="fixed bottom-[198px] left-1/2 z-30 w-[calc(100%-32px)] max-w-xs -translate-x-1/2 rounded-[22px] border border-[var(--ds-ok-line)] bg-emerald-950/88 px-4 py-3 text-center text-white shadow-[0_20px_58px_rgba(16,185,129,0.28)] backdrop-blur-xl">
      <p className="text-sm font-black tracking-tight text-[var(--ds-ok-ink)]">{reward.message}</p>
      <p className="mt-1 text-xs font-semibold leading-5 text-white/68">{reward.detail}</p>
    </div>
  );
}

function RetakeGuideNotice() {
  return (
    <div className="fixed bottom-[198px] left-1/2 z-20 w-[calc(100%-32px)] max-w-sm -translate-x-1/2 rounded-[22px] border border-white/14 bg-slate-950/86 px-4 py-3 text-center text-white shadow-[0_18px_54px_rgba(2,6,23,0.5)] backdrop-blur-xl">
      <p className="text-xs font-extrabold uppercase tracking-[0.16em] text-[var(--ds-accent)]">Retake guide</p>
      <p className="mt-1 text-sm font-black">Fill the frame from a slight angle.</p>
      <p className="mt-1 text-xs font-semibold leading-5 text-white/64">Keep labels, bolt heads, or connectors visible.</p>
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
  const style = getTapTargetStyle(target);
  const label = isTooSmall ? "Move closer" : isLocked ? "Scan this part" : "Tap part";

  return (
    <button
      aria-label={isTooSmall ? "Selected part is too small" : "Scan selected part"}
      className={`fixed z-20 rounded-[22px] border-2 bg-black/10 transition-[border-color,box-shadow,background-color] ${
        isLocked
          ? "border-[var(--ds-ok-line)] shadow-[0_0_38px_rgba(16,185,129,0.36)]"
          : "border-[var(--ds-accent)] shadow-[0_0_34px_rgba(11,116,255,0.34)]"
      }`}
      disabled={isTooSmall}
      onClick={onSelect}
      style={style}
      type="button"
    >
      <span className="absolute left-1/2 top-[-38px] -translate-x-1/2 whitespace-nowrap rounded-full bg-slate-950/82 px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.14em] text-white shadow-[0_12px_30px_rgba(2,6,23,0.35)] ring-1 ring-white/12 backdrop-blur-md">
        {label}
      </span>
    </button>
  );
}

type LensDetection = {
  id: string;
  label: string;
  detail: string;
  box: {
    left: number;
    top: number;
    width: number;
    height: number;
  };
  primary: boolean;
};

function LensPartOverlays({ result, target }: { result: IdentificationResult; target: ScanReviewTarget | null }) {
  const detections = getLensDetections(result, target);
  if (!detections.length) {
    return null;
  }

  return (
    <div className="pointer-events-none fixed inset-0 z-40" aria-label="Detected part overlays">
      {detections.map((detection, index) => (
        <div
          key={detection.id}
          data-testid={`lens-part-overlay-${index}`}
          className={`absolute rounded-[18px] border-2 shadow-[0_0_0_999px_rgba(2,6,23,0.02)] ${
            detection.primary
              ? "border-[var(--ds-accent)] bg-[var(--ds-accent)]/10"
              : "border-cyan-200/82 bg-cyan-300/8"
          }`}
          style={{
            height: detection.box.height,
            left: detection.box.left,
            top: detection.box.top,
            width: detection.box.width,
          }}
        >
          <div
            className={`absolute left-2 top-2 max-w-[min(220px,62vw)] rounded-full px-3 py-1.5 text-[11px] font-black tracking-tight text-white shadow-[0_10px_24px_rgba(0,0,0,0.3)] backdrop-blur-md ${
              detection.primary ? "bg-[var(--ds-accent)]" : "bg-slate-950/78"
            }`}
          >
            <span data-testid={detection.primary ? "lens-primary-label" : undefined}>{detection.label}</span>
            <span className="ml-2 font-extrabold text-white/72">{detection.detail}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function getLensDetections(result: IdentificationResult, target: ScanReviewTarget | null): LensDetection[] {
  const primaryBox = target ? targetToLensBox(target) : regionLabelToLensBox("center", 0);
  const detections: LensDetection[] = [
    {
      id: `primary:${result.partName}`,
      label: result.partName,
      detail: result.confidence,
      box: primaryBox,
      primary: true,
    },
  ];

  const primaryLabel = result.partName.trim().toLowerCase();
  result.evidenceRegions
    .filter((region) => region.label.trim().toLowerCase() !== primaryLabel)
    .slice(0, 5)
    .forEach((region, index) => {
      detections.push({
        id: `region:${region.regionLabel}:${region.label}`,
        label: region.label,
        detail: summarize(region.observation || region.regionLabel, 34),
        box: target
          ? regionToTargetSubBox(region.regionLabel, index, primaryBox)
          : regionLabelToLensBox(region.regionLabel, index + 1),
        primary: false,
      });
    });

  return detections.slice(0, 6);
}

function targetToLensBox(target: ScanReviewTarget) {
  return {
    left: clampNumber(target.x, 8, Math.max(8, window.innerWidth - 80)),
    top: clampNumber(target.y, 84, Math.max(84, window.innerHeight - 120)),
    width: clampNumber(target.width, 96, Math.min(420, window.innerWidth - 16)),
    height: clampNumber(target.height, 82, Math.min(360, window.innerHeight - 140)),
  };
}

function getTapTargetStyle(target: CameraObjectTarget): CSSProperties {
  return {
    height: target.height,
    left: target.left,
    top: target.top,
    width: target.width,
  };
}

function regionLabelToLensBox(regionLabel: string, index: number) {
  const label = regionLabel.toLowerCase();
  const width = Math.min(260, Math.max(126, window.innerWidth * 0.32));
  const height = Math.min(150, Math.max(82, window.innerHeight * 0.14));
  const leftColumn = Math.max(14, window.innerWidth * 0.08);
  const rightColumn = Math.max(14, window.innerWidth - width - window.innerWidth * 0.08);
  const topRow = Math.max(92, window.innerHeight * 0.2);
  const middleRow = Math.max(112, window.innerHeight * 0.42);
  const lowerRow = Math.min(window.innerHeight - height - 110, window.innerHeight * 0.64);

  if (/upper|top/.test(label) && /left/.test(label)) return { left: leftColumn, top: topRow, width, height };
  if (/upper|top/.test(label) && /right/.test(label)) return { left: rightColumn, top: topRow, width, height };
  if (/lower|bottom/.test(label) && /left/.test(label)) return { left: leftColumn, top: lowerRow, width, height };
  if (/lower|bottom/.test(label) && /right/.test(label)) return { left: rightColumn, top: lowerRow, width, height };
  if (/left/.test(label)) return { left: leftColumn, top: middleRow, width, height };
  if (/right/.test(label)) return { left: rightColumn, top: middleRow, width, height };
  if (/lower|bottom/.test(label)) return { left: (window.innerWidth - width) / 2, top: lowerRow, width, height };
  if (/upper|top/.test(label)) return { left: (window.innerWidth - width) / 2, top: topRow, width, height };

  const offset = index % 2 === 0 ? -0.13 : 0.13;
  return {
    left: clampNumber((window.innerWidth - width) * (0.5 + offset), 14, window.innerWidth - width - 14),
    top: clampNumber(middleRow + index * 12, 92, window.innerHeight - height - 110),
    width,
    height,
  };
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
  const lastUpdated = formatTimestamp(review.sourceUpdatedAt);
  const targetOverlayStyle = getReviewTargetOverlayStyle(target);
  const threeDSearchUrl = get3DSearchUrl(label);
  const referenceSummary = sizeCalibration
    ? `${getSizeReferenceLabel(sizeCalibration.preset)} (${sizeCalibration.referenceMm.toFixed(2)} mm)`
    : "Exact size needs a reference object.";
  const showPrecisionTools = isFastener || isExpanded;

  return (
    <section
      aria-live="polite"
      data-anchor-side={placement.anchorSide}
      className="pointer-events-auto fixed inset-x-3 bottom-[max(16px,env(safe-area-inset-bottom))] z-50 mx-auto flex max-h-[min(58dvh,520px)] max-w-[520px] flex-col overflow-y-auto rounded-[30px] border border-white/14 bg-slate-950/96 px-4 pb-4 pt-3 text-white shadow-[0_24px_64px_rgba(2,6,23,0.72)] backdrop-blur-xl"
    >
      <div className="mx-auto mb-3 h-1.5 w-12 shrink-0 rounded-full bg-white/24" />
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-[var(--ds-accent)]">Lens result</p>
          <h3 className="mt-1 text-xl font-black leading-tight tracking-tight">{label}</h3>
          <div className="mt-2 flex flex-wrap gap-2">
            <span className="rounded-full border border-[var(--ds-accent-line)] bg-[var(--ds-accent-soft)] px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-[0.08em] text-white">
              {result?.scanCategory ?? "unknown"}
            </span>
            {!prefs.hideConfidence && confidence ? (
              <span className={`rounded-full border px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-[0.08em] ${statusStyle.chip}`}>
                {confidenceRange ? `${confidenceRange.low}-${confidenceRange.high}% likely` : `${confidence} confidence`}
              </span>
            ) : null}
            <span className="rounded-full border border-white/12 bg-white/6 px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-[0.08em] text-white/78">
              {review.source}
            </span>
          </div>
          <p className="mt-2 text-[11px] text-white/50">Updated {lastUpdated}</p>
        </div>
        <button
          className="grid size-8 shrink-0 place-items-center rounded-full border border-white/12 text-sm text-white/62 hover:bg-white/8"
          onClick={onClose}
          type="button"
          aria-label="Close result card"
        >
          x
        </button>
      </div>

      <div className={`mt-4 border-t border-white/10 pt-3 text-xs leading-6 text-white/82 ${statusStyle.accent}`}>
        {isMismatch ? (
          <div className="mb-3 border-l-2 border-[var(--ds-danger)] pl-3">
            <SectionTitle>Target changed</SectionTitle>
            <p className="text-[12px] text-[var(--ds-danger-ink)]">The current object moved away from the saved scan point.</p>
            <button
              className="mt-2 rounded-full bg-[var(--ds-danger)] px-3 py-2 text-[10px] font-extrabold text-white"
              onClick={onRetryMismatch}
              type="button"
            >
              Rescan this point
            </button>
          </div>
        ) : null}
        {review.scanState.errorMessage ? (
          <>
            <SectionTitle>Scan issue</SectionTitle>
            <p className="text-[12px] text-[var(--ds-danger-ink)]">{review.scanState.errorMessage}</p>
          </>
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
          <div className="space-y-2">
            {result.candidateMatches.slice(0, isExpanded ? 4 : 2).map((candidate) => (
              <div className="border-l border-white/16 pl-3" key={candidate.partName}>
                <p className="font-black text-white">{candidate.partName}</p>
                <p className="text-white/64">{summarize(candidate.reason, isCompact ? 90 : 140)}</p>
              </div>
            ))}
          </div>
        </BubbleSection>
      ) : null}

      {isExpanded ? (
        <BubbleSection title="Image area">
          <div className="relative mt-2 overflow-hidden rounded-xl border border-white/12 bg-black/30">
            <img
              alt={`Scan photo for ${label}`}
              className="h-32 w-full object-cover"
              src={review.scanState.frame.imageBase64}
            />
            {targetOverlayStyle ? (
              <span
                aria-hidden
                className="absolute rounded-sm border-2 border-[var(--ds-accent)] bg-[var(--ds-accent)]/25 shadow-[0_0_0_1px_rgba(11,116,255,0.45)]"
                style={{
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
          <p>
            Reference required. Put the card or coin on the same flat plane as the fastener, then estimate size.
          </p>
          <p className="mt-2 text-white/60">
            Output stays an estimate until depth and angle are verified.
          </p>
        </BubbleSection>
      ) : null}

      <BubbleSection title="Actions">
        <div className="grid grid-cols-2 gap-2">
          <button
            className="col-span-2 min-h-11 rounded-full bg-[var(--ds-accent)] text-sm font-black tracking-tight text-white"
            onClick={onOpenDetails}
            type="button"
          >
            Open details
          </button>
          {showPrecisionTools ? (
            <>
              <label className="col-span-2 block">
                <span className="mb-1 block text-[10px] font-black uppercase tracking-[0.12em] text-white/64">Size reference</span>
                <select
                  aria-label="Size reference preset"
                  className="h-10 w-full rounded-full border border-white/12 bg-slate-950/92 px-3 text-[11px] font-black text-white outline-none focus:border-[var(--ds-accent)]"
                  onChange={(event) => onSizeReferencePresetChange(event.target.value as SizeReferencePreset)}
                  value={sizeReferencePreset}
                >
                  <option value="card_short_edge">Card short edge (53.98 mm)</option>
                  <option value="card_long_edge">Card long edge (85.60 mm)</option>
                  <option value="us_quarter">US quarter (24.26 mm)</option>
                  <option value="us_nickel">US nickel (21.21 mm)</option>
                </select>
              </label>
              <button
                className="min-h-10 rounded-full border border-white/10 bg-white/8 text-xs font-black text-white/92"
                onClick={onSetSizeReference}
                type="button"
              >
                Set reference
              </button>
              <button
                className="min-h-10 rounded-full border border-white/10 bg-white/8 text-xs font-black text-white/92"
                onClick={onMeasure}
                type="button"
              >
                Estimate size
              </button>
              <p className="col-span-2 text-[10px] font-semibold leading-5 text-white/66">
                {referenceSummary}
              </p>
            </>
          ) : null}
          {isExpanded ? (
            <button
              className="col-span-2 min-h-10 rounded-full border border-white/10 bg-white/8 text-xs font-black text-white/92"
              onClick={onCopyValue}
              type="button"
            >
              Copy match
            </button>
          ) : null}
          {isExpanded && review.scanState.result ? (
            <a
              className="col-span-2 rounded-full border border-[var(--ds-evidence-line)] bg-[var(--ds-evidence-soft)] px-3 py-2 text-center text-[11px] font-black uppercase tracking-[0.12em] text-white/78"
              href={threeDSearchUrl}
              rel="noreferrer"
              target="_blank"
            >
              Search 3D models for this part
            </a>
          ) : null}
        </div>
        {isReplacing ? (
          <div className="mt-2 space-y-2">
            <input
              aria-label="replacement label"
              className="w-full rounded-xl border border-white/12 bg-slate-950 px-3 py-2 text-sm text-white outline-none placeholder:text-white/42"
              maxLength={80}
              onChange={(event) => onReplacementLabelChange(event.target.value)}
              placeholder="Example: coolant reservoir cap"
              value={replacementLabel}
            />
            <div className="grid grid-cols-2 gap-2">
              <button
                className="rounded-full bg-white/85 px-3 py-2 text-xs font-black text-slate-900"
                onClick={onReportReplace}
                type="button"
              >
                Save correction
              </button>
              <button
                className="rounded-full border border-white/15 px-3 py-2 text-xs font-black text-white/82"
                onClick={onCancelReplace}
                type="button"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            className="mt-2 w-full rounded-full border border-[var(--ds-accent-line)] bg-[var(--ds-accent-soft)] px-3 py-2 text-xs font-black text-white"
            onClick={onWrongLabel}
            type="button"
          >
            Correct label
          </button>
        )}
        {review.correction ? (
          <div className="flex items-center justify-between gap-2 rounded-full border border-white/12 bg-white/8 px-3 py-2 text-xs">
            <span className="font-black">Correction: {review.correction}</span>
            <button className="font-black underline underline-offset-2" onClick={onUndoCorrection} type="button">
              Undo
            </button>
          </div>
        ) : null}
      </BubbleSection>

      <div className="mt-2 flex items-center justify-between gap-3 border-t border-white/10 pt-3 text-xs">
        <button className="underline underline-offset-2" onClick={onToggleExpand} type="button">
          {isExpanded ? "Show less" : "Show more"}
        </button>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button className="underline underline-offset-2" onClick={onToggleCompactMode} type="button">
            {prefs.compactCardsByDefault ? "Compact cards on" : "Compact cards off"}
          </button>
          <button className="underline underline-offset-2" onClick={onToggleHideConfidence} type="button">
            {prefs.hideConfidence ? "Show confidence" : "Hide confidence"}
          </button>
        </div>
      </div>
      {scanCardStatusMessage ? <p className="mt-2 text-xs font-extrabold text-white/72">{scanCardStatusMessage}</p> : null}
    </section>
  );
}

function regionToTargetSubBox(regionLabel: string, index: number, primaryBox: LensDetection["box"]) {
  const inset = 6;
  const innerLeft = primaryBox.left + inset;
  const innerTop = primaryBox.top + inset;
  const innerWidth = Math.max(64, primaryBox.width - inset * 2);
  const innerHeight = Math.max(58, primaryBox.height - inset * 2);
  const halfWidth = Math.max(52, innerWidth * 0.47);
  const halfHeight = Math.max(46, innerHeight * 0.46);
  const lowerTop = innerTop + Math.max(8, innerHeight - halfHeight);
  const rightLeft = innerLeft + Math.max(8, innerWidth - halfWidth);
  const label = regionLabel.toLowerCase();

  if (/upper|top/.test(label) && /left/.test(label)) {
    return { left: innerLeft, top: innerTop, width: halfWidth, height: halfHeight };
  }
  if (/upper|top/.test(label) && /right/.test(label)) {
    return { left: rightLeft, top: innerTop, width: halfWidth, height: halfHeight };
  }
  if (/lower|bottom/.test(label) && /left/.test(label)) {
    return { left: innerLeft, top: lowerTop, width: halfWidth, height: halfHeight };
  }
  if (/lower|bottom/.test(label) && /right/.test(label)) {
    return { left: rightLeft, top: lowerTop, width: halfWidth, height: halfHeight };
  }
  if (/left/.test(label)) {
    return { left: innerLeft, top: innerTop + innerHeight * 0.24, width: halfWidth, height: halfHeight };
  }
  if (/right/.test(label)) {
    return { left: rightLeft, top: innerTop + innerHeight * 0.24, width: halfWidth, height: halfHeight };
  }
  if (/upper|top/.test(label)) {
    return { left: innerLeft + (innerWidth - halfWidth) / 2, top: innerTop, width: halfWidth, height: halfHeight };
  }
  if (/lower|bottom/.test(label)) {
    return { left: innerLeft + (innerWidth - halfWidth) / 2, top: lowerTop, width: halfWidth, height: halfHeight };
  }

  const slots = [
    { left: innerLeft, top: innerTop },
    { left: rightLeft, top: innerTop },
    { left: innerLeft, top: lowerTop },
    { left: rightLeft, top: lowerTop },
    { left: innerLeft + (innerWidth - halfWidth) / 2, top: innerTop + (innerHeight - halfHeight) / 2 },
  ];
  const slot = slots[index % slots.length];
  return { left: slot.left, top: slot.top, width: halfWidth, height: halfHeight };
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
    <div className="fixed bottom-[220px] left-1/2 z-20 w-[calc(100%-32px)] max-w-sm -translate-x-1/2 rounded-2xl border border-[var(--ds-danger-line)] bg-[#2A0F12]/92 p-4 text-center shadow-2xl">
      <p className="text-sm font-extrabold text-[var(--ds-danger-ink)]">{message}</p>
      <Button className="mt-3 w-full" onClick={onTryAgain}>
        Try again
      </Button>
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

function clampReviewTarget(target: ScanReviewTarget): ScanReviewTarget {
  return {
    ...target,
    x: clampNumber(target.x, 6, Math.max(6, window.innerWidth - 60)),
    y: clampNumber(target.y, 6, Math.max(6, window.innerHeight - 60)),
    width: clampNumber(target.width, 48, window.innerWidth),
    height: clampNumber(target.height, 48, window.innerHeight),
    confidence: clampNumber(target.confidence, 0, 1),
  };
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

function getObjectTargetFromReviewTarget(reviewTarget: ScanReviewTarget): CameraObjectTarget {
  return {
    confidence: reviewTarget.confidence,
    height: reviewTarget.height,
    holdProgress: 1,
    id: reviewTarget.id,
    isLocked: true,
    left: reviewTarget.x,
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

function estimateMm(targetPixels: number, calibration: SizeCalibration) {
  const mmPerPixel = calibration.referenceMm / Math.max(1, calibration.referencePx);
  return targetPixels * mmPerPixel;
}

function getFastenerSizeHint(acrossMm: number) {
  const metric = findNearestMetricFastener(acrossMm);
  const sae = findNearestSaeFastener(acrossMm);
  return `Fastener guess: ${metric} wrench / ${sae} (approx).`;
}

function getMeasurementUncertainty(target: ScanReviewTarget, calibration: SizeCalibration) {
  const targetPx = Math.max(target.width, target.height);
  const ratio = targetPx / Math.max(1, calibration.referencePx);
  if (targetPx < 80) {
    return "target small";
  }
  if (ratio < 0.45 || ratio > 2.2) {
    return "reference scale far from target size";
  }
  return "same-plane depth and angle still need visual check";
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
  if (!target) {
    return {
      anchorSide: "right",
      left: 14,
      top: Math.max(72, window.innerHeight - SCAN_CARD_SAFE_HEIGHT_PX),
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

function formatTimestamp(value: string) {
  try {
    return new Date(value).toLocaleString();
  } catch {
    return "just now";
  }
}

function getTargetDistance(a: ScanReviewTarget, b: ScanReviewTarget) {
  const centerXA = a.x + a.width / 2;
  const centerXB = b.x + b.width / 2;
  const centerYA = a.y + a.height / 2;
  const centerYB = b.y + b.height / 2;
  const widthDelta = Math.abs(a.width - b.width) / Math.max(1, window.innerWidth);
  const heightDelta = Math.abs(a.height - b.height) / Math.max(1, window.innerHeight);
  return (
    Math.abs(centerXA - centerXB) / Math.max(1, window.innerWidth)
    + Math.abs(centerYA - centerYB) / Math.max(1, window.innerHeight)
    + widthDelta
    + heightDelta
  ) / 4;
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
