import { getLookups } from "./storage";
import { accountStorageKey, getAccountScope, isAccountScopeCurrent, type AccountScope } from "../lib/accountScope";
import { normalizeVehicleContext, vehicleContextDetails } from "../lib/vehicleContext";
import type {
  CustomerVisibleReport,
  Lookup,
  Organization,
  OrganizationMember,
  ShopFeedbackPermission,
  ShopJob,
  ShopJobStatus,
  ShopReviewStatus,
  ShopVehicleContext,
} from "../types";

export const SHOP_ORG_STORAGE_KEY = "deep-spec:shop:organization";
export const SHOP_MEMBERS_STORAGE_KEY = "deep-spec:shop:members";
export const SHOP_JOBS_STORAGE_KEY = "deep-spec:shop:jobs";
export const SHOP_PERMISSION_STORAGE_KEY = "deep-spec:shop:feedback-permission";

const DEFAULT_ORG_ID = "00000000-0000-4000-8000-000000000001";
const DEFAULT_OWNER_USER_ID = "local-owner";
const MAX_SHOP_JOBS = 200;
const SHOP_JOBS_CHANGED = "deep-spec:shop-jobs-changed";
const validStoredId = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9._:-]{1,160}$/.test(value) && value !== "." && value !== "..";

export type StorageResult<T> =
  | {
      ok: true;
      value: T;
    }
  | {
      ok: false;
      message: string;
      value: T;
    };

export type ShopJobInput = ShopVehicleContext & {
  make: string;
  model: string;
  orgId?: string;
  symptom: string;
  technicianName: string;
  title: string;
  year: string;
};

export type ShopMetrics = {
  confirmedScans: number;
  correctionRate: string;
  correctedScans: number;
  learnedCorrections: number;
  needsReviewScans: number;
  scansByTechnician: Array<{ count: number; technicianName: string }>;
  scansTotal: number;
  shopLearningOptIn: boolean;
  topMissedCategories: Array<{ category: string; count: number }>;
  totalJobs: number;
  usefulRate: string;
};

export function ensureDefaultOrganization(): Organization {
  const existing = readJson<Organization>(SHOP_ORG_STORAGE_KEY, isOrganization);
  if (existing) {
    return existing;
  }

  const createdAt = new Date().toISOString();
  const organization: Organization = {
    id: DEFAULT_ORG_ID,
    createdAt,
    name: "DeepSpec Shop",
    ownerUserId: DEFAULT_OWNER_USER_ID,
    slug: "deepspec-shop",
  };
  writeJson(SHOP_ORG_STORAGE_KEY, organization);
  writeJson(SHOP_MEMBERS_STORAGE_KEY, [
    {
      id: `${DEFAULT_ORG_ID}-owner`,
      createdAt,
      orgId: DEFAULT_ORG_ID,
      role: "owner",
      userId: DEFAULT_OWNER_USER_ID,
    } satisfies OrganizationMember,
  ]);
  writeJson(SHOP_PERMISSION_STORAGE_KEY, {
    orgId: DEFAULT_ORG_ID,
    learningOptIn: false,
    updatedAt: createdAt,
  } satisfies ShopFeedbackPermission);

  return organization;
}

export function getCurrentOrganization(): Organization {
  return ensureDefaultOrganization();
}

export function getOrganizationMembers(orgId = getCurrentOrganization().id): OrganizationMember[] {
  const members = readJson<OrganizationMember[]>(SHOP_MEMBERS_STORAGE_KEY, isOrganizationMemberArray) ?? [];
  return members.filter((member) => member.orgId === orgId);
}

export function getShopFeedbackPermission(orgId = getCurrentOrganization().id): ShopFeedbackPermission {
  const existing = readJson<ShopFeedbackPermission>(SHOP_PERMISSION_STORAGE_KEY, isShopFeedbackPermission);
  if (existing?.orgId === orgId) {
    return existing;
  }

  return {
    orgId,
    learningOptIn: false,
    updatedAt: new Date().toISOString(),
  };
}

