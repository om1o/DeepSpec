import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import Result from "./Result";

describe("Result", () => {
  it("shows the captured frame and Phase 2 placeholder", () => {
    render(
      <MemoryRouter
        initialEntries={[
          {
            pathname: "/result",
            state: {
              imageBase64: "data:image/jpeg;base64,test-image",
              capturedAt: "2026-05-16T00:00:00.000Z",
            },
          },
        ]}
      >
        <Routes>
          <Route path="/result" element={<Result />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { name: "Captured frame" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Captured car part" })).toHaveAttribute(
      "src",
      "data:image/jpeg;base64,test-image",
    );
    expect(screen.getByText("Phase 2 will identify this")).toBeInTheDocument();
  });

  it("handles a direct result route without captured state", () => {
    render(
      <MemoryRouter initialEntries={["/result"]}>
        <Routes>
          <Route path="/result" element={<Result />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText("No captured frame yet.")).toBeInTheDocument();
  });
});
