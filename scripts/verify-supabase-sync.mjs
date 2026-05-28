import { readFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";

const SCAN_BUCKET = "scan-images";
const TEST_IMAGE_BYTES = Buffer.from(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAH/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAEFAqf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/Aaf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/Aaf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAY/Aqf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/IV//2gAMAwEAAgADAAAAEP/EABQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQMBAT8QH//EABQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQIBAT8QH//EABQQAQAAAAAAAAAAAAAAAAAAABD/2gAIAQEAAT8QH//Z",
  "base64",
);
const TEST_IMAGE_MIME_TYPE = "image/jpeg";
const TEST_IMAGE_HASH = createHash("sha256").update(TEST_IMAGE_BYTES).digest("hex");

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

const testId = `phase8-${randomUUID()}`;
let userId;
let imagePath;
let ownerClient;
let failureMessage;

try {
  console.log("[0/8] Checking Supabase Auth settings...");
  await runPreflight(config);
  console.log("      Anonymous sign-ins are enabled in Supabase Auth settings.");

  ownerClient = createClient(config.url, config.key, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });

  console.log("[1/8] Signing in as an anonymous Supabase user...");
  const firstUser = await signInAnonymously(ownerClient, config);
  userId = firstUser.id;
  imagePath = `${userId}/${testId}.jpg`;

  console.log("[2/8] Uploading a private test scan image...");
  await assertNoError(
    await ownerClient.storage.from(SCAN_BUCKET).upload(imagePath, TEST_IMAGE_BYTES, {
      contentType: TEST_IMAGE_MIME_TYPE,
      upsert: false,
    }),
    "Storage upload failed",
  );

  console.log("[3/8] Writing a scan_lookups row through RLS...");
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
        image_byte_length: TEST_IMAGE_BYTES.length,
        image_hash: TEST_IMAGE_HASH,
        image_mime_type: TEST_IMAGE_MIME_TYPE,
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

  console.log("[4/8] Writing durable dataset detail rows through RLS...");
  await writeDatasetDetailRows(ownerClient, userId, testId);

  console.log("[5/8] Reading the scan and detail rows back as the owning user...");
  const ownRead = await ownerClient
    .from("scan_lookups")
    .select("local_id,user_id,image_path,image_hash,image_mime_type,image_byte_length,scan_category,training_status")
    .eq("local_id", testId)
    .single();
  await assertNoError(ownRead, "Owner read failed");

  if (
    ownRead.data?.user_id !== userId ||
    ownRead.data?.image_path !== imagePath ||
    ownRead.data?.image_hash !== TEST_IMAGE_HASH ||
    ownRead.data?.image_mime_type !== TEST_IMAGE_MIME_TYPE ||
    ownRead.data?.image_byte_length !== TEST_IMAGE_BYTES.length
  ) {
    throw new Error("Owner read returned the wrong scan row.");
  }

  await assertOwnerDatasetRows(ownerClient, testId);

  console.log("[6/8] Proving another anonymous user cannot read that scan dataset...");
  const otherClient = createClient(config.url, config.key, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
  await signInAnonymously(otherClient, config);
  await assertCrossUserCannotRead(otherClient, "scan_lookups", "local_id", testId);
  await assertCrossUserCannotRead(otherClient, "scan_candidates", "scan_local_id", testId);
  await assertCrossUserCannotRead(otherClient, "scan_evidence", "scan_local_id", testId);
  await assertCrossUserCannotRead(otherClient, "scan_corrections", "scan_local_id", testId);
  await assertCrossUserCannotRead(otherClient, "scan_model_runs", "scan_local_id", testId);
  await assertCrossUserCannotRead(otherClient, "sync_events", "scan_local_id", testId);

  console.log("[7/8] Downloading the private image as the owner...");
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

async function signInAnonymously(supabase, config) {
  const { data, error } = await supabase.auth.signInAnonymously();
  if (error || !data.user) {
    const code = error?.code ? ` (${error.code})` : "";
    const status = error?.status ? `HTTP ${error.status}` : "unknown status";
    const dashboardLinks = getDashboardLinks(config.url);
    throw new Error(
      [
        `Anonymous sign-in failed: ${error?.message ?? "No user returned"}${code}, ${status}.`,
        "The verifier already confirmed anonymous sign-ins are enabled, so this is a Supabase Auth/database problem instead of a browser app problem.",
        dashboardLinks
          ? `Open Auth logs for the failed /signup event: ${dashboardLinks.authLogs}`
          : "Open Supabase Dashboard -> Auth logs for the failed /signup event.",
        "Then run `npm run supabase:print-auth-diagnostics` and paste the SQL into Supabase SQL Editor.",
        dashboardLinks ? `SQL Editor: ${dashboardLinks.sqlEditor}` : "Look for triggers or functions on auth.users that write to missing or constrained profile tables.",
        "Common causes: an outdated Auth schema, or a database trigger on auth.users failing while inserting into public.profiles or another required table.",
        "The private scan table and storage checks cannot run until Auth can create an anonymous user.",
      ].join(" "),
    );
  }

  return data.user;
}

function getDashboardLinks(projectUrl) {
  let hostname;

  try {
    hostname = new URL(projectUrl).hostname;
  } catch {
    return null;
  }

  const projectRef = hostname.endsWith(".supabase.co") ? hostname.replace(".supabase.co", "") : "";
  if (!projectRef) {
    return null;
  }

  return {
    authLogs: `https://supabase.com/dashboard/project/${projectRef}/logs/auth-logs`,
    sqlEditor: `https://supabase.com/dashboard/project/${projectRef}/sql/new`,
  };
}

async function runPreflight(config) {
  const headers = {
    apikey: config.key,
    Authorization: `Bearer ${config.key}`,
  };
  const settings = await fetchJson(`${config.url}/auth/v1/settings`, headers);

  if (!settings.ok) {
    throw new Error(`Could not read Supabase Auth settings: ${settings.status} ${settings.bodyText}`);
  }

  if (settings.body?.external?.anonymous_users !== true) {
    throw new Error("Anonymous sign-ins are disabled in Supabase Auth settings.");
  }
}

async function fetchJson(url, headers) {
  const response = await fetch(url, { headers });
  const bodyText = await response.text();
  let parsedBody;

  try {
    parsedBody = bodyText ? JSON.parse(bodyText) : null;
  } catch {
    parsedBody = null;
  }

  return {
    body: parsedBody,
    bodyText,
    ok: response.ok,
    status: response.status,
  };
}

async function assertNoError(result, label) {
  if (result.error) {
    throw new Error(`${label}: ${formatSupabaseError(result.error)}`);
  }
}

async function writeDatasetDetailRows(supabase, userId, scanLocalId) {
  await assertNoError(
    await supabase.from("scan_candidates").insert({
      candidate_json: {
        source: "phase8-verifier",
      },
      candidate_rank: 0,
      confidence: "low",
      part_name: "Phase 8 Related Part",
      reason: "Synthetic row for durable dataset verification.",
      scan_category: "unknown",
      scan_local_id: scanLocalId,
      user_id: userId,
    }),
    "scan_candidates insert failed",
  );

  await assertNoError(
    await supabase.from("scan_evidence").insert([
      {
        evidence_json: {
          source: "phase8-verifier",
        },
        evidence_rank: 0,
        evidence_text: "Synthetic visual observation for durable dataset verification.",
        evidence_type: "observation",
        label: "Phase 8 observation",
        region_label: "full image",
        scan_local_id: scanLocalId,
        user_id: userId,
      },
      {
        evidence_json: {
          source: "phase8-verifier",
        },
        evidence_rank: 1,
        evidence_text: "Synthetic reference link for durable dataset verification.",
        evidence_type: "source_link",
        label: "Phase 8 reference",
        scan_local_id: scanLocalId,
        source_type: "reference",
        url: "https://example.com/deepspec-phase8-verifier",
        user_id: userId,
      },
    ]),
    "scan_evidence insert failed",
  );

  await assertNoError(
    await supabase.from("scan_corrections").upsert(
      {
        corrected_category: null,
        corrected_part_name: null,
        correction_text: null,
        damage_severity: "unknown",
        notes: "Synthetic correction row for durable dataset verification.",
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

  await assertNoError(
    await supabase.from("scan_model_runs").insert({
      error_code: null,
      error_message: null,
      latency_ms: 0,
      metadata_json: {
        source: "phase8-verifier",
      },
      model: "synthetic",
      ocr_used: false,
      prompt_version: "phase8-verifier",
      provider: "phase8-verifier",
      scan_local_id: scanLocalId,
      user_id: userId,
    }),
    "scan_model_runs insert failed",
  );

  await assertNoError(
    await supabase.from("sync_events").insert({
      event_type: "verify",
      message: "Synthetic sync event for durable dataset verification.",
      metadata_json: {
        source: "phase8-verifier",
      },
      scan_local_id: scanLocalId,
      status: "success",
      user_id: userId,
    }),
    "sync_events insert failed",
  );
}

async function assertOwnerDatasetRows(supabase, scanLocalId) {
  await assertTableRowCount(
    await supabase.from("scan_candidates").select("scan_local_id,candidate_rank,part_name").eq("scan_local_id", scanLocalId),
    "scan_candidates owner read failed",
    1,
  );
  await assertTableRowCount(
    await supabase.from("scan_evidence").select("scan_local_id,evidence_rank,evidence_type").eq("scan_local_id", scanLocalId),
    "scan_evidence owner read failed",
    2,
  );
  await assertTableRowCount(
    await supabase.from("scan_corrections").select("scan_local_id,training_status").eq("scan_local_id", scanLocalId),
    "scan_corrections owner read failed",
    1,
  );
  await assertTableRowCount(
    await supabase.from("scan_model_runs").select("scan_local_id,provider,model").eq("scan_local_id", scanLocalId),
    "scan_model_runs owner read failed",
    1,
  );
  await assertTableRowCount(
    await supabase.from("sync_events").select("scan_local_id,event_type,status").eq("scan_local_id", scanLocalId),
    "sync_events owner read failed",
    1,
  );
}

async function assertTableRowCount(result, label, expectedCount) {
  await assertNoError(result, label);

  const actualCount = result.data?.length ?? 0;
  if (actualCount !== expectedCount) {
    throw new Error(`${label}: expected ${expectedCount} row(s), got ${actualCount}.`);
  }
}

async function assertCrossUserCannotRead(supabase, table, idColumn, scanLocalId) {
  const crossRead = await supabase.from(table).select(idColumn).eq(idColumn, scanLocalId);
  await assertNoError(crossRead, `${table} cross-user RLS check failed`);

  if ((crossRead.data ?? []).length !== 0) {
    throw new Error(`RLS failed: another anonymous user could read ${table}.`);
  }
}

function formatSupabaseError(error) {
  const message = error.message ?? "Unknown Supabase error.";
  const code = error.code ? ` (${error.code})` : "";

  if (error.code === "PGRST205" || /schema cache/i.test(message)) {
    return [
      `${message}${code}.`,
      "Apply every SQL file in supabase/migrations in timestamp order,",
      "or run npm run supabase:print-migration and paste that SQL into Supabase SQL Editor.",
      "Then make sure Project Settings -> API exposes the public schema and wait for the schema cache to refresh.",
    ].join(" ");
  }

  if (/bucket not found/i.test(message)) {
    return [
      `${message}${code}.`,
      "Apply the DeepSpec Supabase migration so the private scan-images bucket and storage policies are created.",
    ].join(" ");
  }

  return `${message}${code}`;
}

async function cleanupTestData(supabase, userId, testId, imagePath) {
  await supabase.from("sync_events").delete().eq("user_id", userId).eq("scan_local_id", testId);
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
