import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readSupabaseAdminKey } from "./supabase-admin-env.mjs";

const MAX_ROWS = 200;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH = /^[0-9a-f]{64}$/i;
// The SQL view uses MD5 only as a change fingerprint; image integrity uses SHA-256.
const ROW_FINGERPRINT = /^[0-9a-f]{32}$/i;
const TYPES = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const canonical = value => JSON.stringify(value, Object.keys(value).sort());
const snapshot = rows => rows.map(canonical).sort().join("\n");

async function requireAbsent(path) {
  try { await access(path); } catch (error) { if (error.code === "ENOENT") return; throw error; }
  throw new Error("Output directory already exists. Use a fresh directory.");
}

function validateImage(row, prefix) {
  const path = row[`${prefix}_image_path`];
  if (prefix === "isolated" && path == null) {
    if (["hash", "mime_type", "byte_length", "kind"].some(key => row[`isolated_image_${key}`] != null)) throw new Error("Incomplete optional image provenance.");
    return null;
  }
  if (prefix === "isolated" && !["crop", "segmentation"].includes(row.isolated_image_kind)) throw new Error("Unsupported isolated image kind.");
  const pieces = typeof path === "string" ? path.split("/") : [];
  if (pieces.length < 2 || pieces[0] !== row.user_id || pieces.some(piece => !/^[a-zA-Z0-9_.-]+$/.test(piece) || piece === "." || piece === "..")) throw new Error("Image path must stay inside the scan owner's folder.");
  const hash = row[`${prefix}_image_hash`], mime = row[`${prefix}_image_mime_type`], length = row[`${prefix}_image_byte_length`];
  if (!HASH.test(hash ?? "") || !TYPES[mime] || !Number.isSafeInteger(length) || length <= 0 || length > MAX_IMAGE_BYTES) throw new Error("Invalid image integrity metadata or image exceeds 2 MiB.");
  return { path, hash: hash.toLowerCase(), mime, length };
}

function validateRows(rows, version) {
  if (!Array.isArray(rows) || !rows.length || rows.length > MAX_ROWS) throw new Error("Export requires 1–200 eligible memberships; split larger datasets into explicit versions.");
  const ids = new Set();
  for (const row of rows) {
    if (row.dataset_version !== version || row.eligible !== true || !UUID.test(row.id) || !UUID.test(row.user_id) || !UUID.test(row.model_run_id) || ids.has(row.id)) throw new Error("Invalid or duplicate eligible membership.");
    ids.add(row.id);
    if (!Number.isSafeInteger(row.consent_revision) || row.consent_revision < 1 || !row.policy_version || !row.scan_local_id || !ROW_FINGERPRINT.test(row.scan_hash ?? "") || !ROW_FINGERPRINT.test(row.model_run_hash ?? "") || !row.reviewer_reference || !row.label?.trim() || !["human_verified_prediction", "human_verified_correction"].includes(row.label_source)) throw new Error("Missing reviewed consent, label, or model provenance.");
    validateImage(row, "original"); validateImage(row, "isolated");
  }
}

