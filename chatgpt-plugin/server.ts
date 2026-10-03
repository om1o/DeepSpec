import { createHash, randomUUID } from "node:crypto";
import { lookup as dnsLookup } from "node:dns/promises";
import { readFileSync } from "node:fs";
import { createServer as createHttpServer, type Server } from "node:http";
import { isIP } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import express, { type Request } from "express";
import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WIDGET_URI = "ui://deepspec/vehicle-scan-v1.html";
const IMAGE_LIMIT_BYTES = 2 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);
const SCAN_CATEGORIES = new Set(["engine", "electrical", "brakes", "steering", "suspension", "fuel", "airbag", "body", "leak", "unknown"]);
const oauthSchemes = [{ type: "oauth2" as const, scopes: ["openid", "email", "profile"] }];

const fileSchema = z.object({
  download_url: z.string().url(),
  file_id: z.string().min(1),
  mime_type: z.string().optional(),
  file_name: z.string().optional(),
}).strict();

const sourceSchema = z.object({
  label: z.string(),
  url: z.string().url().refine((value) => ["http:", "https:"].includes(new URL(value).protocol), "Source URL must use HTTP or HTTPS."),
  sourceType: z.enum(["dataset", "reference", "search", "safety"]),
  sourceTier: z.enum(["tier_1_government", "tier_1_oem", "tier_2_licensed", "tier_3_user_verified", "unverified_reference"]),
  verificationStatus: z.enum(["verified", "constrained", "user_confirmed", "unverified"]),
  evidenceRole: z.enum(["supports_claim", "constrains_claim", "research_only", "product_reference"]),
  sourceName: z.string(),
  sourceLicense: z.string().optional(),
  retrievedAt: z.string().datetime().optional(),
}).strict();

const analysisSchema = z.object({
  partName: z.string(),
  confidence: z.string(),
  scanCategory: z.string(),
  whatItDoes: z.string(),
  visibleObservations: z.array(z.string()),
  concerns: z.array(z.string()),
  nextAction: z.string(),
  needsBetterPhoto: z.boolean(),
  sourceLinks: z.array(sourceSchema),
}).passthrough();

const analysisOutputSchema = {
  analysisId: z.string(),
  imageFileId: z.string(),
  question: z.string(),
  analysis: analysisSchema,
  sourceLinks: z.array(sourceSchema),
  deepSpecUrl: z.string().url(),
  disclaimer: z.string(),
};

type PluginEnv = Record<string, string | undefined>;
type VehicleFile = z.infer<typeof fileSchema>;
type VehicleAnalysis = z.infer<typeof analysisSchema>;

export function createOAuthMetadata(env: PluginEnv) {
  const supabaseUrl = getSupabaseUrl(env);
  return {
    resource: getPluginPublicUrl(env),
    authorization_servers: [`${supabaseUrl}/auth/v1`],
    scopes_supported: ["openid", "email", "profile"],
    bearer_methods_supported: ["header"],
  };
}

export function validateAccessTokenClaims(claims: Record<string, unknown>, env: PluginEnv, nowSeconds = Math.floor(Date.now() / 1000)) {
  const expectedIssuer = `${getSupabaseUrl(env)}/auth/v1`;
  if (claims.iss !== expectedIssuer) throw new Error("The access token issuer does not match DeepSpec.");

  const audiences = typeof claims.aud === "string"
    ? [claims.aud]
    : Array.isArray(claims.aud) ? claims.aud.filter((value): value is string => typeof value === "string") : [];
  if (!audiences.includes(getPluginPublicUrl(env))) throw new Error("The access token audience does not match this DeepSpec plugin.");

  if (typeof claims.exp !== "number" || claims.exp <= nowSeconds) throw new Error("The access token has expired.");
  if (typeof claims.nbf === "number" && claims.nbf > nowSeconds) throw new Error("The access token is not active yet.");
  if (typeof claims.sub !== "string" || !claims.sub) throw new Error("The access token has no user subject.");

  const scopes = typeof claims.scope === "string"
    ? claims.scope.split(/\s+/).filter(Boolean)
    : Array.isArray(claims.scopes) ? claims.scopes.filter((value): value is string => typeof value === "string") : [];
  const missingScopes = oauthSchemes[0].scopes.filter((scope) => !scopes.includes(scope));
  if (missingScopes.length) throw new Error(`The access token is missing required scopes: ${missingScopes.join(", ")}.`);

  return { subject: claims.sub, scopes };
}

