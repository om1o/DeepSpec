import { getAccountScope, isAccountScopeCurrent } from "../lib/accountScope";
import { getAuthClient, isSupabaseAuthConfigured } from "./auth";
import { normalizePartInspection } from "../lib/partInspection";
import { normalizeConditionAssessment } from "../lib/conditionAssessment";
import { normalizeVehicleContext } from "../lib/vehicleContext";
import { evidencePaths, isOwnedEvidencePath, parseEvidenceBundle, restoreEvidenceBundle } from "./visualEvidence";
import type {
  CandidateMatch,
  CandidatePart,
  ChatMessage,
  Confidence,
  CustomerVisibleReport,
  EvidenceRegion,
  FitmentConfidence,
  IdentificationResult,
  IdentifyModelRun,
  IdentifyProvider,
  Lookup,
  PartMeasurement,
  PossibleVehicleContext,
  Rating,
  ScanCategory,
  SceneObject,
  ShopReviewStatus,
  ShopVehicleContext,
  SourceLink,
  TrainingStatus,
} from "../types";

const SCAN_BUCKET = "scan-images";
const SIGNED_URL_TTL_SECONDS = 60 * 60;
const DEFAULT_HISTORY_LIMIT = 200;
const FALLBACK_IMAGE = "/brand/deepspec-symbol.webp";
const CLOUD_HISTORY_CORE_SELECT = "local_id,created_at,captured_at,analyzed_at,error_code,error_message,rating,correction,notes,scan_category,training_label,training_status,chat_history,result_json,image_path,revision";
// Shop-mode columns (mechanic_shop_mode migration). Not every deployed database has them, so the
// read asks for them and falls back to the core columns only when PostgREST reports one missing —
// reading the core columns alone dropped the job, vehicle, and review status from every cloud scan.
const CLOUD_HISTORY_SHOP_COLUMNS = ["customer_visible_report_json", "job_id", "org_id", "review_status", "technician_user_id", "vehicle_context"];

type CloudHistoryRow = {
  revision?: unknown;
  local_id: unknown;
  created_at: unknown;
  captured_at: unknown;
  analyzed_at: unknown;
  error_code: unknown;
  error_message: unknown;
  rating: unknown;
  correction: unknown;
  notes: unknown;
  scan_category: unknown;
  training_label: unknown;
  training_status: unknown;
  chat_history: unknown;
  customer_visible_report_json: unknown;
  job_id: unknown;
  org_id: unknown;
  result_json: unknown;
  review_status: unknown;
  technician_user_id: unknown;
  vehicle_context: unknown;
  image_path: unknown;
  analysis_attempt_id?: unknown;
  inspection_json?: unknown;
  evidence_bundle_json?: unknown;
};

type SignedImageRow = {
  path?: unknown;
  signedUrl?: unknown;
  signedURL?: unknown;
  error?: unknown;
};

type CloudHistoryQueryResult = {
  data: unknown;
  error: { message?: string } | null;
};

type ReadCloudHistoryResult =
  | { ok: true; value: Lookup[] }
  | { ok: false; message: string };

type ReadCloudLookupResult =
  | { ok: true; value: Lookup | null }
  | { ok: false; message: string };

export type ReportUnavailableImage = { kind: "photo"; photoId: string } | { kind: "cutout"; selectionName?: string };
type ReadCloudReportLookupResult =
  | { ok: true; value: Lookup | null; unavailableImages: ReportUnavailableImage[] }
  | { ok: false; message: string };

type AuthClient = NonNullable<Awaited<ReturnType<typeof getAuthClient>>>;
type VerifiedClientResult =
  | { ok: true; value: AuthClient }
  | { ok: false; message: string };

