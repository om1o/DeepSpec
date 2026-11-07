import { accountStorageKey, setActiveAccount, type AccountScope } from "../lib/accountScope";
import { createLookup, getLookups, LOOKUPS_STORAGE_KEY, MAX_SAVED_LOOKUPS } from "../services/storage";
import { photoGroupsMatch, upgradePhotoDraft, type PhotoDraftEnvelope } from "../services/photoDraft";
import type { ComponentCaptureTarget } from "../types/componentMap";
import type { ComparisonCaptureTarget } from "../types/inspectionComparison";
import { getCachedScanResult, hashImageDataUrl, setCachedScanResult } from "../lib/scanCache";
import { createSceneCropFallbacks, type SceneObjectInput } from "../lib/promptableSegmentation";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, expect, vi } from "vitest";
import Scanner from "./Scanner";
import type { Lookup, ScanPhoto, ShopVehicleContext } from "../types";
import { saveVehicleProfile } from "../services/vehicleProfile";
import { createShopJob, getShopJob, getVehicleContextForJob, SHOP_JOBS_STORAGE_KEY, updateShopJob } from "../services/shop";

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
const draftTargets = new Map<string, ComponentCaptureTarget>();
const draftEnvelopes = new Map<string, PhotoDraftEnvelope>();
const observeEnvelopeCompare = vi.fn<(previous: PhotoDraftEnvelope | null, next: PhotoDraftEnvelope | null) => void>();
const readComponentMap = vi.fn();
const linkComponentMap = vi.fn();
const completeComponentCapture = vi.fn();
const readComponentMapLookup = vi.fn();
const completeComparisonCapture = vi.fn();
const verifyComparisonCaptureReference = vi.fn();
const verifyRequestedEvidenceCaptureReference = vi.fn();
const assertRequestedEvidenceCaptureCurrent = vi.fn();
const resolveComparisonSide = vi.fn();
const repeatTarget: ComparisonCaptureTarget = { version: 1, comparisonId: "00000000-0000-4000-8000-000000000011", lookupId: "repeat-scan", subject: "Bracket stain",
  earlier: { lookupId: "earlier-scan", photoId: "earlier-photo", photoLabel: "overview", photoAddedAt: "2026-11-04T00:00:00Z", scanSavedAt: "2026-11-04T00:00:00Z",
    observedOn: null, sha256: "a".repeat(64), width: 640, height: 360, vehicleContext: { model: "Original car", engine: "1.8L" } } };
const requestedTarget: Extract<ComparisonCaptureTarget, { version: 2 }> = { ...repeatTarget, version: 2, analysisSha256: "b".repeat(64),
  requestedEvidence: { version: 1, kind: "marking", request: "Photograph the stamped number beside the lower bolt.", purpose: "A readable marking may distinguish the candidate housings.", photoIds: ["earlier-photo"] } };
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

vi.mock("../services/componentMapStore", () => ({
  readComponentMap: (...args: unknown[]) => readComponentMap(...args),
  linkComponentMap: (...args: unknown[]) => linkComponentMap(...args),
}));
vi.mock("../services/componentMapCloud", () => ({ readComponentMapLookup: (...args: unknown[]) => readComponentMapLookup(...args) }));
vi.mock("../services/componentCaptureCompletion", async (importOriginal) => ({ ...(await importOriginal<typeof import("../services/componentCaptureCompletion")>()),
  completeComponentCapture: (...args: unknown[]) => completeComponentCapture(...args) }));
vi.mock("../services/comparisonCapture", () => ({
  completeComparisonCapture: (...args: unknown[]) => completeComparisonCapture(...args),
  verifyComparisonCaptureReference: (...args: unknown[]) => verifyComparisonCaptureReference(...args),
}));
vi.mock("../services/requestedEvidenceCapture", () => ({
  verifyRequestedEvidenceCaptureReference: (...args: unknown[]) => verifyRequestedEvidenceCaptureReference(...args),
  assertRequestedEvidenceCaptureCurrent: (...args: unknown[]) => assertRequestedEvidenceCaptureCurrent(...args),
}));
vi.mock("../services/comparisonEvidence", () => ({ resolveComparisonSide: (...args: unknown[]) => resolveComparisonSide(...args) }));

vi.mock("../services/photoDraft", async (importOriginal) => {
  const original = await importOriginal<typeof import("../services/photoDraft")>();
  return {
  // Storage normalizes property order; use production evidence equality rather than JSON bytes.
  photoGroupsMatch: original.photoGroupsMatch,
  photoDraftsMatch: original.photoDraftsMatch,
  hasPhotoDraftContext: original.hasPhotoDraftContext,
  hasPhotoDraftComparison: original.hasPhotoDraftComparison,
  upgradePhotoDraft: original.upgradePhotoDraft,
  componentCaptureTargetsMatch: original.componentCaptureTargetsMatch,
  comparisonCaptureTargetsMatch: original.comparisonCaptureTargetsMatch,
  readPhotoDraftEnvelope: async (scope?: AccountScope, kind?: "upload" | "capture") => {
    const photos = await readPhotoDraft(scope, kind);
    const key = draftKey(scope, kind);
    const target = draftTargets.get(key);
    const stored = draftEnvelopes.get(key);
    return photos ? stored ? { ...stored, photos } : { version: 2, photos, ...(target ? { target } : {}) } : null;
  },
  replacePhotoDraftEnvelopeIfMatches: async (previous: PhotoDraftEnvelope | null, next: PhotoDraftEnvelope | null, scope?: AccountScope, kind?: "upload" | "capture", mutationGuard?: () => void) => {
    observeEnvelopeCompare(previous, next);
    const key = draftKey(scope, kind);
    if (!original.componentCaptureTargetsMatch(previous?.target, draftTargets.get(key))) return false;
    const stored = draftEnvelopes.get(key);
    if (previous && stored && !original.photoDraftsMatch(previous, { ...stored, photos: draftStore.get(key) ?? stored.photos })) return false;
    mutationGuard?.();
    const matched = kind === "capture" && previous === null && next
      ? await savePhotoDraftIfEmpty(next.photos, scope, kind)
      : kind === "capture" && previous && next === null
        ? await removePhotoDraftIfMatches(previous.photos, scope, kind)
        : await replacePhotoDraftIfMatches(previous?.photos ?? null, next?.photos ?? null, scope, kind);
    if (matched) {
      if (next?.target) draftTargets.set(key, next.target); else draftTargets.delete(key);
      if (next) draftEnvelopes.set(key, structuredClone(original.upgradePhotoDraft(next))); else draftEnvelopes.delete(key);
    }
    return matched;
  },
  readPhotoDraft: (scope?: AccountScope, kind?: "upload" | "capture") => readPhotoDraft(scope, kind),
  replacePhotoDraftIfMatches: (previous: ScanPhoto[] | null, next: ScanPhoto[] | null, scope?: AccountScope, kind?: "upload" | "capture") => replacePhotoDraftIfMatches(previous, next, scope, kind),
  savePhotoDraftIfEmpty: (photos: ScanPhoto[], scope?: AccountScope, kind?: "upload" | "capture") => savePhotoDraftIfEmpty(photos, scope, kind),
  removePhotoDraftIfMatches: (photos: ScanPhoto[], scope?: AccountScope, kind?: "upload" | "capture") => removePhotoDraftIfMatches(photos, scope, kind),
}; });

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

vi.mock("../lib/promptableSegmentation", async (importOriginal) => ({
  createSceneCropFallbacks: (await importOriginal<typeof import("../lib/promptableSegmentation")>()).createSceneCropFallbacks,
  createPromptedProductIsolation: (...args: unknown[]) => createPromptedProductIsolation(...args),
  isolateSceneObjects: (...args: unknown[]) => isolateSceneObjects(...args),
  isPromptableSegmentationEnabled: () => isPromptableSegmentationEnabled(),
  warmPromptableSegmentation: () => {},
}));

vi.mock("../lib/webgpu", () => ({ supportsWebGpu: () => supportsWebGpu() }));

vi.mock("../lib/objectTargeting", () => ({
  detectObjectTargetFromImageData: (...args: unknown[]) => detectObjectTargetFromImageData(...args),
}));

