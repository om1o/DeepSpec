import { useState } from "react";
import Webcam from "react-webcam";
import { Link, useNavigate } from "react-router-dom";
import IdentifyButton from "../components/scanner/IdentifyButton";
import MotionPermissionModal from "../components/scanner/MotionPermissionModal";
import Reticle from "../components/scanner/Reticle";
import Button from "../components/ui/Button";
import { useCamera } from "../hooks/useCamera";
import { useStillness } from "../hooks/useStillness";
import { assessImageQuality } from "../lib/imageQuality";
import { getCachedScanResult, hashImageDataUrl, setCachedScanResult } from "../lib/scanCache";
import { isTestMode } from "../lib/testMode";
import { saveLatestScanState } from "../lib/utils";
import TestScanPanel from "../components/scanner/TestScanPanel";
import { AIServiceError, getAIErrorMessage, identifyCapturedFrame } from "../services/aiService";
import { createLookup } from "../services/storage";
import type { CapturedFrame, LabelRescueTrigger, ScanAnalysisState } from "../types";

const videoConstraints: MediaTrackConstraints = {
  facingMode: { ideal: "environment" },
  width: { ideal: 1920 },
  height: { ideal: 1080 },
};

export default function Scanner() {
  const navigate = useNavigate();
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const { cameraError, cameraRequestId, cameraState, captureFrame, markError, markReady, retryCamera, webcamRef } =
    useCamera();
  const { error: motionError, isStable, needsPermission, permissionState, requestPermission, usesFallback } =
    useStillness();

  const canIdentify = cameraState === "ready" && !isAnalyzing;

  async function handleIdentify() {
    try {
      setIsAnalyzing(true);
      setCaptureError(null);
      const imageBase64 = await captureFrame();

      const quality = await assessImageQuality(imageBase64);
      let labelRescueTrigger: LabelRescueTrigger | undefined;
      if (!quality.ok && quality.issue === "too_blurry") {
        labelRescueTrigger = "too_blurry";
      } else if (!quality.ok) {
        setCaptureError(quality.message);
        return;
      }

      const frame: CapturedFrame = {
        imageBase64,
        capturedAt: new Date().toISOString(),
      };
      if (!isTestMode()) {
        saveLatestScanState({ frame });
      }

      // Cache check — same image seen before → skip AI entirely
      const imageHash = !isTestMode() ? await hashImageDataUrl(imageBase64) : null;
      if (imageHash) {
        const cached = getCachedScanResult(imageHash);
        if (cached) {
          persistAndNavigate({ frame, result: cached, analyzedAt: new Date().toISOString() });
          return;
        }
      }

      // Silently capture a second frame 300ms later for confidence anchoring.
      // The overlay is showing and the user is likely still holding steady.
      let secondFrame: CapturedFrame | undefined;
      if (!isTestMode()) {
        await new Promise<void>((r) => setTimeout(r, 300));
        try {
          const second = await captureFrame();
          const secondQuality = await assessImageQuality(second);
          if (secondQuality.ok) {
            secondFrame = { imageBase64: second, capturedAt: new Date().toISOString() };
          }
        } catch {
          // Second frame is optional — any failure is silent
        }
      }

      try {
        const result = await identifyCapturedFrame(frame, secondFrame, labelRescueTrigger);
        if (imageHash) setCachedScanResult(imageHash, result);
        const scanState: ScanAnalysisState = {
          frame,
          result,
          analyzedAt: new Date().toISOString(),
        };
        persistAndNavigate(scanState);
      } catch (analysisError) {
        const scanState: ScanAnalysisState = {
          frame,
          errorMessage: getAIErrorMessage(analysisError),
          errorCode: analysisError instanceof AIServiceError ? analysisError.code : "analysis_failed",
          analyzedAt: new Date().toISOString(),
        };
        persistAndNavigate(scanState);
      }
    } catch (error) {
      // Don't mark camera as blocked — captureFrame can fail transiently when
      // the video frame isn't ready yet. Show a retry prompt instead.
      setCaptureError(error instanceof Error ? error.message : "Capture failed. Try again.");
    } finally {
      setIsAnalyzing(false);
    }
  }

  function persistAndNavigate(scanState: ScanAnalysisState) {
    if (isTestMode()) {
      navigate("/result", { state: { ...scanState, testRun: true } });
      return;
    }

    const storageResult = createLookup(scanState);
    const routeState = storageResult.ok
      ? scanState
      : {
          ...scanState,
          storageWarning: storageResult.message,
        };

    saveLatestScanState(routeState);
    navigate(storageResult.ok ? `/result/${storageResult.value.id}` : "/result", { state: routeState });
  }

  return (
    <main className="relative min-h-dvh overflow-hidden bg-[#0A0A0A] text-white">
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

      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_bottom,rgba(0,0,0,0.52),rgba(0,0,0,0)_28%,rgba(0,0,0,0)_62%,rgba(0,0,0,0.62))]" />

      <header className="fixed left-0 right-0 top-0 z-20 px-5 pt-[max(18px,env(safe-area-inset-top))]">
        <div className="grid grid-cols-[44px_1fr_44px] items-center gap-3">
          <Link
            to="/history"
            aria-label="Saved scans"
            className="grid size-11 place-items-center rounded-full bg-black/38 text-xs font-black text-white ring-1 ring-white/10 backdrop-blur-xl"
          >
            DS
          </Link>
          <div className="rounded-full bg-black/34 px-4 py-2 text-center ring-1 ring-white/10 backdrop-blur-xl">
            <p className="text-[13px] font-extrabold tracking-tight text-white">Deep Spec</p>
            <p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-[#FACC15]">AI part scanner</p>
          </div>
          <Link
            to="/early-access"
            aria-label="Early access"
            className="grid size-11 place-items-center rounded-full bg-black/38 text-lg font-black leading-none text-white ring-1 ring-white/10 backdrop-blur-xl"
          >
            +
          </Link>
        </div>
        <p className="mx-auto mt-3 w-fit rounded-full bg-black/28 px-3 py-2 text-center text-xs font-extrabold text-white/72 ring-1 ring-white/10 backdrop-blur-xl">
          {usesFallback
            ? "Manual scan ready. Line up the part first."
            : isStable
              ? "Hold steady and scan the part"
              : "Point at a car part and hold steady"}
        </p>
      </header>

      {cameraState === "blocked" ? <CameraBlocked message={cameraError} onRetry={retryCamera} /> : null}

      {cameraState !== "blocked" ? (
        <>
          <Reticle isVisible={isStable} />
          <IdentifyButton isDisabled={!canIdentify} isReady={isStable} isVisible={cameraState === "ready"} onIdentify={handleIdentify} />

          {usesFallback ? (
            <p className="fixed bottom-[96px] left-1/2 z-20 w-[calc(100%-32px)] -translate-x-1/2 text-center text-xs font-semibold text-white/62">
              {permissionState === "denied" ? "Motion access is off. You can still identify manually." : "Motion sensing unavailable. Manual scan is ready."}
            </p>
          ) : null}

          {needsPermission ? <MotionPermissionModal error={motionError} onAllow={requestPermission} /> : null}
          {captureError ? (
            <p className="fixed bottom-[96px] left-1/2 z-20 w-[calc(100%-32px)] -translate-x-1/2 rounded-2xl bg-[#EF4444]/20 px-4 py-2 text-center text-xs font-semibold text-[#FCA5A5] ring-1 ring-[#EF4444]/20">
              {captureError}
            </p>
          ) : null}
        </>
      ) : null}
      {isAnalyzing ? <AnalyzingOverlay /> : null}
      {isTestMode() ? <TestScanPanel onBusyChange={setIsAnalyzing} /> : null}
    </main>
  );
}

function CameraBlocked({ message, onRetry }: { message: string | null; onRetry: () => void }) {
  const denied = /denied|notallowed/i.test(message ?? "");

  return (
    <div className="fixed inset-0 z-30 grid place-items-center bg-[#0A0A0A] px-6 text-center">
      <div className="max-w-sm">
        <div className="mx-auto mb-5 grid size-14 place-items-center rounded-2xl border border-[#EF4444]/30 bg-[#EF4444]/10 text-[#EF4444]">
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

function AnalyzingOverlay() {
  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/70 backdrop-blur-md">
      <div className="rounded-full border border-white/10 bg-white/10 px-5 py-3 text-sm font-bold text-white shadow-2xl">
        Analyzing photo...
      </div>
    </div>
  );
}
