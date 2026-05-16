import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import Result from "./Result";
import type { ScanAnalysisState } from "../types";

const frame = {
  imageBase64: "data:image/jpeg;base64,test-image",
  capturedAt: "2026-05-16T00:00:00.000Z",
};

const successfulScan: ScanAnalysisState = {
  frame,
  analyzedAt: "2026-05-16T00:00:05.000Z",
  result: {
    partName: "Alternator",
    confidence: "high",
    whatItDoes: "It charges the battery while the engine runs.",
    visibleObservations: ["Belt-driven metal housing is visible."],
    concerns: [],
    safetyTriage: "can_help",
    isSafetyCritical: false,
    nextAction: "Take another photo of the label if you need more detail.",
    needsBetterPhoto: false,
    evidence: ["The pulley and vented housing match common alternator shapes."],
  },
};

describe("Result", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("shows the AI identification result", () => {
    renderResult(successfulScan);

    expect(screen.getByRole("heading", { level: 1, name: "Alternator" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Captured car part" })).toHaveAttribute(
      "src",
      "data:image/jpeg;base64,test-image",
    );
    expect(screen.getByText("It charges the battery while the engine runs.")).toBeInTheDocument();
    expect(screen.getByText("Nothing concerning visible.")).toBeInTheDocument();
    expect(screen.getByText("Trust check")).toBeInTheDocument();
    expect(screen.getByText("Useful match")).toBeInTheDocument();
    expect(screen.getByText("Good")).toBeInTheDocument();
    expect(screen.getByText("The pulley and vented housing match common alternator shapes.")).toBeInTheDocument();
  });

  it("shows safety-critical guidance", () => {
    renderResult({
      ...successfulScan,
      result: {
        ...successfulScan.result!,
        partName: "Brake caliper",
        safetyTriage: "needs_professional",
        isSafetyCritical: true,
      },
    });

    expect(screen.getByText("Safety-critical")).toBeInTheDocument();
    expect(screen.getByText("Professional verification needed")).toBeInTheDocument();
    expect(screen.getByText(/Verify this with a mechanic/)).toBeInTheDocument();
  });

  it("shows incomplete data guidance when the scan needs a better photo", () => {
    renderResult({
      ...successfulScan,
      result: {
        ...successfulScan.result!,
        confidence: "low",
        safetyTriage: "needs_better_photo",
        needsBetterPhoto: true,
      },
    });

    expect(screen.getByText("Incomplete data")).toBeInTheDocument();
    expect(screen.getByText("Poor")).toBeInTheDocument();
    expect(screen.getByText("Better photo needed")).toBeInTheDocument();
    expect(screen.getByText("Move closer, add light, and center the label, connector, leak, crack, or damaged area.")).toBeInTheDocument();
  });

  it("shows low-confidence uncertainty separately from better-photo cases", () => {
    renderResult({
      ...successfulScan,
      result: {
        ...successfulScan.result!,
        confidence: "low",
        safetyTriage: "can_help",
        needsBetterPhoto: false,
      },
    });

    expect(screen.getByText("Low-confidence result")).toBeInTheDocument();
    expect(screen.getByText("Usable but weak")).toBeInTheDocument();
  });

  it("shows a friendly AI error while keeping the captured image", () => {
    renderResult({
      frame,
      errorMessage: "Too many AI lookups right now. Try again in a few minutes.",
      errorCode: "rate_limited",
      analyzedAt: "2026-05-16T00:00:05.000Z",
    });

    expect(screen.getByText("AI identification failed")).toBeInTheDocument();
    expect(screen.getByText("Too many AI lookups right now. Try again in a few minutes.")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Captured car part" })).toHaveAttribute(
      "src",
      "data:image/jpeg;base64,test-image",
    );
  });

  it("restores the latest successful scan after a refresh", () => {
    sessionStorage.setItem("deep-spec:latest-scan-state", JSON.stringify(successfulScan));

    renderResult(null);

    expect(screen.getByRole("heading", { level: 1, name: "Alternator" })).toBeInTheDocument();
    expect(screen.getByText("It charges the battery while the engine runs.")).toBeInTheDocument();
  });

  it("handles a direct result route without captured state", () => {
    renderResult(null);

    expect(screen.getByText("No captured frame yet.")).toBeInTheDocument();
  });
});

function renderResult(state: ScanAnalysisState | null) {
  render(
    <MemoryRouter
      initialEntries={[
        {
          pathname: "/result",
          state,
        },
      ]}
    >
      <Routes>
        <Route path="/result" element={<Result />} />
      </Routes>
    </MemoryRouter>,
  );
}