export async function readCloudLookups(limit = DEFAULT_HISTORY_LIMIT): Promise<ReadCloudHistoryResult> {
  const scope = getAccountScope();
  const changed = () => ({ ok: false as const, message: "Account changed. Reload your saved scans." });
  const clientResult = await getVerifiedCloudClient(scope);
  if (!clientResult.ok) return clientResult;
  const supabase = clientResult.value;

  const selectRows = (columns: string): PromiseLike<CloudHistoryQueryResult> => supabase
    .from("scan_lookups")
    .select(columns)
    .eq("user_id", scope.userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  const rowsResult = await selectCloudRowsWithFallback(selectRows, scope);
  if (!rowsResult) return changed();

  if (rowsResult.error) {
    return { ok: false, message: rowsResult.error.message ?? "Could not load cloud scan history." };
  }

  const rows = Array.isArray(rowsResult.data) ? (rowsResult.data as CloudHistoryRow[]) : [];
  const evidenceError = validateCloudEvidence(rows, scope.userId!);
  if (evidenceError) return { ok: false, message: evidenceError };
  const signedImageMap = await getSignedImageMap(supabase, rows, scope.userId!);
  if (!isAccountScopeCurrent(scope)) return changed();
  if (hasMissingEvidenceImages(rows, signedImageMap, scope.userId!)) return { ok: false, message: "Some saved evidence photos or cutouts could not be loaded. Reopen cloud history to retry; the scan was not restored partially." };
  const lookups = rows
    .map((row, index) => mapCloudRowToLookup(row, signedImageMap, index, scope.userId!))
    .filter((lookup): lookup is Lookup => Boolean(lookup));

  return { ok: true, value: lookups };
}

export async function readCloudLookup(id: string): Promise<ReadCloudLookupResult> {
  const requestedId = id.trim();
  if (!requestedId) return { ok: true, value: null };

  const scope = getAccountScope();
  const changed = () => ({ ok: false as const, message: "Account changed. Reload your saved scans." });
  const clientResult = await getVerifiedCloudClient(scope);
  if (!clientResult.ok) return clientResult;
  const supabase = clientResult.value;

  const selectRows = (columns: string): PromiseLike<CloudHistoryQueryResult> => supabase
    .from("scan_lookups")
    .select(columns)
    .eq("user_id", scope.userId)
    .eq("local_id", requestedId)
    .limit(2);
  const rowsResult = await selectCloudRowsWithFallback(selectRows, scope);
  if (!rowsResult) return changed();
  if (rowsResult.error) {
    return { ok: false, message: rowsResult.error.message ?? "Could not load this saved scan." };
  }

  const matchingRows = Array.isArray(rowsResult.data)
    ? (rowsResult.data as CloudHistoryRow[]).filter((row) => row.local_id === requestedId)
    : [];
  if (matchingRows.length === 0) return { ok: true, value: null };
  if (matchingRows.length > 1) {
    return { ok: false, message: "This saved scan could not be identified uniquely. Try again." };
  }

  const evidenceError = validateCloudEvidence(matchingRows, scope.userId!);
  if (evidenceError) return { ok: false, message: evidenceError };
  const signedImageMap = await getSignedImageMap(supabase, matchingRows, scope.userId!);
  if (!isAccountScopeCurrent(scope)) return changed();
  if (hasMissingEvidenceImages(matchingRows, signedImageMap, scope.userId!)) return { ok: false, message: "Some saved evidence photos or cutouts could not be loaded. Reopen this saved scan to retry; the scan was not restored partially." };
  const imagePath = matchingRows[0].image_path;
  if (isString(imagePath) && !signedImageMap.has(imagePath)) {
    return { ok: false, message: "The saved scan photo could not be loaded. Try again." };
  }
  return { ok: true, value: mapCloudRowToLookup(matchingRows[0], signedImageMap, 0, scope.userId!) };
}

/** Read-only export projection. Missing bytes never discard validated saved metadata.
 * It must not be imported into normal history, whose restoration remains all-or-nothing. */
export async function readCloudLookupForReport(id: string): Promise<ReadCloudReportLookupResult> {
  if (!/^[A-Za-z0-9._:-]{1,160}$/.test(id) || id === "." || id === "..") return { ok: false, message: "This saved scan reference is invalid." };
  const scope = getAccountScope();
  const changed = () => ({ ok: false as const, message: "Account changed. Reload your saved scans." });
  const verified = await getVerifiedCloudClient(scope);
  if (!verified.ok) return verified;
  const supabase = verified.value;
  const rowsResult = await selectCloudRowsWithFallback((columns) => supabase.from("scan_lookups").select(columns)
    .eq("user_id", scope.userId).eq("local_id", id).limit(2), scope);
  if (!rowsResult || !isAccountScopeCurrent(scope)) return changed();
  if (rowsResult.error) return { ok: false, message: "The saved cloud scan could not be read for this report." };
  const rows = Array.isArray(rowsResult.data) ? (rowsResult.data as CloudHistoryRow[]).filter((row) => row.local_id === id) : [];
  if (!rows.length) return { ok: true, value: null, unavailableImages: [] };
  if (rows.length !== 1) return { ok: false, message: "This saved scan could not be identified uniquely." };
  const row = rows[0];
  const invalid = validateCloudEvidence(rows, scope.userId!);
  if (invalid || (row.image_path != null && !isOwnedEvidencePath(row.image_path, scope.userId!, id))) {
    return { ok: false, message: "Saved evidence has invalid metadata or an image from another account or scan. No report evidence was substituted." };
  }
  let signed: Map<string, string>;
  try { signed = await getSignedImageMap(supabase, rows, scope.userId!); }
  catch { signed = new Map(); }
  if (!isAccountScopeCurrent(scope)) return changed();
  for (const [path, url] of signed) if (!validReportSignedUrl(url, path)) signed.delete(path);
  const bundle = parseEvidenceBundle(row.evidence_bundle_json, scope.userId!, id);
  const unavailableImages: ReportUnavailableImage[] = [];
  if (!isString(row.image_path) || !signed.has(row.image_path)) unavailableImages.push({ kind: "photo", photoId: bundle?.photos?.[0]?.id ?? "photo-1" });
  for (const photo of bundle?.photos ?? []) if (!signed.has(photo.imagePath)) unavailableImages.push({ kind: "photo", photoId: photo.id });
  if (bundle?.isolatedImagePath && !signed.has(bundle.isolatedImagePath)) unavailableImages.push({ kind: "cutout" });
  for (const object of bundle?.isolatedObjects ?? []) if (object.imagePath && !signed.has(object.imagePath)) unavailableImages.push({ kind: "cutout", selectionName: object.name });
  return { ok: true, value: mapCloudRowToLookup(row, signed, 0, scope.userId!, true), unavailableImages };
}

function validReportSignedUrl(value: string, path: string): boolean {
  try {
    const configured = new URL(import.meta.env.VITE_SUPABASE_URL ?? "");
    const url = new URL(value);
    const prefix = "/storage/v1/object/sign/scan-images/";
    return configured.protocol === "https:" && !configured.username && !configured.password
      && url.protocol === "https:" && url.origin === configured.origin && !url.username && !url.password && !url.hash
      && url.pathname.startsWith(prefix) && decodeURIComponent(url.pathname.slice(prefix.length)) === path && Boolean(url.searchParams.get("token"));
  } catch { return false; }
}

async function getVerifiedCloudClient(scope: ReturnType<typeof getAccountScope>): Promise<VerifiedClientResult> {
  if (!isAccountScopeCurrent(scope)) {
    return { ok: false, message: "Account changed. Reload your saved scans." };
  }
  if (!isSupabaseAuthConfigured()) {
    return { ok: false, message: "Supabase auth is not configured for this build." };
  }

  const supabase = await getAuthClient();
  if (!isAccountScopeCurrent(scope)) {
    return { ok: false, message: "Account changed. Reload your saved scans." };
  }
  if (!supabase) {
    return { ok: false, message: "Supabase auth is not configured for this build." };
  }

  const userResult = await supabase.auth.getUser();
  if (!isAccountScopeCurrent(scope)) {
    return { ok: false, message: "Account changed. Reload your saved scans." };
  }
  if (userResult.error || !userResult.data.user || userResult.data.user.id !== scope.userId) {
    return { ok: false, message: "No verified Supabase session was found." };
  }

  return { ok: true, value: supabase };
}

async function selectCloudRowsWithFallback(
  selectRows: (columns: string) => PromiseLike<CloudHistoryQueryResult>,
  scope: ReturnType<typeof getAccountScope>,
): Promise<CloudHistoryQueryResult | null> {
  let optionalColumns = [...CLOUD_HISTORY_SHOP_COLUMNS, "inspection_json", "analysis_attempt_id", "evidence_bundle_json"];
  let rowsResult = await selectRows(`${CLOUD_HISTORY_CORE_SELECT},${optionalColumns.join(",")}`);
  if (!isAccountScopeCurrent(scope)) return null;

  // Optional migrations can land independently. Remove only the unavailable group.
  for (let attempt = 0; attempt < 4 && rowsResult.error; attempt += 1) {
    if (isMissingShopColumn(rowsResult.error)) {
      optionalColumns = optionalColumns.filter((column) => !CLOUD_HISTORY_SHOP_COLUMNS.includes(column));
    } else if (isMissingInspectionColumn(rowsResult.error)) {
      optionalColumns = optionalColumns.filter((column) => column !== "inspection_json");
    } else if (/does not exist|schema cache|could not find .* column/i.test(rowsResult.error.message ?? "") && rowsResult.error.message?.includes("analysis_attempt_id")) {
      optionalColumns = optionalColumns.filter((column) => column !== "analysis_attempt_id");
    } else if (/does not exist|schema cache|could not find .* column/i.test(rowsResult.error.message ?? "") && rowsResult.error.message?.includes("evidence_bundle_json")) {
      optionalColumns = optionalColumns.filter((column) => column !== "evidence_bundle_json");
    } else {
      break;
    }
    rowsResult = await selectRows([CLOUD_HISTORY_CORE_SELECT, ...optionalColumns].join(","));
    if (!isAccountScopeCurrent(scope)) return null;
  }

  return rowsResult;
}

/** A select naming a shop column the database doesn't have (Postgres 42703 or a stale schema cache). */
function isMissingShopColumn(error: { message?: string } | null) {
  const message = error?.message ?? "";
  return /does not exist|schema cache|could not find .* column/i.test(message)
    && CLOUD_HISTORY_SHOP_COLUMNS.some((column) => message.includes(column));
}

function isMissingInspectionColumn(error: { message?: string } | null) {
  const message = error?.message ?? "";
  return /does not exist|schema cache|could not find .* column/i.test(message)
    && message.includes("inspection_json");
}

async function getSignedImageMap(
  supabase: NonNullable<Awaited<ReturnType<typeof getAuthClient>>>,
  rows: CloudHistoryRow[],
  userId: string,
) {
  const map = new Map<string, string>();
  const paths = [...new Set([...rows.map((row) => row.image_path).filter(isString), ...rows.flatMap((row) => {
    const bundle = parseEvidenceBundle(row.evidence_bundle_json, userId, String(row.local_id));
    return bundle ? evidencePaths(bundle) : [];
  })])];

  if (!paths.length) {
    return map;
  }

  const signedResult = await supabase.storage.from(SCAN_BUCKET).createSignedUrls(paths, SIGNED_URL_TTL_SECONDS);
  if (signedResult.error || !Array.isArray(signedResult.data)) {
    return map;
  }

  for (const entry of signedResult.data as SignedImageRow[]) {
    const path = isString(entry.path) ? entry.path : null;
    const signedUrl = isString(entry.signedUrl)
      ? entry.signedUrl
      : isString(entry.signedURL)
        ? entry.signedURL
        : null;

    if (!path || !signedUrl || entry.error || !paths.includes(path)) {
      continue;
    }

    map.set(path, signedUrl);
  }

  return map;
}

function validateCloudEvidence(rows: CloudHistoryRow[], userId: string): string | null {
  return rows.some((row) => row.evidence_bundle_json != null && !parseEvidenceBundle(row.evidence_bundle_json, userId, String(row.local_id)))
    ? "Saved evidence has invalid metadata or an image from another account or scan. Nothing was restored; your cloud record is unchanged." : null;
}

function hasMissingEvidenceImages(rows: CloudHistoryRow[], signed: Map<string, string>, userId: string) {
  return rows.some((row) => {
    const bundle = parseEvidenceBundle(row.evidence_bundle_json, userId, String(row.local_id));
    return bundle && evidencePaths(bundle).some((path) => !signed.has(path));
  });
}

function mapCloudRowToLookup(
  row: CloudHistoryRow,
  signedImageMap: Map<string, string>,
  index: number,
  userId: string,
  forReport = false,
): Lookup | null {
  const createdAt = isString(row.created_at) ? row.created_at : new Date().toISOString();
  const imagePath = isString(row.image_path) ? row.image_path : "";
  const scanCategory = parseScanCategory(row.scan_category);
  const correction = isString(row.correction) ? row.correction : null;
  const evidence = parseEvidenceBundle(row.evidence_bundle_json, userId, String(row.local_id));
  const restoredEvidence = evidence ? restoreEvidenceBundle(evidence, signedImageMap) : {};
  const photoIds = restoredEvidence.photos?.map((photo) => photo.id)
    ?? (forReport || signedImageMap.has(imagePath) ? ["photo-1"] : []);
  const result = parseIdentificationResult(row.result_json, scanCategory, photoIds);

  return {
    id: isString(row.local_id) ? row.local_id : `cloud-${index}`,
    cloudRevision: typeof row.revision === "number" && Number.isSafeInteger(row.revision) && row.revision > 0 ? row.revision : undefined,
    analysisAttemptId: isString(row.analysis_attempt_id) ? row.analysis_attempt_id : undefined,
    createdAt,
    frame: {
      imageBase64: signedImageMap.get(imagePath) ?? (forReport ? "" : FALLBACK_IMAGE),
      capturedAt: isString(row.captured_at) ? row.captured_at : createdAt,
    },
    ...restoredEvidence,
    analyzedAt: isString(row.analyzed_at) ? row.analyzed_at : undefined,
    errorCode: isString(row.error_code) ? row.error_code : undefined,
    errorMessage: isString(row.error_message) ? row.error_message : undefined,
    rating: parseRating(row.rating),
    correction,
    notes: isString(row.notes) ? row.notes : "",
    inspection: normalizePartInspection(row.inspection_json),
    scanCategory,
    trainingLabel: isString(row.training_label)
      ? row.training_label
      : correction?.trim() || result?.partName || "unlabeled",
    trainingStatus: parseTrainingStatus(row.training_status),
    chatHistory: parseChatHistory(row.chat_history),
    customerVisibleReport: parseCustomerVisibleReport(row.customer_visible_report_json),
    jobId: isString(row.job_id) ? row.job_id : undefined,
    orgId: isString(row.org_id) ? row.org_id : undefined,
    result,
    reviewStatus: parseShopReviewStatus(row.review_status),
    technicianUserId: isString(row.technician_user_id) ? row.technician_user_id : undefined,
    vehicleContext: parseShopVehicleContext(row.vehicle_context),
    provenance: {
      analysisSource: "ai_detection",
      captureMode: "camera",
      savedAt: createdAt,
    },
  };
}

function parseIdentificationResult(value: unknown, fallbackCategory: ScanCategory, allowedPhotoIds: readonly string[]): IdentificationResult | undefined {
  if (!isObject(value)) {
    return undefined;
  }

  const partName = isString(value.partName) ? value.partName.trim() : "";
  if (!partName) {
    return undefined;
  }

  const conditionAssessment = normalizeConditionAssessment(value.conditionAssessment, allowedPhotoIds);
  return {
    partName,
    confidence: parseConfidence(value.confidence),
    confidenceScore: parseConfidenceScore(value.confidenceScore, parseConfidence(value.confidence)),
    confidenceRange: parseConfidenceRange(value.confidenceRange, value.confidenceScore, parseConfidence(value.confidence)),
    confirmationNeed: parseConfirmationNeed(value.confirmationNeed),
    scanCategory: parseScanCategory(value.scanCategory, fallbackCategory),
    candidateMatches: parseCandidateMatches(value.candidateMatches),
    primaryPart: parseCandidatePart(value.primaryPart, partName, parseConfidence(value.confidence), parseScanCategory(value.scanCategory, fallbackCategory)),
    candidateParts: parseCandidateParts(value.candidateParts),
    possibleVehicleContexts: parsePossibleVehicleContexts(value.possibleVehicleContexts),
    measurements: parsePartMeasurements(value.measurements),
    requiredNextEvidence: parseStringList(value.requiredNextEvidence, 8, 220),
    ...(parseFitmentConfidence(value.fitmentConfidence) ? { fitmentConfidence: parseFitmentConfidence(value.fitmentConfidence) } : {}),
    whatItDoes: isString(value.whatItDoes) ? value.whatItDoes : "",
    visibleObservations: parseStringList(value.visibleObservations, 8, 220),
    evidenceRegions: parseEvidenceRegions(value.evidenceRegions),
    ...(conditionAssessment ? { conditionAssessment } : {}),
    sceneObjects: parseSceneObjects(value.sceneObjects),
    concerns: parseStringList(value.concerns, 8, 220),
    safetyTriage: parseSafetyTriage(value.safetyTriage),
    isSafetyCritical: value.isSafetyCritical === true,
    nextAction: isString(value.nextAction) ? value.nextAction : "",
    needsBetterPhoto: value.needsBetterPhoto === true,
    evidence: parseStringList(value.evidence, 12, 320),
    sourceLinks: parseSourceLinks(value.sourceLinks),
    ...(parseIdentifyModelRun(value.modelRun) ? { modelRun: parseIdentifyModelRun(value.modelRun) } : {}),
  };
}

function parseIdentifyModelRun(value: unknown): IdentifyModelRun | undefined {
  if (!isObject(value) || !isIdentifyProvider(value.provider) || !isString(value.model)) {
    return undefined;
  }

  const model = value.model.trim();
  if (!model) {
    return undefined;
  }

  return {
    provider: value.provider,
    model: model.slice(0, 160),
    ...Object.fromEntries(["runId", "promptVersion", "pipelineVersion"].flatMap((key) =>
      isString(value[key]) && /^[a-zA-Z0-9._:-]{1,160}$/.test(value[key]) ? [[key, value[key]]] : [])),
    latencyMs: typeof value.latencyMs === "number" && Number.isFinite(value.latencyMs) && value.latencyMs >= 0
      ? Math.round(value.latencyMs)
      : 0,
    ...(isString(value.fallbackReason) && value.fallbackReason.trim()
      ? { fallbackReason: value.fallbackReason.trim().slice(0, 120) }
      : {}),
    ocrUsed: value.ocrUsed === true,
  };
}

function isIdentifyProvider(value: unknown): value is IdentifyProvider {
  return value === "gemini" || value === "huggingface" || value === "groq" || value === "ollama" || value === "on-device";
}

function parseCandidateMatches(value: unknown): CandidateMatch[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter(isObject)
    .map((item) => ({
      partName: isString(item.partName) ? item.partName : "",
      confidence: parseConfidence(item.confidence),
      scanCategory: parseScanCategory(item.scanCategory),
      reason: isString(item.reason) ? item.reason : "",
    }))
    .filter((item) => Boolean(item.partName));
}

function parseCandidatePart(
  value: unknown,
  fallbackPartName?: string,
  fallbackConfidence?: Confidence,
  fallbackCategory?: ScanCategory,
): CandidatePart | undefined {
  if (!isObject(value)) {
    return fallbackPartName && fallbackConfidence && fallbackCategory
      ? {
          confidence: fallbackConfidence,
          evidence: [],
          partName: fallbackPartName,
          scanCategory: fallbackCategory,
        }
      : undefined;
  }

  const partName = isString(value.partName) ? value.partName.trim().slice(0, 120) : "";
  if (!partName) {
    return undefined;
  }

  return {
    confidence: parseConfidence(value.confidence),
    evidence: parseStringList(value.evidence, 6, 220),
    partName,
    scanCategory: parseScanCategory(value.scanCategory),
    ...(isString(value.whyNotPrimary) ? { whyNotPrimary: value.whyNotPrimary.trim().slice(0, 220) } : {}),
  };
}

function parseCandidateParts(value: unknown): CandidatePart[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => parseCandidatePart(item))
    .filter((item): item is CandidatePart => Boolean(item))
    .slice(0, 4);
}

