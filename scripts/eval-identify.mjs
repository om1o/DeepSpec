import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const DATASET_ID = "DrBimmer/car-parts-and-damage-dataset";
const DATASET_URL = `https://huggingface.co/datasets/${DATASET_ID}`;
const DEFAULT_OUTPUT = ".deepspec-eval/identify-failures.jsonl";
const DEFAULT_SUMMARY = ".deepspec-eval/identify-summary.json";
const DEFAULT_DATASET_ROOT = "datasets/raw/drbimmer-car-parts-and-damage-dataset";
const DEFAULT_DATASET_INDEX = "datasets/derived/drbimmer-car-parts-and-damage-dataset/records.jsonl";
const DEFAULT_EVAL_DELAY_MS = 20_000;
export const DATASET_FETCH_TIMEOUT_MS = 60_000;
export const PUBLIC_SAMPLE_SIZE = 300;
const RATE_LIMIT_RETRY_DELAYS_MS = [60_000, 120_000];
const PROVIDER_AVAILABILITY_ERROR_CODES = new Set(["network", "provider_error", "rate_limited"]);
const SAFETY_CRITICAL_EXPECTED_PATTERN = /\b(airbag|ball joint|brake|caliper|coolant|control arm|fluid|fuel|gas|injector|leak|oil|rack|rotor|shock|steering|strut|suspension|tie rod|tire|tyre|wheel)\b/;

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

  if (isSafetyFalsePositive(result, expectedLabels)) {
    failureReasons.push("safety_false_positive");
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
    summary.providerFailureCount > 0
  ) {
    return 2;
  }

  if (
    summary.failureCount > 0 ||
    summary.passCount !== summary.attemptedCount ||
    summary.attemptedCount !== summary.sampleSize
  ) {
    return 1;
  }

  return 0;
}

export function isSafetyFalsePositive(result, expectedLabels) {
  if (!result || isSafetyCriticalExpected(expectedLabels)) {
    return false;
  }

  return result.isSafetyCritical === true || result.safetyTriage === "needs_professional";
}

