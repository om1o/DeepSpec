import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { FeedbackSubmission, Lookup, WaitlistSignup } from "../types";

const SCAN_BUCKET = "scan-images";

type CloudSyncConfig = {
  key: string;
  url: string;
};

export type CloudSyncStatus = {
  configured: boolean;
  message: string;
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
    message: "Cloud sync is ready. Scans upload to a private Supabase bucket owned by this device user.",
  };
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
    clientPromise = import("@supabase/supabase-js").then(({ createClient }) =>
      createClient(config.url, config.key, {
        auth: {
          autoRefreshToken: true,
          persistSession: true,
        },
      }),
    );
  }

  return clientPromise;
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
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
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
