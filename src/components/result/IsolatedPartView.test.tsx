import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { IsolatedPartView } from "./IsolatedPartView";
import type { VisualFocusBox } from "../../types";

const frame = "data:image/jpeg;base64,frame";
const cutout = "data:image/png;base64,cutout";
const box: VisualFocusBox = { confidence: 0.9, height: 0.5, width: 0.5, x: 0.2, y: 0.2 };

describe("IsolatedPartView", () => {
  it("Tier A renders the real cutout over a blurred frame", () => {
    render(
      <IsolatedPartView
        variant="scanner"
        frameBase64={frame}
        isolatedImageBase64={cutout}
        focusBox={box}
        focusMode="mask"
        label="Engine"
      />,
    );
    expect(screen.getByTestId("focused-part-overlay")).toHaveAttribute("data-focus-mode", "mask");
    expect(screen.getByTestId("isolated-part-image")).toHaveAttribute("src", cutout);
    expect(screen.getByTestId("focused-part-window")).toBeInTheDocument();
    expect(screen.getByAltText("Reviewed scan photo").className).toContain("blur-[14px]");
  });

  it("Tier B (crop) shows a focused window and no transparent cutout", () => {
    render(
      <IsolatedPartView variant="scanner" frameBase64={frame} focusBox={box} focusMode="crop" label="Engine" />,
    );
    expect(screen.getByTestId("focused-part-overlay")).toHaveAttribute("data-focus-mode", "crop");
    expect(screen.queryByTestId("isolated-part-image")).not.toBeInTheDocument();
    expect(screen.getByTestId("focused-part-window")).toBeInTheDocument();
    expect(screen.getByAltText("Reviewed scan photo").className).toContain("blur-[14px]");
  });

  it("Tier C (full frame) shows a sharp frame and no cutout", () => {
    render(<IsolatedPartView variant="result" frameBase64={frame} focusMode="full_frame" label="Engine" />);
    expect(screen.getByTestId("result-focus-frame")).toHaveAttribute("data-focus-mode", "full_frame");
    expect(screen.queryByTestId("isolated-part-image")).not.toBeInTheDocument();
    expect(screen.getByAltText("Captured car part").className).not.toContain("blur-[14px]");
  });

  it("renders exactly one issue callout, and only when an anchored issue is present", () => {
    const { rerender } = render(
      <IsolatedPartView
        variant="scanner"
        frameBase64={frame}
        focusBox={box}
        focusMode="crop"
        label="Engine"
        issue={{ text: "Cracked housing", anchor: box }}
      />,
    );
    expect(screen.getAllByTestId("issue-callout")).toHaveLength(1);
    expect(screen.getByTestId("issue-callout")).toHaveTextContent("Cracked housing");

    rerender(
      <IsolatedPartView variant="scanner" frameBase64={frame} focusBox={box} focusMode="crop" label="Engine" issue={null} />,
    );
    expect(screen.queryByTestId("issue-callout")).not.toBeInTheDocument();
  });
});
