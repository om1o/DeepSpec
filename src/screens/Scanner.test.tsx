import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { vi } from "vitest";
import Result from "./Result";
import Scanner from "./Scanner";

const captureFrame = vi.fn(async () => "data:image/jpeg;base64,compressed-frame");
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
    cameraError: null,
    cameraState: "ready",
    captureFrame,
    markError: vi.fn(),
    markReady: vi.fn(),
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

describe("Scanner", () => {
  beforeEach(() => {
    captureFrame.mockClear();
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
    expect(identifyCapturedFrame).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("heading", { level: 1, name: "Alternator" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Captured car part" })).toHaveAttribute(
      "src",
      "data:image/jpeg;base64,compressed-frame",
    );
    expect(screen.getByText("It charges the battery while the engine runs.")).toBeInTheDocument();
    expect(screen.getByText("Saved scan")).toBeInTheDocument();
  }, 10000);
});
