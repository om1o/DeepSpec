import { setActiveAccount } from "../lib/accountScope";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConditionAssessment } from "../types";
import { confirmVehicleContextField } from "../lib/vehicleContext";

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

const conditionAssessment = (photoId: string): ConditionAssessment => ({
  version: 1, observations: [{ id: "edge", text: "Orange flaking is visible.", photoIds: [photoId] }],
  possibleCauses: [{ text: "Moisture exposure is possible, but unconfirmed.", observationIds: ["edge"] }],
  unknowns: ["Depth and hidden condition are unknown."],
  nextEvidence: { kind: "photo", request: "Photograph the reverse of the edge.", purpose: "Show the hidden surface.", photoIds: [photoId] },
});

describe("readCloudLookupForReport", () => {
  const base = "user-1/scan-1/";
  const signed = (path: string) => `https://project.supabase.co/storage/v1/object/sign/scan-images/${path}?token=fresh`;
  const box = { x: .1, y: .1, width: .3, height: .4, confidence: .8 };
  const reportRow = () => ({ ...shopRow, image_path: `${base}original.png`, inspection_json: inspection,
    notes: "saved review notes", correction: "Corrected part", result_json: { partName: "Rocker panel", conditionAssessment: conditionAssessment("detail") },
    evidence_bundle_json: { version: 1,
      photos: [{ id: "overview", label: "overview", capturedAt: "now", imagePath: `${base}original.png` }, { id: "detail", label: "close_up", capturedAt: "later", imagePath: `${base}detail.png` }],
      isolatedImagePath: `${base}mask.png`, focusBox: box, focusMode: "mask",
      isolatedObjects: [{ name: "Missing mask", category: "engine", primary: true, focusBox: box, imagePath: `${base}mask.png` },
        { name: "Cleared crop", category: "engine", primary: false, focusBox: box, focusMode: "crop", correctedAt: "today", imagePath: null }],
    } });
  beforeEach(() => {
    setActiveAccount("user-1"); vi.stubEnv("VITE_SUPABASE_URL", "https://project.supabase.co");
    mocks.select.mockReset(); mocks.eq.mockReset(); mocks.limit.mockReset(); mocks.signedUrls.mockReset();
    mocks.select.mockReturnValue({ data: [reportRow()], error: null });
    mocks.signedUrls.mockResolvedValue({ data: [{ path: `${base}original.png`, signedUrl: signed(`${base}original.png`) }], error: null });
  });
  afterEach(() => vi.unstubAllEnvs());

  it("retains all saved metadata/photo identities when one photo and mask cannot be signed, while normal restoration still fails", async () => {
    const { readCloudLookupForReport, readCloudLookup } = await import("./cloudHistory");
    const result = await readCloudLookupForReport("scan-1");
    expect(result.ok).toBe(true);
    if (!result.ok || !result.value) throw new Error("expected export projection");
    expect(result.value).toMatchObject({ inspection, notes: "saved review notes", correction: "Corrected part" });
    expect(result.value.photos?.map(({ id, imageBase64 }) => [id, imageBase64])).toEqual([["overview", signed(`${base}original.png`)], ["detail", ""]]);
    expect(result.value.result?.conditionAssessment).toEqual(conditionAssessment("detail"));
    expect(result.value.isolatedObjects?.[1]).toMatchObject({ isolatedImageBase64: "", correctedAt: "today" });
    expect(result.unavailableImages).toEqual([{ kind: "photo", photoId: "detail" }, { kind: "cutout" }, { kind: "cutout", selectionName: "Missing mask" }]);
    expect(await readCloudLookup("scan-1")).toMatchObject({ ok: false });
    expect(mocks.eq).toHaveBeenCalledWith("user_id", "user-1"); expect(mocks.eq).toHaveBeenCalledWith("local_id", "scan-1");
  });

  it("keeps a cloud-only legacy root and its condition references without substituting a brand image when signing fails", async () => {
    mocks.select.mockReturnValue({ data: [{ ...shopRow, image_path: `${base}original.png`, result_json: { partName: "Rocker", conditionAssessment: conditionAssessment("photo-1") } }], error: null });
    mocks.signedUrls.mockRejectedValue(new Error("private signing error with token"));
    const { readCloudLookupForReport } = await import("./cloudHistory");
    const result = await readCloudLookupForReport("scan-1");
    expect(result.ok && result.value?.frame.imageBase64).toBe("");
    expect(result.ok && result.value?.result?.conditionAssessment).toEqual(conditionAssessment("photo-1"));
    expect(result.ok && result.unavailableImages).toEqual([{ kind: "photo", photoId: "photo-1" }]);
    expect(JSON.stringify(result)).not.toContain("private signing error");
  });

  it.each(["owner", "scan", "bundle"])("rejects foreign %s paths before requesting any signed asset", async (kind) => {
    const row = reportRow();
    if (kind === "owner") row.image_path = "other/scan-1/original.png";
    if (kind === "scan") row.image_path = "user-1/other/original.png";
    if (kind === "bundle") row.evidence_bundle_json.photos[1].imagePath = "other/scan-1/detail.png";
    mocks.select.mockReturnValue({ data: [row], error: null });
    const { readCloudLookupForReport } = await import("./cloudHistory");
    expect(await readCloudLookupForReport("scan-1")).toMatchObject({ ok: false });
    expect(mocks.signedUrls).not.toHaveBeenCalled();
  });

  it.each(["origin", "path"])("does not accept a signing response with the wrong %s", async (kind) => {
    mocks.signedUrls.mockResolvedValue({ data: [{ path: `${base}original.png`, signedUrl: kind === "origin"
      ? "https://foreign.example/photo.png" : signed("user-1/other/original.png") }], error: null });
    const { readCloudLookupForReport } = await import("./cloudHistory");
    const result = await readCloudLookupForReport("scan-1");
    expect(result.ok && result.value?.frame.imageBase64).toBe("");
    expect(result.ok && result.unavailableImages).toContainEqual({ kind: "photo", photoId: "overview" });
  });

  it("rejects a mismatched authenticated owner and a changed account during signing", async () => {
    const { readCloudLookupForReport } = await import("./cloudHistory");
    setActiveAccount("user-2"); expect(await readCloudLookupForReport("scan-1")).toMatchObject({ ok: false });
    expect(mocks.select).not.toHaveBeenCalled(); expect(mocks.signedUrls).not.toHaveBeenCalled();
    setActiveAccount("user-1"); mocks.signedUrls.mockImplementation(async () => { setActiveAccount("user-2"); return { data: [], error: null }; });
    expect(await readCloudLookupForReport("scan-1")).toEqual({ ok: false, message: "Account changed. Reload your saved scans." });
  });
});

