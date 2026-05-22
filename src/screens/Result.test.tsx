import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, vi } from "vitest";
import Result from "./Result";
import * as aiService from "../services/aiService";
import * as cloudSync from "../services/cloudSync";
import { LOOKUPS_STORAGE_KEY } from "../services/storage";
import type { Lookup, ScanAnalysisState } from "../types";

const frame = {
  imageBase64: "data:image/jpeg;base64,test-image",
  capturedAt: "2026-05-16T00:00:00.000Z",
};

const successfulScan: ScanAnalysisState = {
  frame,
  analyzedAt: "2026-05-16T00:00:05.000Z",
  result: {
    partName: "Alternator",
    confidence: "high",
    scanCategory: "electrical",
    candidateMatches: [
      {
        partName: "Starter motor",
        confidence: "low",
        scanCategory: "electrical",
        reason: "Also an engine-bay electrical part, but the pulley and housing favor alternator.",
        sourceLinks: [
          {
            label: "Starter research",
            url: "https://www.google.com/search?q=Starter%20motor%20car%20part",
            sourceType: "search",
          },
        ],
      },
    ],
    whatItDoes: "It charges the battery while the engine runs.",
    visibleObservations: ["Belt-driven metal housing is visible."],
    evidenceRegions: [
      {
        label: "Pulley and housing",
        observation: "Belt-driven metal housing is visible in the scanned area.",
        regionLabel: "Scanned area",
      },
    ],
    concerns: [],
    safetyTriage: "can_help",
    isSafetyCritical: false,
    nextAction: "Take another photo of the label if you need more detail.",
    needsBetterPhoto: false,
    evidence: ["The pulley and vented housing match common alternator shapes."],
    sourceLinks: [
      {
        label: "Search this part",
        url: "https://www.google.com/search?q=Alternator%20car%20part",
        sourceType: "search",
      },
    ],
  },
};

