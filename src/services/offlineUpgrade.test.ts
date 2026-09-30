import { setActiveAccount } from "../lib/accountScope";
import { identifyCapturedFrame } from "./aiService";
import { createLookup, getLookup } from "./storage";
import { getOfflineEstimateLookups, upgradeOfflineEstimates } from "./offlineUpgrade";
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
    expect(getLookup(created.value!.id)?.provenance.analysisSource).toBe("offline_upgrade");
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

  it("deduplicates overlapping reconnect upgrades", async () => {
    const created = createLookup({ frame, result: makeResult("on-device") });
    let resolveCloud!: (result: IdentificationResult) => void;
    vi.mocked(identifyCapturedFrame).mockReturnValue(new Promise((resolve) => {
      resolveCloud = resolve;
    }));

    const firstUpgrade = upgradeOfflineEstimates();
    const secondUpgrade = upgradeOfflineEstimates();
    expect(identifyCapturedFrame).toHaveBeenCalledTimes(1);

    resolveCloud(makeResult("gemini"));

    await expect(firstUpgrade).resolves.toBe(1);
    await expect(secondUpgrade).resolves.toBe(1);
    expect(getLookup(created.value!.id)?.result?.modelRun?.provider).toBe("gemini");
  });

  it("starts a separate upgrade for another account and discards old completion after returning", async () => {
    const original = createLookup({ frame, result: makeResult("on-device") });
    createLookup({ frame, result: makeResult("on-device") });
    let resolveOriginal!: (result: IdentificationResult) => void;
    let resolveOther!: (result: IdentificationResult) => void;
    vi.mocked(identifyCapturedFrame)
      .mockReturnValueOnce(new Promise((resolve) => { resolveOriginal = resolve; }))
      .mockReturnValueOnce(new Promise((resolve) => { resolveOther = resolve; }));
    const oldUpgrade = upgradeOfflineEstimates();
    setActiveAccount("other-user");
    const other = createLookup({ frame, result: makeResult("on-device") });
    const otherUpgrade = upgradeOfflineEstimates();
    expect(identifyCapturedFrame).toHaveBeenCalledTimes(2);
    resolveOther(makeResult("gemini"));
    expect(await otherUpgrade).toBe(1);
    expect(getLookup(other.value!.id)?.result?.modelRun?.provider).toBe("gemini");
    setActiveAccount("test-user");
    resolveOriginal(makeResult("gemini"));
    expect(await oldUpgrade).toBe(0);
    expect(getLookup(original.value!.id)?.result?.modelRun?.provider).toBe("on-device");
    expect(identifyCapturedFrame).toHaveBeenCalledTimes(2);
  });

  it("preserves vehicle context and normalizes fitment during an explicit upgrade", async () => {
    const vehicleContext = { year: "2012", make: "Honda", model: "Civic" };
    const created = createLookup({ frame, vehicleContext, result: makeResult("on-device") });
    vi.mocked(identifyCapturedFrame).mockResolvedValue({ ...makeResult("gemini"), fitmentConfidence: "supported" });
    expect(await upgradeOfflineEstimates()).toBe(1);
    expect(identifyCapturedFrame).toHaveBeenCalledWith(frame, undefined, undefined, { vehicleContext });
    expect(getLookup(created.value.id)?.result).toMatchObject({ fitmentConfidence: "needs_vehicle_context", requiredNextEvidence: expect.arrayContaining(["VIN"]) });
    expect(getLookup(created.value.id)?.vehicleContext).toEqual(vehicleContext);
  });

  it("does not count an upgrade whose device save failed", async () => {
    const created = createLookup({ frame, result: makeResult("on-device") });
    vi.mocked(identifyCapturedFrame).mockResolvedValue(makeResult("gemini"));
    const write = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Full device storage"); });
    try {
      expect(await upgradeOfflineEstimates()).toBe(0);
      expect(getLookup(created.value.id)?.result?.modelRun?.provider).toBe("on-device");
    } finally { write.mockRestore(); }
  });
});
