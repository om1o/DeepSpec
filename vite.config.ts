import react from "@vitejs/plugin-react";
import type { IncomingMessage, ServerResponse } from "node:http";
import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";
import type { ViteDevServer } from "vite";
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
            const result = await createIdentifyResponse(body, serverEnv);
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
        },
      },
      VitePWA({
        registerType: "autoUpdate",
        includeAssets: ["icon-192.png", "icon-512.png", "brand/deepspec-logo.png"],
        manifest: {
          name: "Deep Spec",
          short_name: "Deep Spec",
          description: "Know what you're looking at.",
          theme_color: "#08111F",
          background_color: "#F6F8FB",
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
          globPatterns: ["**/*.{js,css,html,png,svg,ico}"],
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
    },
  };
});

async function readJsonBody(request: IncomingMessage) {
  let rawBody = "";

  for await (const chunk of request) {
    rawBody += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
  }

  return rawBody ? JSON.parse(rawBody) : null;
}
