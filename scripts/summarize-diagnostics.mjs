import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const prefix = "[DeepSpec diagnostics] ";
const codes = new Set(["ok", "not_configured", "rate_limited", "provider_error", "network",
  "invalid_response", "invalid_input", "image_too_large", "other_error", "unexpected_error"]);
const fields = ["schema", "eventId", "occurredAt", "release", "stage", "code", "status", "durationMs"];

// Reads a private operator log export, never contacts a server or echoes raw lines.
export function summarizeDiagnostics(text) {
  if (Buffer.byteLength(text, "utf8") > 10 * 1024 * 1024) throw new Error("Log export exceeds 10 MiB. Select a smaller time window.");
  const events = new Map();
  let duplicates = 0;
  let rejected = 0;
  for (const line of text.split(/\r?\n/)) {
    const start = line.indexOf(prefix);
    if (start === -1) continue;
    let event;
    try { event = JSON.parse(line.slice(start + prefix.length)); } catch { rejected++; continue; }
    if (!validEvent(event)) { rejected++; continue; }
    // Rebuild from the allowlist even after validation. No raw log is returned.
    const safe = Object.fromEntries(fields.map((key) => [key, event[key]]));
    const previous = events.get(safe.eventId);
    if (previous) {
      if (JSON.stringify(previous) !== JSON.stringify(safe)) throw new Error("Conflicting duplicate diagnostic IDs. Review the log export before counting requests.");
      duplicates++;
    } else {
      events.set(safe.eventId, safe);
    }
  }
  const rows = [...events.values()];
  const failures = rows.filter((row) => row.code !== "ok");
  const byCode = {};
  const byRelease = {};
  for (const row of rows) {
    byCode[row.code] = (byCode[row.code] ?? 0) + 1;
    byRelease[row.release] = (byRelease[row.release] ?? 0) + 1;
  }
  const durations = rows.map((row) => row.durationMs).sort((a, b) => a - b);
  return {
    scope: "Identification-service outcomes in this export only; excludes HTTP auth/rate/credit gates, later billing, client saves and missing logs. Not users or provider calls.",
    requests: rows.length, successes: rows.length - failures.length, failures: failures.length,
    duplicates, rejected, byCode, byRelease,
    medianDurationMs: durations.length ? (durations[Math.floor((durations.length - 1) / 2)] + durations[Math.floor(durations.length / 2)]) / 2 : null,
    recentFailures: failures.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)).slice(0, 20),
  };
}

function validEvent(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === fields.length && fields.every((key) => Object.hasOwn(value, key))
    && value.schema === 1 && value.stage === "identify" && codes.has(value.code)
    && typeof value.eventId === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value.eventId)
    && typeof value.occurredAt === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.occurredAt)
    && Number.isFinite(Date.parse(value.occurredAt))
    && typeof value.release === "string" && (value.release === "unknown" || /^[a-f0-9]{40}$/.test(value.release))
    && Number.isInteger(value.status) && value.status >= 100 && value.status <= 599
    && (value.code === "ok" ? value.status === 200 : value.status !== 200)
    && Number.isInteger(value.durationMs) && value.durationMs >= 0 && value.durationMs <= 3_600_000;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (!process.argv[2] || process.argv.length !== 3) throw new Error("Usage: node scripts/summarize-diagnostics.mjs <private-log-export.txt>");
    if (statSync(process.argv[2]).size > 10 * 1024 * 1024) throw new Error("Log export exceeds 10 MiB. Select a smaller time window.");
    console.log(JSON.stringify(summarizeDiagnostics(readFileSync(process.argv[2], "utf8")), null, 2));
  } catch (error) {
    // File-system errors can contain private paths; print only our known errors.
    console.error(error?.code ? "Could not read the private log export." : error.message);
    process.exitCode = 1;
  }
}