export function setShopLearningOptIn(orgId: string, learningOptIn: boolean): ShopFeedbackPermission {
  const permission: ShopFeedbackPermission = {
    orgId,
    learningOptIn,
    updatedAt: new Date().toISOString(),
  };
  writeJson(SHOP_PERMISSION_STORAGE_KEY, permission);
  return permission;
}

export function createShopJob(input: ShopJobInput): StorageResult<ShopJob | null> {
  const org = ensureDefaultOrganization();
  const validation = validateShopJobInput(input);
  if (validation) {
    return { ok: false, message: validation, value: null };
  }

  const now = new Date().toISOString();
  const job: ShopJob = normalizeShopJob({
    id: createId("job"),
    bayOrRo: clean(input.bayOrRo, 80),
    createdAt: now,
    createdByUserId: DEFAULT_OWNER_USER_ID,
    customerName: clean(input.customerName, 120),
    engine: clean(input.engine, 120),
    make: clean(input.make, 80),
    mileage: clean(input.mileage, 40),
    mileageUnit: input.mileageUnit,
    modifications: input.modifications,
    confirmedFields: input.confirmedFields,
    model: clean(input.model, 80),
    notes: clean(input.notes, 500),
    orgId: input.orgId || org.id,
    plate: clean(input.plate, 40),
    reviewStatus: "needs_review",
    scanIds: [],
    status: "open",
    symptom: clean(input.symptom, 500),
    technicianName: clean(input.technicianName, 120),
    title: clean(input.title, 140),
    updatedAt: now,
    vin: cleanVin(input.vin),
    year: clean(input.year, 20),
  });

  const writeResult = writeJobs([job, ...getShopJobs()].slice(0, MAX_SHOP_JOBS));
  return writeResult.ok
    ? { ok: true, value: job }
    : { ok: false, message: writeResult.message, value: job };
}

export function getShopJobs(orgId = getCurrentOrganization().id): ShopJob[] {
  const jobs = readJson<ShopJob[]>(SHOP_JOBS_STORAGE_KEY, isShopJobArray) ?? [];
  const lookups = getLookups();
  return jobs
    .filter((job) => job.orgId === orgId)
    .map(normalizeShopJob)
    // The job's status is derived from its scans, which are rated/corrected after they're attached;
    // re-derive on read so it doesn't stay stuck at whatever it was at attach time. Keep the stored
    // value when none of its scans are on this device (evicted, or saved on another device).
    .map((job) => ({ ...job, reviewStatus: getReviewStatusForScans(job.scanIds, lookups) ?? job.reviewStatus }))
    .sort((left, right) => getTime(right.updatedAt) - getTime(left.updatedAt));
}

export function getShopJob(jobId: string): ShopJob | null {
  const normalizedId = clean(jobId, 120);
  if (!normalizedId) {
    return null;
  }

  return getShopJobs().find((job) => job.id === normalizedId) ?? null;
}

/** An explicit read must not confuse unreadable private storage with a missing job. */
export function readShopJob(jobId: string, scope = getAccountScope()): StorageResult<ShopJob | null> {
  const failed = (message: string): StorageResult<ShopJob | null> => ({ ok: false, value: null, message });
  const changed = "Account changed. Reopen the job in the account that owns it.";
  if (!isAccountScopeCurrent(scope)) return failed(changed);
  if (!validStoredId(jobId)) return failed("This saved job reference is invalid.");
  try {
    if (!hasLocalStorage()) throw new Error("Storage unavailable");
    const raw = localStorage.getItem(accountStorageKey(SHOP_JOBS_STORAGE_KEY));
    if (!isAccountScopeCurrent(scope)) return failed(changed);
    if (raw === null) return { ok: true, value: null };
    const parsed: unknown = JSON.parse(raw);
    if (!isShopJobArray(parsed) || parsed.some((job) => !validStoredId(job.id) || !job.scanIds.every(validStoredId))
      || new Set(parsed.map((job) => job.id)).size !== parsed.length) throw new Error("Unreadable jobs");
    const saved = parsed.find((job) => job.id === jobId);
    // Avoid the legacy normalizer's fallback lookup read: scan availability is
    // checked separately by the handoff context, never silently treated as empty.
    const value = saved ? normalizeShopJob({ ...saved, reviewStatus: isShopReviewStatus(saved.reviewStatus) ? saved.reviewStatus : "needs_review" }) : null;
    return isAccountScopeCurrent(scope) ? { ok: true, value } : failed(changed);
  } catch {
    return failed("Shop jobs could not be read safely on this device. Existing records were preserved; reopen the job before preparing a handoff.");
  }
}

