import { accountStorageKey, getAccountScope, isAccountScopeCurrent, type AccountScope } from "../lib/accountScope";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { getAuthClient } from "./auth";
import { getLookup, readLookups, recordCloudRevision, recordCloudSaveAttempt } from "./storage";
import type { FeedbackSubmission, Lookup, WaitlistSignup } from "../types";
import { feedbackCloudMessage, getFeedbackIssue, normalizeFeedbackContext } from "./feedbackDetails";

const SCAN_BUCKET = "scan-images";
const CLOUD_HEALTH_STORAGE_KEY = "deep-spec:cloud-health";
const SCAN_LOOKUP_OPTIONAL_COLUMNS = [
  "customer_visible_report_json",
  "job_id",
  "org_id",
  "review_status",
  "technician_user_id",
  "vehicle_context",
] as const;
const HEALTH_TEST_IMAGE_BASE64 =
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAH/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAEFAqf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/Aaf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/Aaf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAY/Aqf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/IV//2gAMAwEAAgADAAAAEP/EABQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQMBAT8QH//EABQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQIBAT8QH//EABQQAQAAAAAAAAAAAAAAAAAAABD/2gAIAQEAAT8QH//Z";

type CloudSyncConfig = {
  key: string;
  url: string;
};

export type CloudSyncStatus = {
  configured: boolean;
  message: string;
};

export type CloudHealthStepId =
  | "configured"
  | "anonymousAuth"
  | "storageUpload"
  | "rowUpsert"
  | "datasetDetails"
  | "rlsIsolation";
export type CloudHealthStepStatus = "pass" | "fail" | "unknown";

export type CloudHealthCheck = {
  id: CloudHealthStepId;
  label: string;
  message: string;
  status: CloudHealthStepStatus;
};

export type CloudHealthReport = {
  checkedAt: string | null;
  checks: Record<CloudHealthStepId, CloudHealthCheck>;
  configured: boolean;
  lastVerifiedAt: string | null;
  message: string;
  overall: "ready" | "blocked" | "unconfigured" | "unknown";
  projectUrl: string | null;
};

export type CloudSyncResult =
  | {
      ok: true;
      imagePath?: string;
      shopAssociation?: "private" | "cloud";
      message: string;
    }
  | {
      ok: false;
      message: string;
    };

export type CloudBatchSyncResult = {
  attempted: number;
  failed: number;
  failures: Array<{ id: string; message: string }>;
  message: string;
  ok: boolean;
  synced: number;
};

export function getCloudSyncStatus(): CloudSyncStatus {
  const config = getCloudSyncConfig();

  if (!config) {
    return {
      configured: false,
      message: "Your scans are saved on this device. Cloud sync is off for this build.",
    };
  }

  return {
    configured: true,
    message: "Cloud sync is set up. Run a quick check to confirm your scans save and stay private.",
  };
}

export function getCloudHealthSnapshot(): CloudHealthReport {
  const config = getCloudSyncConfig();
  const stored = readCloudHealthReport();
  if (stored && stored.projectUrl === (config?.url ?? null)) {
    return stored;
  }

  return createCloudHealthReport(config, null);
}

export async function verifyCloudHealth(): Promise<CloudHealthReport> {
  const scope = getAccountScope();
  const saveReport = (report: CloudHealthReport) => isAccountScopeCurrent(scope) ? saveCloudHealthReport(report) : report;
  const config = getCloudSyncConfig();
  const checkedAt = new Date().toISOString();
  let report = createCloudHealthReport(config, checkedAt);

  if (!config) {
    report = updateCloudHealthCheck(report, "configured", "fail", "Cloud sync isn't connected yet.");
    return saveReport({
      ...report,
      message: "Cloud sync isn't set up yet.",
      overall: "unconfigured",
    });
  }

  report = updateCloudHealthCheck(report, "configured", "pass", "Cloud sync is connected.");
  let ownerClient: SupabaseClient | null = null;
  let userId: string | null = null;
  let imagePath: string | null = null;
  const testId = `health-${createRuntimeId()}`;

  try {
    ownerClient = await createVerificationClient(config);
    const owner = await signInForHealthCheck(ownerClient);
    userId = owner.id;
    report = updateCloudHealthCheck(report, "anonymousAuth", "pass", "Signed you in securely.");

    imagePath = `${userId}/${testId}.jpg`;
    await assertCloudResult(
      await ownerClient.storage.from(SCAN_BUCKET).upload(imagePath, healthTestImageBlob(), {
        contentType: "image/jpeg",
        upsert: false,
      }),
      "Private image upload failed",
    );
    report = updateCloudHealthCheck(report, "storageUpload", "pass", "Your scan photo uploaded privately.");

    await assertCloudResult(
      await ownerClient.from("scan_lookups").upsert(
        {
          analyzed_at: checkedAt,
          captured_at: checkedAt,
          chat_history: [],
          correction: null,
          created_at: checkedAt,
          error_code: null,
          error_message: null,
          image_path: imagePath,
          local_id: testId,
          notes: "Runtime cloud health check row. Safe to delete.",
          rating: null,
          result_json: {
            confidence: "high",
            partName: "Runtime Health Check",
            safetyTriage: "can_help",
          },
          scan_category: "unknown",
          training_label: "Runtime Health Check",
          training_status: "raw_unreviewed",
          user_id: userId,
        },
        { onConflict: "user_id,local_id" },
      ),
      "scan_lookups upsert failed",
    );
    report = updateCloudHealthCheck(report, "rowUpsert", "pass", "Your scan saved to the cloud.");

    await writeCloudHealthDatasetDetails(ownerClient, userId, testId);
    report = updateCloudHealthCheck(report, "datasetDetails", "pass", "Scan details saved.");

    const otherClient = await createVerificationClient(config);
    await signInForHealthCheck(otherClient);
    await assertCloudHealthRlsIsolation(otherClient, testId);
    report = updateCloudHealthCheck(report, "rlsIsolation", "pass", "Your scans stay private to you.");

    return saveReport({
      ...report,
      lastVerifiedAt: checkedAt,
      message: "Cloud sync is working. Your scans save and stay private to you.",
      overall: "ready",
    });
  } catch (error) {
    return saveReport(markNextUnknownCloudHealthFailure(report, getFriendlySyncError(error)));
  } finally {
    if (ownerClient && userId && imagePath) {
      await cleanupCloudHealthCheck(ownerClient, userId, testId, imagePath);
    }
  }
}

