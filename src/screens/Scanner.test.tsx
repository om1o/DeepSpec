import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, expect, vi } from "vitest";
import Scanner from "./Scanner";

const captureFrame = vi.fn(async () => "data:image/jpeg;base64,compressed-frame");
const retryCamera = vi.fn();
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
    cameraRequestId: cameraHookState.current.cameraRequestId,
    cameraError: cameraHookState.current.cameraError,
    cameraState: cameraHookState.current.cameraState,
    captureFrame,
    markError: vi.fn(),
    markReady: vi.fn(),
    retryCamera,
    selectCamera: vi.fn(),
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
    vi.unstubAllGlobals();
    window.history.pushState({}, "", "/");
  });

  beforeEach(() => {
    captureFrame.mockReset();
    captureFrame.mockResolvedValue("data:image/jpeg;base64,compressed-frame");
    retryCamera.mockClear();
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
    expect(within(reviewCard as HTMLElement).getByRole("button", { name: "Open details" })).toBeInTheDocument();
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

  it("auto captures only after a held, centered target is ready", async () => {
    objectTargetState.current = makeObjectTarget({
      confidence: 0.82,
      height: 180,
      holdProgress: 1,
      isLocked: true,
      normalized: {
        x: 0.28,
        y: 0.32,
        width: 0.28,
        height: 0.22,
      },
      width: 240,
    });

    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<Scanner />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByTestId("object-reticle")).toBeInTheDocument();
    await waitFor(() => expect(captureFrame).toHaveBeenCalled());
    await waitFor(() => expect(identifyCapturedFrame).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId("lens-primary-label")).toHaveTextContent("Alternator");
    expect(screen.getByTestId("lens-part-overlay-0")).toHaveStyle({
      height: "180px",
      left: "80px",
      top: "160px",
      width: "240px",
    });
  }, 10000);

  it("shows a context AR outline when a body part uses a tighter focus overlay", async () => {
    objectTargetState.current = makeObjectTarget({
      confidence: 0.82,
      height: 340,
      holdProgress: 1,
      isLocked: true,
      left: 24,
      top: 120,
      width: 340,
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

    await waitFor(() => expect(captureFrame).toHaveBeenCalled());
    await waitFor(() => expect(identifyCapturedFrame).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId("lens-context-overlay")).toBeInTheDocument();
    expect(screen.getByTestId("lens-primary-label")).toHaveTextContent("front bumper");
    expect(screen.getByTestId("lens-part-overlay-0")).toHaveStyle({
      height: "95.19999999999999px",
      left: "71.6px",
      top: "337.6px",
      width: "244.79999999999998px",
    });
  }, 10000);

  it("uses a focused AR overlay for brake assemblies instead of the whole scan area", async () => {
    objectTargetState.current = makeObjectTarget({
      confidence: 0.84,
      height: 305,
      holdProgress: 1,
      isLocked: true,
      left: 3,
      top: 203,
      width: 409,
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

    await waitFor(() => expect(captureFrame).toHaveBeenCalled());
    await waitFor(() => expect(identifyCapturedFrame).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId("lens-context-overlay")).toBeInTheDocument();
    expect(screen.getByTestId("lens-primary-label")).toHaveTextContent("Brake Disc and Caliper Assembly");
    expect(screen.getByTestId("lens-part-overlay-0")).toHaveStyle({
      height: "189.10000000000002px",
      left: "19.36px",
      top: "257.9px",
      width: "286.29999999999995px",
    });
  }, 10000);

  it("does not turn text-only evidence regions into fake AR boxes", async () => {
    objectTargetState.current = makeObjectTarget({
      confidence: 0.82,
      height: 180,
      holdProgress: 1,
      isLocked: true,
      left: 80,
      top: 160,
      width: 240,
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

    await waitFor(() => expect(identifyCapturedFrame).toHaveBeenCalledTimes(1));

    expect(screen.getAllByTestId(/lens-part-overlay-/)).toHaveLength(1);
    expect(screen.getByTestId("lens-evidence-chip")).toHaveTextContent(/Pulley: Belt pulley visible/);
  }, 10000);

  it("sends a focused target crop as the AI image when the user taps the selected object", async () => {
    objectTargetState.current = makeObjectTarget({
      confidence: 0.72,
      holdProgress: 0.34,
      id: "target-tap",
      isLocked: false,
      normalized: {
        x: 0.18,
        y: 0.28,
        width: 0.24,
        height: 0.18,
      },
    });

    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<Scanner />} />
        </Routes>
      </MemoryRouter>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Scan selected part" }));

    await waitFor(() => expect(identifyCapturedFrame).toHaveBeenCalledTimes(1));
    expect(createFocusedScanCrop).toHaveBeenCalledWith("data:image/jpeg;base64,compressed-frame", {
      x: 0.18,
      y: 0.28,
      width: 0.24,
      height: 0.18,
    });
    expect(identifyCapturedFrame.mock.calls[0][0]).toMatchObject({
      imageBase64: expect.stringMatching(/^data:image\/jpeg;base64,/),
    });
    expect(identifyCapturedFrame.mock.calls[0][1]).toMatchObject({
      imageBase64: "data:image/jpeg;base64,target-crop",
    });
  }, 10000);

  it("requires a five-second hold before auto capture locks", () => {
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

    expect(screen.getAllByText("Hold still 5s").length).toBeGreaterThan(0);
    expect(objectTargetOptions.latest?.holdDurationMs).toBe(5000);
    expect(identifyCapturedFrame).not.toHaveBeenCalled();
  });

  it("blocks scan when the selected target is too small for AR measurement", () => {
    objectTargetState.current = makeObjectTarget({
      height: 40,
      holdProgress: 1,
      id: "target-tiny",
      isLocked: true,
      width: 40,
    });

    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<Scanner />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getAllByText("Move closer").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Scan now" })).toBeDisabled();
    expect(captureFrame).not.toHaveBeenCalled();
    expect(identifyCapturedFrame).not.toHaveBeenCalled();
  });

  it("waits for a prominent target before autoscan but keeps manual scan available", async () => {
    objectTargetState.current = makeObjectTarget({
      height: 150,
      holdProgress: 1,
      id: "target-small-auto",
      isLocked: true,
      left: 360,
      normalized: {
        x: 0.36,
        y: 0.32,
        width: 0.18,
        height: 0.15,
      },
      top: 260,
      width: 140,
    });

    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<Scanner />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getAllByText("Move closer").length).toBeGreaterThan(0);
    expect(captureFrame).not.toHaveBeenCalled();
    expect(identifyCapturedFrame).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Scan now" }));

    await waitFor(() => expect(identifyCapturedFrame).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole("heading", { level: 3, name: "Alternator" })).toBeInTheDocument();
  }, 10000);

  it("waits for a centered target before autoscan but lets the user tap the object", async () => {
    objectTargetState.current = makeObjectTarget({
      height: 220,
      holdProgress: 1,
      id: "target-edge-auto",
      isLocked: true,
      left: 20,
      normalized: {
        x: 0.03,
        y: 0.35,
        width: 0.22,
        height: 0.22,
      },
      top: 260,
      width: 220,
    });

    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<Scanner />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getAllByText("Center part").length).toBeGreaterThan(0);
    expect(captureFrame).not.toHaveBeenCalled();
    expect(identifyCapturedFrame).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Scan selected part" }));

    await waitFor(() => expect(identifyCapturedFrame).toHaveBeenCalledTimes(1));
    expect(createFocusedScanCrop).toHaveBeenCalledWith("data:image/jpeg;base64,compressed-frame", {
      x: 0.03,
      y: 0.35,
      width: 0.22,
      height: 0.22,
    });
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
    expect(within(reviewCard as HTMLElement).getByRole("button", { name: "Open details" })).toBeInTheDocument();
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
    expect(within(reviewCard as HTMLElement).getByRole("button", { name: "Open details" })).toBeInTheDocument();
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
    expect(within(reviewCard as HTMLElement).getByRole("button", { name: "Open details" })).toBeInTheDocument();
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

  it("keeps retake guide instructions visible when camera access is blocked", () => {
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

    expect(screen.getByText("Retake guide")).toBeInTheDocument();
    expect(screen.getByText("Fill the frame from a slight angle.")).toBeInTheDocument();
    expect(screen.getByText("Use upload if camera access is blocked.")).toBeInTheDocument();
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
    expect(screen.getByText("Try this exact fix, then scan again.")).toBeInTheDocument();
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