function parsePossibleVehicleContexts(value: unknown): PossibleVehicleContext[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter(isObject)
    .map((item) => ({
      confidence: parseConfidence(item.confidence),
      evidence: parseStringList(item.evidence, 4, 220),
      label: isString(item.label) ? item.label.trim().slice(0, 120) : "",
    }))
    .filter((item) => item.label)
    .slice(0, 3);
}

function parsePartMeasurements(value: unknown): PartMeasurement[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter(isObject)
    .map((item): PartMeasurement => {
      const method = item.method === "reference_object" || item.method === "visible_marking" || item.method === "estimated"
        ? item.method
        : "estimated";
      return {
        caveat: isString(item.caveat) ? item.caveat.trim().slice(0, 220) : "Estimated; verify before ordering parts.",
        confidence: parseConfidence(item.confidence),
        label: isString(item.label) ? item.label.trim().slice(0, 120) : "",
        method,
        valueMm: typeof item.valueMm === "number" && Number.isFinite(item.valueMm) ? item.valueMm : 0,
      };
    })
    .filter((item) => item.label && item.valueMm > 0)
    .slice(0, 4);
}

function parseEvidenceRegions(value: unknown): EvidenceRegion[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter(isObject)
    .map((item) => ({
      label: isString(item.label) ? item.label : "",
      observation: isString(item.observation) ? item.observation : "",
      regionLabel: isString(item.regionLabel) ? item.regionLabel : "",
    }))
    .filter((item) => Boolean(item.label || item.observation));
}