export function createExportClient({ url, key, fetchImpl = fetch }) {
  const origin = new URL(url);
  if (origin.protocol !== "https:" || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash || !key) throw new Error("A bare HTTPS Supabase URL and server-only service key are required.");
  const headers = { apikey: key, Authorization: `Bearer ${key}` };
  async function request(path, extra = {}) {
    const response = await fetchImpl(new URL(path, origin), { headers: { ...headers, ...extra }, redirect: "error", signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`Dataset request failed (HTTP ${response.status}); no export accepted.`);
    return response;
  }
  return {
    async list(version) {
      const query = new URLSearchParams({ select: "*", dataset_version: `eq.${version}`, eligible: "eq.true", order: "id.asc", limit: String(MAX_ROWS + 1) });
      const response = await request(`/rest/v1/dataset_export_queue?${query}`, { Prefer: "count=exact" });
      const total = response.headers.get("content-range")?.split("/")[1];
      if (total && total !== "*" && Number(total) > MAX_ROWS) throw new Error("Dataset exceeds the 200-membership export limit.");
      const rows = await response.json();
      if (!total || !/^\d+$/.test(total) || !Array.isArray(rows) || Number(total) !== rows.length) throw new Error("Complete dataset membership count could not be verified; export refused.");
      return rows;
    },
    async download(path) {
      const response = await request(`/storage/v1/object/authenticated/scan-images/${path.split("/").map(encodeURIComponent).join("/")}`);
      const advertised = Number(response.headers.get("content-length"));
      if (advertised > MAX_IMAGE_BYTES) { await response.body?.cancel(); throw new Error("Downloaded image exceeds 2 MiB."); }
      const reader = response.body?.getReader();
      if (!reader) throw new Error("Image body is missing.");
      const chunks = []; let length = 0;
      try {
        for (;;) { const { done, value } = await reader.read(); if (done) break; length += value.byteLength; if (length > MAX_IMAGE_BYTES) throw new Error("Downloaded image exceeds 2 MiB."); chunks.push(Buffer.from(value)); }
      } catch (error) { await reader.cancel(); throw error; }
      return { bytes: Buffer.concat(chunks), mime: response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() };
    },
  };
}

export async function exportReviewedDataset({ version, outputDir, client }) {
  if (typeof version !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(version)) throw new Error("Dataset version must be an explicit 1–80 character identifier.");
  if (!outputDir) throw new Error("A fresh output directory is required.");
  const target = resolve(outputDir); await requireAbsent(target);
  const rows = await client.list(version); validateRows(rows, version);
  await mkdir(dirname(target), { recursive: true });
  const staging = await mkdtemp(join(dirname(target), `.${basename(target)}-staging-${randomUUID()}-`));
  try {
    await mkdir(join(staging, "images"));
    const members = [];
    for (const row of rows) {
      const files = {};
      for (const prefix of ["original", "isolated"]) {
        const expected = validateImage(row, prefix); if (!expected) continue;
        const { bytes, mime } = await client.download(expected.path);
        if ((!Buffer.isBuffer(bytes) && !(bytes instanceof Uint8Array)) || bytes.byteLength !== expected.length || bytes.byteLength > MAX_IMAGE_BYTES || mime !== expected.mime || sha256(bytes) !== expected.hash) throw new Error("Image bytes, MIME type, length or SHA-256 no longer match reviewed provenance.");
        const file = `images/${row.id}-${prefix}.${TYPES[mime]}`;
        await writeFile(join(staging, file), bytes, { flag: "wx" }); files[prefix] = file;
      }
      members.push({ ...row, files });
    }
    const latest = await client.list(version); validateRows(latest, version);
    if (snapshot(rows) !== snapshot(latest)) throw new Error("Dataset eligibility or provenance changed during export. Nothing was accepted; retry from current consent.");
    const manifest = { format_version: 1, dataset_version: version, exported_at: new Date().toISOString(), limits: "Point-in-time export. Later withdrawal or deletion requires purging affected exports and re-exporting. This does not unlearn completed training.", members };
    await writeFile(join(staging, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", { flag: "wx" });
    await requireAbsent(target); await rename(staging, target);
    return { outputDir: target, members: members.length };
  } catch (error) {
    // Only this call's freshly created sibling staging directory can be removed.
    if (dirname(staging) !== dirname(target) || !basename(staging).startsWith(`.${basename(target)}-staging-`)) throw new Error("Unexpected staging location; cleanup refused.", { cause: error });
    await rm(staging, { recursive: true, force: true }); throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [version, outputDir, ...extra] = process.argv.slice(2);
  const usage = "Usage: node scripts/export-reviewed-dataset.mjs DATASET_VERSION NEW_OUTPUT_DIRECTORY\nRequires server-only SUPABASE_URL and SUPABASE_SECRET_KEY (legacy SUPABASE_SERVICE_ROLE_KEY is a rotation fallback). Maximum 200 eligible memberships, 2 MiB per image.\nPoint-in-time export: later consent withdrawal or deletion requires purge and re-export; completed training is not unlearned.";
  if (version === "--help" && !outputDir) {
    console.log(usage);
  } else {
  try {
    if (extra.length || !version || !outputDir) throw new Error(usage);
    const client = createExportClient({ url: process.env.SUPABASE_URL, key: readSupabaseAdminKey() });
    console.log(JSON.stringify(await exportReviewedDataset({ version, outputDir, client })));
  } catch (error) { console.error(error instanceof Error ? error.message : "Export failed."); process.exitCode = 1; }
  }
}
