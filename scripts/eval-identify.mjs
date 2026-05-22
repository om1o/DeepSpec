import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const DATASET_ID = "DrBimmer/car-parts-and-damage-dataset";
const DATASET_URL = `https://huggingface.co/datasets/${DATASET_ID}`;
const DEFAULT_OUTPUT = ".deepspec-eval/identify-failures.jsonl";
const DEFAULT_SUMMARY = ".deepspec-eval/identify-summary.json";
const DEFAULT_EVAL_DELAY_MS = 20_000;
export const DATASET_FETCH_TIMEOUT_MS = 60_000;
const RATE_LIMIT_RETRY_DELAYS_MS = [60_000, 120_000];
const PROVIDER_AVAILABILITY_ERROR_CODES = new Set(["network", "provider_error", "rate_limited"]);

export const RELEASE_SAMPLE_IMAGES = [
  "Car damages dataset/File1/img/Car damages 2.jpg",
  "Car damages dataset/File1/img/Car damages 119.png",
  "Car damages dataset/File1/img/Car damages 162.png",
  "Car damages dataset/File1/img/Car damages 230.png",
  "Car damages dataset/File1/img/Car damages 273.png",
  "Car damages dataset/File1/img/Car damages 314.png",
  "Car damages dataset/File1/img/Car damages 648.jpg",
  "Car damages dataset/File1/img/Car damages 689.png",
  "Car damages dataset/File1/img/Car damages 731.png",
  "Car damages dataset/File1/img/Car damages 773.jpg",
  "Car damages dataset/File1/img/Car damages 875.png",
  "Car damages dataset/File1/img/Car damages 947.png",
  "Car damages dataset/File1/img/Car damages 1050.png",
  "Car damages dataset/File1/img/Car damages 1092.png",
  "Car damages dataset/File1/img/Car damages 1133.png",
  "Car damages dataset/File1/img/Car damages 1177.png",
  "Car damages dataset/File1/img/Car damages 1336.png",
  "Car damages dataset/File1/img/Car damages 1378.png",
  "Car damages dataset/File1/img/Car damages 1451.jpg",
  "Car damages dataset/File1/img/Car damages 1493.png",
  "Car damages dataset/File1/img/Car damages 1585.png",
  "Car damages dataset/File1/img/Car damages 1627.png",
  "Car damages dataset/File1/img/Car damages 1669.png",
  "Car damages dataset/File1/img/Car damages 1711.png",
  "Car damages dataset/File1/img/Car damages 1753.png",
  "Car parts dataset/File1/img/Car damages 101.png",
  "Car parts dataset/File1/img/Car damages 136.png",
  "Car parts dataset/File1/img/Car damages 180.png",
  "Car parts dataset/File1/img/Car damages 214.png",
  "Car parts dataset/File1/img/Car damages 249.png",
  "Car parts dataset/File1/img/Car damages 283.png",
  "Car parts dataset/File1/img/Car damages 318.jpg",
  "Car parts dataset/File1/img/Car damages 413.jpg",
  "Car parts dataset/File1/img/Car damages 447.png",
  "Car parts dataset/File1/img/Car damages 480.png",
  "Car parts dataset/File1/img/Car damages 605.png",
  "Car parts dataset/File1/img/Car damages 639.png",
  "Car parts dataset/File1/img/Car damages 703.png",
  "Car parts dataset/File1/img/Car damages 778.png",
  "Car parts dataset/File1/img/Car damages 812.png",
  "Car parts dataset/File1/img/Car damages 876.png",
  "Car parts dataset/File1/img/Car damages 911.png",
  "Car parts dataset/File1/img/Car damages 974.png",
  "Car parts dataset/File1/img/Car damages 1069.png",
  "Car parts dataset/File1/img/Car damages 1151.png",
  "Car parts dataset/File1/img/Car damages 1185.png",
  "Car parts dataset/File1/img/Car damages 1219.png",
  "Car parts dataset/File1/img/Car damages 1253.jpg",
  "Car parts dataset/File1/img/Car damages 1288.png",
  "Car parts dataset/File1/img/Car damages 1352.jpg",
];

