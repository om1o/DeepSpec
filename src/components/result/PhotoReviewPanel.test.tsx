import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { IdentificationResult, PhotoReview, ScanAnalysisState } from "../../types";
import { PhotoReviewPanel } from "./PhotoReviewPanel";

const photos = ["a", "b", "c", "d"].map((id) => ({ id, label: "other" as const, capturedAt: "2026-11-05T12:00:00Z", imageBase64: `data:image/png;base64,${id}` }));
const review: PhotoReview = { version: 1, photos: [
  { photoId: "a", status: "observations_returned", summary: "Three mounting holes are visible." },
  { photoId: "b", status: "limited_view", summary: "Two holes are visible; one edge is hidden." },
  { photoId: "c", status: "not_assessed", summary: "No assessment was returned for this view." },
], disagreements: [{ id: "mounts", photoIds: ["a", "b"], description: "The visible hole counts differ; the obscured edge may explain this.", nextEvidence: { request: "Show the entire mounting face.", purpose: "Check whether a hole is obscured." } }] };
const scan = (photoReview?: PhotoReview): Pick<ScanAnalysisState, "frame" | "photos" | "result"> => ({ frame: photos[0], photos,
  result: { partName: "Bracket", photoReview } as IdentificationResult });

describe("photo review panel", () => {
  it("keeps the recorded causal overclaim separate from linked appearance and unconfirmed causes", async () => {
    const originalSummary = "Close-up view of an uninstalled brake rotor exhibiting thermal cracking.";
    const item = scan({ version: 1, photos: [{ photoId: "c", status: "observations_returned", summary: originalSummary }], disagreements: [] });
    item.result!.conditionAssessment = { version: 1, observations: [{ id: "o1", text: "Numerous fine cracks visible across the rotor friction surface.", photoIds: ["c"] }],
      possibleCauses: [{ text: "Severe thermal stress from high-performance use or heavy braking.", observationIds: ["o1"] }], unknowns: ["Exact depth and structural propagation of the surface cracks."] };
    const before = JSON.stringify(item);
    const { container } = render(<PhotoReviewPanel scan={item} onSelectPhoto={vi.fn()} />);
    const thirdPhoto = screen.getByRole("button", { name: "View saved Photo 3 — Other angle" }).closest("li")!;
    expect(within(thirdPhoto).getByText("AI-reported appearance")).toBeInTheDocument();
    expect(thirdPhoto).toHaveTextContent(item.result!.conditionAssessment.observations[0].text);
    expect(thirdPhoto).toHaveTextContent("Possible causes — unconfirmed");
    expect(thirdPhoto).toHaveTextContent(item.result!.conditionAssessment.possibleCauses[0].text);
    const original = within(thirdPhoto).getByText(originalSummary).closest("details")!;
    expect(original).not.toHaveAttribute("open");
    await userEvent.click(within(original).getByText("Original AI summary — unverified"));
    expect(original).toHaveAttribute("open");
    expect(container).toHaveTextContent("Unresolved across this inspection");
    expect(container).toHaveTextContent(item.result!.conditionAssessment.unknowns[0]);
    expect(screen.getByRole("button", { name: "View saved Photo 1 — Other angle" }).closest("li")).not.toHaveTextContent("Numerous fine cracks");
    expect(JSON.stringify(item)).toBe(before);
  });

  it("shows assessed, limited, unassessed and omitted originals without treating them as equivalent", async () => {
    const onSelectPhoto = vi.fn();
    render(<PhotoReviewPanel scan={scan(review)} onSelectPhoto={onSelectPhoto} />);
    const panel = screen.getByRole("region", { name: "Photo review" });
    expect(panel).toHaveTextContent("3 of 4 photos have an AI review entry");
    expect(panel).toHaveTextContent("Observations returned");
    expect(panel).toHaveTextContent("Limited view");
    expect(panel).toHaveTextContent("Not assessed");
    expect(panel).toHaveTextContent("No review returned");
    await userEvent.click(within(panel).getByRole("button", { name: "View Photo 2 — Other angle for disagreement mounts" }));
    await userEvent.click(within(panel).getByRole("button", { name: "View saved Photo 4 — Other angle" }));
    expect(onSelectPhoto.mock.calls).toEqual([["b"], ["d"]]);
    expect(panel).toHaveTextContent("Show the entire mounting face.");
    expect(panel).toHaveTextContent("Check whether a hole is obscured.");
  });
  it("does not invent coverage for a legacy result", () => {
    render(<PhotoReviewPanel scan={scan()} onSelectPhoto={vi.fn()} />);
    expect(screen.getAllByText("No review returned")).toHaveLength(4);
    expect(screen.getByRole("region", { name: "Photo review" })).toHaveTextContent("Photo-by-photo review was not reported");
  });
  it("omits all misleading partial claims if a disagreement cites a missing original", () => {
    const invalid = { ...review, disagreements: [{ ...review.disagreements[0], photoIds: ["a", "wrong"] }] };
    render(<PhotoReviewPanel scan={scan(invalid)} onSelectPhoto={vi.fn()} />);
    expect(screen.getAllByText("No review returned")).toHaveLength(4);
    expect(screen.getByRole("region", { name: "Photo review" })).toHaveTextContent("could not be validated");
    expect(screen.queryByText(review.photos[0].summary)).not.toBeInTheDocument();
  });
  it("labels no result honestly and renders model text inertly", () => {
    const malicious = { ...review, photos: [{ ...review.photos[0], summary: '<img src=x onerror="alert(1)">' }], disagreements: [] };
    const { container, rerender } = render(<PhotoReviewPanel scan={scan(malicious)} onSelectPhoto={vi.fn()} />);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText(malicious.photos[0].summary)).toBeInTheDocument();
    rerender(<PhotoReviewPanel scan={{ frame: photos[0], photos }} onSelectPhoto={vi.fn()} />);
    expect(screen.getByRole("region", { name: "Photo review" })).toHaveTextContent("No AI identification or photo review is recorded");
    expect(screen.getAllByText("No review returned")).toHaveLength(4);
  });
});
