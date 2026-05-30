import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { vi } from "vitest";
import History from "./History";
import { readCloudLookups } from "../services/cloudHistory";
import { LOOKUPS_STORAGE_KEY } from "../services/storage";
import type { Lookup } from "../types";

vi.mock("../services/cloudHistory", () => ({
  readCloudLookups: vi.fn(),
}));

const readCloudLookupsMock = vi.mocked(readCloudLookups);

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
};

const bodyLookup: Lookup = {
  ...lookup,
  id: "lookup-2",
  result: {
    ...lookup.result,
    partName: "Rear bumper",
    scanCategory: "body",
  },
  rating: "down",
  correction: "Rear bumper",
  scanCategory: "body",
  trainingLabel: "Rear bumper",
  trainingStatus: "user_corrected",
};

describe("History", () => {
  beforeEach(() => {
    localStorage.clear();
    readCloudLookupsMock.mockReset();
    readCloudLookupsMock.mockResolvedValue({
      ok: false,
      message: "No verified Supabase session was found.",
    });
  });

  it("shows an empty saved scan state", () => {
    renderHistory();

    expect(screen.getByRole("heading", { name: "Saved scans" })).toBeInTheDocument();
    expect(screen.getByText("No saved scans yet")).toBeInTheDocument();
  });

  it("lists saved scans with dataset category", () => {
    localStorage.setItem(LOOKUPS_STORAGE_KEY, JSON.stringify([lookup]));

    renderHistory();

    expect(screen.getByText("Alternator")).toBeInTheDocument();
    expect(screen.getByText("high confidence")).toBeInTheDocument();
    const scanLink = screen.getByRole("link", { name: /Alternator/ });
    expect(scanLink).toHaveAttribute("href", "/result/lookup-1");
    expect(scanLink).toHaveTextContent("electrical");
    expect(screen.getByText("1/1 saved scans")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export JSON" })).toBeInTheDocument();
  });

  it("filters saved scans by search, category, review status, and rating", async () => {
    localStorage.setItem(LOOKUPS_STORAGE_KEY, JSON.stringify([lookup, bodyLookup]));

    renderHistory();

    await userEvent.type(screen.getByLabelText("Search saved scans"), "bumper");
    expect(screen.getByText("Rear bumper")).toBeInTheDocument();
    expect(screen.queryByText("Alternator")).not.toBeInTheDocument();

    await userEvent.clear(screen.getByLabelText("Search saved scans"));
    await userEvent.selectOptions(screen.getByLabelText("Filter category"), "electrical");
    expect(screen.getByText("Alternator")).toBeInTheDocument();
    expect(screen.queryByText("Rear bumper")).not.toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText("Filter category"), "all");
    await userEvent.selectOptions(screen.getByLabelText("Filter review status"), "user_corrected");
    expect(screen.getByText("Rear bumper")).toBeInTheDocument();
    expect(screen.queryByText("Alternator")).not.toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText("Filter review status"), "all");
    await userEvent.selectOptions(screen.getByLabelText("Filter rating"), "up");
    expect(screen.getByText("Alternator")).toBeInTheDocument();
    expect(screen.queryByText("Rear bumper")).not.toBeInTheDocument();
  });

  it("loads cloud-backed scans", async () => {
    readCloudLookupsMock.mockResolvedValue({
      ok: true,
      value: [lookup],
    });

    renderHistory();

    expect(await screen.findByText("Alternator")).toBeInTheDocument();
    expect(screen.getByText("1/1 saved scans")).toBeInTheDocument();
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