export function validateDownloadUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error("ChatGPT image download must use HTTPS.");
  const hostname = normalizeHostname(url.hostname);
  if (hostname === "localhost" || hostname.endsWith(".localhost") || isPrivateAddress(hostname) || isPrivateIpv6(hostname)) {
    throw new Error("Private-network image URLs are not allowed.");
  }
  return url;
}

export async function downloadVehicleImage(
  file: VehicleFile,
  fetchImpl: typeof fetch = fetch,
  lookupImpl: typeof dnsLookup = dnsLookup,
) {
  let url = validateDownloadUrl(file.download_url);
  for (let redirect = 0; redirect <= 3; redirect += 1) {
    await assertPublicDns(url.hostname, lookupImpl);
    const response = await fetchImpl(url, { redirect: "manual", signal: AbortSignal.timeout(15_000) });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location || redirect === 3) throw new Error("Image download redirected too many times.");
      url = validateDownloadUrl(new URL(location, url).toString());
      continue;
    }
    if (!response.ok) throw new Error(`Image download failed with HTTP ${response.status}.`);
    const contentType = (response.headers.get("content-type") || file.mime_type || "").split(";")[0].trim().toLowerCase();
    const extension = ALLOWED_IMAGE_TYPES.get(contentType);
    if (!extension) throw new Error("DeepSpec accepts JPEG, PNG, or WebP vehicle images.");
    const declaredLength = Number(response.headers.get("content-length") || 0);
    if (declaredLength > IMAGE_LIMIT_BYTES) throw new Error("The image is larger than the 2 MB DeepSpec limit.");
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.length || bytes.length > IMAGE_LIMIT_BYTES) throw new Error("The image is empty or larger than the 2 MB DeepSpec limit.");
    return { bytes, contentType, extension };
  }
  throw new Error("Image download failed.");
}

