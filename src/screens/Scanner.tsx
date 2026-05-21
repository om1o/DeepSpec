import { useCallback, useEffect, useRef, useState } from "react";
import Webcam from "react-webcam";
import { Link, useNavigate } from "react-router-dom";
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
import type { CapturedFrame, LabelRescueTrigger, ScanAnalysisState } from "../types";

const AUTO_SCAN_HOLD_MS = 5000;
const SECOND_FRAME_DELAY_MS = 120;

const videoConstraints: MediaTrackConstraints = {
  facingMode: { ideal: "environment" },
  width: { ideal: 1920 },
  height: { ideal: 1080 },
};

export default function Scanner() {
  const navigate = useNavigate();
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisStep, setAnalysisStep] = useState<string | null>(null);
  const [autoScanPaused, setAutoScanPaused] = useState(false);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const autoScanStartedRef = useRef(false);
  const cancelScanRef = useRef(false);
  const { cameraError, cameraRequestId, cameraState, captureFrame, markError, markReady, retryCamera, webcamRef } =
    useCamera();
  const { error: motionError, isStable, needsPermission, requestPermission, usesFallback } =
    useStillness();
  const qaTestMode = isTestMode();
  const objectTarget = useObjectTarget(webcamRef, {
    enabled: cameraState === "ready" && !qaTestMode && !isAnalyzing,
    holdDurationMs: AUTO_SCAN_HOLD_MS,
    holdEnabled: cameraState === "ready" && isStable && !isAnalyzing && !autoScanPaused,
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

  const persistAndNavigate = useCallback(
    (scanState: ScanAnalysisState) => {
      if (qaTestMode) {
        navigate("/result", { state: { ...scanState, testRun: true } });
        return;
      }

      const saved = createLookup(scanState);
      if (saved.ok) {
        saveLatestScanState(scanState);
        navigate(`/result/${saved.value.id}`, { state: scanState });
        return;
      }

      const fallbackState = {
        ...scanState,
        storageWarning: saved.message,
      };
      saveLatestScanState(fallbackState);
      navigate("/result", { state: fallbackState });
    },
    [navigate, qaTestMode],
  );

  const handleIdentify = useCallback(async () => {
    if (isAnalyzing) {
      return;
    }

    try {
      cancelScanRef.current = false;
      setIsAnalyzing(true);
      setAnalysisStep("Capturing photo");
      setCaptureError(null);
      const imageBase64 = await captureFrame();
      if (cancelScanRef.current) return;

      setAnalysisStep("Checking photo quality");
      const quality = await assessImageQuality(imageBase64);
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
      if (cancelScanRef.current) return;
      if (imageHash) {
        const cached = getCachedScanResult(imageHash);
        if (cached) {
          setAnalysisStep("Opening result");
          persistAndNavigate({ frame, result: cached, analyzedAt: new Date().toISOString() });
          return;
        }
      }

      let secondFrame: CapturedFrame | undefined;
      if (!qaTestMode) {
        await new Promise<void>((resolve) => setTimeout(resolve, SECOND_FRAME_DELAY_MS));
        if (cancelScanRef.current) return;
        try {
          const second = await captureFrame();
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
        if (cancelScanRef.current) return;
        if (imageHash) setCachedScanResult(imageHash, result);
        setAnalysisStep("Saving result");
        persistAndNavigate({
          frame,
          result,
          analyzedAt: new Date().toISOString(),
        });
      } catch (analysisError) {
        if (cancelScanRef.current) return;
        persistAndNavigate({
          frame,
          errorMessage: getAIErrorMessage(analysisError),
          errorCode: analysisError instanceof AIServiceError ? analysisError.code : "analysis_failed",
          analyzedAt: new Date().toISOString(),
        });
      }
    } catch (error) {
      pauseAutoScan(error instanceof Error ? error.message : "Capture failed. Try again.");
    } finally {
      setIsAnalyzing(false);
      setAnalysisStep(null);
    }
  }, [captureFrame, isAnalyzing, pauseAutoScan, persistAndNavigate, qaTestMode]);

  useEffect(() => {
    if (!hasTargetLock || cameraState !== "ready" || isAnalyzing || autoScanPaused) {
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
  }, [autoScanPaused, cameraState, handleIdentify, hasTargetLock, isAnalyzing]);

  useEffect(() => {
    if (!hasTargetLock && !isAnalyzing) {
      autoScanStartedRef.current = false;
    }
  }, [hasTargetLock, isAnalyzing]);

  function cancelCurrentScan() {
    cancelScanRef.current = true;
    setIsAnalyzing(false);
    setAnalysisStep(null);
    pauseAutoScan("Scan canceled. Hold the right item steady to try again.");
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
            isVisible={cameraState === "ready"}
            label={getReticleLabel(Boolean(objectTarget), hasTargetLock, autoScanSeconds)}
            progress={targetProgress}
          />

          {needsPermission ? <MotionPermissionModal error={motionError} onAllow={requestPermission} /> : null}
          {captureError ? <CaptureErrorNotice message={captureError} onTryAgain={() => setCaptureError(null)} /> : null}
        </>
      ) : null}
      {isAnalyzing ? <AnalyzingOverlay onCancel={cancelCurrentScan} step={analysisStep} /> : null}
      {!qaTestMode ? (
        <IdentifyButton
          isDisabled={cameraState !== "ready" || isAnalyzing}
          isReady={cameraState === "ready" && !isAnalyzing && (hasTargetLock || usesFallback || isStable)}
          isVisible={cameraState !== "blocked"}
          onIdentify={() => void handleIdentify()}
        />
      ) : (
        <TestScanPanel onBusyChange={setIsAnalyzing} />
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
  usesFallback,
}: {
  autoScanPaused: boolean;
  autoScanSeconds: number;
  cameraState: string;
  hasTarget: boolean;
  hasTargetLock: boolean;
  isStable: boolean;
  usesFallback: boolean;
}) {
  if (cameraState !== "ready") {
    return "Opening camera";
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
