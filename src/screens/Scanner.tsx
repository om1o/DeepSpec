import { BrandLockup } from "../components/BrandLockup";
import { createAnalysisAttemptId } from "../lib/analysisAttempt";
import { applyShopFitmentContext } from "../lib/shopFitmentContext";
import { getAccountScope, isAccountScopeCurrent, isCurrentAccountRouteState, withAccountRouteState } from "../lib/accountScope";
import { normalizeComponentCaptureTarget } from "../lib/componentMap";
import type { ComponentCaptureTarget } from "../types/componentMap";
import type { ComparisonCaptureTarget } from "../types/inspectionComparison";
import { normalizeComparisonCaptureTarget } from "../lib/inspectionComparison";
import { completeComparisonCapture, verifyComparisonCaptureReference } from "../services/comparisonCapture";
import { assertRequestedEvidenceCaptureCurrent, verifyRequestedEvidenceCaptureReference } from "../services/requestedEvidenceCapture";
import { resolveComparisonSide } from "../services/comparisonEvidence";
import { readComponentMap } from "../services/componentMapStore";
import { assertComponentCaptureCurrent, completeComponentCapture } from "../services/componentCaptureCompletion";
import { readComponentMapLookup } from "../services/componentMapCloud";
import { readCaptureSource, verifyCaptureJobContext } from "../services/captureJobContext";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import Webcam from "react-webcam";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { IsolatedPartView } from "../components/result/IsolatedPartView";
import { PhotoEvidenceStrip } from "../components/result/PhotoEvidenceStrip";
import { PhotoReviewPanel } from "../components/result/PhotoReviewPanel";
import { photoRelationshipOrUnknown } from "../lib/photoRelationship";
import { correctScanSelection } from "../lib/visualSelection";
import { orderSceneObjects } from "../components/result/isolatedPartViewGeometry";
import { ScanDebugOverlay } from "../components/result/ScanDebugOverlay";
import { ScanSources } from "../components/result/ScanSources";
import { CropBox } from "../components/scanner/CropBox";
import { PhotoGroupReview, RequestedEvidenceCaptureGuide } from "../components/scanner/PhotoGroupReview";
import { VehicleContextEditor } from "../components/vehicle/VehicleContextEditor";
import { normalizeVehicleContext, vehicleContextsMatch } from "../lib/vehicleContext";
import { readVehicleProfile, saveVehicleProfile } from "../services/vehicleProfile";
import { photoGroupsMatch, photoDraftsMatch, componentCaptureTargetsMatch, comparisonCaptureTargetsMatch, hasPhotoDraftContext, hasPhotoDraftComparison, upgradePhotoDraft, readPhotoDraftEnvelope, replacePhotoDraftEnvelopeIfMatches, type PhotoDraftEnvelope, type PhotoDraftKind } from "../services/photoDraft";
import { isCropBoxEnabled } from "../components/scanner/cropBoxGeometry";
import { IssueLine, ResultDetailSections, SceneCategoryList } from "../components/result/PositiveAnswerCard";
import Button from "../components/ui/Button";
import { useCamera, type CameraDevice } from "../hooks/useCamera";
import type { CameraObjectTarget } from "../hooks/useObjectTarget";
import { assessImageQuality, type ImageQualityIssue, type ImageQualityResult } from "../lib/imageQuality";
import { createFocusedScanCrop } from "../lib/focusCrop";
import { createSegmentedProductIsolation, warmProductSegmentation } from "../lib/productSegmentation";
import { createPromptedProductIsolation, createSceneCropFallbacks, isolateSceneObjects, isPromptableSegmentationEnabled, warmPromptableSegmentation, type SceneObjectInput } from "../lib/promptableSegmentation";
import { supportsWebGpu } from "../lib/webgpu";
import { getScanDebug, isScanDebugEnabled, recordScanDebug, resetScanDebug } from "../lib/scanDebug";
import { getSimpleResultSummary } from "../lib/simpleResultSummary";
import { getIntakeReview } from "../lib/intakeReview";
import { deriveIssue, getAnswerBody, getSceneChips } from "../lib/resultFacts";
import { getCachedScanResult, hashImageDataUrl, setCachedScanResult } from "../lib/scanCache";
import { getScanCardPreferences, type ScanCardPreferences } from "../lib/scanResultCardSettings";
import { detectObjectTargetFromImageData, type ObjectTargetBox } from "../lib/objectTargeting";
import { CAPTURE_MAX_EDGE, compressImageDataUrl, saveLatestScanState } from "../lib/utils";
import { AIServiceError, identifyCapturedFrame, isAIRequestCanceled } from "../services/aiService";
import { onOnDeviceModelProgress } from "../services/onDeviceIdentify";
import { getCloudSyncStatus, syncLookupToCloud } from "../services/cloudSync";
import { isCloudSyncEnabled } from "../services/cloudSyncPolicy";
import { attachScanToJob, buildCustomerVisibleReport, getShopJob, getVehicleContextForJob } from "../services/shop";
import {
  recordAcceptableScan,
  recordIdentifyLatency,
  recordNeedsBetterPhoto,
  recordScanAttempt,
  recordScanQualityFailure,
  recordScanQualityRetake,
} from "../services/scanQualityMetrics";
import { createLookup, DEVICE_SCAN_LIMIT_MESSAGE, getLookup, readLookups, scanStateFromLookup, MAX_SAVED_LOOKUPS, updateLookup, updateLookupVisualSelection } from "../services/storage";
import type { IdentificationResult, CapturedFrame, IsolatedObject, Lookup, PhotoRelationship, ScanAnalysisSource, ScanAnalysisState, ScanCaptureMode, ScanDebugInfo, ScanPhoto, ScanQualitySnapshot, ShopJob, ShopVehicleContext, VisualFocusBox, VisualFocusMode } from "../types";

// Build-freshness stamp for the Scanner UI chunk. ScanResultCard, the collapse toggle, and the
// Item view panel all live in THIS module. If after a reload you see the SAM chunk's "v5" log but
// NOT this line, the render bundle is stale (service-worker precache) even though the SAM chunk
// updated — which means UI fixes never actually reached the screen. Bump the tag on each UI change.
const SCANNER_UI_TRACE = "ui-trace-v3 (abortable scan recovery)";
console.info(`[DeepSpec UI] Scanner chunk ${SCANNER_UI_TRACE} loaded`);

const SECOND_FRAME_DELAY_MS = 120;

function sceneSelectionInputs(result: IdentificationResult, focusBox: VisualFocusBox | undefined): SceneObjectInput[] {
  const chips = getSceneChips(result);
  // A missing main-part outline must not discard independently located components.
  // Only include the main identity when its own geometry is available.
  return chips.length ? [
    ...(focusBox ? [{ name: getSimpleResultSummary(result).title, category: String(result.scanCategory), box: focusBox, primary: true }] : []),
    ...chips.map((chip) => ({ name: chip.object.name, category: String(chip.object.category), box: chip.box, primary: false })),
  ] : [];
}

function keepPrimaryCutout(objects: IsolatedObject[], focusBox: VisualFocusBox | undefined, focusMode: VisualFocusMode, image: string | undefined): IsolatedObject[] {
  return objects.map((object) => object.primary && object.focusMode === "crop" && focusBox && focusMode === "mask" && image
    ? { ...object, focusBox, focusMode: "mask" as const, isolatedImageBase64: image } : object);
}

const IDENTIFY_BUDGET_WARN_MS = 15000;
const VISUAL_PREPARATION_BUDGET_MS = 3000;
const SCENE_VISUAL_BUDGET_MS = 1000;
// Last-resort safety: if a scan ever stalls (a hung image decode, a wedged network),
// force the loading overlay to clear and let the user try again. Generous so it never
// trips a normal scan (hosted identify is capped at 80s; optional visual work has short budgets).
const SCAN_WATCHDOG_TIMEOUT_MS = 90000;
const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;
const UPLOAD_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const COMPRESS_UPLOAD_OVER_BYTES = 1024 * 1024;
const MIN_TARGET_WIDTH_PX = 96;
const MIN_TARGET_HEIGHT_PX = 72;
const MIN_TARGET_AREA_RATIO = 0.018;
const FOCUS_CROP_PADDING = 0.03;
const ACCOUNT_SCOPE_CHECK_MS = 50;

const DEFAULT_VIDEO_CONSTRAINTS: MediaTrackConstraints = {
  facingMode: { ideal: "environment" },
  width: { ideal: 2560 },
  height: { ideal: 1440 },
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
  guidedRetakeUsed: boolean;
  focusTarget: ScanReviewTarget | null;
  isolatedFrame?: CapturedFrame;
  lookup: Lookup | null;
  scanState: ScanAnalysisState;
  correction: string | null;
  source: ScanReviewResultSource;
  sourceUpdatedAt: string;
  reviewTarget: ScanReviewTarget | null;
};

type ActiveScanRequest = {
  accountCheckId: number | null;
  controller: AbortController;
  requestId: number;
};

type CaptureVehicleSnapshot = { vehicleContext: ShopVehicleContext | null; jobId?: string };

function newCaptureDraft(photos: ScanPhoto[], snapshot: CaptureVehicleSnapshot, target?: ComponentCaptureTarget, comparisonTarget?: ComparisonCaptureTarget): PhotoDraftEnvelope {
  const common = { photos, photoRelationship: "unknown" as const, ...snapshot, ...(target ? { target } : {}) };
  return comparisonTarget?.version === 2 ? { version: 8, ...common, comparisonTarget }
    : comparisonTarget ? { version: 7, ...common, comparisonTarget } : { version: 6, ...common };
}

async function verifyDraftCaptureJobs(draft: PhotoDraftEnvelope, scope: ReturnType<typeof getAccountScope>, signal?: AbortSignal): Promise<() => void> {
  const sourceIds = [...new Set([draft.target?.mapId, hasPhotoDraftComparison(draft) ? draft.comparisonTarget.earlier.lookupId : undefined].filter((id): id is string => Boolean(id)))];
  const checks = await Promise.all(sourceIds.map((id) => verifyCaptureJobContext(id, hasPhotoDraftContext(draft) ? draft.jobId : undefined, scope, signal)));
  return () => checks.forEach((check) => check());
}

type ScanQualityCoachIssue = ImageQualityIssue | "object_too_small" | "needs_better_photo";

type ScanQualityCoachState = {
  action: string;
  issue: ScanQualityCoachIssue;
  progress: string;
  title: string;
};

function buildShopScanContext(
  job: ShopJob | null,
  vehicleContext: ShopVehicleContext | undefined,
  result: IdentificationResult | undefined,
): Partial<ScanAnalysisState> {
  if (!job) {
    return vehicleContext ? { vehicleContext } : {};
  }

  return {
    // Describe the scan being saved, not the job's previous one (this runs before it's stored).
    customerVisibleReport: buildCustomerVisibleReport({ ...job,
      year: vehicleContext?.year ?? "", make: vehicleContext?.make ?? "", model: vehicleContext?.model ?? "",
      symptom: vehicleContext?.symptom ?? "Complaint not supplied", title: vehicleContext?.jobTitle ?? "Saved inspection",
    }, undefined, { result, correction: null }),
    jobId: job.id,
    orgId: job.orgId,
    reviewStatus: "needs_review",
    vehicleContext,
  };
}

