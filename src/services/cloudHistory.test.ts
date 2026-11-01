import { setActiveAccount } from "../lib/accountScope";
import { beforeEach, describe, expect, it, vi } from "vitest";

type SelectResult = { data: unknown; error: { message?: string } | null };

const mocks = vi.hoisted(() => ({
  select: vi.fn<(columns: string) => SelectResult>(),
  eq: vi.fn(),
  limit: vi.fn(),
  signedUrls: vi.fn(),
}));

vi.mock("./auth", () => ({
  isSupabaseAuthConfigured: () => true,
  getAuthClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }) },
    from: () => ({
      select: (columns: string) => {
        const query = {
          eq: (...args: unknown[]) => { mocks.eq(...args); return query; },
          order: () => query,
          limit: async (limit: number) => { mocks.limit(limit); return mocks.select(columns); },
        };
        return query;
      },
    }),
    storage: { from: () => ({ createSignedUrls: mocks.signedUrls }) },
  }),
}));

const shopRow = {
  local_id: "scan-1",
  created_at: "2026-09-18T12:00:00.000Z",
  scan_category: "electrical",
  training_status: "raw_unreviewed",
  chat_history: [],
  image_path: null,
  job_id: "job-7",
  org_id: "org-1",
  review_status: "confirmed",
  vehicle_context: { make: "Toyota", model: "Camry", vin: "1HGCM82633A004352" },
};

const inspection = {
  confirmedPartName: "Alternator", partNumber: "ALT-42", identityEvidence: "Read stamped number",
  visibleCondition: "no_visible_damage", visibleNotes: "Housing intact",
  functionalStatus: "not_tested", functionalNotes: "", inspectorName: "Sam",
  inspectedAt: "2026-09-20T12:00:00.000Z",
};

