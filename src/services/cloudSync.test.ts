import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { Lookup } from "../types";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: mocks.createClient,
}));

describe("cloudSync", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("VITE_SUPABASE_URL", "");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "");
    mocks.createClient.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("stays disabled when Supabase public config is missing", async () => {
    const { getCloudHealthSnapshot, getCloudSyncStatus, syncLookupToCloud } = await import("./cloudSync");

    expect(getCloudSyncStatus()).toEqual({
      configured: false,
      message: "Cloud sync is off. Add Supabase public config after parent-approved privacy setup.",
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
        getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
        signInAnonymously: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } }, error: null }),
      },
      from,
      storage: {
        from: vi.fn().mockReturnValue({ upload }),
      },
    });
    const { syncLookupToCloud } = await import("./cloudSync");

    const result = await syncLookupToCloud(makeLookup());

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
    expect(modelRunInsert).toHaveBeenCalledWith(expect.objectContaining({ model: "unknown", provider: "unknown", scan_local_id: "lookup-1" }));
    expect(syncEventInsert).toHaveBeenCalledWith(expect.objectContaining({ event_type: "upsert", status: "success" }));
  });

  it("does not call configured cloud sync ready before the verifier proves it", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
    const { getCloudSyncStatus } = await import("./cloudSync");

    expect(getCloudSyncStatus()).toEqual({
      configured: true,
      message: "Cloud sync is configured but not verified. Run the Supabase verifier before calling storage, RLS, and dataset tables ready.",
    });
  });

  it("returns a plain-language error when anonymous sign-in is not enabled", async () => {
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
      message: "Cloud sync needs Supabase anonymous sign-ins enabled before scans can upload.",
    });
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
        getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
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
    expect(insert).toHaveBeenCalledTimes(2);
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
    },
    scanCategory: "electrical",
    trainingLabel: "Alternator",
    trainingStatus: "raw_unreviewed",
  };
}
