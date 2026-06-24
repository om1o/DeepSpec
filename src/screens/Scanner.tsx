import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import Webcam from "react-webcam";
import { Link, useLocation } from "react-router-dom";
import { FocusedPartOverlay } from "../components/scanner/FocusedPartOverlay";
import Button from "../components/ui/Button";
import { useCamera, type CameraDevice } from "../hooks/useCamera";
import type { CameraObjectTarget } from "../hooks/useObjectTarget";
import { assessImageQuality, type ImageQualityIssue, type ImageQualityResult } from "../lib/imageQuality";
import { createFocusedScanCrop } from "../lib/focusCrop";
import { createSegmentedProductIsolation } from "../lib/productSegmentation";
import { getSimpleResultSummary } from "../lib/simpleResultSummary";
import { getCachedScanResult, hashImageDataUrl, setCachedScanResult } from "../lib/scanCache";
import { getScanCardPreferences, type ScanCardPreferences } from "../lib/scanResultCardSettings";
import { detectObjectTargetFromImageData, type ObjectTargetBox } from "../lib/objectTargeting";
import { compressImageDataUrl, saveLatestScanState } from "../lib/utils";
import { AIServiceError, identifyCapturedFrame } from "../services/aiService";
import { onOnDeviceModelProgress } from "../services/onDeviceIdentify";
import { getCloudSyncStatus, syncLookupToCloud } from "../services/cloudSync";
import { attachScanToJob, buildCustomerVisibleReport, getShopJob, getVehicleContextForJob } from "../services/shop";
import {
  recordAcceptableScan,
  recordIdentifyLatency,
  recordNeedsBetterPhoto,
  recordScanAttempt,
  recordScanQualityFailure,
  recordScanQualityRetake,
} from "../services/scanQualityMetrics";
import { createLookup, updateLookup } from "../services/storage";
import type { Confidence, IdentificationResult, CapturedFrame, Lookup, ScanAnalysisSource, ScanAnalysisState, ScanCaptureMode, ScanQualitySnapshot, ShopJob, ShopVehicleContext, VisualFocusBox, VisualFocusMode } from "../types";

