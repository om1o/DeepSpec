import { identifyCapturedFrame } from "./aiService";
import { createLookup, getLookup } from "./storage";
import { getOfflineEstimateLookups, startOfflineUpgradeWatcher, upgradeOfflineEstimates } from "./offlineUpgrade";
import type { IdentificationResult, IdentifyProvider } from "../types";

vi.mock("./aiService", () => ({ identifyCapturedFrame: vi.fn() }));

const frame = { imageBase64: "data:image/jpeg;base64,test", capturedAt: "2026-05-16T00:00:00.000Z" };

function makeResult(provider: IdentifyProvider): IdentificationResult {
  return {
    partName: "Brake caliper",
    confidence: "low",
    scanCategory: "brakes",
    candidateMatches: [],
    whatItDoes: "",
    visibleObservations: [],
    evidenceRegions: [],
    concerns: [],
    safetyTriage: "can_help",
    isSafetyCritical: false,
    nextAction: "",
    needsBetterPhoto: false,
    evidence: [],
    sourceLinks: [],
    modelRun: { provider, model: "test-model", latencyMs: 1, ocrUsed: false },
  };
}

describe("offlineUpgrade", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("finds only on-device offline estimates", () => {
    createLookup({ frame, result: makeResult("on-device") });
    createLookup({ frame, result: makeResult("gemini") });

    const pending = getOfflineEstimateLookups();

    expect(pending).toHaveLength(1);
    expect(pending[0].result?.modelRun?.provider).toBe("on-device");
  });

  it("re-runs offline estimates through the cloud and replaces them", async () => {
    const created = createLookup({ frame, result: makeResult("on-device") });
    vi.mocked(identifyCapturedFrame).mockResolvedValue(makeResult("gemini"));

    const upgraded = await upgradeOfflineEstimates();

    expect(upgraded).toBe(1);
    expect(getLookup(created.value!.id)?.result?.modelRun?.provider).toBe("gemini");
  });

  it("does nothing while offline", async () => {
    createLookup({ frame, result: makeResult("on-device") });
    const onlineSpy = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);

    expect(await upgradeOfflineEstimates()).toBe(0);
    expect(identifyCapturedFrame).not.toHaveBeenCalled();

    onlineSpy.mockRestore();
  });

  it("keeps the estimate when the cloud retry is still on-device", async () => {
    const created = createLookup({ frame, result: makeResult("on-device") });
    vi.mocked(identifyCapturedFrame).mockResolvedValue(makeResult("on-device"));

    expect(await upgradeOfflineEstimates()).toBe(0);
    expect(getLookup(created.value!.id)?.result?.modelRun?.provider).toBe("on-device");
  });

  it("only attaches the reconnect watcher when the fallback is enabled", () => {
    const addSpy = vi.spyOn(window, "addEventListener");

    vi.stubEnv("VITE_ENABLE_ON_DEVICE_FALLBACK", "false");
    startOfflineUpgradeWatcher()();
    expect(addSpy).not.toHaveBeenCalledWith("online", expect.any(Function));

    vi.stubEnv("VITE_ENABLE_ON_DEVICE_FALLBACK", "true");
    const stop = startOfflineUpgradeWatcher();
    expect(addSpy).toHaveBeenCalledWith("online", expect.any(Function));
    stop();

    addSpy.mockRestore();
  });
});