const CLOUD_SYNC_TIMEOUT_MS = 20_000;
const pendingLookupSyncs = new Set<string>();
const PENDING_SYNC_MESSAGE = "A cloud save for this scan is still finishing. Wait for it to finish before retrying.";
const CLOUD_CONFLICT_MESSAGE = "A newer cloud version exists or this device has no confirmed cloud revision. The cloud scan was not overwritten; your changes remain on this device. Compare with the cloud version before saving again.";

function withCloudTimeout<T>(promise: Promise<T>, timeoutMs: number, onTimeout: () => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => { onTimeout(); reject(new Error("Cloud sync timed out")); }, timeoutMs);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

export async function syncLookupToCloud(lookup: Lookup): Promise<CloudSyncResult> {
  return syncLookupForAccount(lookup, getAccountScope());
}

async function syncLookupForAccount(lookup: Lookup, scope: AccountScope): Promise<CloudSyncResult> {
  if (!getCloudSyncConfig()) {
    return {
      ok: false,
      message: "Cloud sync is not configured yet.",
    };
  }

  // Keep the key until the underlying operation settles, even after its UI
  // timeout. Releasing it early lets an older write overwrite a newer retry.
  const pendingKey = JSON.stringify([scope.userId, lookup.id]);
  if (pendingLookupSyncs.has(pendingKey)) return { ok: false, message: PENDING_SYNC_MESSAGE };
  let receipt: Lookup["cloudSave"];
  let timedOut = false;
  const finish = (status: "acknowledged" | "failed") => {
    if (receipt && isAccountScopeCurrent(scope)) {
      recordCloudSaveAttempt(lookup.id, { ...receipt, status }, receipt.attemptId);
    }
  };
  try {
    assertAccount(scope);
    // Screens can hold an older snapshot. Upload current device content when present.
    const deviceRead = readLookups();
    if (!deviceRead.ok) return { ok: false, message: deviceRead.message };
    lookup = getLookup(lookup.id, deviceRead.value) ?? lookup;
    receipt = {
      attemptId: createRuntimeId(), attemptedAt: new Date().toISOString(), status: "unconfirmed",
      scope: lookup.inspection && !lookup.frame.imageBase64.startsWith("data:") ? "inspection" : "scan",
    };
    recordCloudSaveAttempt(lookup.id, receipt);
    pendingLookupSyncs.add(pendingKey);
    const guard = () => {
      assertAccount(scope);
      if (timedOut) throw new Error("Cloud sync timed out");
    };
    const operation = performLookupSync(lookup, scope, guard)
      .finally(() => pendingLookupSyncs.delete(pendingKey));
    const result = await withCloudTimeout(operation, CLOUD_SYNC_TIMEOUT_MS, () => { timedOut = true; });
    if (receipt && result.ok && result.shopAssociation) receipt = { ...receipt, shopAssociation: result.shopAssociation };
    finish(result.ok ? "acknowledged" : "failed");
    return result;
  } catch (error) {
    finish("failed");
    return {
      ok: false,
      message: timedOut ? `Cloud save was not confirmed. ${PENDING_SYNC_MESSAGE}` : getFriendlySyncError(error),
    };
  }
}

