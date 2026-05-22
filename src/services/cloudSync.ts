import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { FeedbackSubmission, Lookup, WaitlistSignup } from "../types";
import { appendLookupSyncEvent, getLookupDatasetMetadata } from "./storage";

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

export type CloudHealthStepId = "configured" | "anonymousAuth" | "storageUpload" | "rowUpsert" | "rlsIsolation";
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

let clientPromise: Promise<SupabaseClient> | null = null;

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
    message: "Cloud sync is configured but not verified. Run the Supabase verifier before calling storage and RLS ready.",
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

    const otherClient = await createVerificationClient(config);
    await signInForHealthCheck(otherClient);
    const crossRead = await otherClient.from("scan_lookups").select("local_id").eq("local_id", testId);
    await assertCloudResult(crossRead, "Cross-user RLS read failed");
    if ((crossRead.data ?? []).length > 0) {
      throw new Error("RLS failed: another anonymous user could read the health-check scan.");
    }
    report = updateCloudHealthCheck(report, "rlsIsolation", "pass", "Another anonymous user could not read this scan.");

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
    const supabase = await getClient(config);
    const user = await ensureCloudUser(supabase);
    const image = dataUrlToBlob(lookup.frame.imageBase64);
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
        image_path: imagePath,
        local_id: lookup.id,
        metadata_json: getLookupDatasetMetadata(lookup, imagePath),
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

    const message = "Scan synced to the private Deep Spec dataset.";
    appendLookupSyncEvent(lookup.id, { imagePath, message, status: "success" });

    return {
      ok: true,
      imagePath,
      message,
    };
  } catch (error) {
    const message = getFriendlySyncError(error);
    appendLookupSyncEvent(lookup.id, { message, status: "failure" });
    return {
      ok: false,
      message,
    };
  }
}

export async function syncWaitlistSignupToCloud(signup: WaitlistSignup): Promise<CloudSyncResult> {
  const config = getCloudSyncConfig();
  if (!config) {
    return { ok: false, message: "Cloud sync is not configured yet." };
  }

  try {
    const supabase = await getClient(config);
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
    const supabase = await getClient(config);
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

async function getClient(config: CloudSyncConfig) {
  if (!clientPromise) {
    clientPromise = import("@supabase/supabase-js")
      .then(({ createClient }) =>
        createClient(config.url, config.key, {
          auth: {
            autoRefreshToken: true,
            persistSession: true,
          },
        }),
      )
      .catch((error) => {
        clientPromise = null;
        throw error;
      });
  }

  return clientPromise;
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
