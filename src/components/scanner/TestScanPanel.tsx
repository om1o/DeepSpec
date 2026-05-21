import { useState } from "react";
import { useNavigate } from "react-router-dom";
import Button from "../ui/Button";
import { getAIErrorMessage, identifyCapturedFrame } from "../../services/aiService";
import type { CapturedFrame, ScanAnalysisState } from "../../types";

const TEST_ENGINE_IMAGE_URL = "/test-fixtures/engine-scan-test.jpg";
const TEST_VEHICLE_LABEL = "Generated engine bay QA photo";

type Props = {
  onBusyChange: (busy: boolean) => void;
};

async function responseToDataUrl(response: Response): Promise<string> {
  const buffer = await response.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  const mime = response.headers.get("content-type")?.split(";")[0]?.trim() || "image/jpeg";
  return `data:${mime};base64,${btoa(binary)}`;
}

async function loadTestFrame(): Promise<CapturedFrame> {
  const response = await fetch(TEST_ENGINE_IMAGE_URL);
  if (!response.ok) {
    throw new Error("Could not load the test engine photo.");
  }

  return {
    imageBase64: await responseToDataUrl(response),
    capturedAt: new Date().toISOString(),
  };
}

export default function TestScanPanel({ onBusyChange }: Props) {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  async function runTestScan() {
    setError(null);
    onBusyChange(true);

    try {
      const frame = await loadTestFrame();
      let scanState: ScanAnalysisState = { frame, testRun: true };

      try {
        const result = await identifyCapturedFrame(frame);
        scanState = {
          ...scanState,
          result,
          analyzedAt: new Date().toISOString(),
        };
      } catch (analysisError) {
        scanState = {
          ...scanState,
          errorMessage: getAIErrorMessage(analysisError),
          analyzedAt: new Date().toISOString(),
        };
      }

      navigate("/result", {
        state: {
          ...scanState,
          testVehicleLabel: TEST_VEHICLE_LABEL,
        },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Test scan failed.");
    } finally {
      onBusyChange(false);
    }
  }

  return (
    <div className="fixed bottom-[120px] left-4 right-4 z-30 rounded-2xl border border-[var(--ds-accent-line)] bg-slate-950/78 p-4 backdrop-blur-xl">
      <p className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-[var(--ds-accent)]">Test mode</p>
      <p className="mt-1 text-xs leading-5 text-white/72">Runs in memory only. No history or cloud save.</p>
      <Button className="mt-3 w-full" type="button" onClick={() => void runTestScan()}>
        Test engine photo
      </Button>
      {error ? <p className="mt-2 text-xs text-[var(--ds-danger-ink)]">{error}</p> : null}
    </div>
  );
}