async function optionalVisual<T>(work: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([work, new Promise<T>((resolve) => { timer = setTimeout(() => resolve(fallback), timeoutMs); })]);
  } catch {
    return fallback;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export default function Scanner() {
  const accountScopeRef = useRef(getAccountScope());
  const location = useLocation();
  const navigate = useNavigate();
  const routeCaptureTarget = useMemo(() => isCurrentAccountRouteState(location.state)
    ? normalizeComponentCaptureTarget(location.state.componentCaptureTarget) : null, [location.state]);
  const routeComparisonTarget = useMemo(() => isCurrentAccountRouteState(location.state)
    ? normalizeComparisonCaptureTarget(location.state.comparisonCaptureTarget) : undefined, [location.state]);
  const routeCaptureError = location.state?.comparisonCaptureTarget !== undefined && !routeComparisonTarget
    ? "This repeat-capture reference is invalid or belongs to another account. Reopen the earlier scan to start again."
    : routeComparisonTarget && ((routeCaptureTarget && routeCaptureTarget.lookupId !== routeComparisonTarget.lookupId)
      || (location.state?.componentCaptureTarget !== undefined && !routeCaptureTarget))
      ? "These capture links reserve different scans or are invalid. Reopen the earlier scan to start again." : null;
  const routeReservedLookupId = routeComparisonTarget?.lookupId ?? routeCaptureTarget?.lookupId;
  const activeCaptureLookupRef = useRef<{ requestId: number; lookupId: string } | null>(null);
  const activeShopJob = useMemo(() => {
    const jobId = new URLSearchParams(location.search).get("jobId");
    return jobId ? getShopJob(jobId) : null;
  }, [location.search]);
  const activeShopVehicleContext = useMemo(
    () => (activeShopJob ? getVehicleContextForJob(activeShopJob) : undefined),
    [activeShopJob],
  );
  const [initialVehicleProfile] = useState(() => readVehicleProfile());
  const [vehicleProfile, setVehicleProfile] = useState<ShopVehicleContext | undefined>(() => initialVehicleProfile.ok ? initialVehicleProfile.value : undefined);
  const [vehicleEdit, setVehicleEdit] = useState<ShopVehicleContext | undefined>(vehicleProfile);
  const [showVehicleEditor, setShowVehicleEditor] = useState(false);
  const [vehicleMessage, setVehicleMessage] = useState<string | null>(() => initialVehicleProfile.ok ? null : initialVehicleProfile.message);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [uploadEnvelope, setPhotoDraft] = useState<PhotoDraftEnvelope | null>(null);
  const [captureEnvelope, setCaptureDraft] = useState<PhotoDraftEnvelope | null>(null);
  const photoDraft = uploadEnvelope?.photos ?? null;
  const captureDraft = captureEnvelope?.photos ?? null;
  const [photoDraftKind, setPhotoDraftKind] = useState<PhotoDraftKind>("upload");
  const activePhotoDraft = photoDraftKind === "capture" ? captureDraft : photoDraft;
  const activeDraftEnvelope = photoDraftKind === "capture" ? captureEnvelope : uploadEnvelope;
  const [showPhotoDraft, setShowPhotoDraft] = useState(false);
  const isPhotoDraftReviewOpen = Boolean(activePhotoDraft && showPhotoDraft);
  const activeComparisonTarget = showPhotoDraft ? (hasPhotoDraftComparison(activeDraftEnvelope) ? activeDraftEnvelope.comparisonTarget : undefined) : routeComparisonTarget;
  const [photoDraftBusy, setPhotoDraftBusy] = useState(false);
  const [photoDraftMessage, setPhotoDraftMessage] = useState<string | null>(null);
  const photoDraftBusyRef = useRef(false);
  const photoDraftRevisionRef = useRef(0);
  useEffect(() => {
    let canceled = false;
    const scope = accountScopeRef.current;
    void readPhotoDraftEnvelope(scope).then((draft) => {
      if (!canceled && photoDraftRevisionRef.current === 0 && isAccountScopeCurrent(scope)) setPhotoDraft(draft);
    }).catch(() => { /* Saving before analysis provides an actionable storage error. */ });
    void readPhotoDraftEnvelope(scope, "capture").then((draft) => {
      if (!canceled && photoDraftRevisionRef.current === 0 && isAccountScopeCurrent(scope)) setCaptureDraft(draft);
    }).catch(() => { /* Saving before analysis provides an actionable storage error. */ });
    return () => { canceled = true; };
  }, []);
  const [analysisStep, setAnalysisStep] = useState<string | null>(null);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [scanReview, setScanReview] = useState<ScanReviewState | null>(null);
  const [selectedPhotoId, setSelectedPhotoId] = useState<string>();
  const [photoReviewViewRequest, setPhotoReviewViewRequest] = useState(0);
  const selectedPhoto = scanReview?.scanState.photos?.find((photo) => photo.id === selectedPhotoId);
  const isOverviewPhoto = !selectedPhoto || selectedPhoto.id === scanReview?.scanState.photos?.[0]?.id;
  const [scanSave, setScanSave] = useState<{ lookupId: string; status: "pending" | "saved" | "local" | "failed" } | null>(null);
  const scanSaveGenerationRef = useRef(0);
  const [focusedObjectIndex, setFocusedObjectIndex] = useState<number | null>(null);
  const [objectAnalyses, setObjectAnalyses] = useState<Record<number, ObjectAnalysis>>({});
  const startedObjectAnalysisRef = useRef<Set<number>>(new Set());
  const [scanCardPrefs] = useState<ScanCardPreferences>(() => getScanCardPreferences(location.pathname));
  const [scanCardStatusMessage, setScanCardStatusMessage] = useState<string | null>(null);
  const [qualityCoach, setQualityCoach] = useState<ScanQualityCoachState | null>(null);
  const guidedRetakeUsedRef = useRef(false);
  const pendingGuidedRetakeRef = useRef(false);
  const retakeVehicleSnapshotRef = useRef<CaptureVehicleSnapshot | null>(null);
  const cancelScanRef = useRef(false);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const activeIdentifyRef = useRef<ActiveScanRequest | null>(null);
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

  // Warm the isolation model on mount so the first scan doesn't eat the model-load time.
  // Warm whichever runs first: the promptable segmenter when enabled, else MVANet.
  useEffect(() => {
    if (isPromptableSegmentationEnabled()) {
      warmPromptableSegmentation();
    } else {
      warmProductSegmentation();
    }
  }, []);

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
    if (pendingGuidedRetakeRef.current) {
      guidedRetakeUsedRef.current = true;
      pendingGuidedRetakeRef.current = false;
    }
    setScanSave(null);
    cancelScanRef.current = false;
    setCaptureError(null);
    const previousQualityIssue = qualityCoach?.issue ?? null;
    if (qualityCoach) {
      recordScanQualityRetake(qualityCoach.issue);
    } else {
      lastQualityFailureRef.current = null;
    }
    setQualityCoach(null);
    // Clear any multi-object focus + cached per-object analyses from the previous scan so a stale
    // index/cache can never leak onto the new scan's objects.
    setSelectedPhotoId(undefined);
    setPhotoReviewViewRequest(0);
    setFocusedObjectIndex(null);
    setObjectAnalyses({});
    startedObjectAnalysisRef.current = new Set();
    recordScanAttempt();
    qualityFailureInAttemptRef.current = Boolean(previousQualityIssue);
    activeScanStartedAtRef.current = Date.now();
    scanRequestIdRef.current += 1;
    const controller = new AbortController();
    const activeRequest: ActiveScanRequest = {
      accountCheckId: null,
      controller,
      requestId: scanRequestIdRef.current,
    };
    activeRequest.accountCheckId = window.setInterval(() => {
      if (activeIdentifyRef.current !== activeRequest || isAccountScopeCurrent(accountScopeRef.current)) {
        return;
      }
      cancelScanRef.current = true;
      scanRequestIdRef.current += 1;
      if (activeRequest.accountCheckId !== null) {
        window.clearInterval(activeRequest.accountCheckId);
        activeRequest.accountCheckId = null;
      }
      controller.abort();
    }, ACCOUNT_SCOPE_CHECK_MS);
    activeIdentifyRef.current = activeRequest;
    return activeRequest;
  }, [qualityCoach]);

  const abortActiveIdentify = useCallback(() => {
    const activeRequest = activeIdentifyRef.current;
    if (!activeRequest) return;
    if (activeRequest.accountCheckId !== null) {
      window.clearInterval(activeRequest.accountCheckId);
      activeRequest.accountCheckId = null;
    }
    activeRequest.controller.abort();
  }, []);

  const finishScanRequest = useCallback((activeRequest: ActiveScanRequest) => {
    if (activeIdentifyRef.current !== activeRequest) return;
    if (activeRequest.accountCheckId !== null) {
      window.clearInterval(activeRequest.accountCheckId);
      activeRequest.accountCheckId = null;
    }
    activeIdentifyRef.current = null;
  }, []);

  useEffect(() => () => {
    cancelScanRef.current = true;
    scanRequestIdRef.current += 1;
    abortActiveIdentify();
  }, [abortActiveIdentify]);

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
    const scope = accountScopeRef.current;
    if (!isAccountScopeCurrent(scope)) return;
    const generation = ++scanSaveGenerationRef.current;
    if (!getCloudSyncStatus().configured) {
      setScanSave({ lookupId: lookup.id, status: "local" });
      return;
    }

    setScanSave({ lookupId: lookup.id, status: "pending" });
    const finish = (status: "saved" | "failed") => setScanSave((current) => (
      isAccountScopeCurrent(scope) && generation === scanSaveGenerationRef.current && current?.lookupId === lookup.id ? { lookupId: lookup.id, status } : current
    ));
    void syncLookupToCloud(lookup).then((result) => finish(result.ok ? "saved" : "failed"), () => finish("failed"));
  }, []);

  const isScanRequestActive = useCallback((requestId: number) => (
    isAccountScopeCurrent(accountScopeRef.current) && scanRequestIdRef.current === requestId && !cancelScanRef.current
  ), []);

  // Safety net: guarantees the loading overlay clears even if a step hangs forever.
  const startScanWatchdog = useCallback((requestId: number) => window.setTimeout(() => {
    if (!isAccountScopeCurrent(accountScopeRef.current) || scanRequestIdRef.current !== requestId || cancelScanRef.current) {
      return;
    }
    cancelScanRef.current = true;
    scanRequestIdRef.current += 1;
    setIsAnalyzing(false);
    setAnalysisStep(null);
    abortActiveIdentify();
    pauseAutoScan("That scan stalled. Tap Scan to try again.");
  }, SCAN_WATCHDOG_TIMEOUT_MS), [abortActiveIdentify, pauseAutoScan]);

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

    // Permanent trace: exactly what the render will receive for this scan. Every path
    // (SAM, MVANet, crop, cached, error) funnels through here, so this is the ground truth
    // for "did the mask output make it into state" — independent of the diagnostic panel.
    const tracedIsolated = scanState.isolatedImageBase64;
    console.info("[DeepSpec TRACE] scan→state", {
      isolatedImageBase64: tracedIsolated ? `yes (~${Math.round((tracedIsolated.length * 0.75) / 1024)}KB)` : "no",
      focusModeInState: scanState.focusMode ?? "(unset)",
      segmenter: getScanDebug().segmenter ?? "(none)",
      isolatedObjects: scanState.isolatedObjects?.length ?? 0,
      hasFocusBox: Boolean(scanState.focusBox),
    });

    const reservedId = activeCaptureLookupRef.current?.requestId === options.requestId ? activeCaptureLookupRef.current.lookupId : undefined;
    const saved = createLookup(scanState, reservedId);
    if (saved.ok) {
      const savedState = reservedId ? scanStateFromLookup(saved.value) : scanState;
      if (saved.value.jobId) {
        attachScanToJob(saved.value.jobId, saved.value.id);
      }
      saveLatestScanState(savedState);
      setScanReview({
        guidedRetakeUsed: guidedRetakeUsedRef.current,
        correction: options.correction ?? saved.value.correction,
        focusTarget: options.focusTarget ?? options.reviewTarget,
        isolatedFrame: options.isolatedFrame,
        lookup: saved.value,
        reviewTarget: options.reviewTarget,
        scanState: savedState,
        source,
        sourceUpdatedAt,
      });
      syncSavedLookup(saved.value);
      return saved.value;
    }

    const fallbackState = {
      ...scanState,
      storageWarning: saved.message,
    };
    saveLatestScanState(fallbackState);
    setScanReview({
      guidedRetakeUsed: guidedRetakeUsedRef.current,
      correction: options.correction ?? null,
      focusTarget: options.focusTarget ?? options.reviewTarget,
      isolatedFrame: options.isolatedFrame,
      lookup: null,
      reviewTarget: options.reviewTarget,
      scanState: fallbackState,
      source,
      sourceUpdatedAt,
    });
    return null;
  }, [isScanRequestActive, syncSavedLookup]);

  const captureVehicleSnapshot = useCallback(async (): Promise<CaptureVehicleSnapshot> => {
    if (routeCaptureError) throw new Error(routeCaptureError);
    if (routeComparisonTarget) {
      const source = await readCaptureSource(routeComparisonTarget.earlier.lookupId, accountScopeRef.current);
      return { vehicleContext: structuredClone(routeComparisonTarget.earlier.vehicleContext), ...(source.jobId ? { jobId: source.jobId } : {}) };
    }
    if (retakeVehicleSnapshotRef.current) return retakeVehicleSnapshotRef.current;
    if (routeCaptureTarget) {
      const overview = await readCaptureSource(routeCaptureTarget.mapId, accountScopeRef.current);
      return { vehicleContext: normalizeVehicleContext(overview.vehicleContext) ?? null, ...(overview.jobId ? { jobId: overview.jobId } : {}) };
    }
    return { vehicleContext: normalizeVehicleContext(activeShopVehicleContext ?? vehicleProfile) ?? null, ...(activeShopJob ? { jobId: activeShopJob.id } : {}) };
  }, [routeCaptureError, routeComparisonTarget, routeCaptureTarget, activeShopVehicleContext, vehicleProfile, activeShopJob]);

  const analyzeImageBase64 = useCallback(async (
    imageBase64: string,
    requestId: number,
    captureMode: ScanCaptureMode,
    signal: AbortSignal,
    secondFrameProvider?: () => Promise<string>,
    reviewTargetOverride?: CameraObjectTarget,
    photos?: ScanPhoto[],
    captureEvidence?: { original: ScanPhoto; persist: (accepted: ScanPhoto[]) => Promise<boolean> },
    componentTarget?: ComponentCaptureTarget,
    vehicleContextSnapshot?: ShopVehicleContext | null,
    jobIdSnapshot?: string | null,
    comparisonTarget?: ComparisonCaptureTarget,
    photoRelationship?: PhotoRelationship,
    assertCaptureCurrent?: () => void,
  ) => {
    const persistAnalyzedReview = (...args: Parameters<typeof persistAndShowReview>) => {
      assertCaptureCurrent?.();
      return persistAndShowReview(...args);
    };
    const scanPhotoRelationship = photoRelationshipOrUnknown(photoRelationship);
    if (componentTarget && comparisonTarget && componentTarget.lookupId !== comparisonTarget.lookupId) throw new Error("These capture links refer to different saved scans. Your draft was kept.");
    const reservedId = comparisonTarget?.lookupId ?? componentTarget?.lookupId;
    activeCaptureLookupRef.current = reservedId ? { requestId, lookupId: reservedId } : null;
    const scanShopJob = jobIdSnapshot === undefined ? activeShopJob : jobIdSnapshot ? getShopJob(jobIdSnapshot) : null;
    if (jobIdSnapshot && !scanShopJob) throw new Error("The job for these photos is unavailable. Your draft is kept; reopen its original job before analysis.");
    let scanVehicleContext = normalizeVehicleContext(vehicleContextSnapshot === undefined ? activeShopVehicleContext ?? vehicleProfile : vehicleContextSnapshot);
    if (componentTarget && vehicleContextSnapshot === undefined) {
      const overview = await readComponentMapLookup(componentTarget.mapId, accountScopeRef.current);
      if (!isScanRequestActive(requestId)) return;
      if (!overview.ok || !overview.value) throw new Error(overview.ok ? "Reopen the component overview before analyzing these photos." : overview.message);
      scanVehicleContext = normalizeVehicleContext(overview.value.vehicleContext);
    }
    const sourceUpdatedAt = new Date().toISOString();
    const deviceRead = readLookups();
    if (!deviceRead.ok) throw new Error(deviceRead.message);
    if (deviceRead.value.length >= MAX_SAVED_LOOKUPS) throw new Error(DEVICE_SCAN_LIMIT_MESSAGE);
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
    assertCaptureCurrent?.();
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
      capturedAt: photos?.[0]?.capturedAt ?? captureEvidence?.original.capturedAt ?? new Date().toISOString(),
    };
    let evidencePhotos: ScanPhoto[] = photos ?? [captureEvidence?.original ?? { id: "photo-1", label: "overview", ...frame }];
    if (!quality.ok) {
      stopForQualityCoach(quality.issue);
      const coach = getScanQualityCoach(quality.issue);
      return persistAnalyzedReview({
        frame, photos: evidencePhotos, photoRelationship: scanPhotoRelationship, scanQuality, errorCode: "quality_rejected",
        errorMessage: `Photo quality check: ${coach.title}. ${coach.action}${guidedRetakeUsedRef.current ? " Guided retake used; identity remains unresolved. Review the saved evidence before deciding what to do next." : " Identification was not run."}`,
        analyzedAt: sourceUpdatedAt,
        provenance: { captureMode, analysisSource: "ai_detection", savedAt: sourceUpdatedAt },
        ...buildShopScanContext(scanShopJob, scanVehicleContext, undefined),
      }, { captureMode, requestId, reviewTarget, source: "AI detection", analysisSource: "ai_detection", sourceUpdatedAt });
    }
    saveLatestScanState({ frame, photos: evidencePhotos, photoRelationship: scanPhotoRelationship, scanQuality, ...buildShopScanContext(scanShopJob, scanVehicleContext, undefined) });
    resetScanDebug();

    let focusedFrame: CapturedFrame | undefined;
    let focusBox: VisualFocusBox | undefined = reviewTarget?.normalized ? objectTargetBoxToVisualFocusBox(reviewTarget.normalized) : undefined;
    let focusMode: VisualFocusMode = reviewTarget ? "crop" : "full_frame";
    let isolationSource: ScanDebugInfo["segmenter"] = reviewTarget ? "crop" : "full frame";
    let focusTarget: ScanReviewTarget | null = reviewTarget;
    let isolatedImageBase64: string | undefined;
    let isolatedFrame: CapturedFrame | undefined;
    let secondFrame: CapturedFrame | undefined;
    const focusedCropTarget = reviewTarget?.normalized ?? null;
    const focusedCrop = focusedCropTarget
      ? await optionalVisual(createFocusedScanCrop(imageBase64, focusedCropTarget), 1000, null)
      : null;
    if (!isScanRequestActive(requestId)) return;
    if (focusedCrop) {
      const cropQuality = await optionalVisual(assessImageQuality(focusedCrop), 1000, null);
      if (!isScanRequestActive(requestId)) return;
      if (cropQuality?.ok) {
        focusedFrame = { imageBase64: focusedCrop, capturedAt: new Date().toISOString() };
        setAnalysisStep("Preparing scan view");
        // Step 5: a promptable segmenter (SlimSAM) isolates just the boxed object — it can
        // separate a held object from the hand, which MVANet can't. SAM works on the full
        // frame and returns a full-frame focus box; MVANet works on the crop. Fall back
        // SAM -> MVANet -> crop.
        const promptTargetBox = focusedCropTarget ? objectTargetBoxToVisualFocusBox(focusedCropTarget) : focusBox;
        const visualDeadline = performance.now() + VISUAL_PREPARATION_BUDGET_MS;
        const prompted = promptTargetBox
          ? await optionalVisual(createPromptedProductIsolation(frame, promptTargetBox), VISUAL_PREPARATION_BUDGET_MS, null)
          : null;
        if (!isScanRequestActive(requestId)) return;

        if (prompted) {
          isolatedFrame = prompted.frame;
          isolatedImageBase64 = prompted.isolatedImageBase64;
          focusMode = "mask";
          isolationSource = "SAM";
          focusBox = prompted.focusBox;
          focusTarget = getReviewTargetFromNormalizedFocusBox(focusBox);
        } else {
          const remainingMs = visualDeadline - performance.now();
          const segmented = remainingMs > 0
            ? await optionalVisual(createSegmentedProductIsolation(focusedFrame), remainingMs, null)
            : null;
          isolatedFrame = segmented?.frame ?? focusedFrame;
          isolatedImageBase64 = segmented?.isolatedImageBase64;
          if (segmented && focusedCropTarget) {
            focusMode = "mask";
            isolationSource = "MVANet";
            focusBox = mapCropFocusBoxToScanBox(focusedCropTarget, segmented.focusBox);
            focusTarget = getReviewTargetFromNormalizedFocusBox(focusBox);
          } else {
            focusMode = "crop";
            isolationSource = "crop";
            focusBox = focusedCropTarget ? objectTargetBoxToVisualFocusBox(focusedCropTarget) : focusBox;
            focusTarget = reviewTarget;
          }
        }
        if (!isScanRequestActive(requestId)) return;
      }
    }

    if (!focusedFrame && !secondFrame && secondFrameProvider) {
      await new Promise<void>((resolve) => setTimeout(resolve, SECOND_FRAME_DELAY_MS));
      if (!isScanRequestActive(requestId)) return;
      try {
        const second = await secondFrameProvider();
        if (!isScanRequestActive(requestId)) return;
        const secondQuality = await assessImageQuality(second);
        if (secondQuality.ok) {
          secondFrame = { imageBase64: second, capturedAt: new Date().toISOString() };
        }
      } catch {
        // A second frame helps confidence but is not required.
      }
    }

    if (!isScanRequestActive(requestId)) return;
    const identifySecondFrame = focusedFrame ?? secondFrame;
    // Explicit groups are authoritative in aiService. Legacy requests use photo-1/photo-2;
    // retain their exact inputs, including a derived crop, without claiming a new angle.
    if (!photos && identifySecondFrame) {
      evidencePhotos = [...evidencePhotos, { id: "photo-2", label: focusedFrame ? "close_up" : "other", ...identifySecondFrame }];
    }
    if (captureEvidence && !await captureEvidence.persist(evidencePhotos)) return;
    if (!isScanRequestActive(requestId)) return;
    saveLatestScanState({ frame, photos: evidencePhotos, photoRelationship: scanPhotoRelationship, scanQuality, ...buildShopScanContext(scanShopJob, scanVehicleContext, undefined) });
    // Decide cache eligibility only after all accepted inputs are known and durable.
    setAnalysisStep("Checking saved matches");
    const imageHash = !photos && !identifySecondFrame && !scanVehicleContext ? await hashImageDataUrl(imageBase64) : null;
    if (!isScanRequestActive(requestId)) return;
    if (imageHash && !scanShopJob) {
      const cached = getCachedScanResult(imageHash);
      if (cached) {
        const contextualResult = applyShopFitmentContext(cached, scanVehicleContext);
        const cachedSelections = keepPrimaryCutout(createSceneCropFallbacks(sceneSelectionInputs(contextualResult, focusBox)), focusBox, focusMode, isolatedImageBase64);
        const shopScanContext = buildShopScanContext(scanShopJob, scanVehicleContext, contextualResult);
        setAnalysisStep("Opening result");
        recordScanOutcome(contextualResult);
        return persistAnalyzedReview(
          {
            frame,
            photos: evidencePhotos,
            photoRelationship: scanPhotoRelationship,
            result: contextualResult,
            analyzedAt: new Date().toISOString(),
            focusBox,
            focusMode,
            isolatedImageBase64,
            ...(cachedSelections.length ? { isolatedObjects: cachedSelections } : {}),
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
      }
    }
    // Optional visual preparation can await work after reference verification.
    // Recheck a guided request immediately before spending a provider call.
    assertCaptureCurrent?.();
    const analysisAttemptId = createAnalysisAttemptId();
    try {
      setAnalysisStep("Reading photo");
      const identifyStartedAt = performance.now();
      const result = applyShopFitmentContext(
        await identifyCapturedFrame(frame, identifySecondFrame, undefined, {
          photos,
          photoRelationship: scanPhotoRelationship,
          signal,
          vehicleContext: scanVehicleContext,
        }),
        scanVehicleContext,
      );
      if (!isScanRequestActive(requestId)) return;
      const identifyMs = Math.round(performance.now() - identifyStartedAt);
      recordIdentifyLatency(identifyMs, identifyMs > IDENTIFY_BUDGET_WARN_MS);
      if (identifyMs > IDENTIFY_BUDGET_WARN_MS) {
        console.warn(`[DeepSpec] Identify took ${identifyMs}ms (over ${IDENTIFY_BUDGET_WARN_MS}ms budget).`);
      }
      // The cache key covers only the original, so a two-photo result cannot be reused by it.
      if (imageHash && !scanShopJob && !scanVehicleContext && !photos && !identifySecondFrame) setCachedScanResult(imageHash, result);
      recordScanOutcome(result);

      // Keep every selected component even if segmentation is unavailable or times out.
      // A crop is retained as a crop, with the original photo and selection coordinates.
      let isolatedObjects: IsolatedObject[] | undefined;
      const inputs = sceneSelectionInputs(result, focusBox);
      if (inputs.length) {
          setAnalysisStep("Mapping the scene");
          const fallback = createSceneCropFallbacks(inputs);
          const objects = await optionalVisual(isolateSceneObjects(frame, inputs), SCENE_VISUAL_BUDGET_MS, fallback);
          if (!isScanRequestActive(requestId)) return;
          isolatedObjects = keepPrimaryCutout(objects, focusBox, focusMode, isolatedImageBase64);
      }

      recordScanDebug({ segmenter: isolationSource, focusMode });
      let debug: ScanDebugInfo | undefined;
      if (isScanDebugEnabled()) {
        debug = { ...getScanDebug(), webgpu: await optionalVisual(supportsWebGpu(), 100, false) };
        if (!isScanRequestActive(requestId)) return;
      }

      setAnalysisStep("Saving");
      const shopScanContext = buildShopScanContext(scanShopJob, scanVehicleContext, result);
      return persistAnalyzedReview(
        {
          frame,
          result,
          debug,
          photos: evidencePhotos,
          photoRelationship: scanPhotoRelationship,
          analysisAttemptId,
          analyzedAt: new Date().toISOString(),
          focusBox,
          focusMode,
          isolatedImageBase64,
          isolatedObjects,
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
      if (isAIRequestCanceled(analysisError)) return;
      if (!isScanRequestActive(requestId)) return;
      return persistAnalyzedReview(
        {
          frame,
          errorMessage: getSimpleScanErrorMessage(analysisError),
          photos: evidencePhotos,
          photoRelationship: scanPhotoRelationship,
          errorCode: analysisError instanceof AIServiceError ? analysisError.code : "analysis_failed",
          analysisAttemptId,
          analyzedAt: new Date().toISOString(),
          focusBox,
          focusMode,
          isolatedImageBase64,
          scanQuality,
          ...buildShopScanContext(scanShopJob, scanVehicleContext, undefined),
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
  }, [activeShopJob, activeShopVehicleContext, vehicleProfile, isScanRequestActive, persistAndShowReview, recordScanOutcome, selectedCameraId, stopForQualityCoach]);

  const finishSavedDraft = useCallback(async (draft: PhotoDraftEnvelope, kind: PhotoDraftKind, saved: Lookup | null | undefined, signal?: AbortSignal) => {
    const scope = accountScopeRef.current;
    const photos = draft.photos;
    const matchesSavedEvidence = saved && (saved.photos
      ? photoGroupsMatch(photos, saved.photos)
      : photos.length === 1 && saved.frame.imageBase64 === photos[0].imageBase64);
    if (!matchesSavedEvidence || !isAccountScopeCurrent(scope) || signal?.aborted) return false;
    try {
      const requestedTarget = hasPhotoDraftComparison(draft) && draft.comparisonTarget.version === 2 ? draft.comparisonTarget : undefined;
      const captureSnapshot = draft.target || hasPhotoDraftComparison(draft) ? structuredClone(saved) : undefined;
      if (hasPhotoDraftContext(draft) && (!vehicleContextsMatch(draft.vehicleContext, saved.vehicleContext) || draft.jobId !== saved.jobId)) throw new Error("The saved scan has different vehicle details. The original photo draft was kept for review.");
      if (photoRelationshipOrUnknown(draft.photoRelationship) !== photoRelationshipOrUnknown(saved.photoRelationship)) throw new Error("The saved scan has a different photo relationship. The original draft was kept for review.");
      const assertJobCurrent = await verifyDraftCaptureJobs(draft, scope, signal);
      if (hasPhotoDraftComparison(draft)) await completeComparisonCapture(draft.comparisonTarget, saved, scope, signal, assertJobCurrent);
      assertJobCurrent();
      if (draft.target) {
        if (saved.id !== draft.target.lookupId) throw new Error("The scan is saved but its component link is pending. Resume this draft to recover it.");
        await completeComponentCapture(draft.target, captureSnapshot!, scope, signal, assertJobCurrent);
      }
      assertJobCurrent();
      // Ordinary upload drafts remain reusable. Targeted drafts retire only after
      // their idempotent link commits, leaving recovery possible at every boundary.
      if (kind === "upload" && !draft.target && !hasPhotoDraftComparison(draft)) return true;
      if (!isAccountScopeCurrent(scope) || signal?.aborted) return false;
      const requestedGuard = requestedTarget ? await verifyRequestedEvidenceCaptureReference(requestedTarget, scope, signal) : undefined;
      const assertFinalJobCurrent = await verifyDraftCaptureJobs(draft, scope, signal);
      assertJobCurrent();
      const removed = await replacePhotoDraftEnvelopeIfMatches(draft, null, scope, kind,
        captureSnapshot ? () => {
          assertJobCurrent();
          assertFinalJobCurrent();
          assertComponentCaptureCurrent(captureSnapshot, scope, signal);
          if (requestedTarget && requestedGuard) assertRequestedEvidenceCaptureCurrent(requestedGuard, requestedTarget, scope);
        } : undefined);
      const remaining = removed ? null : await readPhotoDraftEnvelope(scope, kind);
      if (isAccountScopeCurrent(scope)) {
        const update = (current: PhotoDraftEnvelope | null) => current && photoDraftsMatch(current, draft) ? remaining : current;
        if (kind === "capture") setCaptureDraft(update); else setPhotoDraft(update);
        if (draft.target || hasPhotoDraftComparison(draft)) {
          setPhotoDraftMessage(hasPhotoDraftComparison(draft)
            ? requestedTarget ? "New photos and an unreviewed comparison were saved on this device. Collecting photos does not mean the request has been resolved."
              : "Dated comparison saved on this device. Review the relationship and observation dates before drawing conclusions."
            : isCloudSyncEnabled()
              ? "Photos linked to the component on this device. Save the map to cloud from its overview."
              : "Photos linked to the component on this device. Cloud sync is off; reopen the map overview to review them.");
          if (removed) setShowPhotoDraft(false);
        }
      }
      return true;
    } catch (error) {
      if (isAccountScopeCurrent(scope)) {
        setPhotoDraftMessage(error instanceof Error ? error.message : "The scan is saved. Resume its photo draft to finish linking it.");
        setPhotoDraftKind(kind);
        setShowPhotoDraft(true);
      }
      return false;
    }
  }, []);

  const handleIdentify = useCallback(async (reviewTargetOverride?: CameraObjectTarget, snapshotOverride?: CaptureVehicleSnapshot) => {
    if (!isAccountScopeCurrent(accountScopeRef.current) || isAnalyzing || activeIdentifyRef.current || photoDraftBusyRef.current) {
      return;
    }

    const reviewTarget = reviewTargetOverride;
    const activeRequest = beginScanRequest();
    const { requestId } = activeRequest;
    const watchdog = startScanWatchdog(requestId);
    try {
      setIsAnalyzing(true);
      setAnalysisStep("Checking saved capture");
      setCaptureError(null);
      photoDraftRevisionRef.current += 1;
      const pending = await readPhotoDraftEnvelope(accountScopeRef.current, "capture");
      if (!isScanRequestActive(requestId)) return;
      if (pending) {
        setCaptureDraft(pending);
        setPhotoDraftKind("capture");
        setShowPhotoDraft(true);
        setPhotoDraftMessage("Resume or discard this saved capture before taking another photo.");
        return;
      }
      if (routeCaptureError) throw new Error(routeCaptureError);
      if (routeReservedLookupId && getLookup(routeReservedLookupId)) throw new Error("This capture is already saved. Reopen its result, or resume its existing draft to finish the pending link.");
      const vehicleSnapshot = snapshotOverride ?? await captureVehicleSnapshot();
      if (!isScanRequestActive(requestId)) return;
      setAnalysisStep("Capturing photo");
      const imageBase64 = await captureFrame();
      if (!isScanRequestActive(requestId)) return;

      let captured: ScanPhoto[] = [{ id: "photo-1", label: "overview", imageBase64, capturedAt: new Date().toISOString() }];
      let draft = newCaptureDraft(captured, vehicleSnapshot, routeCaptureTarget ?? undefined, routeComparisonTarget);
      photoDraftRevisionRef.current += 1;
      setAnalysisStep("Saving captured photo");
      const stored = await replacePhotoDraftEnvelopeIfMatches(null, draft, accountScopeRef.current, "capture");
      if (stored && isAccountScopeCurrent(accountScopeRef.current)) { setCaptureDraft(draft); retakeVehicleSnapshotRef.current = null; }
      if (!isScanRequestActive(requestId)) return;
      if (!stored) {
        const pendingCapture = await readPhotoDraftEnvelope(accountScopeRef.current, "capture");
        if (!isScanRequestActive(requestId)) return;
        setCaptureDraft(pendingCapture);
        setPhotoDraftKind("capture");
        setShowPhotoDraft(Boolean(pendingCapture));
        setPhotoDraftMessage("Another capture was saved. Resume or discard it before taking another photo.");
        return;
      }
      if (draft.target || hasPhotoDraftComparison(draft)) {
        setPhotoDraftKind("capture");
        setShowPhotoDraft(true);
        setPhotoDraftMessage(hasPhotoDraftComparison(draft) ? "Follow-up photo saved. Match the earlier framing and review your new photo labels before analysis." : "Component photo saved. Add the other angles and check their labels before analysis.");
        return;
      }
      const saved = await analyzeImageBase64(imageBase64, requestId, "camera", activeRequest.controller.signal, captureFrame, reviewTarget, undefined, {
        original: captured[0],
        persist: async (accepted) => {
          const next: PhotoDraftEnvelope = { ...draft, photos: accepted };
          const matched = await replacePhotoDraftEnvelopeIfMatches(draft, next, accountScopeRef.current, "capture");
          if (!isScanRequestActive(requestId)) return false;
          if (!matched) {
            const pendingCapture = await readPhotoDraftEnvelope(accountScopeRef.current, "capture");
            if (!isScanRequestActive(requestId)) return false;
            setCaptureDraft(pendingCapture);
            setPhotoDraftKind("capture");
            setShowPhotoDraft(Boolean(pendingCapture));
            setCaptureError("Saved capture changed in another tab. Review its current photos before analysis.");
            return false;
          }
          captured = accepted;
          draft = next;
          setCaptureDraft(next);
          return true;
        },
      }, undefined, vehicleSnapshot.vehicleContext, vehicleSnapshot.jobId ?? null);
      await finishSavedDraft(draft, "capture", saved, activeRequest.controller.signal);
    } catch (error) {
      if (isScanRequestActive(requestId)) {
        pauseAutoScan(error instanceof Error ? error.message : "Capture failed. Try again.");
      }
    } finally {
      window.clearTimeout(watchdog);
      if (isScanRequestActive(requestId)) {
        setIsAnalyzing(false);
        setAnalysisStep(null);
      }
      finishScanRequest(activeRequest);
    }
  }, [analyzeImageBase64, beginScanRequest, captureFrame, captureVehicleSnapshot, finishScanRequest, isAnalyzing, isScanRequestActive, pauseAutoScan, finishSavedDraft, routeCaptureTarget, routeComparisonTarget, routeCaptureError, routeReservedLookupId, startScanWatchdog]);

  const refreshConflictingDraft = useCallback(async (kind: PhotoDraftKind) => {
    const scope = accountScopeRef.current;
    const current = await readPhotoDraftEnvelope(scope, kind);
    if (!isAccountScopeCurrent(scope)) return;
    if (kind === "capture") setCaptureDraft(current); else setPhotoDraft(current);
    setPhotoDraftKind(kind);
    setShowPhotoDraft(Boolean(current));
    const message = "Saved photos changed in another tab. Your change was not applied. Review the current draft before continuing.";
    setPhotoDraftMessage(message);
    setCaptureError(current ? null : message);
  }, []);

  const handleGalleryFiles = useCallback(async (files: File[]) => {
    if (!isAccountScopeCurrent(accountScopeRef.current) || isAnalyzing || photoDraftBusyRef.current) return;
    const scope = accountScopeRef.current;
    const kind = showPhotoDraft ? photoDraftKind : "upload";
    photoDraftBusyRef.current = true;
    photoDraftRevisionRef.current += 1;
    setPhotoDraftBusy(true);
    setPhotoDraftMessage("Checking saved photos on this device…");
    try {
      // The startup read may still be pending, or another tab may have saved a draft.
      // Read the selected slot before appending; unreadable storage must never become [].
      const stored = kind === "capture" ? await readPhotoDraftEnvelope(scope, kind) : await readPhotoDraftEnvelope(scope);
      if (!isAccountScopeCurrent(scope)) return;
      if (showPhotoDraft && (!stored || !activeDraftEnvelope || !photoDraftsMatch(activeDraftEnvelope, stored))) {
        await refreshConflictingDraft(kind);
        return;
      }
      if (kind === "capture") setCaptureDraft(stored); else setPhotoDraft(stored);
      const vehicleSnapshot = !stored || !showPhotoDraft ? await captureVehicleSnapshot() : null;
      if (!isAccountScopeCurrent(scope)) return;
      if (stored && !showPhotoDraft && (!componentCaptureTargetsMatch(stored.target, routeCaptureTarget ?? undefined)
        || !comparisonCaptureTargetsMatch(hasPhotoDraftComparison(stored) ? stored.comparisonTarget : undefined, routeComparisonTarget)
        || (hasPhotoDraftContext(stored)
          ? !vehicleContextsMatch(stored.vehicleContext, vehicleSnapshot?.vehicleContext) || stored.jobId !== vehicleSnapshot?.jobId
          : Boolean(vehicleSnapshot?.vehicleContext || vehicleSnapshot?.jobId)))) {
        setPhotoDraftKind(kind);
        setShowPhotoDraft(true);
        setPhotoDraftMessage("An earlier draft belongs to a different inspection. Resume or discard it before adding these photos. No photos were added.");
        return;
      }
      const storedReservedId = hasPhotoDraftComparison(stored) ? stored.comparisonTarget.lookupId : stored?.target?.lookupId;
      if (storedReservedId && getLookup(storedReservedId)) throw new Error("This photo group is already saved. Resume it to finish its pending link before adding new photos.");
      if (!stored && routeReservedLookupId && getLookup(routeReservedLookupId)) throw new Error("This capture is already saved. Reopen its result, or resume its existing draft to finish the pending link.");
      const previous = stored?.photos ?? [];
      if (previous.length + files.length > 4) {
        setCaptureError("Choose up to four photos. No photos were discarded.");
        setPhotoDraftMessage("Choose up to four photos. Remove a photo before adding another.");
        return;
      }
      setPhotoDraftMessage("Saving photos on this device…");
      const next = [...previous];
      for (const file of files) {
        const raw = await readImageFileAsDataUrl(file);
        const imageBase64 = file.size > COMPRESS_UPLOAD_OVER_BYTES ? await compressImageDataUrl(raw, CAPTURE_MAX_EDGE, 0.85) : raw;
        if (!isAccountScopeCurrent(scope)) return;
        next.push({ id: crypto.randomUUID(), label: next.length ? "other" : "overview", imageBase64, capturedAt: new Date().toISOString() });
      }
      const nextEnvelope: PhotoDraftEnvelope = stored ? { ...upgradePhotoDraft(stored), photos: next, photoRelationship: "unknown" } : newCaptureDraft(next, vehicleSnapshot!, routeCaptureTarget ?? undefined, routeComparisonTarget);
      const matched = kind === "capture"
        ? await replacePhotoDraftEnvelopeIfMatches(stored, nextEnvelope, scope, kind)
        : await replacePhotoDraftEnvelopeIfMatches(stored, nextEnvelope, scope);
      if (!isAccountScopeCurrent(scope)) return;
      if (!matched) { await refreshConflictingDraft(kind); return; }
      retakeVehicleSnapshotRef.current = null;
      if (kind === "capture") setCaptureDraft(nextEnvelope); else setPhotoDraft(nextEnvelope);
      setPhotoDraftKind(kind);
      setShowPhotoDraft(true);
      setPhotoDraftMessage("Photos saved on this device. Check the labels before analysis.");
      setCaptureError(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not save these photos. Retry before analysis.";
      setCaptureError(message);
      setPhotoDraftMessage(message);
    } finally {
      photoDraftBusyRef.current = false;
      setPhotoDraftBusy(false);
    }
  }, [isAnalyzing, showPhotoDraft, photoDraftKind, activeDraftEnvelope, refreshConflictingDraft, routeCaptureTarget, routeComparisonTarget, routeReservedLookupId, captureVehicleSnapshot]);

  const updatePhotoDraft = async (photos: ScanPhoto[] | null, relationship?: PhotoRelationship) => {
    if (photoDraftBusyRef.current || !activeDraftEnvelope || !isAccountScopeCurrent(accountScopeRef.current)) return;
    photoDraftBusyRef.current = true;
    photoDraftRevisionRef.current += 1;
    setPhotoDraftBusy(true);
    try {
      const reservedId = hasPhotoDraftComparison(activeDraftEnvelope) ? activeDraftEnvelope.comparisonTarget.lookupId : activeDraftEnvelope.target?.lookupId;
      if (photos && reservedId && getLookup(reservedId)) throw new Error("This photo group is already saved. Resume it to finish its pending link; the saved evidence cannot be relabeled here.");
      const sameSources = photos?.length === activeDraftEnvelope.photos.length && photos.every((photo, index) => {
        const previous = activeDraftEnvelope.photos[index];
        return photo.id === previous.id && photo.imageBase64 === previous.imageBase64 && photo.capturedAt === previous.capturedAt;
      });
      const next = photos ? { ...upgradePhotoDraft(activeDraftEnvelope), photos,
        photoRelationship: relationship ?? (sameSources ? photoRelationshipOrUnknown(activeDraftEnvelope.photoRelationship) : "unknown" as const),
      } : null;
      const matched = await replacePhotoDraftEnvelopeIfMatches(activeDraftEnvelope, next, accountScopeRef.current, photoDraftKind);
      if (!isAccountScopeCurrent(accountScopeRef.current)) return;
      if (!matched) { await refreshConflictingDraft(photoDraftKind); return; }
      if (photoDraftKind === "capture") setCaptureDraft(next); else setPhotoDraft(next);
      if (!photos) { setShowPhotoDraft(false); retakeVehicleSnapshotRef.current = null; pendingGuidedRetakeRef.current = false; }
      setPhotoDraftMessage("Draft saved on this device.");
    } catch (error) {
      setPhotoDraftMessage(error instanceof Error ? error.message : "The draft could not be updated. Retry.");
    } finally {
      photoDraftBusyRef.current = false;
      setPhotoDraftBusy(false);
    }
  };

  const analyzePhotoDraft = useCallback(async () => {
    if (!isAccountScopeCurrent(accountScopeRef.current) || isAnalyzing || activeIdentifyRef.current) {
      return;
    }
    if (!activeDraftEnvelope || photoDraftBusyRef.current) return;
    const reviewedDraft = upgradePhotoDraft(activeDraftEnvelope);
    const reviewedPhotos = reviewedDraft.photos;

    const activeRequest = beginScanRequest();
    const { requestId } = activeRequest;
    const watchdog = startScanWatchdog(requestId);
    try {
      setIsAnalyzing(true);
      setAnalysisStep("Checking saved photos before analysis");
      setCaptureError(null);
      const matched = await replacePhotoDraftEnvelopeIfMatches(activeDraftEnvelope, reviewedDraft, accountScopeRef.current, photoDraftKind);
      if (!isScanRequestActive(requestId)) return;
      if (!matched) { await refreshConflictingDraft(photoDraftKind); return; }
      if (photoDraftKind === "capture") setCaptureDraft(reviewedDraft); else setPhotoDraft(reviewedDraft);
      if (reviewedDraft.target) {
        const map = await readComponentMap(reviewedDraft.target.mapId, accountScopeRef.current);
        if (!isScanRequestActive(requestId)) return;
        if (!map?.document.components.some((component) => component.id === reviewedDraft.target!.componentId)) {
          throw new Error("The component map is unavailable on this device. Reopen its overview before resuming these photos.");
        }
      }
      const reservedId = hasPhotoDraftComparison(reviewedDraft) ? reviewedDraft.comparisonTarget.lookupId : reviewedDraft.target?.lookupId;
      if (reservedId) {
        const prior = getLookup(reservedId);
        if (prior) {
          if (!prior.photos || !photoGroupsMatch(prior.photos, reviewedPhotos)
            || photoRelationshipOrUnknown(prior.photoRelationship) !== photoRelationshipOrUnknown(reviewedDraft.photoRelationship)) throw new Error("This draft differs from its saved scan or photo relationship. Both were kept; reopen the original inspection before continuing.");
          if (hasPhotoDraftContext(reviewedDraft) && (!vehicleContextsMatch(reviewedDraft.vehicleContext, prior.vehicleContext) || reviewedDraft.jobId !== prior.jobId)) throw new Error("The saved scan has different vehicle details. Both records were kept; review the original inspection before continuing.");
          const linked = await finishSavedDraft(reviewedDraft, photoDraftKind, prior, activeRequest.controller.signal);
          if (linked && isScanRequestActive(requestId)) navigate(`/result/${encodeURIComponent(prior.id)}`);
          return;
        }
      }
      const assertJobCurrent = await verifyDraftCaptureJobs(reviewedDraft, accountScopeRef.current, activeRequest.controller.signal);
      if (!isScanRequestActive(requestId)) return;
      let assertCaptureCurrent: () => void = assertJobCurrent;
      if (hasPhotoDraftComparison(reviewedDraft)) {
        const target = reviewedDraft.comparisonTarget, scope = accountScopeRef.current;
        if (target.version === 2) {
          const guard = await verifyRequestedEvidenceCaptureReference(target, scope, activeRequest.controller.signal);
          assertCaptureCurrent = () => {
            assertJobCurrent();
            if (activeRequest.controller.signal.aborted) throw new DOMException("Requested photo capture canceled.", "AbortError");
            assertRequestedEvidenceCaptureCurrent(guard, target, scope);
          };
        } else await verifyComparisonCaptureReference(target, scope, activeRequest.controller.signal);
        if (!isScanRequestActive(requestId)) return;
      }
      setShowPhotoDraft(false);
      const saved = await analyzeImageBase64(reviewedPhotos[0].imageBase64, requestId, photoDraftKind === "capture" ? "camera" : "upload", activeRequest.controller.signal, undefined, undefined, reviewedPhotos, undefined, reviewedDraft.target,
        hasPhotoDraftContext(reviewedDraft) ? reviewedDraft.vehicleContext : reviewedDraft.target ? undefined : null,
        hasPhotoDraftContext(reviewedDraft) ? reviewedDraft.jobId ?? null : null,
        hasPhotoDraftComparison(reviewedDraft) ? reviewedDraft.comparisonTarget : undefined, reviewedDraft.photoRelationship, assertCaptureCurrent);
      const linked = await finishSavedDraft(reviewedDraft, photoDraftKind, saved, activeRequest.controller.signal);
      if (linked && saved && hasPhotoDraftComparison(reviewedDraft) && isScanRequestActive(requestId)) navigate(`/result/${encodeURIComponent(saved.id)}`);
    } catch (error) {
      if (isScanRequestActive(requestId)) {
        pauseAutoScan(error instanceof Error ? error.message : "Could not read that photo.");
        setPhotoDraftMessage(error instanceof Error ? error.message : "Could not read that photo. Your draft was kept.");
        setShowPhotoDraft(true);
      }
    } finally {
      window.clearTimeout(watchdog);
      if (isScanRequestActive(requestId)) {
        setIsAnalyzing(false);
        setAnalysisStep(null);
      }
      finishScanRequest(activeRequest);
    }
  }, [activeDraftEnvelope, photoDraftKind, analyzeImageBase64, beginScanRequest, finishScanRequest, isAnalyzing, isScanRequestActive, navigate, pauseAutoScan, refreshConflictingDraft, finishSavedDraft, startScanWatchdog]);

  const retryReviewScan = useCallback(async () => {
    if (!scanReview?.reviewTarget) {
      return;
    }

    setScanCardStatusMessage("Rescanning this point.");
    const override = getObjectTargetFromReviewTarget(scanReview.reviewTarget);
    await handleIdentify(override, { vehicleContext: scanReview.scanState.vehicleContext ?? null, ...(scanReview.scanState.jobId ? { jobId: scanReview.scanState.jobId } : {}) });
  }, [handleIdentify, scanReview]);

  const handleFlipCamera = useCallback(() => {
    if (isAnalyzing || activeIdentifyRef.current) return;
    switchCamera();
  }, [isAnalyzing, switchCamera]);

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
    abortActiveIdentify();
    setIsAnalyzing(false);
    setAnalysisStep(null);
    pauseAutoScan("Scan canceled. Ready when you are.");
  }

  function closeScanReview() {
    guidedRetakeUsedRef.current = false;
    pendingGuidedRetakeRef.current = false;
    retakeVehicleSnapshotRef.current = null;
    setQualityCoach(null);
    setScanReview(null);
    setCaptureError(null);
    setScanCardStatusMessage(null);
    setFocusedObjectIndex(null);
    setObjectAnalyses({});
    startedObjectAnalysisRef.current = new Set();
    pauseAutoScan();
  }

  function prepareGuidedRetake() {
    if (!scanReview || guidedRetakeUsedRef.current || isAnalyzing) return;
    const coach = getReviewRetakeCoach(scanReview.scanState);
    if (!coach) return;
    pendingGuidedRetakeRef.current = true;
    retakeVehicleSnapshotRef.current = { vehicleContext: scanReview.scanState.vehicleContext ?? null, ...(scanReview.scanState.jobId ? { jobId: scanReview.scanState.jobId } : {}) };
    setQualityCoach(coach);
    if (scanReview.scanState.provenance?.captureMode === "upload" || cameraState !== "ready") {
      galleryInputRef.current?.click();
    } else {
      setScanReview(null);
    }
  }

  // Selecting or correcting a component is local. A separate explicit action analyzes its area.
  // Focus + analyses reset on each scan and close so stale indices cannot cross scans.
  const orderedObjects = scanReview?.scanState.isolatedObjects
    ? orderSceneObjects(scanReview.scanState.isolatedObjects)
    : [];
  const focusedObject = focusedObjectIndex !== null ? orderedObjects[focusedObjectIndex] : undefined;
  const primaryObjectLabel = scanReview?.scanState.result
    ? getSimpleResultSummary(scanReview.scanState.result).title
    : "the scan";

  const runObjectAnalysis = useCallback((index: number, object: IsolatedObject | undefined) => {
    if (!isAccountScopeCurrent(accountScopeRef.current) || !object || startedObjectAnalysisRef.current.has(index)) {
      return;
    }
    startedObjectAnalysisRef.current.add(index);
    // This set is replaced on a new scan or when review closes. A late response must
    // not overwrite another scan's card just because it uses the same object index.
    const analysisSession = startedObjectAnalysisRef.current;
    setObjectAnalyses((prev) => ({ ...prev, [index]: { status: "loading" } }));
    const original = scanReview?.scanState.frame;
    const stillCurrent = () => isAccountScopeCurrent(accountScopeRef.current) && startedObjectAnalysisRef.current === analysisSession;
    void (async () => {
      const hasImage = (image: string | null | undefined): image is string => Boolean(image && /^data:image\/(?:jpeg|png|webp);base64,\S+$/.test(image));
      const imageBase64 = object.focusMode !== "crop" && hasImage(object.isolatedImageBase64)
        ? object.isolatedImageBase64
        : original && hasImage(original.imageBase64)
          ? await optionalVisual(createFocusedScanCrop(original.imageBase64, object.focusBox), 1000, null)
          : null;
      if (!stillCurrent()) return;
      if (!hasImage(imageBase64)) {
        setObjectAnalyses((prev) => ({ ...prev, [index]: { status: "error", message: "This selected area is unavailable. Keep the original photo and adjust the outline or retake it before analyzing this part." } }));
        return;
      }
      return identifyCapturedFrame({ imageBase64, capturedAt: original?.capturedAt ?? new Date().toISOString() }, undefined, undefined, { vehicleContext: scanReview?.scanState.vehicleContext });
    })()
      .then((result) => {
        if (!result || !stillCurrent()) return;
        setObjectAnalyses((prev) => ({ ...prev, [index]: { status: "done", result } }));
      })
      .catch((error) => {
        if (!isAccountScopeCurrent(accountScopeRef.current) || startedObjectAnalysisRef.current !== analysisSession) return;
        setObjectAnalyses((prev) => ({ ...prev, [index]: { status: "error", message: getSimpleScanErrorMessage(error) } }));
      });
  }, [scanReview?.scanState.frame, scanReview?.scanState.vehicleContext]);

  const handleFocusObject = useCallback((index: number | null) => {
    setFocusedObjectIndex(index);
  }, []);

  const retryFocusedObject = useCallback(() => {
    if (focusedObjectIndex === null) {
      return;
    }
    startedObjectAnalysisRef.current.delete(focusedObjectIndex);
    setObjectAnalyses((prev) => {
      const next = { ...prev };
      delete next[focusedObjectIndex];
      return next;
    });
    const objects = scanReview?.scanState.isolatedObjects;
    runObjectAnalysis(focusedObjectIndex, objects ? orderSceneObjects(objects)[focusedObjectIndex] : undefined);
  }, [focusedObjectIndex, scanReview, runObjectAnalysis]);

  // Google Lens–style manual crop box (feature-flagged, ships dark). When on, it replaces the
  // auto-target reticle + default shutter and feeds its region into the same identify pipeline.
  const cropBoxEnabled = isCropBoxEnabled();

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
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_bottom,rgba(4,7,14,0.72),rgba(4,7,14,0)_28%,rgba(4,7,14,0)_55%,rgba(4,7,14,0.78))]" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[46dvh] bg-[radial-gradient(ellipse_at_50%_80%,rgba(94,147,166,0.12),rgba(4,7,14,0)_42%),linear-gradient(to_top,rgba(4,7,14,0.90),rgba(4,7,14,0))]" />

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
          <BrandLockup size="sm" />
        </div>
        {!activeShopJob && !routeCaptureTarget && !routeComparisonTarget ? <button type="button" disabled={isAnalyzing || photoDraftBusy || Boolean(scanReview)} onClick={() => { setVehicleEdit(vehicleProfile); setShowVehicleEditor(true); }} className="rounded-full border border-white/25 bg-slate-950/80 px-3 py-2 text-sm disabled:opacity-40">Car details</button> : <div className="size-10" aria-hidden="true" />}
      </header>

      {showVehicleEditor ? <section role="dialog" aria-modal="true" aria-label="Car details for new photos" className="fixed inset-0 z-[90] overflow-y-auto bg-slate-950 p-5 text-white">
        <div className="mx-auto max-w-3xl space-y-5">
          <h2 className="text-xl font-semibold">Car details for new photos</h2>
          <p>Save the car you are inspecting. These details are remembered on this device for new photos. Saved scans and unfinished photo groups keep their original details.</p>
          <VehicleContextEditor value={vehicleEdit} onChange={setVehicleEdit} />
          {vehicleMessage ? <p role="status">{vehicleMessage}</p> : null}
          <div className="flex flex-wrap gap-3">
            <button type="button" onClick={() => {
              const saved = saveVehicleProfile(vehicleEdit, accountScopeRef.current);
              if (!saved.ok) { setVehicleMessage(saved.message); return; }
              setVehicleProfile(saved.value); setVehicleEdit(saved.value); setVehicleMessage(null); setShowVehicleEditor(false);
              retakeVehicleSnapshotRef.current = null; pendingGuidedRetakeRef.current = false;
            }} className="rounded bg-white px-4 py-3 font-semibold text-slate-950">Use these details for new photos</button>
            <button type="button" onClick={() => { setVehicleEdit(undefined); setVehicleMessage("No car selected. Save to use no vehicle details for new photos."); }} className="rounded border px-4 py-3">Clear selected car</button>
            <button type="button" onClick={() => setShowVehicleEditor(false)} className="rounded border px-4 py-3">Cancel</button>
          </div>
        </div>
      </section> : null}

      {routeCaptureError && !showPhotoDraft ? <p role="alert" className="fixed left-4 right-4 top-20 z-30 rounded-xl bg-slate-950/90 p-3 text-sm">{routeCaptureError}</p> : null}
      {activeComparisonTarget && !showPhotoDraft && !scanReview ? <div className="fixed left-4 right-4 top-20 z-30 max-h-[40vh] space-y-3 overflow-y-auto rounded-xl bg-slate-950/95 p-3 text-sm">
        {activeComparisonTarget.version === 2 ? <RequestedEvidenceCaptureGuide guide={activeComparisonTarget.requestedEvidence} /> : null}
        <ComparisonCaptureReference target={activeComparisonTarget} />
      </div> : null}
      {routeCaptureTarget && !routeComparisonTarget && !showPhotoDraft ? <div className="fixed left-4 right-4 top-20 z-30 rounded-xl bg-slate-950/90 p-3 text-sm">
        <p>Photograph one component, then add its other angles before analysis.</p>
        <Link to={`/result/${encodeURIComponent(routeCaptureTarget.mapId)}`} className="mt-1 inline-block underline">Return to component map</Link>
      </div> : null}

      {activeShopJob && !routeComparisonTarget ? (
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
          notice={qualityCoach ? { title: qualityCoach.title, text: qualityCoach.action } : captureError && !isPhotoDraftReviewOpen ? { text: captureError } : null}
          onGallery={() => galleryInputRef.current?.click()}
          message={cameraError}
          onRetry={retryCamera}
          onSelectCamera={selectCamera}
          selectedCameraId={selectedCameraId}
        />
      ) : null}

      {cameraState !== "blocked" ? (
        <>
          {cameraState === "ready" && !scanReview && !cropBoxEnabled ? <ScannerHUD isAnalyzing={isAnalyzing} /> : null}
          {cameraState === "ready" && !scanReview && cropBoxEnabled ? (
            <CropBox webcamRef={webcamRef} isAnalyzing={isAnalyzing} onCapture={(target) => void handleIdentify(target)} />
          ) : null}
          {qualityCoach && !scanReview ? (
            <ScanQualityCoachNotice
              coach={qualityCoach}
              onTryAgain={() => void handleIdentify()}
            />
          ) : null}
          {captureError && !isPhotoDraftReviewOpen ? <CaptureErrorNotice message={captureError} onTryAgain={() => setCaptureError(null)} /> : null}
        </>
      ) : null}

      {scanReview ? (
        <section aria-label="Scan analysis workspace" data-testid="scan-analysis-workspace" className="fixed inset-0 z-40 flex min-h-0 flex-col bg-[var(--ds-bg)]">
          <header className="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 px-4 pb-3 pt-[max(16px,env(safe-area-inset-top))]">
            <BrandLockup size="sm" />
            <Link to="/history" className="rounded-full border border-white/15 px-3 py-2 text-xs font-bold">Saved scans</Link>
          </header>
          <PhotoEvidenceStrip photos={scanReview.scanState.photos} photoRelationship={scanReview.scanState.photoRelationship} pipelineVersion={scanReview.scanState.result ? scanReview.scanState.result.modelRun?.pipelineVersion : null} selectedId={selectedPhoto?.id} onSelect={(id) => { setSelectedPhotoId(id); handleFocusObject(null); }} />
          <div className="grid min-h-0 flex-1 grid-rows-[minmax(200px,42dvh)_minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_420px] lg:grid-rows-1">
            <div aria-label="Scan photo" data-testid="scan-workspace-photo" className="relative min-h-0 overflow-hidden bg-[#020617] [&>div]:absolute">
              <IsolatedPartView
                key={photoReviewViewRequest}
                initialView={photoReviewViewRequest ? "original" : undefined}
                frameBase64={selectedPhoto?.imageBase64 ?? scanReview.scanState.frame.imageBase64}
                isolatedImageBase64={isOverviewPhoto ? scanReview.scanState.isolatedImageBase64 : undefined}
                focusBox={isOverviewPhoto ? scanReview.scanState.focusBox : undefined}
                focusMode={isOverviewPhoto ? (scanReview.scanState.focusMode ?? (scanReview.isolatedFrame ? "crop" : "full_frame")) : "full_frame"}
                label={scanReview.scanState.result ? getSimpleResultSummary(scanReview.scanState.result).title : "Item captured"}
                issue={isOverviewPhoto && scanReview.scanState.result ? deriveIssue(scanReview.scanState.result) : null}
                sceneChips={isOverviewPhoto && scanReview.scanState.result ? getSceneChips(scanReview.scanState.result) : undefined}
                objects={isOverviewPhoto ? scanReview.scanState.isolatedObjects : undefined}
                variant="scanner"
                focusedObjectIndex={focusedObjectIndex}
                onFocusObject={handleFocusObject}
                onCorrectFocus={isOverviewPhoto ? (box, objectIndex) => {
                  if (!isAccountScopeCurrent(accountScopeRef.current)) return;
                  try {
                    let corrected = correctScanSelection(scanReview.scanState, box, objectIndex);
                    if (scanReview.lookup) {
                      const saved = updateLookupVisualSelection(scanReview.lookup.id, box, objectIndex, scanReview.scanState);
                      if (!saved.ok || !saved.value) { setScanCardStatusMessage(saved.ok ? "Saved scan not found." : saved.message); return; }
                      corrected = scanStateFromLookup(saved.value);
                      setScanReview({ ...scanReview, scanState: corrected, lookup: saved.value });
                      syncSavedLookup(saved.value);
                    } else {
                      setScanReview({ ...scanReview, scanState: corrected });
                      setScanCardStatusMessage("Selection changed in this view. Save the scan to keep it.");
                    }
                    startedObjectAnalysisRef.current = new Set();
                    setObjectAnalyses({});
                    saveLatestScanState(corrected);
                  } catch (error) { setScanCardStatusMessage(error instanceof Error ? error.message : "Could not save selection."); }
                } : undefined}
              />
            </div>
            <div data-testid="scan-workspace-overview" className="min-h-0 overflow-y-auto border-t border-white/10 bg-[var(--ds-page)] lg:border-l lg:border-t-0">
              {focusedObject ? <FocusedObjectCard
                object={focusedObject}
                analysis={focusedObjectIndex !== null ? objectAnalyses[focusedObjectIndex] : undefined}
                primaryLabel={primaryObjectLabel}
                prefs={scanCardPrefs}
                onBack={() => handleFocusObject(null)}
                onRetry={retryFocusedObject}
              /> : <ScanResultCard
                isExpanded={false}
                isMismatch={false}
                onClose={closeScanReview}
                onRetryMismatch={retryReviewScan}
                onUndoCorrection={handleUndoCorrection}
                prefs={scanCardPrefs}
                review={scanReview}
                retakeCoach={getReviewRetakeCoach(scanReview.scanState)}
                retakeUsed={scanReview.guidedRetakeUsed}
                onPrepareRetake={prepareGuidedRetake}
                retakeUsesUpload={scanReview.scanState.provenance?.captureMode === "upload" || cameraState !== "ready"}
                scanCardStatusMessage={scanCardStatusMessage}
              />}
              <PhotoReviewPanel scan={scanReview.scanState} onSelectPhoto={(id) => {
                setSelectedPhotoId(id);
                handleFocusObject(null);
                setPhotoReviewViewRequest((request) => request + 1);
              }} />
            </div>
          </div>
        </section>
      ) : null}
      {isAnalyzing ? <AnalyzingOverlay onCancel={cancelCurrentScan} step={analysisStep} /> : null}
      <ScanDebugOverlay info={scanReview?.scanState.debug} />
      {scanReview && ((scanReview.lookup && scanSave?.lookupId === scanReview.lookup.id) || scanReview.scanState.storageWarning) ? (
        <aside data-testid="scan-save-status" role="status" className="fixed right-3 top-[calc(max(12px,env(safe-area-inset-top))+56px)] z-[60] max-w-[min(70vw,320px)] rounded-xl border border-white/20 bg-slate-950/90 px-3 py-2 text-xs text-white shadow-lg">
          {scanReview.scanState.storageWarning
            ? `Not saved on this device. ${scanReview.scanState.storageWarning}`
            : scanSave?.status === "saved" ? "Scan saved to cloud"
              : scanSave?.status === "local" ? "Saved on this device. Cloud sync is off."
                : scanSave?.status === "failed" ? "Saved on this device. Cloud sync failed."
                  : "Saved on this device. Saving scan to cloud…"}
          {scanReview.lookup && scanSave?.status === "failed" ? (
            <button type="button" className="ml-2 underline" onClick={() => { if (scanReview.lookup) syncSavedLookup(scanReview.lookup); }}>Retry cloud save</button>
          ) : null}
        </aside>
      ) : null}

      <input
        ref={galleryInputRef}
        aria-label="Upload photo"
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        disabled={isAnalyzing}
        multiple
        onChange={(event) => {
          const files = Array.from(event.currentTarget.files ?? []);
          event.currentTarget.value = "";
          if (files.length) void handleGalleryFiles(files);
        }}
        type="file"
      />
      {!showPhotoDraft && !isAnalyzing ? <div className="fixed bottom-24 left-3 z-[65] flex gap-2">{photoDraft ? <button type="button" onClick={() => { setPhotoDraftKind("upload"); setShowPhotoDraft(true); }} className="rounded-xl bg-white px-4 py-3 text-sm font-semibold text-slate-950">Resume {photoDraft.length}-photo draft</button> : null}{captureDraft ? <button type="button" onClick={() => { setPhotoDraftKind("capture"); setShowPhotoDraft(true); }} className="rounded-xl bg-white px-4 py-3 text-sm font-semibold text-slate-950">Resume captured photo</button> : null}</div> : null}
      {activePhotoDraft && showPhotoDraft ? <PhotoGroupReview photos={activePhotoDraft}
        photoRelationship={activeDraftEnvelope?.photoRelationship} onRelationshipChange={(relationship) => void updatePhotoDraft(activePhotoDraft, relationship)}
        vehicleContext={hasPhotoDraftContext(activeDraftEnvelope) ? activeDraftEnvelope.vehicleContext : undefined}
        componentMapId={activeDraftEnvelope?.target?.mapId} savedForComponent={Boolean(activeDraftEnvelope?.target && getLookup(activeDraftEnvelope.target.lookupId))}
        referenceNode={activeComparisonTarget ? <ComparisonCaptureReference target={activeComparisonTarget} /> : undefined}
        requestedEvidence={activeComparisonTarget?.version === 2 ? activeComparisonTarget.requestedEvidence : undefined}
        savedActionLabel={activeComparisonTarget && getLookup(activeComparisonTarget.lookupId) ? activeDraftEnvelope?.target ? "Finish comparison and component link" : "Finish dated comparison" : undefined}
        busy={photoDraftBusy || isAnalyzing} message={captureError ?? photoDraftMessage} onChange={(photos) => void updatePhotoDraft(photos)} onAdd={() => galleryInputRef.current?.click()} onAnalyze={() => void analyzePhotoDraft()} onClose={() => setShowPhotoDraft(false)} onDiscard={() => void updatePhotoDraft(null)} /> : null}
      {!scanReview && !cropBoxEnabled ? (
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

function ComparisonCaptureReference({ target }: { target: ComparisonCaptureTarget }) {
  const identity = JSON.stringify(target);
  const [state, setState] = useState<{ identity: string; image?: string; message: string }>();
  useEffect(() => {
    const scope = getAccountScope(), controller = new AbortController();
    void resolveComparisonSide(target.earlier, scope, controller.signal).then((result) => {
      if (!controller.signal.aborted && isAccountScopeCurrent(scope)) setState({ identity,
        ...(result.status === "unchanged" && result.image ? { image: result.image } : {}), message: result.message });
    }, () => {
      if (!controller.signal.aborted && isAccountScopeCurrent(scope)) setState({ identity, message: "The earlier original is unavailable. Reopen its saved scan before finishing this comparison." });
    });
    return () => controller.abort();
  }, [target, identity]);
  const current = state?.identity === identity ? state : undefined;
  return <details open className="rounded border border-white/20 p-3" data-testid="comparison-capture-reference">
    <summary className="cursor-pointer font-semibold">Earlier original: {target.subject}</summary>
    {current?.image ? <img src={current.image} alt={`Earlier reference original: ${target.subject}`} className="mt-2 max-h-40 w-full object-contain" /> : <p role="status" className="mt-2">{current?.message ?? "Checking the earlier original…"}</p>}
    <p className="mt-2">{target.earlier.observedOn ? `Reported observation date: ${target.earlier.observedOn}.` : "Observation date unknown."} Photo added: {target.earlier.photoAddedAt}.</p>
    {target.version === 2 ? <p className="mt-2">Use this earlier photo to locate the requested area. Follow the photo request above.</p> : <>
      <p className="mt-2">Match the earlier framing and fixed landmarks. Use similar lighting and note any cleaning or wetness. A changed angle or surface can change its appearance.</p>
      <p className="mt-2">Only your new photos will be analyzed. The earlier original stays a separate reference; the comparison starts unreviewed.</p>
    </>}
    <Link to={`/result/${encodeURIComponent(target.earlier.lookupId)}`} className="mt-2 inline-block underline">Open earlier saved scan</Link>
  </details>;
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
  quality: ImageQualityResult;
  target: CameraObjectTarget | null;
}): ScanQualitySnapshot {
  const metrics = quality.metrics;
  const targetScore = getTargetCenteredScore(target);

  return {
    accepted: quality.ok,
    ...(!quality.ok ? { failureReason: quality.issue, fixAction: getScanQualityCoach(quality.issue).action } : {}),
    averageLuminance: metrics?.averageLuminance ?? null,
    brightPixelRatio: metrics?.brightPixelRatio ?? null,
    brightnessScore: metrics?.brightnessScore ?? null,
    cameraId: cameraId.trim() || "unknown",
    checkedAt: new Date().toISOString(),
    darkPixelRatio: metrics?.darkPixelRatio ?? null,
    firstPass,
    ...(quality.ok && previousFailureReason ? { fixAction: getScanQualityCoach(previousFailureReason).action } : {}),
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
      <div className="rounded-[24px] border border-white/10 bg-white/8 p-5 shadow-2xl backdrop-blur-md" style={{ borderColor: "rgba(94,147,166,0.18)" }}>
        <div
          className="mx-auto size-12 animate-spin rounded-full border-2"
          style={{ borderColor: "rgba(94,147,166,0.14)", borderTopColor: "rgba(94,147,166,0.85)" }}
        />
        <p className="mt-4 text-sm font-extrabold text-white">Opening camera</p>
      </div>
    </div>
  );
}

function CameraBlocked({
  devices,
  message,
  notice,
  onGallery,
  onRetry,
  onSelectCamera,
  selectedCameraId,
}: {
  devices: CameraDevice[];
  message: string | null;
  /** Feedback on the last upload; the floating scanner notices don't render while the camera is blocked. */
  notice: { title?: string; text: string } | null;
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
        <div className="mx-auto mb-5 grid size-14 place-items-center rounded-2xl border border-[var(--ds-border)] bg-white/5 text-white/70">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
            <rect x="3" y="6.5" width="18" height="12.5" rx="2.5" stroke="currentColor" strokeWidth="1.6" />
            <circle cx="12" cy="12.75" r="3.5" stroke="currentColor" strokeWidth="1.6" />
            <path d="M8 6.5l1.3-2.2h5.4L16 6.5" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
          </svg>
        </div>
        <h1 className="text-2xl font-extrabold tracking-tight">Turn on the camera</h1>
        <p className="mt-3 text-sm leading-6 text-[#A1A1AA]">
          Deep Spec scans parts through your camera. {denied || waiting ? "Allow camera access for this site, then try again." : "Enable camera access, then try again."}
        </p>
        {message ? <p className="mt-3 text-xs text-white/48">{message}</p> : null}
        {notice ? (
          <div
            className="mt-5 rounded-[14px] px-4 py-3 text-left"
            data-testid="upload-notice"
            role="status"
            style={{ background: "rgba(94,147,166,0.10)", border: "1px solid rgba(94,147,166,0.24)" }}
          >
            {notice.title ? <h2 className="text-base font-black tracking-tight text-white">{notice.title}</h2> : null}
            <p className="text-sm font-semibold leading-6 text-white/86">{notice.text}</p>
          </div>
        ) : null}
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
    <div data-testid="scan-analyzing-overlay" className="fixed inset-0 z-[80] grid place-items-center px-6 text-center" style={{ background: "rgba(4,7,14,0.82)", backdropFilter: "blur(16px)" }}>
      <div className="w-full max-w-xs overflow-hidden rounded-[24px] p-6 shadow-2xl" style={{ background: "rgba(7,16,30,0.96)", border: "1px solid rgba(94,147,166,0.18)" }}>
        <div data-testid="scan-brand-animation" className="ds-scan-brand-animation mx-auto" aria-hidden="true">
          <img className="ds-scan-glass-badge" src="/brand/deepspec-scan-badge-glass.webp" alt="" width="336" height="336" />
          <span className="ds-scan-lock-corner ds-scan-lock-corner-tl" />
          <span className="ds-scan-lock-corner ds-scan-lock-corner-tr" />
          <span className="ds-scan-lock-corner ds-scan-lock-corner-bl" />
          <span className="ds-scan-lock-corner ds-scan-lock-corner-br" />
        </div>
        <div role="status" aria-live="polite">
          <p className="mt-5 text-lg font-extrabold tracking-tight text-white">Reading photo</p>
          <p className="mt-2 text-sm leading-6" style={{ color: "var(--slate-300)" }}>
            {message}
          </p>
        </div>
        {/* Keep per-second timer changes outside the live progress region. */}
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
        border: "1px solid rgba(94,147,166,0.18)",
        backdropFilter: "blur(28px) saturate(1.4)",
        boxShadow: "0 24px 60px rgba(0,0,0,0.55)",
      }}
    >
      <div className="px-5 py-4" style={{ background: "rgba(94,147,166,0.07)", borderBottom: "1px solid rgba(94,147,166,0.12)" }}>
        <p style={{ fontFamily: "var(--font-data)", fontSize: 10, fontWeight: 600, letterSpacing: "0.14em", color: "#86B2C0", textTransform: "uppercase" }}>
          {coach.progress}
        </p>
        <h2 className="mt-1 text-[22px] font-black tracking-tight">{coach.title}</h2>
      </div>
      <div className="px-5 py-4">
        <p className="text-base font-black leading-6 text-white">{coach.action}</p>
        <button
          className="mt-4 w-full rounded-[12px] py-3 text-[13px] font-bold text-white"
          style={{ background: "var(--blue-500)", boxShadow: "0 4px 18px rgba(78,110,146,0.30)" }}
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
  retakeCoach,
  retakeUsed,
  onPrepareRetake,
  retakeUsesUpload,
  isExpanded,
  isMismatch,
  onClose,
  onRetryMismatch,
  onUndoCorrection,
  prefs,
  review,
  scanCardStatusMessage,
}: {
  retakeCoach: ScanQualityCoachState | null;
  retakeUsed: boolean;
  onPrepareRetake: () => void;
  retakeUsesUpload: boolean;
  isExpanded: boolean;
  isMismatch: boolean;
  onClose: () => void;
  onRetryMismatch: () => void;
  onUndoCorrection: () => void;
  prefs: ScanCardPreferences;
  review: ScanReviewState;
  scanCardStatusMessage: string | null;
}) {
  const result = review.scanState.result;
  const intakeReview = getIntakeReview(review.lookup ?? review.scanState);
  const summary = result ? getSimpleResultSummary(result) : null;
  const isError = Boolean(review.scanState.errorMessage);
  const needsSignIn = review.scanState.errorCode === "missing_session" || review.scanState.errorCode === "invalid_session";
  const label = isError ? "Item captured" : summary?.title ?? getReviewDisplayLabel(review);
  const isCompact = prefs.compactCardsByDefault && !isExpanded;
  // Collapse hides only this card's body so the AR overlay behind it (outlines, labels, chips) and
  // the debug overlay — both rendered as siblings, not children — stay visible. onClose still tears
  // the whole review down; collapsing does not touch review state.
  const [collapsed, setCollapsed] = useState(false);

  return (
    <section
      aria-live="polite"
      data-testid="scan-overview-card"
      className="relative flex min-w-0 flex-col px-4 pb-[max(20px,env(safe-area-inset-bottom))] pt-4 text-white"
    >
      {/* Drag handle */}
      <div className="mx-auto mb-3 h-1 w-10 shrink-0 rounded-full bg-white/18" />

      {/* Header */}
      <p className="mb-3 text-xs font-extrabold uppercase tracking-[0.14em] text-white/55">AI overview</p>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          {result && !isError ? (
            <div
              className="mb-2 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1"
              style={{ background: "rgba(94,147,166,0.08)", border: "1px solid rgba(94,147,166,0.24)" }}
            >
              <span className="block rounded-full" style={{ width: 5, height: 5, background: "var(--electric-300)", flexShrink: 0 }} />
              <span
                style={{
                  fontFamily: "var(--font-data)",
                  fontSize: 10,
                  fontWeight: 600,
                  letterSpacing: "0.10em",
                  color: "#86B2C0",
                  textTransform: "uppercase",
                }}
              >
                {summary?.eyebrow ?? "Identified"}
              </span>
            </div>
          ) : null}
          <h3 className="text-[18px] font-black leading-tight tracking-[-0.02em]">{label}</h3>
          {!collapsed && result ? <IssueLine result={result} variant="scanner" /> : null}
          {!collapsed && result && summary ? <p className="mt-1 text-sm font-semibold leading-5 text-white/76">{getAnswerBody(result, summary)}</p> : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            className={collapsed
              ? "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-extrabold text-white/80 transition-colors hover:text-white"
              : "grid size-8 place-items-center rounded-full text-white/50 transition-colors hover:text-white/80"}
            style={{ border: "1px solid rgba(255,255,255,0.10)", background: "rgba(255,255,255,0.05)" }}
            onClick={() => setCollapsed((value) => !value)}
            type="button"
            aria-expanded={!collapsed}
            aria-label={collapsed ? "Show details" : "Hide details"}
            data-testid="scan-card-collapse-toggle"
          >
            {collapsed ? <span>Show details</span> : null}
            <svg
              width="11"
              height="11"
              viewBox="0 0 11 11"
              fill="none"
              aria-hidden
              className={`transition-transform ${collapsed ? "" : "rotate-180"}`}
            >
              <path d="M1.5 4l4 4 4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button
            className="grid size-8 place-items-center rounded-full text-white/50 transition-colors hover:text-white/80"
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
      </div>


      {/* Content body */}
      {!collapsed ? (
      <div className="mt-3">
        {retakeCoach ? <div className="mb-3 rounded-xl bg-white/10 px-3 py-2.5">
          <h2 className="text-sm font-bold">{retakeCoach.title}</h2>
          <p className="mt-1 text-xs text-white/75">{retakeCoach.action}</p>
          {retakeUsed ? <p className="mt-2 text-xs font-bold">Guided retake used. Review the evidence or start a separate scan when ready.</p> : (
            <button type="button" onClick={onPrepareRetake} className="mt-2 rounded-full bg-[var(--ds-accent)] px-3 py-2 text-xs font-bold">{retakeUsesUpload ? "Upload one retake" : "Prepare one retake"}</button>
          )}
        </div> : null}
        <div className="mb-3 rounded-xl bg-white/10 px-3 py-2.5">
          <p className="text-xs font-bold">{intakeReview.label}</p>
          {intakeReview.reasons.map((reason) => <p key={reason} className="mt-1 text-xs text-white/75">{reason}</p>)}
          {review.lookup ? <Link className="mt-2 inline-block text-xs font-bold underline" to={`/result/${review.lookup.id}`} state={withAccountRouteState({ ...review.scanState, savedLookup: review.lookup })}>Open intake draft</Link> : null}
        </div>
        {isMismatch ? (
          <div
            className="mb-3 rounded-xl px-3 py-2.5"
            style={{ background: "rgba(139,169,196,0.08)", border: "1px solid rgba(139,169,196,0.22)" }}
          >
            <p className="text-[10px] font-extrabold uppercase tracking-[0.14em]" style={{ color: "var(--ds-fg-3)" }}>Target changed</p>
            <p className="mt-1 text-xs leading-5" style={{ color: "var(--ds-fg-4)", opacity: 0.85 }}>
              The current object moved away from the saved scan point.
            </p>
            <button
              className="mt-2 rounded-full px-3 py-1.5 text-[11px] font-extrabold text-white"
              style={{ background: "var(--ds-accent)" }}
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
            {needsSignIn ? (
              <Link
                className="mt-3 inline-flex rounded-full bg-white px-4 py-2 text-xs font-extrabold text-[#0b1520]"
                state={{ from: "/scan" }}
                to="/auth"
              >
                Sign in to continue
              </Link>
            ) : null}
          </div>
        ) : result ? (
          <>
            <SceneCategoryList result={result} variant="scanner" />
            <ResultDetailSections result={result} variant="scanner" compact={isCompact} />
          </>
        ) : null}
      </div>
      ) : null}

      {/* Actions */}
      {!collapsed ? (
      <div className="mt-4 space-y-3">
        {review.lookup ? <div className="grid grid-cols-2 gap-2">
          <Link to={`/result/${review.lookup.id}`} state={withAccountRouteState({ ...review.scanState, savedLookup: review.lookup })} className="rounded-full border border-white/20 bg-white/5 px-3 py-3 text-center text-xs font-extrabold">Open AI view</Link>
          {result ? <Link to={`/result/${review.lookup.id}/chat`} className="rounded-full border border-white/70 bg-[linear-gradient(180deg,#fff,#dce4eb)] px-3 py-3 text-center text-xs font-extrabold text-[#0b1520] shadow-[inset_0_1px_0_#fff,0_6px_18px_rgba(0,0,0,.18)]">Ask DeepSpec</Link> : <button type="button" onClick={onRetryMismatch} className="rounded-full bg-white px-3 py-3 text-center text-xs font-extrabold text-[#0b1520]">Retry analysis</button>}
        </div> : null}
        {result ? <ScanSources sources={result.sourceLinks} researchTerm={`${result.partName} car part`} variant="scanner" /> : null}
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
      ) : null}

      {!collapsed && scanCardStatusMessage ? (
        <p className="mt-2 text-xs font-bold" style={{ color: "var(--electric-300)" }}>
          {scanCardStatusMessage}
        </p>
      ) : null}
    </section>
  );
}

type ObjectAnalysis =
  | { status: "loading" }
  | { status: "done"; result: IdentificationResult }
  | { status: "error"; message: string };

/** Detail card for a tapped secondary object — same sections as the primary card, fed by the
 *  lazy on-tap identify run on that object's cutout (loading spinner, then a real card). */
function FocusedObjectCard({
  object,
  analysis,
  primaryLabel,
  prefs,
  onBack,
  onRetry,
}: {
  object: IsolatedObject;
  analysis: ObjectAnalysis | undefined;
  primaryLabel: string;
  prefs: ScanCardPreferences;
  onBack: () => void;
  onRetry: () => void;
}) {
  const result = analysis?.status === "done" ? analysis.result : null;
  const summary = result ? getSimpleResultSummary(result) : null;
  const title = summary?.title ?? object.name;

  return (
    <section
      aria-live="polite"
      data-testid="focused-object-card"
      className="relative flex min-w-0 flex-col px-4 pb-[max(20px,env(safe-area-inset-bottom))] pt-4 text-white"
    >
      <div className="mx-auto mb-3 h-1 w-10 shrink-0 rounded-full bg-white/18" />

      <button
        type="button"
        data-testid="focused-object-back"
        className="mb-2 inline-flex w-fit max-w-full items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-extrabold text-white/80 transition-colors hover:text-white"
        style={{ border: "1px solid rgba(255,255,255,0.10)", background: "rgba(255,255,255,0.05)" }}
        onClick={onBack}
      >
        <span aria-hidden>←</span>
        <span className="truncate">Back to {primaryLabel}</span>
      </button>

      <div
        className="mb-2 inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-1"
        style={{ background: "rgba(94,147,166,0.08)", border: "1px solid rgba(94,147,166,0.24)" }}
      >
        <span className="block rounded-full" style={{ width: 5, height: 5, background: "var(--electric-300)", flexShrink: 0 }} />
        <span style={{ fontFamily: "var(--font-data)", fontSize: 10, fontWeight: 600, letterSpacing: "0.10em", color: "#86B2C0", textTransform: "uppercase" }}>
          {summary?.eyebrow ?? "Detected object"}
        </span>
      </div>
      <h3 className="text-[18px] font-black leading-tight tracking-[-0.02em]">{title}</h3>

      {object.focusMode !== "crop" && object.isolatedImageBase64
        ? <ItemViewPanel badge="Isolated" imageBase64={object.isolatedImageBase64} label={object.name} />
        : <p className="mt-2 text-xs text-white/70">Selected area shown on the original photo above.</p>}

      <div className="mt-3">
        {!analysis ? <div className="space-y-2 text-sm text-white/80">
          <p>Inspect or correct the selected area above. Another AI analysis uses your normal scan allowance and is shown only in this view.</p>
          <button type="button" className="min-h-11 rounded-lg bg-[var(--ds-accent)] px-3 font-bold text-white" onClick={onRetry}>Analyze selected area</button>
        </div> : analysis.status === "loading" ? (
          <div
            className="flex items-center gap-3 rounded-xl px-3 py-4"
            data-testid="focused-object-loading"
            style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)" }}
          >
            <div className="size-5 shrink-0 animate-spin rounded-full border-2" style={{ borderColor: "rgba(94,147,166,0.2)", borderTopColor: "rgba(94,147,166,0.85)" }} />
            <p className="text-sm font-bold text-white/80">Analyzing {object.name}…</p>
          </div>
        ) : analysis.status === "error" ? (
          <div className="rounded-xl px-3 py-2.5" style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)" }}>
            <p className="mb-1 text-[10px] font-extrabold uppercase tracking-[0.14em] text-white/48">Couldn't analyze</p>
            <p className="text-xs font-semibold leading-5 text-white/78">{analysis.message}</p>
            <button className="mt-2 rounded-full px-3 py-1.5 text-[11px] font-extrabold text-white" style={{ background: "var(--ds-accent)" }} onClick={onRetry} type="button">
              Try again
            </button>
          </div>
        ) : result ? (
          <>
            <IssueLine result={result} variant="scanner" />
            {summary ? <p className="mt-1 text-sm font-semibold leading-5 text-white/76">{getAnswerBody(result, summary)}</p> : null}
            <div className="mt-3">
              <SceneCategoryList result={result} variant="scanner" />
              <ResultDetailSections result={result} variant="scanner" compact={prefs.compactCardsByDefault} />
            </div>
          </>
        ) : null}
      </div>
    </section>
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

function CaptureErrorNotice({ message, onTryAgain }: { message: string; onTryAgain: () => void }) {
  return (
    <div
      className="fixed bottom-[220px] left-1/2 z-20 w-[calc(100%-28px)] max-w-sm -translate-x-1/2 rounded-[18px] p-4 text-center"
      style={{
        background: "rgba(7,16,30,0.94)",
        border: "1px solid rgba(139,169,196,0.20)",
        backdropFilter: "blur(20px)",
        boxShadow: "0 16px 44px rgba(0,0,0,0.50)",
      }}
    >
      <p className="text-sm font-bold" style={{ color: "rgba(255,255,255,0.92)" }}>{message}</p>
      <button
        className="mt-3 w-full rounded-[10px] py-2.5 text-[13px] font-bold text-white"
        style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.16)" }}
        onClick={onTryAgain}
        type="button"
      >
        Try again
      </button>
    </div>
  );
}

function readImageFileAsDataUrl(file: File) {
  // The same three types the file input's accept list and the identify API allow; anything else
  // (GIF, HEIC, SVG...) would be read, quality-checked, then refused by the server.
  if (!UPLOAD_IMAGE_TYPES.includes(file.type)) {
    return Promise.reject(new Error("Choose a JPEG, PNG, or WebP photo."));
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    return Promise.reject(new Error("Choose a photo under 12 MB."));
  }

  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    const timeout = setTimeout(() => {
      reader.abort();
      reject(new Error("Reading this photo stalled. Try selecting it again."));
    }, 15_000);
    reader.onload = () => {
      clearTimeout(timeout);
      const result = reader.result;
      if (typeof result === "string") {
        resolve(result);
        return;
      }

      reject(new Error("Could not read that photo."));
    };
    reader.onerror = () => { clearTimeout(timeout); reject(new Error("Could not read that photo.")); };
    reader.onabort = () => { clearTimeout(timeout); reject(new Error("Reading this photo was interrupted. Select it again.")); };
    reader.readAsDataURL(file);
  });
}

function getReviewRetakeCoach(scan: ScanAnalysisState): ScanQualityCoachState | null {
  const reason = scan.scanQuality?.failureReason;
  if (scan.scanQuality?.accepted === false && (reason === "too_blurry" || reason === "too_dark" || reason === "too_bright" || reason === "lens_covered")) return getScanQualityCoach(reason);
  if (scan.result?.needsBetterPhoto || scan.result?.safetyTriage === "needs_better_photo" || scan.result?.confirmationNeed === "one_more_angle") return getScanQualityCoach("needs_better_photo");
  return null;
}

function getScanQualityCoach(issue: ScanQualityCoachIssue): ScanQualityCoachState {
  switch (issue) {
    case "needs_better_photo":
      return { action: "Show the part from another angle with its label in focus.", issue, progress: "One guided retake", title: "Another angle needed" };
    case "too_dark":
      return {
        action: "A little more light sharpens the read.",
        issue,
        progress: "You're close",
        title: "Add light",
      };
    case "lens_covered":
      return {
        action: "Wipe the lens, then frame the part.",
        issue,
        progress: "You're close",
        title: "Clear the lens",
      };
    case "too_bright":
      return {
        action: "Tilt away from the bright source.",
        issue,
        progress: "You're close",
        title: "Ease the glare",
      };
    case "too_blurry":
      return {
        action: "A still frame reads sharper.",
        issue,
        progress: "You're close",
        title: "Hold steady",
      };
    case "object_too_small":
      return {
        action: "Fill the frame with the part.",
        issue,
        progress: "You're 80% there",
        title: "Move in closer",
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
      case "rate_limit_unavailable":
        return "The photo is saved. Request limits could not be verified. Try again in a minute.";
      case "scan_limit_reached":
        return "The photo is saved. No scan credits are available for this account.";
      case "entitlement_unavailable":
        return "The photo is saved. Scan credits could not be verified. Try again shortly.";
      case "missing_session":
      case "invalid_session":
        return "The photo is saved. Sign in again to continue.";
      case "session_unavailable":
        return "The photo is saved. Your session could not be verified right now. Try again shortly.";
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


function clampNumber(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function ScannerHUD({ isAnalyzing }: { isAnalyzing: boolean }) {
  return (
    <div className="scanner-hud" style={{ top: "max(52px, calc(env(safe-area-inset-top) + 52px))", left: 16 }}>
      <span className="scanner-hud-dot" />
      {isAnalyzing ? "READING" : "READY"}
    </div>
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
        <div className="flex items-center justify-center rounded-full" style={{ width: 86, height: 86, background: "rgba(94,147,166,0.06)", border: "1px solid rgba(94,147,166,0.22)" }}>
          <button
            type="button"
            aria-label="Scan now"
            onClick={onShutter}
            disabled={isShutterDisabled}
            className="grid place-items-center rounded-full disabled:opacity-40"
            style={{
              width: 68,
              height: 68,
              border: "1px solid rgba(94, 147, 166, 0.60)",
              background: "rgba(94, 147, 166, 0.08)",
              color: "#86B2C0",
              boxShadow: "0 0 18px rgba(94,147,166,0.30)",
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
        disabled={isAnalyzing}
        className="grid size-12 place-items-center rounded-full text-white disabled:opacity-40"
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