describe("readCloudLookups", () => {
  beforeEach(() => {
    setActiveAccount("user-1");
    mocks.select.mockReset();
    mocks.eq.mockReset();
    mocks.limit.mockReset();
    mocks.signedUrls.mockReset();
    mocks.signedUrls.mockResolvedValue({ data: [], error: null });
  });

  it.each(["same_part_or_area", "independent", "unknown", undefined] as const)("restores relationship %s with every photo and cutout, keeping corrected crops empty", async (photoRelationship) => {
    const base = "user-1/scan-1/";
    const box = { x: 0.1, y: 0.1, width: 0.3, height: 0.4, confidence: 0.8 };
    const bundle = { version: 1, ...(photoRelationship !== undefined ? { photoRelationship } : {}),
      photos: [{ id: "overview", label: "overview", capturedAt: "now", imagePath: `${base}original.jpg` }, { id: "detail", label: "close_up", capturedAt: "later", imagePath: `${base}detail.jpg` }],
      isolatedObjects: [{ name: "Primary", category: "engine", primary: true, focusBox: box, imagePath: `${base}primary.png` }, { name: "Secondary", category: "electrical", primary: false, focusBox: box, imagePath: `${base}secondary.png` }, { name: "Corrected", category: "engine", primary: false, focusBox: box, imagePath: null, focusMode: "crop", correctedAt: "today" }],
      focusBox: box, focusMode: "mask", isolatedImagePath: `${base}primary.png`,
    };
    mocks.select.mockReturnValue({ data: [{ ...shopRow, image_path: `${base}original.jpg`, evidence_bundle_json: bundle }], error: null });
    mocks.signedUrls.mockImplementation(async (paths: string[]) => ({ data: paths.map((path) => ({ path, signedUrl: `https://images/${path}?signed=new` })), error: null }));
    const { readCloudLookup } = await import("./cloudHistory");
    const result = await readCloudLookup("scan-1");
    expect(result.ok).toBe(true);
    if (!result.ok || !result.value) throw new Error("expected a cloud scan");
    expect(result.value.photos?.map((photo) => photo.id)).toEqual(["overview", "detail"]);
    expect(result.value.photoRelationship).toBe(photoRelationship);
    expect(result.value.photos?.[1].imageBase64).toContain("detail.jpg?signed=new");
    expect(result.value.isolatedObjects?.[1].isolatedImageBase64).toContain("secondary.png?signed=new");
    expect(result.value.isolatedObjects?.[2]).toMatchObject({ isolatedImageBase64: "", focusMode: "crop", correctedAt: "today" });
    expect(result.value.isolatedImageBase64).toContain("primary.png?signed=new");
    const { normalizeLookup, scanStateFromLookup } = await import("./storage");
    const reopened = scanStateFromLookup(normalizeLookup(result.value)!);
    expect(reopened.photos).toEqual(result.value.photos);
    expect(reopened.photoRelationship).toBe(photoRelationship);
    expect(reopened.isolatedObjects).toEqual(result.value.isolatedObjects);
    expect(mocks.signedUrls).toHaveBeenCalledWith([`${base}original.jpg`, `${base}detail.jpg`, `${base}primary.png`, `${base}secondary.png`], 3600);
  });

  it.each(["detail", "photo-1", "other-scan-photo"])("validates restored condition references against the owned evidence bundle: %s", async (photoId) => {
    const base = "user-1/scan-1/";
    const assessment = conditionAssessment(photoId);
    const bundle = { version: 1, photos: [
      { id: "overview", label: "overview", capturedAt: "now", imagePath: `${base}original.jpg` },
      { id: "detail", label: "close_up", capturedAt: "later", imagePath: `${base}detail.jpg` },
    ] };
    mocks.select.mockReturnValue({ data: [{ ...shopRow, image_path: `${base}original.jpg`, evidence_bundle_json: bundle,
      result_json: { partName: "Rocker panel", conditionAssessment: assessment }, inspection_json: inspection }], error: null });
    mocks.signedUrls.mockImplementation(async (paths: string[]) => ({ data: paths.map((path) => ({ path, signedUrl: `https://images/${path}?signed=new` })), error: null }));
    const { readCloudLookup } = await import("./cloudHistory");
    const loaded = await readCloudLookup("scan-1");
    expect(loaded.ok).toBe(true);
    if (!loaded.ok || !loaded.value) throw new Error("expected cloud scan");
    expect(loaded.value.inspection).toEqual(inspection);
    expect(loaded.value.reviewStatus).toBe("confirmed");
    expect(loaded.value.result?.partName).toBe("Rocker panel");
    if (photoId === "detail") {
      expect(loaded.value.result?.conditionAssessment).toEqual(assessment);
      const { normalizeLookup, scanStateFromLookup } = await import("./storage");
      expect(scanStateFromLookup(normalizeLookup(loaded.value)!).result?.conditionAssessment).toEqual(assessment);
    } else expect(loaded.value.result).not.toHaveProperty("conditionAssessment");
  });

  it.each([true, false])("allows legacy photo-1 only when an original was restored (available: %s)", async (available) => {
    const imagePath = "user-1/scan-1/original.jpg";
    const assessment = conditionAssessment("photo-1");
    mocks.select.mockReturnValue({ data: [{ ...shopRow, image_path: available ? imagePath : null,
      result_json: { partName: "Rocker panel", conditionAssessment: assessment }, inspection_json: inspection }], error: null });
    mocks.signedUrls.mockResolvedValue({ data: [{ path: imagePath, signedUrl: "https://images/original.jpg?signed=new" }], error: null });
    const { readCloudLookup } = await import("./cloudHistory");
    const loaded = await readCloudLookup("scan-1");
    expect(loaded.ok).toBe(true);
    if (!loaded.ok || !loaded.value) throw new Error("expected legacy cloud scan");
    expect(loaded.value.inspection).toEqual(inspection);
    if (available) expect(loaded.value.result?.conditionAssessment).toEqual(assessment);
    else expect(loaded.value.result).not.toHaveProperty("conditionAssessment");
  });

  it.each(["other-owner", "other-scan", "missing-image", "malformed", "invalid-relationship"])("does not partially restore unsafe evidence: %s", async (kind) => {
    const imagePath = kind === "other-owner" ? "user-2/scan-1/photo.jpg" : kind === "other-scan" ? "user-1/scan-2/photo.jpg" : "user-1/scan-1/photo.jpg";
    const bundle = { version: 1, ...(kind === "invalid-relationship" ? { photoRelationship: "same_car" } : {}), photos: [{ id: "detail", label: kind === "malformed" ? "not-a-label" : "close_up", capturedAt: "now", imagePath }] };
    mocks.select.mockReturnValue({ data: [{ ...shopRow, evidence_bundle_json: bundle }], error: null });
    const { readCloudLookup } = await import("./cloudHistory");
    expect(await readCloudLookup("scan-1")).toMatchObject({ ok: false });
    if (kind !== "missing-image") expect(mocks.signedUrls).not.toHaveBeenCalled();
  });

  it("reads old scans when the evidence column migration has not landed", async () => {
    mocks.select.mockImplementation((columns) => columns.includes("evidence_bundle_json")
      ? { data: null, error: { message: "column scan_lookups.evidence_bundle_json does not exist" } }
      : { data: [shopRow], error: null });
    const { readCloudLookups } = await import("./cloudHistory");
    expect(await readCloudLookups()).toMatchObject({ ok: true });
    expect(mocks.select).toHaveBeenCalledTimes(2);
    expect(mocks.select.mock.calls[1][0]).toContain("inspection_json");
    expect(mocks.select.mock.calls[1][0]).not.toContain("evidence_bundle_json");
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

  it("restores confirmed vehicle facts and new metadata through cloud and local parsing", async () => {
    let context = confirmVehicleContextField({ year: "2014", make: "Toyota", engine: "2.5L", mileage: "120000", mileageUnit: "km", modifications: { status: "none_known" }, customerName: "Customer" }, "mileage", true, "2026-11-05T12:00:00.000Z");
    context = confirmVehicleContextField(context, "modifications", true, "2026-11-05T12:00:00.000Z");
    mocks.select.mockReturnValue({ data: [{ ...shopRow, vehicle_context: context }], error: null });
    const { readCloudLookups } = await import("./cloudHistory");
    const { normalizeLookup } = await import("./storage");
    const result = await readCloudLookups();
    if (!result.ok) throw new Error(result.message);
    expect(result.value[0].vehicleContext).toEqual(context);
    expect(normalizeLookup(result.value[0])?.vehicleContext).toEqual(context);
    expect(result.value[0].vehicleContext?.confirmedFields?.year).toBeUndefined();
  });

  it("keeps cloud legacy facts but rejects changed values, units and invalid confirmation metadata", async () => {
    let context = confirmVehicleContextField({ engine: "2.0L", mileage: "120000", mileageUnit: "mi" }, "engine", true, "2026-11-05T12:00:00.000Z");
    context = confirmVehicleContextField(context, "mileage", true, "2026-11-05T12:00:00.000Z");
    mocks.select.mockReturnValue({ data: [{ ...shopRow, vehicle_context: { ...context, engine: "2.5L", mileageUnit: "km", modifications: { status: "invalid" }, make: "Toyota" } }], error: null });
    const { readCloudLookups } = await import("./cloudHistory");
    const result = await readCloudLookups();
    if (!result.ok) throw new Error(result.message);
    expect(result.value[0].vehicleContext).toEqual({ make: "Toyota", engine: "2.5L", mileage: "120000", mileageUnit: "km" });
    expect(result.value[0].reviewStatus).toBe("confirmed");
    expect(result.value[0].vehicleContext?.confirmedFields).toBeUndefined();
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
