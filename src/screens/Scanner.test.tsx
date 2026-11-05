import { accountStorageKey, setActiveAccount, type AccountScope } from "../lib/accountScope";
import { createLookup, getLookups, LOOKUPS_STORAGE_KEY, MAX_SAVED_LOOKUPS } from "../services/storage";
import { hashImageDataUrl, setCachedScanResult } from "../lib/scanCache";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, expect, vi } from "vitest";
import Scanner from "./Scanner";
import type { ScanPhoto } from "../types";

const createRealElement = document.createElement.bind(document);
const captureFrame = vi.fn(async () => "data:image/jpeg;base64,compressed-frame");
const retryCamera = vi.fn();
const switchCamera = vi.fn();
const assessImageQuality = vi.fn(async () => ({ ok: true }));
const passingQuality = {
  metrics: {
    averageLuminance: 126,
    brightPixelRatio: 0.01,
    brightnessScore: 98,
    darkPixelRatio: 0,
    glareScore: 95,
    gradientVariance: 240,
    sampleHeight: 72,
    sampleWidth: 96,
    sharpnessScore: 100,
  },
  ok: true,
};
const createFocusedScanCrop = vi.fn(async () => "data:image/jpeg;base64,target-crop");
const createSegmentedProductIsolation = vi.fn(async () => null);
const createPromptedProductIsolation = vi.fn(async () => null);
const supportsWebGpu = vi.fn(async () => false);
const isPromptableSegmentationEnabled = vi.fn(() => false);
const isolateSceneObjects = vi.fn(async () => []);
const detectObjectTargetFromImageData = vi.fn(() => null);
const getCloudSyncStatus = vi.fn(() => ({ configured: false, message: "Cloud sync is off." }));
const syncLookupToCloud = vi.fn(async () => ({ ok: true, message: "Scan synced." }));
const readPhotoDraft = vi.fn<(scope?: AccountScope, kind?: "upload" | "capture") => Promise<ScanPhoto[] | null>>();
// Write observers used by the in-memory transactional mock below.
const savePhotoDraft = vi.fn<(photos: ScanPhoto[], scope?: AccountScope, kind?: "upload" | "capture") => Promise<void>>();
const removePhotoDraft = vi.fn<(scope?: AccountScope, kind?: "upload" | "capture") => Promise<void>>();
const replacePhotoDraftIfMatches = vi.fn<(previous: ScanPhoto[] | null, next: ScanPhoto[] | null, scope?: AccountScope, kind?: "upload" | "capture") => Promise<boolean>>();
const savePhotoDraftIfEmpty = vi.fn<(photos: ScanPhoto[], scope?: AccountScope, kind?: "upload" | "capture") => Promise<boolean>>();
const removePhotoDraftIfMatches = vi.fn<(photos: ScanPhoto[], scope?: AccountScope, kind?: "upload" | "capture") => Promise<boolean>>();
const draftStore = new Map<string, ScanPhoto[]>();
const draftKey = (scope?: AccountScope, kind: "upload" | "capture" = "upload") => `${scope?.userId ?? "test-user"}:${kind}`;
const identifyCapturedFrame = vi.fn(async () => ({
  partName: "Alternator",
  confidence: "high",
  scanCategory: "electrical",
  candidateMatches: [
    {
      partName: "Starter motor",
      confidence: "low",
      scanCategory: "electrical",
      reason: "Engine bay electrical component, but the pulley favors alternator.",
    },
  ],
  whatItDoes: "It charges the battery while the engine runs.",
  visibleObservations: ["Belt-driven metal housing is visible."],
  evidenceRegions: [
    {
      label: "Pulley",
      observation: "Belt-driven pulley is visible.",
      regionLabel: "Scanned area",
    },
  ],
  concerns: [],
  safetyTriage: "can_help",
  isSafetyCritical: false,
  nextAction: "Compare the scan with another angle if you need more detail.",
  needsBetterPhoto: false,
  evidence: ["The pulley and housing match common alternator shapes."],
  sourceLinks: [
    {
      label: "Search this part",
      url: "https://www.google.com/search?q=Alternator%20car%20part",
      sourceType: "search",
    },
  ],
}));
const objectTargetState = vi.hoisted(() => ({
  current: null as null | {
    confidence: number;
    height: number;
    holdProgress: number;
    id: string;
    isLocked: boolean;
    left: number;
    normalized?: {
      height: number;
      width: number;
      x: number;
      y: number;
    };
    top: number;
    width: number;
  },
}));
const objectTargetOptions = vi.hoisted(() => ({
  latest: null as null | { enabled: boolean; holdDurationMs?: number; holdEnabled: boolean },
}));
const cameraHookState = vi.hoisted(() => ({
  current: {
    cameraError: null as string | null,
    cameraRequestId: 0,
    cameraState: "ready" as "loading" | "ready" | "blocked",
  },
}));

vi.mock("../hooks/useCamera", () => ({
  useCamera: () => ({
    cameraDevices: [],
    cameraFacingMode: "environment",
    cameraRequestId: cameraHookState.current.cameraRequestId,
    cameraError: cameraHookState.current.cameraError,
    cameraState: cameraHookState.current.cameraState,
    captureFrame,
    markError: vi.fn(),
    markReady: vi.fn(),
    retryCamera,
    selectCamera: vi.fn(),
    switchCamera,
    selectedCameraId: "",
    webcamRef: { current: null },
  }),
}));

vi.mock("../hooks/useStillness", () => ({
  useStillness: () => ({
    error: null,
    isStable: true,
    needsPermission: false,
    permissionState: "unsupported",
    requestPermission: vi.fn(),
    usesFallback: true,
  }),
}));

vi.mock("../hooks/useObjectTarget", () => ({
  useObjectTarget: (_webcamRef: unknown, options: { enabled: boolean; holdDurationMs?: number; holdEnabled: boolean }) => {
    objectTargetOptions.latest = options;
    return objectTargetState.current;
  },
}));

vi.mock("react-webcam", () => ({
  default: () => <div data-testid="webcam-preview" />,
}));

vi.mock("../services/aiService", () => ({
  AIServiceError: class AIServiceError extends Error {
    code: string;

    constructor(code: string, message: string) {
      super(message);
      this.name = "AIServiceError";
      this.code = code;
    }
  },
  getAIErrorMessage: (error: unknown) => (error instanceof Error ? error.message : "AI failed"),
  identifyCapturedFrame: (...args: unknown[]) => identifyCapturedFrame(...args),
  isAIRequestCanceled: (error: unknown) => error instanceof DOMException && error.name === "AbortError",
}));

vi.mock("../services/cloudSync", () => ({
  getCloudSyncStatus: () => getCloudSyncStatus(),
  syncLookupToCloud: (...args: unknown[]) => syncLookupToCloud(...args),
}));

vi.mock("../services/photoDraft", () => ({
  photoGroupsMatch: (left: ScanPhoto[], right: ScanPhoto[]) => JSON.stringify(left) === JSON.stringify(right),
  readPhotoDraft: (scope?: AccountScope, kind?: "upload" | "capture") => readPhotoDraft(scope, kind),
  replacePhotoDraftIfMatches: (previous: ScanPhoto[] | null, next: ScanPhoto[] | null, scope?: AccountScope, kind?: "upload" | "capture") => replacePhotoDraftIfMatches(previous, next, scope, kind),
  savePhotoDraftIfEmpty: (photos: ScanPhoto[], scope?: AccountScope, kind?: "upload" | "capture") => savePhotoDraftIfEmpty(photos, scope, kind),
  removePhotoDraftIfMatches: (photos: ScanPhoto[], scope?: AccountScope, kind?: "upload" | "capture") => removePhotoDraftIfMatches(photos, scope, kind),
}));

// Pass all images as ok - quality logic is tested separately in imageQuality.test.ts
vi.mock("../lib/imageQuality", () => ({
  assessImageQuality: (...args: unknown[]) => assessImageQuality(...args),
}));

vi.mock("../lib/focusCrop", () => ({
  createFocusedScanCrop: (...args: unknown[]) => createFocusedScanCrop(...args),
}));

vi.mock("../lib/productSegmentation", () => ({
  createSegmentedProductIsolation: (...args: unknown[]) => createSegmentedProductIsolation(...args),
  warmProductSegmentation: () => {},
}));

vi.mock("../lib/promptableSegmentation", () => ({
  createPromptedProductIsolation: (...args: unknown[]) => createPromptedProductIsolation(...args),
  isolateSceneObjects: (...args: unknown[]) => isolateSceneObjects(...args),
  isPromptableSegmentationEnabled: () => isPromptableSegmentationEnabled(),
  warmPromptableSegmentation: () => {},
}));

vi.mock("../lib/webgpu", () => ({ supportsWebGpu: () => supportsWebGpu() }));

vi.mock("../lib/objectTargeting", () => ({
  detectObjectTargetFromImageData: (...args: unknown[]) => detectObjectTargetFromImageData(...args),
}));

// Cache always misses in scanner tests - cache logic tested in scanCache.test.ts
vi.mock("../lib/scanCache", () => ({
  hashImageDataUrl: vi.fn(async () => null),
  getCachedScanResult: vi.fn(() => null),
  setCachedScanResult: vi.fn(),
}));

function AuthReturnProbe() {
  const state = useLocation().state as { from?: string } | null;
  return <p>Auth return: {state?.from ?? "missing"}</p>;
}

async function analyzeReviewedPhotos() {
  const button = await screen.findByRole("button", { name: /^Analyze [1-4] photos?$/ });
  await waitFor(() => expect(button).toBeEnabled());
  await userEvent.click(button);
}

