import { render, screen, waitFor } from "@testing-library/react";
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
  whatItDoes: "It charges the battery while the engine runs.",
  visibleObservations: ["Belt-driven metal housing is visible."],
  concerns: [],
  safetyTriage: "can_help",
  isSafetyCritical: false,
  nextAction: "Compare the scan with another angle if you need more detail.",
  needsBetterPhoto: false,
  evidence: ["The pulley and housing match common alternator shapes."],
}));

vi.mock("../hooks/useCamera", () => ({
  useCamera: () => ({
    cameraRequestId: 0,
    cameraError: null,
    cameraState: "ready",
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

// Pass all images as ok — quality logic is tested separately in imageQuality.test.ts
vi.mock("../lib/imageQuality", () => ({
  assessImageQuality: (...args: unknown[]) => assessImageQuality(...args),
}));

// Cache always misses in scanner tests — cache logic tested in scanCache.test.ts
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
    captureFrame.mockClear();
    retryCamera.mockClear();
    assessImageQuality.mockClear();
    assessImageQuality.mockResolvedValue({ ok: true });
    identifyCapturedFrame.mockClear();
    localStorage.clear();
    sessionStorage.clear();
  });

  it("captures, identifies, and navigates to the result", async () => {
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

    await userEvent.click(screen.getByRole("button", { name: "Identify" }));

    expect(captureFrame).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(identifyCapturedFrame).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole("heading", { level: 1, name: "Alternator" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Captured car part" })).toHaveAttribute(
      "src",
      "data:image/jpeg;base64,compressed-frame",
    );
    expect(screen.getByText("It charges the battery while the engine runs.")).toBeInTheDocument();
    expect(screen.getByText("Saved scan")).toBeInTheDocument();
  }, 10000);

  it("runs the generated engine test scan without saving it to history", async () => {
    window.history.pushState({}, "", "/?test=1");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(new Blob(["test-engine-image"], { type: "image/jpeg" }), { status: 200 })),
    );

    render(
      <MemoryRouter initialEntries={["/?test=1"]}>
        <Routes>
          <Route path="/" element={<Scanner />} />
          <Route path="/result" element={<Result />} />
        </Routes>
      </MemoryRouter>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Test engine photo" }));

    await waitFor(() => expect(identifyCapturedFrame).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("QA test result")).toBeInTheDocument();
    expect(screen.getByText(/not saved to history, cloud sync, or training review/i)).toBeInTheDocument();
    expect(localStorage.getItem("deep-spec:lookups")).toBeNull();
    expect(sessionStorage.getItem("deep-spec:latest-scan-state")).toBeNull();
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

    await userEvent.click(screen.getByRole("button", { name: "Identify" }));

    await waitFor(() => expect(identifyCapturedFrame).toHaveBeenCalledTimes(1));
    expect(identifyCapturedFrame.mock.calls[0][2]).toBe("too_blurry");
    expect(screen.queryByText(/Move closer and hold steady/)).not.toBeInTheDocument();
  }, 10000);
});
