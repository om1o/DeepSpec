import { setActiveAccount } from "../lib/accountScope";
import { beforeEach, describe, expect, it, vi } from "vitest";

type SelectResult = { data: unknown; error: { message?: string } | null };

const mocks = vi.hoisted(() => ({
  select: vi.fn<(columns: string) => SelectResult>(),
}));

vi.mock("./auth", () => ({
  isSupabaseAuthConfigured: () => true,
  getAuthClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }) },
    from: () => ({
      select: (columns: string) => ({
        eq: () => ({ order: () => ({ limit: async () => mocks.select(columns) }) }),
      }),
    }),
    storage: { from: () => ({ createSignedUrls: async () => ({ data: [], error: null }) }) },
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