describe("Result", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.stubEnv("VITE_SUPABASE_URL", "");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("shows the AI identification result in a tabbed result sheet", async () => {
    renderResult(successfulScan);

    expect(screen.getByRole("heading", { level: 1, name: "Alternator" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Captured car part" })).toHaveAttribute(
      "src",
      "data:image/jpeg;base64,test-image",
    );
    expect(screen.getByText("It charges the battery while the engine runs.")).toBeInTheDocument();
    expect(screen.getByText("Best match")).toBeInTheDocument();
    expect(screen.getByText("Other possible matches")).toBeInTheDocument();
    expect(screen.getByText("Starter motor")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Starter research" })).toHaveAttribute(
      "href",
      "https://www.google.com/search?q=Starter%20motor%20car%20part",
    );
    expect(screen.getByRole("tablist", { name: "Result sections" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Match" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Why it might be wrong")).toBeInTheDocument();
    expect(screen.getByText(/Other plausible matches remain: Starter motor/)).toBeInTheDocument();
    expect(screen.getByText(/Take one wider context photo and one close label photo/)).toBeInTheDocument();
    expect(screen.queryByText("Ranked sources")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("tab", { name: "Evidence" }));

    expect(screen.getByRole("tab", { name: "Evidence" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Image evidence")).toBeInTheDocument();
    expect(screen.getByText("Useful match")).toBeInTheDocument();
    expect(screen.getByText("The pulley and vented housing match common alternator shapes.")).toBeInTheDocument();
    expect(screen.getByText("Nothing concerning visible.")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("tab", { name: "Sources" }));

    expect(screen.getByRole("tab", { name: "Sources" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Ranked sources")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Research" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Nearby help" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Safety" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Safety state" })).toBeInTheDocument();
    expect(screen.getByText("Take another photo of the label if you need more detail.")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Next action" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Refine" })).toHaveAttribute("href", "/scan");
    expect(screen.getByRole("link", { name: "Search this part" })).toHaveAttribute(
      "href",
      "https://www.google.com/search?q=Alternator%20car%20part",
    );

    await userEvent.click(screen.getByRole("tab", { name: "Ask" }));

    expect(screen.getByRole("tab", { name: "Ask" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByLabelText("Ask about this result")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "What should I check next?" })).toBeInTheDocument();
  });

  it("positions image evidence callouts from structured anchors", () => {
    renderResult({
      ...successfulScan,
      result: {
        ...successfulScan.result!,
        evidenceRegions: [
          {
            anchor: "upper_left",
            label: "Pulley edge",
            observation: "The pulley edge is visible in the scan overlay.",
            regionLabel: "Scanned area",
          },
        ],
      },
    });

    const callout = screen.getByTestId("evidence-callout-upper_left");
    expect(callout.className).toContain("left-[8%]");
    expect(callout.className).toContain("top-[22%]");
    expect(within(callout).getByText("Clue 1 / Scanned area")).toBeInTheDocument();
    expect(within(callout).getByText("Pulley edge")).toBeInTheDocument();
  });

  it("groups OCR label text into the evidence tab", async () => {
    renderResult({
      ...successfulScan,
      result: {
        ...successfulScan.result!,
        evidence: [
          ...successfulScan.result!.evidence,
          "OCR label text: DENSO 104210-1230",
        ],
      },
    });

    await userEvent.click(screen.getByRole("tab", { name: "Evidence" }));

    const textOutput = screen.getByRole("region", { name: "Text output" });
    expect(within(textOutput).getByText("Detected label")).toBeInTheDocument();
    expect(within(textOutput).getByText("DENSO 104210-1230")).toBeInTheDocument();
    expect(within(textOutput).getByText("Likely part number")).toBeInTheDocument();
    expect(within(textOutput).getByText("Candidate code")).toBeInTheDocument();
    expect(within(textOutput).getByText("104210-1230")).toBeInTheDocument();
    expect(within(textOutput).getByRole("button", { name: "Copy text" })).toBeInTheDocument();
    expect(within(textOutput).getByRole("button", { name: "Use as correction" })).toBeInTheDocument();
    expect(within(textOutput).getByRole("link", { name: "Search exact" })).toHaveAttribute(
      "href",
      "https://www.google.com/search?q=DENSO%20104210-1230",
    );
    expect(within(textOutput).getByRole("link", { name: "Search with part" })).toHaveAttribute(
      "href",
      "https://www.google.com/search?q=DENSO%20104210-1230%20Alternator%20car%20part",
    );
    expect(screen.queryByText("Visible label text: DENSO 104210-1230")).not.toBeInTheDocument();
  });

  it("turns matched dataset source evidence into a reference link", async () => {
    const sourceUrl =
      "https://huggingface.co/datasets/DrBimmer/car-parts-and-damage-dataset/resolve/main/Car%20damages%20dataset/File1/img/Car%20damages%20100.png";

    renderResult({
      ...successfulScan,
      result: {
        ...successfulScan.result!,
        evidence: [
          "Local dataset match: Front-bumper (part, 12 labeled samples)",
          `Dataset source: ${sourceUrl}`,
        ],
      },
    });

    await userEvent.click(screen.getByRole("tab", { name: "Sources" }));

    expect(screen.getByRole("heading", { name: "Visual dataset matches" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Dataset match 1" })).toHaveAttribute("href", sourceUrl);
    expect(screen.getByRole("link", { name: "Hugging Face source 1" })).toHaveAttribute("href", sourceUrl);
    expect(screen.queryByRole("link", { name: "Dataset source" })).not.toBeInTheDocument();
  });

  it("shows safety-critical guidance", () => {
    renderResult({
      ...successfulScan,
      result: {
        ...successfulScan.result!,
        partName: "Brake caliper",
        scanCategory: "brakes",
        safetyTriage: "needs_professional",
        isSafetyCritical: true,
      },
    });

    expect(screen.getByText("Professional verification needed")).toBeInTheDocument();
    expect(screen.getByText("Have a qualified mechanic verify it before driving or repair work.")).toBeInTheDocument();
    expect(screen.queryByText("Professional check needed")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Next action" })).not.toBeInTheDocument();
  });

  it("shows incomplete data guidance when the scan needs a better photo", () => {
    renderResult({
      ...successfulScan,
      result: {
        ...successfulScan.result!,
        confidence: "low",
        safetyTriage: "needs_better_photo",
        needsBetterPhoto: true,
      },
    });

    expect(screen.getByText("Better photo needed")).toBeInTheDocument();
    expect(screen.getByText("Move closer, add light, and center any label, connector, hose, or damaged area in the lens frame.")).toBeInTheDocument();
    expect(screen.queryByText("Incomplete data")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Next action" })).not.toBeInTheDocument();
    expect(screen.getByText("Why it might be wrong")).toBeInTheDocument();
    expect(screen.getByText("The current photo does not show enough detail for a strong match.")).toBeInTheDocument();
    expect(screen.getByText("Move closer, add light, and include any label, connector, hose path, or mounting bolts in the frame.")).toBeInTheDocument();
  });

  it("shows low-confidence uncertainty separately from better-photo cases", () => {
    renderResult({
      ...successfulScan,
      result: {
        ...successfulScan.result!,
        confidence: "low",
        safetyTriage: "can_help",
        needsBetterPhoto: false,
      },
    });

    expect(screen.getByText("Low-confidence result")).toBeInTheDocument();
    expect(screen.getByText(/Confidence is low/)).toBeInTheDocument();
    expect(screen.getByText(/Retake from a second angle/)).toBeInTheDocument();
  });

  it("shows a fallback uncertainty note for otherwise strong results", () => {
    renderResult({
      ...successfulScan,
      result: {
        ...successfulScan.result!,
        candidateMatches: [],
      },
    });

    expect(screen.getByText("Why it might be wrong")).toBeInTheDocument();
    expect(screen.getByText("No major uncertainty flags were returned, but part labels and vehicle fitment still need real-world verification.")).toBeInTheDocument();
    expect(screen.getByText("Take a second angle if you need buying, fitment, or repair confidence.")).toBeInTheDocument();
  });

  it("shows a friendly AI error while keeping the captured image", () => {
    renderResult({
      frame,
      errorMessage: "Too many AI lookups right now. Try again in a few minutes.",
      errorCode: "rate_limited",
      analyzedAt: "2026-05-16T00:00:05.000Z",
    });

    expect(screen.getByText("Provider unavailable")).toBeInTheDocument();
    expect(screen.getByText("AI provider is rate-limited")).toBeInTheDocument();
    expect(screen.getByText("Too many AI lookups right now. Try again in a few minutes.")).toBeInTheDocument();
    expect(screen.getByText(/not proof the model identified the part incorrectly/i)).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Captured car part" })).toHaveAttribute(
      "src",
      "data:image/jpeg;base64,test-image",
    );
    expect(screen.getByRole("button", { name: "Try again later" })).toBeInTheDocument();
  });

  it("labels QA test results as local-only", () => {
    renderResult({
      ...successfulScan,
      testRun: true,
      testVehicleLabel: "Generated engine bay QA photo",
    });

    expect(screen.getByText("QA test result")).toBeInTheDocument();
    expect(screen.getByText(/Generated engine bay QA photo/)).toBeInTheDocument();
    expect(screen.getByText(/not sent to provider or cloud services/i)).toBeInTheDocument();
    expect(screen.queryByText("Saved scan")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ask" })).not.toBeInTheDocument();
    expect(screen.queryByText("Ask next")).not.toBeInTheDocument();
    expect(localStorage.getItem(LOOKUPS_STORAGE_KEY)).toBeNull();
  });

  it("saves an unsaved result before opening a suggested follow-up", async () => {
    render(
      <MemoryRouter
        initialEntries={[
          {
            pathname: "/result",
            state: successfulScan,
          },
        ]}
      >
        <Routes>
          <Route path="/result" element={<Result />} />
          <Route path="/result/:id/chat" element={<p>Chat page</p>} />
        </Routes>
      </MemoryRouter>,
    );

    await userEvent.click(screen.getByRole("tab", { name: "Ask" }));
    await userEvent.click(screen.getByRole("button", { name: "What should I check next?" }));

    expect(screen.getByText("Chat page")).toBeInTheDocument();
    const savedLookups = JSON.parse(localStorage.getItem(LOOKUPS_STORAGE_KEY) ?? "[]") as Lookup[];
    expect(savedLookups).toHaveLength(1);
    expect(savedLookups[0].result?.partName).toBe("Alternator");
    expect(savedLookups[0].trainingStatus).toBe("raw_unreviewed");
  });

  it("saves an unsaved result before opening a typed follow-up", async () => {
    render(
      <MemoryRouter
        initialEntries={[
          {
            pathname: "/result",
            state: successfulScan,
          },
        ]}
      >
        <Routes>
          <Route path="/result" element={<Result />} />
          <Route path="/result/:id/chat" element={<ChatRouteProbe />} />
        </Routes>
      </MemoryRouter>,
    );

    await userEvent.click(screen.getByRole("tab", { name: "Ask" }));
    await userEvent.type(screen.getByLabelText("Ask about this result"), "Can I drive with this noise?");
    await userEvent.click(screen.getByRole("button", { name: "Ask follow-up" }));

    expect(screen.getByText("Chat page")).toBeInTheDocument();
    expect(screen.getByText("?q=Can%20I%20drive%20with%20this%20noise%3F")).toBeInTheDocument();
    const savedLookups = JSON.parse(localStorage.getItem(LOOKUPS_STORAGE_KEY) ?? "[]") as Lookup[];
    expect(savedLookups).toHaveLength(1);
    expect(savedLookups[0].result?.partName).toBe("Alternator");
  });

  it("saves an unsaved result when marking an alternate match correct", async () => {
    render(
      <MemoryRouter
        initialEntries={[
          {
            pathname: "/result",
            state: successfulScan,
          },
        ]}
      >
        <Routes>
          <Route path="/result" element={<Result />} />
          <Route path="/result/:id" element={<Result />} />
        </Routes>
      </MemoryRouter>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Mark Starter motor correct" }));

    expect(await screen.findByText("Saved scan")).toBeInTheDocument();
    const savedLookups = JSON.parse(localStorage.getItem(LOOKUPS_STORAGE_KEY) ?? "[]") as Lookup[];
    expect(savedLookups).toHaveLength(1);
    expect(savedLookups[0]).toMatchObject({
      correction: "Starter motor",
      rating: "down",
      trainingLabel: "Starter motor",
      trainingStatus: "user_corrected",
    });
    expect(screen.getByRole("button", { name: "Marked Starter motor correct" })).toBeDisabled();
  });

  it("restores the latest successful scan after a refresh", () => {
    sessionStorage.setItem("deep-spec:latest-scan-state", JSON.stringify(successfulScan));

    renderResult(null);

    expect(screen.getByRole("heading", { level: 1, name: "Alternator" })).toBeInTheDocument();
    expect(screen.getByText("It charges the battery while the engine runs.")).toBeInTheDocument();
  });

  it("handles a direct result route without captured state", () => {
    renderResult(null);

    expect(screen.getByText("No captured frame yet.")).toBeInTheDocument();
  });

  it("updates rating, correction, and notes for a saved scan", async () => {
    const lookup = makeLookup();
    localStorage.setItem(LOOKUPS_STORAGE_KEY, JSON.stringify([lookup]));

    renderResult(null, `/result/${lookup.id}`);

    await userEvent.click(screen.getByRole("button", { name: "Wrong" }));
    await userEvent.type(screen.getByLabelText("What was it actually?"), "It was the starter.");
    await userEvent.type(screen.getByLabelText("Private notes"), "Near the lower engine bay.");

    const savedLookup = JSON.parse(localStorage.getItem(LOOKUPS_STORAGE_KEY) ?? "[]")[0] as Lookup;
    expect(savedLookup.rating).toBe("down");
    expect(savedLookup.correction).toBe("It was the starter.");
    expect(savedLookup.notes).toBe("Near the lower engine bay.");
    expect(savedLookup.trainingLabel).toBe("It was the starter.");
    expect(savedLookup.trainingStatus).toBe("user_corrected");
  });

  it("promotes an alternate match into the saved scan correction", async () => {
    const lookup = makeLookup();
    localStorage.setItem(LOOKUPS_STORAGE_KEY, JSON.stringify([lookup]));

    renderResult(null, `/result/${lookup.id}`);

    await userEvent.click(screen.getByRole("button", { name: "Mark Starter motor correct" }));

    const savedLookup = JSON.parse(localStorage.getItem(LOOKUPS_STORAGE_KEY) ?? "[]")[0] as Lookup;
    expect(savedLookup).toMatchObject({
      correction: "Starter motor",
      rating: "down",
      trainingLabel: "Starter motor",
      trainingStatus: "user_corrected",
    });
    expect(screen.getByLabelText("What was it actually?")).toHaveValue("Starter motor");
    expect(screen.getByRole("button", { name: "Marked Starter motor correct" })).toBeDisabled();
  });

  it("uses detected OCR label text as the saved scan correction", async () => {
    const lookup = makeLookup({
      result: {
        ...successfulScan.result!,
        evidence: [
          ...successfulScan.result!.evidence,
          "OCR label text: DENSO 104210-1230",
        ],
      },
    });
    localStorage.setItem(LOOKUPS_STORAGE_KEY, JSON.stringify([lookup]));

    renderResult(null, `/result/${lookup.id}`);

    await userEvent.click(screen.getByRole("tab", { name: "Evidence" }));
    await userEvent.click(screen.getByRole("button", { name: "Use as correction" }));

    const savedLookup = JSON.parse(localStorage.getItem(LOOKUPS_STORAGE_KEY) ?? "[]")[0] as Lookup;
    expect(savedLookup).toMatchObject({
      correction: "DENSO 104210-1230",
      rating: "down",
      trainingLabel: "DENSO 104210-1230",
      trainingStatus: "user_corrected",
    });
    expect(screen.getByLabelText("What was it actually?")).toHaveValue("DENSO 104210-1230");
  });

  it("shows scan report actions for saved scans", async () => {
    const lookup = makeLookup();
    localStorage.setItem(LOOKUPS_STORAGE_KEY, JSON.stringify([lookup]));

    renderResult(null, `/result/${lookup.id}`);

    expect(screen.getByRole("heading", { name: "Review" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Actions" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Cloud" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Export" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Danger zone" })).toBeInTheDocument();
    expect(screen.getByText("Scan report")).toBeInTheDocument();
    expect(screen.getByText("Cloud dataset sync")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sync this scan" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Share" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Tell me more" })).toHaveAttribute("href", `/result/${lookup.id}/chat`);
    await userEvent.click(screen.getByRole("tab", { name: "Ask" }));
    expect(screen.getByLabelText("Ask about this result")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "What should I check next?" })).toHaveAttribute(
      "href",
      `/result/${lookup.id}/chat?q=What%20should%20I%20check%20next%20for%20this%20Alternator%3F`,
    );
  });

  it("opens a saved scan chat with a typed follow-up", async () => {
    const lookup = makeLookup();
    localStorage.setItem(LOOKUPS_STORAGE_KEY, JSON.stringify([lookup]));

    render(
      <MemoryRouter initialEntries={[`/result/${lookup.id}`]}>
        <Routes>
          <Route path="/result/:id" element={<Result />} />
          <Route path="/result/:id/chat" element={<ChatRouteProbe />} />
        </Routes>
      </MemoryRouter>,
    );

    await userEvent.click(screen.getByRole("tab", { name: "Ask" }));
    await userEvent.type(screen.getByLabelText("Ask about this result"), "What symptoms match this?");
    await userEvent.click(screen.getByRole("button", { name: "Ask follow-up" }));

    expect(screen.getByText("Chat page")).toBeInTheDocument();
    expect(screen.getByText("?q=What%20symptoms%20match%20this%3F")).toBeInTheDocument();
    const savedLookups = JSON.parse(localStorage.getItem(LOOKUPS_STORAGE_KEY) ?? "[]") as Lookup[];
    expect(savedLookups).toHaveLength(1);
  });

  it("clears the cloud sync loading state when sync fails", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://deep-spec.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "public-test-key");
    vi.spyOn(cloudSync, "syncLookupToCloud").mockRejectedValue(new Error("Network unavailable"));
    const lookup = makeLookup();
    localStorage.setItem(LOOKUPS_STORAGE_KEY, JSON.stringify([lookup]));

    renderResult(null, `/result/${lookup.id}`);

    const syncButton = screen.getByRole("button", { name: "Sync this scan" });
    await userEvent.click(syncButton);

    expect(await screen.findByText("Cloud sync failed. Network unavailable")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sync this scan" })).not.toBeDisabled();
  });

  it("shows nearby options for professional verification cases", () => {
    const lookup = makeLookup({
      result: {
        ...successfulScan.result!,
        partName: "Brake caliper",
        scanCategory: "brakes",
        safetyTriage: "needs_professional",
        isSafetyCritical: true,
      },
      scanCategory: "brakes",
      trainingLabel: "Brake caliper",
    });
    localStorage.setItem(LOOKUPS_STORAGE_KEY, JSON.stringify([lookup]));

    renderResult(null, `/result/${lookup.id}`);

    expect(screen.getByRole("link", { name: "Find nearby options" })).toHaveAttribute(
      "href",
      "https://www.google.com/maps/search/brakes%20auto%20repair%20near%20me",
    );
  });

  it("deletes a saved scan and returns to history", async () => {
    const lookup = makeLookup();
    localStorage.setItem(LOOKUPS_STORAGE_KEY, JSON.stringify([lookup]));

    render(
      <MemoryRouter initialEntries={[`/result/${lookup.id}`]}>
        <Routes>
          <Route path="/history" element={<p>History page</p>} />
          <Route path="/result/:id" element={<Result />} />
        </Routes>
      </MemoryRouter>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Delete saved scan" }));

    expect(screen.getByText("History page")).toBeInTheDocument();
    expect(localStorage.getItem(LOOKUPS_STORAGE_KEY)).toBe("[]");
  });

  it("allows retrying an unsaved failed scan when online", async () => {
    const onlineSpy = vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    const identifySpy = vi.spyOn(aiService, "identifyCapturedFrameWithRun").mockResolvedValue({ result: successfulScan.result! });

    renderResult({
      frame,
      errorMessage: "Network error",
      errorCode: "network",
      analyzedAt: "2026-05-16T00:00:05.000Z",
    });

    expect(screen.getByText("Provider unavailable")).toBeInTheDocument();
    expect(screen.getByText("AI provider could not be reached")).toBeInTheDocument();
    expect(screen.getByText("Network error")).toBeInTheDocument();
    expect(screen.getByText(/Internet connection is active/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(identifySpy).toHaveBeenCalledWith(frame);
    expect(localStorage.getItem(LOOKUPS_STORAGE_KEY)).toBeNull();
    expect(screen.queryByText("Provider unavailable")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Alternator" })).toBeInTheDocument();

    onlineSpy.mockRestore();
  });

  it("allows retrying a saved failed scan when online", async () => {
    const failedLookup = makeLookup({
      result: undefined,
      errorMessage: "Network error",
      errorCode: "network",
      analyzedAt: undefined,
    });
    localStorage.setItem(LOOKUPS_STORAGE_KEY, JSON.stringify([failedLookup]));

    const onlineSpy = vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    const identifySpy = vi.spyOn(aiService, "identifyCapturedFrameWithRun").mockResolvedValue({ result: successfulScan.result! });

    renderResult(null, `/result/${failedLookup.id}`);

    expect(screen.getByText("Provider unavailable")).toBeInTheDocument();
    expect(screen.getByText("AI provider could not be reached")).toBeInTheDocument();
    expect(screen.getByText("Network error")).toBeInTheDocument();
    expect(screen.getByText(/Internet connection is active/)).toBeInTheDocument();

    const retryButton = screen.getByRole("button", { name: "Try again" });
    await userEvent.click(retryButton);

    expect(identifySpy).toHaveBeenCalledWith(failedLookup.frame);

    const savedLookups = JSON.parse(localStorage.getItem(LOOKUPS_STORAGE_KEY) ?? "[]") as Lookup[];
    expect(savedLookups[0].result?.partName).toBe("Alternator");
    expect(savedLookups[0].errorMessage).toBeUndefined();

    expect(screen.queryByText("Provider unavailable")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Alternator" })).toBeInTheDocument();
    expect(screen.getByText("It charges the battery while the engine runs.")).toBeInTheDocument();

    onlineSpy.mockRestore();
  });

  it("disables retry button when offline", () => {
    const failedLookup = makeLookup({
      result: undefined,
      errorMessage: "Network error",
      errorCode: "network",
      analyzedAt: undefined,
    });
    localStorage.setItem(LOOKUPS_STORAGE_KEY, JSON.stringify([failedLookup]));

    const onlineSpy = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);

    renderResult(null, `/result/${failedLookup.id}`);

    expect(screen.getByText(/Offline. Find an internet connection/)).toBeInTheDocument();
    const retryButton = screen.getByRole("button", { name: "Try again" });
    expect(retryButton).toBeDisabled();

    onlineSpy.mockRestore();
  });
});

function renderResult(state: ScanAnalysisState | null, path = "/result") {
  render(
    <MemoryRouter
      initialEntries={[
        {
          pathname: path,
          state,
        },
      ]}
    >
      <Routes>
        <Route path="/result" element={<Result />} />
        <Route path="/result/:id" element={<Result />} />
      </Routes>
    </MemoryRouter>,
  );
}

function ChatRouteProbe() {
  const location = useLocation();
  return (
    <>
      <p>Chat page</p>
      <p>{location.search}</p>
    </>
  );
}

function makeLookup(patch: Partial<Lookup> = {}): Lookup {
  return {
    id: "lookup-1",
    createdAt: "2026-05-16T00:00:00.000Z",
    frame,
    result: successfulScan.result,
    analyzedAt: successfulScan.analyzedAt,
    rating: null,
    correction: null,
    notes: "",
    scanCategory: "electrical",
    trainingLabel: "Alternator",
    trainingStatus: "raw_unreviewed",
    chatHistory: [],
    modelRuns: [],
    syncEvents: [],
    ...patch,
  };
}