function parseSceneObjects(value: unknown): SceneObject[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter(isObject)
    .map((item) => ({
      name: isString(item.name) ? item.name.trim().slice(0, 80) : "",
      category: isString(item.category) && item.category.trim() ? item.category.trim().slice(0, 40) : "unknown",
      regionLabel: isString(item.regionLabel) ? item.regionLabel.trim().slice(0, 40) : "Scanned area",
      primary: item.primary === true,
    }))
    .filter((item) => Boolean(item.name))
    .slice(0, 8);
}

function parseCustomerVisibleReport(value: unknown): CustomerVisibleReport | undefined {
  if (!isObject(value) || !isString(value.generatedAt) || !isString(value.summary) || !isString(value.title)) {
    return undefined;
  }

  return {
    generatedAt: value.generatedAt,
    summary: value.summary.slice(0, 600),
    title: value.title.slice(0, 140),
  };
}

function parseShopVehicleContext(value: unknown): ShopVehicleContext | undefined {
  return normalizeVehicleContext(value);
}

function parseSourceLinks(value: unknown): SourceLink[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter(isObject)
    .map((item) => ({
      label: isString(item.label) ? item.label : "",
      url: isString(item.url) ? item.url : "",
      sourceType: parseSourceType(item.sourceType),
    }))
    .filter((item) => Boolean(item.label && item.url));
}

