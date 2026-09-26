import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { Lookup } from "../types";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: mocks.createClient,
}));

describe("cloudSync", () => {
  beforeEach(async () => {
    localStorage.clear();
    vi.resetModules();
    const { setActiveAccount } = await import("../lib/accountScope");
    setActiveAccount("user-1");
    vi.stubEnv("VITE_SUPABASE_URL", "");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "");
    mocks.createClient.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each(["auth", "upload", "row"])("stops later writes after a timeout during %s and holds retries until the request settles", async (stage) => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
    let complete!: (value: unknown) => void;
    const pending = new Promise((resolve) => { complete = resolve; });
    const session = { data: { session: { user: { id: "user-1" } } }, error: null };
    const getSession = vi.fn().mockResolvedValue(session);
    const upload = vi.fn().mockResolvedValue({ error: null });
    const upsert = vi.fn().mockResolvedValue({ error: null });
    const insert = vi.fn().mockResolvedValue({ error: null });
    const from = vi.fn().mockReturnValue({ upsert, insert, delete: makeDeleteQuery });
    const stalled = stage === "auth" ? getSession : stage === "upload" ? upload : upsert;
    stalled.mockReturnValueOnce(pending);
    mocks.createClient.mockReturnValue({ auth: { getSession }, storage: { from: vi.fn().mockReturnValue({ upload }) }, from });
    const { syncLookupToCloud } = await import("./cloudSync");
    const { saveExistingLookup, getLookup, updateLookup } = await import("./storage");
    const lookup = makeLookup();
    saveExistingLookup(lookup);
    vi.useFakeTimers();
    try {
      const saving = syncLookupToCloud(lookup);
      await vi.waitFor(() => expect(stalled).toHaveBeenCalledOnce());
      await vi.advanceTimersByTimeAsync(20_001);
      expect((await saving).ok).toBe(false);
      expect(getLookup(lookup.id)?.cloudSave?.status).toBe("failed");
      updateLookup(lookup.id, { notes: "Newer inspection context" });
      const retry = syncLookupToCloud(lookup);
      await vi.advanceTimersByTimeAsync(20_001);
      expect(await retry).toMatchObject({ ok: false, message: expect.stringContaining("still finishing") });
      expect(stalled).toHaveBeenCalledOnce();
      complete(stage === "auth" ? session : { error: null });
      await vi.advanceTimersByTimeAsync(0);
      expect(upload).toHaveBeenCalledTimes(stage === "auth" ? 0 : 1);
      expect(upsert).toHaveBeenCalledTimes(stage === "row" ? 1 : 0);
      expect(insert).not.toHaveBeenCalled();
      expect(getLookup(lookup.id)?.notes).toBe("Newer inspection context");
      expect(getLookup(lookup.id)?.cloudSave).toBeUndefined();

      expect((await syncLookupToCloud(lookup)).ok).toBe(true);
      expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ notes: "Newer inspection context" }), expect.anything());
      expect(getLookup(lookup.id)?.cloudSave?.status).toBe("acknowledged");
    } finally { complete(stage === "auth" ? session : { error: null }); vi.useRealTimers(); }
  });

  it("releases a timed-out save after late rejection so a new attempt can finish", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
    let complete!: (value: unknown) => void;
    let rejectPending!: (reason: Error) => void;
    const pending = new Promise((resolve, reject) => { complete = resolve; rejectPending = reject; });
    const session = { data: { session: { user: { id: "user-1" } } }, error: null };
    const getSession = vi.fn().mockResolvedValue(session).mockReturnValueOnce(pending);
    const upload = vi.fn().mockResolvedValue({ error: null });
    const upsert = vi.fn().mockResolvedValue({ error: null });
    const insert = vi.fn().mockResolvedValue({ error: null });
    mocks.createClient.mockReturnValue({
      auth: { getSession }, storage: { from: vi.fn().mockReturnValue({ upload }) },
      from: vi.fn().mockReturnValue({ upsert, insert, delete: makeDeleteQuery }),
    });
    const { syncLookupToCloud } = await import("./cloudSync");
    const { saveExistingLookup, getLookup } = await import("./storage");
    const lookup = makeLookup();
    saveExistingLookup(lookup);
    vi.useFakeTimers();
    const saving = syncLookupToCloud(lookup);
    try {
      await vi.waitFor(() => expect(getSession).toHaveBeenCalledOnce());
      await vi.advanceTimersByTimeAsync(20_001);
      expect((await saving).ok).toBe(false);
      const failedReceipt = getLookup(lookup.id)?.cloudSave;
      expect(failedReceipt?.status).toBe("failed");
      expect(await syncLookupToCloud(lookup)).toMatchObject({ ok: false, message: expect.stringContaining("still finishing") });
      rejectPending(new Error("Connection closed after timeout"));
      await vi.advanceTimersByTimeAsync(0);
      expect(upload).not.toHaveBeenCalled();
      expect(getLookup(lookup.id)?.cloudSave).toEqual(failedReceipt);
      expect((await syncLookupToCloud(lookup)).ok).toBe(true);
      expect(getSession).toHaveBeenCalledTimes(2);
      expect(upload).toHaveBeenCalledOnce();
      expect(getLookup(lookup.id)?.cloudSave?.status).toBe("acknowledged");
      expect(getLookup(lookup.id)?.cloudSave?.attemptId).not.toBe(failedReceipt?.attemptId);
    } finally {
      complete(session);
      await saving;
      vi.useRealTimers();
    }
  });

  it("isolates pending saves by owner without allowing account round-trips to bypass them", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
    const { getAccountScope, setActiveAccount } = await import("../lib/accountScope");
    let complete!: (value: unknown) => void;
    const pending = new Promise((resolve) => { complete = resolve; });
    const upload = vi.fn().mockResolvedValue({ error: null }).mockReturnValueOnce(pending);
    const upsert = vi.fn().mockResolvedValue({ error: null });
    const insert = vi.fn().mockResolvedValue({ error: null });
    mocks.createClient.mockReturnValue({
      auth: { getSession: vi.fn().mockImplementation(async () => ({ data: { session: { user: { id: getAccountScope().userId } } }, error: null })) },
      storage: { from: vi.fn().mockReturnValue({ upload }) },
      from: vi.fn().mockReturnValue({ upsert, insert, delete: makeDeleteQuery }),
    });
    const { syncLookupToCloud } = await import("./cloudSync");
    const { saveExistingLookup, getLookup } = await import("./storage");
    const lookup = makeLookup();
    saveExistingLookup({ ...lookup, notes: "Owner A notes" });
    const saving = syncLookupToCloud(lookup);
    try {
      await vi.waitFor(() => expect(upload).toHaveBeenCalledOnce());
      const originalReceipt = getLookup(lookup.id)?.cloudSave;
      setActiveAccount("user-2");
      saveExistingLookup({ ...lookup, notes: "Owner B notes" });
      expect((await syncLookupToCloud(lookup)).ok).toBe(true);
      expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ user_id: "user-2", local_id: lookup.id, notes: "Owner B notes" }), expect.anything());
      const otherReceipt = getLookup(lookup.id)?.cloudSave;
      expect(otherReceipt?.status).toBe("acknowledged");

      setActiveAccount("user-1");
      expect(await syncLookupToCloud(lookup)).toMatchObject({ ok: false, message: expect.stringContaining("still finishing") });
      expect(upload).toHaveBeenCalledTimes(2);
      expect(getLookup(lookup.id)?.cloudSave).toEqual(originalReceipt);
      complete({ error: null });
      expect((await saving).ok).toBe(false);
      expect(upsert).not.toHaveBeenCalledWith(expect.objectContaining({ user_id: "user-1" }), expect.anything());
      expect(getLookup(lookup.id)?.cloudSave).toEqual(originalReceipt);
      expect((await syncLookupToCloud(lookup)).ok).toBe(true);
      expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ user_id: "user-1", local_id: lookup.id, notes: "Owner A notes" }), expect.anything());
      setActiveAccount("user-2");
      expect(getLookup(lookup.id)?.cloudSave).toEqual(otherReceipt);
    } finally {
      complete({ error: null });
      await saving;
    }
  });

  it("does not overlap two active saves of the same scan", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
    let complete!: (value: unknown) => void;
    const upload = vi.fn().mockImplementation(() => new Promise((resolve) => { complete = resolve; }));
    const from = vi.fn();
    mocks.createClient.mockReturnValue({
      auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: "user-1" } } }, error: null }) },
      storage: { from: vi.fn().mockReturnValue({ upload }) }, from,
    });
    const { syncLookupToCloud } = await import("./cloudSync");
    const { saveExistingLookup, getLookup } = await import("./storage");
    const lookup = makeLookup();
    saveExistingLookup(lookup);
    const saving = syncLookupToCloud(lookup);
    await vi.waitFor(() => expect(upload).toHaveBeenCalledOnce());
    const attemptId = getLookup(lookup.id)?.cloudSave?.attemptId;
    const retry = syncLookupToCloud(lookup);
    // A duplicate save must return immediately, without starting a second upload.
    await expect(Promise.race([retry, new Promise((resolve) => setTimeout(() => resolve("still waiting"), 100))]))
      .resolves.toMatchObject({ ok: false, message: expect.stringContaining("still finishing") });
    expect(upload).toHaveBeenCalledOnce();
    expect(getLookup(lookup.id)?.cloudSave?.attemptId).toBe(attemptId);
    complete({ error: { message: "Upload rejected" } });
    await saving;
    expect(from).not.toHaveBeenCalled();
  });

  it.each(["Failed to fetch", "Request timed out"])("does not promise an automatic retry after %s", async (message) => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
    mocks.createClient.mockReturnValue({ auth: { getSession: vi.fn().mockRejectedValue(new Error(message)) } });
    const { syncLookupToCloud } = await import("./cloudSync");
    const { saveExistingLookup, getLookup } = await import("./storage");
    saveExistingLookup(makeLookup());
    await expect(syncLookupToCloud(makeLookup())).resolves.toEqual({
      ok: false,
      message: "Cloud save was not confirmed. Reconnect and retry the save.",
    });
    expect(getLookup("lookup-1")?.cloudSave).toMatchObject({ status: "failed", scope: "scan" });
  });

  it("stops a batch after the account changes during its first upload", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
    const { setActiveAccount } = await import("../lib/accountScope");
    const upload = vi.fn().mockImplementation(async () => { setActiveAccount("user-2"); return { error: null }; });
    const from = vi.fn();
    mocks.createClient.mockReturnValue({
      auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: "user-1" } } }, error: null }) },
      storage: { from: vi.fn().mockReturnValue({ upload }) }, from,
    });
    const { syncLookupsToCloud } = await import("./cloudSync");
    const result = await syncLookupsToCloud([makeLookup(), { ...makeLookup(), id: "lookup-2" }]);
    expect(result.synced).toBe(0);
    expect(result.failed).toBe(2);
    expect(upload).toHaveBeenCalledTimes(1);
    expect(from).not.toHaveBeenCalled();
  });

  it.each(["signed-out", "different-owner", "round-trip"])("blocks account changes before upload: %s", async (mode) => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
    const { setActiveAccount } = await import("../lib/accountScope");
    const upload = vi.fn();
    const signInAnonymously = vi.fn();
    mocks.createClient.mockReturnValue({
      auth: { getSession: vi.fn().mockImplementation(async () => {
        if (mode === "round-trip") { setActiveAccount("other"); setActiveAccount("user-1"); }
        return { data: { session: mode === "signed-out" ? null : { user: { id: mode === "different-owner" ? "other" : "user-1" } } }, error: null };
      }), signInAnonymously },
      storage: { from: vi.fn().mockReturnValue({ upload }) }, from: vi.fn(),
    });
    const { syncLookupToCloud } = await import("./cloudSync");
    expect((await syncLookupToCloud(makeLookup())).ok).toBe(false);
    expect(upload).not.toHaveBeenCalled();
    expect(signInAnonymously).not.toHaveBeenCalled();
  });

  it.each(["updated", "missing", "migration"])("saves a cloud-only inspection without reuploading its image: %s", async (outcome) => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
    const select = vi.fn().mockResolvedValue({
      data: outcome === "updated" ? [{ local_id: "lookup-1" }] : [],
      error: outcome === "migration" ? { message: "column inspection_json does not exist" } : null,
    });
    const eq = vi.fn();
    eq.mockReturnValue({ eq, select });
    const update = vi.fn().mockReturnValue({ eq });
    const storageFrom = vi.fn();
    const from = vi.fn().mockReturnValue({ update });
    mocks.createClient.mockReturnValue({
      auth: {
        getSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: "user-1" } } }, error: null }),
      },
      from,
      storage: { from: storageFrom },
    });
    const lookup = makeLookup();
    lookup.frame.imageBase64 = "https://example.supabase.co/storage/v1/object/sign/scan-images/scan.jpg?token=example";
    lookup.inspection = {
      confirmedPartName: "Alternator", partNumber: "ALT-42", identityEvidence: "Read stamped number",
      visibleCondition: "no_visible_damage", visibleNotes: "Housing intact",
      functionalStatus: "not_tested", functionalNotes: "", inspectorName: "Sam",
      inspectedAt: "2026-09-20T12:00:00.000Z",
    };
    const { saveExistingLookup, getLookup } = await import("./storage");
    saveExistingLookup(lookup);
    const { syncLookupToCloud } = await import("./cloudSync");
    const result = await syncLookupToCloud(lookup);
    expect(result.ok).toBe(outcome === "updated");
    expect(getLookup(lookup.id)?.cloudSave).toMatchObject({ scope: "inspection", status: outcome === "updated" ? "acknowledged" : "failed" });
    if (outcome === "missing") expect(result.message).toContain("not found for this account");
    if (outcome === "migration") expect(result.message).toContain("database migration");
    expect(from).toHaveBeenCalledExactlyOnceWith("scan_lookups");
    expect(update).toHaveBeenCalledExactlyOnceWith({ inspection_json: lookup.inspection });
    expect(eq.mock.calls).toEqual([["user_id", "user-1"], ["local_id", "lookup-1"]]);
    expect(select).toHaveBeenCalledWith("local_id");
    expect(storageFrom).not.toHaveBeenCalled();
  });

  it.each(["unchanged", "edited", "account-changed", "timeout"])("records only an applicable inspection acknowledgement: %s", async (outcome) => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
    const { saveExistingLookup, getLookup, updateLookup } = await import("./storage");
    const { setActiveAccount } = await import("../lib/accountScope");
    const lookup = makeLookup();
    lookup.frame.imageBase64 = "https://example.test/scan.jpg";
    lookup.inspection = { confirmedPartName: "Alternator", partNumber: "ALT-42", identityEvidence: "Stamped marking", visibleCondition: "not_inspected", visibleNotes: "", functionalStatus: "not_tested", functionalNotes: "", inspectorName: "Sam", inspectedAt: "2026-09-20T12:00:00.000Z" };
    saveExistingLookup(lookup);
    let complete!: (value: unknown) => void;
    const select = vi.fn().mockImplementation(() => new Promise((resolve) => { complete = resolve; }));
    const eq = vi.fn();
    eq.mockReturnValue({ eq, select });
    const update = vi.fn().mockReturnValue({ eq });
    mocks.createClient.mockReturnValue({ auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: "user-1" } } }, error: null }) }, from: vi.fn().mockReturnValue({ update }) });
    const { syncLookupToCloud } = await import("./cloudSync");
    if (outcome === "timeout") vi.useFakeTimers();
    try {
      const saving = syncLookupToCloud({ ...lookup, inspection: { ...lookup.inspection, inspectorName: "Stale name" } });
      await vi.waitFor(() => expect(select).toHaveBeenCalled());
      expect(update).toHaveBeenCalledWith({ inspection_json: lookup.inspection });
      expect(getLookup(lookup.id)?.cloudSave).toMatchObject({ status: "unconfirmed", scope: "inspection" });
      if (outcome === "edited") updateLookup(lookup.id, { notes: "New local work" });
      if (outcome === "account-changed") setActiveAccount("user-2");
      if (outcome === "timeout") {
        await vi.advanceTimersByTimeAsync(20_001);
        expect((await saving).ok).toBe(false);
      }
      complete({ data: [{ local_id: lookup.id }], error: null });
      await saving;
      if (outcome === "account-changed") {
        expect(getLookup(lookup.id)).toBeNull();
        setActiveAccount("user-1");
      }
      expect(getLookup(lookup.id)?.cloudSave?.status).toBe(outcome === "unchanged" ? "acknowledged" : outcome === "edited" ? undefined : outcome === "timeout" ? "failed" : "unconfirmed");
    } finally { vi.useRealTimers(); }
  });

  it.each([false, true])("does not silently drop inspection when its column is missing (shop fallback: %s)", async (missingShop) => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
    const upsert = vi.fn().mockResolvedValue({ error: { message: "Could not find the 'inspection_json' column in the schema cache" } });
    if (missingShop) upsert.mockResolvedValueOnce({ error: { message: "Could not find the 'job_id' column in the schema cache" } });
    mocks.createClient.mockReturnValue({
      auth: {
        getSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: "user-1" } } }, error: null }),
        signInAnonymously: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } }, error: null }),
      },
      from: vi.fn().mockReturnValue({ upsert }),
      storage: { from: vi.fn().mockReturnValue({ upload: vi.fn().mockResolvedValue({ error: null }) }) },
    });
    const lookup = makeLookup();
    lookup.inspection = {
      confirmedPartName: "Alternator", partNumber: "ALT-42", identityEvidence: "Read stamped number",
      visibleCondition: "no_visible_damage", visibleNotes: "Housing intact",
      functionalStatus: "not_tested", functionalNotes: "", inspectorName: "Sam",
      inspectedAt: "2026-09-20T12:00:00.000Z",
    };
    const { syncLookupToCloud } = await import("./cloudSync");
    await expect(syncLookupToCloud(lookup)).resolves.toEqual({
      ok: false,
      message: "Inspection is saved on this device. Apply the part inspection database migration before syncing it to the cloud.",
    });
    expect(upsert).toHaveBeenCalledTimes(missingShop ? 2 : 1);
    for (const [row] of upsert.mock.calls) {
      expect(row).toMatchObject({ inspection_json: lookup.inspection, training_status: "raw_unreviewed", training_label: "Alternator" });
      expect(row.result_json).toEqual(lookup.result);
    }
  });

  it("stays disabled when Supabase public config is missing", async () => {
    const { getCloudHealthSnapshot, getCloudSyncStatus, syncLookupToCloud } = await import("./cloudSync");

    expect(getCloudSyncStatus()).toEqual({
      configured: false,
      message: "Your scans are saved on this device. Cloud sync is off for this build.",
    });
    expect(getCloudHealthSnapshot()).toMatchObject({
      configured: false,
      overall: "unconfigured",
      checks: {
        configured: {
          status: "fail",
        },
      },
    });

    await expect(syncLookupToCloud(makeLookup())).resolves.toEqual({
      ok: false,
      message: "Cloud sync is not configured yet.",
    });
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("uploads the scan image and upserts the dataset row for the current user", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
    const upload = vi.fn().mockResolvedValue({ error: null });
    const scanLookupUpsert = vi.fn().mockResolvedValue({ error: null });
    const correctionUpsert = vi.fn().mockResolvedValue({ error: null });
    const candidateInsert = vi.fn().mockResolvedValue({ error: null });
    const evidenceInsert = vi.fn().mockResolvedValue({ error: null });
    const modelRunInsert = vi.fn().mockResolvedValue({ error: null });
    const syncEventInsert = vi.fn().mockResolvedValue({ error: null });
    const from = vi.fn((table: string) => {
      if (table === "scan_lookups") return { upsert: scanLookupUpsert };
      if (table === "scan_candidates") return { delete: vi.fn().mockReturnValue(makeDeleteQuery()), insert: candidateInsert };
      if (table === "scan_evidence") return { delete: vi.fn().mockReturnValue(makeDeleteQuery()), insert: evidenceInsert };
      if (table === "scan_corrections") return { upsert: correctionUpsert };
      if (table === "scan_model_runs") return { insert: modelRunInsert };
      if (table === "sync_events") return { insert: syncEventInsert };
      throw new Error(`Unexpected table ${table}`);
    });
    mocks.createClient.mockReturnValue({
      auth: {
        getSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: "user-1" } } }, error: null }),
        signInAnonymously: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } }, error: null }),
      },
      from,
      storage: {
        from: vi.fn().mockReturnValue({ upload }),
      },
    });
    const { syncLookupToCloud } = await import("./cloudSync");

    const lookup = makeLookup();
    lookup.inspection = {
      confirmedPartName: "Alternator", partNumber: "ALT-42", identityEvidence: "Read stamped number",
      visibleCondition: "no_visible_damage", visibleNotes: "Housing intact",
      functionalStatus: "not_tested", functionalNotes: "", inspectorName: "Sam",
      inspectedAt: "2026-09-20T12:00:00.000Z",
    };
    const { saveExistingLookup, getLookup, updateLookup } = await import("./storage");
    saveExistingLookup(lookup);
    updateLookup(lookup.id, { notes: "Current bench notes" });
    const result = await syncLookupToCloud(lookup);
    expect(getLookup(lookup.id)?.cloudSave).toMatchObject({ status: "acknowledged", scope: "scan" });

    expect(result).toEqual({
      ok: true,
      imagePath: "user-1/lookup-1.jpg",
      message: "Scan synced to the private Deep Spec dataset.",
    });
    expect(upload).toHaveBeenCalledWith(
      "user-1/lookup-1.jpg",
      expect.any(Blob),
      expect.objectContaining({ contentType: "image/jpeg", upsert: true }),
    );
    expect(scanLookupUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        image_byte_length: 5,
        notes: "Current bench notes",
        inspection_json: lookup.inspection,
        image_hash: expect.any(String),
        image_mime_type: "image/jpeg",
        image_path: "user-1/lookup-1.jpg",
        local_id: "lookup-1",
        scan_category: "electrical",
        training_label: "Alternator",
        training_status: "raw_unreviewed",
        user_id: "user-1",
      }),
      { onConflict: "user_id,local_id" },
    );
    expect(candidateInsert).toHaveBeenCalledWith([
      expect.objectContaining({
        candidate_rank: 0,
        part_name: "Starter motor",
        scan_local_id: "lookup-1",
        user_id: "user-1",
      }),
    ]);
    expect(evidenceInsert).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ evidence_type: "observation", evidence_text: "Belt-driven housing is visible." }),
        expect.objectContaining({ evidence_type: "region", region_label: "center" }),
        expect.objectContaining({ evidence_type: "evidence", evidence_text: "Pulley and vented housing are visible." }),
        expect.objectContaining({ evidence_type: "source_link", source_type: "dataset" }),
      ]),
    );
    expect(correctionUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        scan_local_id: "lookup-1",
        training_status: "raw_unreviewed",
        user_id: "user-1",
      }),
      { onConflict: "user_id,scan_local_id" },
    );
    expect(modelRunInsert).toHaveBeenCalledWith(expect.objectContaining({
      latency_ms: 1234,
      metadata_json: expect.objectContaining({
        analysisSource: "ai_detection",
        captureMode: "camera",
        fallbackReason: "rate_limited",
        savedAt: "2026-05-18T00:00:03.000Z",
        scanQuality: expect.objectContaining({
          brightnessScore: 98,
          sharpnessScore: 100,
        }),
      }),
      model: "Qwen/Qwen2.5-VL-7B-Instruct",
      ocr_used: false,
      provider: "huggingface",
      scan_local_id: "lookup-1",
    }));
    expect(syncEventInsert).toHaveBeenCalledWith(expect.objectContaining({
      event_type: "upsert",
      metadata_json: expect.objectContaining({
        analysisSource: "ai_detection",
        captureMode: "camera",
        savedAt: "2026-05-18T00:00:03.000Z",
      }),
      status: "success",
    }));
  });

  it("retries core scan persistence when optional shop columns are missing from Supabase schema cache", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
    const upload = vi.fn().mockResolvedValue({ error: null });
    const scanLookupUpsert = vi.fn()
      .mockResolvedValueOnce({
        error: {
          message: "Could not find the 'customer_visible_report_json' column of 'scan_lookups' in the schema cache",
        },
      })
      .mockResolvedValueOnce({ error: null });
    const correctionUpsert = vi.fn().mockResolvedValue({ error: null });
    const candidateInsert = vi.fn().mockResolvedValue({ error: null });
    const evidenceInsert = vi.fn().mockResolvedValue({ error: null });
    const modelRunInsert = vi.fn().mockResolvedValue({ error: null });
    const syncEventInsert = vi.fn().mockResolvedValue({ error: null });
    const from = vi.fn((table: string) => {
      if (table === "scan_lookups") return { upsert: scanLookupUpsert };
      if (table === "scan_candidates") return { delete: vi.fn().mockReturnValue(makeDeleteQuery()), insert: candidateInsert };
      if (table === "scan_evidence") return { delete: vi.fn().mockReturnValue(makeDeleteQuery()), insert: evidenceInsert };
      if (table === "scan_corrections") return { upsert: correctionUpsert };
      if (table === "scan_model_runs") return { insert: modelRunInsert };
      if (table === "sync_events") return { insert: syncEventInsert };
      throw new Error(`Unexpected table ${table}`);
    });
    mocks.createClient.mockReturnValue({
      auth: {
        getSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: "user-1" } } }, error: null }),
        signInAnonymously: vi.fn(),
      },
      from,
      storage: {
        from: vi.fn().mockReturnValue({ upload }),
      },
    });
    const { syncLookupToCloud } = await import("./cloudSync");

    await expect(syncLookupToCloud({
      ...makeLookup(),
      customerVisibleReport: {
        generatedAt: "2026-05-18T00:00:04.000Z",
        summary: "Customer report summary.",
        title: "Customer report",
      },
    })).resolves.toMatchObject({ ok: true });

    expect(scanLookupUpsert).toHaveBeenCalledTimes(2);
    // A stale client without an inspection must not explicitly clear the cloud field.
    for (const [row] of scanLookupUpsert.mock.calls) expect(row).not.toHaveProperty("inspection_json");
    expect(scanLookupUpsert.mock.calls[0][0]).toEqual(expect.objectContaining({
      customer_visible_report_json: expect.any(Object),
    }));
    expect(scanLookupUpsert.mock.calls[1][0]).toEqual(expect.not.objectContaining({
      customer_visible_report_json: expect.anything(),
      job_id: expect.anything(),
      org_id: expect.anything(),
      review_status: expect.anything(),
      technician_user_id: expect.anything(),
      vehicle_context: expect.anything(),
    }));
    expect(scanLookupUpsert.mock.calls[1][0]).toEqual(expect.objectContaining({
      image_path: "user-1/lookup-1.jpg",
      local_id: "lookup-1",
      result_json: expect.any(Object),
      user_id: "user-1",
    }));
  });

  it("upserts the shop job bridge row when a synced scan has valid org and job context", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
    const upload = vi.fn().mockResolvedValue({ error: null });
    const scanLookupUpsert = vi.fn().mockResolvedValue({ error: null });
    const jobScanUpsert = vi.fn().mockResolvedValue({ error: null });
    const correctionUpsert = vi.fn().mockResolvedValue({ error: null });
    const candidateInsert = vi.fn().mockResolvedValue({ error: null });
    const evidenceInsert = vi.fn().mockResolvedValue({ error: null });
    const modelRunInsert = vi.fn().mockResolvedValue({ error: null });
    const syncEventInsert = vi.fn().mockResolvedValue({ error: null });
    const from = vi.fn((table: string) => {
      if (table === "scan_lookups") return { upsert: scanLookupUpsert };
      if (table === "job_scans") return { upsert: jobScanUpsert };
      if (table === "scan_candidates") return { delete: vi.fn().mockReturnValue(makeDeleteQuery()), insert: candidateInsert };
      if (table === "scan_evidence") return { delete: vi.fn().mockReturnValue(makeDeleteQuery()), insert: evidenceInsert };
      if (table === "scan_corrections") return { upsert: correctionUpsert };
      if (table === "scan_model_runs") return { insert: modelRunInsert };
      if (table === "sync_events") return { insert: syncEventInsert };
      throw new Error(`Unexpected table ${table}`);
    });
    mocks.createClient.mockReturnValue({
      auth: {
        getSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: "user-1" } } }, error: null }),
        signInAnonymously: vi.fn(),
      },
      from,
      storage: {
        from: vi.fn().mockReturnValue({ upload }),
      },
    });
    const { syncLookupToCloud } = await import("./cloudSync");
    const orgId = "00000000-0000-4000-8000-000000000001";
    const jobId = "00000000-0000-4000-8000-000000000101";
    const customerVisibleReport = {
      generatedAt: "2026-05-18T00:00:04.000Z",
      summary: "Alternator result ready for customer report.",
      title: "Customer report",
    };

    await expect(syncLookupToCloud({
      ...makeLookup(),
      customerVisibleReport,
      jobId,
      orgId,
      reviewStatus: "confirmed",
      technicianUserId: "00000000-0000-4000-8000-000000000201",
      vehicleContext: {
        make: "Toyota",
        model: "Camry",
        symptom: "Battery warning light",
        technicianName: "Alex",
        year: "2012",
      },
    })).resolves.toMatchObject({ ok: true });

    expect(scanLookupUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        customer_visible_report_json: customerVisibleReport,
        job_id: jobId,
        org_id: orgId,
        review_status: "confirmed",
        technician_user_id: "00000000-0000-4000-8000-000000000201",
        vehicle_context: expect.objectContaining({
          make: "Toyota",
          model: "Camry",
        }),
      }),
      { onConflict: "user_id,local_id" },
    );
    expect(jobScanUpsert).toHaveBeenCalledWith(
      {
        customer_visible_report_json: customerVisibleReport,
        job_id: jobId,
        org_id: orgId,
        review_status: "confirmed",
        scan_local_id: "lookup-1",
        user_id: "user-1",
      },
      { onConflict: "job_id,user_id,scan_local_id" },
    );
  });

  it("syncs multiple saved scans as separate cloud rows and images", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
    const upload = vi.fn().mockResolvedValue({ error: null });
    const scanLookupUpsert = vi.fn().mockResolvedValue({ error: null });
    const correctionUpsert = vi.fn().mockResolvedValue({ error: null });
    const candidateInsert = vi.fn().mockResolvedValue({ error: null });
    const evidenceInsert = vi.fn().mockResolvedValue({ error: null });
    const modelRunInsert = vi.fn().mockResolvedValue({ error: null });
    const syncEventInsert = vi.fn().mockResolvedValue({ error: null });
    const from = vi.fn((table: string) => {
      if (table === "scan_lookups") return { upsert: scanLookupUpsert };
      if (table === "scan_candidates") return { delete: vi.fn().mockReturnValue(makeDeleteQuery()), insert: candidateInsert };
      if (table === "scan_evidence") return { delete: vi.fn().mockReturnValue(makeDeleteQuery()), insert: evidenceInsert };
      if (table === "scan_corrections") return { upsert: correctionUpsert };
      if (table === "scan_model_runs") return { insert: modelRunInsert };
      if (table === "sync_events") return { insert: syncEventInsert };
      throw new Error(`Unexpected table ${table}`);
    });
    mocks.createClient.mockReturnValue({
      auth: {
        getSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: "user-1" } } }, error: null }),
        signInAnonymously: vi.fn(),
      },
      from,
      storage: {
        from: vi.fn().mockReturnValue({ upload }),
      },
    });
    const { syncLookupsToCloud } = await import("./cloudSync");
    const secondLookup = {
      ...makeLookup(),
      createdAt: "2026-05-18T00:01:00.000Z",
      id: "lookup-2",
      trainingLabel: "Starter",
    };

    await expect(syncLookupsToCloud([makeLookup(), secondLookup])).resolves.toMatchObject({
      attempted: 2,
      failed: 0,
      ok: true,
      synced: 2,
    });

    expect(upload).toHaveBeenCalledWith(
      "user-1/lookup-1.jpg",
      expect.any(Blob),
      expect.objectContaining({ contentType: "image/jpeg", upsert: true }),
    );
    expect(upload).toHaveBeenCalledWith(
      "user-1/lookup-2.jpg",
      expect.any(Blob),
      expect.objectContaining({ contentType: "image/jpeg", upsert: true }),
    );
    expect(scanLookupUpsert).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ local_id: "lookup-1", user_id: "user-1" }),
      { onConflict: "user_id,local_id" },
    );
    expect(scanLookupUpsert).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ local_id: "lookup-2", training_label: "Starter", user_id: "user-1" }),
      { onConflict: "user_id,local_id" },
    );
  });

  it("does not call configured cloud sync ready before the verifier proves it", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
    const { getCloudSyncStatus } = await import("./cloudSync");

    expect(getCloudSyncStatus()).toEqual({
      configured: true,
      message: "Cloud sync is set up. Run a quick check to confirm your scans save and stay private.",
    });
  });

  it("refuses signed-out sync without creating an anonymous account", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
    mocks.createClient.mockReturnValue({
      auth: {
        getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
        signInAnonymously: vi.fn().mockResolvedValue({ data: { user: null }, error: { message: "Anonymous sign-ins are disabled" } }),
      },
      from: vi.fn(),
      storage: {
        from: vi.fn(),
      },
    });
    const { syncLookupToCloud } = await import("./cloudSync");

    await expect(syncLookupToCloud(makeLookup())).resolves.toEqual({
      ok: false,
      message: "Sign in to the account that owns this scan before syncing.",
    });
    expect(mocks.createClient.mock.results.at(-1)?.value.auth.signInAnonymously).not.toHaveBeenCalled();
  });

  it("resets clientPromise so the next call can retry after an import failure", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
    mocks.createClient.mockRejectedValueOnce(new Error("Module load failed"));
    const { syncLookupToCloud } = await import("./cloudSync");

    // First call — import throws; should fail but not lock the promise
    const first = await syncLookupToCloud(makeLookup());
    expect(first.ok).toBe(false);

    // Second call — createClient now succeeds
    const upload = vi.fn().mockResolvedValue({ error: null });
    const upsert = vi.fn().mockResolvedValue({ error: null });
    const insert = vi.fn().mockResolvedValue({ error: null });
    mocks.createClient.mockReturnValue({
      auth: {
        getSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: "user-1" } } }, error: null }),
        signInAnonymously: vi.fn().mockResolvedValue({ data: { user: { id: "user-retry" } }, error: null }),
      },
      from: vi.fn((table: string) => {
        if (table === "scan_candidates" || table === "scan_evidence") {
          return { delete: vi.fn().mockReturnValue(makeDeleteQuery()), insert };
        }
        if (table === "scan_model_runs" || table === "sync_events") {
          return { insert };
        }
        return { upsert };
      }),
      storage: { from: vi.fn().mockReturnValue({ upload }) },
    });
    const second = await syncLookupToCloud(makeLookup());
    expect(second.ok).toBe(true);
  });

  it("syncs waitlist and feedback rows without storing service-role credentials", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
    const insert = vi.fn().mockResolvedValue({ error: null });
    mocks.createClient.mockReturnValue({
      auth: {
        getSession: vi.fn(),
        signInAnonymously: vi.fn(),
      },
      from: vi.fn().mockReturnValue({ insert }),
      storage: {
        from: vi.fn(),
      },
    });
    const { syncFeedbackToCloud, syncWaitlistSignupToCloud } = await import("./cloudSync");

    await expect(
      syncWaitlistSignupToCloud({
        createdAt: "2026-05-18T00:00:00.000Z",
        email: "user@example.com",
        id: "waitlist-1",
        mainProblem: "I want help identifying leaks.",
        userType: "car_owner",
      }),
    ).resolves.toEqual({ ok: true, message: "Waitlist entry synced." });
    await expect(
      syncFeedbackToCloud({
        category: "scanner",
        contactEmail: "",
        createdAt: "2026-05-18T00:00:00.000Z",
        id: "feedback-1",
        message: "The scanner should explain what to photograph.",
      }),
    ).resolves.toEqual({ ok: true, message: "Feedback synced." });
    await syncFeedbackToCloud({
      category: "ai_result",
      contactEmail: "",
      createdAt: "2026-09-26T00:00:00.000Z",
      id: "feedback-structured",
      issue: "wrong_part",
      context: { scanId: "scan-1", predictedPart: "Alternator" },
      message: "It is a starter.",
    });
    expect(insert).toHaveBeenLastCalledWith({
      category: "ai_result",
      contact_email: null,
      message: "DeepSpec report v1\nIssue: wrong_part\nScan: scan-1\nPrediction: Alternator\n\nIt is a starter.",
      source: "pwa",
    });
    expect(insert).toHaveBeenCalledTimes(3);
  });

  describe("waitlist signup failures", () => {
    const signup = {
      createdAt: "2026-05-18T00:00:00.000Z",
      email: "user@example.com",
      id: "waitlist-1",
      mainProblem: "I want help identifying leaks.",
      userType: "car_owner" as const,
    };

    async function syncWithInsertError(error: { code?: string; message: string }) {
      vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
      vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
      mocks.createClient.mockReturnValue({
        auth: { getSession: vi.fn(), signInAnonymously: vi.fn() },
        from: vi.fn().mockReturnValue({ insert: vi.fn().mockResolvedValue({ error }) }),
        storage: { from: vi.fn() },
      });
      const { syncWaitlistSignupToCloud } = await import("./cloudSync");
      return syncWaitlistSignupToCloud(signup);
    }

    it("treats an email that is already on the waitlist as joined, not as a failure", async () => {
      await expect(syncWithInsertError({
        code: "23505",
        message: 'duplicate key value violates unique constraint "waitlist_signups_email_lower_idx"',
      })).resolves.toEqual({ ok: true, message: "Already on the waitlist." });
    });

    it("does not blame anonymous sign-ins just because the table name contains 'signup'", async () => {
      const result = await syncWithInsertError({
        code: "42501",
        message: 'new row violates row-level security policy for table "waitlist_signups"',
      });

      expect(result.ok).toBe(false);
      expect(result.message).toMatch(/security check/i);
      expect(result.message).not.toMatch(/anonymous/i);
    });

    it("still explains a genuinely disabled anonymous sign-in", async () => {
      const result = await syncWithInsertError({ message: "Anonymous sign-ins are disabled" });

      expect(result.message).toMatch(/anonymous sign-ins enabled/i);
    });
  });

  it("checks runtime cloud health across auth, storage, row write, durable details, and RLS isolation", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
    const upload = vi.fn().mockResolvedValue({ error: null });
    const remove = vi.fn().mockResolvedValue({ error: null });
    const upsert = vi.fn().mockResolvedValue({ error: null });
    const candidateInsert = vi.fn().mockResolvedValue({ error: null });
    const evidenceInsert = vi.fn().mockResolvedValue({ error: null });
    const correctionUpsert = vi.fn().mockResolvedValue({ error: null });
    const modelRunInsert = vi.fn().mockResolvedValue({ error: null });
    const syncEventInsert = vi.fn().mockResolvedValue({ error: null });
    const ownerDeleteQuery = makeDeleteQuery();
    const crossReadEq = vi.fn().mockResolvedValue({ data: [], error: null });
    const crossReadFrom = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({ eq: crossReadEq }),
    });
    mocks.createClient
      .mockReturnValueOnce({
        auth: {
          signInAnonymously: vi.fn().mockResolvedValue({ data: { user: { id: "owner-1" } }, error: null }),
        },
        from: vi.fn((table: string) => {
          if (table === "scan_lookups") {
            return {
              delete: vi.fn().mockReturnValue(ownerDeleteQuery),
              upsert,
            };
          }
          if (table === "scan_candidates") return { insert: candidateInsert };
          if (table === "scan_evidence") return { insert: evidenceInsert };
          if (table === "scan_corrections") return { upsert: correctionUpsert };
          if (table === "scan_model_runs") return { insert: modelRunInsert };
          if (table === "sync_events") {
            return {
              delete: vi.fn().mockReturnValue(ownerDeleteQuery),
              insert: syncEventInsert,
            };
          }
          throw new Error(`Unexpected table ${table}`);
        }),
        storage: {
          from: vi.fn().mockReturnValue({ remove, upload }),
        },
      })
      .mockReturnValueOnce({
        auth: {
          signInAnonymously: vi.fn().mockResolvedValue({ data: { user: { id: "other-1" } }, error: null }),
        },
        from: crossReadFrom,
        storage: {
          from: vi.fn(),
        },
      });
    const { getCloudHealthSnapshot, verifyCloudHealth } = await import("./cloudSync");

    const report = await verifyCloudHealth();

    expect(report.overall).toBe("ready");
    expect(report.lastVerifiedAt).toBe(report.checkedAt);
    expect(report.checks.configured.status).toBe("pass");
    expect(report.checks.anonymousAuth.status).toBe("pass");
    expect(report.checks.storageUpload.status).toBe("pass");
    expect(report.checks.rowUpsert.status).toBe("pass");
    expect(report.checks.datasetDetails.status).toBe("pass");
    expect(report.checks.rlsIsolation.status).toBe("pass");
    expect(upload).toHaveBeenCalledWith(
      expect.stringMatching(/^owner-1\/health-.+\.jpg$/),
      expect.any(Blob),
      expect.objectContaining({ contentType: "image/jpeg", upsert: false }),
    );
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        image_path: expect.stringMatching(/^owner-1\/health-.+\.jpg$/),
        scan_category: "unknown",
        training_label: "Runtime Health Check",
        training_status: "raw_unreviewed",
        user_id: "owner-1",
      }),
      { onConflict: "user_id,local_id" },
    );
    expect(crossReadFrom).toHaveBeenCalledWith("scan_lookups");
    expect(crossReadFrom).toHaveBeenCalledWith("scan_candidates");
    expect(crossReadFrom).toHaveBeenCalledWith("scan_evidence");
    expect(crossReadFrom).toHaveBeenCalledWith("scan_corrections");
    expect(crossReadFrom).toHaveBeenCalledWith("scan_model_runs");
    expect(crossReadFrom).toHaveBeenCalledWith("sync_events");
    expect(crossReadEq).toHaveBeenCalledWith("local_id", expect.stringMatching(/^health-/));
    expect(crossReadEq).toHaveBeenCalledWith("scan_local_id", expect.stringMatching(/^health-/));
    expect(candidateInsert).toHaveBeenCalledWith(expect.objectContaining({ scan_local_id: expect.stringMatching(/^health-/) }));
    expect(evidenceInsert).toHaveBeenCalledWith(expect.objectContaining({ evidence_type: "observation" }));
    expect(correctionUpsert).toHaveBeenCalledWith(expect.objectContaining({ scan_local_id: expect.stringMatching(/^health-/) }), {
      onConflict: "user_id,scan_local_id",
    });
    expect(modelRunInsert).toHaveBeenCalledWith(expect.objectContaining({ provider: "runtime-health" }));
    expect(syncEventInsert).toHaveBeenCalledWith(expect.objectContaining({ event_type: "verify", status: "success" }));
    expect(remove).toHaveBeenCalledWith([expect.stringMatching(/^owner-1\/health-.+\.jpg$/)]);
    expect(getCloudHealthSnapshot().overall).toBe("ready");
  });

  it("reports the anonymous auth step as blocked before storage checks run", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
    const upload = vi.fn();
    mocks.createClient.mockReturnValue({
      auth: {
        signInAnonymously: vi.fn().mockResolvedValue({ data: { user: null }, error: { message: "Database error creating anonymous user" } }),
      },
      from: vi.fn(),
      storage: {
        from: vi.fn().mockReturnValue({ upload }),
      },
    });
    const { verifyCloudHealth } = await import("./cloudSync");

    const report = await verifyCloudHealth();

    expect(report.overall).toBe("blocked");
    expect(report.checks.configured.status).toBe("pass");
    expect(report.checks.anonymousAuth.status).toBe("fail");
    expect(report.checks.storageUpload.status).toBe("unknown");
    expect(report.checks.datasetDetails.status).toBe("unknown");
    expect(report.lastVerifiedAt).toBeNull();
    expect(upload).not.toHaveBeenCalled();
  });

  it("shares one Supabase client with the auth service instead of creating a second GoTrueClient", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
    const insert = vi.fn().mockResolvedValue({ error: null });
    mocks.createClient.mockReturnValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "shared-user" } }, error: null }),
        getSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: "user-1" } } }, error: null }),
        signInAnonymously: vi.fn().mockResolvedValue({ data: { user: { id: "shared-user" } }, error: null }),
        onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
      },
      from: vi.fn().mockReturnValue({ insert }),
      storage: { from: vi.fn() },
    });

    const auth = await import("./auth");
    const cloudSync = await import("./cloudSync");

    // Both modules resolve their client through the same auth singleton, so the
    // browser only ever holds one GoTrueClient on the shared auth-token key.
    await auth.getVerifiedAuthUser();
    await cloudSync.syncFeedbackToCloud({
      category: "scanner",
      contactEmail: "",
      createdAt: "2026-05-18T00:00:00.000Z",
      id: "feedback-1",
      message: "Shared client regression check.",
    });

    expect(mocks.createClient).toHaveBeenCalledTimes(1);
  });
});

