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
    expect(within(reviewCard as HTMLElement).getByText("It charges the battery while the engine runs.")).toBeInTheDocument();
    expect(within(reviewCard as HTMLElement).getByText("AI detection")).toBeInTheDocument();
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
    expect(screen.getByTestId("product-isolation-mask")).toBeInTheDocument();
    expect(screen.getByTestId("lens-primary-label")).toHaveTextContent("Alternator");
    expect(screen.getByAltText("Scan photo for Alternator")).toHaveAttribute("src", "data:image/jpeg;base64,target-crop");
    expectOverlayBox(screen.getByTestId("lens-part-overlay-0"), {
      height: 180,
      left: 80,
      top: 160,
      width: 240,
    });
  }, 10000);

  it("shows a context AR outline when a body part uses a tighter focus overlay", async () => {
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
    expect(screen.getByTestId("lens-context-overlay")).toBeInTheDocument();
    expect(screen.getByTestId("lens-primary-label")).toHaveTextContent("front bumper");
    expectOverlayBox(screen.getByTestId("lens-part-overlay-0"), {
      height: 95.2,
      left: 71.6,
      top: 337.6,
      width: 244.8,
    });
  }, 10000);

  it("uses a focused AR overlay for brake assemblies instead of the whole scan area", async () => {
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
    expect(screen.getByTestId("lens-context-overlay")).toBeInTheDocument();
    expect(screen.getByTestId("lens-primary-label")).toHaveTextContent("Brake Disc and Caliper Assembly");
    expectOverlayBox(screen.getByTestId("lens-part-overlay-0"), {
      height: 189.1,
      left: 19.36,
      top: 257.9,
      width: 286.3,
    });
  }, 10000);

  it("uses focused AR overlays for engine assembly and radiator results", async () => {
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
    expect(screen.getByTestId("lens-context-overlay")).toBeInTheDocument();
    expectOverlayBox(screen.getByTestId("lens-part-overlay-0"), {
      height: 194.4,
      left: 74,
      top: 233.6,
      width: 252,
    });

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
    expect(screen.getByTestId("lens-context-overlay")).toBeInTheDocument();
    expectOverlayBox(screen.getByTestId("lens-part-overlay-0"), {
      height: 126,
      left: 114.8,
      top: 282,
      width: 190.4,
    });
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

    expect(screen.getAllByTestId(/lens-part-overlay-/)).toHaveLength(1);
    expect(screen.getByTestId("lens-evidence-chip")).toHaveTextContent(/Pulley: Belt pulley visible/);
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
    expect(screen.queryByTestId("lens-part-overlay-0")).not.toBeInTheDocument();
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
    expect(await screen.findByText("Saved to cloud dataset.")).toBeInTheDocument();
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
    expect(within(reviewCard as HTMLElement).getByRole("button", { name: "Correct label" })).toBeInTheDocument();
    expect(within(reviewCard as HTMLElement).queryByRole("button", { name: "Set reference" })).not.toBeInTheDocument();
    expect(within(reviewCard as HTMLElement).queryByRole("button", { name: "Estimate size" })).not.toBeInTheDocument();
  }, 10000);

  it("requires a size reference before estimating AR size for fastener replacement", async () => {
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

    await userEvent.click(within(reviewCard as HTMLElement).getByRole("button", { name: "Estimate size" }));
    expect(await screen.findByText("No point to measure yet.")).toBeInTheDocument();
  }, 10000);

  it("shows the size reference dropdown options for fastener scans", async () => {
    identifyCapturedFrame.mockResolvedValueOnce(makeScanResult("Hex nut"));

    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<Scanner />} />
        </Routes>
      </MemoryRouter>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Scan now" }));
    await screen.findByRole("heading", { level: 3, name: "Hex nut" });

    expect(screen.getByRole("combobox", { name: "Size reference preset" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Set reference" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Estimate size" })).toBeInTheDocument();
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

    expect(await screen.findByText("Scan canceled. Hold the right item steady to try again.")).toBeInTheDocument();
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
    await waitFor(() => expect(screen.getByText("Scan canceled. Hold the right item steady to try again.")).toBeInTheDocument());

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
      message: "Move closer and hold steady. Not enough detail to identify.",
    });

    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<Scanner />} />
        </Routes>
      </MemoryRouter>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Scan now" }));

    expect(await screen.findByRole("heading", { level: 2, name: "Too blurry" })).toBeInTheDocument();
    expect(screen.getAllByText("Hold still 2s").length).toBeGreaterThan(0);
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
