import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import History from "./History";
import { LOOKUPS_STORAGE_KEY } from "../services/storage";
import type { Lookup } from "../types";

const lookup: Lookup = {
  id: "lookup-1",
  createdAt: "2026-05-16T00:00:00.000Z",
  frame: {
    imageBase64: "data:image/jpeg;base64,test-image",
    capturedAt: "2026-05-16T00:00:00.000Z",
  },
  result: {
    partName: "Alternator",
    confidence: "high",
    scanCategory: "electrical",
    candidateMatches: [],
    whatItDoes: "It charges the battery while the engine runs.",
    visibleObservations: ["Belt-driven housing is visible."],
    evidenceRegions: [],
    concerns: [],
    safetyTriage: "can_help",
    isSafetyCritical: false,
    nextAction: "Take another photo if needed.",
    needsBetterPhoto: false,
    evidence: ["The pulley and housing match an alternator."],
    sourceLinks: [],
  },
  analyzedAt: "2026-05-16T00:00:05.000Z",
  rating: "up",
  correction: null,
  notes: "",
  scanCategory: "electrical",
  trainingLabel: "Alternator",
  trainingStatus: "user_confirmed",
  chatHistory: [],
  modelRuns: [],
  syncEvents: [],
};

const correctedBrakeLookup: Lookup = {
  ...lookup,
  id: "lookup-2",
  result: {
    ...lookup.result!,
    partName: "Brake caliper",
    confidence: "low",
    scanCategory: "brakes",
    whatItDoes: "It clamps the brake pads against the rotor.",
  },
  rating: "down",
  correction: "Brake caliper",
  notes: "Front wheel grinding.",
  scanCategory: "brakes",
  trainingLabel: "Brake caliper",
  trainingStatus: "user_corrected",
};

describe("History", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("shows an empty saved scan state", () => {
    renderHistory();

    expect(screen.getByRole("heading", { name: "Saved scans" })).toBeInTheDocument();
    expect(screen.getByText("No saved scans yet")).toBeInTheDocument();
  });

  it("lists saved scans with dataset category", () => {
    localStorage.setItem(LOOKUPS_STORAGE_KEY, JSON.stringify([lookup]));

    renderHistory();

    const scanCard = screen.getByRole("link", { name: /Alternator/ });
    expect(within(scanCard).getByText("Alternator")).toBeInTheDocument();
    expect(within(scanCard).getByText("high confidence")).toBeInTheDocument();
    expect(within(scanCard).getByText("electrical")).toBeInTheDocument();
    expect(scanCard).toHaveAttribute("href", "/result/lookup-1");
  });

  it("filters saved scans by search, review status, category, and confidence", async () => {
    localStorage.setItem(LOOKUPS_STORAGE_KEY, JSON.stringify([lookup, correctedBrakeLookup]));

    renderHistory();

    expect(screen.getByText("2 of 2")).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText("Search scans"), "brake");

    expect(screen.getByText("1 of 2")).toBeInTheDocument();
    expect(screen.getByText("Brake caliper")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Alternator/ })).not.toBeInTheDocument();

    await userEvent.clear(screen.getByLabelText("Search scans"));
    await userEvent.selectOptions(screen.getByLabelText("Review status"), "user_corrected");
    await userEvent.selectOptions(screen.getByLabelText("Confidence"), "low");

    expect(screen.getByText("Brake caliper")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Alternator/ })).not.toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText("Category"), "electrical");

    expect(screen.getByText("0 of 2")).toBeInTheDocument();
    expect(screen.getByText("No scans match those filters")).toBeInTheDocument();
  });

  it("exports saved scans with dataset fields", async () => {
    const createObjectURL = vi.fn(() => "blob:deep-spec-dataset");
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    localStorage.setItem(LOOKUPS_STORAGE_KEY, JSON.stringify([lookup]));

    renderHistory();

    await userEvent.click(screen.getByRole("button", { name: "Export dataset" }));

    expect(click).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:deep-spec-dataset");
    const blob = createObjectURL.mock.calls[0]?.[0] as Blob;
    const payload = JSON.parse(await blob.text()) as {
      scanCount: number;
      scans: Array<Record<string, unknown>>;
    };
    expect(payload.scanCount).toBe(1);
    expect(payload.scans[0]).toMatchObject({
      imageBase64: "data:image/jpeg;base64,test-image",
      result: expect.objectContaining({ partName: "Alternator" }),
      scanCategory: "electrical",
      trainingLabel: "Alternator",
      trainingStatus: "user_confirmed",
    });
  });

  it("exports a review queue for saved scans that need triage", async () => {
    const createObjectURL = vi.fn(() => "blob:deep-spec-review-queue");
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    localStorage.setItem(LOOKUPS_STORAGE_KEY, JSON.stringify([lookup, correctedBrakeLookup]));

    renderHistory();

    await userEvent.click(screen.getByRole("button", { name: "Export review queue" }));

    expect(click).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:deep-spec-review-queue");
    const blob = createObjectURL.mock.calls[0]?.[0] as Blob;
    const payload = JSON.parse(await blob.text()) as {
      queueCount: number;
      items: Array<Record<string, unknown>>;
    };
    expect(payload.queueCount).toBe(1);
    expect(payload.items[0]).toMatchObject({
      id: "lookup-2",
      priority: "high",
      reasons: expect.arrayContaining(["marked_wrong", "user_correction", "low_confidence"]),
      review: expect.objectContaining({
        correctionText: "Brake caliper",
        reviewStatus: "user_corrected",
      }),
    });
  });
});

function renderHistory() {
  render(
    <MemoryRouter initialEntries={["/history"]}>
      <Routes>
        <Route path="/history" element={<History />} />
      </Routes>
    </MemoryRouter>,
  );
}
