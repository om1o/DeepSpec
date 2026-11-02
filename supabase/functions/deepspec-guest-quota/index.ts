type Environment = { get: (name: string) => string | undefined };
type Scope = "identify" | "chat";
type Rule = { label: string; windowSeconds: number; max: number };

const RULES: Record<Scope, Rule[]> = {
  identify: [{ label: "min", windowSeconds: 60, max: 15 }, { label: "day", windowSeconds: 86_400, max: 150 }],
  chat: [{ label: "min", windowSeconds: 60, max: 30 }, { label: "day", windowSeconds: 86_400, max: 300 }],
};
const HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store" };
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: HEADERS });
const unavailable = () => reply(503, { error: { code: "quota_unavailable", message: "Preview request limits are unavailable." } });

function getServerKey(env: Environment): string {
  try {
    const keys = JSON.parse(env.get("SUPABASE_SECRET_KEYS") ?? "{}");
    if (typeof keys?.default === "string" && keys.default.trim()) return keys.default.trim();
  } catch { /* Older projects can use the automatically injected legacy key. */ }
  return env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim() ?? "";
}

async function readBody(request: Request): Promise<string | null> {
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 1024) { await reader.cancel(); return null; }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(bytes);
}

/** Public consume-only quota endpoint. Limits, RPC names and keys are not caller-adjustable. */
export async function handleGuestQuota(request: Request, env: Environment, fetchImpl: typeof fetch = fetch): Promise<Response> {
  if (request.method !== "POST") return reply(405, { error: { code: "method_not_allowed" } });
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") return reply(415, { error: { code: "invalid_input" } });
  let input: { scope?: unknown; ipHash?: unknown };
  try {
    const text = await readBody(request);
    input = JSON.parse(text ?? "null");
    if (!input || typeof input !== "object" || Array.isArray(input)
      || Object.keys(input).some((key) => key !== "scope" && key !== "ipHash")
      || (input.scope !== "identify" && input.scope !== "chat")
      || typeof input.ipHash !== "string" || !/^[a-f0-9]{64}$/.test(input.ipHash)) {
      return reply(400, { error: { code: "invalid_input" } });
    }
  } catch {
    return reply(400, { error: { code: "invalid_input" } });
  }

  const key = getServerKey(env);
  let rpcUrl: URL;
  try {
    rpcUrl = new URL("/rest/v1/rpc/check_rate_limit", env.get("SUPABASE_URL"));
    if (rpcUrl.protocol !== "https:" || !key) return unavailable();
  } catch {
    return unavailable();
  }

  const headers: Record<string, string> = { "Content-Type": "application/json", apikey: key };
  if (!key.startsWith("sb_secret_")) headers.Authorization = `Bearer ${key}`;
  try {
    for (const rule of RULES[input.scope as Scope]) {
      const response = await fetchImpl(rpcUrl, {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(3000),
        headers,
        body: JSON.stringify({ p_key: `guest-preview:${input.scope}:${rule.label}:${input.ipHash}`, p_max: rule.max, p_window_seconds: rule.windowSeconds }),
      });
      if (!response.ok) return unavailable();
      const allowed: unknown = await response.json();
      if (allowed === false) return reply(429, { allowed: false, retryAfterSeconds: rule.windowSeconds });
      if (allowed !== true) return unavailable();
    }
    return reply(200, { allowed: true });
  } catch {
    return unavailable();
  }
}

const edgeRuntime = (globalThis as typeof globalThis & { Deno?: { env: Environment; serve: (handler: (request: Request) => Promise<Response>) => void } }).Deno;
if (edgeRuntime) edgeRuntime.serve((request) => handleGuestQuota(request, edgeRuntime.env));
