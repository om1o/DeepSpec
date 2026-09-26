import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyBillingProviderConfig } from "./verify-billing-provider.mjs";

loadLocalEnv(".env.local");
loadLocalEnv(".env");

export function classifyPolarTestingOnly(env = {}, options = {}) {
  const blockers = [];
  const checks = ["Polar-only sandbox verifier loaded."];
  const warnings = [];
  const provider = String(env.BILLING_PROVIDER ?? "").trim().toLowerCase();

  if (provider !== "polar") {
    blockers.push("Set BILLING_PROVIDER=polar for Dad's non-Stripe sandbox path.");
  } else {
    checks.push("BILLING_PROVIDER is polar.");
  }

  if (env.DEEPSPEC_ENABLE_LIVE_BILLING === "true") {
    blockers.push("DEEPSPEC_ENABLE_LIVE_BILLING must stay false or unset during Polar testing.");
  } else {
    checks.push("Live billing switch is off.");
  }

  const stripeKeys = Object.keys(env)
    .filter((key) => key.startsWith("STRIPE_") && String(env[key] ?? "").trim());
  if (stripeKeys.length > 0) {
    blockers.push(`Remove Stripe env values for Polar-only testing: ${stripeKeys.join(", ")}.`);
  } else {
    checks.push("No Stripe env values are present.");
  }

  const polar = verifyBillingProviderConfig(env, {
    allowProduction: false,
    provider: "polar",
    strictPublicUrl: Boolean(options.strictPublicUrl),
  });
  checks.push(...polar.checks.map((check) => `Polar: ${check}`));
  warnings.push(...polar.warnings.map((warning) => `Polar: ${warning}`));
  blockers.push(...polar.issues.map((issue) => `Polar: ${issue}`));

  return {
    blockers,
    checks,
    ok: blockers.length === 0,
    provider: "polar",
    recommendation: blockers.length === 0 ? "polar_testing_ready" : "polar_testing_blocked",
    warnings,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const result = classifyPolarTestingOnly(process.env, options);

  console.log(`[0/3] Provider: ${result.provider}`);
  console.log(`[1/3] Recommendation: ${result.recommendation}`);
  for (const check of result.checks) console.log(`      OK: ${check}`);
  for (const warning of result.warnings) console.warn(`      WARN: ${warning}`);

  if (!result.ok) {
    console.error("[2/3] Polar testing is blocked.");
    for (const blocker of result.blockers) console.error(`      BLOCKED: ${blocker}`);
    process.exit(1);
  }

  console.log("[2/3] Polar sandbox config is ready for checkout/webhook testing. Live payments remain off.");
}

function parseArgs(args) {
  const options = {
    strictPublicUrl: false,
  };

  for (const arg of args) {
    if (arg === "--strict-public-url") {
      options.strictPublicUrl = true;
    } else if (arg === "--help") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

function printHelp() {
  console.log(`Verify DeepSpec Polar-only sandbox testing.

Options:
  --strict-public-url   Fail if DEEPSPEC_PUBLIC_URL is local.
`);
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

function isDirectRun(url) {
  return process.argv[1] && fileURLToPath(url) === process.argv[1];
}

if (isDirectRun(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
