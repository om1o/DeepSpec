import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const workflows = ["manual", "deepspec"];
const identities = ["correct", "wrong", "unresolved", "unverified"];
const timingFields = ["activeSeconds", "functionalTestSeconds", "elapsedSeconds"];

export function summarizeIntakePilot(input) {
  if (!input || typeof input.studyId !== "string" || !input.studyId.trim() || !Array.isArray(input.records)) throw new Error("Provide a studyId and records array.");
  const ids = new Set();
  const parts = new Set();
  for (const row of input.records) {
    if (!row || ["id", "physicalPartId", "batch"].some((key) => typeof row[key] !== "string" || !row[key].trim())) throw new Error("Each record needs id, physicalPartId and batch.");
    if (ids.has(row.id.trim())) throw new Error("Duplicate record id.");
    if (parts.has(row.physicalPartId.trim())) throw new Error("Repeated physical part: keep all capture attempts in one observation; use distinct parts across this pilot's arms and batches.");
    ids.add(row.id.trim());
    parts.add(row.physicalPartId.trim());
    if (!workflows.includes(row.workflow) || !["completed", "abandoned"].includes(row.outcome) || !identities.includes(row.identity) || typeof row.accepted !== "boolean") throw new Error("Invalid workflow, outcome, identity or accepted value.");
    const missingTiming = timingFields.every((key) => row[key] === null);
    if (missingTiming && (typeof row.timingMissingReason !== "string" || !row.timingMissingReason.trim())) throw new Error("Missing timing requires a recorded reason.");
    for (const key of [...(missingTiming ? [] : timingFields), "captureAttempts"]) {
      if (typeof row[key] !== "number" || !Number.isFinite(row[key]) || row[key] < 0) throw new Error(`${key} must be a finite nonnegative number; missing values are not zero.`);
    }
    if (!Number.isInteger(row.captureAttempts)) throw new Error("captureAttempts must be an integer.");
    if (!missingTiming && (row.functionalTestSeconds > row.activeSeconds || row.activeSeconds > row.elapsedSeconds)) throw new Error("Functional test time must be included in active time, and active time cannot exceed elapsed time.");
    if (["correct", "wrong"].includes(row.identity) && (typeof row.reference !== "string" || !row.reference.trim())) throw new Error("Correct/wrong judgments require a recorded human reference check.");
  }
  const batches = [...new Set(input.records.map((row) => row.batch.trim()))].map((batch) => {
    const records = input.records.filter((row) => row.batch.trim() === batch);
    const manual = summarizeArm(records.filter((row) => row.workflow === "manual"));
    const deepspec = summarizeArm(records.filter((row) => row.workflow === "deepspec"));
    return {
      batch, manual, deepspec,
      medianActiveReductionPercent: !manual.missingTiming && !deepspec.missingTiming && manual.medianActiveSeconds > 0 && deepspec.attempted > 0
        ? 100 * (manual.medianActiveSeconds - deepspec.medianActiveSeconds) / manual.medianActiveSeconds : null,
    };
  });
  return {
    studyId: input.studyId,
    status: input.records.length ? "descriptive_only" : "no_observations",
    observations: input.records.length,
    batches,
    limitations: "All attempts remain in outcome counts. Time summaries include only fully timed attempts, including abandoned cases; totals cover that subset only. Missing timing suppresses the batch time-reduction comparison. Compare completion, wrong-accepted and unverified counts alongside time; early abandonment can look faster. Batches are not pooled. This does not establish broad accuracy, causality, willingness to pay or launch readiness.",
  };
}

function summarizeArm(records) {
  const count = (predicate) => records.filter(predicate).length;
  const timed = records.filter((row) => row.activeSeconds !== null);
  return {
    attempted: records.length,
    timedObservations: timed.length,
    missingTiming: records.length - timed.length,
    completed: count((row) => row.outcome === "completed"),
    abandoned: count((row) => row.outcome === "abandoned"),
    ...Object.fromEntries(identities.map((identity) => [identity, count((row) => row.identity === identity)])),
    accepted: count((row) => row.accepted),
    wrongAccepted: count((row) => row.accepted && row.identity === "wrong"),
    acceptedUnverified: count((row) => row.accepted && ["unverified", "unresolved"].includes(row.identity)),
    retakes: records.reduce((sum, row) => sum + Math.max(0, row.captureAttempts - 1), 0),
    totalActiveSeconds: timed.length ? timed.reduce((sum, row) => sum + row.activeSeconds, 0) : null,
    totalFunctionalTestSeconds: timed.length ? timed.reduce((sum, row) => sum + row.functionalTestSeconds, 0) : null,
    medianActiveSeconds: median(timed.map((row) => row.activeSeconds)),
    medianElapsedSeconds: median(timed.map((row) => row.elapsedSeconds)),
  };
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (!process.argv[2]) throw new Error("Usage: node scripts/pilot/summarize-intake-pilot.mjs path/to/observations.json");
    process.stdout.write(`${JSON.stringify(summarizeIntakePilot(JSON.parse(readFileSync(process.argv[2], "utf8").replace(/^\uFEFF/, ""))), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "Could not summarize pilot data."}\n`);
    process.exitCode = 1;
  }
}