async function performLookupSync(lookup: Lookup, scope: AccountScope, guard: () => void): Promise<CloudSyncResult> {
  const supabase = await getClient();
  guard();
  const user = await ensureCloudUser(supabase, scope);
  guard();
  // Cloud history contains signed image URLs, not the original image bytes. Save
  // the inspection without replacing image metadata or stale AI/feedback fields.
  if (lookup.inspection && !lookup.frame.imageBase64.startsWith("data:")) {
    const revision = lookup.cloudRevision;
    if (!isCloudRevision(revision)) throw new Error(CLOUD_CONFLICT_MESSAGE);
    const updated = await supabase.from("scan_lookups")
      .update({ inspection_json: lookup.inspection, revision: revision + 1 })
      .eq("user_id", user.id)
      .eq("local_id", lookup.id)
      .eq("revision", revision)
      .select("revision").maybeSingle();
    if (updated.error) throw new Error(updated.error.message);
    if (!isCloudRevision(updated.data?.revision)) throw new Error(CLOUD_CONFLICT_MESSAGE);
    assertAccount(scope);
    recordCloudRevision(lookup.id, revision, updated.data.revision);
    guard();
    await syncAnalysisFailureRows(supabase, user.id, lookup, guard);
    return { ok: true, message: "Inspection synced to your saved scan." };
  }
  const association = await resolveCloudShopAssociation(supabase, user.id, lookup, guard);
  guard();
  if (!association && (lookup.orgId || lookup.jobId) && lookup.cloudRevision !== undefined) {
    // Omitting columns on UPDATE retains a previous shop association. Never
    // label such a save private or silently detach a shared cloud job/bridge.
    const existing = await supabase.from("scan_lookups").select("*")
      .eq("user_id", user.id).eq("local_id", lookup.id).eq("revision", lookup.cloudRevision).maybeSingle();
    guard();
    if (existing.error) throw new Error(existing.error.message);
    if (!existing.data) throw new Error(CLOUD_CONFLICT_MESSAGE);
    if (existing.data.org_id || existing.data.job_id) {
      throw new Error("The existing cloud shop association could not be verified. Cloud save stopped; your scan and job link remain on this device. Restore shop access before retrying.");
    }
  }
  // Keep the device record untouched; only authorized cloud identifiers travel.
  const cloudLookup = { ...lookup, orgId: association?.orgId, jobId: association?.jobId,
    technicianUserId: association ? lookup.technicianUserId : undefined };
  const image = dataUrlToBlob(lookup.frame.imageBase64);
  const imageHash = await hashBytes(image.bytes);
  guard();
  // Upload before the row CAS, but never overwrite an image another revision
  // references. A rejected save can leave an unreferenced object, not lost data.
  const imagePath = `${user.id}/${lookup.id}/original-${imageHash ?? createRuntimeId()}.${image.extension}`;
  const uploaded = await supabase.storage.from(SCAN_BUCKET).upload(imagePath, image.blob, {
    contentType: image.contentType,
    upsert: false,
  });

  guard();
  if (uploaded.error && !isExistingImage(uploaded.error)) {
    throw new Error(uploaded.error.message);
  }

  const isolatedImage = await uploadIsolatedImage(supabase, user.id, lookup, guard);
  guard();
  const saved = await upsertScanLookupRow(supabase, {
    ...isolatedImage,
    analysis_attempt_id: lookup.analysisAttemptId ?? null,
    analyzed_at: lookup.analyzedAt ?? null,
    captured_at: lookup.frame.capturedAt,
    chat_history: lookup.chatHistory,
    correction: lookup.correction,
    created_at: lookup.createdAt,
    error_code: lookup.errorCode ?? null,
    error_message: lookup.errorMessage ?? null,
    image_byte_length: image.byteLength,
    image_hash: imageHash,
    image_mime_type: image.contentType,
    image_path: imagePath,
    local_id: lookup.id,
    notes: lookup.notes,
    rating: lookup.rating,
    result_json: lookup.result ?? null,
    scan_category: lookup.scanCategory,
    training_label: lookup.trainingLabel,
    training_status: lookup.trainingStatus,
    user_id: user.id,
    ...(lookup.inspection ? { inspection_json: lookup.inspection } : {}),
    ...getOptionalScanLookupFields(cloudLookup),
  }, lookup.cloudRevision, guard);

  if (saved.error) {
    throw new Error(saved.error.message);
  }
  if (!isCloudRevision(saved.data?.revision)) throw new Error(CLOUD_CONFLICT_MESSAGE);
  // Reconcile a committed parent even after the UI timeout, while this owner's
  // save lock still holds. The timeout guard must still stop child work and
  // leave the save unacknowledged until an explicit retry finishes it.
  assertAccount(scope);
  recordCloudRevision(lookup.id, lookup.cloudRevision, saved.data.revision);
  guard();

  await syncDatasetDetailTables(supabase, user.id, cloudLookup, saved.data.revision, guard);
  guard();

  return {
    ok: true,
    imagePath,
    ...(lookup.orgId || lookup.jobId ? { shopAssociation: association ? "cloud" as const : "private" as const } : {}),
    message: lookup.orgId || lookup.jobId
      ? association ? "Scan synced to your cloud shop job." : "Scan saved privately to your account. The shop job link stays on this device."
      : "Scan synced to the private Deep Spec dataset.",
  };
}

export async function syncLookupsToCloud(lookups: Lookup[]): Promise<CloudBatchSyncResult> {
  const scope = getAccountScope();
  const uniqueLookups = [...new Map(lookups.map((lookup) => [lookup.id, lookup])).values()];
  if (!uniqueLookups.length) {
    return {
      attempted: 0,
      failed: 0,
      failures: [],
      message: "No saved scans need cloud sync.",
      ok: true,
      synced: 0,
    };
  }

  if (!getCloudSyncConfig()) {
    return {
      attempted: uniqueLookups.length,
      failed: uniqueLookups.length,
      failures: uniqueLookups.map((lookup) => ({ id: lookup.id, message: "Cloud sync is not configured yet." })),
      message: "Cloud sync is not configured yet.",
      ok: false,
      synced: 0,
    };
  }

  const failures: CloudBatchSyncResult["failures"] = [];
  let synced = 0;

  for (const lookup of uniqueLookups) {
    const result = await syncLookupForAccount(lookup, scope);
    if (result.ok) {
      synced += 1;
    } else {
      failures.push({ id: lookup.id, message: result.message });
    }
  }

  return {
    attempted: uniqueLookups.length,
    failed: failures.length,
    failures,
    message: failures.length
      ? `Synced ${synced}/${uniqueLookups.length} saved scans to the cloud.`
      : `${synced} saved scan${synced === 1 ? "" : "s"} synced to the cloud.`,
    ok: failures.length === 0,
    synced,
  };
}

