import { randomUUID } from "node:crypto";

const ERROR_CODES = new Set([
  "not_configured", "rate_limited", "provider_error", "network",
  "invalid_response", "invalid_input", "image_too_large",
]);

type Outcome = { status: number; body: unknown };

// Only the identification-service outcome is counted, not each provider fallback.
// HTTP auth/rate/credit gates and later credit consumption are outside this scope.
// No request, exception message, model output or user identifier enters this log.
export async function observeIdentification<T extends Outcome>(
  run: () => Promise<T>,
  env: Record<string, string | undefined>,
): Promise<T> {
  if (env.DEEPSPEC_DIAGNOSTICS !== "1") return run();
  const started = performance.now();
  let status = 500;
  let code = "unexpected_error";
  try {
    const result = await run();
    status = result.status;
    const body = result.body as { error?: { code?: unknown } } | null;
    const candidate = body?.error?.code;
    code = status === 200 ? "ok"
      : typeof candidate === "string" && ERROR_CODES.has(candidate) ? candidate : "other_error";
    return result;
  } finally {
    try {
      const release = env.VERCEL_GIT_COMMIT_SHA;
      console.info(`[DeepSpec diagnostics] ${JSON.stringify({
        schema: 1,
        eventId: randomUUID(),
        occurredAt: new Date().toISOString(),
        release: release && /^[a-f0-9]{40}$/i.test(release) ? release.toLowerCase() : "unknown",
        stage: "identify",
        code,
        status: Number.isInteger(status) && status >= 100 && status <= 599 ? status : 500,
        durationMs: Math.min(3_600_000, Math.max(0, Math.round(performance.now() - started))),
      })}`);
    } catch {
      // A broken log sink must not replace a result or the original exception.
    }
  }
}
