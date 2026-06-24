import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, expect, vi } from "vitest";
import Scanner from "./Scanner";

const createRealElement = document.createElement.bind(document);
const captureFrame = vi.fn(async () => "data:image/jpeg;base64,compressed-frame");
const retryCamera = vi.fn();
const switchCamera = vi.fn();
const assessImageQuality = vi.fn(async () => ({ ok: true }));
const passingQuality = {
  metrics: {
    averageLuminance: 126,
    brightPixelRatio: 0.01,
    brightnessScore: 98,
    darkPixelRatio: 0,
    glareScore: 95,
    gradientVariance: 240,
    sampleHeight: 72,
    sampleWidth: 96,
    sharpnessScore: 100,
  },
  ok: true,
};
const createFocusedScanCrop = vi.fn(async () => "data:image/jpeg;base64,target-crop");
const createSegmentedProductIsolation = vi.fn(async () => null);
const detectObjectTargetFromImageData = vi.fn(() => null);
const getCloudSyncStatus = vi.fn(() => ({ configured: false, message: "Cloud sync is off." }));
const syncLookupToCloud = vi.fn(async () => ({ ok: true, message: "Scan synced." }));
const identifyCapturedFrame = vi.fn(async () => ({
  partName: "Alternator",
  confidence: "high",
  scanCategory: "electrical",
  candidateMatches: [
    {
      partName: "Starter motor",
      confidence: "low",
      scanCategory: "electrical",
      reason: "Engine bay electrical component, but the pulley favors alternator.",
    },
  ],
  whatItDoes: "It charges the battery while the engine runs.",
  visibleObservations: ["Belt-driven metal housing is visible."],
  evidenceRegions: [
    {
      label: "Pulley",
      observation: "Belt-driven pulley is visible.",
      regionLabel: "Scanned area",
    },
  ],
  concerns: [],
  safetyTriage: "can_help",
  isSafetyCritical: false,
  nextAction: "Compare the scan with another angle if you need more detail.",
  needsBetterPhoto: false,
  evidence: ["The pulley and housing match common alternator shapes."],
  sourceLinks: [
    {
      label: "Search this part",
      url: "https://www.google.com/search?q=Alternator%20car%20part",
      sourceType: "search",
    },
  ],
}));
const objectTargetState = vi.hoisted(() => ({
  current: null as null | {
    confidence: number;
    height: number;
    holdProgress: number;
    id: string;
    isLocked: boolean;
    left: number;
    normalized?: {
      height: number;
      width: number;
      x: number;
      y: number;
    };
    top: number;
    width: number;
  },
}));
const objectTargetOptions = vi.hoisted(() => ({
  latest: null as null | { enabled: boolean; holdDurationMs?: number; holdEnabled: boolean },
}));
const cameraHookState = vi.hoisted(() => ({
  current: {
    cameraError: null as string | null,
    cameraRequestId: 0,
    cameraState: "ready" as "loading" | "ready" | "blocked",
  },
}));

vi.mock("../hooks/useCamera", () => ({
  useCamera: () => ({
    cameraDevices: [],
    cameraFacingMode: "environment",
    cameraRequestId: cameraHookState.current.cameraRequestId,
    cameraError: cameraHookState.current.cameraError,
    cameraState: cameraHookState.current.cameraState,
    captureFrame,
    markError: vi.fn(),
    markReady: vi.fn(),
    retryCamera,
    selectCamera: vi.fn(),
    switchCamera,
    selectedCameraId: "",
    webcamRef: { current: null },
  }),
}));

vi.mock("../hooks/useStillness", () => ({
  useStillness: () => ({
    error: null,
    isStable: true,
    needsPermission: false,
    permissionState: "unsupported",
    requestPermission: vi.fn(),
    usesFallback: true,
  }),
}));

vi.mock("../hooks/useObjectTarget", () => ({
  useObjectTarget: (_webcamRef: unknown, options: { enabled: boolean; holdDurationMs?: number; holdEnabled: boolean }) => {
    objectTargetOptions.latest = options;
    return objectTargetState.current;
  },
}));

vi.mock("react-webcam", () => ({
  default: () => <div data-testid="webcam-preview" />,
}));

vi.mock("../services/aiService", () => ({
  AIServiceError: class AIServiceError extends Error {
    code = "test";
  },
  getAIErrorMessage: (error: unknown) => (error instanceof Error ? error.message : "AI failed"),
  identifyCapturedFrame: (...args: unknown[]) => identifyCapturedFrame(...args),
}));