// Local shop records are a prototype, not proof of cloud membership. Read with
// the signed-in client (RLS still applies), never provision or trust local roles.
async function resolveCloudShopAssociation(supabase: SupabaseClient, userId: string, lookup: Lookup, guard: () => void) {
  const orgId = asUuid(lookup.orgId);
  const jobId = asUuid(lookup.jobId);
  if (!orgId || !jobId) return null;
  const member = await supabase.from("organization_members").select("role")
    .eq("org_id", orgId).eq("user_id", userId).maybeSingle();
  guard();
  if (member.error || !["owner", "admin", "technician"].includes(member.data?.role)) return null;
  const job = await supabase.from("shop_jobs").select("id")
    .eq("id", jobId).eq("org_id", orgId).maybeSingle();
  guard();
  if (job.error || job.data?.id !== jobId) return null;
  return { orgId, jobId };
}

function getOptionalScanLookupFields(lookup: Lookup) {
  const optional: Record<string, unknown> = {};
  const jobId = asUuid(lookup.jobId);
  const orgId = asUuid(lookup.orgId);
  const technicianUserId = asUuid(lookup.technicianUserId);

  if (lookup.customerVisibleReport) optional.customer_visible_report_json = lookup.customerVisibleReport;
  if (jobId) optional.job_id = jobId;
  if (orgId) optional.org_id = orgId;
  if (lookup.reviewStatus) optional.review_status = lookup.reviewStatus;
  if (technicianUserId) optional.technician_user_id = technicianUserId;
  if (lookup.vehicleContext) optional.vehicle_context = lookup.vehicleContext;

  return optional;
}

function isCloudRevision(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value < Number.MAX_SAFE_INTEGER;
}

function isExistingImage(error: { status?: number; statusCode?: string; message: string }) {
  return error.status === 409 || error.statusCode === "409"
    || ["ResourceAlreadyExists", "KeyAlreadyExists", "Duplicate"].includes(error.statusCode ?? "")
    || ((error.status === 400 || error.statusCode === "400") && error.message === "The resource already exists");
}

async function upsertScanLookupRow(supabase: SupabaseClient, row: Record<string, unknown>, revision: number | undefined, guard: () => void) {
  if (revision !== undefined && !isCloudRevision(revision)) throw new Error(CLOUD_CONFLICT_MESSAGE);
  const write = (payload: Record<string, unknown>) => revision === undefined
    // Unknown base includes legacy local scans. A collision must never update.
    ? supabase.from("scan_lookups").insert({ ...payload, revision: 1 }).select("revision").maybeSingle()
    : supabase.from("scan_lookups").update({ ...payload, revision: revision + 1 })
      .eq("user_id", row.user_id).eq("local_id", row.local_id).eq("revision", revision)
      .select("revision").maybeSingle();
  guard();
  let result = await write(row);
  if (isMissingOptionalScanLookupColumn(result.error)) {
    // A failed schema write has no committed revision to reconcile. Check the
    // deadline before starting another write, but let late successes return.
    guard();
    result = await write(omitOptionalScanLookupColumns(row));
  }
  if (result.error?.code === "23505" || result.error?.code === "40001") throw new Error(CLOUD_CONFLICT_MESSAGE);
  return result;
}

function omitOptionalScanLookupColumns(row: Record<string, unknown>) {
  const fallback = { ...row };
  for (const column of SCAN_LOOKUP_OPTIONAL_COLUMNS) {
    delete fallback[column];
  }
  return fallback;
}

function isMissingOptionalScanLookupColumn(error: { message?: string } | null | undefined) {
  const message = error?.message ?? "";
  return /schema cache|could not find .* column/i.test(message)
    && SCAN_LOOKUP_OPTIONAL_COLUMNS.some((column) => message.includes(column));
}

async function syncDatasetDetailTables(supabase: SupabaseClient, userId: string, lookup: Lookup, revision: number, guard: () => void) {
  const orgId = asUuid(lookup.orgId);
  const jobId = asUuid(lookup.jobId);
  guard();
  // The RPC checks and locks the committed parent revision for the entire child
  // replacement. A client-side revision read would leave another TOCTOU race.
  const details = await supabase.rpc("sync_scan_details", {
    p_scan_local_id: lookup.id,
    p_revision: revision,
    p_candidates: (lookup.result?.candidateMatches ?? []).map((candidate, index) => ({
      candidate_json: candidate,
      candidate_rank: index,
      confidence: candidate.confidence,
      part_name: candidate.partName,
      reason: candidate.reason,
      scan_category: candidate.scanCategory,
    })),
    p_evidence: buildEvidenceRows(userId, lookup),
    p_correction: {
      corrected_category: lookup.correction ? lookup.scanCategory : null,
      corrected_part_name: lookup.correction?.trim() || null,
      correction_text: lookup.correction,
      damage_severity: "unknown",
      notes: lookup.notes,
      rating: lookup.rating,
      region_label: null,
      training_status: lookup.trainingStatus,
    },
    p_job_scan: orgId && jobId ? {
      customer_visible_report_json: lookup.customerVisibleReport ?? null,
      job_id: jobId,
      org_id: orgId,
      review_status: lookup.reviewStatus ?? "needs_review",
    } : null,
  });
  guard();
  if (details.error?.code === "40001") throw new Error(CLOUD_CONFLICT_MESSAGE);
  if (details.error) throw new Error(details.error.message);
  if (details.data !== true) throw new Error(CLOUD_CONFLICT_MESSAGE);
  // Model runs are append-only by run_key (ignoreDuplicates), so delayed saves
  // cannot replace a newer prediction's provenance. Keep that identity intact.
  await insertScanModelRun(supabase, userId, lookup);
  guard();
  await syncAnalysisFailureRows(supabase, userId, lookup, guard);
  guard();
  await insertSyncEvent(supabase, userId, lookup, "upsert", "success", "Scan dataset details synced.");
}

