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
        order: () => ({ limit: async () => mocks.select(columns) }),
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

describe("readCloudLookups", () => {
  beforeEach(() => {
    mocks.select.mockReset();
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
