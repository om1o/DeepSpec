import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Lookup } from "../types";
import { setActiveAccount } from "../lib/accountScope";
import { getLookup, recordCloudRevision, saveExistingLookup, updateLookup } from "./storage";
import { syncLookupToCloud } from "./cloudSync";
import { mergeCloudLookup } from "../lib/lookupMerge";
import { emptyPartInspection } from "../lib/partInspection";

const mocks = vi.hoisted(() => ({ client: {} as unknown }));
vi.mock("./auth", () => ({ getAuthClient: async () => mocks.client }));

// Stateful PostgREST double: predicates are evaluated when the write executes,
// not when the device starts saving. Both devices share this cloud state.
function cloud() {
  let row: Record<string, unknown> | null = null;
  let beforeWrite: (() => void) | undefined;
  let afterWrite: (() => Promise<void>) | undefined;
  let detailError = false;
  let beforeDetails: (() => Promise<void>) | undefined;
  const details: Record<string, unknown> = {};
  const pauseDetails = async () => {
    const hook = beforeDetails; beforeDetails = undefined; await hook?.();
  };
  let writeError: { message: string; code?: string } | undefined;
  const detailWrites: string[] = [];
  const objects = new Map<string, Blob>();
  const upload = vi.fn(async (path: string, blob: Blob, options: { upsert: boolean }) => {
    if (objects.has(path) && !options.upsert) return { error: { statusCode: "409", message: "The resource already exists" } };
    objects.set(path, blob);
    return { error: null };
  });
  const client = {
    auth: { getSession: async () => ({ data: { session: { user: { id: "user-1" } } }, error: null }) },
    storage: { from: () => ({ upload }) },
    rpc: vi.fn(async (_name: string, args: Record<string, unknown>) => {
      await pauseDetails();
      if (detailError) return { data: null, error: { message: "Detail network error" } };
      if (row?.revision !== args.p_revision || row?.local_id !== args.p_scan_local_id) return { data: false, error: null };
      Object.assign(details, structuredClone({
        scan_candidates: args.p_candidates, scan_evidence: args.p_evidence,
        scan_corrections: args.p_correction, job_scans: args.p_job_scan,
      }));
      detailWrites.push(...Object.keys(details));
      return { data: true, error: null };
    }),
    from: (table: string) => {
      let operation = "";
      let payload: Record<string, unknown> = {};
      const filters: Record<string, unknown> = {};
      const execute = async () => {
        if (table !== "scan_lookups") {
          await pauseDetails();
          detailWrites.push(table);
          details[table] = structuredClone(payload);
          return { data: null, error: detailError ? { message: "Detail network error" } : null };
        }
        if (writeError) { const error = writeError; writeError = undefined; return { data: null, error }; }
        const hook = beforeWrite; beforeWrite = undefined; hook?.();
        if (operation === "insert" && row) return { data: null, error: { code: "23505", message: "duplicate key" } };
        if (operation === "update" && (!row || Object.entries(filters).some(([key, value]) => row?.[key] !== value))) {
          return { data: null, error: null };
        }
        row = { ...row, ...structuredClone(payload), revision: Number(row?.revision ?? 0) + 1 };
        const response = { data: { revision: row.revision }, error: null };
        const after = afterWrite; afterWrite = undefined; await after?.();
        return response;
      };
      const query = {
        insert: (value: Record<string, unknown>) => { operation = "insert"; payload = value; return query; },
        upsert: (value: Record<string, unknown>) => { operation = "upsert"; payload = value; return query; },
        update: (value: Record<string, unknown>) => { operation = "update"; payload = value; return query; },
        delete: () => query,
        eq: (key: string, value: unknown) => { filters[key] = value; return query; },
        select: () => query,
        maybeSingle: execute,
        then: <T>(resolve: (value: Awaited<ReturnType<typeof execute>>) => T) => execute().then(resolve),
      };
      return query;
    },
  };
  return { client, details, detailWrites, objects, upload,
    delayWriteResponse: (hook: () => Promise<void>) => { afterWrite = hook; },
    interleaveDetails: (hook: () => Promise<void>) => { beforeDetails = hook; }, get row() { return row; }, race: (hook: () => void) => { beforeWrite = hook; },
    failDetails: (fail: boolean) => { detailError = fail; },
    rejectNextWrite: (error: { message: string; code?: string }) => { writeError = error; },
    change: (patch: Record<string, unknown>) => { row = { ...row, ...patch }; } };
}