export function scoreIdentificationResult(result, expectedLabels) {
  if (!result) {
    return {
      ok: false,
      matchedLabels: [],
      failureReasons: ["pipeline_error"],
    };
  }

  const resultText = normalizeText(
    [
      result.partName,
      result.scanCategory,
      result.whatItDoes,
      ...(Array.isArray(result.candidateMatches) ? result.candidateMatches.map(formatCandidateForScoring) : []),
      ...(Array.isArray(result.visibleObservations) ? result.visibleObservations : []),
      ...(Array.isArray(result.evidenceRegions) ? result.evidenceRegions.map(formatEvidenceRegionForScoring) : []),
      ...(Array.isArray(result.concerns) ? result.concerns : []),
      ...(Array.isArray(result.evidence) ? result.evidence : []),
    ].join(" "),
  );
  const matchedLabels = expectedLabels.filter((label) => labelAliases(label).some((alias) => resultText.includes(alias)));
  const failureReasons = [];

  if (matchedLabels.length === 0) {
    failureReasons.push("wrong_result");
  }

  if (isTooVague(result)) {
    failureReasons.push("too_vague");
  }

  return {
    ok: failureReasons.length === 0,
    matchedLabels,
    failureReasons,
  };
}

export function buildReviewLookup({
  analyzedAt,
  dataUrl,
  error,
  expectedLabels,
  imagePath,
  result,
  score,
}) {
  const expectedPrimary = expectedLabels[0] ?? "unlabeled";
  const id = `eval-${stableId(imagePath)}`;
  const notes = [
    `Eval failure: ${score.failureReasons.join(", ") || "unknown"}.`,
    `Expected: ${expectedLabels.join(", ") || "unlabeled"}.`,
    `Matched: ${score.matchedLabels.join(", ") || "none"}.`,
    `Source: ${DATASET_ID}/${imagePath}.`,
  ].join(" ");

  return {
    id,
    createdAt: analyzedAt,
    frame: {
      imageBase64: dataUrl,
      capturedAt: analyzedAt,
    },
    ...(result ? { result } : {}),
    ...(error ? { errorCode: error.code, errorMessage: error.message } : {}),
    analyzedAt,
    rating: "down",
    correction: expectedPrimary,
    notes,
    scanCategory: result?.scanCategory ?? categorizeExpectedLabels(expectedLabels),
    trainingLabel: expectedPrimary,
    trainingStatus: "user_corrected",
    chatHistory: [],
    eval: {
      datasetId: DATASET_ID,
      datasetUrl: DATASET_URL,
      sourceImagePath: imagePath,
      sourceAnnotationPath: annotationPathForImage(imagePath),
      expectedLabels,
      matchedLabels: score.matchedLabels,
      failureReasons: score.failureReasons,
    },
  };
}

export function isReviewableEvalFailure(error) {
  return !error || !PROVIDER_AVAILABILITY_ERROR_CODES.has(error.code);
}

export function getEvalExitCode(summary) {
  if (
    summary.providerStatus === "blocked" ||
    summary.providerFailureCount > 0 ||
    summary.failureCount > 0 ||
    summary.passCount !== summary.attemptedCount ||
    summary.attemptedCount !== summary.sampleSize
  ) {
    return 1;
  }

  return 0;
}

