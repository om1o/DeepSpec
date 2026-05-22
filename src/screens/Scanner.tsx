import { useCallback, useEffect, useRef, useState } from "react";
import Webcam from "react-webcam";
import { Link, useLocation } from "react-router-dom";
import IdentifyButton from "../components/scanner/IdentifyButton";
import MotionPermissionModal from "../components/scanner/MotionPermissionModal";
import Reticle from "../components/scanner/Reticle";
import Button from "../components/ui/Button";
import { useCamera } from "../hooks/useCamera";
import { useObjectTarget } from "../hooks/useObjectTarget";
import { useStillness } from "../hooks/useStillness";
import { assessImageQuality } from "../lib/imageQuality";
import { getCachedScanResult, hashImageDataUrl, setCachedScanResult } from "../lib/scanCache";
import { isTestMode } from "../lib/testMode";
import { saveLatestScanState } from "../lib/utils";
import TestScanPanel from "../components/scanner/TestScanPanel";
import { AIServiceError, getAIErrorMessage, identifyCapturedFrame } from "../services/aiService";
import { createLookup } from "../services/storage";
import type { IdentificationResult, CapturedFrame, LabelRescueTrigger, Lookup, ScanAnalysisState } from "../types";

const AUTO_SCAN_HOLD_MS = 5000;
const SECOND_FRAME_DELAY_MS = 120;
const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;

const videoConstraints: MediaTrackConstraints = {
  facingMode: { ideal: "environment" },
  width: { ideal: 1920 },
  height: { ideal: 1080 },
};

type ScanReviewState = {
  lookup: Lookup | null;
  scanState: ScanAnalysisState;
};

