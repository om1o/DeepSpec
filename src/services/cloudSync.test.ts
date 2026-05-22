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
    const upsert = vi.fn().mockResolvedValue({ error: null });
    mocks.createClient.mockReturnValue({
      auth: {
        getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
        signInAnonymously: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } }, error: null }),
      },
      from: vi.fn().mockReturnValue({ upsert }),
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
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        image_path: "user-1/lookup-1.jpg",
        local_id: "lookup-1",
        metadata_json: expect.objectContaining({
          chatMessageCount: 0,
          imagePath: "user-1/lookup-1.jpg",
          modelRuns: [],
          promptVersions: [],
          schemaVersion: 1,
          syncEvents: [],
        }),
        scan_category: "electrical",
        training_label: "Alternator",
        training_status: "raw_unreviewed",
        user_id: "user-1",
      }),
      { onConflict: "user_id,local_id" },
    );
  });

  it("does not call configured cloud sync ready before the verifier proves it", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
    const { getCloudSyncStatus } = await import("./cloudSync");

    expect(getCloudSyncStatus()).toEqual({
      configured: true,
      message: "Cloud sync is configured but not verified. Run the Supabase verifier before calling storage and RLS ready.",
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
    mocks.createClient.mockReturnValue({
      auth: {
        getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
        signInAnonymously: vi.fn().mockResolvedValue({ data: { user: { id: "user-retry" } }, error: null }),
      },
      from: vi.fn().mockReturnValue({ upsert }),
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

  it("checks runtime cloud health across auth, storage, row write, and RLS isolation", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
    const upload = vi.fn().mockResolvedValue({ error: null });
    const remove = vi.fn().mockResolvedValue({ error: null });
    const upsert = vi.fn().mockResolvedValue({ error: null });
    const ownerDeleteQuery = makeDeleteQuery();
    const crossReadEq = vi.fn().mockResolvedValue({ data: [], error: null });
    mocks.createClient
      .mockReturnValueOnce({
        auth: {
          signInAnonymously: vi.fn().mockResolvedValue({ data: { user: { id: "owner-1" } }, error: null }),
        },
        from: vi.fn().mockReturnValue({
          delete: vi.fn().mockReturnValue(ownerDeleteQuery),
          upsert,
        }),
        storage: {
          from: vi.fn().mockReturnValue({ remove, upload }),
        },
      })
      .mockReturnValueOnce({
        auth: {
          signInAnonymously: vi.fn().mockResolvedValue({ data: { user: { id: "other-1" } }, error: null }),
        },
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({ eq: crossReadEq }),
        }),
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
    expect(crossReadEq).toHaveBeenCalledWith("local_id", expect.stringMatching(/^health-/));
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
      candidateMatches: [],
      visibleObservations: ["Belt-driven housing is visible."],
      evidenceRegions: [],
      whatItDoes: "It charges the battery while the engine runs.",
      sourceLinks: [],
    },
    scanCategory: "electrical",
    trainingLabel: "Alternator",
    trainingStatus: "raw_unreviewed",
    modelRuns: [],
    syncEvents: [],
  };
}
