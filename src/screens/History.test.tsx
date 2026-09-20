import { accountStorageKey, setActiveAccount } from "../lib/accountScope";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { vi } from "vitest";
import History from "./History";
import { readCloudLookups } from "../services/cloudHistory";
import { getLookups, LOOKUPS_STORAGE_KEY, MAX_SAVED_LOOKUPS, recordCloudSaveAttempt, updateLookup } from "../services/storage";
import { syncLookupToCloud } from "../services/cloudSync";
import type { Lookup } from "../types";
import { emptyPartInspection } from "../lib/partInspection";

vi.mock("../services/cloudHistory", () => ({
  readCloudLookups: vi.fn(),
}));
vi.mock("../services/cloudSync", () => ({ syncLookupToCloud: vi.fn() }));

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
    vi.mocked(syncLookupToCloud).mockReset();
    readCloudLookupsMock.mockResolvedValue({
      ok: false,
      message: "No verified Supabase session was found.",
    });
  });

  afterEach(() => vi.restoreAllMocks());

  it("refreshes a receipt while History stays open without refetching cloud history", async () => {
    localStorage.setItem(accountStorageKey(LOOKUPS_STORAGE_KEY), JSON.stringify([lookup]));
    renderHistory();
    await waitFor(() => expect(readCloudLookupsMock).toHaveBeenCalledTimes(1));
    act(() => { recordCloudSaveAttempt(lookup.id, { attemptId: "done", attemptedAt: new Date().toISOString(), status: "acknowledged", scope: "scan" }); });
    expect(await screen.findByText("Last cloud save acknowledged")).toBeInTheDocument();
    expect(readCloudLookupsMock).toHaveBeenCalledTimes(1);
  });

  it("retries current device content once and shows a failure without losing it", async () => {
    localStorage.setItem(accountStorageKey(LOOKUPS_STORAGE_KEY), JSON.stringify([lookup]));
    let complete!: (value: { ok: false; message: string }) => void;
    vi.mocked(syncLookupToCloud).mockImplementation(() => new Promise((resolve) => { complete = resolve; }));
    renderHistory();
    act(() => { updateLookup(lookup.id, { notes: "Latest receiving note" }); });
    const retry = screen.getByRole("button", { name: "Save Alternator to cloud" });
    await userEvent.click(retry);
    expect(retry).toBeDisabled();
    expect(syncLookupToCloud).toHaveBeenCalledTimes(1);
    expect(syncLookupToCloud).toHaveBeenCalledWith(expect.objectContaining({ notes: "Latest receiving note" }));
    await act(async () => { complete({ ok: false, message: "Cloud unavailable; retry later." }); });
    expect(screen.getByRole("status")).toHaveTextContent("Cloud unavailable");
    expect(getLookups()).toHaveLength(1);
    expect(retry).toBeEnabled();
  });

  it("discards a retry completion after changing accounts", async () => {
    localStorage.setItem(accountStorageKey(LOOKUPS_STORAGE_KEY), JSON.stringify([lookup]));
    let complete!: (value: { ok: true; message: string }) => void;
    vi.mocked(syncLookupToCloud).mockImplementation(() => new Promise((resolve) => { complete = resolve; }));
    renderHistory();
    await userEvent.click(screen.getByRole("button", { name: "Save Alternator to cloud" }));
    setActiveAccount("other");
    await act(async () => { complete({ ok: true, message: "Old account upload done" }); });
    expect(screen.queryByText("Old account upload done")).not.toBeInTheDocument();
    expect(getLookups()).toEqual([]);
  });

  it.each([false, true])("protects a newer cloud inspection already shown before retrying (storage failure: %s)", async (storageFailure) => {
    localStorage.setItem(accountStorageKey(LOOKUPS_STORAGE_KEY), JSON.stringify([lookup]));
    const inspection = { ...emptyPartInspection, confirmedPartName: "Alternator", identityEvidence: "Stamped marking", inspectorName: "New inspector", inspectedAt: "2026-09-20T12:00:00.000Z" };
    readCloudLookupsMock.mockResolvedValue({ ok: true, value: [{ ...lookup, inspection }] });
    vi.mocked(syncLookupToCloud).mockResolvedValue({ ok: false, message: "Cloud unavailable" });
    renderHistory();
    await screen.findByText("Identity recorded by inspector");
    if (storageFailure) vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("storage unavailable"); });
    await userEvent.click(screen.getByRole("button", { name: "Save Alternator to cloud" }));
    if (storageFailure) {
      expect(syncLookupToCloud).not.toHaveBeenCalled();
      expect(screen.getByRole("status")).toHaveTextContent("stopped to protect the newer inspection");
      return;
    }
    expect(syncLookupToCloud).toHaveBeenCalledWith(expect.objectContaining({ inspection }));
    expect(getLookups()[0].inspection).toEqual(inspection);
  });

  it.each([
    [undefined, "Cloud save not confirmed for these changes"],
    [{ attemptId: "one", attemptedAt: "2026-09-20T12:00:00Z", status: "unconfirmed", scope: "scan" }, "Cloud confirmation unavailable"],
    [{ attemptId: "one", attemptedAt: "2026-09-20T12:00:00Z", status: "failed", scope: "scan" }, "retry required"],
    [{ attemptId: "one", attemptedAt: "2026-09-20T12:00:00Z", status: "acknowledged", scope: "scan" }, "Last cloud save acknowledged"],
    [{ attemptId: "one", attemptedAt: "2026-09-20T12:00:00Z", status: "acknowledged", scope: "inspection" }, "Other changes not confirmed"],
  ])("shows the persisted save outcome after opening history: %s", async (cloudSave, label) => {
    localStorage.setItem(accountStorageKey(LOOKUPS_STORAGE_KEY), JSON.stringify([{ ...lookup, cloudSave }]));
    renderHistory();
    expect(await screen.findByText(new RegExp(label as string))).toBeInTheDocument();
  });

  it("keeps a device record when removal is canceled", async () => {
    localStorage.setItem(accountStorageKey(LOOKUPS_STORAGE_KEY), JSON.stringify([lookup]));
    vi.spyOn(window, "confirm").mockReturnValue(false);
    renderHistory();
    await userEvent.click(screen.getByRole("button", { name: "Remove Alternator from this device" }));
    expect(getLookups()).toHaveLength(1);
    expect(screen.getByRole("link", { name: /Alternator/ })).toBeInTheDocument();
  });

  it("removes only the device record while retaining the cloud row and another account", async () => {
    setActiveAccount("other");
    const otherKey = accountStorageKey(LOOKUPS_STORAGE_KEY);
    localStorage.setItem(otherKey, JSON.stringify([lookup]));
    setActiveAccount("test-user");
    localStorage.setItem(accountStorageKey(LOOKUPS_STORAGE_KEY), JSON.stringify([lookup]));
    readCloudLookupsMock.mockResolvedValue({ ok: true, value: [lookup] });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderHistory();
    await userEvent.click(screen.getByRole("button", { name: "Remove Alternator from this device" }));
    expect(getLookups()).toHaveLength(0);
    expect(JSON.parse(localStorage.getItem(otherKey)!)).toHaveLength(1);
    expect(await screen.findByRole("link", { name: /Alternator/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove Alternator from this device" })).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Cloud records are not deleted");
  });

  it("retains the record and reports failure if device removal cannot be saved", async () => {
    localStorage.setItem(accountStorageKey(LOOKUPS_STORAGE_KEY), JSON.stringify([lookup]));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderHistory();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("storage unavailable"); });
    await userEvent.click(screen.getByRole("button", { name: "Remove Alternator from this device" }));
    expect(getLookups()).toHaveLength(1);
    expect(screen.getByRole("link", { name: /Alternator/ })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("could not save");
  });

  it("rejects removal when the account changes while confirming", async () => {
    localStorage.setItem(accountStorageKey(LOOKUPS_STORAGE_KEY), JSON.stringify([lookup]));
    setActiveAccount("other");
    localStorage.setItem(accountStorageKey(LOOKUPS_STORAGE_KEY), JSON.stringify([lookup]));
    setActiveAccount("test-user");
    vi.spyOn(window, "confirm").mockImplementation(() => { setActiveAccount("other"); return true; });
    renderHistory();
    await userEvent.click(screen.getByRole("button", { name: "Remove Alternator from this device" }));
    expect(getLookups()).toHaveLength(1);
    setActiveAccount("test-user");
    expect(getLookups()).toHaveLength(1);
  });

  it("shows an empty saved scan state", () => {
    renderHistory();

    expect(screen.getByRole("heading", { name: "Saved scans" })).toBeInTheDocument();
    expect(screen.getByText("No saved scans yet")).toBeInTheDocument();
  });

  it("lists saved scans with dataset category", () => {
    localStorage.setItem(accountStorageKey(LOOKUPS_STORAGE_KEY), JSON.stringify([lookup]));

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
    localStorage.setItem(accountStorageKey(LOOKUPS_STORAGE_KEY), JSON.stringify([lookup, bodyLookup]));

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

  it("filters unresolved identities independently of helpfulness and training labels", async () => {
    const uncertain = { ...lookup, id: "uncertain", result: { ...lookup.result!, partName: "Uncertain alternator", confidence: "low" } };
    localStorage.setItem(accountStorageKey(LOOKUPS_STORAGE_KEY), JSON.stringify([lookup, uncertain, bodyLookup]));
    renderHistory();
    await userEvent.click(screen.getByRole("checkbox", { name: "Unresolved identities only" }));
    expect(screen.getByText("Uncertain alternator")).toBeInTheDocument();
    expect(screen.getByText("Rear bumper")).toBeInTheDocument();
    expect(screen.queryByText("Alternator")).not.toBeInTheDocument();
    expect(screen.getByText("2/3 saved scans")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("checkbox", { name: "Unresolved identities only" }));
    expect(screen.getByText("Alternator")).toBeInTheDocument();
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
    localStorage.setItem(accountStorageKey(LOOKUPS_STORAGE_KEY), JSON.stringify([local]));
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
    localStorage.setItem(accountStorageKey(LOOKUPS_STORAGE_KEY), JSON.stringify([lookup]));
    readCloudLookupsMock.mockResolvedValue({
      ok: true,
      value: makeLookups(MAX_SAVED_LOOKUPS + 10, "cloud"),
    });

    renderHistory();

    const total = MAX_SAVED_LOOKUPS + 11;
    expect(await screen.findByText(`${total}/${total} saved scans`)).toBeInTheDocument();
    expect(screen.queryByText(/Device limit reached/i)).not.toBeInTheDocument();
  });

  it("warns when the on-device store itself is full", () => {
    localStorage.setItem(accountStorageKey(LOOKUPS_STORAGE_KEY), JSON.stringify(makeLookups(MAX_SAVED_LOOKUPS, "local")));

    renderHistory();

    expect(screen.getByText(/Device limit reached \(50 scans\)/)).toBeInTheDocument();
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
