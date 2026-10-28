type PreviewEnv = Record<string, string | undefined>;
type RequestHeaders = Record<string, string | string[] | undefined>;

/**
 * The real, browser-local preview may call live AI without an account. This
 * server-owned switch never grants access in production or to bearer requests.
 * API handlers must still pass their distributed IP limiter before using it.
 */
export function isGuestPreviewRequest(headers: RequestHeaders, env: PreviewEnv): boolean {
  return env.DEEPSPEC_GUEST_PREVIEW === "true"
    && env.VERCEL_ENV === "preview"
    && !Object.entries(headers).some(([name, value]) => name.toLowerCase() === "authorization" && value !== undefined);
}
