import { useState } from "react";
import Webcam from "react-webcam";
import { Link, useNavigate } from "react-router-dom";
import IdentifyButton from "../components/scanner/IdentifyButton";
import MotionPermissionModal from "../components/scanner/MotionPermissionModal";
import Reticle from "../components/scanner/Reticle";
import Button from "../components/ui/Button";
import { useCamera } from "../hooks/useCamera";
import { useStillness } from "../hooks/useStillness";
import { saveLatestScanState } from "../lib/utils";
import { AIServiceError, getAIErrorMessage, identifyCapturedFrame } from "../services/aiService";
import { createLookup } from "../services/storage";
import type { CapturedFrame, ScanAnalysisState } from "../types";

const videoConstraints: MediaTrackConstraints = {
  facingMode: { ideal: "environment" },
  width: { ideal: 1920 },
  height: { ideal: 1080 },
};

export default function Scanner() {
  const navigate = useNavigate();
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const { cameraError, cameraState, captureFrame, markError, markReady, webcamRef } = useCamera();
  const { error: motionError, isStable, needsPermission, permissionState, requestPermission, usesFallback } =
    useStillness();

  const canIdentify = cameraState === "ready" && !isAnalyzing;

  async function handleIdentify() {
    try {
      setIsAnalyzing(true);
      const imageBase64 = await captureFrame();
      const frame: CapturedFrame = {
        imageBase64,
        capturedAt: new Date().toISOString(),
      };
      saveLatestScanState({ frame });

      try {
        const result = await identifyCapturedFrame(frame);
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
      markError(error instanceof Error ? error.message : "Capture failed.");
    } finally {
      setIsAnalyzing(false);
    }
  }

  function persistAndNavigate(scanState: ScanAnalysisState) {
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
        <div className="flex items-center justify-between gap-3">
          <p className="text-[13px] font-extrabold uppercase tracking-[0.18em] text-white/92">Deep Spec</p>
          <div className="flex items-center gap-2">
            <Link to="/early-access" className="rounded-full bg-black/35 px-3 py-2 text-xs font-extrabold text-white/82 backdrop-blur-md">
              Join
            </Link>
            <Link to="/history" className="rounded-full bg-black/35 px-3 py-2 text-xs font-extrabold text-white/82 backdrop-blur-md">
              Saved
            </Link>
          </div>
        </div>
        <p className="mt-2 text-sm font-medium text-white/68">
          {usesFallback
            ? "Manual scan ready. Line up the part first."
            : isStable
              ? "Hold steady and scan the part"
              : "Point at a car part and hold steady"}
        </p>
      </header>

      {cameraState === "blocked" ? <CameraBlocked message={cameraError} /> : null}

      {cameraState !== "blocked" ? (
        <>
          <Reticle isVisible={isStable} />
          <IdentifyButton isDisabled={!canIdentify} isVisible={isStable && cameraState === "ready"} onIdentify={handleIdentify} />

          {usesFallback ? (
            <p className="fixed bottom-[94px] left-1/2 z-20 w-[calc(100%-32px)] -translate-x-1/2 text-center text-xs font-semibold text-white/58">
              {permissionState === "denied" ? "Motion access is off. You can still identify manually." : "Motion sensing unavailable. Manual scan is ready."}
            </p>
          ) : null}

          {needsPermission ? <MotionPermissionModal error={motionError} onAllow={requestPermission} /> : null}
        </>
      ) : null}
      {isAnalyzing ? <AnalyzingOverlay /> : null}
    </main>
  );
}

function CameraBlocked({ message }: { message: string | null }) {
  return (
    <div className="fixed inset-0 z-30 grid place-items-center bg-[#0A0A0A] px-6 text-center">
      <div className="max-w-sm">
        <div className="mx-auto mb-5 grid size-14 place-items-center rounded-2xl border border-[#EF4444]/30 bg-[#EF4444]/10 text-[#EF4444]">
          !
        </div>
        <h1 className="text-2xl font-extrabold tracking-tight">Camera access needed</h1>
        <p className="mt-3 text-sm leading-6 text-[#A1A1AA]">
          Deep Spec needs your camera to scan parts. Enable camera access in browser settings, then reload.
        </p>
        {message ? <p className="mt-3 text-xs text-white/48">{message}</p> : null}
        <Button className="mt-6" onClick={() => window.location.reload()}>
          Reload
        </Button>
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