export function summarizeEvalMetrics(results, requestedSampleCount = results.length) {
  const attemptedCount = results.length;
  const providerLatencies = results.map((result) => result.providerMs).filter(isFiniteNumber);
  const totalLatencies = results.map((result) => result.totalMs ?? result.elapsedMs).filter(isFiniteNumber);
  const providerFailureCount = results.filter((result) => result.failureReasons.includes("network") || result.failureReasons.includes("provider_error") || result.failureReasons.includes("rate_limited")).length;
  const invalidResponseCount = results.filter((result) => result.invalidResponse || result.failureReasons.includes("invalid_response")).length;
  const safetyFalsePositiveCount = results.filter((result) => result.safetyFalsePositive).length;
  const passCount = results.filter((result) => result.status === 200 && result.failureReasons.length === 0).length;

  return {
    requestedSampleCount,
    attemptedCount,
    attemptedRate: rate(attemptedCount, requestedSampleCount),
    passRate: rate(passCount, attemptedCount),
    providerAvailabilityFailureRate: rate(providerFailureCount, attemptedCount),
    invalidResponseCount,
    invalidResponseRate: rate(invalidResponseCount, attemptedCount),
    safetyFalsePositiveCount,
    safetyFalsePositiveRate: rate(safetyFalsePositiveCount, attemptedCount),
    wrongResultCount: results.filter((result) => result.failureReasons.includes("wrong_result")).length,
    tooVagueCount: results.filter((result) => result.failureReasons.includes("too_vague")).length,
    latencyMs: {
      provider: summarizeLatency(providerLatencies),
      total: summarizeLatency(totalLatencies),
    },
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const env = await loadEnv();
  if (options.providerTimeoutMs !== null) {
    env.DEEPSPEC_IDENTIFY_PROVIDER_TIMEOUT_MS = String(options.providerTimeoutMs);
  }

  if (!env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is missing. Add it to .env or the process environment before running the eval.");
  }

  const selectedSamples = await resolveEvalSampleImages(options);
  const identify = await loadIdentifyPipeline();
  const failures = [];
  const results = [];
  let providerFailureCount = 0;
  let stoppedEarlyReason = null;

  try {
    for (let index = 0; index < selectedSamples.length; index += 1) {
      const imagePath = selectedSamples[index];
      const startedAt = Date.now();
      console.log(`[${index + 1}/${selectedSamples.length}] Loading sample for ${imagePath}`);
      const datasetStartedAt = Date.now();
      const sample = await loadEvalSample(imagePath, options.datasetRoot);
      const datasetFetchMs = Date.now() - datasetStartedAt;
      const annotation = sample.annotation;
      const expectedLabels = getExpectedLabels(annotation);
      const dataUrl = toDataUrl(sample.image.bytes, sample.image.contentType);
      const analyzedAt = new Date().toISOString();
      console.log(
        `[${index + 1}/${selectedSamples.length}] Identifying image with provider (${expectedLabels.join(", ") || "unlabeled"}, ${sample.datasetSource})`,
      );
      const providerStartedAt = Date.now();
      const response = await createIdentifyResponseWithRetry(identify, dataUrl, env, options.rateLimitRetries);
      const providerMs = Date.now() - providerStartedAt;
      const result = response.status === 200 ? response.body.result : null;
      const error = response.status === 200 ? null : response.body.error;
      const score = scoreIdentificationResult(result, expectedLabels);
      const totalMs = Date.now() - startedAt;
      const providerAvailabilityFailure = error && !isReviewableEvalFailure(error);
      const safetyFalsePositive = isSafetyFalsePositive(result, expectedLabels);

      if (providerAvailabilityFailure) {
        providerFailureCount += 1;
      }

      results.push({
        imagePath,
        expectedLabels,
        status: response.status,
        partName: result?.partName ?? null,
        confidence: result?.confidence ?? null,
        scanCategory: result?.scanCategory ?? null,
        safetyTriage: result?.safetyTriage ?? null,
        isSafetyCritical: result?.isSafetyCritical ?? null,
        matchedLabels: score.matchedLabels,
        failureReasons: providerAvailabilityFailure ? [error.code] : score.failureReasons,
        invalidResponse: error?.code === "invalid_response",
        safetyFalsePositive,
        datasetSource: sample.datasetSource,
        annotationSource: sample.annotationSource,
        imageSource: sample.imageSource,
        datasetFetchMs,
        providerMs,
        totalMs,
        elapsedMs: totalMs,
      });

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
        `${score.ok && !error ? "PASS" : "FAIL"} ${imagePath} -> ${result?.partName ?? error?.code ?? "no result"} (${providerMs}ms provider, ${totalMs}ms total)`,
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
    sampleSet: options.sampleSet,
    sampleSize: selectedSamples.length,
    attemptedCount: results.length,
    skippedCount: Math.max(0, selectedSamples.length - results.length),
    failureCount: failures.length,
    providerFailureCount,
    passCount: results.filter((result) => result.status === 200 && result.failureReasons.length === 0).length,
    providerStatus: providerFailureCount > 0 ? "blocked" : "available",
    stoppedEarlyReason,
    metrics: summarizeEvalMetrics(results, selectedSamples.length),
    modelConfig: {
      identifyModel: env.GEMINI_MODEL || "gemini-2.5-flash",
      fallbackModels: env.GEMINI_FALLBACK_MODELS || "gemini-2.5-flash-lite",
      providerTimeoutMs: env.DEEPSPEC_IDENTIFY_PROVIDER_TIMEOUT_MS || "25000",
      rateLimitRetries: options.rateLimitRetries,
    },
    datasetRoot: options.datasetRoot,
    datasetIndex: options.datasetIndex,
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

export async function createIdentifyResponseWithRetry(identify, dataUrl, env, rateLimitRetries = RATE_LIMIT_RETRY_DELAYS_MS.length) {
  const payload = {
    imageBase64: dataUrl,
    userMessage: "Identify this car part or visible damage from the captured photo.",
  };

  const retryDelaysMs = RATE_LIMIT_RETRY_DELAYS_MS.slice(0, rateLimitRetries);
  for (let attempt = 0; attempt <= retryDelaysMs.length; attempt += 1) {
    const response = await identify.createIdentifyResponse(payload, env);
    const code = response.status === 200 ? null : response.body.error.code;

    if (code !== "rate_limited" || attempt === retryDelaysMs.length) {
      return response;
    }

    const delayMs = retryDelaysMs[attempt];
    console.log(`rate_limited; retrying in ${Math.round(delayMs / 1000)}s`);
    await sleep(delayMs);
  }

  throw new Error("Unreachable identify retry state.");
}

function parseArgs(args) {
  const options = {
    datasetRoot: process.env.DEEPSPEC_DATASET_ROOT || DEFAULT_DATASET_ROOT,
    datasetIndex: process.env.DEEPSPEC_DATASET_INDEX_PATH || DEFAULT_DATASET_INDEX,
    delayMs: parseDelayMs(process.env.DEEPSPEC_EVAL_DELAY_MS, DEFAULT_EVAL_DELAY_MS),
    maxProviderFailures: parseMaxProviderFailures(process.env.DEEPSPEC_EVAL_MAX_PROVIDER_FAILURES, 1),
    output: DEFAULT_OUTPUT,
    providerTimeoutMs: null,
    rateLimitRetries: parseRateLimitRetries(process.env.DEEPSPEC_EVAL_RATE_LIMIT_RETRIES, RATE_LIMIT_RETRY_DELAYS_MS.length),
    sampleSize: 6,
    sampleSet: "release",
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
    } else if (name === "--dataset-root") {
      options.datasetRoot = value;
      if (!inlineValue) index += 1;
    } else if (name === "--dataset-index") {
      options.datasetIndex = value;
      if (!inlineValue) index += 1;
    } else if (name === "--sample-set") {
      options.sampleSet = parseSampleSet(value);
      if (!inlineValue) index += 1;
    } else if (name === "--provider-timeout-ms") {
      options.providerTimeoutMs = parseProviderTimeoutMs(value);
      if (!inlineValue) index += 1;
    } else if (name === "--rate-limit-retries") {
      options.rateLimitRetries = parseRateLimitRetries(value, options.rateLimitRetries);
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

function parseSampleSet(value) {
  if (value === "release" || value === "public") {
    return value;
  }

  throw new Error("--sample-set must be either release or public.");
}

function parseProviderTimeoutMs(value) {
  const timeoutMs = Number(value);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 5_000 || timeoutMs > 120_000) {
    throw new Error("--provider-timeout-ms must be an integer from 5000 to 120000.");
  }

  return timeoutMs;
}

function parseRateLimitRetries(value, fallback) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  const retries = Number(value);
  if (!Number.isInteger(retries) || retries < 0 || retries > RATE_LIMIT_RETRY_DELAYS_MS.length) {
    throw new Error(`--rate-limit-retries must be an integer from 0 to ${RATE_LIMIT_RETRY_DELAYS_MS.length}.`);
  }

  return retries;
}

function parseMaxProviderFailures(value, fallback) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  const failures = Number(value);
  if (!Number.isInteger(failures) || failures < 1 || failures > 10_000) {
    throw new Error("--max-provider-failures must be an integer from 1 to 10000.");
  }

  return failures;
}

function clampSampleSize(value) {
  if (!Number.isInteger(value) || value < 1 || value > 10_000) {
    throw new Error("--sample-size must be an integer from 1 to 10000.");
  }

  return value;
}

function printHelp() {
  console.log(`Run a local Deep Spec identify eval against ${DATASET_ID}.

Options:
  --sample-size <n>  Number of samples to run. Default: 6
  --sample-set <name>
                     release uses the fixed 50-case set; public builds a deterministic set from the dataset index.
                     Default: release
  --delay-ms <n>     Delay between provider calls. Default: ${DEFAULT_EVAL_DELAY_MS}
  --max-provider-failures <n>
                     Stop after this many provider availability failures. Default: 1
  --provider-timeout-ms <n>
                     Provider timeout for each model attempt, 5000-120000. Default: app setting
  --rate-limit-retries <n>
                     Number of rate-limit retries before failing, 0-${RATE_LIMIT_RETRY_DELAYS_MS.length}. Default: ${RATE_LIMIT_RETRY_DELAYS_MS.length}
  --output <path>    JSONL failure review rows. Default: ${DEFAULT_OUTPUT}
  --summary <path>   JSON summary. Default: ${DEFAULT_SUMMARY}
  --dataset-root <path>
                     Local dataset root. Default: ${DEFAULT_DATASET_ROOT}
  --dataset-index <path>
                     Derived dataset records JSONL for public samples. Default: ${DEFAULT_DATASET_INDEX}

The command exits nonzero when provider availability is blocked, any sample fails
scoring, or the requested sample set is not fully attempted and passed.
`);
}

async function resolveEvalSampleImages(options) {
  if (options.sampleSet === "release") {
    if (options.sampleSize > RELEASE_SAMPLE_IMAGES.length) {
      throw new Error(`--sample-size cannot exceed ${RELEASE_SAMPLE_IMAGES.length} for the release sample set.`);
    }

    return RELEASE_SAMPLE_IMAGES.slice(0, options.sampleSize);
  }

  const records = await readDatasetIndex(options.datasetIndex);
  return buildPublicSampleImages(records, options.sampleSize);
}

async function readDatasetIndex(datasetIndex) {
  let text;

  try {
    text = await readFile(datasetIndex, "utf8");
  } catch (error) {
    throw new Error(`Could not read ${datasetIndex}. Run npm run dataset:sort before the public eval.`, { cause: error });
  }

  return text
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line, index) => parseDatasetRecord(line, index + 1, datasetIndex));
}

function parseDatasetRecord(line, lineNumber, datasetIndex) {
  try {
    return JSON.parse(line);
  } catch (error) {
    throw new Error(`Could not parse ${datasetIndex}:${lineNumber}.`, { cause: error });
  }
}

export function buildPublicSampleImages(records, sampleSize = PUBLIC_SAMPLE_SIZE) {
  const byLabel = new Map();

  for (const record of records) {
    const imagePath = datasetImagePathFromRecord(record);
    const label = typeof record?.primaryLabel === "string" ? record.primaryLabel.trim() : "";

    if (!imagePath || !label) continue;

    if (!byLabel.has(label)) {
      byLabel.set(label, []);
    }

    byLabel.get(label).push({ imagePath, id: String(record.id ?? imagePath) });
  }

  const labelQueues = [...byLabel.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([label, values]) => ({
      label,
      values: values.sort((left, right) => left.id.localeCompare(right.id)),
    }));

  const selected = [];
  const seen = new Set();

  while (selected.length < sampleSize && labelQueues.some((queue) => queue.values.length > 0)) {
    for (const queue of labelQueues) {
      const next = queue.values.shift();
      if (!next || seen.has(next.imagePath)) continue;
      selected.push(next.imagePath);
      seen.add(next.imagePath);
      if (selected.length === sampleSize) break;
    }
  }

  if (selected.length < sampleSize) {
    throw new Error(`Public eval needs ${sampleSize} usable indexed images, but only found ${selected.length}. Run npm run dataset:sort and check the local dataset.`);
  }

  return selected;
}

function datasetImagePathFromRecord(record) {
  const group = typeof record?.rawGroupName === "string" ? record.rawGroupName.trim() : "";
  const sourceImage = typeof record?.source?.image === "string" ? record.source.image.trim() : "";

  if (!group || !sourceImage || sourceImage.includes("..")) {
    return null;
  }

  return `${group}/${sourceImage}`.replaceAll("\\", "/");
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

export async function loadEvalSample(imagePath, datasetRoot) {
  const annotationPath = annotationPathForImage(imagePath);
  const localAnnotation = await readLocalJson(datasetRoot, annotationPath);
  const localImage = await readLocalBytes(datasetRoot, imagePath);
  const annotationSource = localAnnotation ? "local" : "hugging_face";
  const imageSource = localImage ? "local" : "hugging_face";
  const annotation = localAnnotation ?? (await fetchJson(resolveUrl(annotationPath)));
  const image = localImage ?? (await fetchBytes(resolveUrl(imagePath)));

  return {
    annotation,
    annotationSource,
    image,
    imageSource,
    datasetSource: annotationSource === imageSource ? annotationSource : "mixed",
  };
}

async function readLocalJson(datasetRoot, relativePath) {
  const localPath = resolveLocalDatasetPath(datasetRoot, relativePath);
  if (!localPath || !existsSync(localPath)) {
    return null;
  }

  try {
    return JSON.parse(await readFile(localPath, "utf8"));
  } catch (error) {
    throw datasetReadError(localPath, error);
  }
}

async function readLocalBytes(datasetRoot, relativePath) {
  const localPath = resolveLocalDatasetPath(datasetRoot, relativePath);
  if (!localPath || !existsSync(localPath)) {
    return null;
  }

  try {
    return {
      bytes: await readFile(localPath),
      contentType: contentTypeForPath(localPath),
    };
  } catch (error) {
    throw datasetReadError(localPath, error);
  }
}

function resolveLocalDatasetPath(datasetRoot, relativePath) {
  if (!datasetRoot || !relativePath || relativePath.includes("..")) {
    return null;
  }

  const root = resolve(datasetRoot);
  const localPath = resolve(root, relativePath);
  return localPath === root || localPath.startsWith(`${root}${sep}`) ? localPath : null;
}

function contentTypeForPath(path) {
  const extension = extname(path).toLowerCase();
  if (extension === ".png") return "image/png";
  if (extension === ".webp") return "image/webp";
  return "image/jpeg";
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
  }

  if (normalized === "scratch") {
    aliases.add("scratched");
  }

  if (normalized === "dent") {
    aliases.add("dented");
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

function isSafetyCriticalExpected(labels) {
  return SAFETY_CRITICAL_EXPECTED_PATTERN.test(normalizeText(labels.join(" ")));
}

function summarizeLatency(values) {
  if (values.length === 0) {
    return {
      count: 0,
      average: null,
      p50: null,
      p95: null,
      max: null,
    };
  }

  const sorted = [...values].sort((a, b) => a - b);
  return {
    count: sorted.length,
    average: Math.round(sorted.reduce((sum, value) => sum + value, 0) / sorted.length),
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    max: sorted[sorted.length - 1],
  };
}

function percentile(sortedValues, percentileValue) {
  const index = Math.min(sortedValues.length - 1, Math.max(0, Math.ceil((percentileValue / 100) * sortedValues.length) - 1));
  return sortedValues[index];
}

function rate(count, total) {
  if (!total) {
    return 0;
  }

  return Number((count / total).toFixed(4));
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
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
