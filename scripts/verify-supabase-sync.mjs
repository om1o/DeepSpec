import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";

const SCAN_BUCKET = "scan-images";
const TEST_IMAGE_BYTES = Buffer.from(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAH/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAEFAqf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/Aaf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/Aaf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAY/Aqf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/IV//2gAMAwEAAgADAAAAEP/EABQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQMBAT8QH//EABQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQIBAT8QH//EABQQAQAAAAAAAAAAAAAAAAAAABD/2gAIAQEAAT8QH//Z",
  "base64",
);

loadLocalEnv(".env.local");
loadLocalEnv(".env");

const config = {
  key: process.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim(),
  url: process.env.VITE_SUPABASE_URL?.trim(),
};

if (!config.url || !config.key) {
  fail(
    [
      "Phase 8 cloud sync verification blocked.",
      "Missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY in .env.local.",
      "Do not use a service-role key. Use the Supabase publishable/anon key.",
    ].join("\n"),
  );
}

const testId = `phase8-${crypto.randomUUID()}`;
let userId;
let imagePath;
let ownerClient;
let failureMessage;

try {
  ownerClient = createClient(config.url, config.key, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });

  console.log("[1/6] Signing in as an anonymous Supabase user...");
  const firstUser = await signInAnonymously(ownerClient);
  userId = firstUser.id;
  imagePath = `${userId}/${testId}.jpg`;

  console.log("[2/6] Uploading a private test scan image...");
  await assertNoError(
    await ownerClient.storage.from(SCAN_BUCKET).upload(imagePath, TEST_IMAGE_BYTES, {
      contentType: "image/jpeg",
      upsert: false,
    }),
    "Storage upload failed",
  );

  console.log("[3/6] Writing a scan_lookups row through RLS...");
  await assertNoError(
    await ownerClient.from("scan_lookups").upsert(
      {
        analyzed_at: new Date().toISOString(),
        captured_at: new Date().toISOString(),
        chat_history: [],
        correction: null,
        created_at: new Date().toISOString(),
        error_code: null,
        error_message: null,
        image_path: imagePath,
        local_id: testId,
        notes: "Phase 8 verification row. Safe to delete.",
        rating: null,
        result_json: {
          confidence: "high",
          partName: "Phase 8 Test Part",
          safetyTriage: "can_help",
        },
        scan_category: "unknown",
        training_label: "Phase 8 Test Part",
        training_status: "raw_unreviewed",
        user_id: userId,
      },
      { onConflict: "user_id,local_id" },
    ),
    "scan_lookups upsert failed",
  );

  console.log("[4/6] Reading the row back as the owning user...");
  const ownRead = await ownerClient
    .from("scan_lookups")
    .select("local_id,user_id,image_path,scan_category,training_status")
    .eq("local_id", testId)
    .single();
  await assertNoError(ownRead, "Owner read failed");

  if (ownRead.data?.user_id !== userId || ownRead.data?.image_path !== imagePath) {
    throw new Error("Owner read returned the wrong scan row.");
  }

  console.log("[5/6] Proving another anonymous user cannot read that scan...");
  const otherClient = createClient(config.url, config.key, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
  await signInAnonymously(otherClient);
  const crossRead = await otherClient.from("scan_lookups").select("local_id").eq("local_id", testId);
  await assertNoError(crossRead, "Cross-user RLS check failed");

  if ((crossRead.data ?? []).length !== 0) {
    throw new Error("RLS failed: another anonymous user could read the test scan.");
  }

  console.log("[6/6] Downloading the private image as the owner...");
  await assertNoError(await ownerClient.storage.from(SCAN_BUCKET).download(imagePath), "Owner storage download failed");

  console.log("Phase 8 cloud sync verification passed.");
} catch (error) {
  failureMessage = error instanceof Error ? error.message : "Unknown verification error.";
} finally {
  if (ownerClient && userId && imagePath) {
    await cleanupTestData(ownerClient, userId, testId, imagePath);
  }

  if (failureMessage) {
    fail(failureMessage);
  }
}

async function signInAnonymously(supabase) {
  const { data, error } = await supabase.auth.signInAnonymously();
  if (error || !data.user) {
    throw new Error(
      `Anonymous sign-in failed. Enable anonymous sign-ins in Supabase Auth settings. ${error?.message ?? ""}`.trim(),
    );
  }

  return data.user;
}

async function assertNoError(result, label) {
  if (result.error) {
    throw new Error(`${label}: ${result.error.message}`);
  }
}

async function cleanupTestData(supabase, userId, testId, imagePath) {
  await supabase.from("scan_lookups").delete().eq("user_id", userId).eq("local_id", testId);
  await supabase.storage.from(SCAN_BUCKET).remove([imagePath]);
}

function loadLocalEnv(filename) {
  const path = join(process.cwd(), filename);
  let contents;

  try {
    contents = readFileSync(path, "utf8");
  } catch {
    return;
  }

  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) continue;

    const key = trimmed.slice(0, separatorIndex).trim();
    const rawValue = trimmed.slice(separatorIndex + 1).trim();
    if (!key || process.env[key]) continue;

    process.env[key] = rawValue.replace(/^["']|["']$/g, "");
  }
}

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}
