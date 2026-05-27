import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, vi } from "vitest";
import Result from "./Result";
import Scanner from "./Scanner";

const captureFrame = vi.fn(async () => "data:image/jpeg;base64,compressed-frame");
const retryCamera = vi.fn();
const assessImageQuality = vi.fn(async () => ({ ok: true }));
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
  current: {
    confidence: 0.82,
    height: 180,
    holdProgress: 1,
    isInScannerBox: true,
    isLocked: true,
    left: 80,
    top: 160,
    width: 240,
  } as null | {
    confidence: number;
    height: number;
    holdProgress: number;
    isInScannerBox: boolean;
    isLocked: boolean;
    left: number;
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
    cameraRequestId: cameraHookState.current.cameraRequestId,
    cameraError: cameraHookState.current.cameraError,
    cameraState: cameraHookState.current.cameraState,
    captureFrame,
    markError: vi.fn(),
    markReady: vi.fn(),
    retryCamera,
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
  identifyCapturedFrameWithRun: async (...args: unknown[]) => ({
    modelRun: {
      id: "run-1",
      createdAt: "2026-05-16T00:00:04.000Z",
      kind: "identify",
      latencyMs: 123,
      model: "gemini-2.5-flash",
      ocrUsed: false,
      promptVersion: "identify-v1",
      provider: "gemini",
    },
    result: await identifyCapturedFrame(...args),
  }),
}));

// Pass all images as ok - quality logic is tested separately in imageQuality.test.ts
vi.mock("../lib/imageQuality", () => ({
  assessImageQuality: (...args: unknown[]) => assessImageQuality(...args),
}));

// Cache always misses in scanner tests - cache logic tested in scanCache.test.ts
vi.mock("../lib/scanCache", () => ({
  hashImageDataUrl: vi.fn(async () => null),
  getCachedScanResult: vi.fn(() => null),
  setCachedScanResult: vi.fn(),
}));

