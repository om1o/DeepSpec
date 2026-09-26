import { createServer as createHttpServer } from "node:http";
import { createReadStream, existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import { basename, extname, join, normalize, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { createServer as createViteServer } from "vite";
import { loadQaEnv } from "./qa-utils.mjs";

loadQaEnv();

const rootDir = process.cwd();
const distDir = resolve(rootDir, "dist");
const defaultPort = Number.parseInt(process.env.PORT ?? "5175", 10);

const apiModules = new Map([
  ["/api/account-entitlement", "/api/account-entitlement.ts"],
  ["/api/billing-checkout", "/api/billing-checkout.ts"],
  ["/api/billing-portal", "/api/billing-portal.ts"],
  ["/api/billing-webhook", "/api/billing-webhook.ts"],
  ["/api/chat", "/api/chat.ts"],
  ["/api/identify", "/api/identify.ts"],
]);

const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml; charset=utf-8"],
  [".txt", "text/plain; charset=utf-8"],
  [".wasm", "application/wasm"],
  [".webmanifest", "application/manifest+json; charset=utf-8"],
  [".webp", "image/webp"],
]);

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}

export async function main() {
  if (!existsSync(distDir)) {
    throw new Error("Missing dist/. Run `npm run build` before `npm run qa:serve-production`.");
  }

  const vite = await createViteServer({
    appType: "custom",
    clearScreen: false,
    logLevel: "error",
    root: rootDir,
    server: {
      middlewareMode: true,
    },
  });

  const server = createHttpServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);
      if (apiModules.has(requestUrl.pathname)) {
        await handleApiRequest(vite, request, response, requestUrl.pathname);
        return;
      }

      await handleStaticRequest(requestUrl, response);
    } catch (error) {
      console.error(error);
      if (!response.headersSent) {
        response.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
      }
      response.end(JSON.stringify({ error: { code: "server_error", message: "QA production server failed." } }));
    }
  });

  const port = Number.isFinite(defaultPort) ? defaultPort : 5175;
  await new Promise((resolveListen) => server.listen(port, "127.0.0.1", resolveListen));
  console.log(`DeepSpec QA production server listening at http://127.0.0.1:${port}`);

  const close = async () => {
    await new Promise((resolveClose) => server.close(resolveClose));
    await vite.close();
  };

  process.once("SIGINT", async () => {
    await close();
    process.exit(0);
  });
  process.once("SIGTERM", async () => {
    await close();
    process.exit(0);
  });
}

async function handleApiRequest(vite, request, response, pathname) {
  const modulePath = apiModules.get(pathname);
  const module = await vite.ssrLoadModule(modulePath);
  const body = await readRequestBody(request);
  let statusCode = 200;

  const vercelResponse = {
    status(nextStatusCode) {
      statusCode = nextStatusCode;
      return vercelResponse;
    },
    setHeader(name, value) {
      response.setHeader(name, value);
    },
    json(payload) {
      if (!response.headersSent) {
        response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
      }
      response.end(JSON.stringify(payload));
    },
  };

  await module.default(
    {
      body: parseRequestBody(body, request.headers["content-type"]),
      headers: request.headers,
      method: request.method,
      query: Object.fromEntries(new URL(request.url ?? "/", "http://127.0.0.1").searchParams),
    },
    vercelResponse,
  );
}

async function handleStaticRequest(requestUrl, response) {
  const staticFile = await resolveStaticFile(requestUrl.pathname);
  const fileStats = await stat(staticFile);
  response.writeHead(200, {
    "Cache-Control": basename(staticFile) === "index.html" ? "no-store" : "public, max-age=31536000, immutable",
    "Content-Length": fileStats.size,
    "Content-Type": contentTypes.get(extname(staticFile)) ?? "application/octet-stream",
  });
  createReadStream(staticFile).pipe(response);
}

export async function resolveStaticFile(pathname) {
  const cleanedPath = normalize(decodeURIComponent(pathname.split("?")[0] ?? "/")).replace(/^([/\\])+/, "");
  const candidate = resolve(distDir, cleanedPath);
  const safeDistPrefix = distDir.endsWith(sep) ? distDir : `${distDir}${sep}`;
  if (candidate !== distDir && !candidate.startsWith(safeDistPrefix)) {
    return join(distDir, "index.html");
  }

  try {
    const candidateStats = await stat(candidate);
    if (candidateStats.isFile()) {
      return candidate;
    }
  } catch {
    // Fall through to SPA fallback.
  }

  return join(distDir, "index.html");
}

async function readRequestBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function parseRequestBody(rawBody, contentType) {
  if (!rawBody) {
    return undefined;
  }

  if (String(contentType ?? "").includes("application/json")) {
    try {
      return JSON.parse(rawBody);
    } catch {
      return rawBody;
    }
  }

  return rawBody;
}
