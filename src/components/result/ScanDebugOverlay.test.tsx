import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ScanDebugOverlay } from "./ScanDebugOverlay";

describe("ScanDebugOverlay", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("renders nothing when VITE_DEEPSPEC_DEBUG is off", () => {
    vi.stubEnv("VITE_DEEPSPEC_DEBUG", "off");
    const { container } = render(<ScanDebugOverlay info={{ webgpu: true, segmenter: "SAM" }} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the diagnostics and a copy button when enabled", () => {
    vi.stubEnv("VITE_DEEPSPEC_DEBUG", "on");
    render(
      <ScanDebugOverlay
        info={{ webgpu: true, segmenter: "SAM", focusMode: "mask", samLoadMs: 1200, samInferenceMs: 800, samOk: true }}
      />,
    );
    const overlay = screen.getByTestId("scan-debug-overlay");
    expect(overlay).toHaveTextContent("WebGPU");
    expect(overlay).toHaveTextContent("Segmenter");
    expect(overlay).toHaveTextContent("SAM");
    expect(overlay).toHaveTextContent("800 ms");
    expect(screen.getByRole("button", { name: /Copy diagnostics/ })).toBeInTheDocument();
  });

  it("still renders (with placeholders + WebGPU) when enabled before any scan", () => {
    vi.stubEnv("VITE_DEEPSPEC_DEBUG", "on");
    render(<ScanDebugOverlay />);
    const overlay = screen.getByTestId("scan-debug-overlay");
    expect(overlay).toHaveTextContent("WebGPU");
    expect(overlay).toHaveTextContent("scan to see");
    expect(screen.getByRole("button", { name: /Copy diagnostics/ })).toBeInTheDocument();
  });

  it("shows an explicit SAM geometry verdict when target and mask boxes are present", () => {
    vi.stubEnv("VITE_DEEPSPEC_DEBUG", "on");
    render(
      <ScanDebugOverlay
        info={{
          webgpu: true,
          segmenter: "SAM",
          samFrameDims: "1280x720",
          samModelDims: "1280x720",
          samTargetBoxNorm: "0.400,0.400,0.300,0.300",
          samMaskBoxNorm: "0.445,0.454,0.121,0.213",
          samMaskCoverage: 0.008,
        }}
      />,
    );

    expect(screen.getByTestId("scan-debug-overlay")).toHaveTextContent("SAM verdict");
    expect(screen.getByTestId("scan-debug-overlay")).toHaveTextContent("mask overlaps target");
  });

  it("shows a dimension mismatch verdict before mask boxes are available", () => {
    vi.stubEnv("VITE_DEEPSPEC_DEBUG", "on");
    render(
      <ScanDebugOverlay
        info={{
          webgpu: true,
          segmenter: "SAM",
          samFrameDims: "1280x720",
          samModelDims: "720x1280",
        }}
      />,
    );

    expect(screen.getByTestId("scan-debug-overlay")).toHaveTextContent("frame/model dims mismatch");
  });
});