export async function syncAnalysisFailuresToCloud(lookup: Lookup): Promise<CloudSyncResult> {
  const scope = getAccountScope();
  const guard = () => { if (!isAccountScopeCurrent(scope)) throw new Error("Account changed."); };
  try {
    const supabase = await getClient();
    guard();
    const user = await ensureCloudUser(supabase, scope);
    guard();
    await syncAnalysisFailureRows(supabase, user.id, lookup, guard);
    return { ok: true, message: "Failed attempts synced." };
  } catch {
    return { ok: false, message: "Failed attempt is on this device; cloud sync was not confirmed." };
  }
}

async function syncAnalysisFailureRows(supabase: SupabaseClient, userId: string, lookup: Lookup, guard: () => void) {
  for (const failure of lookup.analysisFailures ?? []) {
    guard();
    await assertCloudResult(await supabase.from("scan_model_runs").upsert({
      user_id: userId, scan_local_id: lookup.id, run_key: failure.attemptId,
      provider: "unknown", model: "unknown", prompt_version: null, pipeline_version: null,
      error_code: failure.errorCode, error_message: failure.errorMessage,
      metadata_json: { attemptedAt: failure.attemptedAt, attemptScope: "client-identify-request", hasResult: false },
    }, { onConflict: "user_id,scan_local_id,run_key", ignoreDuplicates: true }), "Failed attempt sync failed");
    guard();
  }
}

async function insertScanModelRun(supabase: SupabaseClient, userId: string, lookup: Lookup) {
  const modelRun = lookup.result?.modelRun;
  // Historical snapshots have unknown attempt counts; this digest only deduplicates sync.
  const legacyHash = modelRun?.runId || lookup.analysisAttemptId ? null : await hashBytes(new TextEncoder().encode(JSON.stringify({
    result: lookup.result ?? null, errorCode: lookup.errorCode ?? null,
    errorMessage: lookup.errorMessage ?? null, analyzedAt: lookup.analyzedAt ?? null,
  })));
  if (!modelRun?.runId && !lookup.analysisAttemptId && !legacyHash) throw new Error("A secure connection is required to verify historical inference identity.");
  const runKey = modelRun?.runId || lookup.analysisAttemptId || `legacy:${legacyHash}`;
  await assertCloudResult(
    await supabase.from("scan_model_runs").upsert({
      run_key: runKey,
      pipeline_version: modelRun?.pipelineVersion ?? null,
      error_code: lookup.errorCode ?? null,
      error_message: lookup.errorMessage ?? null,
      metadata_json: {
        analysisSource: lookup.provenance.analysisSource,
        analysisAttemptId: lookup.analysisAttemptId ?? null,
        historicalSnapshot: !modelRun?.runId && !lookup.analysisAttemptId,
        originalPrediction: lookup.result?.partName.slice(0, 160) ?? null,
        candidatePredictions: (lookup.result?.candidateMatches ?? []).slice(0, 5).map((candidate) => ({
          partName: candidate.partName.slice(0, 160), confidence: candidate.confidence,
        })),
        captureMode: lookup.provenance.captureMode,
        confidence: lookup.result?.confidence ?? null,
        confidenceRange: lookup.result?.confidenceRange ?? null,
        confidenceScore: lookup.result?.confidenceScore ?? null,
        confirmationNeed: lookup.result?.confirmationNeed ?? null,
        fallbackReason: modelRun?.fallbackReason ?? null,
        hasResult: Boolean(lookup.result),
        jobId: lookup.jobId ?? null,
        orgId: lookup.orgId ?? null,
        reviewStatus: lookup.reviewStatus ?? null,
        savedAt: lookup.provenance.savedAt,
        safetyTriage: lookup.result?.safetyTriage ?? null,
        scanQuality: lookup.scanQuality ?? null,
      },
      latency_ms: modelRun?.latencyMs ?? null,
      model: modelRun?.model ?? "unknown",
      ocr_used: modelRun?.ocrUsed ?? hasOcrEvidence(lookup),
      prompt_version: modelRun?.promptVersion ?? null,
      provider: modelRun?.provider ?? "unknown",
      scan_local_id: lookup.id,
      user_id: userId,
    }, { onConflict: "user_id,scan_local_id,run_key", ignoreDuplicates: true }),
    "scan_model_runs insert failed",
  );
}

async function uploadIsolatedImage(supabase: SupabaseClient, userId: string, lookup: Lookup, guard: () => void) {
  // No crop on this device does not mean a previously saved crop should be cleared.
  if (!lookup.isolatedImageBase64?.startsWith("data:")) return {};
  const image = dataUrlToBlob(lookup.isolatedImageBase64);
  const hash = await hashBytes(image.bytes);
  if (!hash) throw new Error("A secure connection is required to verify the isolated image.");
  guard();
  const path = `${userId}/${lookup.id}/isolated-${hash}.${image.extension}`;
  const uploaded = await supabase.storage.from(SCAN_BUCKET).upload(path, image.blob, { contentType: image.contentType, upsert: true });
  guard();
  if (uploaded.error) throw new Error(uploaded.error.message);
  return {
    isolated_image_path: path, isolated_image_hash: hash,
    isolated_image_mime_type: image.contentType, isolated_image_byte_length: image.byteLength,
    isolated_image_kind: lookup.focusMode === "mask" ? "segmentation" : lookup.focusMode === "crop" ? "crop" : null,
  };
}

