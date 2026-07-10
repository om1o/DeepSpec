import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { IsolatedPartView } from "./IsolatedPartView";
import { getContainedStageStyle } from "./isolatedPartViewGeometry";
import type { IsolatedObject, VisualFocusBox } from "../../types";

const frame = "data:image/jpeg;base64,frame";
const cutout = "data:image/png;base64,cutout";
const box: VisualFocusBox = { confidence: 0.9, height: 0.5, width: 0.5, x: 0.2, y: 0.2 };

const sceneObjects: IsolatedObject[] = [
  { name: "Xbox Controller", category: "unknown", primary: true, isolatedImageBase64: "data:image/png;base64,a", focusBox: { confidence: 0.9, height: 0.4, width: 0.4, x: 0.3, y: 0.3 } },
  { name: "Wall poster", category: "decor", primary: false, isolatedImageBase64: "data:image/png;base64,b", focusBox: { confidence: 0.6, height: 0.3, width: 0.2, x: 0.05, y: 0.1 } },
];

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

  it("a busy scene labels other objects and softens (not hard-blurs) the background", () => {
    const sceneChips = [
      {
        object: { name: "Band poster", category: "poster", regionLabel: "upper left", primary: false },
        box: { confidence: 0.5, height: 0.3, width: 0.3, x: 0.05, y: 0.05 },
      },
    ];
    render(
      <IsolatedPartView
        variant="scanner"
        frameBase64={frame}
        isolatedImageBase64={cutout}
        focusBox={box}
        focusMode="mask"
        label="Engine"
        sceneChips={sceneChips}
      />,
    );
    expect(screen.getByTestId("isolated-part-image")).toHaveAttribute("src", cutout);
    expect(screen.getByTestId("scene-chip")).toHaveTextContent("Band poster");
    expect(screen.getByAltText("Reviewed scan photo").className).not.toContain("blur-[14px]");
  });

  it("draws no scene chips for a single object", () => {
    render(<IsolatedPartView variant="scanner" frameBase64={frame} focusBox={box} focusMode="crop" label="Engine" />);
    expect(screen.queryByTestId("scene-chip")).not.toBeInTheDocument();
  });

  it("renders a Lens overview with one cutout + label per object when there are several", () => {
    render(<IsolatedPartView variant="scanner" frameBase64={frame} focusMode="mask" label="Xbox Controller" objects={sceneObjects} />);
    expect(screen.getByTestId("focused-part-overlay")).toHaveAttribute("data-lens", "multi");
    expect(screen.getAllByTestId("lens-object")).toHaveLength(2);
    expect(screen.getByText("Xbox Controller")).toBeInTheDocument();
    expect(screen.getByText("Wall poster")).toBeInTheDocument();
  });

  it("promotes an object to the isolated treatment on tap (its label replaces the overview labels)", async () => {
    render(<IsolatedPartView variant="scanner" frameBase64={frame} focusMode="mask" label="Xbox Controller" objects={sceneObjects} />);
    expect(screen.getAllByTestId("lens-label")).toHaveLength(2);
    await userEvent.click(screen.getAllByTestId("lens-object")[0]);
    // Overview labels give way to a single promoted "Isolated" frame for the focused object.
    expect(screen.queryAllByTestId("lens-label")).toHaveLength(0);
    expect(screen.getByTestId("lens-focused-label")).toHaveTextContent("Xbox Controller");
  });
});

describe("getContainedStageStyle (AR stage letterbox math)", () => {
  it("fills the container until the frame aspect + size are known (jsdom + first paint)", () => {
    expect(getContainedStageStyle(null, null)).toEqual({ position: "absolute", inset: 0 });
    expect(getContainedStageStyle({ width: 100, height: 100 }, null)).toEqual({ position: "absolute", inset: 0 });
    expect(getContainedStageStyle({ width: 0, height: 100 }, 1.5)).toEqual({ position: "absolute", inset: 0 });
  });

  it("letterboxes top/bottom for a landscape frame in a taller viewport", () => {
    // container 400x800 (aspect 0.5), frame 2:1 -> full width, reduced height (bars top/bottom)
    expect(getContainedStageStyle({ width: 400, height: 800 }, 2)).toEqual({
      position: "relative",
      width: "400px",
      height: "200px",
    });
  });

  it("letterboxes left/right for a portrait frame in a wider viewport", () => {
    // container 800x400 (aspect 2), frame 1:2 -> full height, reduced width (bars left/right)
    expect(getContainedStageStyle({ width: 800, height: 400 }, 0.5)).toEqual({
      position: "relative",
      width: "200px",
      height: "400px",
    });
  });

  it("fills exactly (no bars) when the frame aspect matches the viewport", () => {
    // container 600x400 (aspect 1.5), frame 1.5 -> exact fit
    expect(getContainedStageStyle({ width: 600, height: 400 }, 1.5)).toEqual({
      position: "relative",
      width: "600px",
      height: "400px",
    });
  });
});
