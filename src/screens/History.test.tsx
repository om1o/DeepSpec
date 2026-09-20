import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { vi } from "vitest";
import History from "./History";
import { readCloudLookups } from "../services/cloudHistory";
import { LOOKUPS_STORAGE_KEY, MAX_SAVED_LOOKUPS } from "../services/storage";
import type { Lookup } from "../types";
import { emptyPartInspection } from "../lib/partInspection";

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
    expect(screen.getByText("Needs review")).toBeInTheDocument();
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

  it.each([
    [undefined, "2026-09-20T12:00:00.000Z", "Remote reviewer"],
    ["2026-09-19T12:00:00.000Z", "2026-09-20T12:00:00.000Z", "Remote reviewer"],
    ["2026-09-20T12:00:00.000Z", undefined, "Local reviewer"],
    ["2026-09-20T12:00:00.000Z", "2026-09-19T12:00:00.000Z", "Local reviewer"],
  ])("navigates with the latest inspection while preserving local image (%s / %s)", async (localTime, remoteTime, reviewer) => {
    const local = { ...lookup, inspection: localTime
      ? { ...emptyPartInspection, inspectorName: "Local reviewer", inspectedAt: localTime } : undefined };
    const remote = { ...lookup, frame: { ...lookup.frame, imageBase64: "https://example.test/signed.jpg" }, inspection: remoteTime
      ? { ...emptyPartInspection, inspectorName: "Remote reviewer", inspectedAt: remoteTime } : undefined };
    localStorage.setItem(LOOKUPS_STORAGE_KEY, JSON.stringify([local]));
    readCloudLookupsMock.mockResolvedValue({ ok: true, value: [remote, bodyLookup] });
    render(
      <MemoryRouter initialEntries={["/history"]}>
        <Routes>
          <Route path="/history" element={<History />} />
          <Route path="/result/:id" element={<NavigationLookup />} />
        </Routes>
      </MemoryRouter>,
    );
    // The second row only arrives with the cloud response, so the merge has completed.
    await screen.findByText("Rear bumper");
    await userEvent.click(screen.getByRole("link", { name: /Alternator/ }));
    const savedLookup = JSON.parse(screen.getByTestId("navigation-lookup").textContent!);
    expect(savedLookup.inspection.inspectorName).toBe(reviewer);
    expect(savedLookup.frame.imageBase64).toBe(lookup.frame.imageBase64);
    expect(savedLookup.id).toBe(lookup.id);
  });

  it("does not warn about the on-device cap just because cloud history is long", async () => {
    localStorage.setItem(LOOKUPS_STORAGE_KEY, JSON.stringify([lookup]));
    readCloudLookupsMock.mockResolvedValue({
      ok: true,
      value: makeLookups(MAX_SAVED_LOOKUPS + 10, "cloud"),
    });

    renderHistory();

    const total = MAX_SAVED_LOOKUPS + 11;
    expect(await screen.findByText(`${total}/${total} saved scans`)).toBeInTheDocument();
    expect(screen.queryByText(/scan cap reached/i)).not.toBeInTheDocument();
  });

  it("warns when the on-device store itself is full", () => {
    localStorage.setItem(LOOKUPS_STORAGE_KEY, JSON.stringify(makeLookups(MAX_SAVED_LOOKUPS, "local")));

    renderHistory();

    expect(screen.getByText(`${MAX_SAVED_LOOKUPS}-scan cap reached. Export to keep older scans.`)).toBeInTheDocument();
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

function NavigationLookup() {
  const location = useLocation();
  return <pre data-testid="navigation-lookup">{JSON.stringify(location.state.savedLookup)}</pre>;
}

function makeLookups(count: number, prefix: string): Lookup[] {
  return Array.from({ length: count }, (_, index) => ({
    ...lookup,
    id: `${prefix}-${index}`,
    createdAt: new Date(Date.UTC(2026, 4, 1, 0, index)).toISOString(),
  }));
}