function makeDeleteQuery() {
  const secondEq = vi.fn().mockResolvedValue({ error: null });
  const firstEq = vi.fn().mockReturnValue({ eq: secondEq });
  return { eq: firstEq };
}

function makeLookup(): Lookup {
  return {
    analyzedAt: "2026-05-18T00:00:03.000Z",
    chatHistory: [],
    correction: null,
    createdAt: "2026-05-18T00:00:00.000Z",
    frame: {
      capturedAt: "2026-05-18T00:00:00.000Z",
      imageBase64: "data:image/jpeg;base64,aGVsbG8=",
    },
    id: "lookup-1",
    notes: "",
    rating: null,
    result: {
      confidence: "high",
      concerns: [],
      evidence: ["Pulley and vented housing are visible."],
      isSafetyCritical: false,
      needsBetterPhoto: false,
      nextAction: "Take a close-up label photo if needed.",
      partName: "Alternator",
      safetyTriage: "can_help",
      scanCategory: "electrical",
      candidateMatches: [
        {
          confidence: "low",
          partName: "Starter motor",
          reason: "Similar engine-bay component, but no belt pulley.",
          scanCategory: "electrical",
        },
      ],
      visibleObservations: ["Belt-driven housing is visible."],
      evidenceRegions: [
        {
          label: "Pulley",
          observation: "Belt pulley appears in the center of the scan.",
          regionLabel: "center",
        },
      ],
      whatItDoes: "It charges the battery while the engine runs.",
      sourceLinks: [
        {
          label: "Dataset sample: Alternator",
          sourceType: "dataset",
          url: "https://example.com/alternator.jpg",
        },
      ],
      modelRun: {
        provider: "huggingface",
        model: "Qwen/Qwen2.5-VL-7B-Instruct",
        latencyMs: 1234,
        fallbackReason: "rate_limited",
        ocrUsed: false,
      },
    },
    scanQuality: {
      accepted: true,
      averageLuminance: 126,
      brightPixelRatio: 0.01,
      brightnessScore: 98,
      cameraId: "rear-camera",
      checkedAt: "2026-05-18T00:00:01.000Z",
      darkPixelRatio: 0,
      firstPass: true,
      glareScore: 95,
      gradientVariance: 240,
      motionFallback: true,
      motionScore: null,
      motionStable: true,
      objectSizeRatio: 0.05,
      sampleHeight: 72,
      sampleWidth: 96,
      sharpnessScore: 100,
      targetCenteredScore: 72,
      targetConfidence: 0.82,
      targetLocked: true,
    },
    scanCategory: "electrical",
    trainingLabel: "Alternator",
    trainingStatus: "raw_unreviewed",
    provenance: {
      analysisSource: "ai_detection",
      captureMode: "camera",
      savedAt: "2026-05-18T00:00:03.000Z",
    },
  };
}
