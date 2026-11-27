import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ARMS = ["deepspec", "chatgpt"];
const STATUSES = new Set(["answered", "abstained", "error"]);
const CONFIDENCE = new Set(["high", "medium", "low", "unstated"]);

function requireText(value, field) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} must be nonempty text`);
  return value.trim();
}

function requireOptionalText(value, field) {
  if (value === null) return null;
  return requireText(value, field);
}

function requireTextList(value, field, allowEmpty = false) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) throw new Error(`${field} must be ${allowEmpty ? "an" : "a nonempty"} array`);
  return value.map((item, index) => requireText(item, `${field}[${index}]`));
}

function normalizeName(value) {
  return value.toLocaleLowerCase("en-US").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function normalizePartNumber(value) {
  return value.toLocaleUpperCase("en-US").replace(/\s+/g, "").trim();
}

function validateRun(run, field) {
  if (!run || typeof run !== "object" || Array.isArray(run)) throw new Error(`${field} is required`);
  if (!STATUSES.has(run.status)) throw new Error(`${field}.status must be answered, abstained, or error`);
  if (!CONFIDENCE.has(run.confidence)) throw new Error(`${field}.confidence is invalid`);
  const topChoice = requireOptionalText(run.topChoice, `${field}.topChoice`);
  if (run.status === "answered" && !topChoice) throw new Error(`${field}.topChoice is required for an answer`);
  if (run.status !== "answered" && topChoice) throw new Error(`${field}.topChoice must be null unless answered`);
  if (topChoice && !normalizeName(topChoice)) throw new Error(`${field}.topChoice needs letters or digits`);
  const exactPartNumber = requireOptionalText(run.exactPartNumber, `${field}.exactPartNumber`);
  if (run.status !== "answered" && exactPartNumber) throw new Error(`${field}.exactPartNumber needs an answer`);
  if (exactPartNumber && !/[\p{L}\p{N}]/u.test(exactPartNumber)) throw new Error(`${field}.exactPartNumber needs letters or digits`);
  const nextPhotoRequest = requireOptionalText(run.nextPhotoRequest, `${field}.nextPhotoRequest`);
  if (run.nextPhotoUseful !== null && typeof run.nextPhotoUseful !== "boolean") throw new Error(`${field}.nextPhotoUseful must be true, false, or null`);
  if (!nextPhotoRequest && run.nextPhotoUseful !== null) throw new Error(`${field}.nextPhotoUseful needs a nextPhotoRequest`);
  if (run.elapsedSeconds !== null && (typeof run.elapsedSeconds !== "number" || !Number.isFinite(run.elapsedSeconds) || run.elapsedSeconds <= 0)) throw new Error(`${field}.elapsedSeconds must be positive or null`);
  if (!Number.isInteger(run.retakes) || run.retakes < 0) throw new Error(`${field}.retakes must be a nonnegative integer`);
  return { ...run, topChoice, exactPartNumber, nextPhotoRequest };
}

function validateComparison(input) {
  if (!input || typeof input !== "object" || input.version !== 1) throw new Error("Comparison version must be 1");
  if (Number.isNaN(Date.parse(requireText(input.frozenAt, "frozenAt")))) throw new Error("frozenAt must be a date");
  for (const field of ["deepspecCommit", "deepspecModel", "chatgptModel"]) requireText(input[field], field);
  if (!Array.isArray(input.cases) || input.cases.length === 0) throw new Error("At least one reviewed case is required");
  const ids = new Set();
  const physicalPartIds = new Set();
  return input.cases.map((item, index) => {
    const field = `cases[${index}]`;
    if (!item || typeof item !== "object") throw new Error(`${field} must be an object`);
    const id = requireText(item.id, `${field}.id`);
    const physicalPartId = requireText(item.physicalPartId, `${field}.physicalPartId`);
    if (ids.has(id)) throw new Error(`${field}.id is repeated`);
    if (physicalPartIds.has(physicalPartId)) throw new Error(`${field}.physicalPartId is repeated`);
    ids.add(id);
    physicalPartIds.add(physicalPartId);
    if (typeof item.photoSha256 !== "string" || !/^[a-f0-9]{64}$/i.test(item.photoSha256)) throw new Error(`${field}.photoSha256 must be a SHA-256 hash`);
    requireText(item.selectedTarget, `${field}.selectedTarget`);
    const box = item.selectedBox;
    if (!box || typeof box !== "object" || ![box.x, box.y, box.width, box.height].every((value) => typeof value === "number" && Number.isFinite(value))
      || box.x < 0 || box.y < 0 || box.width <= 0 || box.height <= 0 || box.x + box.width > 1 || box.y + box.height > 1) throw new Error(`${field}.selectedBox must be a normalized rectangle inside the original photo`);
    requireText(item.reference, `${field}.reference`);
    requireText(item.vehicleContext, `${field}.vehicleContext`);
    requireText(item.question, `${field}.question`);
    const acceptedNames = requireTextList(item.acceptedNames, `${field}.acceptedNames`);
    if (acceptedNames.some((name) => !normalizeName(name))) throw new Error(`${field}.acceptedNames need letters or digits`);
    const verifiedPartNumbers = requireTextList(item.verifiedPartNumbers, `${field}.verifiedPartNumbers`, true);
    if (verifiedPartNumbers.some((number) => !/[\p{L}\p{N}]/u.test(number))) throw new Error(`${field}.verifiedPartNumbers need letters or digits`);
    const runs = Object.fromEntries(ARMS.map((arm) => [arm, validateRun(item.runs?.[arm], `${field}.runs.${arm}`)]));
    return { id, physicalPartId, acceptedNames, verifiedPartNumbers, runs };
  });
}

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const midpoint = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[midpoint] : (sorted[midpoint - 1] + sorted[midpoint]) / 2;
}

function summarizeArm(cases, arm) {
  const result = {
    attempted: cases.length, answered: 0, correct: 0, wrong: 0, abstained: 0, errors: 0,
    confidentWrong: 0, topChoiceAccuracy: 0, answeredPrecision: null,
    exactIdEligible: 0, exactIdClaimed: 0, exactIdCorrect: 0, unverifiedExactIdClaims: 0,
    exactIdPrecision: null, exactIdCoverage: null,
    nextPhotoRequested: 0, usefulNextPhoto: 0, unreviewedNextPhoto: 0,
    timed: 0, missingTiming: 0, medianElapsedSeconds: null, totalRetakes: 0,
  };
  const timings = [];
  for (const item of cases) {
    const run = item.runs[arm];
    result.totalRetakes += run.retakes;
    if (run.elapsedSeconds === null) result.missingTiming++;
    else timings.push(run.elapsedSeconds);
    if (run.nextPhotoRequest) {
      result.nextPhotoRequested++;
      if (run.nextPhotoUseful === true) result.usefulNextPhoto++;
      if (run.nextPhotoUseful === null) result.unreviewedNextPhoto++;
    }
    if (item.verifiedPartNumbers.length) result.exactIdEligible++;
    if (run.status === "abstained") { result.abstained++; continue; }
    if (run.status === "error") { result.errors++; continue; }
    result.answered++;
    const correct = item.acceptedNames.some((name) => normalizeName(name) === normalizeName(run.topChoice));
    if (correct) result.correct++;
    else {
      result.wrong++;
      if (run.confidence === "high") result.confidentWrong++;
    }
    if (run.exactPartNumber) {
      if (!item.verifiedPartNumbers.length) result.unverifiedExactIdClaims++;
      else {
        result.exactIdClaimed++;
        if (correct && item.verifiedPartNumbers.some((number) => normalizePartNumber(number) === normalizePartNumber(run.exactPartNumber))) result.exactIdCorrect++;
      }
    }
  }
  result.topChoiceAccuracy = result.correct / result.attempted;
  result.answeredPrecision = result.answered ? result.correct / result.answered : null;
  result.exactIdPrecision = result.exactIdClaimed ? result.exactIdCorrect / result.exactIdClaimed : null;
  result.exactIdCoverage = result.exactIdEligible ? result.exactIdCorrect / result.exactIdEligible : null;
  result.timed = timings.length;
  result.medianElapsedSeconds = median(timings);
  return result;
}

export function scoreComparison(input) {
  const cases = validateComparison(input);
  const deepspec = summarizeArm(cases, "deepspec");
  const chatgpt = summarizeArm(cases, "chatgpt");
  const paired = { bothCorrect: 0, deepspecOnlyCorrect: 0, chatgptOnlyCorrect: 0, neitherCorrect: 0 };
  for (const item of cases) {
    const correct = Object.fromEntries(ARMS.map((arm) => [arm, item.runs[arm].status === "answered"
      && item.acceptedNames.some((name) => normalizeName(name) === normalizeName(item.runs[arm].topChoice))]));
    if (correct.deepspec && correct.chatgpt) paired.bothCorrect++;
    else if (correct.deepspec) paired.deepspecOnlyCorrect++;
    else if (correct.chatgpt) paired.chatgptOnlyCorrect++;
    else paired.neitherCorrect++;
  }
  const completeTiming = cases.filter((item) => item.runs.deepspec.elapsedSeconds !== null && item.runs.chatgpt.elapsedSeconds !== null);
  const timing = {
    pairedTimedCases: completeTiming.length,
    missingPairs: cases.length - completeTiming.length,
    medianDeepSpecMinusChatGPTSeconds: completeTiming.length === cases.length
      ? median(completeTiming.map((item) => item.runs.deepspec.elapsedSeconds - item.runs.chatgpt.elapsedSeconds))
      : null,
  };
  if (timing.missingPairs) {
    deepspec.medianElapsedSeconds = null;
    chatgpt.medianElapsedSeconds = null;
  }
  return {
    version: 1,
    frozenAt: input.frozenAt,
    deepspecCommit: input.deepspecCommit,
    deepspecModel: input.deepspecModel,
    chatgptModel: input.chatgptModel,
    attemptedCases: cases.length,
    deepspec,
    chatgpt,
    paired,
    timing,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const path = process.argv[2];
    if (!path) throw new Error("Usage: node scripts/eval-selected-part-comparison.mjs <reviewed-cases.json>");
    const summary = scoreComparison(JSON.parse(await readFile(path, "utf8")));
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