/** Observe only this captured account, including changes made by another tab. */
export function subscribeShopJobs(listener: () => void, scope: AccountScope = getAccountScope()): () => void {
  if (!isAccountScopeCurrent(scope) || typeof window === "undefined") return () => {};
  const key = accountStorageKey(SHOP_JOBS_STORAGE_KEY);
  const onLocal = (event: Event) => { if (isAccountScopeCurrent(scope) && (event as CustomEvent<string>).detail === key) listener(); };
  const onStorage = (event: StorageEvent) => { if (isAccountScopeCurrent(scope) && event.storageArea === localStorage && (event.key === key || event.key === null)) listener(); };
  window.addEventListener(SHOP_JOBS_CHANGED, onLocal); window.addEventListener("storage", onStorage);
  return () => { window.removeEventListener(SHOP_JOBS_CHANGED, onLocal); window.removeEventListener("storage", onStorage); };
}

export function updateShopJob(jobId: string, patch: Partial<Pick<ShopJob, "status" | "vin" | "year" | "make" | "model" | "mileage" | "mileageUnit" | "modifications" | "confirmedFields" | "engine" | "notes" | "reviewStatus">>): StorageResult<ShopJob | null> {
  const jobs = getShopJobs();
  const index = jobs.findIndex((job) => job.id === jobId);
  if (index === -1) {
    return { ok: false, message: "Shop job was not found.", value: null };
  }

  const updated: ShopJob = normalizeShopJob({
    ...jobs[index],
    ...(isShopJobStatus(patch.status) ? { status: patch.status } : {}),
    ...(isShopReviewStatus(patch.reviewStatus) ? { reviewStatus: patch.reviewStatus } : {}),
    ...(typeof patch.vin === "string" ? { vin: cleanVin(patch.vin) } : {}),
    ...(typeof patch.year === "string" ? { year: clean(patch.year, 20) } : {}),
    ...(typeof patch.make === "string" ? { make: clean(patch.make, 80) } : {}),
    ...(typeof patch.model === "string" ? { model: clean(patch.model, 80) } : {}),
    ...(typeof patch.mileage === "string" ? { mileage: clean(patch.mileage, 40) } : {}),
    ...("mileageUnit" in patch ? { mileageUnit: patch.mileageUnit } : {}),
    ...("modifications" in patch ? { modifications: patch.modifications } : {}),
    ...("confirmedFields" in patch ? { confirmedFields: patch.confirmedFields } : {}),
    ...(typeof patch.engine === "string" ? { engine: clean(patch.engine, 120) } : {}),
    ...(typeof patch.notes === "string" ? { notes: clean(patch.notes, 500) } : {}),
    updatedAt: new Date().toISOString(),
  });

  const next = [...jobs];
  next[index] = updated;
  const writeResult = writeJobs(next);
  return writeResult.ok
    ? { ok: true, value: updated }
    : { ok: false, message: writeResult.message, value: updated };
}

export function attachScanToJob(jobId: string, lookupId: string): StorageResult<ShopJob | null> {
  const jobs = getShopJobs();
  const index = jobs.findIndex((job) => job.id === jobId);
  if (index === -1) {
    return { ok: false, message: "Shop job was not found.", value: null };
  }

  const job = jobs[index];
  const scanIds = Array.from(new Set([lookupId, ...job.scanIds]));
  const updated: ShopJob = {
    ...job,
    reviewStatus: getReviewStatusForScanIds(scanIds),
    scanIds,
    status: job.status === "open" ? "in_progress" : job.status,
    updatedAt: new Date().toISOString(),
  };

  const next = [...jobs];
  next[index] = updated;
  const writeResult = writeJobs(next);
  return writeResult.ok
    ? { ok: true, value: updated }
    : { ok: false, message: writeResult.message, value: updated };
}

