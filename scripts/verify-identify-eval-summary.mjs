import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const DEFAULT_SUMMARY = ".deepspec-eval/identify-summary.json";

export function classifyIdentifyEvalSummary(summary, options = {}) {
  if (!summary || typeof summary !== "object") {
    return {
      ok: false,
      exitCode: 1,
      kind: "invalid_summary",
      message: "Identify eval summary is missing or unreadable.",
    };
  }

  const providerFailureCount = Number(summary.providerFailureCount ?? 0);
  if (
    summary.providerStatus === "blocked" ||
    summary.stoppedEarlyReason === "provider_availability" ||
    providerFailureCount > 0
  ) {
    return {
      ok: false,
      exitCode: 2,
      kind: "provider_unavailable",
      message: `Provider unavailable: ${providerFailureCount} provider failure(s). Fix quota/provider health before judging model quality.`,
    };
  }

  const attemptedCount = Number(summary.attemptedCount ?? 0);
  const passCount = Number(summary.passCount ?? 0);
  const failureCount = Number(summary.failureCount ?? 0);
  const minSampleSize = parseMinSampleSize(options.minSampleSize ?? 1);
  if (attemptedCount < minSampleSize) {
    return {
      ok: false,
      exitCode: 1,
      kind: "incomplete_eval",
      message:
        minSampleSize > 1
          ? `Identify eval attempted ${attemptedCount}/${minSampleSize} required samples.`
          : "Identify eval did not attempt any samples.",
    };
  }

  if (failureCount > 0 || passCount < attemptedCount) {
    return {
      ok: false,
      exitCode: 1,
      kind: "model_quality",
      message: `Model quality gate failed: ${passCount}/${attemptedCount} passed and ${failureCount} review row(s) were written.`,
    };
  }

  return {
    ok: true,
    exitCode: 0,
    kind: "passed",
    message: `Identify eval passed: ${passCount}/${attemptedCount} samples passed with provider available.`,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const summaryPath = options.summaryPath || DEFAULT_SUMMARY;
  const text = await readFile(summaryPath, "utf8").catch(() => null);
  const summary = text ? JSON.parse(text) : null;
  const result = classifyIdentifyEvalSummary(summary, { minSampleSize: options.minSampleSize });
  const write = result.ok ? console.log : console.error;
  write(result.message);
  process.exit(result.exitCode);
}

function parseArgs(args) {
  const options = {
    minSampleSize: 1,
    summaryPath: null,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const [name, inlineValue] = arg.split("=");
    const value = inlineValue ?? args[index + 1];

    if (name === "--min-sample-size") {
      options.minSampleSize = parseMinSampleSize(value);
      if (!inlineValue) index += 1;
    } else if (!options.summaryPath) {
      options.summaryPath = arg;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

function parseMinSampleSize(value) {
  const minSampleSize = Number(value);
  if (!Number.isInteger(minSampleSize) || minSampleSize < 1 || minSampleSize > 10_000) {
    throw new Error("--min-sample-size must be an integer from 1 to 10000.");
  }

  return minSampleSize;
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
