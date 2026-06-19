import type { SupabaseClient, User } from "@supabase/supabase-js";
import { getAuthClient } from "./auth";
import type { FeedbackSubmission, Lookup, WaitlistSignup } from "../types";

const SCAN_BUCKET = "scan-images";
const CLOUD_HEALTH_STORAGE_KEY = "deep-spec:cloud-health";
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
  const config = getCloudSyncConfig();
  const checkedAt = new Date().toISOString();
  let report = createCloudHealthReport(config, checkedAt);

  if (!config) {
    report = updateCloudHealthCheck(report, "configured", "fail", "Cloud sync isn't connected yet.");
    return saveCloudHealthReport({
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

    return saveCloudHealthReport({
      ...report,
      lastVerifiedAt: checkedAt,
      message: "Cloud sync is working. Your scans save and stay private to you.",
      overall: "ready",
    });
  } catch (error) {
    return saveCloudHealthReport(markNextUnknownCloudHealthFailure(report, getFriendlySyncError(error)));
  } finally {
    if (ownerClient && userId && imagePath) {
      await cleanupCloudHealthCheck(ownerClient, userId, testId, imagePath);
    }
  }
}

export async function syncLookupToCloud(lookup: Lookup): Promise<CloudSyncResult> {
  const config = getCloudSyncConfig();
  if (!config) {
    return {
      ok: false,
      message: "Cloud sync is not configured yet.",
    };
  }

  try {
    const supabase = await getClient();
    const user = await ensureCloudUser(supabase);
    const image = dataUrlToBlob(lookup.frame.imageBase64);
    const imageHash = await hashBytes(image.bytes);
    const imagePath = `${user.id}/${lookup.id}.${image.extension}`;
    const uploaded = await supabase.storage.from(SCAN_BUCKET).upload(imagePath, image.blob, {
      contentType: image.contentType,
      upsert: true,
    });

    if (uploaded.error) {
      throw new Error(uploaded.error.message);
    }

    const saved = await supabase.from("scan_lookups").upsert(
      {
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
        customer_visible_report_json: lookup.customerVisibleReport ?? null,
        job_id: asUuid(lookup.jobId),
        local_id: lookup.id,
        notes: lookup.notes,
        org_id: asUuid(lookup.orgId),
        rating: lookup.rating,
        result_json: lookup.result ?? null,
        review_status: lookup.reviewStatus ?? null,
        scan_category: lookup.scanCategory,
        technician_user_id: asUuid(lookup.technicianUserId),
        training_label: lookup.trainingLabel,
        training_status: lookup.trainingStatus,
        user_id: user.id,
        vehicle_context: lookup.vehicleContext ?? null,
      },
      { onConflict: "user_id,local_id" },
    );

    if (saved.error) {
      throw new Error(saved.error.message);
    }

    await upsertShopJobScan(supabase, user.id, lookup);
    await syncDatasetDetailTables(supabase, user.id, lookup);

    return {
      ok: true,
      imagePath,
      message: "Scan synced to the private Deep Spec dataset.",
    };
  } catch (error) {
    return {
      ok: false,
      message: getFriendlySyncError(error),
    };
  }
}

export async function syncLookupsToCloud(lookups: Lookup[]): Promise<CloudBatchSyncResult> {
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
    const result = await syncLookupToCloud(lookup);
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

async function syncDatasetDetailTables(supabase: SupabaseClient, userId: string, lookup: Lookup) {
  await replaceScanCandidates(supabase, userId, lookup);
  await replaceScanEvidence(supabase, userId, lookup);
  await upsertScanCorrection(supabase, userId, lookup);
  await insertScanModelRun(supabase, userId, lookup);
  await insertSyncEvent(supabase, userId, lookup, "upsert", "success", "Scan dataset details synced.");
}

async function upsertShopJobScan(supabase: SupabaseClient, userId: string, lookup: Lookup) {
  const orgId = asUuid(lookup.orgId);
  const jobId = asUuid(lookup.jobId);
  if (!orgId || !jobId) {
    return;
  }

  await assertCloudResult(
    await supabase.from("job_scans").upsert(
      {
        customer_visible_report_json: lookup.customerVisibleReport ?? null,
        job_id: jobId,
        org_id: orgId,
        review_status: lookup.reviewStatus ?? "needs_review",
        scan_local_id: lookup.id,
        user_id: userId,
      },
      { onConflict: "job_id,user_id,scan_local_id" },
    ),
    "job_scans upsert failed",
  );
}

async function replaceScanCandidates(supabase: SupabaseClient, userId: string, lookup: Lookup) {
  await deleteScanDetails(supabase, "scan_candidates", userId, lookup.id);
  const candidates = lookup.result?.candidateMatches ?? [];
  if (!candidates.length) {
    return;
  }

  await assertCloudResult(
    await supabase.from("scan_candidates").insert(
      candidates.map((candidate, index) => ({
        candidate_json: candidate,
        candidate_rank: index,
        confidence: candidate.confidence,
        part_name: candidate.partName,
        reason: candidate.reason,
        scan_category: candidate.scanCategory,
        scan_local_id: lookup.id,
        user_id: userId,
      })),
    ),
    "scan_candidates insert failed",
  );
}

async function replaceScanEvidence(supabase: SupabaseClient, userId: string, lookup: Lookup) {
  await deleteScanDetails(supabase, "scan_evidence", userId, lookup.id);
  const evidence = buildEvidenceRows(userId, lookup);
  if (!evidence.length) {
    return;
  }

  await assertCloudResult(await supabase.from("scan_evidence").insert(evidence), "scan_evidence insert failed");
}

async function upsertScanCorrection(supabase: SupabaseClient, userId: string, lookup: Lookup) {
  await assertCloudResult(
    await supabase.from("scan_corrections").upsert(
      {
        corrected_category: lookup.correction ? lookup.scanCategory : null,
        corrected_part_name: lookup.correction?.trim() || null,
        correction_text: lookup.correction,
        damage_severity: "unknown",
        notes: lookup.notes,
        rating: lookup.rating,
        region_label: null,
        scan_local_id: lookup.id,
        training_status: lookup.trainingStatus,
        user_id: userId,
      },
      { onConflict: "user_id,scan_local_id" },
    ),
    "scan_corrections upsert failed",
  );
}

async function insertScanModelRun(supabase: SupabaseClient, userId: string, lookup: Lookup) {
  const modelRun = lookup.result?.modelRun;
  await assertCloudResult(
    await supabase.from("scan_model_runs").insert({
      error_code: lookup.errorCode ?? null,
      error_message: lookup.errorMessage ?? null,
      metadata_json: {
        analysisSource: lookup.provenance.analysisSource,
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
      prompt_version: null,
      provider: modelRun?.provider ?? "unknown",
      scan_local_id: lookup.id,
      user_id: userId,
    }),
    "scan_model_runs insert failed",
  );
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
  await assertCloudResult(
    await supabase.from("scan_candidates").insert({
      candidate_json: { source: "runtime-health" },
      candidate_rank: 0,
      confidence: "low",
      part_name: "Runtime Health Related Part",
      reason: "Synthetic row for runtime durable dataset verification.",
      scan_category: "unknown",
      scan_local_id: scanLocalId,
      user_id: userId,
    }),
    "scan_candidates insert failed",
  );
  await assertCloudResult(
    await supabase.from("scan_evidence").insert({
      evidence_json: { source: "runtime-health" },
      evidence_rank: 0,
      evidence_text: "Synthetic visual observation for runtime durable dataset verification.",
      evidence_type: "observation",
      label: "Runtime health observation",
      scan_local_id: scanLocalId,
      user_id: userId,
    }),
    "scan_evidence insert failed",
  );
  await assertCloudResult(
    await supabase.from("scan_corrections").upsert(
      {
        corrected_category: null,
        corrected_part_name: null,
        correction_text: null,
        damage_severity: "unknown",
        notes: "Synthetic correction row for runtime durable dataset verification.",
        rating: null,
        region_label: null,
        scan_local_id: scanLocalId,
        training_status: "raw_unreviewed",
        user_id: userId,
      },
      { onConflict: "user_id,scan_local_id" },
    ),
    "scan_corrections upsert failed",
  );
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

async function deleteScanDetails(supabase: SupabaseClient, table: "scan_candidates" | "scan_evidence", userId: string, scanLocalId: string) {
  await assertCloudResult(
    await supabase.from(table).delete().eq("user_id", userId).eq("scan_local_id", scanLocalId),
    `${table} cleanup failed`,
  );
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

    if (inserted.error) {
      throw new Error(inserted.error.message);
    }

    return { ok: true, message: "Waitlist entry synced." };
  } catch (error) {
    return { ok: false, message: getFriendlySyncError(error) };
  }
}

export async function syncFeedbackToCloud(feedback: FeedbackSubmission): Promise<CloudSyncResult> {
  const config = getCloudSyncConfig();
  if (!config) {
    return { ok: false, message: "Cloud sync is not configured yet." };
  }

  try {
    const supabase = await getClient();
    const inserted = await supabase.from("feedback_submissions").insert({
      category: feedback.category,
      contact_email: feedback.contactEmail || null,
      message: feedback.message,
      source: "pwa",
    });

    if (inserted.error) {
      throw new Error(inserted.error.message);
    }

    return { ok: true, message: "Feedback synced." };
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

async function ensureCloudUser(supabase: SupabaseClient): Promise<User> {
  const session = await supabase.auth.getSession();
  if (session.error) {
    throw new Error(session.error.message);
  }

  if (session.data.session?.user) {
    return session.data.session.user;
  }

  const anonymousSignIn = await supabase.auth.signInAnonymously();
  if (anonymousSignIn.error || !anonymousSignIn.data.user) {
    throw new Error(anonymousSignIn.error?.message ?? "Anonymous sign-in failed.");
  }

  return anonymousSignIn.data.user;
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

  if (/anonymous|signup|sign-in|sign in/i.test(message)) {
    return "Cloud sync needs Supabase anonymous sign-ins enabled before scans can upload.";
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
    const raw = localStorage.getItem(CLOUD_HEALTH_STORAGE_KEY);
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
      localStorage.setItem(CLOUD_HEALTH_STORAGE_KEY, JSON.stringify(report));
    } catch {
      // The current report is still useful even when this device cannot persist it.
    }
  }

  return report;
}
