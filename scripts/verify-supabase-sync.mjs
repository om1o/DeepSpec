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
  console.log("[0/6] Checking Supabase Auth settings...");
  await runPreflight(config);
  console.log("      Anonymous sign-ins are enabled in Supabase Auth settings.");

  ownerClient = createClient(config.url, config.key, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });

  console.log("[1/6] Signing in as an anonymous Supabase user...");
  const firstUser = await signInAnonymously(ownerClient, config);
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
        metadata_json: {
          modelRuns: [],
          ocrText: null,
          promptVersions: [],
          schemaVersion: 1,
          sourceUrls: [],
          syncEvents: [],
        },
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
  await signInAnonymously(otherClient, config);
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

async function signInAnonymously(supabase, config) {
  const { data, error } = await supabase.auth.signInAnonymously();
  if (error || !data.user) {
    const signupProbe = await probeAnonymousSignup(config);
    const code = error?.code ? ` (${error.code})` : "";
    const status = error?.status ? `HTTP ${error.status}` : "unknown status";
    const dashboardLinks = getDashboardLinks(config.url);
    throw new Error(
      [
        `Anonymous sign-in failed: ${error?.message ?? "No user returned"}${code}, ${status}.`,
        formatSignupProbe(signupProbe),
        "The verifier already confirmed anonymous sign-ins are enabled, so this is a Supabase Auth/database problem instead of a browser app problem.",
        dashboardLinks
          ? `Open Auth logs for the failed /signup event: ${dashboardLinks.authLogs}`
          : "Open Supabase Dashboard -> Auth logs for the failed /signup event.",
        "Then run `npm run supabase:print-auth-diagnostics` and paste the SQL into Supabase SQL Editor.",
        "If diagnostics show the standard public.handle_new_user profile trigger is failing, run `npm run supabase:print-auth-anonymous-repair` and review that SQL.",
        dashboardLinks ? `SQL Editor: ${dashboardLinks.sqlEditor}` : "Look for triggers or functions on auth.users that write to missing or constrained profile tables.",
        "Common causes: an outdated Auth schema, or a database trigger on auth.users failing while inserting into public.profiles or another required table.",
        "The private scan table and storage checks cannot run until Auth can create an anonymous user.",
      ].join(" "),
    );
  }

  return data.user;
}

async function probeAnonymousSignup(config) {
  try {
    const response = await fetch(`${config.url}/auth/v1/signup`, {
      method: "POST",
      headers: {
        apikey: config.key,
        Authorization: `Bearer ${config.key}`,
        "Content-Type": "application/json",
        "X-Client-Info": "deepspec-supabase-verifier",
      },
      body: JSON.stringify({
        data: {},
        gotrue_meta_security: {},
      }),
    });
    const bodyText = await response.text();
    let body = null;

    try {
      body = bodyText ? JSON.parse(bodyText) : null;
    } catch {
      body = null;
    }

    return {
      body,
      errorCode: response.headers.get("x-sb-error-code"),
      errorId: body?.error_id ?? null,
      message: body?.msg ?? body?.message ?? null,
      requestId: response.headers.get("sb-request-id"),
      status: response.status,
    };
  } catch (probeError) {
    return {
      body: null,
      errorCode: null,
      errorId: null,
      message: probeError instanceof Error ? probeError.message : "Raw /signup probe failed.",
      requestId: null,
      status: null,
    };
  }
}

function formatSignupProbe(probe) {
  if (!probe) {
    return "Raw /signup diagnostic was unavailable.";
  }

  return [
    `status ${probe.status ?? "unknown"}`,
    `x-sb-error-code ${probe.errorCode ?? "missing"}`,
    `sb-request-id ${probe.requestId ?? "missing"}`,
    `error_id ${probe.errorId ?? "missing"}`,
    probe.message ? `message "${probe.message}"` : null,
  ].filter(Boolean).join(", ").replace(/^/, "Raw /signup diagnostic: ") + ".";
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

function formatSupabaseError(error) {
  const message = error.message ?? "Unknown Supabase error.";
  const code = error.code ? ` (${error.code})` : "";

  if (error.code === "PGRST205" || /schema cache/i.test(message)) {
    return [
      `${message}${code}.`,
      "Apply supabase/migrations/20260518000100_deepspec_secure_foundation.sql,",
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
  process.exit(1);
}