const SECOND_FRAME_DELAY_MS = 120;
const IDENTIFY_BUDGET_WARN_MS = 15000;
const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;
const COMPRESS_UPLOAD_OVER_BYTES = 1024 * 1024;
const SCAN_CARD_WIDTH_PX = 340;
const SCAN_CARD_SAFE_HEIGHT_PX = 560;
const MIN_TARGET_WIDTH_PX = 96;
const MIN_TARGET_HEIGHT_PX = 72;
const MIN_TARGET_AREA_RATIO = 0.018;
const FOCUS_CROP_PADDING = 0.06;

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
  focusTarget: ScanReviewTarget | null;
  isolatedFrame?: CapturedFrame;
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
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [scanReview, setScanReview] = useState<ScanReviewState | null>(null);
  const [scanCardPrefs] = useState<ScanCardPreferences>(() => getScanCardPreferences(location.pathname));
  const [scanCardStatusMessage, setScanCardStatusMessage] = useState<string | null>(null);
  const [qualityCoach, setQualityCoach] = useState<ScanQualityCoachState | null>(null);
  const cancelScanRef = useRef(false);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const activeIdentifyRef = useRef(false);
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
    cameraFacingMode,
    cameraRequestId,
    cameraState,
    captureFrame,
    markError,
    markReady,
    retryCamera,
    selectCamera,
    selectedCameraId,
    switchCamera,
    webcamRef,
  } = useCamera();
  const activeVideoConstraints = useMemo(
    () => getVideoConstraints(selectedCameraId, cameraFacingMode),
    [cameraFacingMode, selectedCameraId],
  );

  const anchoredReviewTarget = useMemo(
    () => (scanReview?.reviewTarget ? clampReviewTarget(scanReview.reviewTarget) : null),
    [scanReview],
  );
  const focusedReviewTarget = useMemo(
    () => (scanReview?.focusTarget ? clampReviewTarget(scanReview.focusTarget) : anchoredReviewTarget),
    [anchoredReviewTarget, scanReview],
  );

  const reviewCardPlacement = getReviewCardPlacement(anchoredReviewTarget);

  const pauseAutoScan = useCallback((message?: string) => {
    setCaptureError(message ?? null);
  }, []);

  const stopForQualityCoach = useCallback((issue: ScanQualityCoachIssue) => {
    qualityFailureInAttemptRef.current = true;
    lastQualityFailureRef.current = issue;
    recordScanQualityFailure(issue);
    setQualityCoach(getScanQualityCoach(issue));
    setCaptureError(null);
  }, []);

  const beginScanRequest = useCallback(() => {
    cancelScanRef.current = false;
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

    setScanCardStatusMessage("Saving scan.");
    void syncLookupToCloud(lookup)
      .then((result) => {
        setScanCardStatusMessage(result.ok ? "Scan saved to cloud." : result.message);
      });
  }, []);

  const isScanRequestActive = useCallback((requestId: number) => (
    scanRequestIdRef.current === requestId && !cancelScanRef.current
  ), []);

  const persistAndShowReview = useCallback((
    scanState: ScanAnalysisState,
    options: {
      captureMode: ScanCaptureMode;
      focusTarget?: ScanReviewTarget | null;
      requestId: number;
      reviewTarget: ScanReviewTarget | null;
      isolatedFrame?: CapturedFrame;
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
      setScanReview({
        correction: options.correction ?? saved.value.correction,
        focusTarget: options.focusTarget ?? options.reviewTarget,
        isolatedFrame: options.isolatedFrame,
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
    setScanReview({
      correction: options.correction ?? null,
      focusTarget: options.focusTarget ?? options.reviewTarget,
      isolatedFrame: options.isolatedFrame,
      lookup: null,
      reviewTarget: options.reviewTarget,
      scanState: fallbackState,
      source,
      sourceUpdatedAt,
    });
  }, [activeShopJob, isScanRequestActive, syncSavedLookup]);

  const analyzeImageBase64 = useCallback(async (
    imageBase64: string,
    requestId: number,
    captureMode: ScanCaptureMode,
    secondFrameProvider?: () => Promise<string>,
    reviewTargetOverride?: CameraObjectTarget,
  ) => {
    const sourceUpdatedAt = new Date().toISOString();
    const detectedReviewTarget = !reviewTargetOverride && shouldDetectStillTarget(imageBase64, captureMode)
      ? await getReviewTargetFromCapturedImage(imageBase64)
      : null;
    if (!isScanRequestActive(requestId)) return;
    const reviewTarget = reviewTargetOverride
      ? getReviewTargetFromObject(reviewTargetOverride)
      : getUsableReviewTarget(detectedReviewTarget);

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
      target: reviewTarget ? getObjectTargetFromReviewTarget(reviewTarget) : null,
    });

    const frame: CapturedFrame = {
      imageBase64,
      capturedAt: new Date().toISOString(),
    };
    saveLatestScanState({ frame, scanQuality });

    let focusedFrame: CapturedFrame | undefined;
    let focusBox: VisualFocusBox | undefined = reviewTarget?.normalized ? objectTargetBoxToVisualFocusBox(reviewTarget.normalized) : undefined;
    let focusMode: VisualFocusMode = reviewTarget ? "crop" : "full_frame";
    let focusTarget: ScanReviewTarget | null = reviewTarget;
    let isolatedImageBase64: string | undefined;
    let isolatedFrame: CapturedFrame | undefined;
    let secondFrame: CapturedFrame | undefined;
    const focusedCropTarget = reviewTarget?.normalized ?? null;
    const focusedCrop = focusedCropTarget
      ? await createFocusedScanCrop(imageBase64, focusedCropTarget)
      : null;
    if (!isScanRequestActive(requestId)) return;
    if (focusedCrop) {
      const cropQuality = await assessImageQuality(focusedCrop);
      if (!isScanRequestActive(requestId)) return;
      if (cropQuality.ok) {
        focusedFrame = { imageBase64: focusedCrop, capturedAt: new Date().toISOString() };
        setAnalysisStep("Preparing scan view");
        const segmented = await createSegmentedProductIsolation(focusedFrame);
        isolatedFrame = segmented?.frame ?? focusedFrame;
        isolatedImageBase64 = segmented?.isolatedImageBase64;
        if (segmented && focusedCropTarget) {
          focusMode = "mask";
          focusBox = mapCropFocusBoxToScanBox(focusedCropTarget, segmented.focusBox);
          focusTarget = getReviewTargetFromNormalizedFocusBox(focusBox);
        } else {
          focusMode = "crop";
          focusBox = focusedCropTarget ? objectTargetBoxToVisualFocusBox(focusedCropTarget) : focusBox;
          focusTarget = reviewTarget;
        }
        if (!isScanRequestActive(requestId)) return;
      }
    }

    setAnalysisStep("Checking saved matches");
    const imageHash = await hashImageDataUrl(imageBase64);
    if (!isScanRequestActive(requestId)) return;
    if (imageHash && !activeShopJob) {
      const cached = getCachedScanResult(imageHash);
      if (cached) {
        const shopScanContext = buildShopScanContext(activeShopJob, activeShopVehicleContext);
        const contextualResult = applyShopFitmentContext(cached, activeShopVehicleContext);
        setAnalysisStep("Opening result");
        recordScanOutcome(contextualResult);
        await persistAndShowReview(
          {
            frame,
            result: contextualResult,
            analyzedAt: new Date().toISOString(),
            focusBox,
            focusMode,
            isolatedImageBase64,
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
            focusTarget,
            isolatedFrame,
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
      setAnalysisStep("Reading photo");
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
      setAnalysisStep("Saving");
      const shopScanContext = buildShopScanContext(activeShopJob, activeShopVehicleContext);
      await persistAndShowReview(
        {
          frame,
          result,
          analyzedAt: new Date().toISOString(),
          focusBox,
          focusMode,
          isolatedImageBase64,
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
          focusTarget,
          isolatedFrame,
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
          errorMessage: getSimpleScanErrorMessage(analysisError),
          errorCode: analysisError instanceof AIServiceError ? analysisError.code : "analysis_failed",
          analyzedAt: new Date().toISOString(),
          focusBox,
          focusMode,
          isolatedImageBase64,
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
          focusTarget,
          isolatedFrame,
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
    const reviewTarget = reviewTargetOverride;
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
  }, [analyzeImageBase64, beginScanRequest, captureFrame, isAnalyzing, isScanRequestActive, pauseAutoScan]);

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
    switchCamera();
  }, [switchCamera]);

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

  function cancelCurrentScan() {
    cancelScanRef.current = true;
    scanRequestIdRef.current += 1;
    setIsAnalyzing(false);
    setAnalysisStep(null);
    pauseAutoScan("Scan canceled. Ready when you are.");
  }

  function closeScanReview() {
    setScanReview(null);
    setCaptureError(null);
    setScanCardStatusMessage(null);
    pauseAutoScan();
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
        <div className="size-10" aria-hidden="true" />
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
          {qualityCoach ? (
            <ScanQualityCoachNotice
              coach={qualityCoach}
              onTryAgain={() => void handleIdentify()}
            />
          ) : null}
          {captureError ? <CaptureErrorNotice message={captureError} onTryAgain={() => setCaptureError(null)} /> : null}
        </>
      ) : null}

      {scanReview?.scanState.result ? (
        <FocusedPartOverlay
          label={getSimpleResultSummary(scanReview.scanState.result).title}
          mode={scanReview.scanState.focusMode ?? (scanReview.isolatedFrame ? "crop" : "full_frame")}
          target={focusedReviewTarget}
        />
      ) : null}
      {isAnalyzing ? <AnalyzingOverlay onCancel={cancelCurrentScan} step={analysisStep} /> : null}
      {scanReview ? (
        <ScanResultCard
          isExpanded={false}
          isMismatch={false}
          target={anchoredReviewTarget}
          onClose={closeScanReview}
          onRetryMismatch={retryReviewScan}
          onUndoCorrection={handleUndoCorrection}
          placement={reviewCardPlacement}
          prefs={scanCardPrefs}
          review={scanReview}
          scanCardStatusMessage={scanCardStatusMessage}
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
          isShutterDisabled={cameraState !== "ready" || isAnalyzing}
          onShutter={() => void handleIdentify()}
          onGallery={() => galleryInputRef.current?.click()}
          onFlip={handleFlipCamera}
        />
      ) : null}
    </main>
  );
}

function getVideoConstraints(deviceId: string, facingMode: "environment" | "user"): MediaTrackConstraints {
  if (!deviceId) {
    return {
      ...DEFAULT_VIDEO_CONSTRAINTS,
      facingMode: { ideal: facingMode },
    };
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
  message,
  onGallery,
  onRetry,
  onSelectCamera,
  selectedCameraId,
}: {
  devices: CameraDevice[];
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
      ? `Downloading offline model... ${downloadPercent}%`
      : stillWorking
        ? "Almost done."
        : step ?? "Reading photo";

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
        <p className="mt-5 text-lg font-extrabold tracking-tight text-white">Reading photo</p>
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

function ScanResultCard({
  isExpanded,
  isMismatch,
  onClose,
  onRetryMismatch,
  onUndoCorrection,
  target,
  placement,
  prefs,
  review,
  scanCardStatusMessage,
}: {
  isExpanded: boolean;
  isMismatch: boolean;
  onClose: () => void;
  onRetryMismatch: () => void;
  onUndoCorrection: () => void;
  target: ScanReviewTarget | null;
  placement: ReviewCardPlacement;
  prefs: ScanCardPreferences;
  review: ScanReviewState;
  scanCardStatusMessage: string | null;
}) {
  const result = review.scanState.result;
  const summary = result ? getSimpleResultSummary(result) : null;
  const isError = Boolean(review.scanState.errorMessage);
  const label = isError ? "Item captured" : summary?.title ?? getReviewDisplayLabel(review);
  const confidence = result?.confidence;
  const isCompact = prefs.compactCardsByDefault && !isExpanded;
  const statusStyle = getConfidenceStyle(confidence);
  const visibleFacts = getVisibleFacts(result, isCompact);
  const concernFacts = getConcernFacts(result, isCompact);
  const evidenceFacts = getEvidenceFacts(result, isCompact);
  const itemViewFrame = review.isolatedFrame ?? review.scanState.frame;
  const itemViewBadge = getItemViewBadge(review.scanState.focusMode ?? (review.isolatedFrame ? "crop" : "full_frame"), Boolean(review.scanState.isolatedImageBase64));
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
          {result && !isError ? (
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
                {summary?.eyebrow ?? "Detected"}
              </span>
            </div>
          ) : null}
          <h3 className="text-[18px] font-black leading-tight tracking-[-0.02em]">{label}</h3>
          {summary ? <p className="mt-1 text-sm font-semibold leading-5 text-white/76">{summary.body}</p> : null}
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

      {itemViewFrame.imageBase64 ? (
        <ItemViewPanel
          badge={itemViewBadge}
          imageBase64={itemViewFrame.imageBase64}
          label={label}
        />
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

        {isError ? (
          <div
            className="rounded-xl px-3 py-2.5"
            style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)" }}
          >
            <p className="mb-1 text-[10px] font-extrabold uppercase tracking-[0.14em] text-white/48">Saved photo</p>
            <p className="text-xs font-semibold leading-5 text-white/78">{review.scanState.errorMessage}</p>
          </div>
        ) : (
          <>
            {summary?.nextAction ? (
              <BubbleSection title="Next step">
                <p>{summary.nextAction}</p>
              </BubbleSection>
            ) : null}
            {isExpanded ? (
              <>
                <BubbleSection title="Evidence">
                  <FactList facts={visibleFacts} />
                </BubbleSection>
                <BubbleSection title="Match clues">
                  <FactList facts={evidenceFacts} />
                </BubbleSection>
                {concernFacts.length ? (
                  <BubbleSection title="Flags">
                    <FactList facts={concernFacts} />
                  </BubbleSection>
                ) : null}
              </>
            ) : null}
          </>
        )}
      </div>

      {/* Actions */}
      <div className="mt-3 space-y-2">
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

function ItemViewPanel({
  badge,
  imageBase64,
  label,
}: {
  badge: string;
  imageBase64: string;
  label: string;
}) {
  return (
    <div
      className="mt-3 overflow-hidden rounded-[12px] p-2"
      data-testid="scan-item-view"
      style={{
        background: "rgba(2,6,23,0.64)",
        border: "1px solid rgba(255,255,255,0.12)",
        boxShadow: "0 14px 34px rgba(0,0,0,0.28)",
      }}
    >
      <div className="flex items-center justify-between gap-3 px-1 pb-2">
        <SectionTitle>Item view</SectionTitle>
        <span
          className="shrink-0 rounded-full px-2 py-1 text-[9px] font-black uppercase tracking-[0.10em] text-white/72"
          style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.10)" }}
        >
          {badge}
        </span>
      </div>
      <div className="relative grid h-44 place-items-center overflow-hidden rounded-[10px] bg-black/76">
        <img
          alt={`Item view for ${label}`}
          className="max-h-full w-full object-contain"
          data-testid="scan-item-view-image"
          src={imageBase64}
        />
      </div>
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
        action: "Steady photo",
        issue,
        progress: "You're close",
        title: "Soft photo",
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

function getReviewTargetFromObject(target: CameraObjectTarget): ScanReviewTarget {
  return {
    confidence: target.confidence,
    height: target.height,
    id: target.id,
    normalized: target.normalized
      ? {
          ...target.normalized,
          confidence: target.confidence,
        }
      : undefined,
    width: target.width,
    x: target.left,
    y: target.top,
  };
}

function getUsableReviewTarget(target: ScanReviewTarget | null) {
  if (!target || isReviewTargetTooSmall(target)) {
    return null;
  }

  return target;
}

function shouldDetectStillTarget(imageBase64: string, captureMode: ScanCaptureMode) {
  if (captureMode === "upload") {
    return true;
  }

  return imageBase64.length > 200;
}

async function getReviewTargetFromCapturedImage(imageBase64: string): Promise<ScanReviewTarget | null> {
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
    const timeoutId = window.setTimeout(() => reject(new Error("Timed out decoding scan image.")), 900);
    image.onload = () => {
      window.clearTimeout(timeoutId);
      resolve(image);
    };
    image.onerror = () => {
      window.clearTimeout(timeoutId);
      reject(new Error("Could not decode scan image."));
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

function objectTargetBoxToVisualFocusBox(target: ObjectTargetBox): VisualFocusBox {
  return clampVisualFocusBox({
    confidence: target.confidence,
    height: target.height,
    width: target.width,
    x: target.x,
    y: target.y,
  });
}

function mapCropFocusBoxToScanBox(cropTarget: ObjectTargetBox, focusBox: VisualFocusBox): VisualFocusBox {
  const crop = getPaddedNormalizedCrop(cropTarget);
  return clampVisualFocusBox({
    confidence: focusBox.confidence,
    height: focusBox.height * crop.height,
    width: focusBox.width * crop.width,
    x: crop.x + focusBox.x * crop.width,
    y: crop.y + focusBox.y * crop.height,
  });
}

function getPaddedNormalizedCrop(target: ObjectTargetBox): VisualFocusBox {
  const paddedWidth = target.width * (1 + FOCUS_CROP_PADDING * 2);
  const paddedHeight = target.height * (1 + FOCUS_CROP_PADDING * 2);
  const x = clampNumber(target.x - target.width * FOCUS_CROP_PADDING, 0, 1);
  const y = clampNumber(target.y - target.height * FOCUS_CROP_PADDING, 0, 1);
  const right = clampNumber(x + paddedWidth, 0, 1);
  const bottom = clampNumber(y + paddedHeight, 0, 1);

  return clampVisualFocusBox({
    confidence: target.confidence,
    height: bottom - y,
    width: right - x,
    x,
    y,
  });
}

function getReviewTargetFromNormalizedFocusBox(focusBox: VisualFocusBox): ScanReviewTarget {
  const viewportWidth = Math.max(1, window.innerWidth);
  const viewportHeight = Math.max(1, window.innerHeight);
  const normalized = clampVisualFocusBox(focusBox);

  return clampReviewTarget({
    confidence: normalized.confidence,
    height: normalized.height * viewportHeight,
    id: "focused-item",
    normalized,
    width: normalized.width * viewportWidth,
    x: normalized.x * viewportWidth,
    y: normalized.y * viewportHeight,
  });
}

function clampVisualFocusBox(box: VisualFocusBox): VisualFocusBox {
  const x = clampNumber(box.x, 0, 1);
  const y = clampNumber(box.y, 0, 1);
  const width = clampNumber(box.width, 0.01, 1 - x);
  const height = clampNumber(box.height, 0.01, 1 - y);
  return {
    confidence: clampNumber(box.confidence, 0, 1),
    height,
    width,
    x,
    y,
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

function getSimpleScanErrorMessage(error: unknown) {
  if (error instanceof AIServiceError) {
    switch (error.code) {
      case "rate_limited":
        return "The photo is saved. Try again in a few minutes.";
      case "network":
      case "provider_error":
        return "The photo is saved. Try again.";
      case "not_configured":
        return "The photo is saved. AI setup needs attention.";
      case "image_too_large":
      case "invalid_input":
        return error.message || "Use a smaller photo and try again.";
      default:
        return "The photo is saved. Try again.";
    }
  }

  return "The photo is saved. Try again.";
}

function getItemViewBadge(source: VisualFocusMode, hasIsolatedOutput: boolean) {
  if (source === "mask" && hasIsolatedOutput) {
    return "Isolated";
  }

  if (source === "crop") {
    return "Focused";
  }

  return "Full scan";
}

function getVisibleFacts(result: IdentificationResult | undefined, compact: boolean) {
  if (!result) {
    return ["No AI result yet. Open the scan details to retry."];
  }
  const facts = result.visibleObservations
    .map((item) => summarize(item, compact ? 85 : 130))
    .filter(Boolean);

  return facts.length ? facts.slice(0, compact ? 3 : 5) : ["No visual observations were returned."];
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
        DEEPSPEC LIVE
      </div>
      <div className="scanner-hud" style={{ top: "max(52px, calc(env(safe-area-inset-top) + 52px))", right: 16, textAlign: "right" }}>
        f/1.8 AUTO ISO
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