async function insertSyncEvent(
  supabase: SupabaseClient,
  userId: string,
  lookupOrId: Lookup | string,
  eventType: "upload" | "upsert" | "delete" | "verify",
  status: "success" | "failure",
  message: string,
) {
  const metadata = typeof lookupOrId === "string"
    ? {}
    : {
        analysisSource: lookupOrId.provenance.analysisSource,
        captureMode: lookupOrId.provenance.captureMode,
        savedAt: lookupOrId.provenance.savedAt,
      };
  await assertCloudResult(
    await supabase.from("sync_events").insert({
      event_type: eventType,
      message,
      metadata_json: metadata,
      scan_local_id: typeof lookupOrId === "string" ? lookupOrId : lookupOrId.id,
      status,
      user_id: userId,
    }),
    "sync_events insert failed",
  );
}

async function writeCloudHealthDatasetDetails(supabase: SupabaseClient, userId: string, scanLocalId: string) {
  const details = await supabase.rpc("sync_scan_details", {
    p_scan_local_id: scanLocalId,
    p_revision: 1, // This check just inserted its unique synthetic parent.
    p_candidates: [{
      candidate_json: { source: "runtime-health" },
      candidate_rank: 0,
      confidence: "low",
      part_name: "Runtime Health Related Part",
      reason: "Synthetic row for runtime durable dataset verification.",
      scan_category: "unknown",
    }],
    p_evidence: [{
      evidence_json: { source: "runtime-health" },
      evidence_rank: 0,
      evidence_text: "Synthetic visual observation for runtime durable dataset verification.",
      evidence_type: "observation",
      label: "Runtime health observation",
    }],
    p_correction: {
      corrected_category: null,
      corrected_part_name: null,
      correction_text: null,
      damage_severity: "unknown",
      notes: "Synthetic correction row for runtime durable dataset verification.",
      rating: null,
      region_label: null,
      training_status: "raw_unreviewed",
    },
    p_job_scan: null,
  });
  await assertCloudResult(details, "Scan detail transaction failed");
  if (details.data !== true) throw new Error(CLOUD_CONFLICT_MESSAGE);
  await assertCloudResult(
    await supabase.from("scan_model_runs").insert({
      error_code: null,
      error_message: null,
      latency_ms: 0,
      metadata_json: { source: "runtime-health" },
      model: "synthetic",
      ocr_used: false,
      prompt_version: "runtime-health",
      provider: "runtime-health",
      scan_local_id: scanLocalId,
      user_id: userId,
    }),
    "scan_model_runs insert failed",
  );
  await insertSyncEvent(supabase, userId, scanLocalId, "verify", "success", "Runtime durable dataset details verified.");
}

async function assertCloudHealthRlsIsolation(supabase: SupabaseClient, scanLocalId: string) {
  const checks = [
    { idColumn: "local_id", table: "scan_lookups" },
    { idColumn: "scan_local_id", table: "scan_candidates" },
    { idColumn: "scan_local_id", table: "scan_evidence" },
    { idColumn: "scan_local_id", table: "scan_corrections" },
    { idColumn: "scan_local_id", table: "scan_model_runs" },
    { idColumn: "scan_local_id", table: "sync_events" },
  ];

  for (const check of checks) {
    const crossRead = await supabase.from(check.table).select(check.idColumn).eq(check.idColumn, scanLocalId);
    await assertCloudResult(crossRead, `${check.table} cross-user RLS read failed`);
    if ((crossRead.data ?? []).length > 0) {
      throw new Error(`RLS failed: another anonymous user could read ${check.table}.`);
    }
  }
}

function buildEvidenceRows(userId: string, lookup: Lookup) {
  const rows: Array<Record<string, unknown>> = [];
  const result = lookup.result;
  if (!result) {
    return rows;
  }

  const addRow = (row: Record<string, unknown>) => {
    rows.push({
      ...row,
      evidence_rank: rows.length,
      scan_local_id: lookup.id,
      user_id: userId,
    });
  };

  result.visibleObservations.forEach((observation) => addRow({
    evidence_json: { observation },
    evidence_text: observation,
    evidence_type: "observation",
  }));
  result.evidenceRegions.forEach((region) => addRow({
    evidence_json: region,
    evidence_text: region.observation,
    evidence_type: "region",
    label: region.label,
    region_label: region.regionLabel,
  }));
  result.concerns.forEach((concern) => addRow({
    evidence_json: { concern },
    evidence_text: concern,
    evidence_type: "concern",
  }));
  result.evidence.forEach((item) => addRow({
    evidence_json: { evidence: item },
    evidence_text: item,
    evidence_type: /^OCR label text:/i.test(item) ? "ocr" : "evidence",
  }));
  result.sourceLinks.forEach((link) => addRow({
    evidence_json: link,
    evidence_text: link.label,
    evidence_type: "source_link",
    source_type: link.sourceType,
    url: link.url,
  }));

  return rows;
}

function hasOcrEvidence(lookup: Lookup) {
  return lookup.result?.evidence.some((item) => /^OCR label text:/i.test(item)) ?? false;
}

export async function syncWaitlistSignupToCloud(signup: WaitlistSignup): Promise<CloudSyncResult> {
  const config = getCloudSyncConfig();
  if (!config) {
    return { ok: false, message: "Cloud sync is not configured yet." };
  }

  try {
    const supabase = await getClient();
    const inserted = await supabase.from("waitlist_signups").insert({
      email: signup.email,
      main_problem: signup.mainProblem,
      source: "pwa",
      user_type: signup.userType,
    });

    // waitlist_signups is unique on lower(email); someone re-joining is already where they want to be.
    if (inserted.error?.code === "23505") {
      return { ok: true, message: "Already on the waitlist." };
    }

    if (inserted.error) {
      throw new Error(inserted.error.message);
    }

    return { ok: true, message: "Waitlist entry synced." };
  } catch (error) {
    return { ok: false, message: getFriendlySyncError(error) };
  }
}

