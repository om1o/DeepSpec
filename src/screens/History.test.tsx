import { render, screen } from "@testing-library/react";
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

describe("History", () => {
  beforeEach(() => {
    localStorage.clear();
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
    expect(screen.getByText("electrical")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Alternator/ })).toHaveAttribute("href", "/result/lookup-1");
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