describe("Scanner", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    window.history.pushState({}, "", "/");
  });

  beforeEach(() => {
    draftStore.clear();
    readPhotoDraft.mockReset();
    readPhotoDraft.mockImplementation(async (scope, kind) => structuredClone(draftStore.get(draftKey(scope, kind)) ?? null));
    savePhotoDraft.mockReset();
    savePhotoDraft.mockImplementation(async (photos, scope, kind) => { draftStore.set(draftKey(scope, kind), structuredClone(photos)); });
    removePhotoDraft.mockReset();
    removePhotoDraft.mockImplementation(async (scope, kind) => { draftStore.delete(draftKey(scope, kind)); });
    replacePhotoDraftIfMatches.mockReset();
    replacePhotoDraftIfMatches.mockImplementation(async (previous, next, scope, kind) => {
      const current = draftStore.get(draftKey(scope, kind)) ?? null;
      if (JSON.stringify(current) !== JSON.stringify(previous)) return false;
      if (next === null) await removePhotoDraft(scope, kind);
      else if (JSON.stringify(previous) !== JSON.stringify(next)) await savePhotoDraft(next, scope, kind);
      return true;
    });
    savePhotoDraftIfEmpty.mockReset();
    savePhotoDraftIfEmpty.mockImplementation(async (photos, scope, kind) => {
      const key = draftKey(scope, kind);
      if (draftStore.has(key)) return false;
      draftStore.set(key, structuredClone(photos));
      return true;
    });
    removePhotoDraftIfMatches.mockReset();
    removePhotoDraftIfMatches.mockImplementation(async (photos, scope, kind) => {
      const key = draftKey(scope, kind);
      if (JSON.stringify(draftStore.get(key)) !== JSON.stringify(photos)) return false;
      draftStore.delete(key);
      return true;
    });
    captureFrame.mockReset();
    captureFrame.mockResolvedValue("data:image/jpeg;base64,compressed-frame");
    retryCamera.mockClear();
    switchCamera.mockClear();
    assessImageQuality.mockReset();
    assessImageQuality.mockResolvedValue(passingQuality);
    createFocusedScanCrop.mockReset();
    createFocusedScanCrop.mockResolvedValue("data:image/jpeg;base64,target-crop");
    createSegmentedProductIsolation.mockReset();
    createSegmentedProductIsolation.mockResolvedValue(null);
    createPromptedProductIsolation.mockReset();
    createPromptedProductIsolation.mockResolvedValue(null);
    supportsWebGpu.mockReset();
    supportsWebGpu.mockResolvedValue(false);
    isPromptableSegmentationEnabled.mockReturnValue(false);
    isolateSceneObjects.mockReset();
    isolateSceneObjects.mockResolvedValue([]);
    detectObjectTargetFromImageData.mockReset();
    detectObjectTargetFromImageData.mockReturnValue(null);
    getCloudSyncStatus.mockReset();
    getCloudSyncStatus.mockReturnValue({ configured: false, message: "Cloud sync is off." });
    syncLookupToCloud.mockReset();
    syncLookupToCloud.mockResolvedValue({ ok: true, message: "Scan synced." });
    identifyCapturedFrame.mockReset();
    identifyCapturedFrame.mockResolvedValue(makeScanResult("Alternator"));
    cameraHookState.current = {
      cameraError: null,
      cameraRequestId: 0,
      cameraState: "ready",
    };
    objectTargetState.current = null;
    objectTargetOptions.latest = null;
    localStorage.clear();
    sessionStorage.clear();
  });

  it("scans on shutter press, identifies, saves it, and opens an in-place review", async () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<Scanner />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByTestId("webcam-preview")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Scan now" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Scan now" }));
    await waitFor(() => expect(identifyCapturedFrame).toHaveBeenCalledTimes(1));
    const reviewHeading = await screen.findByRole("heading", { level: 3, name: "Alternator" });
    const reviewCard = reviewHeading.closest("section");
    expect(reviewCard).toBeTruthy();
    expect(screen.queryByTestId("lens-primary-label")).not.toBeInTheDocument();
    expect(screen.getByTestId("focused-part-overlay")).toHaveAttribute("data-focus-mode", "full_frame");
    expect(screen.queryByText("More evidence")).not.toBeInTheDocument();
    expect(screen.queryByText("Capture another angle")).not.toBeInTheDocument();
    expect(screen.queryByText(/Likely/)).not.toBeInTheDocument();
    expect(screen.queryByText("Verify")).not.toBeInTheDocument();
    expect(within(reviewCard as HTMLElement).getByText("It charges the battery while the engine runs.")).toBeInTheDocument();
    expect(within(reviewCard as HTMLElement).queryByText("AI detection")).not.toBeInTheDocument();
    expect(within(reviewCard as HTMLElement).queryByRole("button", { name: "Open details" })).not.toBeInTheDocument();
    const savedLookups = JSON.parse(localStorage.getItem(accountStorageKey("deep-spec:lookups")) ?? "[]");
    expect(savedLookups).toHaveLength(1);
    expect(savedLookups[0]).toMatchObject({
      provenance: {
        analysisSource: "ai_detection",
        captureMode: "camera",
      },
      scanQuality: {
        accepted: true,
        brightnessScore: 98,
        firstPass: true,
        motionFallback: true,
        motionStable: true,
        sharpnessScore: 100,
      },
      scanCategory: "electrical",
      trainingLabel: "Alternator",
      trainingStatus: "raw_unreviewed",
    });
  }, 20000);

  it.each(["SAM", "MVANet", "scene", "debug GPU"])("shows and saves a valid result when optional %s never settles, ignoring its late result", async (stage) => {
    mockStillImageTarget({ confidence: 0.9, x: 0.2, y: 0.2, width: 0.3, height: 0.3 });
    const focusBox = { x: 0.2, y: 0.2, width: 0.3, height: 0.3 };
    const cutout = { focusBox, frame: { imageBase64: "data:image/png;base64,isolated", capturedAt: new Date().toISOString() }, isolatedImageBase64: "data:image/png;base64,isolated" };
    let settle!: (value: unknown) => void;
    const pending = new Promise((resolve) => { settle = resolve; });
    if (stage === "SAM") createPromptedProductIsolation.mockReturnValue(pending);
    if (stage === "MVANet") createSegmentedProductIsolation.mockReturnValue(pending);
    if (stage === "scene") {
      createSegmentedProductIsolation.mockResolvedValue(cutout);
      isPromptableSegmentationEnabled.mockReturnValue(true);
      isolateSceneObjects.mockReturnValue(pending);
      identifyCapturedFrame.mockResolvedValue({ ...makeScanResult("Alternator"), sceneObjects: [{ name: "Wrench", category: "tools", regionLabel: "right", confidence: "high" }] });
    }
    if (stage === "debug GPU") {
      vi.stubEnv("VITE_DEEPSPEC_DEBUG", "true");
      supportsWebGpu.mockReturnValue(pending);
    }
    render(<MemoryRouter><Scanner /></MemoryRouter>);
    await userEvent.click(screen.getByRole("button", { name: "Scan now" }));
    await screen.findByRole("button", { name: "Close result card" }, { timeout: 6000 });
    expect(getLookups()).toHaveLength(1);
    expect(getLookups()[0].result?.partName).toBe("Alternator");
    expect(identifyCapturedFrame).toHaveBeenCalledTimes(1);
    const snapshot = JSON.stringify(getLookups());
    await act(async () => { settle(stage === "debug GPU" ? true : stage === "scene" ? [{ ...cutout, name: "Late object" }] : cutout); await pending; });
    expect(JSON.stringify(getLookups())).toBe(snapshot);
    expect(screen.queryByRole("button", { name: "Select Late object" })).not.toBeInTheDocument();
    vi.unstubAllEnvs();
  }, 10000);

  it.each(["success", "failure"])("ignores a previous scan's late object-analysis %s", async (outcome) => {
    mockStillImageTarget({ confidence: 0.9, x: 0.2, y: 0.2, width: 0.3, height: 0.3 });
    const focusBox = { x: 0.2, y: 0.2, width: 0.3, height: 0.3, confidence: 0.9 };
    createSegmentedProductIsolation.mockResolvedValue({
      focusBox,
      frame: { imageBase64: "data:image/png;base64,isolated", capturedAt: new Date().toISOString() },
      isolatedImageBase64: "data:image/png;base64,isolated",
    });
    isPromptableSegmentationEnabled.mockReturnValue(true);
    isolateSceneObjects.mockResolvedValue([
      { name: "Alternator", category: "electrical", focusBox, isolatedImageBase64: "data:image/png;base64,primary", primary: true },
      { name: "Wrench", category: "tools", focusBox, isolatedImageBase64: "data:image/png;base64,secondary", primary: false },
    ]);
    const sceneResult = { ...makeScanResult("Alternator"), sceneObjects: [
      { name: "Wrench", category: "tools", regionLabel: "right", confidence: "high" },
    ] };
    let resolveOld!: (result: ReturnType<typeof makeScanResult>) => void;
    let rejectOld!: (error: Error) => void;
    const oldResponse = new Promise<ReturnType<typeof makeScanResult>>((resolve, reject) => {
      resolveOld = resolve;
      rejectOld = reject;
    });
    identifyCapturedFrame
      .mockResolvedValueOnce(sceneResult)
      .mockReturnValueOnce(oldResponse)
      .mockResolvedValueOnce(sceneResult)
      .mockResolvedValueOnce(makeScanResult("Socket wrench"));
    render(<MemoryRouter><Scanner /></MemoryRouter>);

    await userEvent.click(screen.getByRole("button", { name: "Scan now" }));
    await userEvent.click(await screen.findByRole("button", { name: "Select Wrench" }));
    expect(screen.getByTestId("focused-object-card")).toHaveTextContent("Analyzing");
    expect(getLookups()).toHaveLength(1);
    expect(getLookups()[0].isolatedObjects).toHaveLength(2);
    await waitFor(() => expect(draftStore.has("test-user:capture")).toBe(false));
    await userEvent.click(screen.getByTestId("focused-object-back"));
    await userEvent.click(screen.getByRole("button", { name: "Close result card" }));
    // This exercises a new scan, rather than replaying the first photo's cached result.
    captureFrame.mockResolvedValue(`data:image/jpeg;base64,${"b".repeat(240)}`);
    await userEvent.click(screen.getByRole("button", { name: "Scan now" }));
    await userEvent.click(await screen.findByRole("button", { name: "Select Wrench" }));
    await waitFor(() => expect(screen.getByTestId("focused-object-card")).toHaveTextContent("Socket wrench"));

    await act(async () => {
      if (outcome === "success") resolveOld(makeScanResult("Old scan part"));
      else rejectOld(new Error("Old scan failed"));
      await oldResponse.catch(() => undefined);
    });
    expect(screen.getByTestId("focused-object-card")).toHaveTextContent("Socket wrench");
    expect(screen.getByTestId("focused-object-card")).not.toHaveTextContent("Old scan");
    expect(identifyCapturedFrame).toHaveBeenCalledTimes(4);
  }, 20000);

  it.each(["available", "unavailable", "account changed"])("uses original evidence for a corrected object when its crop is %s", async (outcome) => {
    const originalImage = mockStillImageTarget({ confidence: 0.9, x: 0.2, y: 0.2, width: 0.3, height: 0.3 });
    const focusBox = { x: 0.2, y: 0.2, width: 0.3, height: 0.3, confidence: 0.9 };
    const correctedBox = { x: 0.5, y: 0.1, width: 0.25, height: 0.4, confidence: 0 };
    createSegmentedProductIsolation.mockResolvedValue({
      focusBox,
      frame: { imageBase64: "data:image/png;base64,isolated", capturedAt: new Date().toISOString() },
      isolatedImageBase64: "data:image/png;base64,isolated",
    });
    isPromptableSegmentationEnabled.mockReturnValue(true);
    isolateSceneObjects.mockResolvedValue([
      { name: "Alternator", category: "electrical", focusBox, isolatedImageBase64: "data:image/png;base64,primary", primary: true },
      { name: "Wrench", category: "tools", focusBox: correctedBox, isolatedImageBase64: "", focusMode: "crop", correctedAt: "2026-11-05T00:00:00Z", primary: false },
    ]);
    identifyCapturedFrame.mockResolvedValueOnce({ ...makeScanResult("Alternator"), sceneObjects: [
      { name: "Wrench", category: "tools", regionLabel: "right", confidence: "high" },
    ] }).mockResolvedValueOnce(makeScanResult("Socket wrench"));
    render(<MemoryRouter><Scanner /></MemoryRouter>);
    await userEvent.click(screen.getByRole("button", { name: "Scan now" }));
    await screen.findByRole("button", { name: "Select Wrench" });
    createFocusedScanCrop.mockClear();
    let finishCrop!: (image: string | null) => void;
    createFocusedScanCrop.mockImplementationOnce(() => new Promise((resolve) => { finishCrop = resolve; }));
    await userEvent.click(screen.getByRole("button", { name: "Select Wrench" }));
    expect(createFocusedScanCrop).toHaveBeenCalledExactlyOnceWith(originalImage, correctedBox);
    expect(identifyCapturedFrame).toHaveBeenCalledTimes(1);
    await act(async () => {
      if (outcome === "account changed") setActiveAccount("other-user");
      finishCrop(outcome === "unavailable" ? null : "data:image/jpeg;base64,corrected-crop");
    });
    if (outcome === "available") {
      await waitFor(() => expect(identifyCapturedFrame).toHaveBeenCalledTimes(2));
      expect(identifyCapturedFrame.mock.calls[1][0]).toMatchObject({ imageBase64: "data:image/jpeg;base64,corrected-crop" });
      expect(await screen.findByText("Socket wrench")).toBeInTheDocument();
    } else {
      expect(identifyCapturedFrame).toHaveBeenCalledTimes(1);
      if (outcome === "unavailable") expect(screen.getByTestId("focused-object-card")).toHaveTextContent("This selected area is unavailable");
    }
  });

  it("invalidates an old object analysis when its selected outline is corrected", async () => {
    const originalImage = mockStillImageTarget({ confidence: 0.9, x: 0.2, y: 0.2, width: 0.3, height: 0.3 });
    const focusBox = { x: 0.2, y: 0.2, width: 0.3, height: 0.3, confidence: 0.9 };
    createSegmentedProductIsolation.mockResolvedValue({ focusBox, frame: { imageBase64: "data:image/png;base64,isolated", capturedAt: new Date().toISOString() }, isolatedImageBase64: "data:image/png;base64,isolated" });
    isPromptableSegmentationEnabled.mockReturnValue(true);
    isolateSceneObjects.mockResolvedValue([
      { name: "Alternator", category: "electrical", focusBox, isolatedImageBase64: "data:image/png;base64,primary", primary: true },
      { name: "Wrench", category: "tools", focusBox, isolatedImageBase64: "data:image/png;base64,secondary", primary: false },
    ]);
    let finishOld!: (result: ReturnType<typeof makeScanResult>) => void;
    identifyCapturedFrame.mockResolvedValueOnce({ ...makeScanResult("Alternator"), sceneObjects: [{ name: "Wrench", category: "tools", regionLabel: "right", confidence: "high" }] })
      .mockImplementationOnce(() => new Promise((resolve) => { finishOld = resolve; }))
      .mockResolvedValueOnce(makeScanResult("Corrected wrench"));
    render(<MemoryRouter><Scanner /></MemoryRouter>);
    await userEvent.click(screen.getByRole("button", { name: "Scan now" }));
    await userEvent.click(await screen.findByRole("button", { name: "Select Wrench" }));
    await userEvent.click(screen.getByRole("button", { name: "Correct area" }));
    fireEvent.change(screen.getByRole("slider", { name: "Selection x" }), { target: { value: "40" } });
    await userEvent.click(screen.getByRole("button", { name: "Apply area" }));
    await act(async () => finishOld(makeScanResult("Stale selection")));
    expect(screen.getByTestId("focused-object-card")).not.toHaveTextContent("Stale selection");
    createFocusedScanCrop.mockClear();
    await userEvent.click(screen.getByTestId("focused-object-back"));
    await userEvent.click(screen.getByRole("button", { name: "Select Wrench" }));
    await waitFor(() => expect(identifyCapturedFrame).toHaveBeenCalledTimes(3));
    expect(createFocusedScanCrop).toHaveBeenCalledWith(originalImage, { ...focusBox, x: 0.4, confidence: 0 });
    expect(identifyCapturedFrame.mock.calls[2][0]).toMatchObject({ imageBase64: "data:image/jpeg;base64,target-crop" });
  });

  it("opens a simple captured-item review when AI analysis fails", async () => {
    identifyCapturedFrame.mockRejectedValueOnce(new Error("Provider jammed"));

    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<Scanner />} />
        </Routes>
      </MemoryRouter>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Scan now" }));

    expect(await screen.findByRole("heading", { level: 3, name: "Item captured" })).toBeInTheDocument();
    expect(screen.getByTestId("scan-workspace-photo")).toContainElement(screen.getByTestId("focused-part-overlay"));
    expect(screen.getByText("Saved photo")).toBeInTheDocument();
    expect(screen.getByText("The photo is saved. Try again.")).toBeInTheDocument();
    expect(screen.queryByText("Reading photo")).not.toBeInTheDocument();
    expect(screen.queryByText("Provider jammed")).not.toBeInTheDocument();
  }, 10000);

  it("isolates the identified product from the captured still after manual scan", async () => {
    mockStillImageTarget({
      confidence: 0.82,
      height: 0.3,
      width: 0.24,
      x: 0.08,
      y: 0.2666666667,
    });

    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<Scanner />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.queryByTestId("object-reticle")).not.toBeInTheDocument();
    expect(screen.queryByText("Tap part")).not.toBeInTheDocument();
    expect(captureFrame).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Scan now" }));

    await waitFor(() => expect(identifyCapturedFrame).toHaveBeenCalledTimes(1));
    expect(detectObjectTargetFromImageData).toHaveBeenCalled();
    expect(screen.queryByTestId("product-isolation-mask")).not.toBeInTheDocument();
    expect(screen.getByTestId("focused-part-overlay")).toHaveAttribute("data-focus-mode", "crop");
    expect(screen.getByTestId("focused-part-label")).toHaveTextContent("Alternator");
    expect(screen.getByTestId("scan-workspace-photo")).toContainElement(screen.getByTestId("focused-part-window"));
    expect(screen.getByTestId("focused-part-label")).toHaveTextContent("Focused");
    const focusedWindow = screen.getByTestId("focused-part-window");
    expect(focusedWindow.style.width).toMatch(/%$/);
    expect(focusedWindow.style.height).toMatch(/%$/);
  }, 10000);

  it("uses the segmentation model output for the scan-card visual without changing the AI crop", async () => {
    mockStillImageTarget({
      confidence: 0.82,
      height: 0.3,
      width: 0.24,
      x: 0.08,
      y: 0.2666666667,
    });
    createSegmentedProductIsolation.mockResolvedValueOnce({
      focusBox: { confidence: 0.9, height: 0.7, width: 0.62, x: 0.18, y: 0.14 },
      frame: {
        capturedAt: "2026-06-23T00:00:00.000Z",
        imageBase64: "data:image/png;base64,segmented-product",
      },
      isolatedImageBase64: "data:image/png;base64,segmented-product",
    });

    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<Scanner />} />
        </Routes>
      </MemoryRouter>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Scan now" }));

    await waitFor(() => expect(identifyCapturedFrame).toHaveBeenCalledTimes(1));
    expect(createSegmentedProductIsolation).toHaveBeenCalledWith(expect.objectContaining({
      imageBase64: "data:image/jpeg;base64,target-crop",
    }));
    expect(identifyCapturedFrame.mock.calls[0][1]).toMatchObject({
      imageBase64: "data:image/jpeg;base64,target-crop",
    });
    expect(screen.getByTestId("focused-part-overlay")).toHaveAttribute("data-focus-mode", "mask");
    expect(screen.getByTestId("focused-part-label")).toHaveTextContent("Isolated");
    expect(screen.getByTestId("scan-workspace-photo")).toContainElement(screen.getByTestId("isolated-part-image"));
    expect(screen.getByTestId("isolated-part-image")).toHaveAttribute("src", "data:image/png;base64,segmented-product");
    const savedLookups = JSON.parse(localStorage.getItem(accountStorageKey("deep-spec:lookups")) ?? "[]");
    expect(savedLookups[0]).toMatchObject({
      focusMode: "mask",
      isolatedImageBase64: "data:image/png;base64,segmented-product",
    });
  }, 10000);

  it("shows the default focused overlay for body-part results", async () => {
    mockStillImageTarget({
      confidence: 0.82,
      height: 0.5666666667,
      width: 0.34,
      x: 0.024,
      y: 0.2,
    });
    identifyCapturedFrame.mockResolvedValueOnce({
      ...makeScanResult("front bumper"),
      scanCategory: "body",
      whatItDoes: "The front bumper is the front impact cover.",
    });

    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<Scanner />} />
        </Routes>
      </MemoryRouter>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Scan now" }));
    await waitFor(() => expect(captureFrame).toHaveBeenCalled());
    await waitFor(() => expect(identifyCapturedFrame).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId("lens-context-overlay")).not.toBeInTheDocument();
    expect(screen.getByTestId("focused-part-label")).toHaveTextContent("front bumper");
    expect(screen.getByTestId("focused-part-window")).toBeInTheDocument();
  }, 10000);

  it("uses the same focused overlay for brake assemblies", async () => {
    mockStillImageTarget({
      confidence: 0.84,
      height: 0.5083333333,
      width: 0.409,
      x: 0.003,
      y: 0.3383333333,
    });
    identifyCapturedFrame.mockResolvedValueOnce({
      ...makeScanResult("Brake Disc and Caliper Assembly"),
      scanCategory: "brakes",
      whatItDoes: "The brake disc works with the caliper and pads to stop the vehicle.",
    });

    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<Scanner />} />
        </Routes>
      </MemoryRouter>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Scan now" }));
    await waitFor(() => expect(captureFrame).toHaveBeenCalled());
    await waitFor(() => expect(identifyCapturedFrame).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId("lens-context-overlay")).not.toBeInTheDocument();
    expect(screen.getByTestId("focused-part-label")).toHaveTextContent("Brake Disc and Caliper Assembly");
    expect(screen.getByTestId("focused-part-window")).toBeInTheDocument();
  }, 10000);

  it("uses focused overlays for engine assembly and radiator results", async () => {
    mockStillImageTarget({
      confidence: 0.86,
      height: 0.6,
      width: 0.36,
      x: 0.02,
      y: 0.2333333333,
    });
    identifyCapturedFrame.mockResolvedValueOnce({
      ...makeScanResult("Engine"),
      scanCategory: "engine",
      whatItDoes: "The engine assembly is the main power unit.",
    });

    const { unmount } = render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<Scanner />} />
        </Routes>
      </MemoryRouter>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Scan now" }));
    await waitFor(() => expect(identifyCapturedFrame).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId("lens-context-overlay")).not.toBeInTheDocument();
    expect(screen.getByTestId("focused-part-label")).toHaveTextContent("Engine");
    expect(screen.getByTestId("focused-part-window")).toBeInTheDocument();

    unmount();
    identifyCapturedFrame.mockClear();
    mockStillImageTarget({
      confidence: 0.86,
      height: 0.5,
      width: 0.34,
      x: 0.04,
      y: 0.3,
    });
    identifyCapturedFrame.mockResolvedValueOnce({
      ...makeScanResult("Radiator"),
      scanCategory: "engine",
      whatItDoes: "The radiator removes heat from engine coolant.",
    });

    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<Scanner />} />
        </Routes>
      </MemoryRouter>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Scan now" }));
    await waitFor(() => expect(identifyCapturedFrame).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId("lens-context-overlay")).not.toBeInTheDocument();
    expect(screen.getByTestId("focused-part-label")).toHaveTextContent("Radiator");
    expect(screen.getByTestId("focused-part-window")).toBeInTheDocument();
  }, 10000);

  it("does not turn text-only evidence regions into fake AR boxes", async () => {
    mockStillImageTarget({
      confidence: 0.82,
      height: 0.3,
      width: 0.24,
      x: 0.08,
      y: 0.2666666667,
    });
    identifyCapturedFrame.mockResolvedValueOnce({
      ...makeScanResult("Alternator"),
      evidenceRegions: [
        {
          label: "Pulley",
          observation: "Belt pulley visible near the front.",
          regionLabel: "upper left",
        },
      ],
    });

    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<Scanner />} />
        </Routes>
      </MemoryRouter>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Scan now" }));
    await waitFor(() => expect(identifyCapturedFrame).toHaveBeenCalledTimes(1));

    expect(screen.getByTestId("focused-part-window")).toBeInTheDocument();
    expect(screen.queryByTestId("lens-evidence-chip")).not.toBeInTheDocument();
    expect(screen.queryByText(/Pulley: Belt pulley visible/)).not.toBeInTheDocument();
  }, 10000);

  it("sends a focused target crop as the AI image when the captured still isolates a product", async () => {
    mockStillImageTarget({
      confidence: 0.72,
      height: 0.18,
      width: 0.24,
      x: 0.18,
      y: 0.28,
    });

    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<Scanner />} />
        </Routes>
      </MemoryRouter>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Scan now" }));

    await waitFor(() => expect(identifyCapturedFrame).toHaveBeenCalledTimes(1));
    expect(createFocusedScanCrop).toHaveBeenCalledWith(expect.stringMatching(/^data:image\/jpeg;base64,/), expect.objectContaining({
      height: 0.18,
      width: 0.24,
      x: 0.18,
      y: 0.28,
    }));
    expect(identifyCapturedFrame.mock.calls[0][0]).toMatchObject({
      imageBase64: expect.stringMatching(/^data:image\/jpeg;base64,/),
    });
    expect(identifyCapturedFrame.mock.calls[0][1]).toMatchObject({
      imageBase64: "data:image/jpeg;base64,target-crop",
    });
  }, 10000);

  it("does not render the old live auto-scan reticle or auto-capture", () => {
    objectTargetState.current = makeObjectTarget({
      holdProgress: 0,
      isLocked: false,
    });

    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<Scanner />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.queryByTestId("object-reticle")).not.toBeInTheDocument();
    expect(screen.queryByText(/Hold still/)).not.toBeInTheDocument();
    expect(objectTargetOptions.latest).toBeNull();
    expect(captureFrame).not.toHaveBeenCalled();
    expect(identifyCapturedFrame).not.toHaveBeenCalled();
  });

  it("analyzes the photo even when still-image isolation is too small to trust", async () => {
    mockStillImageTarget({
      confidence: 0.72,
      height: 0.03,
      width: 0.03,
      x: 0.42,
      y: 0.32,
    });

    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<Scanner />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByRole("button", { name: "Scan now" })).toBeEnabled();
    await userEvent.click(screen.getByRole("button", { name: "Scan now" }));

    await waitFor(() => expect(identifyCapturedFrame).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole("heading", { level: 3, name: "Alternator" })).toBeInTheDocument();
    expect(screen.getByTestId("focused-part-overlay")).toHaveAttribute("data-focus-mode", "full_frame");
    expect(screen.getByTestId("focused-part-window")).toBeInTheDocument();
  }, 10000);

  it("does not wait for a prominent live target before a manual scan", async () => {
    objectTargetState.current = makeObjectTarget({
      height: 150,
      holdProgress: 1,
      id: "target-small-auto",
      isLocked: true,
      width: 140,
    });

    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<Scanner />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.queryByText("Center part")).not.toBeInTheDocument();
    expect(captureFrame).not.toHaveBeenCalled();
    expect(identifyCapturedFrame).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Scan now" }));

    await waitFor(() => expect(identifyCapturedFrame).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole("heading", { level: 3, name: "Alternator" })).toBeInTheDocument();
  }, 10000);

  it("syncs a new saved scan to the cloud dataset when Supabase is configured", async () => {
    getCloudSyncStatus.mockReturnValue({ configured: true, message: "Cloud sync is configured." });

    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<Scanner />} />
        </Routes>
      </MemoryRouter>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Scan now" }));
    await screen.findByRole("heading", { level: 3, name: "Alternator" });

    await waitFor(() => {
      expect(syncLookupToCloud).toHaveBeenCalledWith(expect.objectContaining({
        scanQuality: expect.objectContaining({
          accepted: true,
          brightnessScore: 98,
          sharpnessScore: 100,
        }),
        scanCategory: "electrical",
        trainingLabel: "Alternator",
      }));
    });
  }, 10000);

  it("shows cloud failure and lets the user retry without analyzing again", async () => {
    getCloudSyncStatus.mockReturnValue({ configured: true, message: "Configured" });
    syncLookupToCloud.mockResolvedValueOnce({ ok: false, message: "Network unavailable" });
    render(<MemoryRouter><Scanner /></MemoryRouter>);
    await userEvent.click(screen.getByRole("button", { name: "Scan now" }));
    expect(await screen.findByTestId("scan-save-status")).toHaveTextContent("Cloud sync failed");
    const calls = identifyCapturedFrame.mock.calls.length;
    await userEvent.click(screen.getByRole("button", { name: "Retry cloud save" }));
    await waitFor(() => expect(screen.getByTestId("scan-save-status")).toHaveTextContent("Scan saved to cloud"));
    expect(identifyCapturedFrame.mock.calls).toHaveLength(calls);
    expect(syncLookupToCloud).toHaveBeenCalledTimes(2);
  });

  it("shows local-only persistence when cloud sync is off", async () => {
    render(<MemoryRouter><Scanner /></MemoryRouter>);
    await userEvent.click(screen.getByRole("button", { name: "Scan now" }));
    expect(await screen.findByTestId("scan-save-status")).toHaveTextContent("Saved on this device. Cloud sync is off.");
  });

  it("does not let an older successful sync hide a failed corrected selection or its retry", async () => {
    mockStillImageTarget({ confidence: 0.9, x: 0.2, y: 0.2, width: 0.3, height: 0.3 });
    getCloudSyncStatus.mockReturnValue({ configured: true, message: "Configured" });
    let finishInitial!: (result: { ok: boolean; message: string }) => void;
    syncLookupToCloud.mockImplementationOnce(() => new Promise((resolve) => { finishInitial = resolve; }))
      .mockResolvedValueOnce({ ok: false, message: "New correction was not synced" });
    render(<MemoryRouter><Scanner /></MemoryRouter>);
    await userEvent.click(screen.getByRole("button", { name: "Scan now" }));
    await screen.findByRole("heading", { level: 3, name: "Alternator" });
    await userEvent.click(screen.getByRole("button", { name: "Correct area" }));
    fireEvent.change(screen.getByRole("slider", { name: "Selection x" }), { target: { value: "40" } });
    await userEvent.click(screen.getByRole("button", { name: "Apply area" }));
    await waitFor(() => expect(screen.getByTestId("scan-save-status")).toHaveTextContent("Cloud sync failed"));
    expect(syncLookupToCloud).toHaveBeenCalledTimes(2);
    expect(syncLookupToCloud.mock.calls[1][0]).toMatchObject({ id: getLookups()[0].id, focusBox: { x: 0.4 } });
    await act(async () => finishInitial({ ok: true, message: "Old initial scan synced" }));
    expect(screen.getByTestId("scan-save-status")).toHaveTextContent("Cloud sync failed");
    const providerCalls = identifyCapturedFrame.mock.calls.length;
    await userEvent.click(screen.getByRole("button", { name: "Retry cloud save" }));
    await waitFor(() => expect(screen.getByTestId("scan-save-status")).toHaveTextContent("Scan saved to cloud"));
    expect(syncLookupToCloud).toHaveBeenCalledTimes(3);
    expect(syncLookupToCloud.mock.calls[2][0]).toMatchObject({ id: getLookups()[0].id, focusBox: { x: 0.4 } });
    expect(identifyCapturedFrame).toHaveBeenCalledTimes(providerCalls);
  });

  it.each(["camera", "upload"])("stops %s analysis at device capacity without dropping earlier records", async (mode) => {
    for (let index = 0; index < MAX_SAVED_LOOKUPS; index += 1) {
      createLookup({ frame: { imageBase64: "data:image/jpeg;base64,test", capturedAt: new Date().toISOString() } });
    }
    const ids = getLookups().map((lookup) => lookup.id);
    render(<MemoryRouter><Scanner /></MemoryRouter>);
    if (mode === "camera") await userEvent.click(screen.getByRole("button", { name: "Scan now" }));
    else {
      await userEvent.upload(screen.getByLabelText("Upload photo"), new File(["test-image"], "part.jpg", { type: "image/jpeg" }));
      await analyzeReviewedPhotos();
    }
    expect(await screen.findByText(/Device limit reached/)).toBeInTheDocument();
    expect(identifyCapturedFrame).not.toHaveBeenCalled();
    expect(syncLookupToCloud).not.toHaveBeenCalled();
    expect(getLookups().map((lookup) => lookup.id)).toEqual(ids);
  });

  it("does not hide a failed local save behind a successful AI result", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("quota", "QuotaExceededError"); });
    render(<MemoryRouter><Scanner /></MemoryRouter>);
    await userEvent.click(screen.getByRole("button", { name: "Scan now" }));
    expect(await screen.findByTestId("scan-save-status")).toHaveTextContent("Not saved on this device");
    expect(syncLookupToCloud).not.toHaveBeenCalled();
    expect(removePhotoDraftIfMatches).not.toHaveBeenCalled();
    expect(draftStore.get("test-user:capture")?.[0].imageBase64).toBe("data:image/jpeg;base64,compressed-frame");
  });

  it.each(["camera", "upload"])("stops %s analysis when existing records cannot be read", async (mode) => {
    const key = accountStorageKey(LOOKUPS_STORAGE_KEY);
    const raw = "{unfinished";
    localStorage.setItem(key, raw);
    render(<MemoryRouter><Scanner /></MemoryRouter>);
    if (mode === "camera") await userEvent.click(screen.getByRole("button", { name: "Scan now" }));
    else {
      await userEvent.upload(screen.getByLabelText("Upload photo"), new File(["test-image"], "part.jpg", { type: "image/jpeg" }));
      await analyzeReviewedPhotos();
    }
    expect(await screen.findByText(/Saved scans could not be read safely/)).toBeInTheDocument();
    expect(identifyCapturedFrame).not.toHaveBeenCalled();
    expect(syncLookupToCloud).not.toHaveBeenCalled();
    expect(localStorage.getItem(key)).toBe(raw);
  });

  it("captures a second camera frame as a confidence boost when no crop target is present", async () => {
    captureFrame
      .mockResolvedValueOnce("data:image/jpeg;base64,primary-frame")
      .mockResolvedValueOnce("data:image/jpeg;base64,second-frame");

    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<Scanner />} />
        </Routes>
      </MemoryRouter>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Scan now" }));
    await waitFor(() => expect(identifyCapturedFrame).toHaveBeenCalledTimes(1));
    expect(identifyCapturedFrame.mock.calls[0][0]).toMatchObject({
      imageBase64: "data:image/jpeg;base64,primary-frame",
    });
    expect(identifyCapturedFrame.mock.calls[0][1]).toMatchObject({
      imageBase64: "data:image/jpeg;base64,second-frame",
    });
  }, 10000);

  it("keeps the photo and AI overview in separate mobile workspace panes", async () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 375 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 667 });

    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<Scanner />} />
        </Routes>
      </MemoryRouter>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Scan now" }));
    const reviewHeading = await screen.findByRole("heading", { level: 3, name: "Alternator" });
    const reviewCard = reviewHeading.closest("section") as HTMLElement | null;
    expect(reviewCard).toBeTruthy();
    expect(screen.getByTestId("scan-workspace-overview")).toContainElement(reviewCard);
    expect(screen.getByTestId("scan-workspace-photo")).not.toContainElement(reviewCard);
    expect(reviewCard?.style.position).toBe("");
    expect(reviewCard?.style.top).toBe("");
    expect(screen.getByText("AI overview")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open AI view" })).toHaveAttribute("href", `/result/${getLookups()[0].id}`);
    expect(screen.getByRole("link", { name: "Ask DeepSpec" })).toHaveAttribute("href", `/result/${getLookups()[0].id}/chat`);
    expect(within(reviewCard as HTMLElement).queryByRole("button", { name: "Open details" })).not.toBeInTheDocument();
    expect(within(reviewCard as HTMLElement).queryByRole("button", { name: "Correct label" })).not.toBeInTheDocument();
    expect(within(reviewCard as HTMLElement).queryByRole("button", { name: "Set reference" })).not.toBeInTheDocument();
    expect(within(reviewCard as HTMLElement).queryByRole("button", { name: "Estimate size" })).not.toBeInTheDocument();
  }, 10000);

  it("keeps the AI pane independent from the photo after rotation or resize", async () => {
    const originalWidth = window.innerWidth;
    const originalHeight = window.innerHeight;
    const setViewport = (width: number, height: number) => {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
      Object.defineProperty(window, "innerHeight", { configurable: true, value: height });
    };

    try {
      setViewport(375, 667);
      render(
        <MemoryRouter initialEntries={["/"]}>
          <Routes>
            <Route path="/" element={<Scanner />} />
          </Routes>
        </MemoryRouter>,
      );

      await userEvent.click(screen.getByRole("button", { name: "Scan now" }));
      const reviewHeading = await screen.findByRole("heading", { level: 3, name: "Alternator" });
      const reviewCard = reviewHeading.closest("section") as HTMLElement;
      expect(reviewCard.style.top).toBe("");
      expect(screen.getByTestId("scan-workspace-photo")).not.toContainElement(reviewCard);

      act(() => {
        setViewport(1024, 768);
        window.dispatchEvent(new Event("resize"));
      });

      const resizedCard = screen.getByRole("heading", { level: 3, name: "Alternator" }).closest("section") as HTMLElement;
      expect(resizedCard.style.top).toBe("");
      expect(screen.getByTestId("scan-workspace-overview")).toContainElement(resizedCard);
      expect(screen.getByTestId("scan-workspace-photo")).not.toContainElement(resizedCard);
    } finally {
      setViewport(originalWidth, originalHeight);
    }
  }, 20000);

  it("keeps measurement controls out of the default fastener scan card", async () => {
    identifyCapturedFrame.mockResolvedValueOnce(makeScanResult("Hex nut"));

    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<Scanner />} />
        </Routes>
      </MemoryRouter>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Scan now" }));
    const reviewHeading = await screen.findByRole("heading", { level: 3, name: "Hex nut" });
    const reviewCard = reviewHeading.closest("section") as HTMLElement | null;
    expect(reviewCard).toBeTruthy();

    expect(within(reviewCard as HTMLElement).queryByRole("combobox", { name: "Size reference preset" })).not.toBeInTheDocument();
    expect(within(reviewCard as HTMLElement).queryByRole("button", { name: "Set reference" })).not.toBeInTheDocument();
    expect(within(reviewCard as HTMLElement).queryByRole("button", { name: "Estimate size" })).not.toBeInTheDocument();
  }, 10000);

  it("lets the user scan with the shutter button", async () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<Scanner />} />
        </Routes>
      </MemoryRouter>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Scan now" }));

    await waitFor(() => expect(identifyCapturedFrame).toHaveBeenCalledTimes(1));
    const reviewHeading = await screen.findByRole("heading", { level: 3, name: "Alternator" });
    const reviewCard = reviewHeading.closest("section");
    expect(reviewCard).toBeTruthy();
    expect(screen.queryByRole("heading", { level: 1, name: "Turn on the camera" })).not.toBeInTheDocument();
    expect(within(reviewCard as HTMLElement).queryByRole("button", { name: "Open details" })).not.toBeInTheDocument();
  }, 10000);

  it("saves camera evidence in its separate capture draft before quality checks or provider work", async () => {
    let finishSave!: (saved: boolean) => void;
    savePhotoDraftIfEmpty.mockImplementationOnce(() => new Promise((resolve) => { finishSave = resolve; }));
    render(<MemoryRouter><Scanner /></MemoryRouter>);
    await userEvent.click(screen.getByRole("button", { name: "Scan now" }));
    await waitFor(() => expect(savePhotoDraftIfEmpty).toHaveBeenCalledTimes(1));
    expect(savePhotoDraftIfEmpty.mock.calls[0][0]).toEqual([expect.objectContaining({ imageBase64: "data:image/jpeg;base64,compressed-frame", label: "overview" })]);
    expect(savePhotoDraftIfEmpty.mock.calls[0][1]).toMatchObject({ userId: "test-user" });
    expect(savePhotoDraftIfEmpty.mock.calls[0][2]).toBe("capture");
    expect(assessImageQuality).not.toHaveBeenCalled();
    expect(identifyCapturedFrame).not.toHaveBeenCalled();
    await act(async () => finishSave(true));
    await waitFor(() => expect(identifyCapturedFrame).toHaveBeenCalledTimes(1), { timeout: 3000 });
    await screen.findByRole("heading", { level: 3, name: "Alternator" });
  });

  it("stops camera analysis when the captured photo cannot be saved durably", async () => {
    savePhotoDraftIfEmpty.mockRejectedValueOnce(new Error("Captured photo could not be saved. Free space and retry."));
    render(<MemoryRouter><Scanner /></MemoryRouter>);
    await userEvent.click(screen.getByRole("button", { name: "Scan now" }));
    expect(await screen.findByText("Captured photo could not be saved. Free space and retry.")).toBeInTheDocument();
    expect(assessImageQuality).not.toHaveBeenCalled();
    expect(identifyCapturedFrame).not.toHaveBeenCalled();
  });

  it("does not overwrite a kept upload group when taking a new camera photo", async () => {
    const kept: ScanPhoto[] = [{ id: "kept-overview", label: "overview", capturedAt: "2026-11-05T00:00:00Z", imageBase64: "data:image/jpeg;base64,kept" }];
    readPhotoDraft.mockImplementation(async (_scope, kind) => kind === "capture" ? null : kept);
    render(<MemoryRouter><Scanner /></MemoryRouter>);
    await screen.findByRole("button", { name: "Resume 1-photo draft" });
    await userEvent.click(screen.getByRole("button", { name: "Scan now" }));
    await waitFor(() => expect(identifyCapturedFrame).toHaveBeenCalledTimes(1), { timeout: 3000 });
    expect(savePhotoDraft).not.toHaveBeenCalled();
    expect(savePhotoDraftIfEmpty.mock.calls[0][2]).toBe("capture");
    await userEvent.click(await screen.findByRole("button", { name: "Resume 1-photo draft" }));
    expect(screen.getByRole("img", { name: "Photo 1: Overview" })).toHaveAttribute("src", kept[0].imageBase64);
  });

  it("resumes a pending camera capture before allowing another shutter capture", async () => {
    const pending: ScanPhoto = { id: "pending-camera", label: "overview", capturedAt: "2026-11-05T00:00:00Z", imageBase64: "data:image/jpeg;base64,pending" };
    draftStore.set("test-user:capture", [pending]);
    render(<MemoryRouter><Scanner /></MemoryRouter>);
    await userEvent.click(screen.getByRole("button", { name: "Scan now" }));
    await screen.findByRole("dialog", { name: "Review inspection photos" });
    expect(screen.getByRole("img", { name: "Photo 1: Overview" })).toHaveAttribute("src", pending.imageBase64);
    expect(captureFrame).not.toHaveBeenCalled();
    expect(savePhotoDraftIfEmpty).not.toHaveBeenCalled();
    expect(identifyCapturedFrame).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Discard draft" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Review inspection photos" })).not.toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: "Scan now" }));
    await screen.findByRole("heading", { level: 3, name: "Alternator" });
    expect(savePhotoDraftIfEmpty).toHaveBeenCalledTimes(1);
  });

  it("keeps a capture saved by another tab while the shutter is obtaining its photo", async () => {
    const newer: ScanPhoto = { id: "other-tab", label: "mounting", capturedAt: "2026-11-05T00:00:00Z", imageBase64: "data:image/jpeg;base64,other-tab" };
    captureFrame.mockImplementationOnce(async () => {
      draftStore.set("test-user:capture", [newer]);
      return "data:image/jpeg;base64,this-tab";
    });
    render(<MemoryRouter><Scanner /></MemoryRouter>);
    await userEvent.click(screen.getByRole("button", { name: "Scan now" }));
    await screen.findByRole("dialog", { name: "Review inspection photos" });
    expect(screen.getByRole("img", { name: "Photo 1: Mounting points" })).toHaveAttribute("src", newer.imageBase64);
    expect(draftStore.get("test-user:capture")).toEqual([newer]);
    expect(assessImageQuality).not.toHaveBeenCalled();
    expect(identifyCapturedFrame).not.toHaveBeenCalled();
  });

  it("preserves a canceled capture and resumes it instead of taking a replacement", async () => {
    let finishIdentify!: (result: ReturnType<typeof makeScanResult>) => void;
    identifyCapturedFrame.mockImplementationOnce(() => new Promise((resolve) => { finishIdentify = resolve; }));
    render(<MemoryRouter><Scanner /></MemoryRouter>);
    await userEvent.click(screen.getByRole("button", { name: "Scan now" }));
    await waitFor(() => expect(identifyCapturedFrame).toHaveBeenCalledTimes(1));
    const pending = structuredClone(draftStore.get("test-user:capture"));
    const captureCount = captureFrame.mock.calls.length;
    await userEvent.click(screen.getByRole("button", { name: "Cancel scan" }));
    await act(async () => finishIdentify(makeScanResult("Canceled result")));
    await userEvent.click(screen.getByRole("button", { name: "Scan now" }));
    await screen.findByRole("dialog", { name: "Review inspection photos" });
    expect(draftStore.get("test-user:capture")).toEqual(pending);
    expect(captureFrame).toHaveBeenCalledTimes(captureCount);
    expect(removePhotoDraftIfMatches).not.toHaveBeenCalled();
    expect(getLookups()).toHaveLength(0);
  });

  it("retires a matching capture only after Lookup persistence and allows the next camera scan", async () => {
    render(<MemoryRouter><Scanner /></MemoryRouter>);
    await userEvent.click(screen.getByRole("button", { name: "Scan now" }));
    await screen.findByRole("heading", { level: 3, name: "Alternator" });
    await waitFor(() => expect(draftStore.has("test-user:capture")).toBe(false));
    const captured = savePhotoDraftIfEmpty.mock.calls[0][0];
    expect(getLookups()[0].frame.imageBase64).toBe(captured[0].imageBase64);
    expect(removePhotoDraftIfMatches).toHaveBeenCalledWith(captured, expect.objectContaining({ userId: "test-user" }), "capture");
    expect(removePhotoDraft).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Close result card" }));
    await userEvent.click(screen.getByRole("button", { name: "Scan now" }));
    await waitFor(() => expect(savePhotoDraftIfEmpty).toHaveBeenCalledTimes(2));
    await screen.findByRole("heading", { level: 3, name: "Alternator" });
    expect(getLookups()).toHaveLength(2);
  });

  it("keeps a newer capture when an older analysis finishes saving", async () => {
    let finishIdentify!: (result: ReturnType<typeof makeScanResult>) => void;
    identifyCapturedFrame.mockImplementationOnce(() => new Promise((resolve) => { finishIdentify = resolve; }));
    render(<MemoryRouter><Scanner /></MemoryRouter>);
    await userEvent.click(screen.getByRole("button", { name: "Scan now" }));
    await waitFor(() => expect(identifyCapturedFrame).toHaveBeenCalledTimes(1));
    const newer: ScanPhoto = { id: "newer-camera", label: "marking", capturedAt: "2026-11-05T00:00:00Z", imageBase64: "data:image/jpeg;base64,newer" };
    draftStore.set("test-user:capture", [newer]);
    await act(async () => finishIdentify(makeScanResult("Alternator")));
    await waitFor(() => expect(removePhotoDraftIfMatches).toHaveBeenCalledTimes(1));
    expect(draftStore.get("test-user:capture")).toEqual([newer]);
    await userEvent.click(await screen.findByRole("button", { name: "Resume captured photo" }));
    expect(screen.getByRole("img", { name: "Photo 1: Label or marking" })).toHaveAttribute("src", newer.imageBase64);
  });

  it("retires a resumed captured group once all its evidence is saved to Lookup", async () => {
    const pending: ScanPhoto = { id: "resume-camera", label: "overview", capturedAt: "2026-11-05T00:00:00Z", imageBase64: "data:image/jpeg;base64,resume" };
    draftStore.set("test-user:capture", [pending]);
    render(<MemoryRouter><Scanner /></MemoryRouter>);
    await userEvent.click(await screen.findByRole("button", { name: "Resume captured photo" }));
    await analyzeReviewedPhotos();
    await screen.findByRole("heading", { level: 3, name: "Alternator" });
    await waitFor(() => expect(draftStore.has("test-user:capture")).toBe(false));
    expect(getLookups()[0].photos).toEqual([pending]);
    expect(removePhotoDraftIfMatches.mock.calls[0][0]).toEqual([pending]);
  });

  it("reviews both labeled photos and verifies their durable group without rewriting it before asking the provider", async () => {
    render(<MemoryRouter><Scanner /></MemoryRouter>);
    await userEvent.upload(screen.getByLabelText("Upload photo"), [
      new File(["engine overview"], "overview.jpg", { type: "image/jpeg" }),
      new File(["part marking"], "marking.jpg", { type: "image/jpeg" }),
    ]);
    const review = await screen.findByRole("dialog", { name: "Review inspection photos" });
    expect(within(review).getAllByRole("img")).toHaveLength(2);
    expect(identifyCapturedFrame).not.toHaveBeenCalled();
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Photo 2 view" }), "marking");
    await waitFor(() => expect(screen.getByRole("button", { name: "Analyze 2 photos" })).toBeEnabled());
    const reviewed = savePhotoDraft.mock.calls.at(-1)![0];
    expect(reviewed.map((photo) => photo.label)).toEqual(["overview", "marking"]);
    const writeCount = savePhotoDraft.mock.calls.length;
    let finishVerification!: (matched: boolean) => void;
    replacePhotoDraftIfMatches.mockImplementationOnce(() => new Promise((resolve) => { finishVerification = resolve; }));
    await analyzeReviewedPhotos();
    expect(replacePhotoDraftIfMatches.mock.calls.at(-1)!.slice(0, 2)).toEqual([reviewed, reviewed]);
    expect(savePhotoDraft).toHaveBeenCalledTimes(writeCount);
    expect(identifyCapturedFrame).not.toHaveBeenCalled();
    await act(async () => finishVerification(true));
    await waitFor(() => expect(identifyCapturedFrame).toHaveBeenCalledTimes(1), { timeout: 3000 });
    expect(identifyCapturedFrame.mock.calls[0][3]).toMatchObject({ photos: reviewed });
    expect(identifyCapturedFrame.mock.calls[0][0]).toMatchObject({ imageBase64: reviewed[0].imageBase64 });
    await screen.findByRole("heading", { level: 3, name: "Alternator" });
  }, 10000);

  it("does not run analysis when saving an uploaded photo fails", async () => {
    savePhotoDraft.mockRejectedValueOnce(new Error("Photo storage is full. Free space and retry."));
    render(<MemoryRouter><Scanner /></MemoryRouter>);
    await userEvent.upload(screen.getByLabelText("Upload photo"), new File(["engine"], "engine.jpg", { type: "image/jpeg" }));
    expect(await screen.findByText("Photo storage is full. Free space and retry.")).toBeInTheDocument();
    expect(identifyCapturedFrame).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: "Review inspection photos" })).not.toBeInTheDocument();
  });

  it("keeps a reviewed draft and prevents provider work when checking its durable group fails", async () => {
    render(<MemoryRouter><Scanner /></MemoryRouter>);
    await userEvent.upload(screen.getByLabelText("Upload photo"), new File(["engine"], "engine.jpg", { type: "image/jpeg" }));
    await screen.findByRole("dialog", { name: "Review inspection photos" });
    replacePhotoDraftIfMatches.mockRejectedValueOnce(new Error("Could not verify these saved photos. Retry before analysis."));
    await analyzeReviewedPhotos();
    expect(await screen.findByText("Could not verify these saved photos. Retry before analysis.")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Review inspection photos" })).toBeInTheDocument();
    expect(identifyCapturedFrame).not.toHaveBeenCalled();
    expect(removePhotoDraft).not.toHaveBeenCalled();
  });

  it.each([
    { kind: "upload" as const, action: "edit" },
    { kind: "upload" as const, action: "discard" },
    { kind: "upload" as const, action: "analyze" },
    { kind: "capture" as const, action: "edit" },
    { kind: "capture" as const, action: "discard" },
    { kind: "capture" as const, action: "analyze" },
  ])("preserves a newer $kind draft when a stale review tries to $action", async ({ kind, action }) => {
    const old: ScanPhoto = { id: "reviewed-photo", label: "overview", capturedAt: "2026-11-05T00:00:00Z", imageBase64: "data:image/jpeg;base64,reviewed" };
    const newer: ScanPhoto = { id: "other-tab-photo", label: "mounting", capturedAt: "2026-11-05T01:00:00Z", imageBase64: "data:image/jpeg;base64,newer" };
    draftStore.set(`test-user:${kind}`, [old]);
    render(<MemoryRouter><Scanner /></MemoryRouter>);
    await userEvent.click(await screen.findByRole("button", { name: kind === "capture" ? "Resume captured photo" : "Resume 1-photo draft" }));
    draftStore.set(`test-user:${kind}`, [newer]);
    if (action === "edit") await userEvent.selectOptions(screen.getByRole("combobox", { name: "Photo 1 view" }), "marking");
    else if (action === "discard") await userEvent.click(screen.getByRole("button", { name: "Discard draft" }));
    else await analyzeReviewedPhotos();
    expect(await screen.findByText("Saved photos changed in another tab. Your change was not applied. Review the current draft before continuing.")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Photo 1: Mounting points" })).toHaveAttribute("src", newer.imageBase64);
    expect(draftStore.get(`test-user:${kind}`)).toEqual([newer]);
    expect(replacePhotoDraftIfMatches.mock.calls[0][0]).toEqual([old]);
    expect(savePhotoDraft).not.toHaveBeenCalled();
    expect(removePhotoDraft).not.toHaveBeenCalled();
    expect(identifyCapturedFrame).not.toHaveBeenCalled();
  });

  it.each(["upload", "capture"] as const)("preserves a newer %s group saved while an added file is being prepared", async (kind) => {
    const old: ScanPhoto = { id: "before-add", label: "overview", capturedAt: "2026-11-05T00:00:00Z", imageBase64: "data:image/jpeg;base64,old" };
    const newer: ScanPhoto = { id: "during-add", label: "marking", capturedAt: "2026-11-05T01:00:00Z", imageBase64: "data:image/jpeg;base64,newer" };
    draftStore.set(`test-user:${kind}`, [old]);
    render(<MemoryRouter><Scanner /></MemoryRouter>);
    await userEvent.click(await screen.findByRole("button", { name: kind === "capture" ? "Resume captured photo" : "Resume 1-photo draft" }));
    const compareAndSwap = replacePhotoDraftIfMatches.getMockImplementation()!;
    replacePhotoDraftIfMatches.mockImplementationOnce(async (...args) => {
      // A different tab commits after the append read, before the prepared photo can be written.
      draftStore.set(`test-user:${kind}`, [newer]);
      return compareAndSwap(...args);
    });
    await userEvent.upload(screen.getByLabelText("Upload photo"), new File(["new angle"], "angle.jpg", { type: "image/jpeg" }));
    expect(await screen.findByText("Saved photos changed in another tab. Your change was not applied. Review the current draft before continuing.")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Photo 1: Label or marking" })).toHaveAttribute("src", newer.imageBase64);
    expect(draftStore.get(`test-user:${kind}`)).toEqual([newer]);
    expect(replacePhotoDraftIfMatches.mock.calls[0][0]).toEqual([old]);
    expect(replacePhotoDraftIfMatches.mock.calls[0][1]).toHaveLength(2);
    expect(savePhotoDraft).not.toHaveBeenCalled();
    expect(identifyCapturedFrame).not.toHaveBeenCalled();
  });

  it("appends an uploaded angle after keeping a draft closed instead of replacing its original", async () => {
    render(<MemoryRouter><Scanner /></MemoryRouter>);
    await userEvent.upload(screen.getByLabelText("Upload photo"), new File(["original"], "overview.jpg", { type: "image/jpeg" }));
    await screen.findByRole("dialog", { name: "Review inspection photos" });
    const original = savePhotoDraft.mock.calls[0][0][0];
    await userEvent.click(screen.getByRole("button", { name: "Keep draft and close" }));
    await userEvent.upload(screen.getByLabelText("Upload photo"), new File(["next angle"], "angle.jpg", { type: "image/jpeg" }));
    await screen.findByRole("button", { name: "Analyze 2 photos" });
    const appended = savePhotoDraft.mock.calls.at(-1)![0];
    expect(appended).toHaveLength(2);
    expect(appended[0]).toEqual(original);
    expect(appended[1].id).not.toBe(original.id);
    expect(identifyCapturedFrame).not.toHaveBeenCalled();
    expect(removePhotoDraft).not.toHaveBeenCalled();
  });

  it("reads the persisted group before appending while the startup draft read is still pending", async () => {
    const kept: ScanPhoto = { id: "kept-before-startup", label: "overview", capturedAt: "2026-11-05T00:00:00Z", imageBase64: "data:image/jpeg;base64,kept" };
    draftStore.set("test-user:upload", [kept]);
    let finishStartupRead!: (photos: ScanPhoto[]) => void;
    readPhotoDraft.mockImplementationOnce(() => new Promise((resolve) => { finishStartupRead = resolve; }));
    render(<MemoryRouter><Scanner /></MemoryRouter>);

    await userEvent.upload(screen.getByLabelText("Upload photo"), new File(["another view"], "new.jpg", { type: "image/jpeg" }));
    await screen.findByRole("button", { name: "Analyze 2 photos" });
    const appended = draftStore.get("test-user:upload")!;
    expect(appended).toHaveLength(2);
    expect(appended[0]).toEqual(kept);
    expect(appended[1].id).not.toBe(kept.id);
    expect(readPhotoDraft.mock.calls.filter((call) => call[1] === undefined)).toHaveLength(2);
    expect(savePhotoDraft.mock.calls[0][2]).toBeUndefined();
    expect(identifyCapturedFrame).not.toHaveBeenCalled();

    await act(async () => finishStartupRead([kept]));
    expect(screen.getByRole("button", { name: "Analyze 2 photos" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Photo 2: Other angle" })).toHaveAttribute("src", appended[1].imageBase64);
  });

  it("does not replace a saved group when its authoritative append read fails", async () => {
    const kept: ScanPhoto = { id: "kept-unreadable", label: "overview", capturedAt: "2026-11-05T00:00:00Z", imageBase64: "data:image/jpeg;base64,kept" };
    draftStore.set("test-user:upload", [kept]);
    render(<MemoryRouter><Scanner /></MemoryRouter>);
    await screen.findByRole("button", { name: "Resume 1-photo draft" });
    readPhotoDraft.mockRejectedValueOnce(new Error("The saved photo draft could not be read safely. It has been kept for recovery."));
    await userEvent.upload(screen.getByLabelText("Upload photo"), new File(["new"], "new.jpg", { type: "image/jpeg" }));
    expect(await screen.findByText("The saved photo draft could not be read safely. It has been kept for recovery.")).toBeInTheDocument();
    expect(savePhotoDraft).not.toHaveBeenCalled();
    expect(removePhotoDraft).not.toHaveBeenCalled();
    expect(identifyCapturedFrame).not.toHaveBeenCalled();
    expect(draftStore.get("test-user:upload")).toEqual([kept]);
  });

  it("enforces the four-photo limit against storage while the initial group is still loading", async () => {
    const kept: ScanPhoto[] = Array.from({ length: 4 }, (_, index) => ({ id: `kept-${index}`, label: "overview", capturedAt: "2026-11-05T00:00:00Z", imageBase64: `data:image/jpeg;base64,photo${index}` }));
    draftStore.set("test-user:upload", kept);
    let finishStartupRead!: (photos: ScanPhoto[]) => void;
    readPhotoDraft.mockImplementationOnce(() => new Promise((resolve) => { finishStartupRead = resolve; }));
    render(<MemoryRouter><Scanner /></MemoryRouter>);
    await userEvent.upload(screen.getByLabelText("Upload photo"), new File(["fifth"], "fifth.jpg", { type: "image/jpeg" }));
    expect(await screen.findByText("Choose up to four photos of the same part or area. No photos were discarded.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Resume 4-photo draft" })).toBeInTheDocument();
    expect(savePhotoDraft).not.toHaveBeenCalled();
    expect(identifyCapturedFrame).not.toHaveBeenCalled();
    expect(draftStore.get("test-user:upload")).toEqual(kept);
    await act(async () => finishStartupRead(kept));
  });

  it("reads and appends the capture slot only while that capture draft is being edited", async () => {
    const capture: ScanPhoto = { id: "camera-view", label: "overview", capturedAt: "2026-11-05T00:00:00Z", imageBase64: "data:image/jpeg;base64,camera" };
    const upload: ScanPhoto = { id: "upload-view", label: "overview", capturedAt: "2026-11-05T00:00:00Z", imageBase64: "data:image/jpeg;base64,upload" };
    draftStore.set("test-user:capture", [capture]);
    draftStore.set("test-user:upload", [upload]);
    render(<MemoryRouter><Scanner /></MemoryRouter>);
    await userEvent.click(await screen.findByRole("button", { name: "Resume captured photo" }));
    await userEvent.upload(screen.getByLabelText("Upload photo"), new File(["capture angle"], "angle.jpg", { type: "image/jpeg" }));
    await screen.findByRole("button", { name: "Analyze 2 photos" });
    expect(readPhotoDraft.mock.calls.at(-1)![1]).toBe("capture");
    expect(savePhotoDraft.mock.calls.at(-1)![2]).toBe("capture");
    expect(draftStore.get("test-user:capture")![0]).toEqual(capture);
    expect(draftStore.get("test-user:upload")).toEqual([upload]);

    await userEvent.click(screen.getByRole("button", { name: "Keep draft and close" }));
    await userEvent.upload(screen.getByLabelText("Upload photo"), new File(["upload angle"], "upload-angle.jpg", { type: "image/jpeg" }));
    await screen.findByRole("button", { name: "Analyze 2 photos" });
    expect(readPhotoDraft.mock.calls.at(-1)![1]).toBeUndefined();
    expect(savePhotoDraft.mock.calls.at(-1)![2]).toBeUndefined();
    expect(draftStore.get("test-user:upload")![0]).toEqual(upload);
    expect(draftStore.get("test-user:capture")).toHaveLength(2);
    expect(identifyCapturedFrame).not.toHaveBeenCalled();
  });

  it("does not write after the account changes during the authoritative append read", async () => {
    render(<MemoryRouter><Scanner /></MemoryRouter>);
    await waitFor(() => expect(readPhotoDraft).toHaveBeenCalledTimes(2));
    let finishAppendRead!: (photos: ScanPhoto[] | null) => void;
    readPhotoDraft.mockImplementationOnce(() => new Promise((resolve) => { finishAppendRead = resolve; }));
    await userEvent.upload(screen.getByLabelText("Upload photo"), new File(["new"], "new.jpg", { type: "image/jpeg" }));
    await waitFor(() => expect(readPhotoDraft).toHaveBeenCalledTimes(3));
    await act(async () => { setActiveAccount("other-user"); finishAppendRead(null); });
    expect(savePhotoDraft).not.toHaveBeenCalled();
    expect(removePhotoDraft).not.toHaveBeenCalled();
    expect(identifyCapturedFrame).not.toHaveBeenCalled();
  });

  it("cancels while draft verification is pending and does not call the provider afterward", async () => {
    render(<MemoryRouter><Scanner /></MemoryRouter>);
    await userEvent.upload(screen.getByLabelText("Upload photo"), new File(["engine"], "engine.jpg", { type: "image/jpeg" }));
    await screen.findByRole("dialog", { name: "Review inspection photos" });
    let finishVerification!: (matched: boolean) => void;
    replacePhotoDraftIfMatches.mockImplementationOnce(() => new Promise((resolve) => { finishVerification = resolve; }));
    await analyzeReviewedPhotos();
    await userEvent.click(screen.getByRole("button", { name: "Cancel scan" }));
    await act(async () => finishVerification(true));
    expect(identifyCapturedFrame).not.toHaveBeenCalled();
    expect(removePhotoDraft).not.toHaveBeenCalled();
    expect(await screen.findByText("Scan canceled. Ready when you are.")).toBeInTheDocument();
  });

  it("rejects a provider transition when the account changes during draft verification", async () => {
    render(<MemoryRouter><Scanner /></MemoryRouter>);
    await userEvent.upload(screen.getByLabelText("Upload photo"), new File(["engine"], "engine.jpg", { type: "image/jpeg" }));
    await screen.findByRole("dialog", { name: "Review inspection photos" });
    let finishVerification!: (matched: boolean) => void;
    replacePhotoDraftIfMatches.mockImplementationOnce(() => new Promise((resolve) => { finishVerification = resolve; }));
    await analyzeReviewedPhotos();
    await act(async () => {
      setActiveAccount("other-user");
      finishVerification(true);
    });
    expect(identifyCapturedFrame).not.toHaveBeenCalled();
    expect(removePhotoDraft).not.toHaveBeenCalled();
  });

  it("does not let a slow restored draft replace photos just saved by the user", async () => {
    let finishRead!: (photos: ScanPhoto[]) => void;
    readPhotoDraft.mockImplementationOnce(() => new Promise((resolve) => { finishRead = resolve; }));
    render(<MemoryRouter><Scanner /></MemoryRouter>);
    await userEvent.upload(screen.getByLabelText("Upload photo"), new File(["new evidence"], "new.jpg", { type: "image/jpeg" }));
    await screen.findByRole("dialog", { name: "Review inspection photos" });
    const saved = savePhotoDraft.mock.calls[0][0][0];
    await act(async () => finishRead([{ id: "old-photo", capturedAt: "2026-11-05T00:00:00Z", label: "overview", imageBase64: "data:image/jpeg;base64,old" }]));
    expect(screen.getByRole("img", { name: "Photo 1: Overview" })).toHaveAttribute("src", saved.imageBase64);
  });

  it("identifies an uploaded photo when the camera is blocked", async () => {
    cameraHookState.current = {
      cameraError: "Permission denied",
      cameraRequestId: 7,
      cameraState: "blocked",
    };

    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<Scanner />} />
        </Routes>
      </MemoryRouter>,
    );

    await userEvent.upload(
      screen.getByLabelText("Upload photo"),
      new File(["test-image"], "alternator.jpg", { type: "image/jpeg" }),
    );
    await analyzeReviewedPhotos();

    // jsdom never decodes images, so the upload's target detection always runs out its 900ms
    // decode timeout before identify is called — too close to waitFor's 1000ms default.
    await waitFor(() => expect(identifyCapturedFrame).toHaveBeenCalledTimes(1), { timeout: 3000 });
    const reviewHeading = await screen.findByRole("heading", { level: 3, name: "Alternator" });
    const reviewCard = reviewHeading.closest("section");
    expect(reviewCard).toBeTruthy();
    expect(within(reviewCard as HTMLElement).queryByRole("button", { name: "Open details" })).not.toBeInTheDocument();
    const savedLookups = JSON.parse(localStorage.getItem(accountStorageKey("deep-spec:lookups")) ?? "[]");
    expect(savedLookups[0]).toMatchObject({
      provenance: {
        analysisSource: "ai_detection",
        captureMode: "upload",
      },
    });
  }, 10000);

  describe("when the camera is blocked and upload is the only way to scan", () => {
    function renderBlockedScanner() {
      cameraHookState.current = {
        cameraError: "Permission denied",
        cameraRequestId: 7,
        cameraState: "blocked",
      };
      render(
        <MemoryRouter initialEntries={["/"]}>
          <Routes>
            <Route path="/" element={<Scanner />} />
          </Routes>
        </MemoryRouter>,
      );
    }

    // fireEvent, not userEvent.upload: user-event filters files by the input's accept list, and
    // the picker's "All files" option (or a drop) can still hand the handler any type.
    function chooseFile(file: File) {
      fireEvent.change(screen.getByLabelText("Upload photo"), { target: { files: [file] } });
    }

    it("rejects a file type the server would refuse, and says so", async () => {
      renderBlockedScanner();

      chooseFile(new File(["GIF89a"], "animation.gif", { type: "image/gif" }));

      expect(await screen.findByText("Choose a JPEG, PNG, or WebP photo.")).toBeInTheDocument();
      expect(identifyCapturedFrame).not.toHaveBeenCalled();
      expect(localStorage.getItem(accountStorageKey("deep-spec:lookups"))).toBeNull();
    });

    it("tells the user when the photo is over the size limit", async () => {
      renderBlockedScanner();
      const oversized = new File(["x"], "huge.jpg", { type: "image/jpeg" });
      Object.defineProperty(oversized, "size", { value: 13 * 1024 * 1024 });

      chooseFile(oversized);

      expect(await screen.findByText("Choose a photo under 12 MB.")).toBeInTheDocument();
      expect(identifyCapturedFrame).not.toHaveBeenCalled();
    });

    it("preserves rejected uploads and does not spend the retake when the file chooser is canceled", async () => {
      assessImageQuality.mockResolvedValue({
        ok: false,
        issue: "too_blurry",
        message: "Move closer for more detail.",
      });
      renderBlockedScanner();

      chooseFile(new File(["blurry"], "blurry.jpg", { type: "image/jpeg" }));
      await analyzeReviewedPhotos();

      expect(await screen.findByRole("heading", { level: 2, name: "Hold steady" }, { timeout: 3000 })).toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: "Upload one retake" }));
      fireEvent.change(screen.getByLabelText("Upload photo"), { target: { files: [] } });
      expect(screen.getByRole("button", { name: "Upload one retake" })).toBeInTheDocument();
      expect(JSON.parse(localStorage.getItem(accountStorageKey("deep-spec:lookups")) ?? "[]")).toHaveLength(1);
      await userEvent.click(screen.getByRole("button", { name: "Upload one retake" }));
      chooseFile(new File(["blurry again"], "retake.jpg", { type: "image/jpeg" }));
      await analyzeReviewedPhotos();
      expect(
        await screen.findByText(
          "Guided retake used. Review the evidence or start a separate scan when ready.",
          {},
          { timeout: 5000 },
        ),
      ).toBeInTheDocument();
      expect(JSON.parse(localStorage.getItem(accountStorageKey("deep-spec:lookups")) ?? "[]")).toHaveLength(2);
      expect(identifyCapturedFrame).not.toHaveBeenCalled();
    }, 30000);
  });

  it("sends a focused detector crop as the AI image for uploaded photos", async () => {
    cameraHookState.current = {
      cameraError: "Permission denied",
      cameraRequestId: 7,
      cameraState: "blocked",
    };
    detectObjectTargetFromImageData.mockReturnValue({
      confidence: 0.81,
      height: 0.18,
      width: 0.16,
      x: 0.42,
      y: 0.22,
    });

    class TestImage {
      naturalHeight = 600;
      naturalWidth = 1000;
      onerror: null | (() => void) = null;
      onload: null | (() => void) = null;

      set src(_value: string) {
        window.setTimeout(() => this.onload?.(), 0);
      }
    }

    vi.stubGlobal("Image", TestImage);
    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tagName, options) => {
      if (tagName.toLowerCase() === "canvas") {
        return {
          getContext: () => ({
            drawImage: vi.fn(),
            getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(4), height: 1, width: 1 })),
          }),
          height: 0,
          width: 0,
        } as unknown as HTMLCanvasElement;
      }

      return originalCreateElement(tagName, options);
    });

    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<Scanner />} />
        </Routes>
      </MemoryRouter>,
    );

    await userEvent.upload(
      screen.getByLabelText("Upload photo"),
      new File(["test-image"], "front-fender.jpg", { type: "image/jpeg" }),
    );
    await analyzeReviewedPhotos();

    await waitFor(() => expect(identifyCapturedFrame).toHaveBeenCalledTimes(1));
    expect(createFocusedScanCrop).toHaveBeenCalledWith(expect.stringMatching(/^data:image\/jpeg;base64,/), {
      confidence: 0.81,
      height: 0.18,
      width: 0.16,
      x: 0.42,
      y: 0.22,
    });
    expect(identifyCapturedFrame.mock.calls[0][0]).toMatchObject({
      imageBase64: expect.stringMatching(/^data:image\/jpeg;base64,/),
    });
    expect(identifyCapturedFrame.mock.calls[0][1]).toMatchObject({
      imageBase64: "data:image/jpeg;base64,target-crop",
    });
  }, 10000);

  it("shows camera permission denial and lets the user retry camera access", async () => {
    cameraHookState.current = {
      cameraError: "Permission denied",
      cameraRequestId: 4,
      cameraState: "blocked",
    };

    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<Scanner />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { level: 1, name: "Turn on the camera" })).toBeInTheDocument();
    expect(screen.getByText(/Allow camera access for this site/)).toBeInTheDocument();
    expect(screen.queryByTestId("webcam-preview")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Try camera again" }));

    expect(retryCamera).toHaveBeenCalledTimes(1);
  });

  it("keeps blocked-camera recovery minimal even when the retake guide query is present", () => {
    cameraHookState.current = {
      cameraError: "Permission denied",
      cameraRequestId: 4,
      cameraState: "blocked",
    };

    render(
      <MemoryRouter initialEntries={["/scan?guide=retake"]}>
        <Routes>
          <Route path="/scan" element={<Scanner />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.queryByText("Retake guide")).not.toBeInTheDocument();
    expect(screen.queryByText("Fill the frame from a slight angle.")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try camera again" })).toBeInTheDocument();
    expect(screen.getByLabelText("Upload photo")).toBeInTheDocument();
  });

  it("shows the camera loading state before the first frame is ready", () => {
    cameraHookState.current = {
      cameraError: null,
      cameraRequestId: 2,
      cameraState: "loading",
    };

    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<Scanner />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getAllByText("Opening camera")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Open gallery" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Scan now" })).toBeDisabled();
  });

  it("lets the user switch camera from the simplified scanner controls", async () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<Scanner />} />
        </Routes>
      </MemoryRouter>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Switch camera" }));

    expect(switchCamera).toHaveBeenCalledTimes(1);
  });

  it("keeps the camera alive when a transient frame capture fails", async () => {
    captureFrame.mockRejectedValueOnce(new Error("No camera frame was available."));

    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<Scanner />} />
        </Routes>
      </MemoryRouter>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Scan now" }));

    expect(await screen.findByText("No camera frame was available.")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 1, name: "Turn on the camera" })).not.toBeInTheDocument();
    expect(identifyCapturedFrame).not.toHaveBeenCalled();
  }, 10000);

  it("keeps the real camera scanner active when a stale test query is present", async () => {
    window.history.pushState({}, "", "/scan?test=1");

    render(
      <MemoryRouter initialEntries={["/scan?test=1"]}>
        <Routes>
          <Route path="/scan" element={<Scanner />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.queryByRole("button", { name: "Run AI test photo" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Scan now" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Scan now" }));
    await waitFor(() => expect(identifyCapturedFrame).toHaveBeenCalledTimes(1));
    expect(localStorage.getItem(accountStorageKey("deep-spec:lookups"))).toBeTruthy();
  }, 10000);

  it("lets the user cancel a scan in progress before the result opens", async () => {
    identifyCapturedFrame.mockImplementationOnce(() => new Promise(() => undefined));

    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<Scanner />} />
        </Routes>
      </MemoryRouter>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Scan now" }));
    await userEvent.click(await screen.findByRole("button", { name: "Cancel scan" }));

    expect(await screen.findByText("Scan canceled. Ready when you are.")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 1, name: "Alternator" })).not.toBeInTheDocument();
  }, 10000);

  it("aborts the real identify signal, blocks an overlapping upload, and preserves the captured photo", async () => {
    let activeSignal: AbortSignal | null = null;
    let rejectCanceled!: (error: Error) => void;
    identifyCapturedFrame
      .mockImplementationOnce((...args: unknown[]) => new Promise((_resolve, reject) => {
        activeSignal = (args[3] as { signal?: AbortSignal } | undefined)?.signal ?? null;
        rejectCanceled = reject;
      }))
      .mockResolvedValueOnce(makeScanResult("Water pump"));
    render(<MemoryRouter><Scanner /></MemoryRouter>);

    await userEvent.click(screen.getByRole("button", { name: "Scan now" }));
    await waitFor(() => expect(activeSignal).not.toBeNull());
    expect(screen.getByRole("button", { name: "Switch camera" })).toBeDisabled();
    expect(screen.getByTestId("scan-analyzing-overlay")).toHaveClass("z-[80]");

    await userEvent.click(screen.getByRole("button", { name: "Cancel scan" }));
    expect(activeSignal?.aborted).toBe(true);
    expect(sessionStorage.getItem(accountStorageKey("deep-spec:latest-scan-state"))).toContain("compressed-frame");

    fireEvent.change(screen.getByLabelText("Upload photo"), {
      target: { files: [new File(["first retry"], "retry.jpg", { type: "image/jpeg" })] },
    });
    expect(identifyCapturedFrame).toHaveBeenCalledTimes(1);

    await act(async () => {
      rejectCanceled(new DOMException("Aborted", "AbortError"));
      await Promise.resolve();
    });
    fireEvent.change(screen.getByLabelText("Upload photo"), {
      target: { files: [new File(["second retry"], "retry.jpg", { type: "image/jpeg" })] },
    });
    await analyzeReviewedPhotos();
    await waitFor(() => expect(identifyCapturedFrame).toHaveBeenCalledTimes(2), { timeout: 6000 });
    expect(await screen.findByRole("heading", { level: 3, name: "Water pump" }, { timeout: 6000 })).toBeInTheDocument();
    expect(screen.queryByText("The photo is saved. Try again.")).not.toBeInTheDocument();
  }, 15000);

  it("aborts the active identify request when the scanner unmounts", async () => {
    let activeSignal: AbortSignal | null = null;
    identifyCapturedFrame.mockImplementationOnce((...args: unknown[]) => new Promise((_resolve, reject) => {
      activeSignal = (args[3] as { signal?: AbortSignal } | undefined)?.signal ?? null;
      activeSignal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    }));
    const { unmount } = render(<MemoryRouter><Scanner /></MemoryRouter>);

    await userEvent.click(screen.getByRole("button", { name: "Scan now" }));
    await waitFor(() => expect(activeSignal).not.toBeNull());
    unmount();

    expect(activeSignal?.aborted).toBe(true);
  });

  it("aborts the active identify request when the account scope changes", async () => {
    let activeSignal: AbortSignal | null = null;
    identifyCapturedFrame.mockImplementationOnce((...args: unknown[]) => new Promise((_resolve, reject) => {
      activeSignal = (args[3] as { signal?: AbortSignal } | undefined)?.signal ?? null;
      activeSignal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    }));
    render(<MemoryRouter><Scanner /></MemoryRouter>);

    await userEvent.click(screen.getByRole("button", { name: "Scan now" }));
    await waitFor(() => expect(activeSignal).not.toBeNull());
    setActiveAccount("replacement-user");

    await waitFor(() => expect(activeSignal?.aborted).toBe(true));
    expect(screen.queryByRole("heading", { level: 3, name: "Item captured" })).not.toBeInTheDocument();
  });

  it.each(["missing_session", "invalid_session"])("saves the photo and offers a /scan sign-in return for %s", async (code) => {
    const { AIServiceError } = await import("../services/aiService");
    identifyCapturedFrame.mockRejectedValueOnce(new AIServiceError(code, "Server auth details must not be shown."));
    render(
      <MemoryRouter initialEntries={["/scan"]}>
        <Routes>
          <Route path="/scan" element={<Scanner />} />
          <Route path="/auth" element={<AuthReturnProbe />} />
        </Routes>
      </MemoryRouter>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Scan now" }));
    const signIn = await screen.findByRole("link", { name: "Sign in to continue" });
    expect(screen.getByText("The photo is saved. Sign in again to continue.")).toBeInTheDocument();
    expect(getLookups()[0]).toMatchObject({ errorCode: code, frame: { imageBase64: expect.stringContaining("compressed-frame") } });

    await userEvent.click(signIn);
    expect(await screen.findByText("Auth return: /scan")).toBeInTheDocument();
  });

  it.each([
    ["rate_limit_unavailable", "Request limits could not be verified"],
    ["scan_limit_reached", "No scan credits are available"],
    ["entitlement_unavailable", "Scan credits could not be verified"],
    ["session_unavailable", "Your session could not be verified right now"],
  ])("shows a specific saved-photo recovery for %s", async (code, expectedMessage) => {
    const { AIServiceError } = await import("../services/aiService");
    identifyCapturedFrame.mockRejectedValueOnce(new AIServiceError(code, "Raw server detail"));
    render(<MemoryRouter><Scanner /></MemoryRouter>);

    await userEvent.click(screen.getByRole("button", { name: "Scan now" }));

    expect(await screen.findByText(new RegExp(expectedMessage))).toBeInTheDocument();
    expect(screen.queryByText("Raw server detail")).not.toBeInTheDocument();
  });

  it.each(["other-user", "test-user"])("discards a pending scan after account change ending at %s", async (finalAccount) => {
    vi.mocked(hashImageDataUrl).mockResolvedValueOnce("private-image-hash");
    let resolveScan!: (value: ReturnType<typeof makeScanResult>) => void;
    identifyCapturedFrame.mockImplementationOnce(() => new Promise((resolve) => { resolveScan = resolve; }));
    render(<MemoryRouter><Scanner /></MemoryRouter>);
    await userEvent.click(screen.getByRole("button", { name: "Scan now" }));
    await waitFor(() => expect(identifyCapturedFrame).toHaveBeenCalledTimes(1));
    const cacheWrites = vi.mocked(setCachedScanResult).mock.calls.length;
    setActiveAccount("other-user");
    setActiveAccount(finalAccount);
    await act(async () => { resolveScan(makeScanResult("Stale private scan")); });
    expect(getLookups()).toEqual([]);
    expect(vi.mocked(setCachedScanResult).mock.calls).toHaveLength(cacheWrites);
    expect(syncLookupToCloud).not.toHaveBeenCalled();
    expect(screen.queryByText("Stale private scan")).not.toBeInTheDocument();
  }, 10000);

  it("prevents a canceled provider response from saving after cancel", async () => {
    let resolveScan: (value: ReturnType<typeof makeScanResult>) => void = () => undefined;
    identifyCapturedFrame.mockImplementationOnce(() => new Promise((resolve) => {
      resolveScan = resolve;
    }));

    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<Scanner />} />
        </Routes>
      </MemoryRouter>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Scan now" }));
    await userEvent.click(await screen.findByRole("button", { name: "Cancel scan" }));
    await waitFor(() => expect(screen.getByText("Scan canceled. Ready when you are.")).toBeInTheDocument());

    await act(async () => {
      resolveScan(makeScanResult("Stale pump"));
      await Promise.resolve();
    });

    expect(screen.queryByRole("heading", { level: 1, name: "Stale pump" })).not.toBeInTheDocument();
    expect(localStorage.getItem(accountStorageKey("deep-spec:lookups"))).toBeNull();
  }, 10000);

  it("blocks blurry captures with a single quality coach fix before identify", async () => {
    assessImageQuality.mockResolvedValueOnce({
      ok: false,
      issue: "too_blurry",
      message: "Move closer for more detail.",
    });

    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<Scanner />} />
        </Routes>
      </MemoryRouter>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Scan now" }));

    expect(await screen.findByRole("heading", { level: 2, name: "Hold steady" })).toBeInTheDocument();
    expect(screen.getAllByText("A still frame reads sharper.").length).toBeGreaterThan(0);
    expect(screen.queryByText("Try this exact fix, then scan again.")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Prepare one retake" })).toBeInTheDocument();
    const saved = JSON.parse(localStorage.getItem(accountStorageKey("deep-spec:lookups")) ?? "[]");
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ errorCode: "quality_rejected", scanQuality: { accepted: false, failureReason: "too_blurry" } });
    expect(saved[0].frame.imageBase64).toBe("data:image/jpeg;base64,compressed-frame");
    expect(identifyCapturedFrame).not.toHaveBeenCalled();
  }, 10000);

  it("offers one guided retake then preserves a second bad photo as unresolved", async () => {
    assessImageQuality.mockResolvedValue({ ok: false, issue: "too_blurry", message: "Hold steady" });
    render(<MemoryRouter><Scanner /></MemoryRouter>);
    await userEvent.click(screen.getByRole("button", { name: "Scan now" }));
    await userEvent.click(await screen.findByRole("button", { name: "Prepare one retake" }));
    await userEvent.click(screen.getByRole("button", { name: "Scan again" }));
    expect(await screen.findByText("Guided retake used. Review the evidence or start a separate scan when ready.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Prepare one retake" })).not.toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(accountStorageKey("deep-spec:lookups")) ?? "[]")).toHaveLength(2);
    expect(identifyCapturedFrame).not.toHaveBeenCalled();
  });

  it("allows a successful guided retake without confirming identity or replacing the rejected photo", async () => {
    assessImageQuality.mockResolvedValueOnce({ ok: false, issue: "too_dark", message: "Add light" });
    render(<MemoryRouter><Scanner /></MemoryRouter>);
    await userEvent.click(screen.getByRole("button", { name: "Scan now" }));
    await userEvent.click(await screen.findByRole("button", { name: "Prepare one retake" }));
    await userEvent.click(screen.getByRole("button", { name: "Scan again" }));
    expect(await screen.findByText("Identity awaiting review")).toBeInTheDocument();
    const saved = JSON.parse(localStorage.getItem(accountStorageKey("deep-spec:lookups")) ?? "[]");
    expect(saved).toHaveLength(2);
    expect(saved.some((item: { errorCode?: string }) => item.errorCode === "quality_rejected")).toBe(true);
    expect(saved.every((item: { inspection?: unknown }) => !item.inspection)).toBe(true);
  });

  it("offers a guided retake for AI-requested photo evidence", async () => {
    identifyCapturedFrame.mockResolvedValue({ ...makeScanResult("Alternator"), needsBetterPhoto: true });
    render(<MemoryRouter><Scanner /></MemoryRouter>);
    await userEvent.click(screen.getByRole("button", { name: "Scan now" }));
    await userEvent.click(await screen.findByRole("button", { name: "Prepare one retake" }));
    await userEvent.click(screen.getByRole("button", { name: "Scan again" }));
    expect(await screen.findByText("Guided retake used. Review the evidence or start a separate scan when ready.")).toBeInTheDocument();
    expect(identifyCapturedFrame).toHaveBeenCalledTimes(2);
  });
});

