import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { vi } from "vitest";
import Result from "./Result";
import Scanner from "./Scanner";

const captureFrame = vi.fn(async () => "data:image/jpeg;base64,compressed-frame");

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

describe("Scanner", () => {
  beforeEach(() => {
    captureFrame.mockClear();
  });

  it("captures and navigates to the placeholder result", async () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<Scanner />} />
          <Route path="/result" element={<Result />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByTestId("webcam-preview")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Identify" }));

    expect(captureFrame).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Phase 2 will identify this")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Captured car part" })).toHaveAttribute(
      "src",
      "data:image/jpeg;base64,compressed-frame",
    );
  });
});
