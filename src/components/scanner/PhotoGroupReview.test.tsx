import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ScanPhoto } from "../../types";
import { PhotoGroupReview } from "./PhotoGroupReview";

const photos: ScanPhoto[] = ["overview", "close_up", "marking", "mounting"].map((label, index) => ({
  id: `photo-${index}`, label: label as ScanPhoto["label"], capturedAt: "2026-11-05T00:00:00Z", imageBase64: `data:image/jpeg;base64,photo${index}`,
}));
const callbacks = () => ({ onChange: vi.fn(), onAdd: vi.fn(), onAnalyze: vi.fn(), onClose: vi.fn(), onDiscard: vi.fn() });

describe("PhotoGroupReview", () => {
  it("shows four labeled source photos and changes only the chosen photo label", async () => {
    const actions = callbacks();
    render(<PhotoGroupReview photos={photos} busy={false} message={null} {...actions} />);
    expect(screen.getByRole("dialog", { name: "Review inspection photos" })).toBeInTheDocument();
    ["Overview", "Close-up", "Label or marking", "Mounting points"].forEach((label, index) => {
      expect(screen.getByRole("img", { name: `Photo ${index + 1}: ${label}` })).toHaveAttribute("src", photos[index].imageBase64);
      expect(screen.getByRole("combobox", { name: `Photo ${index + 1} view` })).toHaveValue(photos[index].label);
    });
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Photo 2 view" }), "other");
    expect(actions.onChange).toHaveBeenCalledExactlyOnceWith(photos.map((photo, index) => index === 1 ? { ...photo, label: "other" } : photo));
    expect(photos[1].label).toBe("close_up");
  });

  it("removes only the chosen photo while retaining identities and order", async () => {
    const actions = callbacks();
    render(<PhotoGroupReview photos={photos} busy={false} message={null} {...actions} />);
    await userEvent.click(screen.getByRole("button", { name: "Remove photo 2" }));
    expect(actions.onChange).toHaveBeenCalledExactlyOnceWith([photos[0], photos[2], photos[3]]);
  });

  it("keeps a one-photo draft valid and offers another angle until the four-photo limit", async () => {
    const actions = callbacks();
    const { rerender } = render(<PhotoGroupReview photos={[photos[0]]} busy={false} message={null} {...actions} />);
    expect(screen.queryByRole("button", { name: /Remove photo/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Add another angle" }));
    expect(actions.onAdd).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("button", { name: "Analyze 1 photo" }));
    expect(actions.onAnalyze).toHaveBeenCalledTimes(1);
    rerender(<PhotoGroupReview photos={photos} busy={false} message={null} {...actions} />);
    expect(screen.getByRole("button", { name: "Add another angle" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Analyze 4 photos" })).toBeEnabled();
  });

  it("separates keeping a draft from explicitly discarding it", async () => {
    const actions = callbacks();
    render(<PhotoGroupReview photos={photos} busy={false} message="Photos saved on this device." {...actions} />);
    expect(screen.getByRole("status")).toHaveTextContent("Photos saved on this device.");
    await userEvent.click(screen.getByRole("button", { name: "Keep draft and close" }));
    expect(actions.onClose).toHaveBeenCalledTimes(1);
    expect(actions.onDiscard).not.toHaveBeenCalled();
    expect(actions.onAnalyze).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Discard draft" }));
    expect(actions.onDiscard).toHaveBeenCalledTimes(1);
  });

  it("blocks all mutating or dismissal controls while saving or analyzing", async () => {
    const actions = callbacks();
    render(<PhotoGroupReview photos={photos.slice(0, 2)} busy message="Saving photos…" {...actions} />);
    screen.getAllByRole("button").forEach((button) => expect(button).toBeDisabled());
    screen.getAllByRole("combobox").forEach((select) => expect(select).toBeDisabled());
    await userEvent.click(screen.getByRole("button", { name: "Discard draft" }));
    await userEvent.click(screen.getByRole("button", { name: "Analyze 2 photos" }));
    expect(actions.onDiscard).not.toHaveBeenCalled();
    expect(actions.onAnalyze).not.toHaveBeenCalled();
    expect(actions.onChange).not.toHaveBeenCalled();
  });
});
