import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

  it("starts collapsed to a one-line summary with the copy button, so it doesn't cover the scan labels", () => {
    vi.stubEnv("VITE_DEEPSPEC_DEBUG", "on");
    render(<ScanDebugOverlay info={{ webgpu: true, segmenter: "SAM", samLoadMs: 1200 }} />);
    const overlay = screen.getByTestId("scan-debug-overlay");
    expect(overlay).toHaveAttribute("data-expanded", "false");
    expect(overlay).toHaveTextContent("SAM");
    expect(overlay).not.toHaveTextContent("WebGPU");
    expect(screen.getByRole("button", { name: /Copy diagnostics/ })).toBeInTheDocument();
  });

  it("shows the diagnostics and a copy button when enabled and expanded", async () => {
    vi.stubEnv("VITE_DEEPSPEC_DEBUG", "on");
    render(
      <ScanDebugOverlay
        info={{ webgpu: true, segmenter: "SAM", focusMode: "mask", samLoadMs: 1200, samInferenceMs: 800, samOk: true }}
      />,
    );
    await userEvent.click(screen.getByRole("button", { expanded: false }));
    const overlay = screen.getByTestId("scan-debug-overlay");
    expect(overlay).toHaveTextContent("WebGPU");
    expect(overlay).toHaveTextContent("Segmenter");
    expect(overlay).toHaveTextContent("SAM");
    expect(overlay).toHaveTextContent("800 ms");
    expect(screen.getByRole("button", { name: /Copy diagnostics/ })).toBeInTheDocument();
  });

  it("still renders (with placeholders + WebGPU) when enabled before any scan", async () => {
    vi.stubEnv("VITE_DEEPSPEC_DEBUG", "on");
    render(<ScanDebugOverlay />);
    expect(screen.getByTestId("scan-debug-overlay")).toHaveTextContent("scan to see");
    await userEvent.click(screen.getByRole("button", { expanded: false }));
    const overlay = screen.getByTestId("scan-debug-overlay");
    expect(overlay).toHaveTextContent("WebGPU");
    expect(overlay).toHaveTextContent("scan to see");
    expect(screen.getByRole("button", { name: /Copy diagnostics/ })).toBeInTheDocument();
  });

  it("shows an explicit SAM geometry verdict when target and mask boxes are present", async () => {
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

    // The verdict is the collapsed summary; the labelled row appears once expanded.
    expect(screen.getByTestId("scan-debug-overlay")).toHaveTextContent("mask overlaps target");
    await userEvent.click(screen.getByRole("button", { expanded: false }));
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