export function buildEvalResultRow({
  elapsedMs,
  error,
  expectedLabels,
  imagePath,
  providerAvailabilityFailure,
  responseStatus,
  result,
  score,
}) {
  return {
    imagePath,
    expectedLabels,
    status: responseStatus,
    errorCode: error?.code ?? null,
    errorMessage: error?.message ?? null,
    partName: result?.partName ?? null,
    confidence: result?.confidence ?? null,
    scanCategory: result?.scanCategory ?? null,
    matchedLabels: score.matchedLabels,
    failureReasons: providerAvailabilityFailure && error ? [error.code] : score.failureReasons,
    elapsedMs,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const env = await loadEnv();

  if (!env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is missing. Add it to .env or the process environment before running the eval.");
  }

  const selectedSamples = RELEASE_SAMPLE_IMAGES.slice(0, options.sampleSize);
  const identify = await loadIdentifyPipeline();
  const failures = [];
  const results = [];
  let providerFailureCount = 0;
  let stoppedEarlyReason = null;

  try {
    for (let index = 0; index < selectedSamples.length; index += 1) {
      const imagePath = selectedSamples[index];
      const startedAt = Date.now();
      console.log(`[${index + 1}/${selectedSamples.length}] Fetching annotation for ${imagePath}`);
      const annotation = await fetchJson(resolveUrl(annotationPathForImage(imagePath)));
      const expectedLabels = getExpectedLabels(annotation);
      console.log(`[${index + 1}/${selectedSamples.length}] Fetching image (${expectedLabels.join(", ") || "unlabeled"})`);
      const image = await fetchBytes(resolveUrl(imagePath));
      const dataUrl = toDataUrl(image.bytes, image.contentType);
      const analyzedAt = new Date().toISOString();
      console.log(`[${index + 1}/${selectedSamples.length}] Identifying image with provider`);
      const response = await createIdentifyResponseWithRetry(identify, dataUrl, env);
      const result = response.status === 200 ? response.body.result : null;
      const error = response.status === 200 ? null : response.body.error;
      const score = scoreIdentificationResult(result, expectedLabels);
      const elapsedMs = Date.now() - startedAt;
      const providerAvailabilityFailure = error && !isReviewableEvalFailure(error);

      if (providerAvailabilityFailure) {
        providerFailureCount += 1;
      }

      results.push(buildEvalResultRow({
        elapsedMs,
        error,
        imagePath,
        expectedLabels,
        providerAvailabilityFailure,
        responseStatus: response.status,
        result,
        score,
      }));

      if ((!score.ok || error) && isReviewableEvalFailure(error)) {
        failures.push(
          buildReviewLookup({
            analyzedAt,
            dataUrl,
            error,
            expectedLabels,
            imagePath,
            result,
            score: error ? { ...score, failureReasons: [...new Set([...score.failureReasons, "pipeline_error"])] } : score,
          }),
        );
      }

      console.log(
        `${score.ok && !error ? "PASS" : "FAIL"} ${imagePath} -> ${result?.partName ?? error?.code ?? "no result"} (${elapsedMs}ms)`,
      );

      if (providerFailureCount >= options.maxProviderFailures) {
        stoppedEarlyReason = "provider_availability";
        console.log(
          `Stopping eval after ${providerFailureCount} provider availability failure(s). Fix quota/provider health before using eval as a release gate.`,
        );
        break;
      }

      if (options.delayMs > 0 && index < selectedSamples.length - 1) {
        console.log(`waiting ${Math.round(options.delayMs / 1000)}s before next provider call`);
        await sleep(options.delayMs);
      }
    }
  } finally {
    await identify.close();
  }

  const summary = {
    datasetId: DATASET_ID,
    datasetUrl: DATASET_URL,
    generatedAt: new Date().toISOString(),
    sampleSize: selectedSamples.length,
    attemptedCount: results.length,
    skippedCount: Math.max(0, selectedSamples.length - results.length),
    failureCount: failures.length,
    providerFailureCount,
    passCount: results.filter((result) => result.status === 200 && result.failureReasons.length === 0).length,
    providerStatus: providerFailureCount > 0 ? "blocked" : "available",
    stoppedEarlyReason,
    throttleDelayMs: options.delayMs,
    output: options.output,
    results,
  };

  await writeJsonl(options.output, failures);
  await writeSummary(options.summary, summary);

  console.log(`Saved ${failures.length} failure review row(s) to ${options.output}`);
  console.log(`Saved summary to ${options.summary}`);

  const exitCode = getEvalExitCode(summary);
  if (exitCode !== 0) {
    console.error("Identify eval did not meet the release gate. Inspect the summary before shipping.");
    process.exitCode = exitCode;
  }
}

async function createIdentifyResponseWithRetry(identify, dataUrl, env) {
  const payload = {
    imageBase64: dataUrl,
    userMessage: "Identify this car part or visible damage from the captured photo.",
  };

  for (let attempt = 0; attempt <= RATE_LIMIT_RETRY_DELAYS_MS.length; attempt += 1) {
    const response = await identify.createIdentifyResponse(payload, env);
    const code = response.status === 200 ? null : response.body.error.code;

    if (!isRetryableProviderAvailabilityResponse(response, code) || attempt === RATE_LIMIT_RETRY_DELAYS_MS.length) {
      return response;
    }

    const delayMs = RATE_LIMIT_RETRY_DELAYS_MS[attempt];
    console.log(`${code ?? response.status}; retrying in ${Math.round(delayMs / 1000)}s`);
    await sleep(delayMs);
  }

  throw new Error("Unreachable identify retry state.");
}

function isRetryableProviderAvailabilityResponse(response, code) {
  return code === "rate_limited" || response.status === 503 || code === "network";
}

function parseArgs(args) {
  const options = {
    delayMs: parseDelayMs(process.env.DEEPSPEC_EVAL_DELAY_MS, DEFAULT_EVAL_DELAY_MS),
    maxProviderFailures: parseMaxProviderFailures(process.env.DEEPSPEC_EVAL_MAX_PROVIDER_FAILURES, 1),
    output: DEFAULT_OUTPUT,
    sampleSize: 6,
    summary: DEFAULT_SUMMARY,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const [name, inlineValue] = arg.split("=");
    const value = inlineValue ?? args[index + 1];

    if (name === "--sample-size") {
      options.sampleSize = clampSampleSize(Number(value));
      if (!inlineValue) index += 1;
    } else if (name === "--delay-ms") {
      options.delayMs = parseDelayMs(value, options.delayMs);
      if (!inlineValue) index += 1;
    } else if (name === "--max-provider-failures") {
      options.maxProviderFailures = parseMaxProviderFailures(value, options.maxProviderFailures);
      if (!inlineValue) index += 1;
    } else if (name === "--output") {
      options.output = value;
      if (!inlineValue) index += 1;
    } else if (name === "--summary") {
      options.summary = value;
      if (!inlineValue) index += 1;
    } else if (name === "--help") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

function parseDelayMs(value, fallback) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  const delayMs = Number(value);
  if (!Number.isInteger(delayMs) || delayMs < 0 || delayMs > 300_000) {
    throw new Error("--delay-ms must be an integer from 0 to 300000.");
  }

  return delayMs;
}

function parseMaxProviderFailures(value, fallback) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  const failures = Number(value);
  if (!Number.isInteger(failures) || failures < 1 || failures > RELEASE_SAMPLE_IMAGES.length) {
    throw new Error(`--max-provider-failures must be an integer from 1 to ${RELEASE_SAMPLE_IMAGES.length}.`);
  }

  return failures;
}

function clampSampleSize(value) {
  if (!Number.isInteger(value) || value < 1 || value > RELEASE_SAMPLE_IMAGES.length) {
    throw new Error(`--sample-size must be an integer from 1 to ${RELEASE_SAMPLE_IMAGES.length}.`);
  }

  return value;
}

function printHelp() {
  console.log(`Run a local Deep Spec identify eval against ${DATASET_ID}.

Options:
  --sample-size <n>  Number of curated HF samples to run, 1-${RELEASE_SAMPLE_IMAGES.length}. Default: 6
  --delay-ms <n>     Delay between provider calls. Default: ${DEFAULT_EVAL_DELAY_MS}
  --max-provider-failures <n>
                     Stop after this many provider availability failures. Default: 1
  --output <path>    JSONL failure review rows. Default: ${DEFAULT_OUTPUT}
  --summary <path>   JSON summary. Default: ${DEFAULT_SUMMARY}

The command exits nonzero when provider availability is blocked, any sample fails
scoring, or the requested sample set is not fully attempted and passed.
`);
}

async function loadEnv() {
  const env = { ...process.env };

  for (const file of [".env", ".env.local"]) {
    const values = await readDotEnv(file);
    Object.assign(env, values);
  }

  return env;
}

async function readDotEnv(path) {
  const values = {};
  let text;

  try {
    text = await readFile(path, "utf8");
  } catch {
    return values;
  }

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(trimmed);
    if (!match) continue;
    values[match[1]] = unquoteEnvValue(match[2].trim());
  }

  return values;
}