export function createDeepSpecPlugin(accessToken: string | null, env: PluginEnv = process.env) {
  const server = new McpServer({
    name: "deepspec-vehicle-vision",
    version: "0.1.0",
  }, {
    instructions: "Use DeepSpec for user-provided vehicle-part images. Present probable identity, visible evidence, uncertainty, next action, and sources. Never claim exact fitment, hidden condition, or repair safety from one photo. Never save an image unless the user explicitly requests it.",
  });
  const widgetHtml = readFileSync(resolve(__dirname, "widget.html"), "utf8");

  registerAppResource(server, "DeepSpec scan result", WIDGET_URI, { mimeType: RESOURCE_MIME_TYPE }, async () => ({
    contents: [{
      uri: WIDGET_URI,
      mimeType: RESOURCE_MIME_TYPE,
      text: widgetHtml,
      _meta: {
        ui: { prefersBorder: true, domain: getPluginPublicUrl(env), csp: { connectDomains: [], resourceDomains: [] } },
        "openai/widgetDescription": "A compact DeepSpec vehicle-part result with evidence, sources, and an explicit private-save control.",
      },
    }],
  }));

  registerAppTool(server, "get_deepspec_profile", withOAuthTool({
    title: "Get DeepSpec account",
    description: "Use this when the user wants to confirm which DeepSpec account is connected.",
    inputSchema: {},
    outputSchema: { userId: z.string(), email: z.string() },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    _meta: { "openai/profile": true },
  }), async () => {
    const auth = await requireUser(accessToken, env);
    if (!auth.ok) return auth.result;
    return {
      content: [{ type: "text", text: `Connected to DeepSpec as ${auth.email}.` }],
      structuredContent: { userId: auth.userId, email: auth.email },
    };
  });

  registerAppTool(server, "analyze_vehicle_image", withOAuthTool({
    title: "Analyze a vehicle image",
    description: "Use this when the user asks to identify, inspect, explain, or learn from a user-provided image of a vehicle part. Return a cautious DeepSpec result with visible evidence and sources. Do not save the image.",
    inputSchema: {
      file: fileSchema,
      question: z.string().trim().max(500).optional().describe("The user's question or reason for inspecting the image."),
    },
    outputSchema: analysisOutputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    _meta: {
      "openai/fileParams": ["file"],
      ui: { resourceUri: WIDGET_URI },
      "openai/toolInvocation/invoking": "Inspecting the vehicle image...",
      "openai/toolInvocation/invoked": "DeepSpec result ready",
    },
  }), async ({ file, question }) => {
    const auth = await requireUser(accessToken, env);
    if (!auth.ok) return auth.result;
    try {
      const image = await downloadVehicleImage(file);
      const analysis = await requestDeepSpecAnalysis(image, accessToken!, env);
      const sourceLinks = withDeepSpecGuide(analysis.sourceLinks, analysis.scanCategory, env);
      const normalized = { ...analysis, sourceLinks };
      const structuredContent = {
        analysisId: randomUUID(),
        imageFileId: file.file_id,
        question: question ?? "",
        analysis: normalized,
        sourceLinks,
        deepSpecUrl: `${getDeepSpecWebUrl(env)}/history`,
        disclaimer: "Probable identification only. A photo does not prove exact fitment, hidden condition, function, or repair safety.",
      };
      return {
        content: [{ type: "text", text: formatAnalysisText(normalized, sourceLinks) }],
        structuredContent,
      };
    } catch (error) {
      return toolError(error);
    }
  });

  registerAppTool(server, "save_deepspec_scan", withOAuthTool({
    title: "Save a DeepSpec scan",
    description: "Use this only after the user explicitly asks to save the current DeepSpec image and analysis to their private account. Never call it merely to analyze an image. Saving is not consent to use the image for model training.",
    inputSchema: {
      file: fileSchema,
      analysisId: z.string().uuid(),
      analysis: analysisSchema,
      question: z.string().trim().max(500).optional(),
      userConfirmed: z.literal(true).describe("Must be true only after the user explicitly confirms the save."),
    },
    outputSchema: { saved: z.boolean(), localId: z.string(), deepSpecUrl: z.string().url() },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    _meta: {
      "openai/fileParams": ["file"],
      ui: { resourceUri: WIDGET_URI },
      "openai/toolInvocation/invoking": "Saving to private DeepSpec history...",
      "openai/toolInvocation/invoked": "Saved to DeepSpec",
    },
  }), async ({ file, analysisId, analysis, question, userConfirmed }) => {
    if (userConfirmed !== true) return toolError(new Error("Explicit save confirmation is required."));
    const auth = await requireUser(accessToken, env);
    if (!auth.ok) return auth.result;
    try {
      const image = await downloadVehicleImage(file);
      const saved = await saveScan({ accessToken: accessToken!, analysis, analysisId, image, question, userId: auth.userId }, env);
      return {
        content: [{ type: "text", text: "The image and analysis were saved to the user's private DeepSpec history. This did not opt the image into model training." }],
        structuredContent: saved,
      };
    } catch (error) {
      return toolError(error);
    }
  });

  mirrorOAuthSchemesAtTopLevel(server);
  return server;
}

export function startPluginServer(port = Number(process.env.PORT || 8787), env: PluginEnv = process.env): Server {
  const httpServer = createHttpServer(createPluginHttpApp(env));
  httpServer.listen(port, () => {
    const address = httpServer.address();
    const activePort = typeof address === "object" && address ? address.port : port;
    console.log(`DeepSpec ChatGPT plugin listening on http://localhost:${activePort}/mcp`);
  });
  return httpServer;
}

export function createPluginHttpApp(env: PluginEnv = process.env) {
  const app = express();
  const allowedBrowserOrigins = getAllowedBrowserOrigins(env);
  app.use(cors({
    origin(origin, callback) {
      if (!origin || allowedBrowserOrigins.has(origin)) return callback(null, true);
      return callback(new Error("Origin is not allowed by the DeepSpec plugin."));
    },
    allowedHeaders: ["authorization", "content-type", "mcp-session-id"],
    exposedHeaders: ["Mcp-Session-Id"],
  }));
  app.use(express.json({ limit: "1mb" }));
  const metadata = () => createOAuthMetadata(env);

  app.get("/", (_req, res) => res.type("text/plain").send("DeepSpec ChatGPT plugin"));
  app.get(["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"], (_req, res) => res.json(metadata()));
  app.all(["/mcp", "/api/mcp"], async (req, res) => {
    const server = createDeepSpecPlugin(readBearerToken(req), env);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch {
      if (!res.headersSent) res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
    }
  });

  return app;
}

