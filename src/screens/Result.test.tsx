import { accountStorageKey, setActiveAccount, withAccountRouteState } from "../lib/accountScope";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Link, MemoryRouter, Route, Routes } from "react-router-dom";
import { StrictMode } from "react";
import { afterEach, vi } from "vitest";
import Result from "./Result";
import Chat from "./Chat";
import * as aiService from "../services/aiService";
import * as reportService from "../services/report";
import * as cloudSync from "../services/cloudSync";
import { getLookup, getLookups, LOOKUPS_STORAGE_KEY, updateLookup } from "../services/storage";
import { emptyPartInspection } from "../lib/partInspection";
import type { Lookup, ScanAnalysisState } from "../types";

const cloudHistoryMocks = vi.hoisted(() => ({
  readCloudLookup: vi.fn(),
}));

vi.mock("../services/cloudHistory", () => ({
  readCloudLookup: cloudHistoryMocks.readCloudLookup,
}));

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
    cloudHistoryMocks.readCloudLookup.mockReset();
    cloudHistoryMocks.readCloudLookup.mockResolvedValue({ ok: true, value: null });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("rejects a previous account's result retained in browser history", () => {
    const oldState = withAccountRouteState(successfulScan);
    setActiveAccount("other-user");
    render(<MemoryRouter initialEntries={[{ pathname: "/result/old", state: oldState }]}><Routes><Route path="/result/:id" element={<Result />} /></Routes></MemoryRouter>);
    expect(screen.queryByRole("heading", { name: "Alternator" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Automatic intake draft" })).not.toBeInTheDocument();
  });

  it("does not save a stale mounted result into a new account", async () => {
    const user = userEvent.setup();
    renderResult(successfulScan);
    setActiveAccount("other-user");
    await user.click(screen.getByRole("button", { name: "Save", exact: true }));
    expect(getLookups()).toEqual([]);
  });

  it.each(["bay", "detail"])("opens observation evidence %s as the untouched original and moves focus to the photo", async (photoId) => {
    const local = makeLookup({
      focusBox: { x: 0.1, y: 0.15, width: 0.3, height: 0.4, confidence: 0.9 }, focusMode: "mask", isolatedImageBase64: "data:image/png;base64,cutout",
      photos: [{ ...frame, id: "bay", label: "overview" }, { ...frame, id: "detail", label: "close_up", imageBase64: "data:image/jpeg;base64,detail" }],
      result: { ...successfulScan.result!, conditionAssessment: {
        version: 1, observations: [{ id: "o1", text: "Brown material is visible.", photoIds: [photoId] }],
        possibleCauses: [], unknowns: ["Depth is unknown."],
      } },
    });
    localStorage.setItem(accountStorageKey(LOOKUPS_STORAGE_KEY), JSON.stringify([local]));
    renderResult({ ...successfulScan, savedLookup: local }, `/result/${local.id}`);
    const canvas = screen.getByTestId("result-photo-canvas");
    const scroll = vi.fn();
    canvas.scrollIntoView = scroll;
    await userEvent.click(screen.getByRole("button", { name: /for observation o1/ }));
    expect(screen.getByRole("button", { name: "Original", exact: true })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("img", { name: "Captured car part" })).toHaveAttribute("src", local.photos!.find((photo) => photo.id === photoId)!.imageBase64);
    expect(screen.queryByTestId("isolated-part-image")).not.toBeInTheDocument();
    expect(canvas).toHaveFocus();
    expect(scroll).toHaveBeenCalledExactlyOnceWith({ behavior: "smooth", block: "center" });
  });

  it("shows the complete safety action separately from a request for another photo", async () => {
    const safetyAction = "Do not drive until the brake mounting bracket has been checked. A qualified technician should inspect the apparent crack and mounting points before deciding whether the assembly can be reused.";
    const local = makeLookup({ result: { ...successfulScan.result!, partName: "Brake mounting bracket", isSafetyCritical: true,
      safetyTriage: "needs_professional", needsBetterPhoto: false, nextAction: safetyAction,
      conditionAssessment: {
        version: 1, observations: [{ id: "o1", text: "A crack-like line is visible.", photoIds: ["photo-1"] }],
        possibleCauses: [], unknowns: ["Depth is unknown."],
        nextEvidence: { kind: "photo", request: "Photograph the reverse side.", purpose: "Show the other end of the visible line." },
      },
    } });
    localStorage.setItem(accountStorageKey(LOOKUPS_STORAGE_KEY), JSON.stringify([local]));
    renderResult({ ...successfulScan, savedLookup: local }, `/result/${local.id}`);
    expect(screen.getByRole("region", { name: "Safety action" })).toHaveTextContent(safetyAction);
    expect(screen.getByRole("region", { name: "Condition evidence" })).toHaveTextContent("Photograph the reverse side.");
    await userEvent.click(screen.getByRole("tab", { name: "Sources", exact: true }));
    expect(screen.getByRole("region", { name: "Safety action" })).toHaveTextContent(safetyAction);
  });

  it.each(["bay", "detail"])("opens photo-review disagreement %s as an untouched original without a condition assessment", async (photoId) => {
    const local = makeLookup({
      focusBox: { x: 0.1, y: 0.15, width: 0.3, height: 0.4, confidence: 0.9 }, focusMode: "mask", isolatedImageBase64: "data:image/png;base64,cutout",
      photos: [{ ...frame, id: "bay", label: "overview" }, { ...frame, id: "detail", label: "close_up", imageBase64: "data:image/jpeg;base64,detail" }],
      result: { ...successfulScan.result!, photoReview: {
        version: 1, photos: [{ photoId: "bay", status: "observations_returned", summary: "A dark edge is visible." }, { photoId: "detail", status: "limited_view", summary: "Glare obscures that edge." }],
        disagreements: [{ id: "d1", photoIds: ["bay", "detail"], description: "The views do not establish whether the dark edge is a gap.", nextEvidence: { request: "Photograph the edge in diffuse light.", purpose: "Distinguish glare from an opening." } }],
      } },
    });
    const identify = vi.spyOn(aiService, "identifyCapturedFrame");
    localStorage.setItem(accountStorageKey(LOOKUPS_STORAGE_KEY), JSON.stringify([local]));
    renderResult({ ...successfulScan, savedLookup: local }, `/result/${local.id}`);
    const canvas = screen.getByTestId("result-photo-canvas");
    canvas.scrollIntoView = vi.fn();
    await userEvent.click(screen.getByRole("button", { name: `View Photo ${photoId === "bay" ? "1 — Overview" : "2 — Close-up"} for disagreement d1` }));
    expect(screen.getByRole("button", { name: "Original", exact: true })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("img", { name: "Captured car part" })).toHaveAttribute("src", local.photos!.find((photo) => photo.id === photoId)!.imageBase64);
    expect(screen.queryByTestId("isolated-part-image")).not.toBeInTheDocument();
    expect(canvas).toHaveFocus();
    expect(identify).not.toHaveBeenCalled();
    expect(getLookup(local.id)?.result?.photoReview).toEqual(local.result!.photoReview);
  });

  it("persists a corrected area on an existing device scan and clears its stale cutout", async () => {
    const user = userEvent.setup();
    const local = makeLookup({
      focusBox: { x: 0.1, y: 0.15, width: 0.3, height: 0.4, confidence: 0.9 },
      focusMode: "mask",
      isolatedImageBase64: "data:image/png;base64,old-cutout",
      photos: [{ ...frame, id: "overview-photo", label: "overview" }],
      notes: "Keep these receiving notes",
      correction: "Technician label",
    });
    localStorage.setItem(accountStorageKey(LOOKUPS_STORAGE_KEY), JSON.stringify([local]));
    renderResult({ ...successfulScan, savedLookup: local }, `/result/${local.id}`);

    await user.click(screen.getByRole("button", { name: "Correct area" }));
    fireEvent.change(screen.getByRole("slider", { name: "Selection x" }), { target: { value: "25" } });
    await user.click(screen.getByRole("button", { name: "Apply area" }));

    const persisted = JSON.parse(localStorage.getItem(accountStorageKey(LOOKUPS_STORAGE_KEY))!);
    expect(persisted).toHaveLength(1);
    expect(persisted[0]).toMatchObject({
      id: local.id,
      focusBox: { ...local.focusBox, x: 0.25, confidence: 0 },
      focusMode: "crop",
      isolatedImageBase64: "",
      photos: local.photos,
      notes: local.notes,
      correction: local.correction,
      result: local.result,
    });
    expect(screen.getByTestId("result-focus-frame")).toHaveAttribute("data-focus-mode", "crop");
    expect(screen.getByText("Selection saved on this device. Cloud sync is off.")).toBeInTheDocument();
  });

  it("shows a first-photo issue pointer only on that photo when browsing a saved group", async () => {
    const user = userEvent.setup();
    const issue = "Rust is visible along the lower left edge.";
    const detailImage = "data:image/jpeg;base64,ZGV0YWls";
    const local = makeLookup({
      photos: [{ ...frame, id: "overview-photo", label: "overview" },
        { ...frame, id: "detail-photo", label: "close_up", imageBase64: detailImage }],
      result: { ...successfulScan.result!, visibleObservations: [issue],
        evidenceRegions: [{ label: "Rusted edge", observation: issue, regionLabel: "lower left" }] },
    });
    localStorage.setItem(accountStorageKey(LOOKUPS_STORAGE_KEY), JSON.stringify([local]));
    renderResult({ ...successfulScan, savedLookup: local }, `/result/${local.id}`);

    expect(screen.getByAltText("Captured car part")).toHaveAttribute("src", frame.imageBase64);
    expect(screen.queryByTestId("issue-callout")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Outline", exact: true }));
    expect(screen.getByTestId("issue-callout")).toHaveTextContent(issue);
    await user.click(screen.getByRole("button", { name: "2. Close-up" }));
    expect(screen.getByAltText("Captured car part")).toHaveAttribute("src", detailImage);
    expect(screen.getByTestId("result-focus-frame")).toHaveAttribute("data-focus-mode", "full_frame");
    expect(screen.queryByTestId("issue-callout")).not.toBeInTheDocument();
    expect(screen.queryByTestId("focused-part-window")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Original", exact: true })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "1. Overview" }));
    expect(screen.getByAltText("Captured car part")).toHaveAttribute("src", frame.imageBase64);
    await user.click(screen.getByRole("button", { name: "Outline", exact: true }));
    expect(screen.getByTestId("issue-callout")).toHaveTextContent(issue);
    expect(getLookup(local.id)?.result?.evidenceRegions).toEqual(local.result?.evidenceRegions);
  });

  it("rejects an open area editor after another tab replaces the saved component", async () => {
    const user = userEvent.setup();
    const box = { x: 0.1, y: 0.15, width: 0.3, height: 0.4, confidence: 0.9 };
    const local = makeLookup({ focusBox: box, focusMode: "crop", isolatedObjects: [
      { name: "Alternator", category: "electrical", primary: true, focusBox: box, focusMode: "crop", isolatedImageBase64: "" },
      { name: "Bracket", category: "engine", primary: false, focusBox: { ...box, x: 0.55 }, focusMode: "crop", isolatedImageBase64: "" },
    ] });
    localStorage.setItem(accountStorageKey(LOOKUPS_STORAGE_KEY), JSON.stringify([local]));
    const sync = vi.spyOn(cloudSync, "syncLookupToCloud");
    renderResult({ ...successfulScan, savedLookup: local }, `/result/${local.id}`);
    await user.click(screen.getByRole("button", { name: "Select Bracket" }));
    await user.click(screen.getByRole("button", { name: "Correct area" }));
    fireEvent.change(screen.getByRole("slider", { name: "Selection x" }), { target: { value: "35" } });
    const newer = { ...local, isolatedObjects: [local.isolatedObjects![0], { ...local.isolatedObjects![1], name: "Reservoir", focusBox: { ...box, x: 0.4 } }] };
    const newerRaw = JSON.stringify([newer]);
    localStorage.setItem(accountStorageKey(LOOKUPS_STORAGE_KEY), newerRaw);
    await user.click(screen.getByRole("button", { name: "Apply area" }));
    expect(screen.getByText(/changed while you were editing/)).toBeInTheDocument();
    expect(localStorage.getItem(accountStorageKey(LOOKUPS_STORAGE_KEY))).toBe(newerRaw);
    expect(sync).not.toHaveBeenCalled();
  });

  it("does not recreate a device scan removed while its area editor was open", async () => {
    const local = makeLookup({ focusBox: { x: 0.1, y: 0.1, width: 0.3, height: 0.4, confidence: 0 }, focusMode: "crop" });
    localStorage.setItem(accountStorageKey(LOOKUPS_STORAGE_KEY), JSON.stringify([local]));
    renderResult({ ...successfulScan, savedLookup: local }, `/result/${local.id}`);
    await userEvent.click(screen.getByRole("button", { name: "Correct area" }));
    localStorage.setItem(accountStorageKey(LOOKUPS_STORAGE_KEY), "[]");
    await userEvent.click(screen.getByRole("button", { name: "Apply area" }));
    expect(screen.getByText(/removed while you were editing/)).toBeInTheDocument();
    expect(getLookups()).toHaveLength(0);
  });

  it("applies an open unsaved editor to the same scan after Save without duplicating it", async () => {
    renderResult({ ...successfulScan, focusBox: { x: 0.1, y: 0.1, width: 0.3, height: 0.4, confidence: 0 }, focusMode: "crop" });
    await userEvent.click(screen.getByRole("button", { name: "Correct area" }));
    fireEvent.change(screen.getByRole("slider", { name: "Selection x" }), { target: { value: "30" } });
    await userEvent.click(screen.getByRole("button", { name: "Save", exact: true }));
    expect(getLookups()).toHaveLength(1);
    const id = getLookups()[0].id;
    await userEvent.click(screen.getByRole("button", { name: "Apply area" }));
    expect(getLookups()).toHaveLength(1);
    expect(getLookups()[0]).toMatchObject({ id, focusBox: { x: 0.3 }, frame: successfulScan.frame });
  });

  it("keeps the latest correction retry when an earlier cloud save finishes", async () => {
    const user = userEvent.setup();
    const local = makeLookup({
      focusBox: { x: 0.1, y: 0.15, width: 0.3, height: 0.4, confidence: 0.9 },
      focusMode: "crop",
    });
    localStorage.setItem(accountStorageKey(LOOKUPS_STORAGE_KEY), JSON.stringify([local]));
    vi.spyOn(cloudSync, "getCloudSyncStatus").mockReturnValue({ ...cloudSync.getCloudSyncStatus(), configured: true });
    let finishFirst!: (result: cloudSync.CloudSyncResult) => void;
    const firstSave = new Promise<cloudSync.CloudSyncResult>((resolve) => { finishFirst = resolve; });
    const sync = vi.spyOn(cloudSync, "syncLookupToCloud")
      .mockImplementationOnce(() => firstSave)
      .mockResolvedValueOnce({ ok: false, message: "Another cloud save is still running. Retry once it finishes." })
      .mockResolvedValueOnce({ ok: true, message: "Selection synced." });
    renderResult({ ...successfulScan, savedLookup: local }, `/result/${local.id}`);

    await user.click(screen.getByRole("button", { name: "Correct area" }));
    fireEvent.change(screen.getByRole("slider", { name: "Selection x" }), { target: { value: "20" } });
    await user.click(screen.getByRole("button", { name: "Apply area" }));
    expect(sync).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Correct area" }));
    fireEvent.change(screen.getByRole("slider", { name: "Selection x" }), { target: { value: "40" } });
    await user.click(screen.getByRole("button", { name: "Apply area" }));
    expect(await screen.findByRole("button", { name: "Retry cloud selection save" })).toBeInTheDocument();
    expect(getLookup(local.id)?.focusBox?.x).toBe(0.4);

    await act(async () => { finishFirst({ ok: true, message: "First selection synced." }); });
    expect(screen.getByRole("button", { name: "Retry cloud selection save" })).toBeInTheDocument();
    expect(screen.getByText(/Another cloud save is still running/)).toBeInTheDocument();
    expect(screen.queryByText("Selection saved to cloud.")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Retry cloud selection save" }));
    expect(await screen.findByText("Selection saved to cloud.")).toBeInTheDocument();
    expect(sync).toHaveBeenCalledTimes(3);
    expect(sync.mock.calls[2][0].focusBox?.x).toBe(0.4);
    expect(screen.queryByRole("button", { name: "Retry cloud selection save" })).not.toBeInTheDocument();
  });

  it("opens a cloud-only inspection and saves edits under the original scan id", async () => {
    const user = userEvent.setup();
    const cloudLookup = makeLookup({
      frame: { ...frame, imageBase64: "https://example.com/signed-image.jpg" },
      inspection: { ...emptyPartInspection, inspectorName: "Original inspector", inspectedAt: "2026-09-19T12:00:00Z" },
    });
    renderResult({ ...successfulScan, savedLookup: cloudLookup }, `/result/${cloudLookup.id}`);
    await user.click(screen.getByText("Human inspection — saved"));
    expect(screen.getByLabelText("Inspector name (self-reported)")).toHaveValue("Original inspector");
    await user.clear(screen.getByLabelText("Inspector name (self-reported)"));
    await user.paste("New inspector");
    await user.click(screen.getByText("Save inspection", { selector: "button" }));
    expect(getLookup(cloudLookup.id)?.inspection?.inspectorName).toBe("New inspector");
    expect(getLookup(cloudLookup.id)?.frame.imageBase64).toBe("https://example.com/signed-image.jpg");
  });

  it.each([
    ["https://example.test/part.jpg?token=expired", "https://example.test/part.jpg?token=fresh", "https://example.test/part.jpg?token=fresh"],
    [frame.imageBase64, "https://example.test/part.jpg?token=fresh", frame.imageBase64],
    ["https://example.test/cached.jpg", "/brand/deepspec-logo.webp", "https://example.test/cached.jpg"],
  ])("preserves the available photo and local inspection after a device edit (%s / %s)", async (localImage, cloudImage, expectedImage) => {
    const local = makeLookup({
      frame: { ...frame, imageBase64: localImage },
      inspection: { ...emptyPartInspection, inspectorName: "Local inspector", inspectedAt: "2026-09-20T12:00:00.000Z" },
      notes: "Keep receiving notes",
    });
    const cloudLookup = makeLookup({
      frame: { imageBase64: cloudImage, capturedAt: "2026-09-19T12:00:00.000Z" },
      inspection: { ...emptyPartInspection, inspectorName: "Old inspector", inspectedAt: "2026-09-19T12:00:00.000Z" },
    });
    localStorage.setItem(accountStorageKey(LOOKUPS_STORAGE_KEY), JSON.stringify([local]));
    renderResult({ ...successfulScan, savedLookup: cloudLookup }, `/result/${local.id}`);
    expect(screen.getByRole("img", { name: "Captured car part" })).toHaveAttribute("src", expectedImage);
    await userEvent.click(screen.getByRole("button", { name: "Yes", exact: true }));
    expect(screen.getByRole("img", { name: "Captured car part" })).toHaveAttribute("src", expectedImage);
    await userEvent.click(screen.getByText("Human inspection — saved"));
    expect(screen.getByLabelText("Inspector name (self-reported)")).toHaveValue("Local inspector");
    expect(getLookup(local.id)).toMatchObject({
      frame: local.frame, notes: local.notes, inspection: local.inspection, rating: "up",
    });
  });

  it("saves a cloud scan without duplicating its identity or losing its inspection", async () => {
    const user = userEvent.setup();
    const cloudLookup = makeLookup({
      inspection: { ...emptyPartInspection, inspectorName: "Pat", inspectedAt: "2026-09-19T12:00:00.000Z" },
      notes: "Keep original notes",
    });
    renderResult({ ...successfulScan, savedLookup: cloudLookup }, `/result/${cloudLookup.id}`);
    await user.click(screen.getByRole("button", { name: "Save", exact: true }));
    expect(getLookups()).toHaveLength(1);
    expect(getLookup(cloudLookup.id)).toMatchObject({
      id: cloudLookup.id, inspection: cloudLookup.inspection, notes: "Keep original notes",
    });
  });

  it("automatically prepares an intake draft after saving without requiring inspection", async () => {
    const user = userEvent.setup();
    renderResult(successfulScan);
    expect(screen.queryByRole("region", { name: "Automatic intake draft" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save", exact: true }));
    expect(screen.getByRole("region", { name: "Automatic intake draft" })).toHaveTextContent("AI suggestion — not verified");
    expect(screen.getByRole("region", { name: "Automatic intake draft" })).toHaveTextContent("Not tested");
    expect(screen.getByRole("region", { name: "Automatic intake draft" })).toHaveTextContent("Identity awaiting review");
    expect(getLookups()).toHaveLength(1);
    expect(getLookups()[0].inspection).toBeUndefined();
    expect(reportService.buildScanReport(getLookups()[0])).toContain("Automatic intake draft");
  });

  it.each(["initial", "retried"])("saves and reopens every photo and corrected object from an unsaved %s result", async (source) => {
    const user = userEvent.setup();
    const box = { x: 0.1, y: 0.2, width: 0.3, height: 0.4, confidence: 0 };
    const scan: ScanAnalysisState = {
      ...successfulScan, focusBox: box, focusMode: "crop", isolatedImageBase64: "",
      photos: [{ ...frame, id: "overview-photo", label: "overview" },
        { ...frame, id: "detail-photo", label: "close_up", imageBase64: "data:image/jpeg;base64,ZGV0YWls" },
        { ...frame, id: "marking-photo", label: "marking", imageBase64: "data:image/jpeg;base64,bWFya2luZw==" }],
      isolatedObjects: [
        { name: "Bracket", category: "engine", primary: false, focusBox: { ...box, x: 0.5 }, isolatedImageBase64: "data:image/png;base64,YnJhY2tldA==", focusMode: "mask" },
        { name: "Alternator", category: "electrical", primary: true, focusBox: box, isolatedImageBase64: "", focusMode: "crop", correctedAt: "2026-11-05T01:00:00.000Z" },
      ],
    };
    const initialScan = source === "retried" ? { ...scan, result: undefined, errorCode: "network", errorMessage: "Network error" } : scan;
    vi.spyOn(aiService, "identifyCapturedFrame").mockResolvedValue(successfulScan.result!);
    const mounted = render(<MemoryRouter initialEntries={[{ pathname: "/result", state: withAccountRouteState(initialScan) }]}>
      <Routes><Route path="/result" element={<Result />} /></Routes>
    </MemoryRouter>);
    expect(getLookups()).toHaveLength(0);
    if (source === "retried") {
      await user.click(screen.getByRole("button", { name: "Try again" }));
      await screen.findByRole("heading", { level: 1, name: "Alternator" });
      expect(screen.queryByText("Network error")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Select Bracket" })).toBeInTheDocument();
    }
    await user.click(screen.getByRole("button", { name: "Save", exact: true }));

    const saved = getLookups()[0];
    expect(getLookups()).toHaveLength(1);
    expect(saved).toMatchObject({ frame: scan.frame, photos: scan.photos, isolatedObjects: scan.isolatedObjects,
      focusBox: box, focusMode: "crop", isolatedImageBase64: "" });
    expect(saved.errorCode).toBeUndefined();
    expect(saved.errorMessage).toBeUndefined();
    mounted.unmount();
    renderResult(null, `/result/${saved.id}`);
    expect(screen.getByRole("button", { name: "Select Bracket" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Select Alternator" })).toBeInTheDocument();
    expect(screen.getByAltText("Captured car part")).toHaveAttribute("src", frame.imageBase64);
    await user.click(screen.getByRole("button", { name: "3. Label or marking" }));
    expect(screen.getByAltText("Captured car part")).toHaveAttribute("src", scan.photos![2].imageBase64);
    expect(getLookup(saved.id)?.isolatedObjects).toEqual(scan.isolatedObjects);
  });

  it("does not project a late retry result onto a replacement original photo", async () => {
    const box = { x: 0.1, y: 0.2, width: 0.3, height: 0.4, confidence: 0 };
    const failed: ScanAnalysisState = { frame, focusBox: box, focusMode: "crop",
      errorCode: "network", errorMessage: "First photo could not be analyzed." };
    const replacement: ScanAnalysisState = { frame: { imageBase64: "data:image/jpeg;base64,bmV3LXBob3Rv", capturedAt: "2026-11-05T02:00:00Z" },
      errorCode: "network", errorMessage: "Replacement photo is not analyzed." };
    let finish!: (result: NonNullable<ScanAnalysisState["result"]>) => void;
    vi.spyOn(aiService, "identifyCapturedFrame").mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    render(<MemoryRouter initialEntries={[{ pathname: "/result", state: withAccountRouteState(failed) }]}>
      <Link to="/result" state={withAccountRouteState(replacement)}>Replace original photo</Link>
      <Routes><Route path="/result" element={<Result />} /></Routes>
    </MemoryRouter>);
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    await userEvent.click(screen.getByRole("link", { name: "Replace original photo" }));
    await act(async () => finish(successfulScan.result!));
    expect(screen.getByAltText("Captured car part")).toHaveAttribute("src", replacement.frame.imageBase64);
    expect(screen.getByTestId("result-focus-frame")).toHaveAttribute("data-focus-mode", "full_frame");
    expect(screen.queryByTestId("focused-part-window")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Original", exact: true })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("heading", { level: 1, name: "Alternator" })).not.toBeInTheDocument();
    expect(screen.getByText("Replacement photo is not analyzed.")).toBeInTheDocument();
    expect(getLookups()).toHaveLength(0);
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
    expect(screen.getByText("AI overview")).toBeInTheDocument();
    expect(screen.getByText("AI estimate: high")).toBeInTheDocument();
    expect(screen.getByText("AI estimate: low")).toBeInTheDocument();
    expect(screen.getByText(/do not represent measured chances of a correct identification/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ask DeepSpec" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Other possible matches" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Complete brief" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Refine" })).not.toBeInTheDocument();
    expect(screen.queryByText("More evidence")).not.toBeInTheDocument();
    expect(screen.queryByText("Capture another angle")).not.toBeInTheDocument();
  });

  it.each([
    ["groq", "qwen/qwen3.8-27b", "primary"],
    ["huggingface", "google/gemma-4-31b-it:free", "gemini_not_configured"],
  ] as const)("describes a %s winner as cloud analysis without inventing a fallback cause", (provider, model, fallbackReason) => {
    renderResult({
      ...successfulScan,
      result: {
        ...successfulScan.result!,
        modelRun: {
          provider,
          model,
          latencyMs: 1234,
          fallbackReason,
          ocrUsed: false,
        },
      },
    });

    expect(
      screen.getByText("Analysis completed using a DeepSpec cloud model. Double-check critical details before relying on it."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/main one was busy|backup model/i)).not.toBeInTheDocument();
  });

  it("does not add an alternate route notice to a Gemini result", () => {
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

    expect(screen.queryByText(/Analysis completed using/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/main one was busy|backup model/i)).not.toBeInTheDocument();
  });

  it("describes an Ollama winner as locally hosted without naming provider internals", () => {
    renderResult({
      ...successfulScan,
      result: {
        ...successfulScan.result!,
        modelRun: {
          provider: "ollama",
          model: "qwen2.5vl:7b",
          latencyMs: 900,
          ocrUsed: false,
        },
      },
    });

    expect(
      screen.getByText("Analysis completed using a locally hosted model. Double-check critical details before relying on it."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/ollama|main one was busy|backup model/i)).not.toBeInTheDocument();
  });

  it("keeps the on-device offline warning distinct from hosted route notices", () => {
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
    expect(screen.queryByText(/Analysis completed using/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/main one was busy|backup model/i)).not.toBeInTheDocument();
  });

  it("restores detected label text and exact research tools in the AI view", async () => {
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
    expect(screen.getByText("AI overview")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "Text output" }));
    expect(screen.getByRole("region", { name: "Text output" })).toBeInTheDocument();
    expect(screen.getByText("DENSO 104210-1230")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Search exact" })).toHaveAttribute("href", "https://www.google.com/search?q=DENSO%20104210-1230");
    expect(screen.getByRole("link", { name: "Search with part" })).toHaveAttribute("href", "https://www.google.com/search?q=DENSO%20104210-1230%20Alternator%20car%20part");
    expect(screen.getByTestId("result-photo-panel")).not.toContainElement(screen.getByTestId("result-overview-panel"));
    expect(screen.getByTestId("result-photo-canvas")).not.toContainElement(screen.getByRole("heading", { level: 1, name: "Alternator" }));
  });

  it("opens returned research and video references from the full AI view", async () => {
    renderResult({ ...successfulScan, result: { ...successfulScan.result!, sourceLinks: [
      ...successfulScan.result!.sourceLinks,
      { label: "Video inspection", url: "https://youtu.be/inspection", sourceType: "reference" },
    ] } });
    await userEvent.click(screen.getByRole("tab", { name: "Sources" }));
    expect(screen.getByRole("link", { name: /Search this part/ })).toHaveAttribute("href", successfulScan.result!.sourceLinks[0].url);
    expect(screen.getByRole("link", { name: /Video inspection/ })).toHaveAttribute("href", "https://youtu.be/inspection");
    expect(screen.getByRole("link", { name: /Search YouTube/ })).toHaveAttribute("href", "https://www.youtube.com/results?search_query=Alternator%20car%20part");
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
    expect(screen.getByText(/Verify before driving/)).toBeInTheDocument();
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
            state: withAccountRouteState(successfulScan),
          },
        ]}
      >
        <Routes>
          <Route path="/result" element={<Result />} />
          <Route path="/result/:id/chat" element={<p>Chat page</p>} />
        </Routes>
      </MemoryRouter>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Ask DeepSpec" }));

    expect(screen.getByText("Chat page")).toBeInTheDocument();
    const savedLookups = JSON.parse(localStorage.getItem(accountStorageKey(LOOKUPS_STORAGE_KEY)) ?? "[]") as Lookup[];
    expect(savedLookups).toHaveLength(1);
    expect(savedLookups[0].result?.partName).toBe("Alternator");
    expect(savedLookups[0].provenance).toMatchObject(successfulScan.provenance!);
    expect(savedLookups[0].trainingStatus).toBe("raw_unreviewed");
  });

  it("restores the latest successful scan after a refresh", () => {
    sessionStorage.setItem(accountStorageKey("deep-spec:latest-scan-state"), JSON.stringify(successfulScan));

    renderResult(null);

    expect(screen.getByRole("heading", { level: 1, name: "Alternator" })).toBeInTheDocument();
    expect(screen.getAllByText("It charges the battery while the engine runs.").length).toBeGreaterThan(0);
  });

  it("handles an unrouted result page without captured state", () => {
    renderResult(null, "/result");

    expect(screen.getByText("No frame captured.")).toBeInTheDocument();
  });

  it("never substitutes the latest scan for a missing routed result", async () => {
    sessionStorage.setItem(accountStorageKey("deep-spec:latest-scan-state"), JSON.stringify(successfulScan));
    let resolveRead: ((value: { ok: true; value: null }) => void) | undefined;
    cloudHistoryMocks.readCloudLookup.mockReturnValue(new Promise((resolve) => { resolveRead = resolve; }));

    renderResult(null, "/result/requested-scan");

    expect(screen.getAllByText("Loading saved scan...")).toHaveLength(2);
    await act(async () => { resolveRead?.({ ok: true, value: null }); });
    expect(await screen.findByRole("heading", { name: "Saved scan not found" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 1, name: "Alternator" })).not.toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "Captured car part" })).not.toBeInTheDocument();
  });

  it("restores an exact cloud-only result after refresh and retains its photo, result, and chat", async () => {
    const cloudLookup = makeLookup({
      id: "cloud-only",
      frame: { imageBase64: "https://example.test/signed-cloud-photo", capturedAt: frame.capturedAt },
      result: { ...successfulScan.result!, partName: "Cloud-only starter" },
      chatHistory: [{ id: "cloud-chat", role: "assistant", content: "Saved cloud guidance", timestamp: "2026-05-16T00:01:00.000Z" }],
    });
    cloudHistoryMocks.readCloudLookup.mockResolvedValue({ ok: true, value: cloudLookup });

    renderResult(null, "/result/cloud-only");

    expect(await screen.findByRole("heading", { level: 1, name: "Cloud-only starter" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Captured car part" })).toHaveAttribute("src", "https://example.test/signed-cloud-photo");
    await userEvent.click(screen.getByRole("button", { name: "Ask DeepSpec" }));
    expect(await screen.findByText("Saved cloud guidance")).toBeInTheDocument();
    expect(getLookup("cloud-only")).toMatchObject({
      id: "cloud-only",
      frame: cloudLookup.frame,
      result: { partName: "Cloud-only starter" },
      chatHistory: cloudLookup.chatHistory,
    });
  });

  it("shows not found for an exact cloud miss", async () => {
    renderResult(null, "/result/missing-cloud-scan");

    expect(await screen.findByRole("heading", { name: "Saved scan not found" })).toBeInTheDocument();
    expect(screen.getByText("No scan with this link exists in your signed-in account.")).toBeInTheDocument();
  });

  it("directs a missing device result to saved scans without cloud restoration or an impossible retry when sync is off", async () => {
    vi.stubEnv("VITE_ENABLE_CLOUD_SYNC", "false");
    sessionStorage.setItem(accountStorageKey("deep-spec:latest-scan-state"), JSON.stringify(successfulScan));
    cloudHistoryMocks.readCloudLookup.mockResolvedValue({ ok: true, value: makeLookup({ id: "cloud-only" }) });

    renderResult(null, "/result/cloud-only");

    expect(await screen.findByText("Cloud history is off. This scan is not saved on this device. Open saved scans to choose an available device record.")).toBeInTheDocument();
    expect(cloudHistoryMocks.readCloudLookup).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Retry loading" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 1, name: "Alternator" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("link", { name: "Open saved scans" }));
    expect(screen.getByText("Saved scans page")).toBeInTheDocument();
  });

  it("still restores an exact device result when cloud sync is off", async () => {
    vi.stubEnv("VITE_ENABLE_CLOUD_SYNC", "false");
    const local = makeLookup();
    localStorage.setItem(accountStorageKey(LOOKUPS_STORAGE_KEY), JSON.stringify([local]));

    renderResult(null, `/result/${local.id}`);

    expect(await screen.findByRole("heading", { level: 1, name: "Alternator" })).toBeInTheDocument();
    expect(cloudHistoryMocks.readCloudLookup).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Retry loading" })).not.toBeInTheDocument();
  });

  it("shows a retryable cloud outage without showing another scan", async () => {
    const restored = makeLookup({ id: "retry-cloud", result: { ...successfulScan.result!, partName: "Recovered starter" } });
    cloudHistoryMocks.readCloudLookup
      .mockResolvedValueOnce({ ok: false, message: "Cloud history is temporarily unavailable." })
      .mockResolvedValueOnce({ ok: true, value: restored });

    renderResult(null, "/result/retry-cloud");

    expect(await screen.findByRole("heading", { name: "Saved scan unavailable" })).toBeInTheDocument();
    expect(screen.getByText("Cloud history is temporarily unavailable.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Retry loading" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Recovered starter" })).toBeInTheDocument();
  });

  it("does not reveal a cloud response after the active account changes", async () => {
    let resolveRead: ((value: { ok: true; value: Lookup }) => void) | undefined;
    cloudHistoryMocks.readCloudLookup.mockReturnValue(new Promise((resolve) => { resolveRead = resolve; }));
    const foreignLookup = makeLookup({ id: "account-bound", result: { ...successfulScan.result!, partName: "Private account result" } });

    renderResult(null, "/result/account-bound");
    setActiveAccount("other-user");
    resolveRead?.({ ok: true, value: foreignLookup });

    await waitFor(() => expect(screen.queryByText("Loading saved scan...")).not.toBeInTheDocument());
    expect(screen.getByRole("heading", { name: "Saved scan unavailable" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Private account result" })).not.toBeInTheDocument();
  });

  it("captures distrust and a reason for a saved scan", async () => {
    const lookup = makeLookup();
    localStorage.setItem(accountStorageKey(LOOKUPS_STORAGE_KEY), JSON.stringify([lookup]));

    renderResult(null, `/result/${lookup.id}`);

    await userEvent.click(screen.getByRole("button", { name: "Why or why not" }));
    await userEvent.type(screen.getByLabelText("Why or why not"), "It was the starter.");

    const savedLookup = JSON.parse(localStorage.getItem(accountStorageKey(LOOKUPS_STORAGE_KEY)) ?? "[]")[0] as Lookup;
    expect(savedLookup.rating).toBe("down");
    expect(savedLookup.correction).toBe("It was the starter.");
    expect(savedLookup.trainingLabel).toBe("It was the starter.");
    expect(savedLookup.trainingStatus).toBe("user_corrected");
  }, 30000);

  it("marks a trusted scan with a positive rating", async () => {
    const lookup = makeLookup();
    localStorage.setItem(accountStorageKey(LOOKUPS_STORAGE_KEY), JSON.stringify([lookup]));

    renderResult(null, `/result/${lookup.id}`);

    expect(screen.getByTestId("trust-control")).toHaveTextContent("Do you trust this scan?");
    await userEvent.click(screen.getByRole("button", { name: "Yes" }));

    const savedLookup = JSON.parse(localStorage.getItem(accountStorageKey(LOOKUPS_STORAGE_KEY)) ?? "[]")[0] as Lookup;
    expect(savedLookup.rating).toBe("up");
  }, 30000);

  it("keeps failed feedback edits visible and retries saving them without claiming success", () => {
    const lookup = makeLookup();
    const key = accountStorageKey(LOOKUPS_STORAGE_KEY);
    localStorage.setItem(key, JSON.stringify([lookup]));
    renderResult(null, `/result/${lookup.id}`);
    const originalSetItem = Storage.prototype.setItem;
    const write = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, name, value) {
      if (name === key) throw new DOMException("Full", "QuotaExceededError");
      originalSetItem.call(this, name, value);
    });

    fireEvent.click(screen.getByRole("button", { name: "Why or why not" }));
    fireEvent.change(screen.getByLabelText("Why or why not"), { target: { value: "Actually a starter" } });
    expect(screen.getByLabelText("Why or why not")).toHaveValue("Actually a starter");
    expect(screen.getByText("Not saved locally")).toBeInTheDocument();
    expect(screen.getByText(/Your device storage is full/)).toBeInTheDocument();
    expect(screen.getByTestId("trust-control")).toHaveTextContent("Feedback is not saved.");
    expect(screen.getByTestId("trust-control")).not.toHaveTextContent("Feedback is saved with this scan.");
    expect(getLookup(lookup.id)).toMatchObject({ rating: null, correction: null });

    write.mockRestore();
    fireEvent.click(screen.getByRole("button", { name: "Retry saving feedback" }));
    expect(getLookup(lookup.id)).toMatchObject({ rating: "down", correction: "Actually a starter", trainingLabel: "Actually a starter" });
    expect(screen.queryByText("Not saved locally")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry saving feedback" })).not.toBeInTheDocument();
    expect(screen.getByTestId("trust-control")).toHaveTextContent("Feedback is saved with this scan.");
  });

  it("preserves a failed rating when a later correction write succeeds", () => {
    const lookup = makeLookup();
    const key = accountStorageKey(LOOKUPS_STORAGE_KEY);
    localStorage.setItem(key, JSON.stringify([lookup]));
    renderResult(null, `/result/${lookup.id}`);
    const originalSetItem = Storage.prototype.setItem;
    const write = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, name, value) {
      if (name === key) throw new DOMException("Full", "QuotaExceededError");
      originalSetItem.call(this, name, value);
    });
    fireEvent.click(screen.getByRole("button", { name: "Why or why not" }));
    expect(getLookup(lookup.id)?.rating).toBeNull();
    write.mockRestore();
    fireEvent.change(screen.getByLabelText("Why or why not"), { target: { value: "Starter label visible" } });
    expect(getLookup(lookup.id)).toMatchObject({ rating: "down", correction: "Starter label visible" });
    expect(screen.queryByText("Not saved locally")).not.toBeInTheDocument();
  });

  it("preserves another tab's latest rating when editing a correction", () => {
    const lookup = { ...makeLookup(), rating: "down" as const };
    localStorage.setItem(accountStorageKey(LOOKUPS_STORAGE_KEY), JSON.stringify([lookup]));
    renderResult(null, `/result/${lookup.id}`);
    expect(updateLookup(lookup.id, { rating: "up" }).ok).toBe(true);

    fireEvent.change(screen.getByLabelText("Why or why not"), { target: { value: "New detail from this tab" } });

    expect(getLookup(lookup.id)).toMatchObject({ rating: "up", correction: "New detail from this tab" });
  });

  it("does not overwrite another tab's rating when retrying only a failed correction", () => {
    const lookup = { ...makeLookup(), rating: "down" as const };
    const key = accountStorageKey(LOOKUPS_STORAGE_KEY);
    localStorage.setItem(key, JSON.stringify([lookup]));
    renderResult(null, `/result/${lookup.id}`);
    const originalSetItem = Storage.prototype.setItem;
    const write = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, name, value) {
      if (name === key) throw new DOMException("Full", "QuotaExceededError");
      originalSetItem.call(this, name, value);
    });
    fireEvent.change(screen.getByLabelText("Why or why not"), { target: { value: "Keep my correction" } });
    write.mockRestore();
    expect(updateLookup(lookup.id, { rating: "up" }).ok).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Retry saving feedback" }));

    expect(getLookup(lookup.id)).toMatchObject({ rating: "up", correction: "Keep my correction" });
  });

  it("keeps pending feedback when an inspection is saved on the same page", () => {
    const lookup = makeLookup();
    const key = accountStorageKey(LOOKUPS_STORAGE_KEY);
    localStorage.setItem(key, JSON.stringify([lookup]));
    renderResult(null, `/result/${lookup.id}`);
    const originalSetItem = Storage.prototype.setItem;
    const write = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, name, value) {
      if (name === key) throw new DOMException("Full", "QuotaExceededError");
      originalSetItem.call(this, name, value);
    });
    fireEvent.click(screen.getByRole("button", { name: "Why or why not" }));
    fireEvent.change(screen.getByLabelText("Why or why not"), { target: { value: "Pending correction" } });
    write.mockRestore();

    fireEvent.click(screen.getByText("Human inspection — optional"));
    fireEvent.change(screen.getByLabelText("Inspector name (self-reported)"), { target: { value: "Test inspector" } });
    fireEvent.click(screen.getByRole("button", { name: "Save inspection" }));
    expect(getLookup(lookup.id)?.inspection?.inspectorName).toBe("Test inspector");
    expect(getLookup(lookup.id)?.correction).toBeNull();
    expect(screen.getByLabelText("Why or why not")).toHaveValue("Pending correction");
    expect(screen.getByTestId("trust-control")).toHaveTextContent("Feedback is not saved.");

    fireEvent.click(screen.getByRole("button", { name: "Retry saving feedback" }));
    expect(getLookup(lookup.id)).toMatchObject({ rating: "down", correction: "Pending correction", inspection: { inspectorName: "Test inspector" } });
  });

  it("keeps share and export report actions on a saved scan", () => {
    const lookup = makeLookup();
    localStorage.setItem(accountStorageKey(LOOKUPS_STORAGE_KEY), JSON.stringify([lookup]));

    renderResult(null, `/result/${lookup.id}`);

    expect(screen.getByRole("button", { name: "Share" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export" })).toBeInTheDocument();
  });

  it("stays quiet when the user dismisses the native share sheet", async () => {
    const lookup = makeLookup();
    localStorage.setItem(accountStorageKey(LOOKUPS_STORAGE_KEY), JSON.stringify([lookup]));
    const share = vi.fn().mockRejectedValue(new DOMException("Share canceled", "AbortError"));
    Object.defineProperty(navigator, "share", { configurable: true, value: share });

    try {
      renderResult(null, `/result/${lookup.id}`);
      await userEvent.click(screen.getByRole("button", { name: "Share" }));

      expect(share).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId("report-actions")).not.toHaveTextContent(/won't share/i);
    } finally {
      Reflect.deleteProperty(navigator, "share");
    }
  });

  it("still tells the user when sharing genuinely fails", async () => {
    const lookup = makeLookup();
    localStorage.setItem(accountStorageKey(LOOKUPS_STORAGE_KEY), JSON.stringify([lookup]));
    const share = vi.fn().mockRejectedValue(new DOMException("Not allowed", "NotAllowedError"));
    Object.defineProperty(navigator, "share", { configurable: true, value: share });

    try {
      renderResult(null, `/result/${lookup.id}`);
      await userEvent.click(screen.getByRole("button", { name: "Share" }));

      expect(screen.getByTestId("report-actions")).toHaveTextContent(/won't share/i);
    } finally {
      Reflect.deleteProperty(navigator, "share");
    }
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
    expect(screen.getByText(/Connection is active/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(identifySpy).toHaveBeenCalledWith(frame, undefined, undefined, { vehicleContext: undefined });
    expect(localStorage.getItem(accountStorageKey(LOOKUPS_STORAGE_KEY))).toBeNull();
    expect(screen.queryByText("Provider unavailable")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Alternator" })).toBeInTheDocument();

    onlineSpy.mockRestore();
  });

  it.each(["Save", "Save inspection"])("preserves a successful cloud retry in report and %s under its original id", async (saveAction) => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    vi.spyOn(aiService, "identifyCapturedFrame").mockResolvedValue(successfulScan.result!);
    const failedLookup = makeLookup({
      result: undefined, errorCode: "network", errorMessage: "Network error", analyzedAt: undefined,
      scanCategory: "unknown", trainingLabel: "unlabeled",
      notes: "Keep this intake note",
      inspection: { ...emptyPartInspection, inspectorName: "Pat", inspectedAt: "2026-09-19T12:00:00.000Z" },
      chatHistory: [{ id: "message-1", role: "user", content: "Original question", timestamp: "2026-09-19T12:00:00.000Z" }],
    });
    renderResult({ frame, errorCode: "network", errorMessage: "Network error", savedLookup: failedLookup }, `/result/${failedLookup.id}`);
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.getByRole("heading", { level: 1, name: "Alternator" })).toBeInTheDocument();
    const report = vi.spyOn(reportService, "buildScanReport");
    await userEvent.click(screen.getByRole("button", { name: "Share", exact: true }));
    expect(report).toHaveBeenCalledWith(expect.objectContaining({
      result: successfulScan.result, errorCode: undefined, errorMessage: undefined,
    }));
    if (saveAction === "Save inspection") await userEvent.click(screen.getByText("Human inspection — saved"));
    await userEvent.click(screen.getByRole("button", { name: saveAction, exact: true }));
    expect(getLookups()).toHaveLength(1);
    expect(getLookup(failedLookup.id)).toMatchObject({
      id: failedLookup.id, result: successfulScan.result, notes: failedLookup.notes,
      inspection: expect.objectContaining({ inspectorName: "Pat", functionalStatus: "not_tested" }), chatHistory: failedLookup.chatHistory,
      trainingLabel: "Alternator", scanCategory: "electrical", trainingStatus: "raw_unreviewed",
      provenance: { analysisSource: "manual_retry" },
    });
    expect(getLookup(failedLookup.id)?.errorCode).toBeUndefined();
    expect(getLookup(failedLookup.id)?.errorMessage).toBeUndefined();
    expect(screen.queryByText("Network error")).not.toBeInTheDocument();
  });

  it.each(["device", "unsaved"])("retains vehicle context and fitment safeguards on a %s retry", async (source) => {
    const vehicleContext = { year: "2012", make: "Honda", model: "Civic" };
    const identifySpy = vi.spyOn(aiService, "identifyCapturedFrame").mockResolvedValue({ ...successfulScan.result!, fitmentConfidence: "supported" });
    const failure = { frame, vehicleContext, errorCode: "network", errorMessage: "Network error" };
    if (source === "device") {
      const failedLookup = makeLookup({ ...failure, result: undefined });
      localStorage.setItem(accountStorageKey(LOOKUPS_STORAGE_KEY), JSON.stringify([failedLookup]));
      renderResult(null, `/result/${failedLookup.id}`);
    } else renderResult(failure);
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(identifySpy).toHaveBeenCalledWith(frame, undefined, undefined, { vehicleContext });
    if (source === "unsaved") await userEvent.click(screen.getByRole("button", { name: "Save", exact: true }));
    expect(getLookups()[0]).toMatchObject({ vehicleContext, result: { fitmentConfidence: "needs_vehicle_context", requiredNextEvidence: expect.arrayContaining(["VIN"]) } });
  });

  it.each(["device", "unsaved"])("preserves independent photo metadata on a %s retry and subsequent save", async (source) => {
    const photos = [
      { ...frame, id: "first", label: "overview" as const },
      { ...frame, id: "second", label: "other" as const, imageBase64: "data:image/jpeg;base64,c2Vjb25k" },
    ];
    const failure: ScanAnalysisState = { frame, photos, photoRelationship: "independent", errorCode: "network", errorMessage: "Network error" };
    const identify = vi.spyOn(aiService, "identifyCapturedFrame").mockResolvedValue(successfulScan.result!);
    if (source === "device") {
      const saved = makeLookup({ ...failure, result: undefined });
      localStorage.setItem(accountStorageKey(LOOKUPS_STORAGE_KEY), JSON.stringify([saved]));
      renderResult(null, `/result/${saved.id}`);
    } else renderResult(failure);
    expect(screen.getByText(/Independent examples — do not assume/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(identify).toHaveBeenCalledExactlyOnceWith(frame, undefined, undefined, expect.objectContaining({ photos, photoRelationship: "independent" }));
    if (source === "unsaved") await userEvent.click(screen.getByRole("button", { name: "Save", exact: true }));
    expect(getLookups()).toHaveLength(1);
    expect(getLookups()[0]).toMatchObject({ photos, photoRelationship: "independent" });
  });

  it("retries a failed cloud-only HTTPS photo with a data URL and retains vehicle context and identity", async () => {
    const vehicleContext = { year: "2012", make: "Honda", model: "Civic" };
    const cloudFrame = { ...frame, imageBase64: "https://example.test/private-photo.png?token=signed" };
    const focusBox = { x: 0.1, y: 0.2, width: 0.3, height: 0.4, confidence: 0 };
    const failedLookup = makeLookup({ frame: cloudFrame, vehicleContext, result: undefined, errorCode: "network", errorMessage: "Network error",
      photos: [{ ...cloudFrame, id: "cloud-overview", label: "overview" }],
      focusBox, focusMode: "crop", isolatedImageBase64: "",
      isolatedObjects: [{ name: "Alternator", category: "electrical", primary: true, focusBox, isolatedImageBase64: "", focusMode: "crop", correctedAt: "2026-11-05T01:00:00.000Z" }],
    });
    const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9XkAAAAASUVORK5CYII=";
    const blob = new Blob([Uint8Array.from(atob(png), (char) => char.charCodeAt(0))], { type: "image/png" });
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, blob: async () => blob });
    vi.stubGlobal("fetch", fetchSpy);
    const identifySpy = vi.spyOn(aiService, "identifyCapturedFrame").mockResolvedValue({ ...successfulScan.result!, fitmentConfidence: "supported" });
    renderResult({ frame: cloudFrame, vehicleContext, errorCode: "network", errorMessage: "Network error", savedLookup: failedLookup }, `/result/${failedLookup.id}`);
    expect(getLookups()).toEqual([]);
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByRole("heading", { level: 1, name: "Alternator" });
    expect(fetchSpy).toHaveBeenCalledWith(cloudFrame.imageBase64, { signal: expect.any(AbortSignal), credentials: "omit" });
    expect(identifySpy).toHaveBeenCalledWith({ ...cloudFrame, imageBase64: `data:image/png;base64,${png}` }, undefined, undefined, { vehicleContext, photos: failedLookup.photos });
    expect(screen.getByTestId("result-focus-frame")).toHaveAttribute("data-focus-mode", "crop");
    expect(screen.getByTestId("focused-part-window")).toHaveStyle({ left: "10%", top: "20%" });
    await userEvent.click(screen.getByRole("button", { name: "Save", exact: true }));
    expect(getLookups()).toHaveLength(1);
    expect(getLookup(failedLookup.id)).toMatchObject({
      frame: { ...cloudFrame, imageBase64: `data:image/png;base64,${png}` },
      photos: failedLookup.photos, isolatedObjects: failedLookup.isolatedObjects, focusBox, focusMode: "crop", isolatedImageBase64: "",
      vehicleContext,
      result: { fitmentConfidence: "needs_vehicle_context" },
    });
  });

  it("shows a successful retry with a persistence warning when the durable write is full", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    vi.spyOn(aiService, "identifyCapturedFrame").mockResolvedValue(successfulScan.result!);
    const failedLookup = makeLookup({ result: undefined, errorCode: "network", errorMessage: "Network error" });
    localStorage.setItem(accountStorageKey(LOOKUPS_STORAGE_KEY), JSON.stringify([failedLookup]));
    const key = accountStorageKey(LOOKUPS_STORAGE_KEY);
    const originalSetItem = Storage.prototype.setItem;
    const write = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, name, value) {
      if (name === key) throw new DOMException("Full", "QuotaExceededError");
      originalSetItem.call(this, name, value);
    });

    renderResult(null, `/result/${failedLookup.id}`);
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByRole("heading", { level: 1, name: "Alternator" })).toBeInTheDocument();
    expect(screen.getByText(/device storage is full/i)).toBeInTheDocument();
    expect(getLookup(failedLookup.id)?.result).toBeUndefined();
    expect(getLookup(failedLookup.id)?.errorMessage).toBe("Network error");
    expect(screen.queryByRole("link", { name: "Ask DeepSpec", exact: true })).not.toBeInTheDocument();
    const ask = screen.getByRole("button", { name: "Ask DeepSpec", exact: true });
    expect(ask).toBeDisabled();
    await userEvent.click(ask);
    expect(screen.queryByLabelText("Ask a follow-up question")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Alternator" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Why or why not" }));
    fireEvent.change(screen.getByLabelText("Why or why not"), { target: { value: "Starter label is visible" } });
    expect(screen.getByLabelText("Why or why not")).toHaveValue("Starter label is visible");

    await userEvent.click(screen.getByRole("button", { name: "Retry saving scan result" }));
    expect(screen.getByLabelText("Why or why not")).toHaveValue("Starter label is visible");
    expect(screen.getByRole("button", { name: "Retry saving scan result" })).toBeInTheDocument();

    expect(screen.getByRole("button", { name: "Ask DeepSpec", exact: true })).toBeDisabled();
    expect(getLookup(failedLookup.id)?.result).toBeUndefined();
    write.mockRestore();

    await userEvent.click(screen.getByRole("button", { name: "Retry saving scan result" }));
    expect(getLookup(failedLookup.id)).toMatchObject({
      result: { partName: "Alternator" },
      rating: "down",
      correction: "Starter label is visible",
    });
    expect(getLookup(failedLookup.id)?.errorMessage).toBeUndefined();
    expect(screen.queryByRole("button", { name: "Retry saving scan result" })).not.toBeInTheDocument();
    const savedAsk = screen.getByRole("link", { name: "Ask DeepSpec", exact: true });
    expect(savedAsk).toHaveAttribute("href", `/result/${failedLookup.id}/chat`);
    await userEvent.click(savedAsk);
    expect(screen.getByRole("heading", { name: "Alternator" })).toBeInTheDocument();
    expect(screen.getByLabelText("Ask a follow-up question")).toBeEnabled();
    expect(aiService.identifyCapturedFrame).toHaveBeenCalledTimes(1);
  });

  it.each([
    [false, "image/png", "photo"],
    [true, "text/html", "<html>expired link</html>"],
    [true, "image/png", "not an image"],
  ])("does not identify an unavailable or invalid cloud photo (%s / %s)", async (ok, type, content) => {
    const cloudFrame = { ...frame, imageBase64: "https://example.test/expired-photo" };
    const failedLookup = makeLookup({ frame: cloudFrame, result: undefined, errorCode: "network", errorMessage: "Network error" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok, blob: async () => new Blob([content], { type }) }));
    const identifySpy = vi.spyOn(aiService, "identifyCapturedFrame");
    renderResult({ frame: cloudFrame, errorCode: "network", errorMessage: "Network error", savedLookup: failedLookup }, `/result/${failedLookup.id}`);
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByText(/The saved photo/);
    expect(identifySpy).not.toHaveBeenCalled();
    expect(screen.getByText("Network error")).toBeInTheDocument();
    expect(getLookup(failedLookup.id)?.result).toBeUndefined();
  });

  it("does not identify a cloud photo after the account changes during download", async () => {
    const cloudFrame = { ...frame, imageBase64: "https://example.test/private-photo.png" };
    const failedLookup = makeLookup({ frame: cloudFrame, result: undefined, errorCode: "network", errorMessage: "Network error" });
    let finishDownload!: (blob: Blob) => void;
    const download = new Promise<Blob>((resolve) => { finishDownload = resolve; });
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, blob: () => download });
    vi.stubGlobal("fetch", fetchSpy);
    const identifySpy = vi.spyOn(aiService, "identifyCapturedFrame");
    renderResult({ frame: cloudFrame, errorCode: "network", errorMessage: "Network error", savedLookup: failedLookup }, `/result/${failedLookup.id}`);
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    setActiveAccount("other-user");
    finishDownload(new Blob([Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])], { type: "image/png" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Try again" })).toBeEnabled());
    expect(identifySpy).not.toHaveBeenCalled();
    expect(getLookups()).toEqual([]);
  });

  it.each(["resolve", "reject"])("ignores a pending retry after navigation when it will %s", async (outcome) => {
    const failedLookup = makeLookup({ id: "failed-route", result: undefined, errorCode: "network", errorMessage: "Network error" });
    const nextLookup = makeLookup({ id: "next-route", result: { ...successfulScan.result!, partName: "Starter motor" } });
    localStorage.setItem(accountStorageKey(LOOKUPS_STORAGE_KEY), JSON.stringify([failedLookup, nextLookup]));
    const original = getLookup(failedLookup.id);
    let finish!: (value: NonNullable<ScanAnalysisState["result"]>) => void;
    let fail!: (reason: Error) => void;
    const identify = vi.spyOn(aiService, "identifyCapturedFrame").mockImplementation(() => new Promise((resolve, reject) => { finish = resolve; fail = reject; }));
    render(
      <MemoryRouter initialEntries={["/result/failed-route"]}>
        <Link to="/result/next-route">Open another result</Link>
        <Routes><Route path="/result/:id" element={<Result />} /></Routes>
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(identify).toHaveBeenCalledTimes(1));
    await userEvent.click(screen.getByRole("link", { name: "Open another result" }));
    await act(async () => { if (outcome === "resolve") finish(successfulScan.result!); else fail(new Error("Offline")); });
    expect(getLookup(failedLookup.id)).toEqual(original);
    expect(screen.getByRole("heading", { level: 1, name: "Starter motor" })).toBeInTheDocument();
  });

  it("keeps saved-scan retry active through StrictMode effect replay", async () => {
    const failedLookup = makeLookup({ result: undefined, errorMessage: "Network error", errorCode: "network", analyzedAt: undefined });
    localStorage.setItem(accountStorageKey(LOOKUPS_STORAGE_KEY), JSON.stringify([failedLookup]));
    const identify = vi.spyOn(aiService, "identifyCapturedFrame").mockResolvedValue(successfulScan.result!);
    render(
      <StrictMode>
        <MemoryRouter initialEntries={[`/result/${failedLookup.id}`]}>
          <Routes><Route path="/result/:id" element={<Result />} /></Routes>
        </MemoryRouter>
      </StrictMode>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(identify).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("heading", { level: 1, name: "Alternator" })).toBeInTheDocument();
  });

  it("allows retrying a saved failed scan when online", async () => {
    const failedLookup = makeLookup({
      result: undefined,
      errorMessage: "Network error",
      errorCode: "network",
      analyzedAt: undefined,
    });
    localStorage.setItem(accountStorageKey(LOOKUPS_STORAGE_KEY), JSON.stringify([failedLookup]));

    const onlineSpy = vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    const identifySpy = vi.spyOn(aiService, "identifyCapturedFrame").mockResolvedValue(successfulScan.result!);

    renderResult(null, `/result/${failedLookup.id}`);

    expect(screen.getByText("Provider unavailable")).toBeInTheDocument();
    expect(screen.getByText("AI provider could not be reached")).toBeInTheDocument();
    expect(screen.getByText("Network error")).toBeInTheDocument();
    expect(screen.getByText(/Connection is active/)).toBeInTheDocument();

    const retryButton = screen.getByRole("button", { name: "Try again" });
    await userEvent.click(retryButton);

    expect(identifySpy).toHaveBeenCalledWith(failedLookup.frame, undefined, undefined, { vehicleContext: undefined });

    const savedLookups = JSON.parse(localStorage.getItem(accountStorageKey(LOOKUPS_STORAGE_KEY)) ?? "[]") as Lookup[];
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
    localStorage.setItem(accountStorageKey(LOOKUPS_STORAGE_KEY), JSON.stringify([failedLookup]));

    const onlineSpy = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);

    renderResult(null, `/result/${failedLookup.id}`);

    expect(screen.getByText(/Offline\. Reconnect to retry/)).toBeInTheDocument();
    const retryButton = screen.getByRole("button", { name: "Try again" });
    expect(retryButton).toBeDisabled();

    onlineSpy.mockRestore();
  });
});

function renderResult(state: (ScanAnalysisState & { savedLookup?: Lookup }) | null, path = "/result") {
  render(
    <MemoryRouter
      initialEntries={[
        {
          pathname: path,
          state: state ? withAccountRouteState(state) : null,
        },
      ]}
    >
      <Routes>
        <Route path="/result" element={<Result />} />
        <Route path="/result/:id" element={<Result />} />
        <Route path="/result/:id/chat" element={<Chat />} />
        <Route path="/history" element={<p>Saved scans page</p>} />
      </Routes>
    </MemoryRouter>,
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
    provenance: {
      analysisSource: "ai_detection",
      captureMode: "camera",
      savedAt: "2026-05-16T00:00:05.000Z",
    },
    ...patch,
  };
}