function parseChatHistory(value: unknown): ChatMessage[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter(isObject)
    .map((item): ChatMessage => ({
      id: isString(item.id) ? item.id : `chat-${Math.random().toString(16).slice(2)}`,
      role: item.role === "assistant" ? "assistant" : "user",
      content: isString(item.content) ? item.content : "",
      ...(item.role === "assistant" && Array.isArray(item.sources) ? { sources: parseSourceLinks(item.sources) } : {}),
      timestamp: isString(item.timestamp) ? item.timestamp : new Date().toISOString(),
    }))
    .filter((item) => item.content.length > 0);
}

function parseStringList(value: unknown, maxItems: number, maxLength: number) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter(isString)
    .map((item) => item.trim().slice(0, maxLength))
    .filter(Boolean)
    .slice(0, maxItems);
}

function parseConfidence(value: unknown): Confidence {
  return value === "high" || value === "medium" || value === "low" ? value : "low";
}

function parseConfidenceScore(value: unknown, confidence: Confidence) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return clampPercent(value);
  }

  if (confidence === "high") return 84;
  if (confidence === "medium") return 72;
  return 48;
}

function parseConfidenceRange(value: unknown, score: unknown, confidence: Confidence) {
  if (isObject(value) && typeof value.low === "number" && typeof value.high === "number") {
    const low = clampPercent(value.low);
    const high = clampPercent(value.high);
    return low <= high ? { low, high } : { low: high, high: low };
  }

  const normalizedScore = parseConfidenceScore(score, confidence);
  const spread = normalizedScore >= 80 ? 6 : normalizedScore >= 65 ? 8 : 12;
  return {
    low: clampPercent(normalizedScore - spread),
    high: clampPercent(normalizedScore + spread),
  };
}