async function requireUser(accessToken: string | null, env: PluginEnv): Promise<
  | { ok: true; userId: string; email: string }
  | { ok: false; result: ReturnType<typeof authError> }
> {
  if (!accessToken) return { ok: false, result: authError(env, "Connect your DeepSpec account to continue.") };
  try {
    const client = createUserClient(accessToken, env);
    const claimsResponse = await client.auth.getClaims(accessToken);
    if (claimsResponse.error || !claimsResponse.data?.claims) {
      return { ok: false, result: authError(env, "Your DeepSpec connection expired. Reconnect and try again.") };
    }
    const validated = validateAccessTokenClaims(claimsResponse.data.claims as Record<string, unknown>, env);
    const response = await client.auth.getUser(accessToken);
    if (response.error || !response.data.user) return { ok: false, result: authError(env, "Your DeepSpec connection expired. Reconnect and try again.") };
    if (response.data.user.id !== validated.subject) return { ok: false, result: authError(env, "The access token subject does not match this DeepSpec account.") };
    return { ok: true, userId: response.data.user.id, email: response.data.user.email ?? "DeepSpec user" };
  } catch {
    return { ok: false, result: authError(env, "DeepSpec could not verify this account connection.") };
  }
}

async function requestDeepSpecAnalysis(image: { bytes: Uint8Array; contentType: string }, accessToken: string, env: PluginEnv) {
  const response = await fetch(`${getDeepSpecApiUrl(env)}/api/identify`, {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({ imageBase64: `data:${image.contentType};base64,${Buffer.from(image.bytes).toString("base64")}` }),
    signal: AbortSignal.timeout(90_000),
  });
  const body = await response.json().catch(() => null) as VehicleAnalysis | { error?: { message?: string } } | null;
  if (!response.ok) {
    const candidate = body as { error?: { message?: unknown } } | null;
    const message = typeof candidate?.error?.message === "string" ? candidate.error.message : null;
    throw new Error(message || `DeepSpec analysis failed with HTTP ${response.status}.`);
  }
  return analysisSchema.parse(body);
}

async function saveScan(input: {
  accessToken: string;
  analysis: VehicleAnalysis;
  analysisId: string;
  image: { bytes: Uint8Array; contentType: string; extension: string };
  question?: string;
  userId: string;
}, env: PluginEnv) {
  const analysisJson = JSON.stringify(input.analysis);
  if (analysisJson.length > 100_000) throw new Error("The analysis is too large to save safely.");
  const client = createUserClient(input.accessToken, env);
  const localId = `chatgpt-${input.analysisId}`;
  const imagePath = `${input.userId}/${localId}.${input.image.extension}`;
  const imageHash = createHash("sha256").update(input.image.bytes).digest("hex");
  const existing = await client.from("scan_lookups").select("image_hash").eq("user_id", input.userId).eq("local_id", localId).maybeSingle();
  if (existing.error) throw new Error(existing.error.message);
  if (existing.data?.image_hash && existing.data.image_hash !== imageHash) {
    throw new Error("This analysis ID is already attached to a different image.");
  }
  const createdImage = !existing.data;
  if (createdImage) {
    const blob = new Blob([Uint8Array.from(input.image.bytes).buffer], { type: input.image.contentType });
    const upload = await client.storage.from("scan-images").upload(imagePath, blob, { contentType: input.image.contentType, upsert: true });
    if (upload.error) throw new Error(upload.error.message);
  }

  const now = new Date().toISOString();
  const resultJson = {
    ...input.analysis,
    integration: { source: "chatgpt-plugin", analysisId: input.analysisId, unverified: true },
  };
  const saved = await client.from("scan_lookups").upsert({
    user_id: input.userId,
    local_id: localId,
    created_at: now,
    captured_at: now,
    analyzed_at: now,
    image_path: imagePath,
    image_hash: imageHash,
    image_mime_type: input.image.contentType,
    image_byte_length: input.image.bytes.length,
    result_json: resultJson,
    scan_category: SCAN_CATEGORIES.has(input.analysis.scanCategory) ? input.analysis.scanCategory : "unknown",
    training_label: "unlabeled",
    training_status: "raw_unreviewed",
    rating: null,
    correction: null,
    notes: input.question?.trim().slice(0, 500) ?? "",
    chat_history: [],
    analysis_attempt_id: input.analysisId,
  }, { onConflict: "user_id,local_id" });
  if (saved.error) {
    if (createdImage) await client.storage.from("scan-images").remove([imagePath]);
    throw new Error(saved.error.message);
  }
  return { saved: true, localId, deepSpecUrl: `${getDeepSpecWebUrl(env)}/history` };
}

