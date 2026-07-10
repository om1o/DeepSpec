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
});