// Cache misses by default; focused cases below exercise Scanner's input eligibility.
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
    vi.unstubAllEnvs();
    window.history.pushState({}, "", "/");
  });

  beforeEach(() => {
    vi.mocked(hashImageDataUrl).mockReset().mockResolvedValue(null);
    vi.mocked(getCachedScanResult).mockReset().mockReturnValue(null);
    vi.mocked(setCachedScanResult).mockReset();
    draftStore.clear();
    draftTargets.clear();
    draftEnvelopes.clear();
    observeEnvelopeCompare.mockReset();
    readComponentMap.mockReset();
    linkComponentMap.mockReset().mockResolvedValue({});
    // Completion's real hash/CAS boundary is tested in componentCaptureCompletion.test.
    completeComponentCapture.mockReset().mockImplementation((target: ComponentCaptureTarget, saved: Lookup, scope: AccountScope) =>
      linkComponentMap(target, saved.photos?.map((photo) => photo.id) ?? ["photo-1"], scope));
    readComponentMapLookup.mockReset().mockImplementation(async (id: string) => ({ ok: true, value: { id, vehicleContext: { year: "2015", make: "Honda", model: "Civic", engine: "1.8L" } } }));
    completeComparisonCapture.mockReset().mockResolvedValue({});
    verifyComparisonCaptureReference.mockReset().mockResolvedValue(undefined);
    verifyRequestedEvidenceCaptureReference.mockReset().mockResolvedValue({});
    assertRequestedEvidenceCaptureCurrent.mockReset();
    resolveComparisonSide.mockReset().mockResolvedValue({ status: "unchanged", image: "data:image/png;base64,ZWFybGllcg==", message: "Verified original" });
    readPhotoDraft.mockReset();
    readPhotoDraft.mockImplementation(async (scope, kind) => structuredClone(draftStore.get(draftKey(scope, kind)) ?? null));
    savePhotoDraft.mockReset();
    savePhotoDraft.mockImplementation(async (photos, scope, kind) => { draftStore.set(draftKey(scope, kind), structuredClone(photos)); });
    removePhotoDraft.mockReset();
    removePhotoDraft.mockImplementation(async (scope, kind) => { draftStore.delete(draftKey(scope, kind)); });
    replacePhotoDraftIfMatches.mockReset();
    replacePhotoDraftIfMatches.mockImplementation(async (previous, next, scope, kind) => {
      const current = draftStore.get(draftKey(scope, kind)) ?? null;
      if (current === null ? previous !== null : previous === null || !photoGroupsMatch(current, previous)) return false;
      if (next === null) await removePhotoDraft(scope, kind);
      else if (previous === null || !photoGroupsMatch(previous, next)) await savePhotoDraft(next, scope, kind);
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
      const current = draftStore.get(key);
      if (!current || !photoGroupsMatch(current, photos)) return false;
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

  it("matches normalized photo fields regardless of property order without accepting changed evidence", () => {
    const captured: ScanPhoto = { id: "photo-1", label: "overview", imageBase64: "data:image/jpeg;base64,original", capturedAt: "2026-11-05T00:00:00Z" };
    const normalized: ScanPhoto = { id: captured.id, label: captured.label, capturedAt: captured.capturedAt, imageBase64: captured.imageBase64 };
    expect(JSON.stringify(captured)).not.toBe(JSON.stringify(normalized));
    expect(photoGroupsMatch([captured], [normalized])).toBe(true);
    for (const changed of [
      { ...normalized, id: "other-photo" },
      { ...normalized, label: "marking" as const },
      { ...normalized, capturedAt: "2026-11-05T00:00:01Z" },
      { ...normalized, imageBase64: "data:image/jpeg;base64,replacement" },
    ]) expect(photoGroupsMatch([captured], [changed])).toBe(false);
    expect(photoGroupsMatch([captured], [normalized, { ...normalized, id: "photo-2" }])).toBe(false);
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
    const focusBox = { x: 0.2, y: 0.2, width: 0.3, height: 0.3, confidence: 0.9 };
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
    if (stage === "scene") {
      expect(getLookups()[0].isolatedObjects).toMatchObject([
        { name: "Alternator", primary: true, focusMode: "mask" },
        { name: "Wrench", primary: false, focusMode: "crop", isolatedImageBase64: "" },
      ]);
      expect(screen.getByRole("button", { name: "Select Wrench" })).toBeInTheDocument();
    }
    const snapshot = JSON.stringify(getLookups());
    await act(async () => { settle(stage === "debug GPU" ? true : stage === "scene" ? [{ ...cutout, name: "Late object" }] : cutout); await pending; });
    expect(JSON.stringify(getLookups())).toBe(snapshot);
    expect(screen.queryByRole("button", { name: "Select Late object" })).not.toBeInTheDocument();
    vi.unstubAllEnvs();
  }, 10000);

  it("keeps the complete scene when the primary mask and on-device segmentation are unavailable", async () => {
    const originalImage = mockStillImageTarget({ confidence: 0.9, x: 0.2, y: 0.2, width: 0.3, height: 0.3 });
    isPromptableSegmentationEnabled.mockReturnValue(false);
    isolateSceneObjects.mockImplementation(async (_frame: unknown, inputs: SceneObjectInput[]) => createSceneCropFallbacks(inputs));
    identifyCapturedFrame.mockResolvedValueOnce({ ...makeScanResult("Alternator"), sceneObjects: [
      { name: "Wrench", category: "tools", regionLabel: "right", confidence: "high" },
      { name: "Reservoir", category: "engine", regionLabel: "left", confidence: "medium" },
    ] });
    render(<MemoryRouter><Scanner /></MemoryRouter>);
    await userEvent.click(screen.getByRole("button", { name: "Scan now" }));
    await screen.findByRole("button", { name: "Select Wrench" });
    expect(screen.getByRole("button", { name: "Select Reservoir" })).toBeInTheDocument();
    expect(isolateSceneObjects).toHaveBeenCalledTimes(1);
    expect(getLookups()[0].isolatedObjects).toHaveLength(3);
    expect(getLookups()[0].isolatedObjects?.every((object) => object.focusMode === "crop" && object.isolatedImageBase64 === "")).toBe(true);
    expect(getLookups()[0].frame.imageBase64).toBe(originalImage);
    expect(identifyCapturedFrame).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["fresh", 1], ["fresh", 2], ["fresh", 4], ["cached", 1], ["cached", 4],
  ] as const)("retains %s secondary selections without a primary outline (%i objects)", async (source, count) => {
    const originalImage = mockStillImageTarget(null);
    const objects = [
      { name: "Reservoir", category: "engine", regionLabel: "left", primary: false },
      { name: "Wrench", category: "tools", regionLabel: "right", primary: false },
      { name: "Hose", category: "engine", regionLabel: "upper left", primary: false },
      { name: "Connector", category: "electrical", regionLabel: "lower right", primary: false },
    ].slice(0, count);
    const result = { ...makeScanResult("Alternator"), sceneObjects: objects };
    isolateSceneObjects.mockImplementation(async (_frame: unknown, inputs: SceneObjectInput[]) => createSceneCropFallbacks(inputs));
    if (source === "cached") {
      assessImageQuality.mockResolvedValueOnce(passingQuality).mockResolvedValueOnce({ ok: false });
      vi.mocked(hashImageDataUrl).mockResolvedValue("original-only-cache-key");
      vi.mocked(getCachedScanResult).mockReturnValue(result);
    } else identifyCapturedFrame.mockResolvedValueOnce(result);

    render(<MemoryRouter><Scanner /></MemoryRouter>);
    await userEvent.click(screen.getByRole("button", { name: "Scan now" }));
    await waitFor(() => expect(getLookups()).toHaveLength(1));
    const saved = getLookups()[0];
    expect(saved.focusBox).toBeUndefined();
    expect(saved.isolatedObjects).toHaveLength(count);
    expect(saved.isolatedObjects?.map((object) => object.name)).toEqual(objects.map((object) => object.name));
    expect(saved.isolatedObjects?.every((object) => !object.primary && object.focusMode === "crop" && object.isolatedImageBase64 === "")).toBe(true);
    expect(saved.frame.imageBase64).toBe(originalImage);
    expect(saved.result).toMatchObject({ partName: result.partName, sceneObjects: objects });
    for (const object of objects) expect(screen.getByRole("button", { name: `Select ${object.name}` })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Select Alternator" })).not.toBeInTheDocument();
    expect(identifyCapturedFrame).toHaveBeenCalledTimes(source === "cached" ? 0 : 1);
    expect(isolateSceneObjects).toHaveBeenCalledTimes(source === "cached" ? 0 : 1);

    await userEvent.click(screen.getByRole("button", { name: "Select Reservoir" }));
    await userEvent.click(screen.getByRole("button", { name: "Correct area" }));
    fireEvent.change(screen.getByRole("slider", { name: "Selection x" }), { target: { value: "40" } });
    await userEvent.click(screen.getByRole("button", { name: "Apply area" }));
    const reopened = getLookups()[0];
    expect(reopened.isolatedObjects?.[0]).toMatchObject({ name: "Reservoir", primary: false, focusBox: { x: 0.4, confidence: 0 }, focusMode: "crop" });
    expect(reopened.isolatedObjects?.slice(1)).toEqual(saved.isolatedObjects?.slice(1));
    expect(reopened.focusBox).toBeUndefined();
    expect(reopened.frame.imageBase64).toBe(originalImage);
    expect(reopened.result).toEqual(saved.result);
    expect(identifyCapturedFrame).toHaveBeenCalledTimes(source === "cached" ? 0 : 1);
  });

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
    expect(identifyCapturedFrame).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("button", { name: "Analyze selected area" }));
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
    await userEvent.click(screen.getByRole("button", { name: "Analyze selected area" }));
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
    const vehicle = { model: "Civic", engine: "1.8L" };
    expect(saveVehicleProfile(vehicle).ok).toBe(true);
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
    expect(createFocusedScanCrop).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Analyze selected area" }));
    expect(createFocusedScanCrop).toHaveBeenCalledExactlyOnceWith(originalImage, correctedBox);
    expect(identifyCapturedFrame).toHaveBeenCalledTimes(1);
    await act(async () => {
      if (outcome === "account changed") setActiveAccount("other-user");
      finishCrop(outcome === "unavailable" ? null : "data:image/jpeg;base64,corrected-crop");
    });
    if (outcome === "available") {
      await waitFor(() => expect(identifyCapturedFrame).toHaveBeenCalledTimes(2));
      expect(identifyCapturedFrame.mock.calls[1][0]).toMatchObject({ imageBase64: "data:image/jpeg;base64,corrected-crop" });
      expect(identifyCapturedFrame.mock.calls[1][3]).toMatchObject({ vehicleContext: vehicle });
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
    await userEvent.click(screen.getByRole("button", { name: "Analyze selected area" }));
    await userEvent.click(screen.getByRole("button", { name: "Correct area" }));
    fireEvent.change(screen.getByRole("slider", { name: "Selection x" }), { target: { value: "40" } });
    await userEvent.click(screen.getByRole("button", { name: "Apply area" }));
    await act(async () => finishOld(makeScanResult("Stale selection")));
    expect(screen.getByTestId("focused-object-card")).not.toHaveTextContent("Stale selection");
    createFocusedScanCrop.mockClear();
    await userEvent.click(screen.getByTestId("focused-object-back"));
    await userEvent.click(screen.getByRole("button", { name: "Select Wrench" }));
    expect(identifyCapturedFrame).toHaveBeenCalledTimes(2);
    await userEvent.click(screen.getByRole("button", { name: "Analyze selected area" }));
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
    expect(savedLookups[0].photos).toEqual([
      expect.objectContaining({ id: "photo-1", label: "overview", imageBase64: savedLookups[0].frame.imageBase64 }),
      expect.objectContaining({ id: "photo-2", label: "close_up", imageBase64: "data:image/jpeg;base64,target-crop" }),
    ]);
    await userEvent.click(screen.getByRole("button", { name: "2. Close-up" }));
    expect(screen.getByAltText("Reviewed scan photo")).toHaveAttribute("src", "data:image/jpeg;base64,target-crop");
    expect(screen.getByTestId("focused-part-overlay")).toHaveAttribute("data-focus-mode", "full_frame");
    expect(screen.queryByTestId("isolated-part-image")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "1. Overview" }));
    expect(screen.getByTestId("isolated-part-image")).toHaveAttribute("src", "data:image/png;base64,segmented-product");
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
    expect(screen.queryByTestId("focused-part-window")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Original", exact: true })).toHaveAttribute("aria-pressed", "true");
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

  it("durably retains both camera frames sent to identify with stable IDs for saved review and chat", async () => {
    vi.mocked(hashImageDataUrl).mockResolvedValueOnce("two-frame-original");
    const priorCacheWrites = vi.mocked(setCachedScanResult).mock.calls.length;
    captureFrame
      .mockResolvedValueOnce("data:image/jpeg;base64,primary-frame")
      .mockResolvedValueOnce("data:image/jpeg;base64,second-frame");
    let evidenceAtIdentify: ScanPhoto[] | undefined;
    identifyCapturedFrame.mockImplementationOnce(async () => {
      evidenceAtIdentify = structuredClone(draftStore.get("test-user:capture"));
      return makeScanResult("Alternator");
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
    expect(identifyCapturedFrame.mock.calls[0][0]).toMatchObject({
      imageBase64: "data:image/jpeg;base64,primary-frame",
    });
    expect(identifyCapturedFrame.mock.calls[0][1]).toMatchObject({
      imageBase64: "data:image/jpeg;base64,second-frame",
    });
    await screen.findByRole("heading", { level: 3, name: "Alternator" });
    const saved = getLookups()[0];
    expect(saved.photos).toEqual([
      { id: "photo-1", label: "overview", ...identifyCapturedFrame.mock.calls[0][0] },
      { id: "photo-2", label: "other", ...identifyCapturedFrame.mock.calls[0][1] },
    ]);
    expect(evidenceAtIdentify).toEqual(saved.photos);
    expect(saved.frame).toEqual(identifyCapturedFrame.mock.calls[0][0]);
    await waitFor(() => expect(draftStore.has("test-user:capture")).toBe(false));
    expect(removePhotoDraftIfMatches).toHaveBeenCalledWith(saved.photos, expect.objectContaining({ userId: "test-user" }), "capture");
    expect(vi.mocked(setCachedScanResult).mock.calls).toHaveLength(priorCacheWrites);
    expect(screen.getByRole("link", { name: "Ask DeepSpec" })).toHaveAttribute("href", `/result/${saved.id}/chat`);
    await userEvent.click(screen.getByRole("button", { name: "2. Other angle" }));
    expect(screen.getByAltText("Reviewed scan photo")).toHaveAttribute("src", "data:image/jpeg;base64,second-frame");
    await userEvent.click(screen.getByRole("button", { name: "1. Overview" }));
    expect(screen.getByAltText("Reviewed scan photo")).toHaveAttribute("src", "data:image/jpeg;base64,primary-frame");
    expect(getLookups()[0].photos).toEqual(saved.photos);
  }, 10000);

  it.each(["second camera frame", "focused crop"])("does not let a first-photo cache hit skip an accepted %s", async (extraInput) => {
    if (extraInput === "focused crop") {
      mockStillImageTarget({ confidence: 0.9, x: 0.2, y: 0.2, width: 0.3, height: 0.3 });
    } else {
      captureFrame.mockResolvedValueOnce("data:image/jpeg;base64,primary").mockResolvedValueOnce("data:image/jpeg;base64,secondary");
    }
    vi.mocked(hashImageDataUrl).mockResolvedValue("same-original");
    vi.mocked(getCachedScanResult).mockReturnValue(makeScanResult("Old first-photo result"));
    render(<MemoryRouter><Scanner /></MemoryRouter>);
    await userEvent.click(screen.getByRole("button", { name: "Scan now" }));
    await screen.findByRole("heading", { level: 3, name: "Alternator" });
    expect(identifyCapturedFrame).toHaveBeenCalledTimes(1);
    expect(identifyCapturedFrame.mock.calls[0][1]).toMatchObject({
      imageBase64: extraInput === "focused crop" ? "data:image/jpeg;base64,target-crop" : "data:image/jpeg;base64,secondary",
    });
    expect(getCachedScanResult).not.toHaveBeenCalled();
    expect(setCachedScanResult).not.toHaveBeenCalled();
    expect(getLookups()[0].photos).toHaveLength(2);
    expect(getLookups()[0].provenance?.analysisSource).toBe("ai_detection");
  });

  it("checks a current single-photo cache only after an optional second capture is rejected", async () => {
    captureFrame.mockResolvedValueOnce("data:image/jpeg;base64,primary").mockResolvedValueOnce("data:image/jpeg;base64,rejected");
    assessImageQuality.mockResolvedValueOnce(passingQuality).mockResolvedValueOnce({ ok: false });
    vi.mocked(hashImageDataUrl).mockResolvedValue("same-original");
    vi.mocked(getCachedScanResult).mockReturnValue(makeScanResult("Current single-photo result"));
    render(<MemoryRouter><Scanner /></MemoryRouter>);
    await userEvent.click(screen.getByRole("button", { name: "Scan now" }));
    await screen.findByRole("heading", { level: 3, name: "Current single-photo result" });
    expect(captureFrame).toHaveBeenCalledTimes(2);
    expect(getCachedScanResult).toHaveBeenCalledWith("same-original");
    expect(identifyCapturedFrame).not.toHaveBeenCalled();
    expect(getLookups()[0].photos).toEqual([
      expect.objectContaining({ id: "photo-1", imageBase64: "data:image/jpeg;base64,primary" }),
    ]);
    expect(getLookups()[0].provenance?.analysisSource).toBe("cached_match");
    await waitFor(() => expect(draftStore.has("test-user:capture")).toBe(false));
  });

  it("retains both accepted frames in a failed analysis so retry has the same evidence", async () => {
    captureFrame.mockResolvedValueOnce("data:image/jpeg;base64,primary").mockResolvedValueOnce("data:image/jpeg;base64,secondary");
    identifyCapturedFrame.mockRejectedValueOnce(new Error("Provider jammed"));
    render(<MemoryRouter><Scanner /></MemoryRouter>);
    await userEvent.click(screen.getByRole("button", { name: "Scan now" }));
    await screen.findByRole("heading", { level: 3, name: "Item captured" });
    expect(getLookups()[0]).toMatchObject({
      errorCode: "analysis_failed",
      photos: [
        { id: "photo-1", label: "overview", imageBase64: "data:image/jpeg;base64,primary" },
        { id: "photo-2", label: "other", imageBase64: "data:image/jpeg;base64,secondary" },
      ],
    });
    await waitFor(() => expect(draftStore.has("test-user:capture")).toBe(false));
  });

  it("omits a rejected second frame from both the provider request and saved evidence", async () => {
    captureFrame.mockResolvedValueOnce("data:image/jpeg;base64,primary").mockResolvedValueOnce("data:image/jpeg;base64,rejected");
    assessImageQuality.mockResolvedValueOnce(passingQuality).mockResolvedValueOnce({ ok: false });
    render(<MemoryRouter><Scanner /></MemoryRouter>);
    await userEvent.click(screen.getByRole("button", { name: "Scan now" }));
    await screen.findByRole("heading", { level: 3, name: "Alternator" });
    expect(identifyCapturedFrame.mock.calls[0][1]).toBeUndefined();
    expect(getLookups()[0].photos).toEqual([
      { id: "photo-1", label: "overview", ...identifyCapturedFrame.mock.calls[0][0] },
    ]);
    expect(screen.queryByRole("button", { name: "2. Other angle" })).not.toBeInTheDocument();
  });

  it("stops before provider work when accepted camera evidence cannot be saved", async () => {
    replacePhotoDraftIfMatches.mockRejectedValueOnce(new Error("Could not retain the second photo. Retry saving before analysis."));
    render(<MemoryRouter><Scanner /></MemoryRouter>);
    await userEvent.click(screen.getByRole("button", { name: "Scan now" }));
    expect(await screen.findByText("Could not retain the second photo. Retry saving before analysis.")).toBeInTheDocument();
    expect(identifyCapturedFrame).not.toHaveBeenCalled();
    expect(getLookups()).toHaveLength(0);
    expect(draftStore.get("test-user:capture")).toEqual(savePhotoDraftIfEmpty.mock.calls[0][0]);
  });

  it("preserves another tab's newer capture while preparing the accepted second frame", async () => {
    const newer: ScanPhoto = { id: "other-tab", label: "marking", capturedAt: "2026-11-05T00:00:00Z", imageBase64: "data:image/jpeg;base64,newer" };
    captureFrame.mockResolvedValueOnce("data:image/jpeg;base64,primary").mockImplementationOnce(async () => {
      draftStore.set("test-user:capture", [newer]);
      return "data:image/jpeg;base64,secondary";
    });
    render(<MemoryRouter><Scanner /></MemoryRouter>);
    await userEvent.click(screen.getByRole("button", { name: "Scan now" }));
    expect(await screen.findByText("Saved capture changed in another tab. Review its current photos before analysis.")).toBeInTheDocument();
    expect(within(screen.getByRole("dialog", { name: "Review inspection photos" })).getByText("Saved capture changed in another tab. Review its current photos before analysis.")).toHaveAttribute("role", "status");
    expect(draftStore.get("test-user:capture")).toEqual([newer]);
    expect(screen.getByRole("img", { name: "Photo 1: Label or marking" })).toHaveAttribute("src", newer.imageBase64);
    expect(identifyCapturedFrame).not.toHaveBeenCalled();
    expect(getLookups()).toHaveLength(0);
  });

  it("keeps all four reviewed photos authoritative even when an isolation crop is available", async () => {
    const original = mockStillImageTarget({ confidence: 0.9, x: 0.2, y: 0.2, width: 0.3, height: 0.3 });
    const photos: ScanPhoto[] = ["overview", "close_up", "marking", "mounting"].map((label, index) => ({
      id: `reviewed-${index}`, label: label as ScanPhoto["label"], capturedAt: "2026-11-05T00:00:00Z",
      imageBase64: index ? `data:image/jpeg;base64,${"b".repeat(240 + index)}` : original,
    }));
    draftStore.set("test-user:upload", photos);
    render(<MemoryRouter><Scanner /></MemoryRouter>);
    await userEvent.click(await screen.findByRole("button", { name: "Resume 4-photo draft" }));
    await analyzeReviewedPhotos();
    await screen.findByRole("heading", { level: 3, name: "Alternator" });
    expect(createFocusedScanCrop).toHaveBeenCalled();
    expect(identifyCapturedFrame.mock.calls[0][3]).toMatchObject({ photos });
    expect(getLookups()[0].photos).toEqual(photos);
    expect(getLookups()[0].frame.imageBase64).toBe(original);
    expect(captureFrame).not.toHaveBeenCalled();
    expect(draftStore.get("test-user:upload")).toEqual(photos);
  });

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
    await act(async () => {
      draftStore.set("test-user:capture", structuredClone(savePhotoDraftIfEmpty.mock.calls[0][0]));
      finishSave(true);
    });
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
    expect(savePhotoDraft.mock.calls.every((call) => call[2] === "capture")).toBe(true);
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
    expect(pending).toEqual([
      { id: "photo-1", label: "overview", ...identifyCapturedFrame.mock.calls[0][0] },
      { id: "photo-2", label: "other", ...identifyCapturedFrame.mock.calls[0][1] },
    ]);
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
    expect(removePhotoDraftIfMatches).toHaveBeenCalledWith(getLookups()[0].photos, expect.objectContaining({ userId: "test-user" }), "capture");
    expect(removePhotoDraft).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "2. Other angle" }));
    await userEvent.click(screen.getByRole("button", { name: "Close result card" }));
    await userEvent.click(screen.getByRole("button", { name: "Scan now" }));
    await waitFor(() => expect(savePhotoDraftIfEmpty).toHaveBeenCalledTimes(2));
    await screen.findByRole("heading", { level: 3, name: "Alternator" });
    expect(getLookups()).toHaveLength(2);
    expect(screen.getByRole("button", { name: "1. Overview" })).toHaveAttribute("aria-pressed", "true");
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
    await waitFor(() => expect(observeEnvelopeCompare).toHaveBeenCalledWith(expect.objectContaining({ version: 6, photos: getLookups()[0].photos }), null));
    expect(getLookups()[0].photos?.[0].imageBase64).not.toBe(newer.imageBase64);
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

  it("rejects analysis when another tab changes only the saved photo relationship", async () => {
    const photos: ScanPhoto[] = [
      { id: "one", label: "overview", imageBase64: "data:image/jpeg;base64,b25l", capturedAt: "2026-11-05T00:00:00Z" },
      { id: "two", label: "other", imageBase64: "data:image/jpeg;base64,dHdv", capturedAt: "2026-11-05T00:00:01Z" },
    ];
    const draft: PhotoDraftEnvelope = { version: 6, photos, vehicleContext: null, photoRelationship: "same_part_or_area" };
    draftStore.set("test-user:upload", photos); draftEnvelopes.set("test-user:upload", draft);
    render(<MemoryRouter><Scanner /></MemoryRouter>);
    await userEvent.click(await screen.findByRole("button", { name: "Resume 2-photo draft" }));
    const newer: PhotoDraftEnvelope = { ...draft, photoRelationship: "independent" };
    draftEnvelopes.set("test-user:upload", newer);
    await analyzeReviewedPhotos();
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Photo relationship" })).toHaveValue("independent"));
    expect(identifyCapturedFrame).not.toHaveBeenCalled();
    expect(draftEnvelopes.get("test-user:upload")).toEqual(newer);
    expect(draftStore.get("test-user:upload")).toEqual(photos);
  });

  it("keeps a relationship through relabeling but clears it when a photo is removed or added", async () => {
    const photos: ScanPhoto[] = [1, 2, 3].map((number) => ({ id: `existing-${number}`, label: "overview", imageBase64: `data:image/jpeg;base64,${btoa(`original-${number}`)}`, capturedAt: "2026-11-05T00:00:00Z" }));
    draftStore.set("test-user:upload", photos);
    draftEnvelopes.set("test-user:upload", { version: 6, photos, vehicleContext: null, photoRelationship: "same_part_or_area" });
    render(<MemoryRouter><Scanner /></MemoryRouter>);
    await userEvent.click(await screen.findByRole("button", { name: "Resume 3-photo draft" }));
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Photo 2 view" }), "marking");
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Photo relationship" })).toBeEnabled());
    expect(draftEnvelopes.get("test-user:upload")?.photoRelationship).toBe("same_part_or_area");
    await userEvent.click(screen.getByRole("button", { name: "Remove photo 3" }));
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Photo relationship" })).toHaveValue("unknown"));
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Photo relationship" }), "independent");
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Photo relationship" })).toBeEnabled());
    await userEvent.upload(screen.getByLabelText("Upload photo"), new File(["different example"], "third.jpg", { type: "image/jpeg" }));
    await screen.findByRole("button", { name: "Analyze 3 photos" });
    expect(draftEnvelopes.get("test-user:upload")?.photoRelationship).toBe("unknown");
    expect(draftStore.get("test-user:upload")?.slice(0, 2).map((photo) => photo.imageBase64)).toEqual(photos.slice(0, 2).map((photo) => photo.imageBase64));
    expect(identifyCapturedFrame).not.toHaveBeenCalled();
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
    expect(screen.getByRole("combobox", { name: "Photo relationship" })).toHaveValue("unknown");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Photo relationship" }), "independent");
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Photo 2 view" })).toBeEnabled());
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
    expect(identifyCapturedFrame.mock.calls[0][3]).toMatchObject({ photos: reviewed, photoRelationship: "independent" });
    expect(identifyCapturedFrame.mock.calls[0][0]).toMatchObject({ imageBase64: reviewed[0].imageBase64 });
    await screen.findByRole("heading", { level: 3, name: "Alternator" });
    expect(getLookups()[0].photoRelationship).toBe("independent");
    expect(getLookups()[0].photos).toEqual(reviewed);
  }, 10000);

  it("keeps the requested marking guide through capture, chooser cancellation, close and reload before explicit analysis", async () => {
    render(<MemoryRouter initialEntries={[{ pathname: "/scan", state: { accountId: "test-user", comparisonCaptureTarget: requestedTarget } }]}><Scanner /></MemoryRouter>);
    expect(screen.getByRole("region", { name: "AI-suggested next photo" })).toHaveTextContent(requestedTarget.requestedEvidence.request);
    expect(screen.getByText(requestedTarget.requestedEvidence.purpose)).toBeInTheDocument();
    expect(await screen.findByRole("img", { name: "Earlier reference original: Bracket stain" })).toHaveAttribute("src", "data:image/png;base64,ZWFybGllcg==");
    expect(screen.getByText("Use this earlier photo to locate the requested area. Follow the photo request above.")).toBeInTheDocument();
    expect(screen.queryByText(/Match the earlier framing/)).not.toBeInTheDocument();
    expect(screen.getAllByText(/Only your new photos will be analyzed/)).toHaveLength(1);
    await userEvent.click(screen.getByRole("button", { name: "Scan now" }));
    await screen.findByRole("dialog", { name: "Review inspection photos" });
    expect(draftEnvelopes.get("test-user:capture")).toMatchObject({ version: 8, comparisonTarget: requestedTarget });
    expect(verifyRequestedEvidenceCaptureReference).not.toHaveBeenCalled();
    expect(identifyCapturedFrame).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Upload photo"), { target: { files: [] } });
    expect(screen.getByText(requestedTarget.requestedEvidence.request)).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Photo 1 view" }), "marking");
    await userEvent.click(screen.getByRole("button", { name: "Keep draft and close" }));
    const retained = structuredClone(draftEnvelopes.get("test-user:capture"));
    cleanup();
    render(<MemoryRouter><Scanner /></MemoryRouter>);
    await userEvent.click(await screen.findByRole("button", { name: "Resume captured photo" }));
    expect(screen.getByText(requestedTarget.requestedEvidence.request)).toBeInTheDocument();
    expect(screen.getByText(requestedTarget.requestedEvidence.purpose)).toBeInTheDocument();
    expect(screen.getByText(/Collecting a photo does not mean the request has been resolved/)).toBeInTheDocument();
    expect(screen.queryByText(/Match the earlier framing/)).not.toBeInTheDocument();
    expect(draftEnvelopes.get("test-user:capture")).toEqual(retained);
    expect(identifyCapturedFrame).not.toHaveBeenCalled();
    await analyzeReviewedPhotos();
    await waitFor(() => expect(draftStore.has("test-user:capture")).toBe(false));
    const saved = getLookups().find((lookup) => lookup.id === requestedTarget.lookupId)!;
    expect(saved.photos).toEqual(retained!.photos);
    expect(saved.photos![0].label).toBe("marking");
    expect(identifyCapturedFrame).toHaveBeenCalledTimes(1);
    expect(identifyCapturedFrame.mock.calls[0][3]).toMatchObject({ photos: retained!.photos });
    expect(JSON.stringify(identifyCapturedFrame.mock.calls)).not.toContain("ZWFybGllcg==");
    expect(completeComparisonCapture).toHaveBeenCalledWith(requestedTarget, expect.objectContaining({ id: requestedTarget.lookupId }), expect.objectContaining({ userId: "test-user" }), expect.any(AbortSignal), expect.any(Function));
    expect(assertRequestedEvidenceCaptureCurrent).toHaveBeenCalled();
  });

  it("keeps newly uploaded requested photos when the origin is stale instead of losing them during capture", async () => {
    verifyRequestedEvidenceCaptureReference.mockRejectedValue(new Error("The original answer changed. New photos were kept."));
    render(<MemoryRouter initialEntries={[{ pathname: "/scan", state: { accountId: "test-user", comparisonCaptureTarget: requestedTarget } }]}><Scanner /></MemoryRouter>);
    await userEvent.upload(screen.getByLabelText("Upload photo"), new File(["new marking"], "marking.jpg", { type: "image/jpeg" }));
    await screen.findByRole("dialog", { name: "Review inspection photos" });
    const retained = structuredClone(draftEnvelopes.get("test-user:upload"));
    expect(retained).toMatchObject({ version: 8, comparisonTarget: requestedTarget });
    expect(verifyRequestedEvidenceCaptureReference).not.toHaveBeenCalled();
    expect(identifyCapturedFrame).not.toHaveBeenCalled();
    await analyzeReviewedPhotos();
    expect(await within(screen.getByRole("dialog")).findByText("The original answer changed. New photos were kept.")).toBeInTheDocument();
    expect(draftEnvelopes.get("test-user:upload")).toEqual(retained);
    expect(screen.getByText(requestedTarget.requestedEvidence.request)).toBeInTheDocument();
    expect(identifyCapturedFrame).not.toHaveBeenCalled();
    expect(completeComparisonCapture).not.toHaveBeenCalled();
  });

  it("keeps the requested guide visible and does not analyze after a device draft save failure", async () => {
    savePhotoDraftIfEmpty.mockRejectedValueOnce(new Error("Device storage could not save this photo. Retry capture."));
    render(<MemoryRouter initialEntries={[{ pathname: "/scan", state: { accountId: "test-user", comparisonCaptureTarget: requestedTarget } }]}><Scanner /></MemoryRouter>);
    await userEvent.click(screen.getByRole("button", { name: "Scan now" }));
    expect(await screen.findByText("Device storage could not save this photo. Retry capture.")).toBeInTheDocument();
    expect(screen.getByText(requestedTarget.requestedEvidence.request)).toBeInTheDocument();
    expect(screen.getByText(requestedTarget.requestedEvidence.purpose)).toBeInTheDocument();
    expect(draftStore.size).toBe(0);
    expect(identifyCapturedFrame).not.toHaveBeenCalled();
    expect(completeComparisonCapture).not.toHaveBeenCalled();
  });

  it.each(["quality check", "visual preparation"])("rechecks the requested source after %s before a provider call", async (phase) => {
    const photos: ScanPhoto[] = [{ id: "follow-up", label: "marking", capturedAt: "2026-11-05T00:00:00Z", imageBase64: "data:image/jpeg;base64,cGFydA==" }];
    const envelope: PhotoDraftEnvelope = { version: 8, photos, comparisonTarget: requestedTarget, vehicleContext: requestedTarget.earlier.vehicleContext, photoRelationship: "unknown" };
    draftStore.set("test-user:capture", photos); draftEnvelopes.set("test-user:capture", envelope);
    if (phase === "visual preparation") assertRequestedEvidenceCaptureCurrent.mockImplementationOnce(() => undefined);
    assertRequestedEvidenceCaptureCurrent.mockImplementationOnce(() => { throw new Error("The requested evidence source changed; draft kept."); });
    render(<MemoryRouter><Scanner /></MemoryRouter>);
    await userEvent.click(await screen.findByRole("button", { name: "Resume captured photo" }));
    await analyzeReviewedPhotos();
    await waitFor(() => expect(screen.getByRole("dialog")).toHaveTextContent("The requested evidence source changed; draft kept."));
    expect(identifyCapturedFrame).not.toHaveBeenCalled();
    expect(getLookups()).toEqual([]);
    expect(draftEnvelopes.get("test-user:capture")).toEqual(envelope);
  });

  it.each(["cancellation", "account change"])("keeps a guided draft after %s during origin verification", async (reason) => {
    const photos: ScanPhoto[] = [{ id: "follow-up", label: "marking", capturedAt: "2026-11-05T00:00:00Z", imageBase64: "data:image/jpeg;base64,cGFydA==" }];
    const envelope: PhotoDraftEnvelope = { version: 8, photos, comparisonTarget: requestedTarget, vehicleContext: requestedTarget.earlier.vehicleContext, photoRelationship: "unknown" };
    draftStore.set("test-user:upload", photos); draftEnvelopes.set("test-user:upload", envelope);
    let finish!: (guard: object) => void;
    verifyRequestedEvidenceCaptureReference.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    render(<MemoryRouter><Scanner /></MemoryRouter>);
    await userEvent.click(await screen.findByRole("button", { name: "Resume 1-photo draft" }));
    await analyzeReviewedPhotos();
    await waitFor(() => expect(verifyRequestedEvidenceCaptureReference).toHaveBeenCalledTimes(1));
    if (reason === "cancellation") await userEvent.click(screen.getByRole("button", { name: "Cancel scan" }));
    else setActiveAccount("other-user");
    await act(async () => finish({}));
    expect(identifyCapturedFrame).not.toHaveBeenCalled();
    expect(completeComparisonCapture).not.toHaveBeenCalled();
    expect(draftEnvelopes.get("test-user:upload")).toEqual(envelope);
    expect(draftStore.has("other-user:upload")).toBe(false);
  });

  it("retains the exact guide on saved-analysis completion failure and resumes without another AI call", async () => {
    const photos: ScanPhoto[] = [{ id: "follow-up", label: "marking", capturedAt: "2026-11-05T00:00:00Z", imageBase64: "data:image/jpeg;base64,cGFydA==" }];
    const envelope: PhotoDraftEnvelope = { version: 8, photos, comparisonTarget: requestedTarget, vehicleContext: requestedTarget.earlier.vehicleContext, photoRelationship: "unknown" };
    draftStore.set("test-user:upload", photos); draftEnvelopes.set("test-user:upload", envelope);
    identifyCapturedFrame.mockRejectedValueOnce(new Error("Provider unavailable"));
    completeComparisonCapture.mockRejectedValueOnce(new Error("Comparison save failed; pending photos retained."));
    render(<MemoryRouter><Scanner /></MemoryRouter>);
    await userEvent.click(await screen.findByRole("button", { name: "Resume 1-photo draft" }));
    await analyzeReviewedPhotos();
    await screen.findByRole("button", { name: "Finish dated comparison" });
    expect(screen.getByText(requestedTarget.requestedEvidence.request)).toBeInTheDocument();
    expect(screen.getByText("Comparison save failed; pending photos retained.")).toBeInTheDocument();
    const saved = structuredClone(getLookups());
    expect(saved[0].result).toBeUndefined(); expect(saved[0].errorMessage).toBeTruthy();
    cleanup();
    render(<MemoryRouter><Scanner /></MemoryRouter>);
    await userEvent.click(await screen.findByRole("button", { name: "Resume 1-photo draft" }));
    expect(draftEnvelopes.get("test-user:upload")).toEqual(envelope);
    await userEvent.click(screen.getByRole("button", { name: "Finish dated comparison" }));
    await waitFor(() => expect(draftStore.has("test-user:upload")).toBe(false));
    expect(identifyCapturedFrame).toHaveBeenCalledTimes(1);
    expect(getLookups()).toEqual(saved);
  });

  it("does not retire a newer guide attached to identical photos after completing the older request", async () => {
    const photos: ScanPhoto[] = [{ id: "follow-up", label: "marking", capturedAt: "2026-11-05T00:00:00Z", imageBase64: "data:image/jpeg;base64,cGFydA==" }];
    const envelope: PhotoDraftEnvelope = { version: 8, photos, comparisonTarget: requestedTarget, vehicleContext: requestedTarget.earlier.vehicleContext, photoRelationship: "unknown" };
    const newer: PhotoDraftEnvelope = { ...envelope, comparisonTarget: { ...requestedTarget, requestedEvidence: { ...requestedTarget.requestedEvidence, request: "Photograph the upper marking instead." } } };
    draftStore.set("test-user:upload", photos); draftEnvelopes.set("test-user:upload", envelope);
    completeComparisonCapture.mockImplementationOnce(async () => { draftEnvelopes.set("test-user:upload", newer); return {}; });
    render(<MemoryRouter><Scanner /></MemoryRouter>);
    await userEvent.click(await screen.findByRole("button", { name: "Resume 1-photo draft" }));
    await analyzeReviewedPhotos();
    await waitFor(() => expect(completeComparisonCapture).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(verifyRequestedEvidenceCaptureReference).toHaveBeenCalledTimes(2));
    expect(draftEnvelopes.get("test-user:upload")).toEqual(newer);
    expect(draftStore.get("test-user:upload")).toEqual(photos);
    expect(removePhotoDraft).not.toHaveBeenCalled();
  });

  it("keeps the saved follow-up and pending guide if the original changes at the retirement boundary", async () => {
    const photos: ScanPhoto[] = [{ id: "follow-up", label: "marking", capturedAt: "2026-11-05T00:00:00Z", imageBase64: "data:image/jpeg;base64,cGFydA==" }];
    const envelope: PhotoDraftEnvelope = { version: 8, photos, comparisonTarget: requestedTarget, vehicleContext: requestedTarget.earlier.vehicleContext, photoRelationship: "unknown" };
    draftStore.set("test-user:capture", photos); draftEnvelopes.set("test-user:capture", envelope);
    completeComparisonCapture.mockImplementationOnce(async () => {
      assertRequestedEvidenceCaptureCurrent.mockImplementation(() => { throw new Error("The original changed before completion; pending draft retained."); });
      return {};
    });
    render(<MemoryRouter><Scanner /></MemoryRouter>);
    await userEvent.click(await screen.findByRole("button", { name: "Resume captured photo" }));
    await analyzeReviewedPhotos();
    await screen.findByRole("button", { name: "Finish dated comparison" });
    expect(screen.getByText("The original changed before completion; pending draft retained.")).toBeInTheDocument();
    expect(screen.getByText(requestedTarget.requestedEvidence.request)).toBeInTheDocument();
    expect(draftEnvelopes.get("test-user:capture")).toEqual(envelope);
    expect(getLookups()[0].photos).toEqual(photos);
    expect(identifyCapturedFrame).toHaveBeenCalledTimes(1);
    expect(removePhotoDraftIfMatches).not.toHaveBeenCalled();
  });

  it("keeps the repeat reference separate, freezes its vehicle and saves only newly reviewed photos", async () => {
    expect(saveVehicleProfile({ model: "Different current profile" }).ok).toBe(true);
    render(<MemoryRouter initialEntries={[{ pathname: "/scan", state: { accountId: "test-user", comparisonCaptureTarget: repeatTarget } }]}><Scanner /></MemoryRouter>);
    expect(await screen.findByRole("img", { name: "Earlier reference original: Bracket stain" })).toHaveAttribute("src", "data:image/png;base64,ZWFybGllcg==");
    expect(screen.getByText(/Match the earlier framing/)).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "AI-suggested next photo" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Scan now" }));
    const review = await screen.findByRole("dialog", { name: "Review inspection photos" });
    expect(within(review).getByTestId("comparison-capture-reference")).toBeInTheDocument();
    expect(draftEnvelopes.get("test-user:capture")).toMatchObject({ version: 7, comparisonTarget: repeatTarget, vehicleContext: repeatTarget.earlier.vehicleContext });
    expect(identifyCapturedFrame).not.toHaveBeenCalled();
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Photo 1 view" }), "close_up");
    await analyzeReviewedPhotos();
    await waitFor(() => expect(completeComparisonCapture).toHaveBeenCalledTimes(1));
    const saved = getLookups().find((lookup) => lookup.id === repeatTarget.lookupId)!;
    expect(saved.vehicleContext).toEqual(repeatTarget.earlier.vehicleContext);
    expect(saved.photos).toHaveLength(1);
    expect(saved.photos![0]).toMatchObject({ imageBase64: "data:image/jpeg;base64,compressed-frame", label: "close_up" });
    expect(identifyCapturedFrame.mock.calls[0][3]).toMatchObject({ photos: saved.photos, vehicleContext: repeatTarget.earlier.vehicleContext });
    expect(JSON.stringify(identifyCapturedFrame.mock.calls)).not.toContain("ZWFybGllcg==");
    await waitFor(() => expect(draftStore.has("test-user:capture")).toBe(false));
  });

  it("resumes a comparison after a saved AI failure without another provider call or changed AI status", async () => {
    const photos: ScanPhoto[] = [{ id: "follow-up", label: "overview", capturedAt: "2026-11-05T00:00:00Z", imageBase64: "data:image/jpeg;base64,cGFydA==" }];
    const envelope: PhotoDraftEnvelope = { version: 4, photos, comparisonTarget: repeatTarget, vehicleContext: repeatTarget.earlier.vehicleContext };
    draftStore.set("test-user:upload", photos); draftEnvelopes.set("test-user:upload", envelope);
    identifyCapturedFrame.mockRejectedValueOnce(new Error("Provider unavailable"));
    completeComparisonCapture.mockRejectedValueOnce(new Error("Comparison storage was interrupted."));
    render(<MemoryRouter><Scanner /></MemoryRouter>);
    await userEvent.click(await screen.findByRole("button", { name: "Resume 1-photo draft" }));
    await analyzeReviewedPhotos();
    await screen.findByRole("button", { name: "Finish dated comparison" });
    expect(screen.getByText("Comparison storage was interrupted.")).toBeInTheDocument();
    const savedBefore = getLookups().find((lookup) => lookup.id === repeatTarget.lookupId)!;
    expect(savedBefore.errorMessage).toBeTruthy(); expect(savedBefore.result).toBeUndefined();
    expect(identifyCapturedFrame).toHaveBeenCalledTimes(1);
    expect(draftEnvelopes.get("test-user:upload")).toEqual(upgradePhotoDraft(envelope));
    cleanup();
    render(<MemoryRouter><Scanner /></MemoryRouter>);
    await userEvent.click(await screen.findByRole("button", { name: "Resume 1-photo draft" }));
    await userEvent.click(screen.getByRole("button", { name: "Finish dated comparison" }));
    await waitFor(() => expect(draftStore.has("test-user:upload")).toBe(false));
    expect(identifyCapturedFrame).toHaveBeenCalledTimes(1);
    expect(completeComparisonCapture).toHaveBeenCalledTimes(2);
    expect(getLookups()).toEqual([savedBefore]);
  });

  it("keeps a repeat draft and avoids provider work when the earlier original changed", async () => {
    const photos: ScanPhoto[] = [{ id: "follow-up", label: "overview", capturedAt: "2026-11-05T00:00:00Z", imageBase64: "data:image/jpeg;base64,cGFydA==" }];
    const envelope: PhotoDraftEnvelope = { version: 4, photos, comparisonTarget: repeatTarget, vehicleContext: repeatTarget.earlier.vehicleContext };
    draftStore.set("test-user:upload", photos); draftEnvelopes.set("test-user:upload", envelope);
    verifyComparisonCaptureReference.mockRejectedValueOnce(new Error("The earlier original changed; draft kept."));
    render(<MemoryRouter><Scanner /></MemoryRouter>);
    await userEvent.click(await screen.findByRole("button", { name: "Resume 1-photo draft" }));
    await analyzeReviewedPhotos();
    expect(await within(screen.getByRole("dialog")).findByText("The earlier original changed; draft kept.")).toBeInTheDocument();
    expect(identifyCapturedFrame).not.toHaveBeenCalled(); expect(completeComparisonCapture).not.toHaveBeenCalled();
    expect(draftEnvelopes.get("test-user:upload")).toEqual(upgradePhotoDraft(envelope));
  });

  it("does not overwrite an occupied repeat-capture ID with different evidence", async () => {
    const photos: ScanPhoto[] = [{ id: "follow-up", label: "overview", capturedAt: "2026-11-05T00:00:00Z", imageBase64: "data:image/jpeg;base64,cGFydA==" }];
    const envelope: PhotoDraftEnvelope = { version: 4, photos, comparisonTarget: repeatTarget, vehicleContext: repeatTarget.earlier.vehicleContext };
    draftStore.set("test-user:upload", photos); draftEnvelopes.set("test-user:upload", envelope);
    const other = { ...photos[0], imageBase64: "data:image/jpeg;base64,b3RoZXI=" };
    const existing = createLookup({ frame: other, photos: [other], vehicleContext: repeatTarget.earlier.vehicleContext! }, repeatTarget.lookupId);
    expect(existing.ok).toBe(true);
    render(<MemoryRouter><Scanner /></MemoryRouter>);
    await userEvent.click(await screen.findByRole("button", { name: "Resume 1-photo draft" }));
    await userEvent.click(screen.getByRole("button", { name: "Finish dated comparison" }));
    expect(await within(screen.getByRole("dialog")).findByText(/This draft differs from its saved scan/)).toBeInTheDocument();
    expect(identifyCapturedFrame).not.toHaveBeenCalled(); expect(completeComparisonCapture).not.toHaveBeenCalled();
    expect(getLookups()[0].photos).toEqual([other]); expect(draftEnvelopes.get("test-user:upload")).toEqual(upgradePhotoDraft(envelope));
  });

  it("keeps a newer comparison target when an older completed analysis tries to retire identical photo bytes", async () => {
    const photos: ScanPhoto[] = [{ id: "follow-up", label: "overview", capturedAt: "2026-11-05T00:00:00Z", imageBase64: "data:image/jpeg;base64,cGFydA==" }];
    const envelope: PhotoDraftEnvelope = { version: 4, photos, comparisonTarget: repeatTarget, vehicleContext: repeatTarget.earlier.vehicleContext };
    const newer: PhotoDraftEnvelope = { ...envelope, version: 7, photoRelationship: "unknown", comparisonTarget: { ...repeatTarget, comparisonId: "00000000-0000-4000-8000-000000000012", lookupId: "newer-follow-up" } };
    draftStore.set("test-user:upload", photos); draftEnvelopes.set("test-user:upload", envelope);
    completeComparisonCapture.mockImplementationOnce(async () => { draftEnvelopes.set("test-user:upload", newer); return {}; });
    render(<MemoryRouter><Scanner /></MemoryRouter>);
    await userEvent.click(await screen.findByRole("button", { name: "Resume 1-photo draft" }));
    await analyzeReviewedPhotos();
    await waitFor(() => expect(completeComparisonCapture).toHaveBeenCalledTimes(1));
    expect(draftEnvelopes.get("test-user:upload")).toEqual(newer); expect(draftStore.get("test-user:upload")).toEqual(photos);
  });

  it.each(["foreign account", "conflicting reserved IDs"])("rejects repeat route state with %s before capture", async (reason) => {
    const componentCaptureTarget = reason === "conflicting reserved IDs" ? { mapId: "bay", componentId: "00000000-0000-4000-8000-000000000001", linkAttemptId: "00000000-0000-4000-8000-000000000002", lookupId: "different-scan" } : undefined;
    render(<MemoryRouter initialEntries={[{ pathname: "/scan", state: { accountId: reason === "foreign account" ? "other-user" : "test-user", comparisonCaptureTarget: repeatTarget, componentCaptureTarget } }]}><Scanner /></MemoryRouter>);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Scan now" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Scan now" })).toBeEnabled());
    expect(captureFrame).not.toHaveBeenCalled(); expect(identifyCapturedFrame).not.toHaveBeenCalled(); expect(draftStore.size).toBe(0);
  });

  it("stops a resumed comparison if the account changes during earlier-reference verification", async () => {
    const photos: ScanPhoto[] = [{ id: "follow-up", label: "overview", capturedAt: "2026-11-05T00:00:00Z", imageBase64: "data:image/jpeg;base64,cGFydA==" }];
    const envelope: PhotoDraftEnvelope = { version: 4, photos, comparisonTarget: repeatTarget, vehicleContext: repeatTarget.earlier.vehicleContext };
    draftStore.set("test-user:upload", photos); draftEnvelopes.set("test-user:upload", envelope);
    verifyComparisonCaptureReference.mockImplementationOnce(async () => { setActiveAccount("other-user"); });
    render(<MemoryRouter><Scanner /></MemoryRouter>);
    await userEvent.click(await screen.findByRole("button", { name: "Resume 1-photo draft" }));
    await analyzeReviewedPhotos();
    expect(identifyCapturedFrame).not.toHaveBeenCalled(); expect(completeComparisonCapture).not.toHaveBeenCalled();
    expect(draftEnvelopes.get("test-user:upload")).toEqual(upgradePhotoDraft(envelope));
  });

  it("saves a component target with its camera photos and waits for reviewed angles before analysis", async () => {
    const target: ComponentCaptureTarget = { mapId: "bay-overview", componentId: "00000000-0000-4000-8000-000000000001", linkAttemptId: "00000000-0000-4000-8000-000000000002", lookupId: "component-scan" };
    readComponentMap.mockResolvedValue({ document: { components: [{ id: target.componentId }] } });
    render(<MemoryRouter initialEntries={[{ pathname: "/scan", state: { accountId: "test-user", componentCaptureTarget: target } }]}><Scanner /></MemoryRouter>);
    await userEvent.click(screen.getByRole("button", { name: "Scan now" }));
    await screen.findByRole("dialog", { name: "Review inspection photos" });
    expect(draftTargets.get("test-user:capture")).toEqual(target);
    expect(draftEnvelopes.get("test-user:capture")).toMatchObject({ version: 6, vehicleContext: { model: "Civic", engine: "1.8L" } });
    expect(identifyCapturedFrame).not.toHaveBeenCalled();
    // A later overview edit must not relabel photographs already captured for it.
    readComponentMapLookup.mockResolvedValue({ ok: true, value: { id: "bay-overview", vehicleContext: { model: "Accord", engine: "2.4L" } } });
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Photo 1 view" }), "close_up");
    await analyzeReviewedPhotos();
    await waitFor(() => expect(linkComponentMap).toHaveBeenCalledWith(target, ["photo-1"], expect.objectContaining({ userId: "test-user" })));
    expect(getLookups().find((lookup) => lookup.id === target.lookupId)?.photos?.[0].label).toBe("close_up");
    expect(getLookups().find((lookup) => lookup.id === target.lookupId)?.vehicleContext).toMatchObject({ year: "2015", make: "Honda", model: "Civic", engine: "1.8L" });
    await waitFor(() => expect(draftStore.has("test-user:capture")).toBe(false));
  });

  it("freezes selected vehicle details before camera analysis and bypasses the image-only cache", async () => {
    const vehicle: ShopVehicleContext = { year: "2015", make: "Honda", model: "Civic", mileage: "120000", mileageUnit: "mi", modifications: { status: "none_known" }, confirmedFields: { model: { value: "Civic", confirmedAt: "2026-11-05T00:00:00Z" } } };
    expect(saveVehicleProfile(vehicle).ok).toBe(true);
    assessImageQuality.mockResolvedValueOnce(passingQuality).mockResolvedValueOnce({ ok: false, issue: "too_blurry", message: "blur" });
    vi.mocked(hashImageDataUrl).mockResolvedValue("same-photo");
    vi.mocked(getCachedScanResult).mockReturnValue(makeScanResult("Wrong vehicle cached result"));
    let contextBeforeProvider: PhotoDraftEnvelope | undefined;
    identifyCapturedFrame.mockImplementationOnce(async () => { contextBeforeProvider = structuredClone(draftEnvelopes.get("test-user:capture")); return makeScanResult("Alternator"); });
    render(<MemoryRouter><Scanner /></MemoryRouter>);
    await userEvent.click(screen.getByRole("button", { name: "Scan now" }));
    await screen.findByRole("heading", { level: 3, name: "Alternator" });
    expect(contextBeforeProvider).toMatchObject({ version: 6, vehicleContext: vehicle });
    expect(identifyCapturedFrame.mock.calls[0][3]).toMatchObject({ vehicleContext: vehicle });
    expect(getLookups()[0].vehicleContext).toEqual(vehicle);
    expect(getCachedScanResult).not.toHaveBeenCalled();
    expect(setCachedScanResult).not.toHaveBeenCalled();
  });

  it.each(["saved snapshot", "legacy"])("resumes a %s draft without assigning the newly selected car", async (kind) => {
    const photos: ScanPhoto[] = [{ id: "pending", label: "overview", capturedAt: "2026-11-05T00:00:00Z", imageBase64: "data:image/jpeg;base64,cGFydA==" }];
    draftStore.set("test-user:upload", photos);
    if (kind === "saved snapshot") draftEnvelopes.set("test-user:upload", { version: 3, photos, vehicleContext: { model: "Original car", engine: "1.8L" } });
    expect(saveVehicleProfile({ model: "Newly selected car" }).ok).toBe(true);
    render(<MemoryRouter><Scanner /></MemoryRouter>);
    await userEvent.click(await screen.findByRole("button", { name: "Resume 1-photo draft" }));
    await analyzeReviewedPhotos();
    await screen.findByRole("heading", { level: 3, name: "Alternator" });
    const expected = kind === "saved snapshot" ? { model: "Original car", engine: "1.8L" } : undefined;
    expect(identifyCapturedFrame.mock.calls[0][3].vehicleContext).toEqual(expected);
    expect(getLookups()[0].vehicleContext).toEqual(expected);
  });

  it("keeps a resumed draft on its original job and builds its report from frozen car details", async () => {
    const originalJob = createShopJob({ title: "Original intake", technicianName: "Tester", year: "2015", make: "Honda", model: "Civic", engine: "1.8L", symptom: "Rattle when cold" }).value!;
    const snapshot = getVehicleContextForJob(originalJob);
    const photos: ScanPhoto[] = [{ id: "pending", label: "overview", capturedAt: "2026-11-05T00:00:00Z", imageBase64: "data:image/jpeg;base64,cGFydA==" }];
    draftStore.set("test-user:upload", photos);
    draftEnvelopes.set("test-user:upload", { version: 3, photos, vehicleContext: snapshot, jobId: originalJob.id });
    expect(updateShopJob(originalJob.id, { model: "Changed job car" }).ok).toBe(true);
    const currentJob = createShopJob({ title: "Other intake", technicianName: "Tester", year: "2020", make: "Toyota", model: "Corolla", symptom: "Other complaint" }).value!;
    render(<MemoryRouter initialEntries={[`/scan?jobId=${currentJob.id}`]}><Scanner /></MemoryRouter>);
    await userEvent.click(await screen.findByRole("button", { name: "Resume 1-photo draft" }));
    await analyzeReviewedPhotos();
    await screen.findByRole("heading", { level: 3, name: "Alternator" });
    const saved = getLookups()[0];
    expect(saved).toMatchObject({ jobId: originalJob.id, vehicleContext: snapshot });
    expect(saved.customerVisibleReport?.summary).toContain("2015 Honda Civic: Rattle when cold");
    expect(saved.customerVisibleReport?.summary).not.toContain("Changed job car");
    expect(getShopJob(originalJob.id)?.scanIds).toContain(saved.id);
    expect(getShopJob(currentJob.id)?.scanIds).not.toContain(saved.id);
  });

  it.each(["requested", "comparison", "component"])("keeps %s capture membership through reload under another job", async (kind) => {
    const originalJob = createShopJob({ title: "Original intake", technicianName: "Tester", year: "2015", make: "Honda", model: "Original car", symptom: "Rattle" }).value!;
    const otherJob = createShopJob({ title: "Unrelated intake", technicianName: "Tester", year: "2020", make: "Toyota", model: "Other car", symptom: "Other complaint" }).value!;
    const sourceId = repeatTarget.earlier.lookupId;
    const source = createLookup({ frame: { imageBase64: "data:image/jpeg;base64,b3JpZ2luYWw=", capturedAt: "2026-11-04T00:00:00Z" },
      jobId: originalJob.id, orgId: originalJob.orgId, vehicleContext: { model: "Original car" } }, sourceId).value!;
    readComponentMapLookup.mockImplementation(async (id: string) => ({ ok: true, value: getLookups().find((lookup) => lookup.id === id) ?? null }));
    const target = { mapId: sourceId, componentId: "00000000-0000-4000-8000-000000000001", linkAttemptId: "00000000-0000-4000-8000-000000000002", lookupId: "component-scan" };
    readComponentMap.mockResolvedValue({ document: { components: [{ id: target.componentId }] } });
    // A cited secondary photo has no car facts; job membership must not invent any.
    const comparison = kind === "requested" ? { ...requestedTarget, earlier: { ...requestedTarget.earlier, vehicleContext: null } } : repeatTarget;
    const state = { accountId: "test-user", ...(kind === "component" ? { componentCaptureTarget: target } : { comparisonCaptureTarget: comparison }) };
    render(<MemoryRouter initialEntries={[{ pathname: "/scan", search: `?jobId=${otherJob.id}`, state }]}><Scanner /></MemoryRouter>);
    await userEvent.click(screen.getByRole("button", { name: "Scan now" }));
    await screen.findByRole("dialog", { name: "Review inspection photos" });
    const retained = structuredClone(draftEnvelopes.get("test-user:capture"));
    expect(retained).toMatchObject({ jobId: originalJob.id, vehicleContext: kind === "requested" ? null : kind === "component" ? source.vehicleContext : repeatTarget.earlier.vehicleContext });
    cleanup();
    render(<MemoryRouter initialEntries={[`/scan?jobId=${otherJob.id}`]}><Scanner /></MemoryRouter>);
    await userEvent.click(await screen.findByRole("button", { name: "Resume captured photo" }));
    await analyzeReviewedPhotos();
    await waitFor(() => expect(draftStore.has("test-user:capture")).toBe(false));
    const saved = getLookups().find((lookup) => lookup.id === (kind === "component" ? target.lookupId : comparison.lookupId))!;
    expect(saved).toMatchObject({ jobId: originalJob.id, orgId: originalJob.orgId });
    expect(saved.vehicleContext).toEqual(kind === "requested" ? undefined : retained && "vehicleContext" in retained ? retained.vehicleContext : undefined);
    expect(getShopJob(originalJob.id)?.scanIds).toContain(saved.id);
    expect(getShopJob(otherJob.id)?.scanIds).not.toContain(saved.id);
    expect(identifyCapturedFrame).toHaveBeenCalledTimes(1);
  });

  it.each(["requested", "component"].flatMap((kind) => ["reassigned", "removed", "missing source", "missing job", "unreadable jobs"].map((change) => [kind, change])))("keeps %s photos pending when source membership is %s", async (kind, change) => {
    const job = createShopJob({ title: "Original intake", technicianName: "Tester", year: "2015", make: "Honda", model: "Civic", symptom: "Rattle" }).value!;
    const source = createLookup({ frame: { imageBase64: "data:image/jpeg;base64,b3JpZ2luYWw=", capturedAt: "2026-11-04T00:00:00Z" }, jobId: job.id, orgId: job.orgId }, repeatTarget.earlier.lookupId).value!;
    const photos: ScanPhoto[] = [{ id: "new-photo", label: "marking", imageBase64: "data:image/jpeg;base64,bmV3", capturedAt: "2026-11-05T00:00:00Z" }];
    const componentTarget = { mapId: source.id, componentId: "00000000-0000-4000-8000-000000000001", linkAttemptId: "00000000-0000-4000-8000-000000000002", lookupId: requestedTarget.lookupId };
    const envelope: PhotoDraftEnvelope = { ...(kind === "component" ? { version: 6, target: componentTarget } : { version: 8, comparisonTarget: requestedTarget }), photos, vehicleContext: requestedTarget.earlier.vehicleContext, jobId: job.id, photoRelationship: "unknown" };
    draftStore.set("test-user:capture", photos); draftEnvelopes.set("test-user:capture", envelope);
    if (kind === "component") draftTargets.set("test-user:capture", componentTarget);
    readComponentMap.mockResolvedValue({ document: { components: [{ id: componentTarget.componentId }] } });
    if (change === "reassigned" || change === "removed") localStorage.setItem(accountStorageKey(LOOKUPS_STORAGE_KEY), JSON.stringify([{ ...source, jobId: change === "reassigned" ? "another-job" : undefined }]));
    if (change === "missing source") localStorage.setItem(accountStorageKey(LOOKUPS_STORAGE_KEY), "[]");
    if (change === "missing job" || change === "unreadable jobs") localStorage.setItem(accountStorageKey(SHOP_JOBS_STORAGE_KEY), change === "missing job" ? "[]" : "broken");
    readComponentMapLookup.mockImplementation(async (id: string) => ({ ok: true, value: getLookups().find((lookup) => lookup.id === id) ?? null }));
    render(<MemoryRouter><Scanner /></MemoryRouter>);
    await userEvent.click(await screen.findByRole("button", { name: "Resume captured photo" }));
    await analyzeReviewedPhotos();
    await waitFor(() => expect(screen.getByRole("dialog")).toHaveTextContent(/membership|unavailable|could not be read/i));
    expect(identifyCapturedFrame).not.toHaveBeenCalled();
    expect(completeComparisonCapture).not.toHaveBeenCalled();
    expect(completeComponentCapture).not.toHaveBeenCalled();
    expect(draftEnvelopes.get("test-user:capture")).toEqual(envelope);
    expect(getLookups().some((lookup) => lookup.id === requestedTarget.lookupId)).toBe(false);
  });

  it.each(["requested", "component"].flatMap((kind) => ["quality", "provider", "provider failure", "completion", "draft retirement"].map((phase) => [kind, phase])))("rechecks %s membership after asynchronous %s work", async (kind, phase) => {
    const job = createShopJob({ title: "Original intake", technicianName: "Tester", year: "2015", make: "Honda", model: "Civic", symptom: "Rattle" }).value!;
    const source = createLookup({ frame: { imageBase64: "data:image/jpeg;base64,b3JpZ2luYWw=", capturedAt: "2026-11-04T00:00:00Z" }, jobId: job.id, orgId: job.orgId }, repeatTarget.earlier.lookupId).value!;
    const photos: ScanPhoto[] = [{ id: "new-photo", label: "marking", imageBase64: "data:image/jpeg;base64,bmV3", capturedAt: "2026-11-05T00:00:00Z" }];
    const componentTarget = { mapId: source.id, componentId: "00000000-0000-4000-8000-000000000001", linkAttemptId: "00000000-0000-4000-8000-000000000002", lookupId: requestedTarget.lookupId };
    const envelope: PhotoDraftEnvelope = { ...(kind === "component" ? { version: 6, target: componentTarget } : { version: 8, comparisonTarget: requestedTarget }), photos, vehicleContext: requestedTarget.earlier.vehicleContext, jobId: job.id, photoRelationship: "unknown" };
    draftStore.set("test-user:capture", photos); draftEnvelopes.set("test-user:capture", envelope);
    if (kind === "component") draftTargets.set("test-user:capture", componentTarget);
    readComponentMap.mockResolvedValue({ document: { components: [{ id: componentTarget.componentId }] } });
    const reassign = () => localStorage.setItem(accountStorageKey(LOOKUPS_STORAGE_KEY), JSON.stringify(getLookups().map((lookup) => lookup.id === source.id ? { ...lookup, jobId: "another-job" } : lookup)));
    if (phase === "quality") assessImageQuality.mockImplementationOnce(async () => { reassign(); return passingQuality; });
    if (phase === "provider" || phase === "provider failure") identifyCapturedFrame.mockImplementationOnce(async () => { reassign(); if (phase === "provider failure") throw new Error("Provider failed"); return makeScanResult("Alternator"); });
    if (phase === "completion") (kind === "component" ? completeComponentCapture : completeComparisonCapture).mockImplementationOnce(async (_target, _saved, _scope, _signal, assertCurrent: () => void) => { reassign(); assertCurrent(); return {}; });
    if (phase === "draft retirement") observeEnvelopeCompare.mockImplementationOnce(() => {}).mockImplementationOnce((_previous, next) => { if (next === null) reassign(); });
    render(<MemoryRouter><Scanner /></MemoryRouter>);
    await userEvent.click(await screen.findByRole("button", { name: "Resume captured photo" }));
    await analyzeReviewedPhotos();
    await waitFor(() => expect(screen.getByRole("dialog")).toHaveTextContent("job membership changed"));
    expect(draftEnvelopes.get("test-user:capture")).toEqual(envelope);
    expect(identifyCapturedFrame).toHaveBeenCalledTimes(phase === "quality" ? 0 : 1);
    const saved = getLookups().find((lookup) => lookup.id === requestedTarget.lookupId);
    if (phase === "completion" || phase === "draft retirement") {
      expect(saved?.jobId).toBe(job.id);
      await userEvent.click(screen.getByRole("button", { name: kind === "component" ? "Finish component link" : "Finish dated comparison" }));
      await waitFor(() => expect(screen.getByRole("dialog")).toHaveTextContent("job membership changed"));
      expect(identifyCapturedFrame).toHaveBeenCalledTimes(1);
      expect(draftEnvelopes.get("test-user:capture")).toEqual(envelope);
    } else expect(saved).toBeUndefined();
  });

  it("keeps an unassigned targeted capture unassigned under an unrelated job route", async () => {
    const job = createShopJob({ title: "Unrelated intake", technicianName: "Tester", year: "2015", make: "Honda", model: "Civic", symptom: "Rattle" }).value!;
    createLookup({ frame: { imageBase64: "data:image/jpeg;base64,b3JpZ2luYWw=", capturedAt: "2026-11-04T00:00:00Z" } }, repeatTarget.earlier.lookupId);
    render(<MemoryRouter initialEntries={[{ pathname: "/scan", search: `?jobId=${job.id}`, state: { accountId: "test-user", comparisonCaptureTarget: requestedTarget } }]}><Scanner /></MemoryRouter>);
    await userEvent.upload(screen.getByLabelText("Upload photo"), new File(["new marking"], "marking.jpg", { type: "image/jpeg" }));
    await screen.findByRole("dialog", { name: "Review inspection photos" });
    expect(draftEnvelopes.get("test-user:upload")).not.toHaveProperty("jobId");
    await analyzeReviewedPhotos();
    await waitFor(() => expect(draftStore.has("test-user:upload")).toBe(false));
    const saved = getLookups().find((lookup) => lookup.id === requestedTarget.lookupId)!;
    expect(saved.jobId).toBeUndefined(); expect(saved.orgId).toBeUndefined();
    expect(getShopJob(job.id)?.scanIds).not.toContain(saved.id);
  });

  it("does not append a chosen angle after another tab replaces the reviewed vehicle draft", async () => {
    const photos: ScanPhoto[] = [{ id: "same", label: "overview", capturedAt: "2026-11-05T00:00:00Z", imageBase64: "data:image/jpeg;base64,cGFydA==" }];
    draftStore.set("test-user:upload", photos);
    draftEnvelopes.set("test-user:upload", { version: 3, photos, vehicleContext: { model: "Car A" } });
    render(<MemoryRouter><Scanner /></MemoryRouter>);
    await userEvent.click(await screen.findByRole("button", { name: "Resume 1-photo draft" }));
    const replacement: PhotoDraftEnvelope = { version: 3, photos, vehicleContext: { model: "Car B" }, jobId: "other-job" };
    draftEnvelopes.set("test-user:upload", replacement);
    await userEvent.upload(screen.getByLabelText("Upload photo"), new File(["angle of A"], "angle.jpg", { type: "image/jpeg" }));
    await screen.findByText("Saved photos changed in another tab. Your change was not applied. Review the current draft before continuing.");
    expect(draftEnvelopes.get("test-user:upload")).toEqual(replacement);
    expect(draftStore.get("test-user:upload")).toEqual(photos);
    expect(savePhotoDraft).not.toHaveBeenCalled();
    expect(identifyCapturedFrame).not.toHaveBeenCalled();
  });

  it("does not reuse an abandoned retake's car after saving a new selected car", async () => {
    expect(saveVehicleProfile({ model: "Car A" }).ok).toBe(true);
    assessImageQuality.mockResolvedValueOnce({ ok: false, issue: "too_blurry", message: "blur" });
    let finishCanceled!: (result: ReturnType<typeof makeScanResult>) => void;
    identifyCapturedFrame.mockImplementationOnce(() => new Promise((resolve) => { finishCanceled = resolve; }));
    render(<MemoryRouter><Scanner /></MemoryRouter>);
    await userEvent.click(screen.getByRole("button", { name: "Scan now" }));
    await userEvent.click(await screen.findByRole("button", { name: "Prepare one retake" }));
    await userEvent.click(screen.getByRole("button", { name: "Scan now" }));
    await waitFor(() => expect(identifyCapturedFrame).toHaveBeenCalledTimes(1));
    await userEvent.click(screen.getByRole("button", { name: "Cancel scan" }));
    await act(async () => finishCanceled(makeScanResult("Canceled")));
    await userEvent.click(await screen.findByRole("button", { name: "Resume captured photo" }));
    await userEvent.click(screen.getByRole("button", { name: "Discard draft" }));
    await userEvent.click(screen.getByRole("button", { name: "Car details" }));
    await userEvent.clear(screen.getByRole("textbox", { name: "Model", exact: true }));
    await userEvent.type(screen.getByRole("textbox", { name: "Model", exact: true }), "Car B");
    await userEvent.click(screen.getByRole("button", { name: "Use these details for new photos" }));
    await userEvent.click(screen.getByRole("button", { name: "Scan now" }));
    await screen.findByRole("heading", { level: 3, name: "Alternator" });
    expect(identifyCapturedFrame.mock.calls.at(-1)![3]).toMatchObject({ vehicleContext: { model: "Car B" } });
    expect(getLookups()[0].vehicleContext?.model).toBe("Car B");
    expect(getLookups().some((lookup) => lookup.vehicleContext?.model === "Car A")).toBe(true);
  }, 10000);

  it.each(["true", "false"])("recovers a saved component link with cloud sync %s without another analysis", async (cloudEnabled) => {
    vi.stubEnv("VITE_ENABLE_CLOUD_SYNC", cloudEnabled);
    const target: ComponentCaptureTarget = { mapId: "bay-overview", componentId: "00000000-0000-4000-8000-000000000001", linkAttemptId: "00000000-0000-4000-8000-000000000002", lookupId: "component-scan" };
    const photos: ScanPhoto[] = [{ id: "close-up", label: "close_up", capturedAt: "2026-11-05T00:00:00Z", imageBase64: "data:image/jpeg;base64,cGFydA==" }];
    draftStore.set("test-user:upload", photos);
    draftTargets.set("test-user:upload", target);
    readComponentMap.mockResolvedValue({ document: { components: [{ id: target.componentId }] } });
    linkComponentMap.mockRejectedValueOnce(new Error("Component map storage was interrupted."));
    render(<MemoryRouter><Scanner /></MemoryRouter>);
    await userEvent.click(await screen.findByRole("button", { name: "Resume 1-photo draft" }));
    await analyzeReviewedPhotos();
    await screen.findByRole("button", { name: "Finish component link" });
    expect(getLookups().find((lookup) => lookup.id === target.lookupId)?.photos).toEqual(photos);
    expect(draftTargets.get("test-user:upload")).toEqual(target);
    expect(identifyCapturedFrame).toHaveBeenCalledTimes(1);
    cleanup();
    render(<MemoryRouter><Scanner /></MemoryRouter>);
    await userEvent.click(await screen.findByRole("button", { name: "Resume 1-photo draft" }));
    // Keep this exact draft visible for one retirement conflict so its recovery
    // message can be reviewed before retrying the already committed link.
    const compareAndSwap = replacePhotoDraftIfMatches.getMockImplementation()!;
    replacePhotoDraftIfMatches.mockImplementation(async (...args) => args[1] === null ? false : compareAndSwap(...args));
    await userEvent.click(screen.getByRole("button", { name: "Finish component link" }));
    const expectedMessage = cloudEnabled === "true"
      ? "Photos linked to the component on this device. Save the map to cloud from its overview."
      : "Photos linked to the component on this device. Cloud sync is off; reopen the map overview to review them.";
    expect(await screen.findByText(expectedMessage)).toBeInTheDocument();
    if (cloudEnabled === "false") expect(screen.queryByText(/Save the map to cloud from its overview/)).not.toBeInTheDocument();
    expect(draftStore.has("test-user:upload")).toBe(true);
    replacePhotoDraftIfMatches.mockImplementation(compareAndSwap);
    await userEvent.click(screen.getByRole("button", { name: "Finish component link" }));
    await waitFor(() => expect(draftStore.has("test-user:upload")).toBe(false));
    expect(identifyCapturedFrame).toHaveBeenCalledTimes(1);
    expect(linkComponentMap).toHaveBeenCalledTimes(3);
    expect(getLookups()).toHaveLength(1);
  });

  it.each(["source changed", "account changed"])("keeps the saved scan's pending component draft when completion reports %s", async (reason) => {
    const target: ComponentCaptureTarget = { mapId: "bay-overview", componentId: "00000000-0000-4000-8000-000000000001", linkAttemptId: "00000000-0000-4000-8000-000000000002", lookupId: "component-scan" };
    const photos: ScanPhoto[] = [{ id: "close-up", label: "close_up", capturedAt: "2026-11-05T00:00:00Z", imageBase64: "data:image/jpeg;base64,cGFydA==" }];
    const envelope: PhotoDraftEnvelope = { version: 5, photos, target, photoRelationship: "independent" };
    draftStore.set("test-user:upload", photos); draftTargets.set("test-user:upload", target); draftEnvelopes.set("test-user:upload", envelope);
    readComponentMap.mockResolvedValue({ document: { components: [{ id: target.componentId }] } });
    completeComponentCapture.mockImplementationOnce(async () => {
      if (reason === "account changed") setActiveAccount("other-user");
      else throw new Error("The linked original changed. Pending draft kept.");
    });
    render(<MemoryRouter><Scanner /></MemoryRouter>);
    await userEvent.click(await screen.findByRole("button", { name: "Resume 1-photo draft" }));
    await analyzeReviewedPhotos();
    await waitFor(() => expect(completeComponentCapture).toHaveBeenCalledTimes(1));
    expect(completeComponentCapture).toHaveBeenCalledWith(target, expect.objectContaining({ id: target.lookupId, photos, photoRelationship: "independent" }),
      expect.objectContaining({ userId: "test-user" }), expect.any(AbortSignal), expect.any(Function));
    expect(draftEnvelopes.get("test-user:upload")).toEqual(upgradePhotoDraft(envelope));
    expect(draftStore.get("test-user:upload")).toEqual(photos);
    expect(identifyCapturedFrame).toHaveBeenCalledTimes(1);
    expect(observeEnvelopeCompare.mock.calls.some(([previous, next]) => previous?.target?.linkAttemptId === target.linkAttemptId && next === null)).toBe(false);
    if (reason === "source changed") {
      expect(getLookups().find((lookup) => lookup.id === target.lookupId)?.photos).toEqual(photos);
      await screen.findByRole("button", { name: "Finish component link" });
      await userEvent.click(screen.getByRole("button", { name: "Finish component link" }));
      await waitFor(() => expect(draftStore.has("test-user:upload")).toBe(false));
      expect(identifyCapturedFrame).toHaveBeenCalledTimes(1);
    }
  });

  it("does not append component photos to an older unrelated draft or silently retarget it", async () => {
    const target: ComponentCaptureTarget = { mapId: "bay-overview", componentId: "00000000-0000-4000-8000-000000000001", linkAttemptId: "00000000-0000-4000-8000-000000000002", lookupId: "component-scan" };
    const kept: ScanPhoto[] = [{ id: "prior", label: "overview", capturedAt: "2026-11-05T00:00:00Z", imageBase64: "data:image/jpeg;base64,cHJpb3I=" }];
    draftStore.set("test-user:upload", kept);
    render(<MemoryRouter initialEntries={[{ pathname: "/scan", state: { accountId: "test-user", componentCaptureTarget: target } }]}><Scanner /></MemoryRouter>);
    await userEvent.upload(screen.getByLabelText("Upload photo"), new File(["new component"], "new.jpg", { type: "image/jpeg" }));
    await screen.findByText(/An earlier draft belongs to a different inspection/);
    expect(draftStore.get("test-user:upload")).toEqual(kept);
    expect(draftTargets.has("test-user:upload")).toBe(false);
    expect(identifyCapturedFrame).not.toHaveBeenCalled();
  });

  it("keeps the first-photo issue pointer off another angle and restores it on return", async () => {
    const issue = "Rust is visible along the lower left edge.";
    const photos: ScanPhoto[] = [
      { id: "overview-photo", label: "overview", imageBase64: "data:image/jpeg;base64,b3ZlcnZpZXc=", capturedAt: "2026-11-05T00:00:00Z" },
      { id: "detail-photo", label: "close_up", imageBase64: "data:image/jpeg;base64,ZGV0YWls", capturedAt: "2026-11-05T00:01:00Z" },
    ];
    draftStore.set("test-user:upload", photos);
    identifyCapturedFrame.mockResolvedValueOnce({ ...makeScanResult("Alternator"), visibleObservations: [issue],
      evidenceRegions: [{ label: "Rusted edge", observation: issue, regionLabel: "lower left" }] });
    render(<MemoryRouter><Scanner /></MemoryRouter>);
    await userEvent.click(await screen.findByRole("button", { name: "Resume 2-photo draft" }));
    await analyzeReviewedPhotos();

    await userEvent.click(await screen.findByRole("button", { name: "Outline", exact: true }));
    expect(screen.getByTestId("issue-callout")).toHaveTextContent(issue);
    expect(screen.getByAltText("Reviewed scan photo")).toHaveAttribute("src", photos[0].imageBase64);
    await userEvent.click(screen.getByRole("button", { name: "2. Close-up" }));
    expect(screen.getByAltText("Reviewed scan photo")).toHaveAttribute("src", photos[1].imageBase64);
    expect(screen.getByTestId("focused-part-overlay")).toHaveAttribute("data-focus-mode", "full_frame");
    expect(screen.queryByTestId("issue-callout")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "1. Overview" }));
    expect(screen.getByAltText("Reviewed scan photo")).toHaveAttribute("src", photos[0].imageBase64);
    await userEvent.click(screen.getByRole("button", { name: "Outline", exact: true }));
    expect(screen.getByTestId("issue-callout")).toHaveTextContent(issue);
    expect(identifyCapturedFrame).toHaveBeenCalledTimes(1);
  });

  it("does not run analysis when saving an uploaded photo fails", async () => {
    savePhotoDraft.mockRejectedValueOnce(new Error("Photo storage is full. Free space and retry."));
    render(<MemoryRouter><Scanner /></MemoryRouter>);
    await userEvent.upload(screen.getByLabelText("Upload photo"), new File(["engine"], "engine.jpg", { type: "image/jpeg" }));
    expect(await screen.findByText("Photo storage is full. Free space and retry.")).toBeInTheDocument();
    expect(identifyCapturedFrame).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: "Review inspection photos" })).not.toBeInTheDocument();
  });

  it("opens both photo-review references as originals without another analysis or a changed saved result", async () => {
    const photos: ScanPhoto[] = [
      { id: "overview-photo", label: "overview", imageBase64: "data:image/jpeg;base64,b3ZlcnZpZXc=", capturedAt: "2026-11-05T00:00:00Z" },
      { id: "detail-photo", label: "close_up", imageBase64: "data:image/jpeg;base64,ZGV0YWls", capturedAt: "2026-11-05T00:01:00Z" },
    ];
    draftStore.set("test-user:upload", photos);
    const photoReview = { version: 1 as const,
      photos: [{ photoId: photos[0].id, status: "observations_returned" as const, summary: "A dark edge is visible." }, { photoId: photos[1].id, status: "limited_view" as const, summary: "Glare obscures that edge." }],
      disagreements: [{ id: "d1", photoIds: photos.map((photo) => photo.id), description: "The views do not establish whether this edge is a gap.", nextEvidence: { request: "Photograph the edge in diffuse light.", purpose: "Distinguish glare from an opening." } }],
    };
    identifyCapturedFrame.mockResolvedValueOnce({ ...makeScanResult("Alternator"), photoReview });
    render(<MemoryRouter><Scanner /></MemoryRouter>);
    await userEvent.click(await screen.findByRole("button", { name: "Resume 2-photo draft" }));
    await analyzeReviewedPhotos();
    const review = await screen.findByRole("region", { name: "Photo review" });
    await waitFor(() => expect(getLookups()[0]?.result?.photoReview).toEqual(photoReview));
    const saved = JSON.stringify(getLookups());
    await userEvent.click(screen.getByRole("button", { name: "Outline", exact: true }));
    await userEvent.click(within(review).getByRole("button", { name: "View Photo 1 — Overview for disagreement d1" }));
    expect(screen.getByRole("button", { name: "Original", exact: true })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByAltText("Reviewed scan photo")).toHaveAttribute("src", photos[0].imageBase64);
    await userEvent.click(within(review).getByRole("button", { name: "View Photo 2 — Close-up for disagreement d1" }));
    expect(screen.getByRole("button", { name: "Original", exact: true })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByAltText("Reviewed scan photo")).toHaveAttribute("src", photos[1].imageBase64);
    expect(identifyCapturedFrame).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(getLookups())).toBe(saved);
  });

  it.each(["ready", "blocked"] as const)("keeps a reviewed draft and presents its durable-check error once with camera %s", async (cameraState) => {
    cameraHookState.current = { ...cameraHookState.current, cameraState };
    render(<MemoryRouter><Scanner /></MemoryRouter>);
    await userEvent.upload(screen.getByLabelText("Upload photo"), new File(["engine"], "engine.jpg", { type: "image/jpeg" }));
    await screen.findByRole("dialog", { name: "Review inspection photos" });
    replacePhotoDraftIfMatches.mockRejectedValueOnce(new Error("Could not verify these saved photos. Retry before analysis."));
    await analyzeReviewedPhotos();
    expect(await screen.findByText("Could not verify these saved photos. Retry before analysis.")).toBeInTheDocument();
    const review = screen.getByRole("dialog", { name: "Review inspection photos" });
    expect(within(review).getByText("Could not verify these saved photos. Retry before analysis.")).toHaveAttribute("role", "status");
    expect(identifyCapturedFrame).not.toHaveBeenCalled();
    expect(removePhotoDraft).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Keep draft and close" }));
    expect(screen.queryByRole("dialog", { name: "Review inspection photos" })).not.toBeInTheDocument();
    expect(screen.getByText("Could not verify these saved photos. Retry before analysis.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Resume 1-photo draft" }));
    expect(screen.getByText("Could not verify these saved photos. Retry before analysis.")).toHaveAttribute("role", "status");
    expect(draftStore.get("test-user:upload")).toHaveLength(1);
    expect(identifyCapturedFrame).not.toHaveBeenCalled();
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
    expect(observeEnvelopeCompare.mock.calls[0][0]).toEqual({ version: 2, photos: [old] });
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
    expect(await screen.findByText("Choose up to four photos. No photos were discarded.")).toBeInTheDocument();
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
    expect(within(screen.getByRole("dialog", { name: "Review inspection photos" })).getByText("Scan canceled. Ready when you are.")).toHaveAttribute("role", "status");
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