function unquoteEnvValue(value) {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }

  return value;
}

async function loadIdentifyPipeline() {
  const { createServer } = await import("vite");
  const server = await createServer(buildEvalViteServerOptions());
  const module = await server.ssrLoadModule("/api/identify.shared.ts");

  return {
    createIdentifyResponse: module.createIdentifyResponse,
    close: () => server.close(),
  };
}

export function buildEvalViteServerOptions() {
  return {
    appType: "custom",
    configFile: false,
    logLevel: "error",
    server: {
      hmr: false,
      middlewareMode: true,
      ws: false,
    },
  };
}

function annotationPathForImage(imagePath) {
  return imagePath.replace("/img/", "/ann/").concat(".json");
}

function resolveUrl(path) {
  return `${DATASET_URL}/resolve/main/${path.split("/").map(encodeURIComponent).join("/")}`;
}

async function fetchJson(url) {
  const response = await fetchWithTimeout(url);
  if (!response.ok) {
    throw new Error(`Could not fetch ${url}: ${response.status}`);
  }

  try {
    return await response.json();
  } catch (error) {
    throw datasetReadError(url, error);
  }
}

async function fetchBytes(url) {
  const response = await fetchWithTimeout(url);
  if (!response.ok) {
    throw new Error(`Could not fetch ${url}: ${response.status}`);
  }

  try {
    const contentType = response.headers.get("content-type")?.split(";")[0] || "image/jpeg";
    return {
      bytes: Buffer.from(await response.arrayBuffer()),
      contentType,
    };
  } catch (error) {
    throw datasetReadError(url, error);
  }
}