export function getVehicleContextForJob(job: ShopJob): ShopVehicleContext {
  return normalizeVehicleContext({
    bayOrRo: job.bayOrRo,
    customerName: job.customerName,
    engine: job.engine,
    jobTitle: job.title,
    make: job.make,
    mileage: job.mileage,
    mileageUnit: job.mileageUnit,
    modifications: job.modifications,
    confirmedFields: job.confirmedFields,
    model: job.model,
    notes: job.notes,
    plate: job.plate,
    symptom: job.symptom,
    technicianName: job.technicianName,
    vin: job.vin,
    year: job.year,
  }) ?? {};
}

export function getShopJobScans(job: ShopJob): Lookup[] {
  const scanIds = new Set(job.scanIds);
  return getLookups().filter((lookup) => lookup.jobId === job.id || scanIds.has(lookup.id));
}

export function searchShopJobs(query: string, jobs = getShopJobs()): ShopJob[] {
  const normalized = normalizeSearchText(query);
  if (!normalized) {
    return jobs;
  }

  return jobs.filter((job) => normalizeSearchText([
    job.title,
    job.year,
    job.make,
    job.model,
    job.vin,
    job.plate,
    job.bayOrRo,
    job.customerName,
    job.symptom,
    job.technicianName,
    job.notes,
  ].join(" ")).includes(normalized));
}

export function getShopMetrics(
  jobs = getShopJobs(),
  lookups = getLookups(),
  permission = getShopFeedbackPermission(),
): ShopMetrics {
  const jobIds = new Set(jobs.map((job) => job.id));
  const jobScanIds = new Set(jobs.flatMap((job) => job.scanIds));
  const scans = lookups.filter((lookup) => (lookup.jobId && jobIds.has(lookup.jobId)) || jobScanIds.has(lookup.id));
  const confirmedScans = scans.filter((scan) => scan.reviewStatus === "confirmed" || scan.trainingStatus === "user_confirmed").length;
  const correctedScans = scans.filter((scan) => scan.reviewStatus === "corrected" || scan.trainingStatus === "user_corrected" || Boolean(scan.correction?.trim())).length;
  const needsReviewScans = scans.filter((scan) => !scan.reviewStatus || scan.reviewStatus === "needs_review").length;

  return {
    confirmedScans,
    correctionRate: formatRate(correctedScans, scans.length),
    correctedScans,
    learnedCorrections: permission.learningOptIn ? correctedScans : 0,
    needsReviewScans,
    scansByTechnician: countBy(scans, (scan) => scan.vehicleContext?.technicianName || "Unassigned technician")
      .map(([technicianName, count]) => ({ technicianName, count })),
    scansTotal: scans.length,
    shopLearningOptIn: permission.learningOptIn,
    topMissedCategories: countBy(
      scans.filter((scan) => scan.correction?.trim()),
      (scan) => scan.scanCategory,
    ).map(([category, count]) => ({ category, count })),
    totalJobs: jobs.length,
    usefulRate: formatRate(confirmedScans, scans.length),
  };
}

/**
 * `latest` is the scan being saved. The report is built before that scan is stored, so without
 * it the job's newest stored scan — the previous one — was described as the latest result.
 */