export async function syncFeedbackToCloud(feedback: FeedbackSubmission): Promise<CloudSyncResult> {
  const scope = getAccountScope();
  function checkFeedbackAccount() {
    const current = getAccountScope();
    if (current.userId !== scope.userId || current.generation !== scope.generation) throw new Error("Account changed. Reopen feedback before sending it again.");
  }
  const config = getCloudSyncConfig();
  if (!config) {
    return { ok: false, message: "Cloud sync is not configured yet." };
  }

  try {
    const supabase = await getClient();
    checkFeedbackAccount();
    const issue = getFeedbackIssue(feedback.issue);
    const context = normalizeFeedbackContext(feedback.context);
    let linkedScan = false;
    if (context && scope.userId) {
      const ownedScan = await supabase.from("scan_lookups").select("local_id")
        .eq("user_id", scope.userId).eq("local_id", context.scanId)
        .abortSignal(AbortSignal.timeout(15000)).maybeSingle();
      checkFeedbackAccount();
      if (ownedScan.error) throw new Error("Could not verify the cloud scan for this report. Check your connection and retry.");
      linkedScan = ownedScan.data?.local_id === context.scanId;
    }
    checkFeedbackAccount();
    const inserted = await supabase.from("feedback_submissions").insert({
      ...(scope.userId ? { user_id: scope.userId } : {}),
      category: feedback.category,
      issue_code: issue?.id ?? null,
      scan_local_id: linkedScan && context ? context.scanId : null,
      reported_prediction: linkedScan && context ? context.predictedPart : null,
      contact_email: feedback.contactEmail || null,
      message: feedbackCloudMessage(feedback),
      source: "pwa",
    });
    checkFeedbackAccount();

    if (inserted.error) {
      throw new Error(inserted.error.message);
    }

    return { ok: true, message: context && !linkedScan ? "Feedback synced. Scan context is included as text; this scan is not linked to a cloud record." : "Feedback synced." };
  } catch (error) {
    return { ok: false, message: getFriendlySyncError(error) };
  }
}

function getCloudSyncConfig(): CloudSyncConfig | null {
  const env = import.meta.env;
  const url = env.VITE_SUPABASE_URL?.trim();
  const key = env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();

  if (!url || !key) {
    return null;
  }

  return { key, url };
}

async function getClient() {
  // Reuse the single persistent auth client so only one GoTrueClient ever
  // owns the shared auth-token storage key. Callers have already validated
  // config (same VITE_SUPABASE_* env that getAuthClient reads), so a null
  // client here means auth is genuinely unconfigured.
  const client = await getAuthClient();
  if (!client) {
    throw new Error("Supabase auth is not configured for this build.");
  }

  return client;
}