function parseConfirmationNeed(value: unknown) {
  return value === "none" || value === "one_more_angle" || value === "reference_needed" ? value : undefined;
}

function clampPercent(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function parseScanCategory(value: unknown, fallback: ScanCategory = "unknown"): ScanCategory {
  return value === "engine"
    || value === "electrical"
    || value === "brakes"
    || value === "steering"
    || value === "suspension"
    || value === "fuel"
    || value === "airbag"
    || value === "body"
    || value === "leak"
    || value === "unknown"
    ? value
    : fallback;
}

function parseSafetyTriage(value: unknown): IdentificationResult["safetyTriage"] {
  return value === "needs_better_photo" || value === "needs_professional" || value === "can_help"
    ? value
    : "can_help";
}

function parseRating(value: unknown): Rating {
  return value === "up" || value === "down" ? value : null;
}

function parseTrainingStatus(value: unknown): TrainingStatus {
  return value === "user_confirmed" || value === "user_corrected" || value === "raw_unreviewed"
    ? value
    : "raw_unreviewed";
}

function parseShopReviewStatus(value: unknown): ShopReviewStatus | undefined {
  return value === "needs_review" || value === "confirmed" || value === "corrected" ? value : undefined;
}

function parseFitmentConfidence(value: unknown): FitmentConfidence | undefined {
  return value === "not_applicable" || value === "needs_vehicle_context" || value === "possible" || value === "supported"
    ? value
    : undefined;
}

function parseSourceType(value: unknown): SourceLink["sourceType"] {
  return value === "dataset" || value === "reference" || value === "search" || value === "safety"
    ? value
    : "reference";
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}