async function fetchWithTimeout(url) {
  try {
    return await fetch(url, { signal: AbortSignal.timeout(DATASET_FETCH_TIMEOUT_MS) });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not fetch ${url} within ${Math.round(DATASET_FETCH_TIMEOUT_MS / 1000)}s: ${reason}`, { cause: error });
  }
}

function datasetReadError(url, error) {
  const reason = error instanceof Error ? error.message : String(error);
  return new Error(`Could not read ${url} within ${Math.round(DATASET_FETCH_TIMEOUT_MS / 1000)}s: ${reason}`, { cause: error });
}

function toDataUrl(bytes, contentType) {
  return `data:${contentType};base64,${bytes.toString("base64")}`;
}

function getExpectedLabels(annotation) {
  if (!Array.isArray(annotation?.objects)) {
    return [];
  }

  const labelArea = new Map();
  for (const object of annotation.objects) {
    if (typeof object?.classTitle !== "string") continue;
    const label = object.classTitle.trim();
    if (!label) continue;
    const area = polygonArea(object.points?.exterior);
    labelArea.set(label, (labelArea.get(label) ?? 0) + area);
  }

  return [...labelArea.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([label]) => label);
}

function polygonArea(points) {
  if (!Array.isArray(points) || points.length < 3) {
    return 0;
  }

  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    if (!Array.isArray(current) || !Array.isArray(next)) continue;
    area += Number(current[0] ?? 0) * Number(next[1] ?? 0) - Number(next[0] ?? 0) * Number(current[1] ?? 0);
  }

  return Math.abs(area / 2);
}

function labelAliases(label) {
  const normalized = normalizeText(label.replace(/-/g, " "));
  const aliases = new Set([normalized]);
  const withoutDirection = normalized.replace(/^(front|back|rear)\s+/, "");
  aliases.add(withoutDirection);

  if (normalized.startsWith("back ")) {
    aliases.add(normalized.replace(/^back /, "rear "));
  }

  if (normalized.includes("tail light")) {
    aliases.add("taillight");
  }

  if (normalized.includes("windshield")) {
    aliases.add("windscreen");
  }

  if (normalized === "broken part") {
    aliases.add("broken");
    aliases.add("cracked");
    aliases.add("crack");
    aliases.add("fractured");
    aliases.add("shattered");
    aliases.add("split");
    aliases.add("torn");
    aliases.add("jagged");
    aliases.add("missing");
    aliases.add("destroyed");
    aliases.add("crushing");
    aliases.add("crushed");
    aliases.add("deformation");
    aliases.add("deformed");
    aliases.add("misalignment");
    aliases.add("misaligned");
    aliases.add("impact damage");
    aliases.add("structural damage");
  }

  if (normalized === "scratch") {
    aliases.add("scratched");
    aliases.add("scuff");
    aliases.add("scuffs");
    aliases.add("scuffed");
    aliases.add("scuffing");
    aliases.add("abrasion");
    aliases.add("abrasions");
    aliases.add("scrape");
    aliases.add("scraped");
    aliases.add("paint transfer");
  }

  if (normalized === "dent") {
    aliases.add("dented");
    aliases.add("denting");
    aliases.add("deformation");
    aliases.add("deformed");
    aliases.add("buckling");
    aliases.add("buckled");
    aliases.add("crushing");
    aliases.add("crushed");
  }

  if (normalized === "paint chip") {
    aliases.add("paint chips");
    aliases.add("chipped paint");
    aliases.add("paint chipping");
    aliases.add("paint damage");
    aliases.add("paint loss");
    aliases.add("paint scuff");
    aliases.add("paint scuffs");
  }

  if (normalized === "missing part") {
    aliases.add("missing");
    aliases.add("absent");
    aliases.add("removed");
    aliases.add("missing assembly");
    aliases.add("missing headlight");
    aliases.add("exposed wiring");
    aliases.add("exposed internal");
  }

  if (normalized === "corrosion") {
    aliases.add("rust");
    aliases.add("rusted");
    aliases.add("rusty");
    aliases.add("oxidation");
  }

  if (normalized === "flaking") {
    aliases.add("flaking paint");
    aliases.add("paint flaking");
    aliases.add("peeling");
    aliases.add("peeling paint");
    aliases.add("delamination");
  }

  return [...aliases].filter((alias) => alias.length >= 4);
}

function isTooVague(result) {
  const partName = normalizeText(result.partName);
  const genericName = /^(unknown|unknown component|unidentified|unidentified car part|car part|vehicle component|vehicle part|damaged area|car body|vehicle body|body panel)$/.test(
    partName,
  );

  return genericName || result.confidence === "low" || result.needsBetterPhoto || result.safetyTriage === "needs_better_photo";
}

function formatCandidateForScoring(candidate) {
  if (!candidate || typeof candidate !== "object") {
    return "";
  }

  return [candidate.partName, candidate.scanCategory, candidate.reason].filter(Boolean).join(" ");
}

function formatEvidenceRegionForScoring(region) {
  if (!region || typeof region !== "object") {
    return "";
  }

  return [region.label, region.observation, region.regionLabel].filter(Boolean).join(" ");
}

function categorizeExpectedLabels(labels) {
  const text = normalizeText(labels.join(" "));

  if (/brake|caliper|rotor|pad/.test(text)) return "brakes";
  if (/steering|tie rod|rack and pinion/.test(text)) return "steering";
  if (/fuel|gas|injector|fuel line|tank/.test(text)) return "fuel";
  if (/leak|oil|coolant|fluid/.test(text)) return "leak";
  if (/headlight|tail light|taillight|mirror|window|windshield|bumper|fender|door|hood|trunk|roof|panel|dent|scratch|broken/.test(text)) {
    return "body";
  }
  if (/suspension|control arm|strut|shock|ball joint|wheel/.test(text)) return "suspension";

  return "unknown";
}

function normalizeText(value) {
  return String(value)
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stableId(value) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }

  return hash.toString(16).padStart(8, "0");
}

function sleep(delayMs) {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

async function writeJsonl(path, rows) {
  await mkdir(dirname(path), { recursive: true });
  const body = rows.map((row) => JSON.stringify(row)).join("\n");
  await writeFile(path, body ? `${body}\n` : "", "utf8");
}

async function writeSummary(path, summary) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
}

function isDirectRun(url) {
  return process.argv[1] && fileURLToPath(url) === process.argv[1];
}

if (isDirectRun(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