async function createVerificationClient(config: CloudSyncConfig): Promise<SupabaseClient> {
  const { createClient } = await import("@supabase/supabase-js");
  return createClient(config.url, config.key, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
}

function assertAccount(scope: AccountScope) {
  if (!isAccountScopeCurrent(scope)) throw new Error("Account changed. Sign in and retry from your saved scans.");
}

async function ensureCloudUser(supabase: SupabaseClient, scope: AccountScope): Promise<User> {
  const session = await supabase.auth.getSession();
  assertAccount(scope);
  if (session.error) throw new Error(session.error.message);
  const user = session.data.session?.user;
  if (!user || user.id !== scope.userId) throw new Error("Sign in to the account that owns this scan before syncing.");
  return user;
}

async function signInForHealthCheck(supabase: SupabaseClient): Promise<User> {
  const anonymousSignIn = await supabase.auth.signInAnonymously();
  if (anonymousSignIn.error || !anonymousSignIn.data.user) {
    throw new Error(anonymousSignIn.error?.message ?? "Anonymous sign-in failed.");
  }

  return anonymousSignIn.data.user;
}

async function assertCloudResult(result: { error: { message?: string } | null }, label: string) {
  if (result.error) {
    throw new Error(`${label}: ${result.error.message ?? "Unknown Supabase error."}`);
  }
}

function dataUrlToBlob(dataUrl: string) {
  const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (!match) {
    throw new Error("Captured image is not a valid base64 data URL.");
  }

  const contentType = match[1];
  const bytes = base64ToBytes(match[2]);

  return {
    blob: new Blob([bytes], { type: contentType }),
    byteLength: bytes.byteLength,
    bytes,
    contentType,
    extension: getImageExtension(contentType),
  };
}

function base64ToBytes(base64: string) {
  let binary: string;
  try {
    binary = atob(base64);
  } catch {
    throw new Error("Captured image could not be read. Try taking a new photo.");
  }

  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function healthTestImageBlob() {
  return new Blob([base64ToBytes(HEALTH_TEST_IMAGE_BASE64)], { type: "image/jpeg" });
}

async function hashBytes(bytes: Uint8Array) {
  if (typeof crypto === "undefined" || !crypto.subtle) {
    return null;
  }

  const hashInput = new Uint8Array(bytes.byteLength);
  hashInput.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", hashInput.buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function createRuntimeId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getImageExtension(contentType: string) {
  if (contentType === "image/png") return "png";
  if (contentType === "image/webp") return "webp";
  return "jpg";
}

function getFriendlySyncError(error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown cloud sync error.";
  if (message === "Sign in to the account that owns this scan before syncing." || message.startsWith("Account changed.")) return message;
  if (message === CLOUD_CONFLICT_MESSAGE || message.includes("scan_lookup_revision_conflict")) return CLOUD_CONFLICT_MESSAGE;
  if (/sync_scan_details/i.test(message) && /does not exist|schema cache|could not find/i.test(message)) {
    return "Cloud save requires the scan child revision database migration. Your scan is still saved on this device.";
  }
  if (/revision/i.test(message) && /does not exist|schema cache|could not find .* column/i.test(message)) {
    return "Cloud save requires the scan lookup revision database migration. Your scan is still saved on this device.";
  }

  if (/inspection_json/i.test(message) && /does not exist|schema cache|could not find .* column/i.test(message)) {
    return "Inspection is saved on this device. Apply the part inspection database migration before syncing it to the cloud.";
  }

  // Anchored to Supabase's actual auth wording ("Anonymous sign-ins are disabled", "Signups not
  // allowed"): a bare "signup" also matched the waitlist_signups table in unrelated errors.
  if (/anonymous[\s_-]*(?:sign|auth|provider)|signups? (?:is |are )?(?:not allowed|disabled)|sign-in|sign in/i.test(message)) {
    return "Cloud sync needs Supabase anonymous sign-ins enabled before scans can upload.";
  }

  if (/failed to fetch|networkerror|network error|fetch failed|load failed|timed out|timeout|aborted/i.test(message)) {
    return "Cloud save was not confirmed. Reconnect and retry the save.";
  }

  if (/row-level security|policy|permission|not authorized|unauthorized/i.test(message)) {
    return "Cloud sync was blocked by a security check. Your scan is still saved on this device.";
  }

  if (/storage|bucket/i.test(message)) {
    return "Cloud image upload failed. Check the private scan-images storage bucket.";
  }

  return `Cloud sync failed: ${message}`;
}

function asUuid(value: string | undefined) {
  return value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value
    : null;
}

async function cleanupCloudHealthCheck(supabase: SupabaseClient, userId: string, testId: string, imagePath: string) {
  try {
    await supabase.from("sync_events").delete().eq("user_id", userId).eq("scan_local_id", testId);
    await supabase.from("scan_lookups").delete().eq("user_id", userId).eq("local_id", testId);
    await supabase.storage.from(SCAN_BUCKET).remove([imagePath]);
  } catch {
    // Best-effort cleanup; the health report should still reflect the failed check.
  }
}

function createCloudHealthReport(config: CloudSyncConfig | null, checkedAt: string | null): CloudHealthReport {
  const configured = Boolean(config);
  return {
    checkedAt,
    checks: {
      configured: createCloudHealthCheck(
        "configured",
        "Cloud connection",
        configured ? "Cloud sync is connected." : "Cloud sync isn't connected yet.",
        configured ? "pass" : "fail",
      ),
      anonymousAuth: createCloudHealthCheck("anonymousAuth", "Secure sign-in", "Not checked yet.", "unknown"),
      storageUpload: createCloudHealthCheck("storageUpload", "Photo upload", "Not checked yet.", "unknown"),
      rowUpsert: createCloudHealthCheck("rowUpsert", "Saving scans", "Not checked yet.", "unknown"),
      datasetDetails: createCloudHealthCheck("datasetDetails", "Scan details", "Not checked yet.", "unknown"),
      rlsIsolation: createCloudHealthCheck("rlsIsolation", "Private to you", "Not checked yet.", "unknown"),
    },
    configured,
    lastVerifiedAt: null,
    message: configured
      ? "Cloud sync is set up. Run a quick check to confirm everything's working."
      : "Cloud sync isn't set up yet.",
    overall: configured ? "unknown" : "unconfigured",
    projectUrl: config?.url ?? null,
  };
}

function createCloudHealthCheck(
  id: CloudHealthStepId,
  label: string,
  message: string,
  status: CloudHealthStepStatus,
): CloudHealthCheck {
  return { id, label, message, status };
}

function updateCloudHealthCheck(
  report: CloudHealthReport,
  id: CloudHealthStepId,
  status: CloudHealthStepStatus,
  message: string,
): CloudHealthReport {
  return {
    ...report,
    checks: {
      ...report.checks,
      [id]: {
        ...report.checks[id],
        message,
        status,
      },
    },
  };
}

function markNextUnknownCloudHealthFailure(report: CloudHealthReport, message: string): CloudHealthReport {
  const failedStep = (Object.keys(report.checks) as CloudHealthStepId[]).find(
    (id) => report.checks[id].status === "unknown",
  );

  return {
    ...(failedStep ? updateCloudHealthCheck(report, failedStep, "fail", message) : report),
    message,
    overall: "blocked",
  };
}

function readCloudHealthReport(): CloudHealthReport | null {
  if (typeof localStorage === "undefined") {
    return null;
  }

  try {
    const raw = localStorage.getItem(accountStorageKey(CLOUD_HEALTH_STORAGE_KEY));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CloudHealthReport;
    if (!parsed || typeof parsed !== "object" || !parsed.checks) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveCloudHealthReport(report: CloudHealthReport): CloudHealthReport {
  if (typeof localStorage !== "undefined") {
    try {
      localStorage.setItem(accountStorageKey(CLOUD_HEALTH_STORAGE_KEY), JSON.stringify(report));
    } catch {
      // The current report is still useful even when this device cannot persist it.
    }
  }

  return report;
}
