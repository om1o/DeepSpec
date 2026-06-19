import react from "@vitejs/plugin-react";
import type { IncomingMessage, ServerResponse } from "node:http";
import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";
import type { PreviewServer, ViteDevServer } from "vite";
import { VitePWA } from "vite-plugin-pwa";

type TailwindViteModule = typeof import("@tailwindcss/vite");
const importTailwindcss = () => Function('return import("@tailwindcss/vite")')() as Promise<TailwindViteModule>;

export default defineConfig(async ({ mode }) => {
  const { default: tailwindcss } = await importTailwindcss();
  const env = loadEnv(mode, process.cwd(), "");
  const serverEnv = {
    ...process.env,
    ...env,
  };

  return {
    plugins: [
      react(),
      tailwindcss(),
      {
        name: "deep-spec-api",
        configurePreviewServer(server: PreviewServer) {
          registerPreviewMethodGuard(server, "/api/identify", "Use POST for AI identification.");
          registerPreviewMethodGuard(server, "/api/chat", "Use POST for AI follow-up chat.");
          registerPreviewMethodGuard(server, "/api/billing-checkout", "Use POST to start DeepSpec checkout.");
          registerPreviewMethodGuard(server, "/api/billing-portal", "Use POST to open DeepSpec billing.");
          registerPreviewMethodGuard(server, "/api/billing-webhook", "Use POST for billing provider webhooks.");
          registerPreviewMethodGuard(server, "/api/account-entitlement", "Use GET to verify DeepSpec account access.", "GET");
        },
        configureServer(server: ViteDevServer) {
          server.middlewares.use("/api/identify", async (request: IncomingMessage, response: ServerResponse) => {
            response.setHeader("Cache-Control", "no-store");

            if (request.method !== "POST") {
              response.statusCode = 405;
              response.setHeader("Content-Type", "application/json");
              response.end(JSON.stringify({ error: { code: "method_not_allowed", message: "Use POST for AI identification." } }));
              return;
            }

            const body = await readJsonBody(request).catch(() => null);
            const { createIdentifyResponse } = (await server.ssrLoadModule("/api/identify.shared.ts")) as typeof import("./api/identify.shared");
            const { consumeReservedScanCredit, reserveScanCredit } = (await server.ssrLoadModule("/api/billing.shared.ts")) as typeof import("./api/billing.shared");
            const reservation = await reserveScanCredit(request.headers, serverEnv);
            if (!reservation.ok) {
              response.statusCode = reservation.error.status;
              response.setHeader("Content-Type", "application/json");
              response.end(JSON.stringify(reservation.error.body));
              return;
            }
            const result = await createIdentifyResponse(body, serverEnv);
            if (result.status === 200) {
              await consumeReservedScanCredit(reservation, serverEnv);
            }
            response.statusCode = result.status;
            response.setHeader("Content-Type", "application/json");
            response.end(JSON.stringify(result.body));
          });

          server.middlewares.use("/api/chat", async (request: IncomingMessage, response: ServerResponse) => {
            response.setHeader("Cache-Control", "no-store");

            if (request.method !== "POST") {
              response.statusCode = 405;
              response.setHeader("Content-Type", "application/json");
              response.end(JSON.stringify({ error: { code: "method_not_allowed", message: "Use POST for AI follow-up chat." } }));
              return;
            }

            const body = await readJsonBody(request).catch(() => null);
            const { createChatResponse } = (await server.ssrLoadModule("/api/chat.shared.ts")) as typeof import("./api/chat.shared");
            const result = await createChatResponse(body, serverEnv);
            response.statusCode = result.status;
            response.setHeader("Content-Type", "application/json");
            response.end(JSON.stringify(result.body));
          });

          server.middlewares.use("/api/billing-checkout", async (request: IncomingMessage, response: ServerResponse) => {
            response.setHeader("Cache-Control", "no-store");

            if (request.method !== "POST") {
              response.statusCode = 405;
              response.setHeader("Content-Type", "application/json");
              response.end(JSON.stringify({ error: { code: "method_not_allowed", message: "Use POST to start DeepSpec checkout." } }));
              return;
            }

            const body = await readJsonBody(request).catch(() => null);
            const { createCheckoutResponse } = (await server.ssrLoadModule("/api/billing.shared.ts")) as typeof import("./api/billing.shared");
            const result = await createCheckoutResponse(body, serverEnv, request.headers);
            response.statusCode = result.status;
            response.setHeader("Content-Type", "application/json");
            response.end(JSON.stringify(result.body));
          });

          server.middlewares.use("/api/billing-portal", async (request: IncomingMessage, response: ServerResponse) => {
            response.setHeader("Cache-Control", "no-store");

            if (request.method !== "POST") {
              response.statusCode = 405;
              response.setHeader("Content-Type", "application/json");
              response.end(JSON.stringify({ error: { code: "method_not_allowed", message: "Use POST to open DeepSpec billing." } }));
              return;
            }

            const body = await readJsonBody(request).catch(() => null);
            const { createPortalResponse } = (await server.ssrLoadModule("/api/billing.shared.ts")) as typeof import("./api/billing.shared");
            const result = await createPortalResponse(body, serverEnv);
            response.statusCode = result.status;
            response.setHeader("Content-Type", "application/json");
            response.end(JSON.stringify(result.body));
          });

          server.middlewares.use("/api/billing-webhook", async (request: IncomingMessage, response: ServerResponse) => {
            response.setHeader("Cache-Control", "no-store");

            if (request.method !== "POST") {
              response.statusCode = 405;
              response.setHeader("Content-Type", "application/json");
              response.end(JSON.stringify({ error: { code: "method_not_allowed", message: "Use POST for billing provider webhooks." } }));
              return;
            }

            const rawBody = await readRawBody(request).catch(() => "");
            const { createWebhookResponse } = (await server.ssrLoadModule("/api/billing.shared.ts")) as typeof import("./api/billing.shared");
            const result = await createWebhookResponse(rawBody, request.headers, serverEnv);
            response.statusCode = result.status;
            response.setHeader("Content-Type", "application/json");
            response.end(JSON.stringify(result.body));
          });

          server.middlewares.use("/api/account-entitlement", async (request: IncomingMessage, response: ServerResponse) => {
            response.setHeader("Cache-Control", "no-store");

            if (request.method !== "GET") {
              response.statusCode = 405;
              response.setHeader("Content-Type", "application/json");
              response.end(JSON.stringify({ error: { code: "method_not_allowed", message: "Use GET to verify DeepSpec account access." } }));
              return;
            }

            const { createAccountEntitlementResponse } = (await server.ssrLoadModule("/api/billing.shared.ts")) as typeof import("./api/billing.shared");
            const result = await createAccountEntitlementResponse(request.headers, serverEnv);
            response.statusCode = result.status;
            response.setHeader("Content-Type", "application/json");
            response.end(JSON.stringify(result.body));
          });
        },
      },
      VitePWA({
        registerType: "autoUpdate",
        includeAssets: ["icon-192.png", "icon-512.png", "brand/deepspec-logo.webp"],
        manifest: {
          name: "Deep Spec",
          short_name: "Deep Spec",
          description: "Know what you're looking at.",
          theme_color: "#04070E",
          background_color: "#04070E",
          display: "standalone",
          orientation: "portrait",
          start_url: "/",
          scope: "/",
          icons: [
            {
              src: "/icon-192.png",
              sizes: "192x192",
              type: "image/png",
              purpose: "any maskable",
            },
            {
              src: "/icon-512.png",
              sizes: "512x512",
              type: "image/png",
              purpose: "any maskable",
            },
          ],
        },
        workbox: {
          globPatterns: ["**/*.{js,css,html,png,svg,ico,webp}"],
          // The transformers.js chunk (~540KB) backs the optional on-device
          // fallback (VITE_ENABLE_ON_DEVICE_FALLBACK). Keep it out of the
          // install-time precache; it loads on demand when the feature runs.
          // The logo PNG stays only for social-share/og:image tags; the app
          // itself uses the precached WebP.
          globIgnores: ["**/transformers.web-*.js", "**/brand/deepspec-logo.png"],
        },
        devOptions: {
          enabled: false,
        },
      }),
    ],
    test: {
      environment: "jsdom",
      globals: true,
      setupFiles: "./src/test/setup.ts",
      testTimeout: 15_000,
    },
    server: {
      allowedHosts: [".trycloudflare.com"],
      host: "0.0.0.0",
      port: 5174,
      strictPort: false,
      watch: {
        ignored: ["**/artifacts/**"],
      },
    },
    preview: {
      allowedHosts: [".trycloudflare.com"],
      host: "0.0.0.0",
      port: 4174,
      strictPort: false,
    },
  };
});

async function readJsonBody(request: IncomingMessage) {
  const rawBody = await readRawBody(request);
  return rawBody ? JSON.parse(rawBody) : null;
}

async function readRawBody(request: IncomingMessage) {
  let rawBody = "";

  for await (const chunk of request) {
    rawBody += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
  }

  return rawBody;
}

function registerPreviewMethodGuard(server: PreviewServer, path: string, message: string, allowedMethod = "POST") {
  server.middlewares.use(path, (request: IncomingMessage, response: ServerResponse) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Content-Type", "application/json");

    if (request.method !== allowedMethod) {
      response.statusCode = 405;
      response.end(JSON.stringify({ error: { code: "method_not_allowed", message } }));
      return;
    }

    response.statusCode = 501;
    response.end(JSON.stringify({
      error: {
        code: "preview_api_unavailable",
        message: "Run `npm run dev` or deploy the serverless API to analyze scans.",
      },
    }));
  });
}