vi.mock("../services/cloudSync", () => ({
  getCloudSyncStatus: () => getCloudSyncStatus(),
  syncLookupToCloud: (...args: unknown[]) => syncLookupToCloud(...args),
}));

// Pass all images as ok - quality logic is tested separately in imageQuality.test.ts
vi.mock("../lib/imageQuality", () => ({
  assessImageQuality: (...args: unknown[]) => assessImageQuality(...args),
}));

vi.mock("../lib/focusCrop", () => ({
  createFocusedScanCrop: (...args: unknown[]) => createFocusedScanCrop(...args),
}));

vi.mock("../lib/productSegmentation", () => ({
  createSegmentedProductIsolation: (...args: unknown[]) => createSegmentedProductIsolation(...args),
}));

vi.mock("../lib/objectTargeting", () => ({
  detectObjectTargetFromImageData: (...args: unknown[]) => detectObjectTargetFromImageData(...args),
}));

// Cache always misses in scanner tests - cache logic tested in scanCache.test.ts
vi.mock("../lib/scanCache", () => ({
  hashImageDataUrl: vi.fn(async () => null),
  getCachedScanResult: vi.fn(() => null),
  setCachedScanResult: vi.fn(),
}));

describe("Scanner", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    window.history.pushState({}, "", "/");
  });

  beforeEach(() => {
    captureFrame.mockReset();
    captureFrame.mockResolvedValue("data:image/jpeg;base64,compressed-frame");
    retryCamera.mockClear();
    switchCamera.mockClear();
    assessImageQuality.mockReset();
    assessImageQuality.mockResolvedValue(passingQuality);
    createFocusedScanCrop.mockReset();
    createFocusedScanCrop.mockResolvedValue("data:image/jpeg;base64,target-crop");
    createSegmentedProductIsolation.mockReset();
    createSegmentedProductIsolation.mockResolvedValue(null);
    detectObjectTargetFromImageData.mockReset();
    detectObjectTargetFromImageData.mockReturnValue(null);
    getCloudSyncStatus.mockReset();
    getCloudSyncStatus.mockReturnValue({ configured: false, message: "Cloud sync is off." });
    syncLookupToCloud.mockReset();
    syncLookupToCloud.mockResolvedValue({ ok: true, message: "Scan synced." });
    identifyCapturedFrame.mockReset();
    identifyCapturedFrame.mockResolvedValue(makeScanResult("Alternator"));
    cameraHookState.current = {
      cameraError: null,
      cameraRequestId: 0,
      cameraState: "ready",
    };
    objectTargetState.current = null;
    objectTargetOptions.latest = null;
    localStorage.clear();
    sessionStorage.clear();
  });

  it("scans on shutter press, identifies, saves it, and opens an in-place review", async () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<Scanner />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByTestId("webcam-preview")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Scan now" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Scan now" }));
    await waitFor(() => expect(identifyCapturedFrame).toHaveBeenCalledTimes(1));
    const reviewHeading = await screen.findByRole("heading", { level: 3, name: "Alternator" });
    const reviewCard = reviewHeading.closest("section");
    expect(reviewCard).toBeTruthy();
    expect(screen.queryByTestId("lens-primary-label")).not.toBeInTheDocument();
    expect(screen.getByTestId("focused-part-overlay")).toHaveAttribute("data-focus-mode", "full_frame");
    expect(screen.queryByText("More evidence")).not.toBeInTheDocument();
    expect(screen.queryByText("Capture another angle")).not.toBeInTheDocument();
    expect(screen.queryByText(/Likely/)).not.toBeInTheDocument();
    expect(screen.queryByText("Verify")).not.toBeInTheDocument();
    expect(within(reviewCard as HTMLElement).getByText("It charges the battery while the engine runs.")).toBeInTheDocument();
    expect(within(reviewCard as HTMLElement).queryByText("AI detection")).not.toBeInTheDocument();
    expect(within(reviewCard as HTMLElement).queryByRole("button", { name: "Open details" })).not.toBeInTheDocument();
    const savedLookups = JSON.parse(localStorage.getItem("deep-spec:lookups") ?? "[]");
    expect(savedLookups).toHaveLength(1);
    expect(savedLookups[0]).toMatchObject({
      provenance: {
        analysisSource: "ai_detection",
        captureMode: "camera",
      },
      scanQuality: {
        accepted: true,
        brightnessScore: 98,
        firstPass: true,
        motionFallback: true,
        motionStable: true,
        sharpnessScore: 100,
      },
      scanCategory: "electrical",
      trainingLabel: "Alternator",
      trainingStatus: "raw_unreviewed",
    });
  }, 20000);

  it("opens a simple captured-item review when AI analysis fails", async () => {
    identifyCapturedFrame.mockRejectedValueOnce(new Error("Provider jammed"));

    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<Scanner />} />
        </Routes>
      </MemoryRouter>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Scan now" }));

    expect(await screen.findByRole("heading", { level: 3, name: "Item captured" })).toBeInTheDocument();
    expect(screen.getByTestId("scan-item-view")).toBeInTheDocument();
    expect(screen.getByText("Saved photo")).toBeInTheDocument();
    expect(screen.getByText("The photo is saved. Try again.")).toBeInTheDocument();
    expect(screen.queryByText("Reading photo")).not.toBeInTheDocument();
    expect(screen.queryByText("Provider jammed")).not.toBeInTheDocument();
  }, 10000);

  it("isolates the identified product from the captured still after manual scan", async () => {
    mockStillImageTarget({
      confidence: 0.82,
      height: 0.3,
      width: 0.24,
      x: 0.08,
      y: 0.2666666667,
    });

    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<Scanner />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.queryByTestId("object-reticle")).not.toBeInTheDocument();
    expect(screen.queryByText("Tap part")).not.toBeInTheDocument();
    expect(captureFrame).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Scan now" }));

    await waitFor(() => expect(identifyCapturedFrame).toHaveBeenCalledTimes(1));
    expect(detectObjectTargetFromImageData).toHaveBeenCalled();
    expect(screen.queryByTestId("product-isolation-mask")).not.toBeInTheDocument();
    expect(screen.getByTestId("focused-part-overlay")).toHaveAttribute("data-focus-mode", "crop");
    expect(screen.getByTestId("focused-part-label")).toHaveTextContent("Alternator");
    expect(screen.getByTestId("scan-item-view")).toHaveTextContent("Focused");
    expect(screen.getByAltText("Item view for Alternator")).toHaveAttribute("src", "data:image/jpeg;base64,target-crop");
    expectOverlayBox(screen.getByTestId("focused-part-window"), {
      height: 208.8,
      left: 60.8,
      top: 145.6,
      width: 278.4,
    });
  }, 10000);

  it("uses the segmentation model output for the scan-card visual without changing the AI crop", async () => {
    mockStillImageTarget({
      confidence: 0.82,
      height: 0.3,
      width: 0.24,
      x: 0.08,
      y: 0.2666666667,
    });
    createSegmentedProductIsolation.mockResolvedValueOnce({
      focusBox: { confidence: 0.9, height: 0.7, width: 0.62, x: 0.18, y: 0.14 },
      frame: {
        capturedAt: "2026-06-23T00:00:00.000Z",
        imageBase64: "data:image/png;base64,segmented-product",
      },
      isolatedImageBase64: "data:image/png;base64,segmented-product",
    });

    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<Scanner />} />
        </Routes>
      </MemoryRouter>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Scan now" }));

    await waitFor(() => expect(identifyCapturedFrame).toHaveBeenCalledTimes(1));
    expect(createSegmentedProductIsolation).toHaveBeenCalledWith(expect.objectContaining({
      imageBase64: "data:image/jpeg;base64,target-crop",
    }));
    expect(identifyCapturedFrame.mock.calls[0][1]).toMatchObject({
      imageBase64: "data:image/jpeg;base64,target-crop",
    });
    expect(screen.getByTestId("focused-part-overlay")).toHaveAttribute("data-focus-mode", "mask");
    expect(screen.getByTestId("scan-item-view")).toHaveTextContent("Isolated");
    expect(screen.getByAltText("Item view for Alternator")).toHaveAttribute("src", "data:image/png;base64,segmented-product");
    const savedLookups = JSON.parse(localStorage.getItem("deep-spec:lookups") ?? "[]");
    expect(savedLookups[0]).toMatchObject({
      focusMode: "mask",
      isolatedImageBase64: "data:image/png;base64,segmented-product",
    });
  }, 10000);

  it("shows the default focused overlay for body-part results", async () => {
    mockStillImageTarget({
      confidence: 0.82,
      height: 0.5666666667,
      width: 0.34,
      x: 0.024,
      y: 0.2,
    });
    identifyCapturedFrame.mockResolvedValueOnce({
      ...makeScanResult("front bumper"),
      scanCategory: "body",
      whatItDoes: "The front bumper is the front impact cover.",
    });

    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<Scanner />} />
        </Routes>
      </MemoryRouter>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Scan now" }));
    await waitFor(() => expect(captureFrame).toHaveBeenCalled());
    await waitFor(() => expect(identifyCapturedFrame).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId("lens-context-overlay")).not.toBeInTheDocument();
    expect(screen.getByTestId("focused-part-label")).toHaveTextContent("front bumper");
    expect(screen.getByTestId("focused-part-window")).toBeInTheDocument();
  }, 10000);

  it("uses the same focused overlay for brake assemblies", async () => {
    mockStillImageTarget({
      confidence: 0.84,
      height: 0.5083333333,
      width: 0.409,
      x: 0.003,
      y: 0.3383333333,
    });
    identifyCapturedFrame.mockResolvedValueOnce({
      ...makeScanResult("Brake Disc and Caliper Assembly"),
      scanCategory: "brakes",
      whatItDoes: "The brake disc works with the caliper and pads to stop the vehicle.",
    });

    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<Scanner />} />
        </Routes>
      </MemoryRouter>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Scan now" }));
    await waitFor(() => expect(captureFrame).toHaveBeenCalled());
    await waitFor(() => expect(identifyCapturedFrame).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId("lens-context-overlay")).not.toBeInTheDocument();
    expect(screen.getByTestId("focused-part-label")).toHaveTextContent("Brake Disc and Caliper Assembly");
    expect(screen.getByTestId("focused-part-window")).toBeInTheDocument();
  }, 10000);

  it("uses focused overlays for engine assembly and radiator results", async () => {
    mockStillImageTarget({
      confidence: 0.86,
      height: 0.6,
      width: 0.36,
      x: 0.02,
      y: 0.2333333333,
    });
    identifyCapturedFrame.mockResolvedValueOnce({
      ...makeScanResult("Engine"),
      scanCategory: "engine",
      whatItDoes: "The engine assembly is the main power unit.",
    });

    const { unmount } = render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<Scanner />} />
        </Routes>
      </MemoryRouter>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Scan now" }));
    await waitFor(() => expect(identifyCapturedFrame).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId("lens-context-overlay")).not.toBeInTheDocument();
    expect(screen.getByTestId("focused-part-label")).toHaveTextContent("Engine");
    expect(screen.getByTestId("focused-part-window")).toBeInTheDocument();

    unmount();
    identifyCapturedFrame.mockClear();
    mockStillImageTarget({
      confidence: 0.86,
      height: 0.5,
      width: 0.34,
      x: 0.04,
      y: 0.3,
    });
    identifyCapturedFrame.mockResolvedValueOnce({
      ...makeScanResult("Radiator"),
      scanCategory: "engine",
      whatItDoes: "The radiator removes heat from engine coolant.",
    });

    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<Scanner />} />
        </Routes>
      </MemoryRouter>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Scan now" }));
    await waitFor(() => expect(identifyCapturedFrame).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId("lens-context-overlay")).not.toBeInTheDocument();
    expect(screen.getByTestId("focused-part-label")).toHaveTextContent("Radiator");
    expect(screen.getByTestId("focused-part-window")).toBeInTheDocument();
  }, 10000);

  it("does not turn text-only evidence regions into fake AR boxes", async () => {
    mockStillImageTarget({
      confidence: 0.82,
      height: 0.3,
      width: 0.24,
      x: 0.08,
      y: 0.2666666667,
    });
    identifyCapturedFrame.mockResolvedValueOnce({
      ...makeScanResult("Alternator"),
      evidenceRegions: [
        {
          label: "Pulley",
          observation: "Belt pulley visible near the front.",
          regionLabel: "upper left",
        },
      ],
    });

    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<Scanner />} />
        </Routes>
      </MemoryRouter>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Scan now" }));
    await waitFor(() => expect(identifyCapturedFrame).toHaveBeenCalledTimes(1));

    expect(screen.getByTestId("focused-part-window")).toBeInTheDocument();
    expect(screen.queryByTestId("lens-evidence-chip")).not.toBeInTheDocument();
    expect(screen.queryByText(/Pulley: Belt pulley visible/)).not.toBeInTheDocument();
  }, 10000);

  it("sends a focused target crop as the AI image when the captured still isolates a product", async () => {
    mockStillImageTarget({
      confidence: 0.72,
      height: 0.18,
      width: 0.24,
      x: 0.18,
      y: 0.28,
    });

    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<Scanner />} />
        </Routes>
      </MemoryRouter>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Scan now" }));

    await waitFor(() => expect(identifyCapturedFrame).toHaveBeenCalledTimes(1));
    expect(createFocusedScanCrop).toHaveBeenCalledWith(expect.stringMatching(/^data:image\/jpeg;base64,/), expect.objectContaining({
      height: 0.18,
      width: 0.24,
      x: 0.18,
      y: 0.28,
    }));
    expect(identifyCapturedFrame.mock.calls[0][0]).toMatchObject({
      imageBase64: expect.stringMatching(/^data:image\/jpeg;base64,/),
    });
    expect(identifyCapturedFrame.mock.calls[0][1]).toMatchObject({
      imageBase64: "data:image/jpeg;base64,target-crop",
    });
  }, 10000);

  it("does not render the old live auto-scan reticle or auto-capture", () => {
    objectTargetState.current = makeObjectTarget({
      holdProgress: 0,
      isLocked: false,
    });

    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<Scanner />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.queryByTestId("object-reticle")).not.toBeInTheDocument();
    expect(screen.queryByText(/Hold still/)).not.toBeInTheDocument();
    expect(objectTargetOptions.latest).toBeNull();
    expect(captureFrame).not.toHaveBeenCalled();
    expect(identifyCapturedFrame).not.toHaveBeenCalled();
  });

  it("analyzes the photo even when still-image isolation is too small to trust", async () => {
    mockStillImageTarget({
      confidence: 0.72,
      height: 0.03,
      width: 0.03,
      x: 0.42,
      y: 0.32,
    });

    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<Scanner />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByRole("button", { name: "Scan now" })).toBeEnabled();
    await userEvent.click(screen.getByRole("button", { name: "Scan now" }));

    await waitFor(() => expect(identifyCapturedFrame).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole("heading", { level: 3, name: "Alternator" })).toBeInTheDocument();
    expect(screen.getByTestId("focused-part-overlay")).toHaveAttribute("data-focus-mode", "full_frame");
    expect(screen.getByTestId("focused-part-window")).toBeInTheDocument();
  }, 10000);

  it("does not wait for a prominent live target before a manual scan", async () => {
    objectTargetState.current = makeObjectTarget({
      height: 150,
      holdProgress: 1,
      id: "target-small-auto",
      isLocked: true,
      width: 140,
    });

    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<Scanner />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.queryByText("Center part")).not.toBeInTheDocument();
    expect(captureFrame).not.toHaveBeenCalled();
    expect(identifyCapturedFrame).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Scan now" }));

    await waitFor(() => expect(identifyCapturedFrame).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole("heading", { level: 3, name: "Alternator" })).toBeInTheDocument();
  }, 10000);

  it("syncs a new saved scan to the cloud dataset when Supabase is configured", async () => {
    getCloudSyncStatus.mockReturnValue({ configured: true, message: "Cloud sync is configured." });

    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<Scanner />} />
        </Routes>
      </MemoryRouter>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Scan now" }));
    await screen.findByRole("heading", { level: 3, name: "Alternator" });

    await waitFor(() => {
      expect(syncLookupToCloud).toHaveBeenCalledWith(expect.objectContaining({
        scanQuality: expect.objectContaining({
          accepted: true,
          brightnessScore: 98,
          sharpnessScore: 100,
        }),
        scanCategory: "electrical",
        trainingLabel: "Alternator",
      }));
    });
    expect(await screen.findByText("Scan saved to cloud.")).toBeInTheDocument();
  }, 10000);

  it("captures a second camera frame as a confidence boost when no crop target is present", async () => {
    captureFrame
      .mockResolvedValueOnce("data:image/jpeg;base64,primary-frame")
      .mockResolvedValueOnce("data:image/jpeg;base64,second-frame");

    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<Scanner />} />
        </Routes>
      </MemoryRouter>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Scan now" }));
    await waitFor(() => expect(identifyCapturedFrame).toHaveBeenCalledTimes(1));
    expect(identifyCapturedFrame.mock.calls[0][0]).toMatchObject({
      imageBase64: "data:image/jpeg;base64,primary-frame",
    });
    expect(identifyCapturedFrame.mock.calls[0][1]).toMatchObject({
      imageBase64: "data:image/jpeg;base64,second-frame",
    });
  }, 10000);

  it("keeps the bottom-sheet result card usable in a mobile viewport", async () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 375 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 667 });

    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<Scanner />} />
        </Routes>
      </MemoryRouter>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Scan now" }));
    const reviewHeading = await screen.findByRole("heading", { level: 3, name: "Alternator" });
    const reviewCard = reviewHeading.closest("section") as HTMLElement | null;
    expect(reviewCard).toBeTruthy();
    expect(reviewCard).toHaveAttribute("data-anchor-side");
    expect(reviewCard?.className).toContain("scanner-result-panel");
    expect(reviewCard?.className).toContain("max-h-[min(62dvh,560px)]");
    expect(within(reviewCard as HTMLElement).queryByRole("button", { name: "Open details" })).not.toBeInTheDocument();
    expect(within(reviewCard as HTMLElement).queryByRole("button", { name: "Correct label" })).not.toBeInTheDocument();
    expect(within(reviewCard as HTMLElement).queryByRole("button", { name: "Set reference" })).not.toBeInTheDocument();
    expect(within(reviewCard as HTMLElement).queryByRole("button", { name: "Estimate size" })).not.toBeInTheDocument();
  }, 10000);

  it("keeps measurement controls out of the default fastener scan card", async () => {
    identifyCapturedFrame.mockResolvedValueOnce(makeScanResult("Hex nut"));

    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<Scanner />} />
        </Routes>
      </MemoryRouter>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Scan now" }));
    const reviewHeading = await screen.findByRole("heading", { level: 3, name: "Hex nut" });
    const reviewCard = reviewHeading.closest("section") as HTMLElement | null;
    expect(reviewCard).toBeTruthy();

    expect(within(reviewCard as HTMLElement).queryByRole("combobox", { name: "Size reference preset" })).not.toBeInTheDocument();
    expect(within(reviewCard as HTMLElement).queryByRole("button", { name: "Set reference" })).not.toBeInTheDocument();
    expect(within(reviewCard as HTMLElement).queryByRole("button", { name: "Estimate size" })).not.toBeInTheDocument();
  }, 10000);

  it("lets the user scan with the shutter button", async () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<Scanner />} />
        </Routes>
      </MemoryRouter>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Scan now" }));

    await waitFor(() => expect(identifyCapturedFrame).toHaveBeenCalledTimes(1));
    const reviewHeading = await screen.findByRole("heading", { level: 3, name: "Alternator" });
    const reviewCard = reviewHeading.closest("section");
    expect(reviewCard).toBeTruthy();
    expect(screen.queryByRole("heading", { level: 1, name: "Camera access needed" })).not.toBeInTheDocument();
    expect(within(reviewCard as HTMLElement).queryByRole("button", { name: "Open details" })).not.toBeInTheDocument();
  }, 10000);

  it("identifies an uploaded photo when the camera is blocked", async () => {
    cameraHookState.current = {
      cameraError: "Permission denied",
      cameraRequestId: 7,
      cameraState: "blocked",
    };

    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<Scanner />} />
        </Routes>
      </MemoryRouter>,
    );

    await userEvent.upload(
      screen.getByLabelText("Upload photo"),
      new File(["test-image"], "alternator.jpg", { type: "image/jpeg" }),
    );

    await waitFor(() => expect(identifyCapturedFrame).toHaveBeenCalledTimes(1));
    const reviewHeading = await screen.findByRole("heading", { level: 3, name: "Alternator" });
    const reviewCard = reviewHeading.closest("section");
    expect(reviewCard).toBeTruthy();
    expect(within(reviewCard as HTMLElement).queryByRole("button", { name: "Open details" })).not.toBeInTheDocument();
    const savedLookups = JSON.parse(localStorage.getItem("deep-spec:lookups") ?? "[]");
    expect(savedLookups[0]).toMatchObject({
      provenance: {
        analysisSource: "ai_detection",
        captureMode: "upload",
      },
    });
  }, 10000);

  it("sends a focused detector crop as the AI image for uploaded photos", async () => {
    cameraHookState.current = {
      cameraError: "Permission denied",
      cameraRequestId: 7,
      cameraState: "blocked",
    };
    detectObjectTargetFromImageData.mockReturnValue({
      confidence: 0.81,
      height: 0.18,
      width: 0.16,
      x: 0.42,
      y: 0.22,
    });

    class TestImage {
      naturalHeight = 600;
      naturalWidth = 1000;
      onerror: null | (() => void) = null;
      onload: null | (() => void) = null;

      set src(_value: string) {
        window.setTimeout(() => this.onload?.(), 0);
      }
    }

    vi.stubGlobal("Image", TestImage);
    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tagName, options) => {
      if (tagName.toLowerCase() === "canvas") {
        return {
          getContext: () => ({
            drawImage: vi.fn(),
            getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(4), height: 1, width: 1 })),
          }),
          height: 0,
          width: 0,
        } as unknown as HTMLCanvasElement;
      }

      return originalCreateElement(tagName, options);
    });

    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<Scanner />} />
        </Routes>
      </MemoryRouter>,
    );

    await userEvent.upload(
      screen.getByLabelText("Upload photo"),
      new File(["test-image"], "front-fender.jpg", { type: "image/jpeg" }),
    );

    await waitFor(() => expect(identifyCapturedFrame).toHaveBeenCalledTimes(1));
    expect(createFocusedScanCrop).toHaveBeenCalledWith(expect.stringMatching(/^data:image\/jpeg;base64,/), {
      confidence: 0.81,
      height: 0.18,
      width: 0.16,
      x: 0.42,
      y: 0.22,
    });
    expect(identifyCapturedFrame.mock.calls[0][0]).toMatchObject({
      imageBase64: expect.stringMatching(/^data:image\/jpeg;base64,/),
    });
    expect(identifyCapturedFrame.mock.calls[0][1]).toMatchObject({
      imageBase64: "data:image/jpeg;base64,target-crop",
    });
  }, 10000);

  it("shows camera permission denial and lets the user retry camera access", async () => {
    cameraHookState.current = {
      cameraError: "Permission denied",
      cameraRequestId: 4,
      cameraState: "blocked",
    };

    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<Scanner />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { level: 1, name: "Camera access needed" })).toBeInTheDocument();
    expect(screen.getByText(/Allow camera access for this site/)).toBeInTheDocument();
    expect(screen.queryByTestId("webcam-preview")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Try camera again" }));

    expect(retryCamera).toHaveBeenCalledTimes(1);
  });

  it("keeps blocked-camera recovery minimal even when the retake guide query is present", () => {
    cameraHookState.current = {
      cameraError: "Permission denied",
      cameraRequestId: 4,
      cameraState: "blocked",
    };

    render(
      <MemoryRouter initialEntries={["/scan?guide=retake"]}>
        <Routes>
          <Route path="/scan" element={<Scanner />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.queryByText("Retake guide")).not.toBeInTheDocument();
    expect(screen.queryByText("Fill the frame from a slight angle.")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try camera again" })).toBeInTheDocument();
    expect(screen.getByLabelText("Upload photo")).toBeInTheDocument();
  });

  it("shows the camera loading state before the first frame is ready", () => {
    cameraHookState.current = {
      cameraError: null,
      cameraRequestId: 2,
      cameraState: "loading",
    };

    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<Scanner />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getAllByText("Opening camera")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Open gallery" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Scan now" })).toBeDisabled();
  });

  it("lets the user switch camera from the simplified scanner controls", async () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<Scanner />} />
        </Routes>
      </MemoryRouter>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Switch camera" }));

    expect(switchCamera).toHaveBeenCalledTimes(1);
  });

  it("keeps the camera alive when a transient frame capture fails", async () => {
    captureFrame.mockRejectedValueOnce(new Error("No camera frame was available."));

    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<Scanner />} />
        </Routes>
      </MemoryRouter>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Scan now" }));

    expect(await screen.findByText("No camera frame was available.")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 1, name: "Camera access needed" })).not.toBeInTheDocument();
    expect(identifyCapturedFrame).not.toHaveBeenCalled();
  }, 10000);

  it("keeps the real camera scanner active when a stale test query is present", async () => {
    window.history.pushState({}, "", "/scan?test=1");

    render(
      <MemoryRouter initialEntries={["/scan?test=1"]}>
        <Routes>
          <Route path="/scan" element={<Scanner />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.queryByRole("button", { name: "Run AI test photo" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Scan now" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Scan now" }));
    await waitFor(() => expect(identifyCapturedFrame).toHaveBeenCalledTimes(1));
    expect(localStorage.getItem("deep-spec:lookups")).toBeTruthy();
  }, 10000);

  it("lets the user cancel a scan in progress before the result opens", async () => {
    identifyCapturedFrame.mockImplementationOnce(() => new Promise(() => undefined));

    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<Scanner />} />
        </Routes>
      </MemoryRouter>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Scan now" }));
    await userEvent.click(await screen.findByRole("button", { name: "Cancel scan" }));

    expect(await screen.findByText("Scan canceled. Ready when you are.")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 1, name: "Alternator" })).not.toBeInTheDocument();
  }, 10000);

  it("prevents a canceled provider response from saving after cancel", async () => {
    let resolveScan: (value: ReturnType<typeof makeScanResult>) => void = () => undefined;
    identifyCapturedFrame.mockImplementationOnce(() => new Promise((resolve) => {
      resolveScan = resolve;
    }));

    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<Scanner />} />
        </Routes>
      </MemoryRouter>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Scan now" }));
    await userEvent.click(await screen.findByRole("button", { name: "Cancel scan" }));
    await waitFor(() => expect(screen.getByText("Scan canceled. Ready when you are.")).toBeInTheDocument());

    await act(async () => {
      resolveScan(makeScanResult("Stale pump"));
      await Promise.resolve();
    });

    expect(screen.queryByRole("heading", { level: 1, name: "Stale pump" })).not.toBeInTheDocument();
    expect(localStorage.getItem("deep-spec:lookups")).toBeNull();
  }, 10000);

  it("blocks blurry captures with a single quality coach fix before identify", async () => {
    assessImageQuality.mockResolvedValueOnce({
      ok: false,
      issue: "too_blurry",
      message: "Move closer for more detail.",
    });

    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<Scanner />} />
        </Routes>
      </MemoryRouter>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Scan now" }));

    expect(await screen.findByRole("heading", { level: 2, name: "Soft photo" })).toBeInTheDocument();
    expect(screen.getAllByText("Steady photo").length).toBeGreaterThan(0);
    expect(screen.queryByText("Try this exact fix, then scan again.")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Scan again" })).toBeInTheDocument();
    expect(identifyCapturedFrame).not.toHaveBeenCalled();
  }, 10000);
});

