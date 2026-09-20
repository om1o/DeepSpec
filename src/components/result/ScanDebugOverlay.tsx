import { useEffect, useState } from "react";
import type { ScanDebugInfo } from "../../types";
import { getScanDebug, isScanDebugEnabled } from "../../lib/scanDebug";
import { getSamGeometryVerdict } from "../../lib/scanDebugGeometry";
import { supportsWebGpu } from "../../lib/webgpu";

/**
 * Dev-only on-screen readout of the isolation diagnostics (gated by VITE_DEEPSPEC_DEBUG=on),
 * so the segmenter / WebGPU / timing info can be read on any device without a console.
 * Renders as soon as debug is enabled — it checks WebGPU itself, so the status is visible even
 * before the first scan — and a one-tap copy button. Falls back to the shared collector if the
 * per-scan info isn't threaded in.
 *
 * Collapsed by default to a one-line pill (the SAM verdict + Copy): expanded, the table covers
 * roughly the top half of a phone screen and hid the part label and scene chips underneath it.
 */
export function ScanDebugOverlay({ info }: { info?: ScanDebugInfo }) {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [webgpu, setWebgpu] = useState<boolean | undefined>(undefined);
  const enabled = isScanDebugEnabled();
  const providedWebgpu = info?.webgpu;

  useEffect(() => {
    if (!enabled || providedWebgpu !== undefined || import.meta.env.MODE === "test") {
      return;
    }
    let active = true;
    void supportsWebGpu().then((value) => {
      if (active) {
        setWebgpu(value);
      }
    });
    return () => {
      active = false;
    };
  }, [enabled, providedWebgpu]);

  if (!enabled) {
    return null;
  }

  const data = info ?? getScanDebug();
  const webgpuValue = data.webgpu ?? webgpu;
  const scanned = data.segmenter !== undefined || data.samInferenceMs !== undefined || data.focusMode !== undefined;

  const yesNo = (value?: boolean) => (value === undefined ? "checking…" : value ? "yes" : "no");
  const ms = (value?: number) => (typeof value === "number" ? `${value} ms` : "—");
  const rows: [string, string][] = [
    ["WebGPU", webgpuValue === undefined ? "checking…" : webgpuValue ? "yes" : "no"],
    ["Segmenter", data.segmenter ?? (scanned ? "—" : "scan to see")],
    ["focusMode", data.focusMode ?? "—"],
    ["SAM load", ms(data.samLoadMs)],
    ["SAM inference", ms(data.samInferenceMs)],
    ["SAM ok", yesNo(data.samOk)],
    ["SAM error", data.samError ?? "—"],
  ];
  // Cold-time breakdown (model vs post) + output shape, shown only once a SAM inference logged them.
  if (data.samModelMs !== undefined || data.samPostMs !== undefined || data.samMaskDims !== undefined) {
    rows.push(
      ["SAM model", ms(data.samModelMs)],
      ["SAM post", ms(data.samPostMs)],
      ["SAM masks", data.samMaskDims ?? "—"],
    );
  }
  // Geometry diagnostics: where we told SAM to look vs. what it actually saw and found — lets a
  // wrong/tiny cutout be traced to "SAM found the wrong area" vs. a decode/scaling mismatch.
  let geometryVerdict: string | undefined;
  if (data.samFrameDims !== undefined || data.samModelDims !== undefined) {
    geometryVerdict = getSamGeometryVerdict({
      frameDims: data.samFrameDims,
      modelDims: data.samModelDims,
      targetBoxNorm: data.samTargetBoxNorm,
      maskBoxNorm: data.samMaskBoxNorm,
    });
    rows.push(
      ["SAM frame dims", data.samFrameDims ?? "—"],
      ["SAM model dims", data.samModelDims ?? "—"],
      ["SAM verdict", geometryVerdict],
    );
  }
  if (data.samTargetBoxNorm !== undefined || data.samMaskBoxNorm !== undefined) {
    rows.push(
      ["SAM target box", data.samTargetBoxNorm ?? "—"],
      ["SAM mask box", data.samMaskBoxNorm ?? "—"],
      ["SAM mask coverage", data.samMaskCoverage !== undefined ? `${(data.samMaskCoverage * 100).toFixed(1)}%` : "—"],
    );
  }
  const summary = geometryVerdict ?? (data.samError ? "SAM error" : data.segmenter ?? (scanned ? "—" : "scan to see"));
  const text = `DeepSpec isolation diagnostics\n${rows.map(([key, value]) => `${key}: ${value}`).join("\n")}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div
      data-testid="scan-debug-overlay"
      data-expanded={expanded}
      className="fixed left-2 top-[max(12px,env(safe-area-inset-top))] z-[70] max-w-[80vw] rounded-xl border border-[var(--ds-scan-dim)] bg-slate-950/85 p-2 font-mono text-[11px] leading-5 text-[var(--electric-200)] shadow-[0_14px_34px_rgba(0,0,0,0.5)] backdrop-blur"
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
          className="flex min-w-0 items-center gap-1.5 text-left font-bold tracking-wide text-[var(--electric-300)]"
        >
          <span aria-hidden>{expanded ? "▾" : "▸"}</span>
          <span className="shrink-0">DEBUG</span>
          <span className="truncate font-normal text-white">{summary}</span>
        </button>
        <button
          type="button"
          onClick={copy}
          className="shrink-0 rounded-md border border-[var(--ds-scan-dim)] bg-[var(--ds-scan-soft)] px-2 py-1 text-[11px] font-bold text-[var(--electric-200)]"
        >
          {copied ? "Copied ✓" : "Copy diagnostics"}
        </button>
      </div>
      {expanded ? (
        <table className="mt-1 block max-h-[55dvh] overflow-y-auto">
          <tbody>
            {rows.map(([key, value]) => (
              <tr key={key}>
                <td className="pr-3 align-top text-white/55">{key}</td>
                <td className="break-all text-white">{value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}