describe("readCloudLookups", () => {
  beforeEach(() => {
    setActiveAccount("user-1");
    mocks.select.mockReset();
    mocks.eq.mockReset();
    mocks.limit.mockReset();
    mocks.signedUrls.mockReset();
    mocks.signedUrls.mockResolvedValue({ data: [], error: null });
  });

  it("reads the verified account history with its owner filter and limit despite an obsolete preview flag", async () => {
    vi.stubEnv("VITE_DEEPSPEC_GUEST_PREVIEW", "true");
    mocks.select.mockReturnValue({ data: [shopRow], error: null });
    try {
      const { readCloudLookups } = await import("./cloudHistory");
      const result = await readCloudLookups(12);
      expect(result.ok && result.value.map(({ id }) => id)).toEqual(["scan-1"]);
      expect(mocks.eq).toHaveBeenCalledWith("user_id", "user-1");
      expect(mocks.limit).toHaveBeenCalledWith(12);
    } finally { vi.unstubAllEnvs(); }
  });

  it("loads the cloud revision with the snapshot, including through optional-column fallback", async () => {
    mocks.select.mockImplementation((columns) => columns.includes("job_id")
      ? { data: null, error: { message: "column scan_lookups.job_id does not exist" } }
      : { data: [{ ...shopRow, revision: 7 }], error: null });
    const { readCloudLookups } = await import("./cloudHistory");
    const result = await readCloudLookups();
    expect(result.ok && result.value[0].cloudRevision).toBe(7);
    expect(mocks.select.mock.calls.every(([columns]) => columns.split(",").includes("revision"))).toBe(true);
  });

  it.each(["other", "round-trip"])("discards a history response after account changes: %s", async (mode) => {
    mocks.select.mockImplementation(() => {
      setActiveAccount("other");
      if (mode === "round-trip") setActiveAccount("user-1");
      return { data: [shopRow], error: null };
    });
    const { readCloudLookups } = await import("./cloudHistory");
    expect(await readCloudLookups()).toEqual({ ok: false, message: "Account changed. Reload your saved scans." });
  });

  it("reads human inspection separately from AI and training fields", async () => {
    mocks.select.mockReturnValue({ data: [{ ...shopRow, inspection_json: inspection }], error: null });
    const { readCloudLookups } = await import("./cloudHistory");
    const result = await readCloudLookups();
    expect(result.ok && result.value[0]).toMatchObject({ inspection, trainingStatus: "raw_unreviewed" });
    expect(result.ok && result.value[0].result).toBeUndefined();
  });

  it("retains grounded chat references and paragraphs in an account's saved cloud scan", async () => {
    const message = { id: "reply-1", role: "assistant", content: "Visible wear\n\nCompare the marking.", timestamp: "2026-09-18T12:00:00.000Z", sources: [{ label: "Reference", url: "https://example.com/reference", sourceType: "reference" }] };
    mocks.select.mockReturnValue({ data: [{ ...shopRow, chat_history: [message] }], error: null });
    const { readCloudLookups } = await import("./cloudHistory");
    const result = await readCloudLookups();
    expect(result.ok && result.value[0].chatHistory).toEqual([message]);
  });

  it("retains shop columns when only the inspection migration is missing", async () => {
    mocks.select.mockImplementation((columns) => columns.includes("inspection_json")
      ? { data: null, error: { message: "column scan_lookups.inspection_json does not exist" } }
      : { data: [shopRow], error: null });
    const { readCloudLookups } = await import("./cloudHistory");
    const result = await readCloudLookups();
    expect(mocks.select).toHaveBeenCalledTimes(2);
    expect(result.ok && result.value[0]).toMatchObject({ jobId: "job-7", inspection: undefined });
  });

  it("reads core history when both optional migrations are missing", async () => {
    mocks.select.mockImplementation((columns) => columns.includes("inspection_json")
      ? { data: null, error: { message: "Could not find the 'inspection_json' column in the schema cache" } }
      : columns.includes("job_id")
        ? { data: null, error: { message: "column scan_lookups.job_id does not exist" } }
        : { data: [{ local_id: "scan-1" }], error: null });
    const { readCloudLookups } = await import("./cloudHistory");
    const result = await readCloudLookups();
    expect(mocks.select).toHaveBeenCalledTimes(3);
    expect(result.ok && result.value[0].id).toBe("scan-1");
  });

  it("retains inspection when only the shop migration is missing", async () => {
    mocks.select.mockImplementation((columns) => columns.includes("job_id")
      ? { data: null, error: { message: "column scan_lookups.job_id does not exist" } }
      : { data: [{ local_id: "scan-1", inspection_json: inspection }], error: null });
    const { readCloudLookups } = await import("./cloudHistory");
    const result = await readCloudLookups();
    expect(mocks.select).toHaveBeenCalledTimes(2);
    expect(mocks.select.mock.calls[1][0]).toContain("inspection_json");
    expect(result.ok && result.value[0].inspection).toEqual(inspection);
  });

  it("reads the shop fields, so a cloud-only shop scan keeps its job and vehicle", async () => {
    mocks.select.mockImplementation(() => ({ data: [shopRow], error: null }));
    const { readCloudLookups } = await import("./cloudHistory");

    const result = await readCloudLookups();

    expect(mocks.select.mock.calls[0][0]).toContain("job_id");
    expect(result.ok && result.value[0]).toMatchObject({
      jobId: "job-7",
      orgId: "org-1",
      reviewStatus: "confirmed",
      vehicleContext: { make: "Toyota", vin: "1HGCM82633A004352" },
    });
  });

  it("falls back to the core columns on a database without the shop-mode migration", async () => {
    mocks.select.mockImplementation((columns) =>
      columns.includes("job_id")
        ? { data: null, error: { message: "column scan_lookups.job_id does not exist" } }
        : { data: [{ ...shopRow, job_id: undefined, org_id: undefined, review_status: undefined, vehicle_context: undefined }], error: null },
    );
    const { readCloudLookups } = await import("./cloudHistory");

    const result = await readCloudLookups();

    expect(mocks.select).toHaveBeenCalledTimes(2);
    expect(mocks.select.mock.calls[1][0]).not.toContain("job_id");
    expect(result.ok && result.value.map((lookup) => lookup.id)).toEqual(["scan-1"]);
  });

  it("reports other errors without retrying", async () => {
    mocks.select.mockImplementation(() => ({ data: null, error: { message: "permission denied for table scan_lookups" } }));
    const { readCloudLookups } = await import("./cloudHistory");

    const result = await readCloudLookups();

    expect(mocks.select).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ ok: false, message: "permission denied for table scan_lookups" });
  });
});

