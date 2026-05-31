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

export function getCloudSyncStatus(): CloudSyncStatus {
  const config = getCloudSyncConfig();

  if (!config) {
    return {
      configured: false,
      message: "Cloud sync is off. Add Supabase public config after parent-approved privacy setup.",
    };
  }

  return {
    configured: true,
    message: "Cloud sync is configured but not verified. Run the Supabase verifier before calling storage, RLS, and dataset tables ready.",
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
    report = updateCloudHealthCheck(report, "configured", "fail", "Missing Supabase public config.");
    return saveCloudHealthReport({
      ...report,
      message: "Cloud sync is not configured.",
      overall: "unconfigured",
    });
  }

  report = updateCloudHealthCheck(report, "configured", "pass", "Supabase public config is present.");
  let ownerClient: SupabaseClient | null = null;
  let userId: string | null = null;
  let imagePath: string | null = null;
  const testId = `health-${createRuntimeId()}`;

  try {
    ownerClient = await createVerificationClient(config);
    const owner = await signInForHealthCheck(ownerClient);
    userId = owner.id;
    report = updateCloudHealthCheck(report, "anonymousAuth", "pass", "Anonymous Auth created a runtime user.");

    imagePath = `${userId}/${testId}.jpg`;
    await assertCloudResult(
      await ownerClient.storage.from(SCAN_BUCKET).upload(imagePath, healthTestImageBlob(), {
        contentType: "image/jpeg",
        upsert: false,
      }),
      "Private image upload failed",
    );
    report = updateCloudHealthCheck(report, "storageUpload", "pass", "Private scan image upload passed.");

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
    report = updateCloudHealthCheck(report, "rowUpsert", "pass", "scan_lookups upsert passed through RLS.");

    await writeCloudHealthDatasetDetails(ownerClient, userId, testId);
    report = updateCloudHealthCheck(report, "datasetDetails", "pass", "Durable dataset detail writes passed through RLS.");

    const otherClient = await createVerificationClient(config);
    await signInForHealthCheck(otherClient);
    await assertCloudHealthRlsIsolation(otherClient, testId);
    report = updateCloudHealthCheck(report, "rlsIsolation", "pass", "Another anonymous user could not read this scan dataset.");

    return saveCloudHealthReport({
      ...report,
      lastVerifiedAt: checkedAt,
      message: "Cloud sync passed runtime health checks.",
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
        local_id: lookup.id,
        notes: lookup.notes,
        rating: lookup.rating,
        result_json: lookup.result ?? null,
        scan_category: lookup.scanCategory,
        training_label: lookup.trainingLabel,
        training_status: lookup.trainingStatus,
        user_id: user.id,
      },
      { onConflict: "user_id,local_id" },
    );

    if (saved.error) {
      throw new Error(saved.error.message);
    }

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

async function syncDatasetDetailTables(supabase: SupabaseClient, userId: string, lookup: Lookup) {
  await replaceScanCandidates(supabase, userId, lookup);
  await replaceScanEvidence(supabase, userId, lookup);
  await upsertScanCorrection(supabase, userId, lookup);
  await insertScanModelRun(supabase, userId, lookup);
  await insertSyncEvent(supabase, userId, lookup.id, "upsert", "success", "Scan dataset details synced.");
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
  await assertCloudResult(
    await supabase.from("scan_model_runs").insert({
      error_code: lookup.errorCode ?? null,
      error_message: lookup.errorMessage ?? null,
      metadata_json: {
        confidence: lookup.result?.confidence ?? null,
        confidenceRange: lookup.result?.confidenceRange ?? null,
        confidenceScore: lookup.result?.confidenceScore ?? null,
        confirmationNeed: lookup.result?.confirmationNeed ?? null,
        hasResult: Boolean(lookup.result),
        safetyTriage: lookup.result?.safetyTriage ?? null,
      },
      model: "unknown",
      ocr_used: hasOcrEvidence(lookup),
      prompt_version: null,
      provider: "unknown",
      scan_local_id: lookup.id,
      user_id: userId,
    }),
    "scan_model_runs insert failed",
  );
}

async function insertSyncEvent(
  supabase: SupabaseClient,
  userId: string,
  scanLocalId: string,
  eventType: "upload" | "upsert" | "delete" | "verify",
  status: "success" | "failure",
  message: string,
) {
  await assertCloudResult(
    await supabase.from("sync_events").insert({
      event_type: eventType,
      message,
      metadata_json: {},
      scan_local_id: scanLocalId,
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
    return "Cloud sync was blocked by Supabase security policy. Check the migration and RLS policies.";
  }

  if (/storage|bucket/i.test(message)) {
    return "Cloud image upload failed. Check the private scan-images storage bucket.";
  }

  return `Cloud sync failed: ${message}`;
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
        "Configured",
        configured ? "Supabase public config is present." : "Missing Supabase public config.",
        configured ? "pass" : "fail",
      ),
      anonymousAuth: createCloudHealthCheck("anonymousAuth", "Anonymous auth", "Not checked yet.", "unknown"),
      storageUpload: createCloudHealthCheck("storageUpload", "Image upload", "Not checked yet.", "unknown"),
      rowUpsert: createCloudHealthCheck("rowUpsert", "Row upsert", "Not checked yet.", "unknown"),
      datasetDetails: createCloudHealthCheck("datasetDetails", "Dataset details", "Not checked yet.", "unknown"),
      rlsIsolation: createCloudHealthCheck("rlsIsolation", "RLS isolation", "Not checked yet.", "unknown"),
    },
    configured,
    lastVerifiedAt: null,
    message: configured
      ? "Cloud sync is configured, but runtime health has not passed yet."
      : "Cloud sync is not configured.",
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
