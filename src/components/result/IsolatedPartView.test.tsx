import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { IsolatedPartView } from "./IsolatedPartView";
import { edgeSafeShift, getContainedStageStyle, getFocusLabelPlacement } from "./isolatedPartViewGeometry";
import type { IsolatedObject, VisualFocusBox } from "../../types";

const frame = "data:image/jpeg;base64,frame";
const cutout = "data:image/png;base64,cutout";
const box: VisualFocusBox = { confidence: 0.9, height: 0.5, width: 0.5, x: 0.2, y: 0.2 };

const sceneObjects: IsolatedObject[] = [
  { name: "Xbox Controller", category: "unknown", primary: true, isolatedImageBase64: "data:image/png;base64,a", focusBox: { confidence: 0.9, height: 0.4, width: 0.4, x: 0.3, y: 0.3 } },
  { name: "Wall poster", category: "decor", primary: false, isolatedImageBase64: "data:image/png;base64,b", focusBox: { confidence: 0.6, height: 0.3, width: 0.2, x: 0.05, y: 0.1 } },
];

describe("IsolatedPartView", () => {
  it("falls back to the aligned crop when a cutout fails and recovers for a new cutout", () => {
    const props = { variant: "result" as const, frameBase64: frame, focusBox: box, focusMode: "mask" as const, label: "Engine" };
    const { rerender } = render(<IsolatedPartView {...props} isolatedImageBase64={cutout} />);
    fireEvent.error(screen.getByTestId("isolated-part-image"));
    expect(screen.queryByTestId("isolated-part-image")).not.toBeInTheDocument();
    expect(screen.getByTestId("focused-part-label")).toHaveTextContent("Focused");
    expect(screen.getByTestId("focused-part-window")).toHaveStyle({ left: "20%", top: "20%", width: "50%", height: "50%" });

    rerender(<IsolatedPartView {...props} isolatedImageBase64="data:image/png;base64,replacement" />);
    expect(screen.getByTestId("isolated-part-image")).toHaveAttribute("src", "data:image/png;base64,replacement");
    expect(screen.getByTestId("focused-part-label")).toHaveTextContent("Isolated");
  });

  it("keeps the full photo readable when a failed cutout has no focus box", () => {
    render(<IsolatedPartView variant="result" frameBase64={frame} isolatedImageBase64={cutout} focusMode="mask" label="Engine" />);
    fireEvent.error(screen.getByTestId("isolated-part-image"));
    expect(screen.queryByTestId("isolated-part-image")).not.toBeInTheDocument();
    expect(screen.getByTestId("focused-part-label")).toHaveTextContent("In view");
    expect(screen.getByAltText("Captured car part").className).not.toContain("blur-[14px]");
  });

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

  it("shows the untouched original without masks, outlines, scene labels, or issue callouts", async () => {
    render(<IsolatedPartView variant="result" frameBase64={frame} focusBox={box} focusMode="mask" isolatedImageBase64={cutout} label="Engine" issue={{ text: "Crack", anchor: box }} />);
    await userEvent.click(screen.getByRole("button", { name: "Original", exact: true }));
    expect(screen.getByRole("button", { name: "Original", exact: true })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByAltText("Captured car part")).toHaveAttribute("src", frame);
    expect(screen.getByAltText("Captured car part").className).not.toMatch(/blur|brightness|contrast|saturate/);
    expect(screen.queryByTestId("isolated-part-image")).not.toBeInTheDocument();
    expect(screen.queryByTestId("focused-part-window")).not.toBeInTheDocument();
    expect(screen.queryByTestId("issue-callout")).not.toBeInTheDocument();
  });

  it("shows an outline on the unchanged source and restores the cutout when requested", async () => {
    render(<IsolatedPartView variant="result" frameBase64={frame} focusBox={box} focusMode="mask" isolatedImageBase64={cutout} label="Engine" />);
    await userEvent.click(screen.getByRole("button", { name: "Outline", exact: true }));
    expect(screen.getByTestId("focused-part-window")).toHaveStyle({ left: "20%", top: "20%" });
    expect(screen.getByAltText("Captured car part").className).not.toMatch(/blur|brightness|contrast/);
    expect(screen.queryByTestId("isolated-part-image")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Cutout", exact: true }));
    expect(screen.getByTestId("isolated-part-image")).toHaveAttribute("src", cutout);
  });

  it("labels a crop fallback explicitly and does not offer an unsaved correction without its callback", () => {
    render(<IsolatedPartView variant="result" frameBase64={frame} focusBox={box} focusMode="crop" label="Engine" />);
    expect(screen.getByTestId("focused-part-label")).toHaveTextContent("Crop only");
    expect(screen.queryByRole("button", { name: "Correct area" })).not.toBeInTheDocument();
  });

  it("applies a bounded keyboard-adjustable correction only on explicit confirmation", async () => {
    const onCorrectFocus = vi.fn();
    render(<IsolatedPartView variant="result" frameBase64={frame} focusBox={box} focusMode="mask" isolatedImageBase64={cutout} label="Engine" onCorrectFocus={onCorrectFocus} />);
    await userEvent.click(screen.getByRole("button", { name: "Correct area" }));
    expect(screen.queryByTestId("isolated-part-image")).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("slider", { name: "Selection x" }), { target: { value: "40" } });
    fireEvent.change(screen.getByRole("slider", { name: "Selection width" }), { target: { value: "60" } });
    expect(onCorrectFocus).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Apply area" }));
    expect(onCorrectFocus).toHaveBeenCalledExactlyOnceWith({ ...box, x: 0.4, width: 0.6, confidence: 0 }, null);
    expect(screen.getByRole("button", { name: "Outline", exact: true })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByTestId("focus-area-editor")).not.toBeInTheDocument();
  });

  it("cancels an edit without changing parent evidence", async () => {
    const onCorrectFocus = vi.fn();
    render(<IsolatedPartView variant="result" frameBase64={frame} focusBox={box} focusMode="crop" label="Engine" onCorrectFocus={onCorrectFocus} />);
    await userEvent.click(screen.getByRole("button", { name: "Correct area" }));
    fireEvent.change(screen.getByRole("slider", { name: "Selection y" }), { target: { value: "30" } });
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCorrectFocus).not.toHaveBeenCalled();
    expect(screen.getByTestId("focused-part-window")).toHaveStyle({ top: "20%" });
  });

  it("normalizes a reversed pointer drag against the photo stage rather than the viewport", async () => {
    const onCorrectFocus = vi.fn();
    render(<IsolatedPartView variant="result" frameBase64={frame} focusBox={box} focusMode="crop" label="Engine" onCorrectFocus={onCorrectFocus} />);
    await userEvent.click(screen.getByRole("button", { name: "Correct area" }));
    const surface = screen.getByTestId("focus-area-editor");
    vi.spyOn(surface, "getBoundingClientRect").mockReturnValue({ left: 100, top: 200, width: 400, height: 200, right: 500, bottom: 400, x: 100, y: 200, toJSON: () => ({}) });
    const pointer = (type: string, x: number, y: number) => {
      const event = new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y });
      Object.defineProperty(event, "pointerId", { value: 1 });
      fireEvent(surface, event);
    };
    pointer("pointerdown", 420, 360);
    pointer("pointermove", 180, 240);
    pointer("pointerup", 180, 240);
    await userEvent.click(screen.getByRole("button", { name: "Apply area" }));
    const [corrected, index] = onCorrectFocus.mock.calls[0];
    expect(index).toBeNull();
    expect(corrected.x).toBeCloseTo(0.2);
    expect(corrected.y).toBeCloseTo(0.2);
    expect(corrected.width).toBeCloseTo(0.6);
    expect(corrected.height).toBeCloseTo(0.6);
  });

  it("keeps puzzle selection while switching views and corrects the selected ordered object", async () => {
    const onCorrectFocus = vi.fn();
    render(<IsolatedPartView variant="result" frameBase64={frame} focusMode="mask" label="Controller" objects={[sceneObjects[1], sceneObjects[0]]} onCorrectFocus={onCorrectFocus} />);
    expect(screen.getByRole("button", { name: "Correct area" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Select Wall poster" }));
    await userEvent.click(screen.getByRole("button", { name: "Original", exact: true }));
    expect(screen.queryByTestId("lens-object")).not.toBeInTheDocument();
    expect(screen.queryByTestId("lens-focused-frame")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Outline", exact: true }));
    expect(screen.getByRole("button", { name: "Select Wall poster" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByAltText("Isolated Wall poster")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Correct area" }));
    fireEvent.change(screen.getByRole("slider", { name: "Selection x" }), { target: { value: "10" } });
    await userEvent.click(screen.getByRole("button", { name: "Apply area" }));
    expect(onCorrectFocus).toHaveBeenCalledExactlyOnceWith({ ...sceneObjects[1].focusBox, x: 0.1, confidence: 0 }, 1);
  });

  it("retains controlled multi-object taps and falls back honestly when a secondary mask fails", async () => {
    const onFocusObject = vi.fn();
    render(<IsolatedPartView variant="scanner" frameBase64={frame} focusMode="mask" label="Controller" objects={sceneObjects} focusedObjectIndex={1} onFocusObject={onFocusObject} />);
    fireEvent.error(screen.getByAltText("Isolated Wall poster"));
    expect(screen.queryByAltText("Isolated Wall poster")).not.toBeInTheDocument();
    expect(screen.getByTestId("lens-focused-label")).toHaveTextContent("Crop only");
    expect(screen.getByRole("button", { name: "Select Wall poster" }).style.backgroundImage).toContain(frame);
    await userEvent.click(screen.getByRole("button", { name: "Select Xbox Controller" }));
    expect(onFocusObject).toHaveBeenCalledWith(0);
    await userEvent.click(screen.getByRole("button", { name: "Show all objects" }));
    expect(onFocusObject).toHaveBeenCalledWith(null);
  });

  it("does not carry an unfinished correction into a different photo", async () => {
    const onCorrectFocus = vi.fn();
    const props = { variant: "result" as const, focusBox: box, focusMode: "crop" as const, label: "Engine", onCorrectFocus };
    const { rerender } = render(<IsolatedPartView {...props} frameBase64={frame} />);
    await userEvent.click(screen.getByRole("button", { name: "Correct area" }));
    rerender(<IsolatedPartView {...props} frameBase64="data:image/jpeg;base64,new-photo" />);
    expect(screen.queryByTestId("focus-area-editor")).not.toBeInTheDocument();
    rerender(<IsolatedPartView {...props} frameBase64={frame} />);
    expect(screen.queryByTestId("focus-area-editor")).not.toBeInTheDocument();
    expect(onCorrectFocus).not.toHaveBeenCalled();
  });

  it("keeps corrected puzzle components selectable after their old cutout is discarded", async () => {
    const objects = sceneObjects.map((object) => ({ ...object, focusMode: "crop" as const, isolatedImageBase64: "", correctedAt: "2026-11-05T00:00:00Z" }));
    render(<IsolatedPartView variant="result" frameBase64={frame} focusMode="crop" label="Controller" objects={objects} />);
    expect(screen.getAllByTestId("lens-object")).toHaveLength(2);
    expect(screen.getAllByText("Crop only")).toHaveLength(2);
    expect(screen.queryByAltText("Isolated Xbox Controller")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Select Xbox Controller" }));
    expect(screen.getByTestId("lens-focused-label")).toHaveTextContent("Crop only");
  });

  it("does not reuse stale cutout bytes for an object explicitly marked as a crop", () => {
    render(<IsolatedPartView variant="result" frameBase64={frame} focusMode="mask" label="Controller" objects={sceneObjects.map((object) => ({ ...object, focusMode: "crop" }))} />);
    expect(screen.queryByAltText("Isolated Xbox Controller")).not.toBeInTheDocument();
    expect(screen.getAllByText("Crop only")).toHaveLength(2);
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

describe("edge-safe label placement (labels stay inside the overflow-hidden stage)", () => {
  const box = (x: number, y: number, width: number, height: number): VisualFocusBox => ({ x, y, width, height, confidence: 1 });

  it("shifts a label by its anchor fraction: flush-left at the left edge, centred mid-stage, flush-right at the right", () => {
    expect(edgeSafeShift(0)).toBe("0%");
    expect(edgeSafeShift(0.5)).toBe("-50%");
    expect(edgeSafeShift(1)).toBe("-100%");
    expect(edgeSafeShift(-0.2)).toBe("0%");
    expect(edgeSafeShift(1.3)).toBe("-100%");
  });

  it("hangs the focus label from the box edge with more stage beside it", () => {
    // Box right of centre ending before 82%: the old rule left-anchored it and it ran 62px off-stage.
    expect(getFocusLabelPlacement(box(0.58, 0.45, 0.22, 0.2))).toMatchObject({ right: 10 });
    expect(getFocusLabelPlacement(box(0.1, 0.45, 0.22, 0.2))).toMatchObject({ left: 10 });
  });

  it("caps the focus label to the room on its side, as % of the focus frame's width", () => {
    // Left-anchored at x=0.45 with width 0.1: 55% of the stage = 550% of the frame.
    expect(getFocusLabelPlacement(box(0.45, 0.5, 0.1, 0.1)).maxWidth).toBe("min(300px, calc(550.00% - 18px))");
  });

  it("puts the label above the box, or below when the box hugs the top", () => {
    expect(getFocusLabelPlacement(box(0.2, 0.4, 0.2, 0.2))).toMatchObject({ bottom: "calc(100% + 10px)" });
    expect(getFocusLabelPlacement(box(0.2, 0.05, 0.2, 0.2))).toMatchObject({ top: "calc(100% + 10px)" });
  });
});