export function buildCustomerVisibleReport(
  job: ShopJob,
  scans = getShopJobScans(job),
  latest?: Pick<Lookup, "result" | "correction">,
): CustomerVisibleReport {
  const latestScan = latest ?? scans[0];
  const topPart = latestScan?.correction?.trim() || latestScan?.result?.partName || "part scan";
  const confidence = latestScan?.result?.confidence ? `${latestScan.result.confidence} confidence` : "needs review";
  return {
    generatedAt: new Date().toISOString(),
    summary: `${job.year} ${job.make} ${job.model}: ${job.symptom}. Latest DeepSpec result: ${topPart} (${confidence}). Verify fitment with VIN, label/OCR, or a second angle before ordering parts.`,
    title: `${job.title} customer report`,
  };
}

export function buildCustomerJobReport(job: ShopJob, scans = getShopJobScans(job)) {
  const lines = [
    "DeepSpec shop report",
    `Job: ${job.title}`,
    `Technician: ${job.technicianName}`,
    job.customerName ? `Customer: ${job.customerName}` : "",
    "Vehicle details and intake:",
    ...vehicleContextDetails(getVehicleContextForJob(job)).map(([label, value]) => `${label}: ${label === "VIN" && !job.vin ? "not provided — not confirmed" : value}`),
    "",
    `Scans: ${scans.length}`,
    ...scans.flatMap((scan, index) => [
      `${index + 1}. ${scan.correction?.trim() || scan.result?.partName || "Unidentified scan"}`,
      `   Status: ${scan.reviewStatus ?? "needs_review"}`,
      `   Fitment confidence: ${scan.result?.fitmentConfidence ?? "needs_vehicle_context"}`,
      scan.result?.requiredNextEvidence?.length
        ? `   Required next evidence: ${scan.result.requiredNextEvidence.join(", ")}`
        : "   Required next evidence: VIN, label photo, second angle, or measurement reference if fitment is uncertain.",
    ]),
    "",
    "Do not treat this as exact OEM fitment unless VIN, OCR label, or a verified source supports it.",
  ].filter(Boolean);

  return `${lines.join("\n")}\n`;
}

function validateShopJobInput(input: ShopJobInput) {
  const required = [
    ["job title", input.title],
    ["vehicle year", input.year],
    ["vehicle make", input.make],
    ["vehicle model", input.model],
    ["symptom/complaint", input.symptom],
    ["technician", input.technicianName],
  ] as const;
  const missing = required.filter(([, value]) => !clean(value, 20)).map(([label]) => label);
  return missing.length ? `Add ${missing.join(", ")} before starting a shop scan.` : "";
}

function writeJobs(jobs: ShopJob[]): StorageResult<ShopJob[]> {
  const normalized = jobs.map(normalizeShopJob).slice(0, MAX_SHOP_JOBS);
  if (!hasLocalStorage()) {
    return { ok: false, message: "Shop jobs are not available in this browser.", value: normalized };
  }

  try {
    const key = accountStorageKey(SHOP_JOBS_STORAGE_KEY);
    localStorage.setItem(key, JSON.stringify(normalized));
    try { if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(SHOP_JOBS_CHANGED, { detail: key })); }
    catch { /* A notification cannot undo the committed job. */ }
    return { ok: true, value: normalized };
  } catch {
    return { ok: false, message: "DeepSpec could not save this shop job on this device.", value: normalized };
  }
}

function normalizeShopJob(job: ShopJob): ShopJob {
  const cleaned = {
    ...job,
    bayOrRo: clean(job.bayOrRo, 80),
    customerName: clean(job.customerName, 120),
    engine: clean(job.engine, 120),
    make: clean(job.make, 80),
    mileage: clean(job.mileage, 40),
    model: clean(job.model, 80),
    notes: clean(job.notes, 500),
    plate: clean(job.plate, 40),
    reviewStatus: isShopReviewStatus(job.reviewStatus) ? job.reviewStatus : getReviewStatusForScanIds(job.scanIds),
    scanIds: Array.from(new Set(Array.isArray(job.scanIds) ? job.scanIds.filter(Boolean) : [])),
    status: isShopJobStatus(job.status) ? job.status : "open",
    symptom: clean(job.symptom, 500),
    technicianName: clean(job.technicianName, 120),
    title: clean(job.title, 140),
    updatedAt: job.updatedAt || job.createdAt,
    vin: cleanVin(job.vin),
    year: clean(job.year, 20),
  };
  // Confirmations are bound to the saved values, including mileage units and
  // modification details. Legacy jobs stay supplied until explicitly confirmed.
  const context = normalizeVehicleContext(cleaned);
  return { ...cleaned, mileageUnit: context?.mileageUnit, modifications: context?.modifications, confirmedFields: context?.confirmedFields };
}