function makeObjectTarget(overrides: Partial<NonNullable<typeof objectTargetState.current>>) {
  return {
    confidence: 0.82,
    height: 180,
    holdProgress: 1,
    id: "target-fast",
    isLocked: true,
    left: 80,
    normalized: {
      x: 0.28,
      y: 0.32,
      width: 0.28,
      height: 0.22,
    },
    top: 160,
    width: 240,
    ...overrides,
  };
}

function mockStillImageTarget(
  target: {
    confidence: number;
    height: number;
    width: number;
    x: number;
    y: number;
  } | null,
  size = { height: 600, width: 1000 },
) {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: size.width });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: size.height });
  const imageBase64 = `data:image/jpeg;base64,${"a".repeat(240)}`;
  captureFrame.mockResolvedValue(imageBase64);
  detectObjectTargetFromImageData.mockReturnValue(target);

  class TestImage {
    naturalHeight = size.height;
    naturalWidth = size.width;
    onerror: null | (() => void) = null;
    onload: null | (() => void) = null;

    set src(_value: string) {
      window.setTimeout(() => this.onload?.(), 0);
    }
  }

  vi.stubGlobal("Image", TestImage);
  vi.spyOn(document, "createElement").mockImplementation((tagName, options) => {
    if (tagName.toLowerCase() === "canvas") {
      return {
        getContext: () => ({
          drawImage: vi.fn(),
          getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(4), height: 1, width: 1 })),
        }),
        height: 0,
        width: 0,
      } as unknown as HTMLCanvasElement;
    }

    return createRealElement(tagName, options);
  });
  return imageBase64;
}

function makeScanResult(partName: string) {
  return {
    partName,
    confidence: "high" as const,
    scanCategory: "electrical" as const,
    candidateMatches: [],
    whatItDoes: "It charges the battery while the engine runs.",
    visibleObservations: ["Belt-driven metal housing is visible."],
    evidenceRegions: [],
    concerns: [],
    safetyTriage: "can_help" as const,
    isSafetyCritical: false,
    nextAction: "Compare the scan with another angle if you need more detail.",
    needsBetterPhoto: false,
    evidence: ["The pulley and housing match common alternator shapes."],
    sourceLinks: [],
  };
}
