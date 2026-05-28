const REQUIRED_TABLES = [
  "scan_lookups",
  "scan_model_runs",
  "scan_candidates",
  "scan_evidence",
  "scan_corrections",
  "sync_events",
];

const REQUIRED_BUCKET = "scan-images";

const config = readConfig(process.env);
const failures = [];

console.log("DeepSpec hosted Supabase setup probe");
console.log("This is read-only and does not create Auth users.");
console.log("");

console.log("[1/2] Checking Data API schema cache...");
for (const table of REQUIRED_TABLES) {
  const result = await probeTable(config, table);
  if (result.ok) {
    console.log(`  PASS ${table}: ${result.message}`);
  } else {
    failures.push(`${table}: ${result.message}`);
    console.log(`  FAIL ${table}: ${result.message}`);
  }
}

console.log("");
console.log("[2/2] Checking Storage bucket...");
const bucketResult = await probeBucket(config, REQUIRED_BUCKET);
if (bucketResult.ok) {
  console.log(`  PASS ${REQUIRED_BUCKET}: ${bucketResult.message}`);
} else {
  failures.push(`${REQUIRED_BUCKET}: ${bucketResult.message}`);
  console.log(`  FAIL ${REQUIRED_BUCKET}: ${bucketResult.message}`);
}

if (failures.length > 0) {
  console.error("");
  console.error("Hosted Supabase setup is incomplete:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  console.error("");
  console.error("Apply migrations with `npm run supabase:print-migration`, then rerun this probe and `npm run verify:supabase`.");
  process.exit(1);
}

console.log("");
console.log("Hosted Supabase scan tables and storage bucket are visible. Rerun `npm run verify:supabase` for Auth, RLS, upload, detail-row, and cleanup proof.");

function readConfig(env) {
  const url = env.VITE_SUPABASE_URL;
  const key = env.VITE_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !key) {
    console.error("Missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY.");
    process.exit(1);
  }

  return {
    key,
    url: url.replace(/\/+$/, ""),
  };
}

async function probeTable(config, table) {
  const response = await fetch(`${config.url}/rest/v1/${table}?select=*&limit=1`, {
    headers: authHeaders(config),
  });
  const body = await readJson(response);

  if (response.ok) {
    return { ok: true, message: "visible through REST" };
  }

  if (body?.code === "PGRST205") {
    return { ok: false, message: "missing from Data API schema cache (PGRST205)" };
  }

  if (response.status === 401 || response.status === 403) {
    return { ok: true, message: `visible but blocked for anon as expected (HTTP ${response.status})` };
  }

  return { ok: false, message: formatHttpError(response, body) };
}

async function probeBucket(config, bucket) {
  const response = await fetch(`${config.url}/storage/v1/bucket/${bucket}`, {
    headers: authHeaders(config),
  });
  const body = await readJson(response);

  if (response.ok) {
    return { ok: true, message: "bucket exists" };
  }

  if (body?.message === "Bucket not found" || body?.error === "Bucket not found") {
    return { ok: false, message: "bucket not found" };
  }

  if (response.status === 401 || response.status === 403) {
    return { ok: true, message: `bucket exists but is private for anon as expected (HTTP ${response.status})` };
  }

  return { ok: false, message: formatHttpError(response, body) };
}

function authHeaders(config) {
  return {
    apikey: config.key,
    Authorization: `Bearer ${config.key}`,
  };
}

async function readJson(response) {
  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

function formatHttpError(response, body) {
  const detail = body?.message || body?.msg || body?.error || body?.code || "unexpected response";
  return `HTTP ${response.status}: ${detail}`;
}
