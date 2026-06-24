import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
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
  provenance: {
    analysisSource: "ai_detection",
    captureMode: "camera",
    savedAt: "2026-05-16T00:00:05.000Z",
  },
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

  it("shows the AI identification result", async () => {
    renderResult(successfulScan);

    expect(screen.getByRole("heading", { level: 1, name: "Alternator" })).toBeInTheDocument();
    expect(screen.getByTestId("result-focus-frame")).toHaveAttribute("data-focus-mode", "full_frame");
    expect(screen.getByRole("img", { name: "Captured car part" })).toHaveAttribute(
      "src",
      "data:image/jpeg;base64,test-image",
    );
    expect(screen.getAllByText("It charges the battery while the engine runs.").length).toBeGreaterThan(0);
    expect(screen.getByText("Best match")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ask" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
    expect(screen.queryByText("Other possible matches")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Complete brief" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Refine" })).not.toBeInTheDocument();
    expect(screen.queryByText("More evidence")).not.toBeInTheDocument();
    expect(screen.queryByText("Capture another angle")).not.toBeInTheDocument();
  });

  it("flags when a backup AI model produced the result", () => {
    renderResult({
      ...successfulScan,
      result: {
        ...successfulScan.result!,
        modelRun: {
          provider: "huggingface",
          model: "google/gemma-4-31b-it:free",
          latencyMs: 1234,
          fallbackReason: "rate_limited",
          ocrUsed: false,
        },
      },
    });

    expect(
      screen.getByText(
        "Identified with a backup AI model because the main model was busy. Double-check this result before relying on it.",
      ),
    ).toBeInTheDocument();
  });

  it("does not flag a backup model on the normal Gemini path", () => {
    renderResult({
      ...successfulScan,
      result: {
        ...successfulScan.result!,
        modelRun: {
          provider: "gemini",
          model: "gemini-2.5-flash",
          latencyMs: 1000,
          ocrUsed: false,
        },
      },
    });

    expect(screen.queryByText(/backup AI model/i)).not.toBeInTheDocument();
  });

  it("flags an on-device offline estimate distinctly from a cloud backup", () => {
    renderResult({
      ...successfulScan,
      result: {
        ...successfulScan.result!,
        modelRun: {
          provider: "on-device",
          model: "SmolVLM-256M",
          latencyMs: 10,
          fallbackReason: "offline",
          ocrUsed: false,
        },
      },
    });

    expect(
      screen.getByText("Offline estimate from the on-device model. Reconnect for a full Deep Spec analysis."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/backup AI model/i)).not.toBeInTheDocument();
  });

  it("keeps OCR label data out of the default simple answer sheet", () => {
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

    expect(screen.getByRole("heading", { level: 1, name: "Alternator" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Text output" })).not.toBeInTheDocument();
    expect(screen.queryByText("Likely part number")).not.toBeInTheDocument();
    expect(screen.queryByText("Visible label text: DENSO 104210-1230")).not.toBeInTheDocument();
  });

  it("keeps weak results simple without retake spam", () => {
    renderResult({
      ...successfulScan,
      result: {
        ...successfulScan.result!,
        confidence: "low",
        candidateMatches: [],
        evidenceRegions: [],
        needsBetterPhoto: true,
        safetyTriage: "needs_better_photo",
        sourceLinks: [],
      },
    });

    expect(screen.getByRole("heading", { level: 1, name: "Alternator" })).toBeInTheDocument();
    expect(screen.queryByText("Still missing")).not.toBeInTheDocument();
    expect(screen.queryByText(/Likely/)).not.toBeInTheDocument();
    expect(screen.queryByText("More evidence")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Capture another angle" })).not.toBeInTheDocument();
  });

  it("turns matched dataset source evidence into a reference link", () => {
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

    expect(screen.getByText("Professional check needed")).toBeInTheDocument();
    expect(screen.getByText(/Verify this before driving/)).toBeInTheDocument();
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

    expect(screen.getByRole("heading", { level: 1, name: "Alternator" })).toBeInTheDocument();
    expect(screen.queryByText("Incomplete data")).not.toBeInTheDocument();
    expect(screen.queryByText("Better photo needed")).not.toBeInTheDocument();
    expect(screen.queryByText("More evidence")).not.toBeInTheDocument();
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

    expect(screen.getByRole("heading", { level: 1, name: "Alternator" })).toBeInTheDocument();
    expect(screen.queryByText("Low-confidence result")).not.toBeInTheDocument();
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

  it("saves an unsaved result before opening chat", async () => {
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

    await userEvent.click(screen.getByRole("button", { name: "Ask" }));

    expect(screen.getByText("Chat page")).toBeInTheDocument();
    const savedLookups = JSON.parse(localStorage.getItem(LOOKUPS_STORAGE_KEY) ?? "[]") as Lookup[];
    expect(savedLookups).toHaveLength(1);
    expect(savedLookups[0].result?.partName).toBe("Alternator");
    expect(savedLookups[0].provenance).toMatchObject(successfulScan.provenance!);
    expect(savedLookups[0].trainingStatus).toBe("raw_unreviewed");
  });

  it("restores the latest successful scan after a refresh", () => {
    sessionStorage.setItem("deep-spec:latest-scan-state", JSON.stringify(successfulScan));

    renderResult(null);

    expect(screen.getByRole("heading", { level: 1, name: "Alternator" })).toBeInTheDocument();
    expect(screen.getAllByText("It charges the battery while the engine runs.").length).toBeGreaterThan(0);
  });

  it("handles a direct result route without captured state", () => {
    renderResult(null);

    expect(screen.getByText("No captured frame yet.")).toBeInTheDocument();
  });

  it("updates rating, correction, and notes for a saved scan", async () => {
    const lookup = makeLookup();
    localStorage.setItem(LOOKUPS_STORAGE_KEY, JSON.stringify([lookup]));

    renderResult(null, `/result/${lookup.id}`);

    await openSavedScanTools();
    await userEvent.click(screen.getByRole("button", { name: "Wrong" }));
    await userEvent.type(screen.getByLabelText("What was it actually?"), "It was the starter.");
    await userEvent.type(screen.getByLabelText("Private notes"), "Near the lower engine bay.");

    const savedLookup = JSON.parse(localStorage.getItem(LOOKUPS_STORAGE_KEY) ?? "[]")[0] as Lookup;
    expect(savedLookup.rating).toBe("down");
    expect(savedLookup.correction).toBe("It was the starter.");
    expect(savedLookup.notes).toBe("Near the lower engine bay.");
    expect(savedLookup.trainingLabel).toBe("It was the starter.");
    expect(savedLookup.trainingStatus).toBe("user_corrected");
  }, 30000);

  it("shows scan report actions for saved scans", async () => {
    const lookup = makeLookup();
    localStorage.setItem(LOOKUPS_STORAGE_KEY, JSON.stringify([lookup]));

    renderResult(null, `/result/${lookup.id}`);

    await openSavedScanTools();
    expect(screen.getByText("Photo use")).toBeInTheDocument();
    expect(screen.getByText("Needs review")).toBeInTheDocument();
    expect(screen.getByText("Private by default. This photo is not used for model training unless sharing is allowed.")).toBeInTheDocument();
    expect(screen.getByText("Scan report")).toBeInTheDocument();
    expect(screen.getByText("Cloud backup")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sync this scan" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Share" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Tell me more" })).toHaveAttribute("href", `/result/${lookup.id}/chat`);
  });

  it("clears the cloud sync loading state when sync fails", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://deep-spec.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "public-test-key");
    vi.spyOn(cloudSync, "syncLookupToCloud").mockRejectedValue(new Error("Network unavailable"));
    const lookup = makeLookup();
    localStorage.setItem(LOOKUPS_STORAGE_KEY, JSON.stringify([lookup]));

    renderResult(null, `/result/${lookup.id}`);

    await openSavedScanTools();
    const syncButton = screen.getByRole("button", { name: "Sync this scan" });
    await userEvent.click(syncButton);

    expect(await screen.findByText("Cloud sync failed. Network unavailable")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sync this scan" })).not.toBeDisabled();
  });

  it("shows nearby options for professional verification cases", async () => {
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

    await openSavedScanTools();
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

    await openSavedScanTools();
    await userEvent.click(screen.getByRole("button", { name: "Delete saved scan" }));

    expect(screen.getByText("History page")).toBeInTheDocument();
    expect(localStorage.getItem(LOOKUPS_STORAGE_KEY)).toBe("[]");
  });

  it("allows retrying an unsaved failed scan when online", async () => {
    const onlineSpy = vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    const identifySpy = vi.spyOn(aiService, "identifyCapturedFrame").mockResolvedValue(successfulScan.result!);

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
    const identifySpy = vi.spyOn(aiService, "identifyCapturedFrame").mockResolvedValue(successfulScan.result!);

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
    expect(savedLookups[0].provenance.analysisSource).toBe("manual_retry");

    expect(screen.queryByText("Provider unavailable")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Alternator" })).toBeInTheDocument();
    expect(screen.getAllByText("It charges the battery while the engine runs.").length).toBeGreaterThan(0);

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

async function openSavedScanTools() {
  await userEvent.click(screen.getByText("Saved scan tools"));
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
    provenance: {
      analysisSource: "ai_detection",
      captureMode: "camera",
      savedAt: "2026-05-16T00:00:05.000Z",
    },
    ...patch,
  };
}