function createUserClient(accessToken: string, env: PluginEnv) {
  return createClient(getSupabaseUrl(env), getSupabaseKey(env), {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

function withOAuthTool<T extends { _meta?: Record<string, unknown> }>(config: T) {
  return {
    ...config,
    securitySchemes: oauthSchemes,
    _meta: { ...config._meta, securitySchemes: oauthSchemes },
  };
}

function addOAuthSecuritySchemesToToolList(result: { tools: Array<Record<string, unknown>> }) {
  return {
    ...result,
    tools: result.tools.map((tool) => ({ ...tool, securitySchemes: oauthSchemes })),
  };
}

function mirrorOAuthSchemesAtTopLevel(server: McpServer) {
  type RequestHandler = (request: unknown, extra: unknown) => Promise<unknown>;
  const protocol = server.server;
  const requestHandlers = Reflect.get(protocol, "_requestHandlers") as unknown;
  if (!(requestHandlers instanceof Map)) throw new Error("DeepSpec could not access the MCP tool-list handler.");
  const original = (requestHandlers as Map<string, RequestHandler>).get("tools/list");
  if (!original) throw new Error("DeepSpec could not install the OAuth tool-list adapter.");
  protocol.setRequestHandler(ListToolsRequestSchema, async (request, extra) => {
    const result = await original(request, extra) as { tools: Array<Record<string, unknown>> };
    return addOAuthSecuritySchemesToToolList(result);
  });
}

function authError(env: PluginEnv, message: string) {
  const resource = `${getPluginPublicUrl(env)}/.well-known/oauth-protected-resource`;
  return {
    content: [{ type: "text" as const, text: message }],
    _meta: { "mcp/www_authenticate": [`Bearer resource_metadata="${resource}", error="invalid_token", error_description="${message}"`] },
    isError: true,
  };
}

function toolError(error: unknown) {
  return { content: [{ type: "text" as const, text: error instanceof Error ? error.message : "DeepSpec could not complete this request." }], isError: true };
}

function readBearerToken(request: Request) {
  const value = request.header("authorization") || "";
  return value.toLowerCase().startsWith("bearer ") ? value.slice(7).trim() || null : null;
}

function withDeepSpecGuide(value: unknown, category: string, env: PluginEnv) {
  const sources = z.array(sourceSchema).catch([]).parse(value);
  const path = category === "body" || category === "leak"
    ? "/articles/car-damage-ai-scanner.html"
    : category === "unknown"
      ? "/articles/ai-car-part-finding.html"
      : "/articles/ai-car-parts-scanner.html";
  const guide = {
    label: "DeepSpec guide for reviewing vehicle-image results",
    url: `${getDeepSpecWebUrl(env)}${path}`,
    sourceType: "reference" as const,
    sourceTier: "unverified_reference" as const,
    verificationStatus: "unverified" as const,
    evidenceRole: "product_reference" as const,
    sourceName: "Deep Spec",
  };
  return [...sources.filter((source) => source.url !== guide.url), guide].slice(0, 5);
}

function formatAnalysisText(analysis: VehicleAnalysis, sources: z.infer<typeof sourceSchema>[]) {
  const visible = analysis.visibleObservations.slice(0, 3).map((item) => `- ${item}`).join("\n");
  const concerns = analysis.concerns.slice(0, 3).map((item) => `- ${item}`).join("\n") || "- No specific visible concern was returned.";
  const links = sources.map((source) => `- ${source.label}: ${source.url}`).join("\n");
  return `${analysis.partName} (${analysis.confidence} confidence)\n\nWhat it does: ${analysis.whatItDoes}\n\nVisible evidence:\n${visible}\n\nConcerns:\n${concerns}\n\nNext action: ${analysis.nextAction}\n\nEvidence and research links:\n${links}\n\nProbable identification only. A photo does not prove exact fitment, hidden condition, function, or repair safety.`;
}

function getSupabaseUrl(env: PluginEnv) {
  const value = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  if (!value) throw new Error("SUPABASE_URL is required for the DeepSpec plugin.");
  return value.replace(/\/$/, "");
}

function getSupabaseKey(env: PluginEnv) {
  const value = env.SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!value) throw new Error("SUPABASE_PUBLISHABLE_KEY is required for the DeepSpec plugin.");
  return value;
}

function getPluginPublicUrl(env: PluginEnv) {
  return getPublicUrl(env.DEEPSPEC_PLUGIN_PUBLIC_URL || getVercelPublicUrl(env), "http://localhost:8787", "DEEPSPEC_PLUGIN_PUBLIC_URL", env);
}

function getDeepSpecApiUrl(env: PluginEnv) {
  return getPublicUrl(env.DEEPSPEC_API_BASE_URL || getVercelPublicUrl(env), "http://localhost:5174", "DEEPSPEC_API_BASE_URL", env);
}

function getDeepSpecWebUrl(env: PluginEnv) {
  return getPublicUrl(env.DEEPSPEC_WEB_URL || getVercelPublicUrl(env), "http://localhost:5174", "DEEPSPEC_WEB_URL", env);
}

function getVercelPublicUrl(env: PluginEnv) {
  return env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}` : undefined;
}

function getPublicUrl(value: string | undefined, developmentDefault: string, name: string, env: PluginEnv) {
  if (!value && env.NODE_ENV === "production") throw new Error(`${name} is required in production.`);
  const url = new URL(value || developmentDefault);
  if (env.NODE_ENV === "production" && url.protocol !== "https:") throw new Error(`${name} must use HTTPS in production.`);
  return url.toString().replace(/\/$/, "");
}

function getAllowedBrowserOrigins(env: PluginEnv) {
  const configured = (env.DEEPSPEC_PLUGIN_ALLOWED_ORIGINS || "")
    .split(",")
    .map((value) => value.trim().replace(/\/$/, ""))
    .filter(Boolean);
  if (configured.length) return new Set(configured);
  if (env.NODE_ENV === "production") return new Set<string>();
  return new Set(["http://localhost:3000", "http://localhost:5174", "http://localhost:8787"]);
}

function isPrivateAddress(hostname: string) {
  if (/^127\./.test(hostname) || /^10\./.test(hostname) || /^192\.168\./.test(hostname) || /^169\.254\./.test(hostname)) return true;
  const match = /^172\.(\d{1,3})\./.exec(hostname);
  if (match && Number(match[1]) >= 16 && Number(match[1]) <= 31) return true;
  return hostname === "::1" || hostname === "0.0.0.0" || hostname.endsWith(".internal") || hostname.endsWith(".local");
}

async function assertPublicDns(hostname: string, lookupImpl: typeof dnsLookup) {
  const normalized = normalizeHostname(hostname);
  if (isIP(normalized)) {
    if (isPrivateAddress(normalized) || isPrivateIpv6(normalized)) throw new Error("Private-network image URLs are not allowed.");
    return;
  }
  const addresses = await lookupImpl(normalized, { all: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address) || isPrivateIpv6(address))) {
    throw new Error("The image host resolved to a private network address.");
  }
}

function isPrivateIpv6(address: string) {
  const value = address.toLowerCase();
  const mappedIpv4 = value.startsWith("::ffff:") ? value.slice(7) : null;
  return value === "::" || value === "::1" || value.startsWith("fc") || value.startsWith("fd") || value.startsWith("fe8") || value.startsWith("fe9") || value.startsWith("fea") || value.startsWith("feb") || Boolean(mappedIpv4 && isPrivateAddress(mappedIpv4));
}

function normalizeHostname(hostname: string) {
  const value = hostname.toLowerCase();
  return value.startsWith("[") && value.endsWith("]") ? value.slice(1, -1) : value;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) startPluginServer();
