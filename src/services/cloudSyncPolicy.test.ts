import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Lookup } from "../types";

const mocks = vi.hoisted(() => ({ createClient: vi.fn(), map: vi.fn(), transactMap: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));
vi.mock("./componentMapStore", () => ({ readComponentMap: mocks.map, transactComponentMap: mocks.transactMap }));

function lookup(): Lookup {
  return { id: "scan-1", createdAt: "2026-11-05T00:00:00.000Z", frame: { imageBase64: "data:image/jpeg;base64,YQ==", capturedAt: "2026-11-05T00:00:00.000Z" },
    notes: "Local note", rating: null, correction: null, chatHistory: [], scanCategory: "unknown", trainingLabel: "unlabeled", trainingStatus: "raw_unreviewed",
    provenance: { captureMode: "upload", analysisSource: "ai_detection", savedAt: "2026-11-05T00:00:00.000Z" } };
}

describe("build-time cloud data policy", () => {
  beforeEach(async () => {
    vi.resetModules(); vi.clearAllMocks(); localStorage.clear();
    vi.stubEnv("VITE_SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
    vi.stubEnv("VITE_ENABLE_CLOUD_SYNC", "false");
    const { setActiveAccount } = await import("../lib/accountScope"); setActiveAccount("owner");
    mocks.map.mockResolvedValue(null);
    mocks.createClient.mockImplementation(() => { throw new Error("Unexpected Supabase client creation"); });
    vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected network request"); }));
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it.each([undefined, "", "true", "0"])("preserves existing enabled behavior unless explicitly false: %j", async (flag) => {
    vi.stubEnv("VITE_ENABLE_CLOUD_SYNC", flag);
    const { isCloudSyncEnabled } = await import("./cloudSyncPolicy");
    const { getCloudSyncStatus } = await import("./cloudSync");
    expect(isCloudSyncEnabled()).toBe(true); expect(getCloudSyncStatus().configured).toBe(true);
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it.each(["false", " FALSE "])("disables cloud configuration while preserving auth configuration: %j", async (flag) => {
    vi.stubEnv("VITE_ENABLE_CLOUD_SYNC", flag);
    const { isSupabaseAuthConfigured } = await import("./auth");
    const { getCloudSyncStatus } = await import("./cloudSync");
    expect(isSupabaseAuthConfigured()).toBe(true); expect(getCloudSyncStatus().configured).toBe(false);
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("stops every scan, chat-history, failed-attempt, feedback and waitlist write before client creation or cloud receipts", async () => {
    const cloud = await import("./cloudSync"), storage = await import("./storage");
    expect(storage.saveExistingLookup(lookup()).ok).toBe(true);
    const before = JSON.stringify(storage.readLookups());
    const scan = storage.getLookup("scan-1")!;
    for (const result of [await cloud.syncLookupToCloud(scan), await cloud.syncLookupChatToCloud(scan), await cloud.syncAnalysisFailuresToCloud(scan),
      await cloud.syncFeedbackToCloud({ id: "feedback-1", createdAt: scan.createdAt, category: "ai_result", message: "Synthetic review", contactEmail: "" }),
      await cloud.syncWaitlistSignupToCloud({ id: "waitlist-1", createdAt: scan.createdAt, email: "qa@example.com", userType: "car_owner", mainProblem: "Synthetic" })]) {
      expect(result).toMatchObject({ ok: false, message: expect.stringContaining("off for this build") });
    }
    expect(await cloud.syncLookupsToCloud([scan])).toMatchObject({ ok: false, attempted: 0, synced: 0, failed: 0 });
    expect(await cloud.syncLookupsToCloud([])).toMatchObject({ ok: false, attempted: 0, synced: 0 });
    expect(JSON.stringify(storage.readLookups())).toBe(before);
    expect(storage.getLookup(scan.id)?.cloudSave).toBeUndefined();
    expect(mocks.createClient).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });

  it("does not trust old ready health or run a synthetic upload, row write or cleanup", async () => {
    const { accountStorageKey } = await import("../lib/accountScope");
    localStorage.setItem(accountStorageKey("deep-spec:cloud-health"), JSON.stringify({ configured: true, overall: "ready", projectUrl: "https://project.supabase.co", lastVerifiedAt: "old" }));
    const { getCloudHealthSnapshot, verifyCloudHealth } = await import("./cloudSync");
    const before = localStorage.getItem(accountStorageKey("deep-spec:cloud-health"));
    for (const report of [getCloudHealthSnapshot(), await verifyCloudHealth()]) {
      expect(report).toMatchObject({ configured: false, overall: "unconfigured", checkedAt: null, lastVerifiedAt: null, message: expect.stringContaining("off for this build") });
      expect(report.checks.storageUpload.status).toBe("unknown");
    }
    expect(localStorage.getItem(accountStorageKey("deep-spec:cloud-health"))).toBe(before);
    expect(mocks.createClient).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });

  it("reports disabled scan and report restoration explicitly instead of returning an empty cloud history", async () => {
    const { readCloudLookups, readCloudLookup, readCloudLookupForReport } = await import("./cloudHistory");
    for (const result of [await readCloudLookups(), await readCloudLookup("scan-1"), await readCloudLookupForReport("scan-1")]) {
      expect(result).toMatchObject({ ok: false, message: expect.stringContaining("off for this build") });
    }
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("stops map sync before claiming a local attempt or uploading any referenced scan", async () => {
    const { loadComponentMapFromCloud, syncComponentMapToCloud } = await import("./componentMapCloud");
    expect(await syncComponentMapToCloud("scan-1", 1)).toMatchObject({ ok: false, message: expect.stringContaining("off for this build") });
    expect(await loadComponentMapFromCloud("scan-1")).toMatchObject({ ok: false, message: expect.stringContaining("off for this build") });
    expect(mocks.transactMap).not.toHaveBeenCalled(); expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("blocks human-record, comparison, diagnostic and training-consent reads and writes before Supabase access", async () => {
    const service = await import("./serviceRecordCloud"), comparison = await import("./inspectionComparisonCloud"), diagnostic = await import("./diagnosticReportCloud"), consent = await import("./trainingConsent");
    const actions = [() => service.readCloudServiceRecords("scan-1"), () => service.syncServiceRecords("scan-1"),
      () => comparison.readCloudInspectionComparisons("scan-1"), () => comparison.syncInspectionComparisons("scan-1"),
      () => diagnostic.readCloudDiagnosticBundle("scan-1"), () => diagnostic.syncDiagnosticReports("scan-1"),
      () => consent.loadTrainingConsent("scan-1"), () => consent.saveTrainingConsent("scan-1", true, null)];
    for (const action of actions) await expect(action()).rejects.toThrow("off for this build");
    expect(mocks.createClient).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps authenticated server chat available while cloud data sync is disabled", async () => {
    const getSession = vi.fn(async () => ({ data: { session: { access_token: "synthetic-token" } }, error: null }));
    mocks.createClient.mockReturnValue({ auth: { getSession } });
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ message: "Synthetic answer" }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchSpy);
    const { runAI } = await import("./aiService");
    expect(await runAI({ type: "text", userMessage: "What evidence is needed?", systemPrompt: "Synthetic test" })).toBe("Synthetic answer");
    expect(getSession).toHaveBeenCalledOnce();
    expect(fetchSpy).toHaveBeenCalledWith("/api/chat", expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer synthetic-token" }) }));
  });
});