function lookup(): Lookup {
  return {
    id: "shared-scan", createdAt: "2026-09-20T00:00:00.000Z",
    frame: { capturedAt: "2026-09-20T00:00:00.000Z", imageBase64: "data:image/jpeg;base64,aGVsbG8=" },
    correction: null, rating: null, notes: "", chatHistory: [], scanCategory: "unknown",
    trainingLabel: "unlabeled", trainingStatus: "raw_unreviewed",
    provenance: { analysisSource: "ai_detection", captureMode: "camera", savedAt: "2026-09-20T00:00:00.000Z" },
  };
}

describe("cross-device cloud saves", () => {
  beforeEach(() => {
    localStorage.clear(); setActiveAccount("user-1");
    vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "test");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("preserves device B's newer revision when device A saves stale feedback, chat and analysis", async () => {
    const db = cloud(); mocks.client = db.client;
    saveExistingLookup(lookup());
    expect((await syncLookupToCloud(lookup())).ok).toBe(true);
    const deviceA = structuredClone(getLookup("shared-scan")!);
    updateLookup(deviceA.id, { correction: "Device B correction", rating: "up", notes: "B notes" });
    const deviceB = getLookup(deviceA.id)!;
    deviceB.chatHistory = [{ id: "b-chat", role: "user", content: "B question", timestamp: deviceB.createdAt }];
    deviceB.analysisAttemptId = "new-analysis";
    deviceB.result = {
      partName: "New analysis", confidence: "high", scanCategory: "electrical", whatItDoes: "Generates power",
      visibleObservations: [], concerns: [], safetyTriage: "can_help", isSafetyCritical: false,
      nextAction: "Inspect", needsBetterPhoto: false, evidence: [], sourceLinks: [],
    };
    localStorage.clear(); saveExistingLookup(deviceB);
    expect((await syncLookupToCloud(deviceB)).ok).toBe(true);
    const newerCloud = structuredClone(db.row);
    expect(newerCloud).toMatchObject({ revision: 2, correction: "Device B correction", rating: "up",
      chat_history: deviceB.chatHistory, analysis_attempt_id: "new-analysis", result_json: { partName: "New analysis" } });
    const detailsBefore = db.detailWrites.length;
    localStorage.clear(); saveExistingLookup(deviceA);
    updateLookup(deviceA.id, { correction: "Stale device A correction", rating: "down" });
    expect(await syncLookupToCloud(deviceA)).toMatchObject({ ok: false, message: expect.stringMatching(/newer cloud|another device/i) });
    expect(db.row).toEqual(newerCloud);
    expect(db.detailWrites).toHaveLength(detailsBefore);
    expect(getLookup(deviceA.id)?.correction).toBe("Stale device A correction");
    expect(getLookup(deviceA.id)?.cloudSave?.status).toBe("failed");
  });

  it("rejects device A's delayed child writes after device B commits a newer revision", async () => {
    const db = cloud(); mocks.client = db.client;
    const deviceA = { ...lookup(), notes: "Device A", correction: "Old correction",
      jobId: "00000000-0000-4000-8000-000000000101", orgId: "00000000-0000-4000-8000-000000000001",
      result: { partName: "Old analysis", confidence: "high" as const, scanCategory: "electrical" as const,
        whatItDoes: "Generates power", visibleObservations: ["Old evidence"], evidenceRegions: [], concerns: [],
        safetyTriage: "can_help" as const, isSafetyCritical: false, nextAction: "Inspect", needsBetterPhoto: false,
        evidence: [], sourceLinks: [], candidateMatches: [{ partName: "Old candidate", confidence: "low" as const,
          scanCategory: "electrical" as const, reason: "Old reason" }] },
    };
    saveExistingLookup(deviceA);
    let winningDetails: Record<string, unknown> = {};
    let writesAtWinner = 0;
    db.interleaveDetails(async () => {
      // A committed its parent and is now stalled before its child request executes.
      expect(db.row?.revision).toBe(1);
      const deviceASnapshot = getLookup(deviceA.id)!;
      const deviceAStorage = Object.entries(localStorage);
      // Independent module instance models device B's separate pending-save lock.
      vi.resetModules();
      const accountB = await import("../lib/accountScope");
      accountB.setActiveAccount("user-1");
      const storageB = await import("./storage");
      const syncB = await import("./cloudSync");
      const deviceB = { ...deviceASnapshot, notes: "Device B", correction: "New correction", rating: "up" as const,
        result: { ...deviceASnapshot.result!, visibleObservations: ["New evidence"],
          candidateMatches: [{ ...deviceASnapshot.result!.candidateMatches[0], partName: "New candidate" }] },
        reviewStatus: "confirmed" as const, customerVisibleReport: { title: "B report", summary: "New report", generatedAt: deviceA.createdAt } };
      localStorage.clear(); storageB.saveExistingLookup(deviceB);
      expect((await syncB.syncLookupToCloud(deviceB)).ok).toBe(true);
      expect(db.row).toMatchObject({ revision: 2, correction: "New correction" });
      winningDetails = structuredClone(db.details);
      writesAtWinner = db.detailWrites.length;
      localStorage.clear(); for (const [key, value] of deviceAStorage) localStorage.setItem(key, value);
    });
    expect(await syncLookupToCloud(deviceA)).toMatchObject({ ok: false, message: expect.stringMatching(/newer cloud/i) });
    expect(db.details).toEqual(winningDetails);
    expect(db.detailWrites).toHaveLength(writesAtWinner);
    expect(db.details.scan_candidates).toMatchObject([{ part_name: "New candidate" }]);
    expect(db.details.scan_evidence).toEqual(expect.arrayContaining([expect.objectContaining({ evidence_text: "New evidence" })]));
    expect(db.details.scan_corrections).toMatchObject({ correction_text: "New correction", rating: "up" });
    expect(db.details.job_scans).toMatchObject({ review_status: "confirmed", customer_visible_report_json: { title: "B report" } });
    expect(getLookup(deviceA.id)).toMatchObject({ cloudRevision: 1, correction: "Old correction", cloudSave: { status: "failed" } });
  });

  it("rejects an unknown legacy base and a concurrent first insert without overwriting the winner", async () => {
    const db = cloud(); mocks.client = db.client;
    saveExistingLookup(lookup());
    db.race(() => db.change({ local_id: "shared-scan", user_id: "user-1", revision: 4, correction: "Other device" }));
    expect((await syncLookupToCloud(lookup())).ok).toBe(false);
    expect(db.row).toMatchObject({ revision: 4, correction: "Other device" });
    expect((await syncLookupToCloud(lookup())).ok).toBe(false);
    expect(db.detailWrites).toEqual([]);
    expect(getLookup("shared-scan")?.cloudRevision).toBeUndefined();
  });

  it("checks the revision atomically when another device writes during upload", async () => {
    const db = cloud(); mocks.client = db.client;
    saveExistingLookup(lookup());
    expect((await syncLookupToCloud(lookup())).ok).toBe(true);
    db.race(() => db.change({ revision: 2, correction: "Concurrent winner" }));
    updateLookup("shared-scan", { correction: "Losing edit" });
    expect((await syncLookupToCloud(lookup())).ok).toBe(false);
    expect(db.row).toMatchObject({ revision: 2, correction: "Concurrent winner" });
    expect(getLookup("shared-scan")?.cloudRevision).toBe(1);
  });

  it("keeps the same revision predicate when retrying without optional shop columns", async () => {
    const db = cloud(); mocks.client = db.client;
    saveExistingLookup(lookup());
    expect((await syncLookupToCloud(lookup())).ok).toBe(true);
    db.rejectNextWrite({ message: "Could not find the 'job_id' column in the schema cache" });
    db.race(() => db.change({ revision: 2, notes: "Concurrent winner" }));
    updateLookup("shared-scan", { notes: "Stale save" });
    expect((await syncLookupToCloud(lookup())).ok).toBe(false);
    expect(db.row).toMatchObject({ revision: 2, notes: "Concurrent winner" });
    expect(getLookup("shared-scan")?.cloudRevision).toBe(1);
  });

  it("fails closed when the revision migration has not been applied", async () => {
    const db = cloud(); mocks.client = db.client;
    saveExistingLookup(lookup());
    db.rejectNextWrite({ message: "Could not find the 'revision' column in the schema cache" });
    expect(await syncLookupToCloud(lookup())).toMatchObject({ ok: false, message: expect.stringContaining("revision database migration") });
    expect(db.row).toBeNull();
    expect(db.detailWrites).toEqual([]);
  });

  it.each([
    { status: 409, statusCode: "ResourceAlreadyExists", message: "The resource already exists" },
    { status: 400, statusCode: "400", message: "The resource already exists" },
  ])("allows a repeat content-addressed upload with storage response %j", async (error) => {
    const db = cloud(); mocks.client = db.client;
    saveExistingLookup(lookup());
    expect((await syncLookupToCloud(lookup())).ok).toBe(true);
    db.upload.mockResolvedValueOnce({ error });
    updateLookup("shared-scan", { notes: "Repeat save" });
    expect((await syncLookupToCloud(lookup())).ok).toBe(true);
    expect(db.row).toMatchObject({ revision: 2, notes: "Repeat save" });
  });

  it("does not change the winning revision's photo when a stale device uploads different bytes", async () => {
    const db = cloud(); mocks.client = db.client;
    saveExistingLookup(lookup());
    expect((await syncLookupToCloud(lookup())).ok).toBe(true);
    const winningPath = db.row!.image_path as string;
    const winningBlob = db.objects.get(winningPath);
    const stale = getLookup("shared-scan")!;
    stale.frame.imageBase64 = "data:image/jpeg;base64,b3RoZXI=";
    localStorage.clear(); saveExistingLookup(stale);
    db.change({ revision: 2 });
    expect((await syncLookupToCloud(stale)).ok).toBe(false);
    expect(db.row!.image_path).toBe(winningPath);
    expect(db.objects.get(winningPath)).toBe(winningBlob);
    expect(db.objects.size).toBe(2);
    expect(db.upload.mock.calls.every(([, , options]) => options.upsert === false)).toBe(true);
  });

  it("preserves local edits during an in-flight save while advancing their confirmed base", async () => {
    const db = cloud(); mocks.client = db.client;
    saveExistingLookup(lookup());
    db.race(() => { updateLookup("shared-scan", { notes: "Typed during save" }); });
    expect((await syncLookupToCloud(lookup())).ok).toBe(true);
    expect(getLookup("shared-scan")).toMatchObject({ notes: "Typed during save", cloudRevision: 1 });
    expect(getLookup("shared-scan")?.cloudSave).toBeUndefined();
    expect(db.row!.notes).toBe("");
    expect((await syncLookupToCloud(lookup())).ok).toBe(true);
    expect(db.row).toMatchObject({ revision: 2, notes: "Typed during save" });
  });

  it.each(["insert", "update", "fallback", "inspection"])("reconciles a late %s commit without acknowledging unfinished details, then retries with CAS", async (mode) => {
    const db = cloud(); mocks.client = db.client;
    const original = lookup(); saveExistingLookup(original);
    if (mode !== "insert") expect((await syncLookupToCloud(original)).ok).toBe(true);
    if (mode === "inspection") saveExistingLookup({ ...getLookup(original.id)!,
      frame: { ...original.frame, imageBase64: "https://example.test/signed" },
      inspection: { ...emptyPartInspection, inspectorName: "Pat", inspectedAt: original.createdAt },
    });
    if (mode === "fallback") db.rejectNextWrite({ message: "Could not find the 'job_id' column in the schema cache" });
    const base = getLookup(original.id)?.cloudRevision;
    const committed = (base ?? 0) + 1;
    const writesBefore = db.detailWrites.length;
    const rpcCallsBefore = db.client.rpc.mock.calls.length;
    let release!: () => void;
    db.delayWriteResponse(() => new Promise<void>((resolve) => { release = resolve; }));
    vi.useFakeTimers();
    try {
      const saving = syncLookupToCloud(original);
      await vi.waitFor(() => expect(db.row?.revision).toBe(committed));
      expect(getLookup(original.id)?.cloudRevision).toBe(base);
      await vi.advanceTimersByTimeAsync(20_001);
      expect((await saving).ok).toBe(false);
      const failedReceipt = getLookup(original.id)?.cloudSave;
      expect(failedReceipt?.status).toBe("failed");
      expect(await syncLookupToCloud(original)).toMatchObject({ ok: false, message: expect.stringContaining("still finishing") });
      release();
      await vi.advanceTimersByTimeAsync(0);
      expect(getLookup(original.id)?.cloudRevision).toBe(committed);
      expect(getLookup(original.id)?.cloudSave).toEqual(failedReceipt);
      expect(db.detailWrites).toHaveLength(writesBefore);
      expect(db.client.rpc).toHaveBeenCalledTimes(rpcCallsBefore);

      updateLookup(original.id, { notes: "Newer local edit" });
      // Retry the original screen snapshot: the sync must read the reconciled device base.
      expect((await syncLookupToCloud(original)).ok).toBe(true);
      expect(db.row?.revision).toBe(committed + 1);
      expect(getLookup(original.id)).toMatchObject({ cloudRevision: committed + 1, notes: "Newer local edit", cloudSave: { status: "acknowledged" } });
      if (mode !== "inspection") expect(db.details.scan_corrections).toMatchObject({ notes: "Newer local edit" });
    } finally { release?.(); await vi.advanceTimersByTimeAsync(0); vi.useRealTimers(); }
  });

  it.each(["account", "revision"])("does not apply a late committed revision after the device %s changes", async (changed) => {
    const db = cloud(); mocks.client = db.client;
    const original = lookup(); saveExistingLookup(original);
    let release!: () => void;
    db.delayWriteResponse(() => new Promise<void>((resolve) => { release = resolve; }));
    vi.useFakeTimers();
    try {
      const saving = syncLookupToCloud(original);
      await vi.waitFor(() => expect(db.row?.revision).toBe(1));
      await vi.advanceTimersByTimeAsync(20_001);
      expect((await saving).ok).toBe(false);
      if (changed === "account") setActiveAccount("user-2");
      if (changed === "account") saveExistingLookup({ ...original, cloudRevision: 7 });
      else recordCloudRevision(original.id, undefined, 7);
      updateLookup(original.id, { notes: "Newer device state" });
      release(); await vi.advanceTimersByTimeAsync(0);
      expect(getLookup(original.id)).toMatchObject({ cloudRevision: 7, notes: "Newer device state" });
      expect(db.detailWrites).toEqual([]);
      expect(db.client.rpc).not.toHaveBeenCalled();
    } finally { release?.(); await vi.advanceTimersByTimeAsync(0); vi.useRealTimers(); }
  });

  it("retains the committed revision when detail sync fails so retry uses CAS", async () => {
    const db = cloud(); mocks.client = db.client;
    saveExistingLookup(lookup()); db.failDetails(true);
    expect((await syncLookupToCloud(lookup())).ok).toBe(false);
    expect(getLookup("shared-scan")?.cloudRevision).toBe(1);
    db.failDetails(false);
    expect((await syncLookupToCloud(lookup())).ok).toBe(true);
    expect(db.row!.revision).toBe(2);
  });

  it.each([
    { data: null, error: { code: "PGRST202", message: "Could not find the function public.sync_scan_details in the schema cache" } },
    { data: false, error: null },
    { data: null, error: null },
    { data: null, error: { code: "40001", message: "Serialization failure" } },
  ])("fails closed when the child transaction is unavailable or rejected: %j", async (response) => {
    const db = cloud(); mocks.client = db.client;
    saveExistingLookup(lookup());
    db.client.rpc.mockResolvedValueOnce(response);
    const result = await syncLookupToCloud(lookup());
    expect(result).toMatchObject({ ok: false });
    expect(result.message).toMatch(response.error?.code === "PGRST202" ? /child revision database migration/ : /newer cloud/);
    expect(db.detailWrites).toEqual([]);
    expect(getLookup("shared-scan")).toMatchObject({ cloudRevision: 1, cloudSave: { status: "failed" } });
  });

  it("protects inspection-only saves and never uploads a signed image URL", async () => {
    const db = cloud(); mocks.client = db.client;
    const original = lookup(); saveExistingLookup(original);
    expect((await syncLookupToCloud(original)).ok).toBe(true);
    const downloaded = { ...getLookup(original.id)!, frame: { ...original.frame, imageBase64: "https://example.test/signed" },
      inspection: { ...emptyPartInspection, inspectorName: "Pat", inspectedAt: original.createdAt } };
    localStorage.clear(); saveExistingLookup(downloaded);
    db.upload.mockClear();
    expect((await syncLookupToCloud(downloaded)).ok).toBe(true);
    expect(db.row).toMatchObject({ inspection_json: downloaded.inspection, revision: 2 });
    expect(db.row!.image_path).toMatch(/original-/);
    localStorage.clear(); saveExistingLookup(downloaded);
    expect((await syncLookupToCloud(downloaded)).ok).toBe(false);
    expect(db.upload).not.toHaveBeenCalled();
  });

  it.each([undefined, 1])("keeps the device revision %s when merging a newer inspection and refreshed image", (cloudRevision) => {
    const local = { ...lookup(), cloudRevision, frame: { ...lookup().frame, imageBase64: "https://example.test/expired" } };
    const remote = { ...lookup(), cloudRevision: 7, correction: "Cloud correction",
      frame: { ...local.frame, imageBase64: "https://example.test/refreshed" },
      inspection: { ...emptyPartInspection, inspectorName: "Pat", inspectedAt: "2026-09-22T00:00:00.000Z" } };
    const merged = mergeCloudLookup(local, remote);
    expect(merged).toMatchObject({ cloudRevision, correction: null, inspection: remote.inspection, frame: remote.frame });
    saveExistingLookup(merged);
    expect(getLookup(local.id)?.cloudRevision).toBe(cloudRevision);
    expect(mergeCloudLookup(lookup(), remote).frame).toEqual(lookup().frame);
  });
});