export default function Scanner() {
  const location = useLocation();
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisStep, setAnalysisStep] = useState<string | null>(null);
  const [autoScanPaused, setAutoScanPaused] = useState(false);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [scanReview, setScanReview] = useState<ScanReviewState | null>(null);
  const autoScanStartedRef = useRef(false);
  const cancelScanRef = useRef(false);
  const scanRequestIdRef = useRef(0);
  const { cameraError, cameraRequestId, cameraState, captureFrame, markError, markReady, retryCamera, webcamRef } =
    useCamera();
  const { error: motionError, isStable, needsPermission, requestPermission, usesFallback } =
    useStillness();
  const qaTestMode = isTestMode(location.search);
  const objectTarget = useObjectTarget(webcamRef, {
    enabled: cameraState === "ready" && !qaTestMode && !isAnalyzing && !scanReview,
    holdDurationMs: AUTO_SCAN_HOLD_MS,
    holdEnabled: cameraState === "ready" && isStable && !isAnalyzing && !autoScanPaused && !scanReview,
  });
  const targetProgress = objectTarget?.holdProgress ?? 0;
  const hasTargetLock = Boolean(objectTarget?.isLocked);
  const autoScanSeconds = Math.max(1, Math.ceil((1 - targetProgress) * (AUTO_SCAN_HOLD_MS / 1000)));
  const scannerStatus = qaTestMode
    ? "Test scan ready"
    : getScannerStatus({
        autoScanPaused,
        autoScanSeconds,
        cameraState,
        hasTarget: Boolean(objectTarget),
        hasTargetLock,
        isStable,
        scanReview,
        usesFallback,
      });

  const pauseAutoScan = useCallback((message?: string) => {
    autoScanStartedRef.current = false;
    setAutoScanPaused(true);
    if (message) {
      setCaptureError(message);
    }

    window.setTimeout(() => setAutoScanPaused(false), 1800);
  }, []);

  const beginScanRequest = useCallback(() => {
    cancelScanRef.current = false;
    scanRequestIdRef.current += 1;
    return scanRequestIdRef.current;
  }, []);

  const isScanRequestActive = useCallback((requestId: number) => (
    scanRequestIdRef.current === requestId && !cancelScanRef.current
  ), []);

  const persistAndShowReview = useCallback(
    (scanState: ScanAnalysisState) => {
      if (qaTestMode) {
        setScanReview({ lookup: null, scanState: { ...scanState, testRun: true } });
        return;
      }

      const saved = createLookup(scanState);
      if (saved.ok) {
        saveLatestScanState(scanState);
        setScanReview({ lookup: saved.value, scanState });
        return;
      }

      const fallbackState = {
        ...scanState,
        storageWarning: saved.message,
      };
      saveLatestScanState(fallbackState);
      setScanReview({ lookup: null, scanState: fallbackState });
    },
    [qaTestMode],
  );

  const analyzeImageBase64 = useCallback(async (
    imageBase64: string,
    requestId: number,
    secondFrameProvider?: () => Promise<string>,
  ) => {
    setAnalysisStep("Checking photo quality");
    const quality = await assessImageQuality(imageBase64);
    if (!isScanRequestActive(requestId)) return;
    let labelRescueTrigger: LabelRescueTrigger | undefined;
    if (!quality.ok && quality.issue === "too_blurry") {
      labelRescueTrigger = "too_blurry";
    } else if (!quality.ok) {
      pauseAutoScan(quality.message);
      return;
    }

    const frame: CapturedFrame = {
      imageBase64,
      capturedAt: new Date().toISOString(),
    };
    if (!qaTestMode) {
      saveLatestScanState({ frame });
    }

    setAnalysisStep("Checking saved matches");
    const imageHash = !qaTestMode ? await hashImageDataUrl(imageBase64) : null;
    if (!isScanRequestActive(requestId)) return;
    if (imageHash) {
      const cached = getCachedScanResult(imageHash);
      if (cached) {
        setAnalysisStep("Opening review");
        persistAndShowReview({ frame, result: cached, analyzedAt: new Date().toISOString() });
        return;
      }
    }

    let secondFrame: CapturedFrame | undefined;
    if (!qaTestMode && secondFrameProvider) {
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
      const result = await identifyCapturedFrame(frame, secondFrame, labelRescueTrigger);
      if (!isScanRequestActive(requestId)) return;
      if (imageHash) setCachedScanResult(imageHash, result);
      setAnalysisStep("Saving result");
      persistAndShowReview({
        frame,
        result,
        analyzedAt: new Date().toISOString(),
      });
    } catch (analysisError) {
      if (!isScanRequestActive(requestId)) return;
      persistAndShowReview({
        frame,
        errorMessage: getAIErrorMessage(analysisError),
        errorCode: analysisError instanceof AIServiceError ? analysisError.code : "analysis_failed",
        analyzedAt: new Date().toISOString(),
      });
    }
  }, [isScanRequestActive, pauseAutoScan, persistAndShowReview, qaTestMode]);

  const handleIdentify = useCallback(async () => {
    if (isAnalyzing) {
      return;
    }

    const requestId = beginScanRequest();
    try {
      setIsAnalyzing(true);
      setAnalysisStep("Capturing photo");
      setCaptureError(null);
      const imageBase64 = await captureFrame();
      if (!isScanRequestActive(requestId)) return;

      await analyzeImageBase64(imageBase64, requestId, captureFrame);
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
  }, [analyzeImageBase64, beginScanRequest, captureFrame, isAnalyzing, isScanRequestActive, pauseAutoScan]);

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

  useEffect(() => {
    if (!hasTargetLock || cameraState !== "ready" || isAnalyzing || autoScanPaused || scanReview) {
      return;
    }

    if (autoScanStartedRef.current) {
      return;
    }

    autoScanStartedRef.current = true;
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
      navigator.vibrate(12);
    }
    void handleIdentify();
  }, [autoScanPaused, cameraState, handleIdentify, hasTargetLock, isAnalyzing, scanReview]);

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
    pauseAutoScan();
  }

  return (
    <main className="relative min-h-dvh overflow-hidden bg-[var(--ds-bg)] text-white">
      <Webcam
        key={cameraRequestId}
        ref={webcamRef}
        audio={false}
        className="absolute inset-0 h-full w-full object-cover"
        mirrored={false}
        screenshotFormat="image/jpeg"
        screenshotQuality={0.92}
        videoConstraints={videoConstraints}
        onUserMedia={markReady}
        onUserMediaError={markError}
      />
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

      {!qaTestMode && cameraState === "loading" ? <CameraLoading /> : null}
      {!qaTestMode && cameraState === "blocked" ? <CameraBlocked message={cameraError} onRetry={retryCamera} /> : null}

      {cameraState !== "blocked" ? (
        <>
          <Reticle
            isLocked={hasTargetLock}
            isVisible={cameraState === "ready" && !scanReview}
            label={getReticleLabel(Boolean(objectTarget), hasTargetLock, autoScanSeconds)}
            progress={targetProgress}
          />

          {needsPermission ? <MotionPermissionModal error={motionError} onAllow={requestPermission} /> : null}
          {captureError ? <CaptureErrorNotice message={captureError} onTryAgain={() => setCaptureError(null)} /> : null}
        </>
      ) : null}
      {!qaTestMode ? (
        <GalleryScanButton
          isDisabled={isAnalyzing}
          onFileSelected={(file) => void handleGalleryFile(file)}
        />
      ) : null}
      {isAnalyzing ? <AnalyzingOverlay onCancel={cancelCurrentScan} step={analysisStep} /> : null}
      {scanReview ? <ScanReviewSheet onNewScan={closeScanReview} review={scanReview} /> : null}
      {!qaTestMode ? (
        <IdentifyButton
          isDisabled={cameraState !== "ready" || isAnalyzing}
          isReady={cameraState === "ready" && !isAnalyzing && !scanReview && (hasTargetLock || usesFallback || isStable)}
          isVisible={cameraState !== "blocked" && !scanReview}
          onIdentify={() => void handleIdentify()}
        />
      ) : (
        <TestScanPanel
          onBusyChange={setIsAnalyzing}
          onScanComplete={(scanState) => setScanReview({ lookup: null, scanState })}
        />
      )}
    </main>
  );
}

