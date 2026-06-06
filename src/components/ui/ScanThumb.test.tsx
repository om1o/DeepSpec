import { fireEvent, render, screen } from "@testing-library/react";
import ScanThumb from "./ScanThumb";

describe("ScanThumb", () => {
  it("shows a placeholder when no src is provided", () => {
    render(<ScanThumb src={undefined} alt="QA part" />);
    expect(screen.getByText("Photo unavailable")).toBeInTheDocument();
  });

  it("falls back to the placeholder when the image fails to load", () => {
    render(<ScanThumb src="data:image/png;base64,broken" alt="QA part" />);
    fireEvent.error(screen.getByAltText("QA part"));
    expect(screen.getByText("Photo unavailable")).toBeInTheDocument();
  });
});
