import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const DEFAULT_SUMMARY = ".deepspec-eval/identify-summary.json";

export function classifyIdentifyEvalSummary(summary) {
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
  if (attemptedCount < 1) {
    return {
      ok: false,
      exitCode: 1,
      kind: "incomplete_eval",
      message: "Identify eval did not attempt any samples.",
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
  const summaryPath = process.argv[2] || DEFAULT_SUMMARY;
  const text = await readFile(summaryPath, "utf8").catch(() => null);
  const summary = text ? JSON.parse(text) : null;
  const result = classifyIdentifyEvalSummary(summary);
  const write = result.ok ? console.log : console.error;
  write(result.message);
  process.exit(result.exitCode);
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
