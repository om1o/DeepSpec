import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { PhotoRelationship, ScanPhoto } from "../../types";
import { PhotoEvidenceStrip } from "./PhotoEvidenceStrip";

const photos: ScanPhoto[] = [
  { id: "original-a", label: "overview", capturedAt: "2026-11-05T12:00:00Z", imageBase64: "data:image/png;base64,first" },
  { id: "original-b", label: "other", capturedAt: "2026-11-05T12:01:00Z", imageBase64: "data:image/png;base64,second" },
];

describe("photo relationship beside the original-photo strip", () => {
  it.each([
    ["same_part_or_area", "Same part or area of one car — reported by the user, not independently verified."],
    ["independent", "Independent examples — do not assume the same part, vehicle or before-and-after sequence."],
    [undefined, "Relationship unknown — a shared part, vehicle or sequence has not been established."],
  ] as const)("shows the declaration %s without converting it into visual proof", (relationship, description) => {
    render(<PhotoEvidenceStrip photos={photos} photoRelationship={relationship} pipelineVersion="identify-pipeline-2026-11-05-photo-relationship-v1" onSelect={vi.fn()} />);
    const declaration = screen.getByLabelText("Photo relationship");
    expect(declaration).toHaveTextContent(description);
    if (relationship === "same_part_or_area") {
      expect(declaration).toHaveTextContent("User-reported photo relationship:");
      expect(declaration).not.toHaveTextContent("refer to Photo 1");
    } else {
      expect(declaration).toHaveTextContent("The main identification refers to Photo 1.");
      expect(declaration).toHaveTextContent("Saved selection and supplied vehicle or complaint details, when present, refer to Photo 1.");
    }
  });

  it.each([undefined, "identify-pipeline-2026-11-05-confirmed-vehicle-v1"])("does not retroactively assign a legacy identity to Photo 1: %s", (pipelineVersion) => {
    render(<PhotoEvidenceStrip photos={photos} pipelineVersion={pipelineVersion} onSelect={vi.fn()} />);
    const declaration = screen.getByLabelText("Photo relationship");
    expect(declaration).toHaveTextContent("The main identification's per-photo scope was not recorded.");
    expect(declaration).not.toHaveTextContent("The main identification refers to Photo 1.");
  });

  it("explicitly says there is no identification when the parent supplies a null pipeline", () => {
    render(<PhotoEvidenceStrip photos={photos} photoRelationship="independent" pipelineVersion={null} onSelect={vi.fn()} />);
    expect(screen.getByLabelText("Photo relationship")).toHaveTextContent("No main identification is recorded.");
  });

  it("keeps independent images and their exact selection IDs intact", async () => {
    const before = JSON.stringify(photos), onSelect = vi.fn();
    render(<PhotoEvidenceStrip photos={photos} photoRelationship="independent" selectedId="original-a" onSelect={onSelect} />);
    const buttons = within(screen.getByRole("navigation", { name: "Inspection photos" })).getAllByRole("button");
    expect(buttons).toHaveLength(2);
    expect(buttons[0]).toHaveAttribute("aria-pressed", "true");
    expect(buttons.map((button) => button.querySelector("img")?.getAttribute("src"))).toEqual(photos.map((photo) => photo.imageBase64));
    await userEvent.click(buttons[1]);
    expect(onSelect).toHaveBeenCalledExactlyOnceWith("original-b");
    expect(JSON.stringify(photos)).toBe(before);
  });

  it("treats malformed declarations as unknown without rendering their contents", () => {
    const { container } = render(<PhotoEvidenceStrip photos={photos} photoRelationship={'<script>alert("relationship")</script>' as PhotoRelationship} onSelect={vi.fn()} />);
    expect(screen.getByLabelText("Photo relationship")).toHaveTextContent("Relationship unknown");
    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).not.toContain("alert(");
  });

  it("does not imply a relationship between images for a single photo or an empty strip", () => {
    const { rerender, container } = render(<PhotoEvidenceStrip photos={[photos[0]]} onSelect={vi.fn()} />);
    expect(screen.queryByLabelText("Photo relationship")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(1);
    rerender(<PhotoEvidenceStrip photos={[]} onSelect={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});