describe("readCloudLookup", () => {
  beforeEach(() => {
    setActiveAccount("user-1");
    mocks.select.mockReset();
    mocks.eq.mockReset();
    mocks.limit.mockReset();
    mocks.signedUrls.mockReset();
    mocks.signedUrls.mockResolvedValue({ data: [], error: null });
  });

  it("reads only the requested record for the verified account and restores its photo, result, and chat", async () => {
    const chat = [{ id: "message-1", role: "assistant", content: "Keep this cloud answer.", timestamp: "2026-09-18T12:01:00.000Z" }];
    mocks.select.mockReturnValue({
      data: [{
        ...shopRow,
        image_path: "user-1/scan-1/original.webp",
        chat_history: chat,
        result_json: { partName: "Cloud alternator", confidence: "high", evidence: [] },
      }],
      error: null,
    });
    mocks.signedUrls.mockResolvedValue({
      data: [{ path: "user-1/scan-1/original.webp", signedUrl: "https://example.test/private-photo" }],
      error: null,
    });

    const { readCloudLookup } = await import("./cloudHistory");
    const result = await readCloudLookup("scan-1");

    expect(mocks.eq.mock.calls).toEqual(expect.arrayContaining([
      ["user_id", "user-1"],
      ["local_id", "scan-1"],
    ]));
    expect(mocks.limit).toHaveBeenCalledWith(2);
    expect(result).toMatchObject({
      ok: true,
      value: {
        id: "scan-1",
        frame: { imageBase64: "https://example.test/private-photo" },
        result: { partName: "Cloud alternator" },
        chatHistory: chat,
      },
    });
  });

  it("returns not found instead of substituting a different row", async () => {
    mocks.select.mockReturnValue({ data: [{ ...shopRow, local_id: "different-scan" }], error: null });
    const { readCloudLookup } = await import("./cloudHistory");

    expect(await readCloudLookup("scan-1")).toEqual({ ok: true, value: null });
  });

  it("returns a retryable read error without weakening the account filter", async () => {
    mocks.select.mockReturnValue({ data: null, error: { message: "temporary gateway outage" } });
    const { readCloudLookup } = await import("./cloudHistory");

    expect(await readCloudLookup("scan-1")).toEqual({ ok: false, message: "temporary gateway outage" });
    expect(mocks.eq).toHaveBeenCalledWith("user_id", "user-1");
    expect(mocks.eq).toHaveBeenCalledWith("local_id", "scan-1");
  });

  it("fails closed when a private scan photo cannot be signed", async () => {
    mocks.select.mockReturnValue({
      data: [{ ...shopRow, image_path: "user-1/scan-1/original.webp" }],
      error: null,
    });
    mocks.signedUrls.mockResolvedValue({ data: [], error: { message: "storage unavailable" } });
    const { readCloudLookup } = await import("./cloudHistory");

    expect(await readCloudLookup("scan-1")).toEqual({
      ok: false,
      message: "The saved scan photo could not be loaded. Try again.",
    });
  });

  it("discards the exact record if the active account changes while it is loading", async () => {
    mocks.select.mockImplementation(() => {
      setActiveAccount("user-2");
      return { data: [shopRow], error: null };
    });
    const { readCloudLookup } = await import("./cloudHistory");

    expect(await readCloudLookup("scan-1")).toEqual({ ok: false, message: "Account changed. Reload your saved scans." });
  });
});