describe("Scanner", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    window.history.pushState({}, "", "/");
  });

  beforeEach(() => {
    captureFrame.mockReset();
    captureFrame.mockResolvedValue("data:image/jpeg;base64,compressed-frame");
    retryCamera.mockClear();
    assessImageQuality.mockReset();
    assessImageQuality.mockResolvedValue({ ok: true });
    identifyCapturedFrame.mockReset();
    identifyCapturedFrame.mockResolvedValue(makeScanResult("Alternator"));
    cameraHookState.current = {
      cameraError: null,
      cameraRequestId: 0,
      cameraState: "ready",
    };
    objectTargetState.current = {
      confidence: 0.82,
      height: 180,
      holdProgress: 1,
      isInScannerBox: true,
      isLocked: true,
      left: 80,
      top: 160,
      width: 240,
    };
    objectTargetOptions.latest = null;
    localStorage.clear();
    sessionStorage.clear();
  });

  it("auto captures a held target, identifies, saves it, and opens the saved result", async () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<Scanner />} />
          <Route path="/result" element={<Result />} />
          <Route path="/result/:id" element={<Result />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByTestId("webcam-preview")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Scan now" })).toBeInTheDocument();
    expect(screen.getByTestId("object-reticle")).toBeInTheDocument();

    await waitFor(() => expect(captureFrame).toHaveBeenCalled());
    await waitFor(() => expect(identifyCapturedFrame).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole("heading", { level: 1, name: "Alternator" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Captured car part" })).toHaveAttribute(
      "src",
      "data:image/jpeg;base64,compressed-frame",
    );
    expect(screen.getByText("It charges the battery while the engine runs.")).toBeInTheDocument();
    expect(screen.getByText("Saved scan")).toBeInTheDocument();
    const savedLookups = JSON.parse(localStorage.getItem("deep-spec:lookups") ?? "[]");
    expect(savedLookups).toHaveLength(1);
    expect(savedLookups[0]).toMatchObject({
      scanCategory: "electrical",
      trainingLabel: "Alternator",
      trainingStatus: "raw_unreviewed",
    });
  }, 10000);

  it("lets the user run a manual scan when target lock is not available", async () => {
    objectTargetState.current = null;

    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<Scanner />} />
          <Route path="/result" element={<Result />} />
          <Route path="/result/:id" element={<Result />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByTestId("object-reticle")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Scan now" }));

    await waitFor(() => expect(identifyCapturedFrame).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole("heading", { level: 1, name: "Alternator" })).toBeInTheDocument();
    expect(screen.getByText("Saved scan")).toBeInTheDocument();
  }, 10000);

  it("identifies an uploaded photo when the camera is blocked", async () => {
    cameraHookState.current = {
      cameraError: "Permission denied",
      cameraRequestId: 7,
      cameraState: "blocked",
    };
    objectTargetState.current = null;

    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<Scanner />} />
          <Route path="/result" element={<Result />} />
          <Route path="/result/:id" element={<Result />} />
        </Routes>
      </MemoryRouter>,
    );

    await userEvent.upload(
      screen.getByLabelText("Upload photo"),
      new File(["test-image"], "alternator.jpg", { type: "image/jpeg" }),
    );

    await waitFor(() => expect(identifyCapturedFrame).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole("heading", { level: 1, name: "Alternator" })).toBeInTheDocument();
    expect(screen.getByText("Saved scan")).toBeInTheDocument();
  }, 10000);

  it("identifies a pasted screenshot when the camera is blocked", async () => {
    cameraHookState.current = {
      cameraError: "Permission denied",
      cameraRequestId: 8,
      cameraState: "blocked",
    };
    objectTargetState.current = null;

    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<Scanner />} />
          <Route path="/result" element={<Result />} />
          <Route path="/result/:id" element={<Result />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByRole("button", { name: "Paste image" })).toBeInTheDocument();

    fireEvent.paste(window, {
      clipboardData: {
        files: [new File(["screenshot"], "engine-screenshot.png", { type: "image/png" })],
      },
    });

    await waitFor(() => expect(identifyCapturedFrame).toHaveBeenCalledTimes(1));
    expect(identifyCapturedFrame.mock.calls[0][0]).toMatchObject({
      imageBase64: "data:image/png;base64,c2NyZWVuc2hvdA==",
    });
    expect(await screen.findByRole("heading", { level: 1, name: "Alternator" })).toBeInTheDocument();
    expect(screen.getByText("Saved scan")).toBeInTheDocument();
  }, 10000);

  it("requires a five-second hold before auto capture locks", () => {
    objectTargetState.current = {
      confidence: 0.82,
      height: 180,
      holdProgress: 0,
      isInScannerBox: true,
      isLocked: false,
      left: 80,
      top: 160,
      width: 240,
    };

    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<Scanner />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText("Auto scan in 5s")).toBeInTheDocument();
    expect(screen.getByText("Hold still 5s")).toBeInTheDocument();
    expect(objectTargetOptions.latest?.holdDurationMs).toBe(5000);
    expect(identifyCapturedFrame).not.toHaveBeenCalled();
  });

  it("does not auto capture when the detected target is outside the scanner box", () => {
    objectTargetState.current = {
      confidence: 0.82,
      height: 180,
      holdProgress: 0,
      isInScannerBox: false,
      isLocked: false,
      left: 12,
      top: 160,
      width: 240,
    };

    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<Scanner />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText("Move part into box")).toBeInTheDocument();
    expect(screen.getByText("Place part in box")).toBeInTheDocument();
    expect(identifyCapturedFrame).not.toHaveBeenCalled();
  });

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

    await userEvent.click(screen.getByRole("button", { name: "Try camera again" }));

    expect(retryCamera).toHaveBeenCalledTimes(1);
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

    expect(screen.getAllByText("Opening camera")).toHaveLength(2);
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

    expect(await screen.findByText("No camera frame was available.")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 1, name: "Camera access needed" })).not.toBeInTheDocument();
    expect(identifyCapturedFrame).not.toHaveBeenCalled();
  }, 10000);

  it("runs the generated engine test scan without saving it to history", async () => {
    window.history.pushState({}, "", "/scan?test=1");
    objectTargetState.current = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        headers: {
          get: (name: string) => (name.toLowerCase() === "content-type" ? "image/jpeg" : null),
        },
        arrayBuffer: async () => new TextEncoder().encode("test-engine-image").buffer,
      })),
    );

    render(
      <MemoryRouter initialEntries={["/scan?test=1"]}>
        <Routes>
          <Route path="/scan" element={<Scanner />} />
          <Route path="/result" element={<Result />} />
        </Routes>
      </MemoryRouter>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Test engine photo" }));

    expect(await screen.findByText("QA test result")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Alternator" })).toBeInTheDocument();
    expect(identifyCapturedFrame).not.toHaveBeenCalled();
    expect(screen.getByText(/not sent to provider or cloud services/i)).toBeInTheDocument();
    expect(localStorage.getItem("deep-spec:lookups")).toBeNull();
    expect(sessionStorage.getItem("deep-spec:latest-scan-state")).toBeNull();
  }, 10000);

  it("can seed the generated engine test scan as a local-only saved QA fixture", async () => {
    window.history.pushState({}, "", "/scan?test=1&save=1");
    objectTargetState.current = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        headers: {
          get: (name: string) => (name.toLowerCase() === "content-type" ? "image/jpeg" : null),
        },
        arrayBuffer: async () => new TextEncoder().encode("test-engine-image").buffer,
      })),
    );

    render(
      <MemoryRouter initialEntries={["/scan?test=1&save=1"]}>
        <Routes>
          <Route path="/scan" element={<Scanner />} />
          <Route path="/result/:id" element={<Result />} />
        </Routes>
      </MemoryRouter>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Save QA seed scan" }));

    expect(await screen.findByText("QA test result")).toBeInTheDocument();
    expect(screen.getByText("Saved scan")).toBeInTheDocument();
    expect(screen.getByText(/review controls can be tested without provider quota or cloud writes/i)).toBeInTheDocument();
    expect(screen.getByText(/QA seed scans are local-only fixtures/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sync this scan" })).toBeDisabled();
    expect(identifyCapturedFrame).not.toHaveBeenCalled();
    const savedLookups = JSON.parse(localStorage.getItem("deep-spec:lookups") ?? "[]");
    expect(savedLookups).toHaveLength(1);
    expect(savedLookups[0]).toMatchObject({
      testRun: true,
      testVehicleLabel: "Generated engine bay QA photo",
      trainingLabel: "Alternator",
      trainingStatus: "raw_unreviewed",
    });
  }, 10000);

  it("keeps test scan mode clean when camera access is blocked", () => {
    window.history.pushState({}, "", "/scan?test=1");
    cameraHookState.current = {
      cameraError: "Permission denied",
      cameraRequestId: 9,
      cameraState: "blocked",
    };
    objectTargetState.current = null;

    render(
      <MemoryRouter initialEntries={["/scan?test=1"]}>
        <Routes>
          <Route path="/scan" element={<Scanner />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByRole("button", { name: "Test engine photo" })).toBeInTheDocument();
    expect(screen.getByText("Test scan ready")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 1, name: "Camera access needed" })).not.toBeInTheDocument();
  });

  it("lets testers exit sticky test scan mode", async () => {
    window.history.pushState({}, "", "/scan?test=1");
    objectTargetState.current = null;

    render(
      <MemoryRouter initialEntries={["/scan?test=1"]}>
        <Routes>
          <Route path="/scan" element={<Scanner />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByRole("button", { name: "Test engine photo" })).toBeInTheDocument();
    expect(sessionStorage.getItem("deep-spec:test-mode")).toBe("1");

    await userEvent.click(screen.getByRole("button", { name: "Exit test mode" }));

    await waitFor(() => expect(screen.queryByRole("button", { name: "Test engine photo" })).not.toBeInTheDocument());
    expect(sessionStorage.getItem("deep-spec:test-mode")).toBeNull();
    expect(screen.getByRole("button", { name: "Scan now" })).toBeInTheDocument();
  });

  it("lets the user cancel an accidental auto scan before the result opens", async () => {
    identifyCapturedFrame.mockImplementationOnce(() => new Promise(() => undefined));

    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<Scanner />} />
          <Route path="/result" element={<Result />} />
        </Routes>
      </MemoryRouter>,
    );

    await userEvent.click(await screen.findByRole("button", { name: "Cancel scan" }));

    expect(await screen.findByText("Scan canceled. Hold the right item steady to try again.")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 1, name: "Alternator" })).not.toBeInTheDocument();
  }, 10000);

  it("prevents a canceled provider response from saving after cancel", async () => {
    objectTargetState.current = null;
    let resolveScan: (value: ReturnType<typeof makeScanResult>) => void = () => undefined;
    identifyCapturedFrame.mockImplementationOnce(() => new Promise((resolve) => {
      resolveScan = resolve;
    }));

    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<Scanner />} />
          <Route path="/result" element={<Result />} />
          <Route path="/result/:id" element={<Result />} />
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

  it("rescues blurry captures by sending a label OCR hint to identify", async () => {
    assessImageQuality.mockResolvedValueOnce({
      ok: false,
      issue: "too_blurry",
      message: "Move closer and hold steady. Not enough detail to identify.",
    });

    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<Scanner />} />
          <Route path="/result" element={<Result />} />
          <Route path="/result/:id" element={<Result />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => expect(identifyCapturedFrame).toHaveBeenCalledTimes(1));
    expect(identifyCapturedFrame.mock.calls[0][2]).toBe("too_blurry");
    expect(screen.queryByText(/Move closer and hold steady/)).not.toBeInTheDocument();
  }, 10000);
});

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