function makeObjectTarget(overrides: Partial<NonNullable<typeof objectTargetState.current>>) {
  return {
    confidence: 0.82,
    height: 180,
    holdProgress: 1,
    id: "target-fast",
    isLocked: true,
    left: 80,
    normalized: {
      x: 0.28,
      y: 0.32,
      width: 0.28,
      height: 0.22,
    },
    top: 160,
    width: 240,
    ...overrides,
  };
}

function mockStillImageTarget(
  target: {
    confidence: number;
    height: number;
    width: number;
    x: number;
    y: number;
  } | null,
  size = { height: 600, width: 1000 },
) {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: size.width });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: size.height });
  captureFrame.mockResolvedValue(`data:image/jpeg;base64,${"a".repeat(240)}`);
  detectObjectTargetFromImageData.mockReturnValue(target);

  class TestImage {
    naturalHeight = size.height;
    naturalWidth = size.width;
    onerror: null | (() => void) = null;
    onload: null | (() => void) = null;

    set src(_value: string) {
      window.setTimeout(() => this.onload?.(), 0);
    }
  }

  vi.stubGlobal("Image", TestImage);
  vi.spyOn(document, "createElement").mockImplementation((tagName, options) => {
    if (tagName.toLowerCase() === "canvas") {
      return {
        getContext: () => ({
          drawImage: vi.fn(),
          getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(4), height: 1, width: 1 })),
        }),
        height: 0,
        width: 0,
      } as unknown as HTMLCanvasElement;
    }

    return createRealElement(tagName, options);
  });
}

function expectOverlayBox(
  element: HTMLElement,
  expected: {
    height: number;
    left: number;
    top: number;
    width: number;
  },
) {
  expect(Number.parseFloat(element.style.height)).toBeCloseTo(expected.height, 2);
  expect(Number.parseFloat(element.style.left)).toBeCloseTo(expected.left, 2);
  expect(Number.parseFloat(element.style.top)).toBeCloseTo(expected.top, 2);
  expect(Number.parseFloat(element.style.width)).toBeCloseTo(expected.width, 2);
}

function makeScanResult(partName: string) {
  return {
    partName,
    confidence: "high" as const,
    scanCategory: "electrical" as const,
    candidateMatches: [],
    whatItDoes: "It charges the battery while the engine runs.",
    visibleObservations: ["Belt-driven metal housing is visible."],
    evidenceRegions: [],
    concerns: [],
    safetyTriage: "can_help" as const,
    isSafetyCritical: false,
    nextAction: "Compare the scan with another angle if you need more detail.",
    needsBetterPhoto: false,
    evidence: ["The pulley and housing match common alternator shapes."],
    sourceLinks: [],
  };
}
