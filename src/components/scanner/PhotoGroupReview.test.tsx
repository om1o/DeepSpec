import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ScanPhoto } from "../../types";
import type { RequestedEvidenceGuide } from "../../types/inspectionComparison";
import { PhotoGroupReview } from "./PhotoGroupReview";

const photos: ScanPhoto[] = ["overview", "close_up", "marking", "mounting"].map((label, index) => ({
  id: `photo-${index}`, label: label as ScanPhoto["label"], capturedAt: "2026-11-05T00:00:00Z", imageBase64: `data:image/jpeg;base64,photo${index}`,
}));
const callbacks = () => ({ onChange: vi.fn(), onRelationshipChange: vi.fn(), onAdd: vi.fn(), onAnalyze: vi.fn(), onClose: vi.fn(), onDiscard: vi.fn() });
const guide: RequestedEvidenceGuide = { version: 1, kind: "marking", request: "Photograph the stamped number beside the lower bolt.", purpose: "A readable marking may distinguish the two candidate housings.", photoIds: ["earlier-photo"] };

describe("PhotoGroupReview", () => {
  it("shows the exact AI request separately from the reference and waits for explicit analysis", async () => {
    const actions = callbacks();
    render(<PhotoGroupReview photos={[photos[0]]} requestedEvidence={guide} busy={false} message={null}
      referenceNode={<img src="data:image/png;base64,earlier" alt="Selected earlier original" />} {...actions} />);
    expect(screen.getByRole("region", { name: "AI-suggested next photo" })).toHaveTextContent(guide.request);
    expect(screen.getByText(guide.purpose)).toBeInTheDocument();
    expect(screen.getByText(/Collecting a photo does not mean the request has been resolved/)).toBeInTheDocument();
    expect(screen.getByText(/Only your new photos will be analyzed/)).toBeInTheDocument();
    expect(screen.getByText("Label each new photo and state whether the photos belong together.")).toBeInTheDocument();
    expect(screen.queryByText(/start with an overview/)).not.toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Selected earlier original" })).toBeInTheDocument();
    expect(screen.getAllByRole("combobox")).toHaveLength(1);
    expect(actions.onAnalyze).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Keep draft and close" }));
    expect(actions.onClose).toHaveBeenCalledTimes(1);
    expect(actions.onAnalyze).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Analyze 1 photo" }));
    expect(actions.onAnalyze).toHaveBeenCalledTimes(1);
  });

  it("keeps the guide visible during a failed save and never interprets its text as markup", () => {
    const request = { ...guide, request: "<img src=x onerror=alert(1)> Read the label." };
    const { rerender } = render(<PhotoGroupReview photos={[photos[0]]} requestedEvidence={request} busy message="Saving photos…" {...callbacks()} />);
    expect(screen.getByText(request.request)).toBeInTheDocument();
    expect(screen.getAllByRole("img")).toHaveLength(1);
    rerender(<PhotoGroupReview photos={[photos[0]]} requestedEvidence={request} busy={false} message="Save failed; draft kept." {...callbacks()} />);
    expect(screen.getByText(request.request)).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Save failed; draft kept.");
  });

  it("does not invent an AI request for an ordinary dated capture", () => {
    render(<PhotoGroupReview photos={[photos[0]]} busy={false} message={null} {...callbacks()} />);
    expect(screen.queryByRole("region", { name: "AI-suggested next photo" })).not.toBeInTheDocument();
  });

  it("leaves a legacy group unconfirmed and changes its relationship without changing photos or running AI", async () => {
    const actions = callbacks();
    const { rerender } = render(<PhotoGroupReview photos={photos} busy={false} message={null} {...actions} />);
    expect(screen.getByRole("combobox", { name: "Photo relationship" })).toHaveValue("unknown");
    expect(screen.getByText(/Relationship unknown/)).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Photo relationship" }), "independent");
    expect(actions.onRelationshipChange).toHaveBeenCalledExactlyOnceWith("independent");
    expect(actions.onChange).not.toHaveBeenCalled();
    expect(actions.onAnalyze).not.toHaveBeenCalled();
    rerender(<PhotoGroupReview photos={photos} photoRelationship="independent" busy={false} message={null} {...actions} />);
    expect(screen.getByText(/Independent examples — do not assume/)).toBeInTheDocument();
    expect(screen.getByText(/main identification, selected area and supplied car details or complaint apply to Photo 1/)).toBeInTheDocument();
    rerender(<PhotoGroupReview photos={photos} photoRelationship="same_part_or_area" busy={false} message={null} {...actions} />);
    expect(screen.getByText(/reported by the user, not independently verified/)).toBeInTheDocument();
  });

  it("does not relabel the relationship of an already saved component group", () => {
    render(<PhotoGroupReview photos={photos} photoRelationship="independent" savedForComponent busy={false} message={null} {...callbacks()} />);
    expect(screen.getByRole("combobox", { name: "Photo relationship" })).toHaveValue("independent");
    expect(screen.getByRole("combobox", { name: "Photo relationship" })).toBeDisabled();
  });

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
    await userEvent.click(screen.getByRole("button", { name: "Add another photo" }));
    expect(actions.onAdd).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("button", { name: "Analyze 1 photo" }));
    expect(actions.onAnalyze).toHaveBeenCalledTimes(1);
    rerender(<PhotoGroupReview photos={photos} busy={false} message={null} {...actions} />);
    expect(screen.getByRole("button", { name: "Add another photo" })).toBeDisabled();
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
  it("shows the earlier reference separately and labels recovery without including it in the new photo count", async () => {
    const actions = callbacks();
    render(<PhotoGroupReview photos={[photos[0]]} busy={false} message={null}
      referenceNode={<p>Earlier original remains a separate reference.</p>} savedActionLabel="Finish dated comparison" {...actions} />);
    expect(screen.getByText("Earlier original remains a separate reference.")).toBeInTheDocument();
    expect(screen.getAllByRole("combobox")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: /Analyze/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Finish dated comparison" }));
    expect(actions.onAnalyze).toHaveBeenCalledTimes(1);
  });
});