function getReviewStatusForScanIds(scanIds: string[]): ShopReviewStatus {
  return getReviewStatusForScans(scanIds, getLookups()) ?? "needs_review";
}

/** The job's review status from its scans on this device, or null when none of them are here. */
function getReviewStatusForScans(scanIds: string[], lookups: Lookup[]): ShopReviewStatus | null {
  const scans = lookups.filter((lookup) => scanIds.includes(lookup.id));
  if (!scans.length) {
    return null;
  }

  if (scans.some((scan) => scan.reviewStatus === "corrected" || scan.trainingStatus === "user_corrected" || scan.correction?.trim())) {
    return "corrected";
  }

  if (scans.every((scan) => scan.reviewStatus === "confirmed" || scan.trainingStatus === "user_confirmed")) {
    return "confirmed";
  }

  return "needs_review";
}

function countBy<T>(items: T[], selector: (item: T) => string) {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = selector(item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return [...counts.entries()].sort((left, right) => right[1] - left[1]).slice(0, 5);
}

function formatRate(part: number, total: number) {
  return total > 0 ? `${Math.round((part / total) * 100)}%` : "No data";
}

function readJson<T>(key: string, guard: (value: unknown) => value is T): T | null {
  if (!hasLocalStorage()) {
    return null;
  }

  try {
    const raw = localStorage.getItem(accountStorageKey(key));
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as unknown;
    return guard(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown) {
  if (!hasLocalStorage()) {
    return;
  }

  try {
    localStorage.setItem(accountStorageKey(key), JSON.stringify(value));
  } catch {
    // The caller still gets the in-memory object; persistence failures surface on job writes.
  }
}

function isOrganization(value: unknown): value is Organization {
  return isRecord(value)
    && isUuid(value.id)
    && typeof value.createdAt === "string"
    && typeof value.name === "string"
    && typeof value.slug === "string";
}

function isOrganizationMemberArray(value: unknown): value is OrganizationMember[] {
  return Array.isArray(value)
    && value.every((member) => isRecord(member)
      && typeof member.id === "string"
      && typeof member.orgId === "string"
      && typeof member.userId === "string"
      && (member.role === "owner" || member.role === "admin" || member.role === "technician" || member.role === "viewer"));
}

function isShopFeedbackPermission(value: unknown): value is ShopFeedbackPermission {
  return isRecord(value)
    && typeof value.orgId === "string"
    && typeof value.learningOptIn === "boolean"
    && typeof value.updatedAt === "string";
}

function isShopJobArray(value: unknown): value is ShopJob[] {
  return Array.isArray(value)
    && value.every((job) => isRecord(job)
      && typeof job.id === "string"
      && typeof job.createdAt === "string"
      && typeof job.orgId === "string"
      && typeof job.title === "string"
      && typeof job.year === "string"
      && typeof job.make === "string"
      && typeof job.model === "string"
      && typeof job.symptom === "string"
      && typeof job.technicianName === "string"
      && Array.isArray(job.scanIds));
}

function isShopJobStatus(value: unknown): value is ShopJobStatus {
  return value === "open" || value === "in_progress" || value === "ready_for_review" || value === "closed";
}

function isShopReviewStatus(value: unknown): value is ShopReviewStatus {
  return value === "needs_review" || value === "confirmed" || value === "corrected";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function clean(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, maxLength) : "";
}

function cleanVin(value: unknown) {
  return clean(value, 17).toUpperCase();
}

function normalizeSearchText(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function getTime(value: string) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function hasLocalStorage() {
  return typeof localStorage !== "undefined";
}

function createId(prefix: string) {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