function getScannerStatus({
  autoScanPaused,
  autoScanSeconds,
  cameraState,
  hasTarget,
  hasTargetLock,
  isStable,
  scanReview,
  usesFallback,
}: {
  autoScanPaused: boolean;
  autoScanSeconds: number;
  cameraState: string;
  hasTarget: boolean;
  hasTargetLock: boolean;
  isStable: boolean;
  scanReview: ScanReviewState | null;
  usesFallback: boolean;
}) {
  if (cameraState !== "ready") {
    return "Opening camera";
  }

  if (scanReview) {
    return "Review scan";
  }

  if (autoScanPaused) {
    return "Scan paused";
  }

  if (hasTargetLock) {
    return "Capturing";
  }

  if (hasTarget) {
    return `Auto scan in ${autoScanSeconds}s`;
  }

  if (!usesFallback && !isStable) {
    return "Stabilizing";
  }

  return "Lens ready";
}

function getReticleLabel(hasTarget: boolean, hasTargetLock: boolean, autoScanSeconds: number) {
  if (hasTargetLock) {
    return "Scanning";
  }

  if (hasTarget) {
    return `Hold still ${autoScanSeconds}s`;
  }

  return "Center the part";
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

function CameraBlocked({ message, onRetry }: { message: string | null; onRetry: () => void }) {
  const denied = /denied|notallowed/i.test(message ?? "");

  return (
    <div className="fixed inset-0 z-30 grid place-items-center bg-[var(--ds-bg)] px-6 text-center">
      <div className="max-w-sm">
        <div className="mx-auto mb-5 grid size-14 place-items-center rounded-2xl border border-[var(--ds-danger-line)] bg-[var(--ds-danger-soft)] text-[var(--ds-danger)]">
          !
        </div>
        <h1 className="text-2xl font-extrabold tracking-tight">Camera access needed</h1>
        <p className="mt-3 text-sm leading-6 text-[#A1A1AA]">
          Deep Spec needs your camera to scan parts. {denied ? "Allow camera access for this site, then try again." : "Check camera access, then try again."}
        </p>
        {message ? <p className="mt-3 text-xs text-white/48">{message}</p> : null}
        <Button className="mt-6" onClick={onRetry}>
          Try camera again
        </Button>
        <button className="mt-4 text-xs font-bold text-white/48 underline underline-offset-4" onClick={() => window.location.reload()}>
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
  return (
    <label
      className={`fixed bottom-[112px] left-1/2 z-40 -translate-x-1/2 rounded-full bg-slate-950/62 px-4 py-2 text-xs font-extrabold text-white ring-1 ring-white/14 backdrop-blur-xl transition ${
        isDisabled ? "pointer-events-none opacity-45" : "cursor-pointer opacity-100"
      }`}
    >
      Upload photo
      <input
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
    </label>
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

function ScanReviewSheet({ onNewScan, review }: { onNewScan: () => void; review: ScanReviewState }) {
  const { lookup, scanState } = review;
  const result = scanState.result;
  const capturedAt = scanState.frame.capturedAt ? new Date(scanState.frame.capturedAt).toLocaleString() : null;
  const title = result?.partName ?? (scanState.errorMessage ? "Scan needs retry" : "Captured frame");

  return (
    <section
      aria-labelledby="scan-review-title"
      aria-modal="true"
      className="fixed inset-x-0 bottom-0 z-50 max-h-[78dvh] overflow-hidden rounded-t-[28px] border border-white/12 bg-slate-950/96 text-white shadow-[0_-28px_70px_rgba(0,0,0,0.68)] backdrop-blur-xl"
      role="dialog"
    >
      <div className="mx-auto mt-3 h-1.5 w-12 rounded-full bg-white/28" />
      <div className="no-scrollbar max-h-[calc(78dvh-12px)] overflow-y-auto px-4 pb-[max(20px,env(safe-area-inset-bottom))] pt-4">
        <div className="flex items-start gap-3">
          <img
            alt="Captured car part"
            className="h-20 w-20 shrink-0 rounded-[20px] border border-white/12 object-cover"
            src={scanState.frame.imageBase64}
          />
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-[var(--ds-accent)]">
              {scanState.testRun ? "QA test result" : lookup ? "Saved scan" : "Scan review"}
            </p>
            <h1 id="scan-review-title" className="mt-1 break-words text-2xl font-extrabold tracking-tight">
              {title}
            </h1>
            <div className="mt-2 flex flex-wrap gap-2">
              {result ? (
                <>
                  <ReviewPill label={`${result.confidence} confidence`} tone={result.confidence === "low" ? "warn" : "ok"} />
                  <ReviewPill label={result.scanCategory} />
                  <ReviewPill label={getReviewStatus(result)} tone={result.isSafetyCritical ? "warn" : "ok"} />
                </>
              ) : null}
              {scanState.storageWarning ? <ReviewPill label="Not saved" tone="warn" /> : null}
            </div>
          </div>
        </div>

        {capturedAt ? <p className="mt-3 text-xs font-semibold text-white/46">Captured {capturedAt}</p> : null}
        {scanState.storageWarning ? <ReviewWarning title="Not saved locally" message={scanState.storageWarning} /> : null}

        {result ? (
          <div className="mt-4 space-y-3">
            <ReviewSection title="What this is" items={[result.whatItDoes]} />
            <ReviewSection title="What I see" items={result.visibleObservations} emptyText="No clear visual clues were returned." />
            <ReviewSection title="Concerns" items={result.concerns} emptyText="Nothing concerning visible." />
            <ReviewSection title="Next action" items={[result.nextAction]} />
            <ReviewEvidenceRegions result={result} />
            <ReviewCandidateMatches result={result} />
            <ReviewSources result={result} />
            <ReviewDataset lookup={lookup} result={result} testRun={Boolean(scanState.testRun)} />
          </div>
        ) : scanState.errorMessage ? (
          <ReviewWarning title="AI identification failed" message={scanState.errorMessage} />
        ) : (
          <ReviewWarning title="No AI result" message="Deep Spec kept the captured photo, but this scan has no result attached yet." />
        )}

        <div className="sticky bottom-0 -mx-4 mt-4 grid grid-cols-2 gap-3 border-t border-white/10 bg-slate-950/96 px-4 py-4 backdrop-blur-xl">
          <Button className="!bg-white !text-slate-950 shadow-none" type="button" onClick={onNewScan}>
            New scan
          </Button>
          {lookup ? (
            <Link
              className="rounded-full bg-[var(--ds-accent)] px-5 py-3 text-center text-sm font-bold text-white shadow-sm"
              to={`/result/${lookup.id}`}
            >
              Full report
            </Link>
          ) : (
            <Link
              className="rounded-full bg-[var(--ds-accent)] px-5 py-3 text-center text-sm font-bold text-white shadow-sm"
              to="/history"
            >
              Saved scans
            </Link>
          )}
          {lookup?.result ? (
            <Link
              className="col-span-2 rounded-full border border-white/12 bg-white/10 px-5 py-3 text-center text-sm font-bold text-white"
              to={`/result/${lookup.id}/chat`}
            >
              Ask about this scan
            </Link>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function ReviewPill({ label, tone = "neutral" }: { label: string; tone?: "neutral" | "ok" | "warn" }) {
  const styles = {
    neutral: "border-white/12 bg-white/10 text-white/78",
    ok: "border-[var(--ds-accent-line)] bg-[var(--ds-accent-soft)] text-[#93C5FD]",
    warn: "border-[var(--ds-warn-line)] bg-[var(--ds-warn-soft)] text-[#FCD34D]",
  };

  return (
    <span className={`rounded-full border px-3 py-1 text-xs font-extrabold capitalize ${styles[tone]}`}>
      {label.replaceAll("_", " ")}
    </span>
  );
}

function ReviewWarning({ message, title }: { message: string; title: string }) {
  return (
    <section className="mt-4 rounded-[22px] border border-[var(--ds-warn-line)] bg-[var(--ds-warn-soft)] p-4">
      <p className="text-sm font-extrabold text-[#FCD34D]">{title}</p>
      <p className="mt-2 text-sm leading-6 text-white/76">{message}</p>
    </section>
  );
}

function ReviewSection({ emptyText, items, title }: { emptyText?: string; items: string[]; title: string }) {
  const visibleItems = items.filter(Boolean);

  return (
    <section className="rounded-[22px] border border-white/10 bg-white/[0.06] p-4">
      <h2 className="text-xs font-extrabold uppercase tracking-[0.14em] text-white/48">{title}</h2>
      {visibleItems.length > 0 ? (
        <ul className="mt-3 space-y-2 text-sm leading-6 text-white/86">
          {visibleItems.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm leading-6 text-white/58">{emptyText}</p>
      )}
    </section>
  );
}

function ReviewEvidenceRegions({ result }: { result: IdentificationResult }) {
  if (!result.evidenceRegions.length) {
    return null;
  }

  return (
    <section className="rounded-[22px] border border-white/10 bg-white/[0.06] p-4">
      <h2 className="text-xs font-extrabold uppercase tracking-[0.14em] text-white/48">Image evidence</h2>
      <div className="mt-3 grid grid-cols-1 gap-2">
        {result.evidenceRegions.map((region) => (
          <div key={`${region.regionLabel}-${region.label}`} className="rounded-2xl border border-[var(--ds-evidence-line)] bg-[var(--ds-evidence-soft)] px-3 py-3">
            <p className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-[#93C5FD]">{region.regionLabel}</p>
            <p className="mt-1 text-sm font-extrabold text-white">{region.label}</p>
            <p className="mt-1 text-sm leading-5 text-white/72">{region.observation}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function ReviewCandidateMatches({ result }: { result: IdentificationResult }) {
  if (!result.candidateMatches.length) {
    return null;
  }

  return (
    <section className="rounded-[22px] border border-white/10 bg-white/[0.06] p-4">
      <h2 className="text-xs font-extrabold uppercase tracking-[0.14em] text-white/48">Other possible matches</h2>
      <div className="mt-3 grid grid-cols-1 gap-2">
        {result.candidateMatches.map((candidate) => (
          <div key={`${candidate.partName}-${candidate.reason}`} className="rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-extrabold text-white">{candidate.partName}</p>
              <ReviewPill label={candidate.confidence} tone={candidate.confidence === "low" ? "warn" : "ok"} />
            </div>
            <p className="mt-1 text-xs font-semibold capitalize text-white/42">{candidate.scanCategory}</p>
            <p className="mt-2 text-sm leading-5 text-white/72">{candidate.reason}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function ReviewSources({ result }: { result: IdentificationResult }) {
  const links = result.sourceLinks.filter((link) => /^https:\/\//.test(link.url)).slice(0, 4);
  if (!links.length) {
    return null;
  }

  return (
    <section className="rounded-[22px] border border-white/10 bg-white/[0.06] p-4">
      <h2 className="text-xs font-extrabold uppercase tracking-[0.14em] text-white/48">Sources</h2>
      <div className="mt-3 grid grid-cols-1 gap-2">
        {links.map((link) => (
          <a
            key={link.url}
            className="rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-3 text-sm font-bold leading-5 text-[#93C5FD]"
            href={link.url}
            rel="noreferrer"
            target="_blank"
          >
            {link.label}
            <span aria-hidden="true" className="mt-1 block text-[11px] font-extrabold uppercase tracking-[0.12em] text-white/38">
              {link.sourceType}
            </span>
          </a>
        ))}
      </div>
    </section>
  );
}

function ReviewDataset({
  lookup,
  result,
  testRun,
}: {
  lookup: Lookup | null;
  result: IdentificationResult;
  testRun: boolean;
}) {
  const rows = [
    ["Dataset category", lookup?.scanCategory ?? result.scanCategory],
    ["Training label", lookup?.trainingLabel ?? result.partName],
    ["Review status", lookup?.trainingStatus?.replaceAll("_", " ") ?? (testRun ? "test run only" : "not saved")],
  ];

  return (
    <section className="rounded-[22px] border border-white/10 bg-white/[0.06] p-4">
      <h2 className="text-xs font-extrabold uppercase tracking-[0.14em] text-white/48">Saved data</h2>
      <div className="mt-3 grid grid-cols-1 gap-2">
        {rows.map(([label, value]) => (
          <div key={label} className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
            <p className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-white/38">{label}</p>
            <p className="mt-1 text-sm font-semibold capitalize leading-6 text-white/82">{value}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function getReviewStatus(result: IdentificationResult) {
  if (result.safetyTriage === "needs_professional" || result.isSafetyCritical) {
    return "Professional check";
  }

  if (result.safetyTriage === "needs_better_photo" || result.needsBetterPhoto) {
    return "Better photo needed";
  }

  return "Useful match";
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
