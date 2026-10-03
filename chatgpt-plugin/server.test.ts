import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createDeepSpecPlugin, createOAuthMetadata, downloadVehicleImage, startPluginServer, validateAccessTokenClaims, validateDownloadUrl } from "./server";
import type { Server } from "node:http";

let server: Server | null = null;
afterEach(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = null;
});

describe("DeepSpec ChatGPT plugin", () => {
  it("publishes the expected OAuth metadata", () => {
    expect(createOAuthMetadata({ SUPABASE_URL: "https://project.supabase.co", DEEPSPEC_PLUGIN_PUBLIC_URL: "https://plugin.deepspec.app" })).toEqual({
      resource: "https://plugin.deepspec.app",
      authorization_servers: ["https://project.supabase.co/auth/v1"],
      scopes_supported: ["openid", "email", "profile"],
      bearer_methods_supported: ["header"],
    });
  });

  it("requires an HTTPS plugin resource in production", () => {
    expect(() => createOAuthMetadata({
      NODE_ENV: "production",
      SUPABASE_URL: "https://project.supabase.co",
      DEEPSPEC_PLUGIN_PUBLIC_URL: "http://plugin.example",
    })).toThrow(/HTTPS/);
  });

  it("validates issuer, audience, lifetime, subject, and scopes", () => {
    const env = {
      SUPABASE_URL: "https://project.supabase.co",
      DEEPSPEC_PLUGIN_PUBLIC_URL: "https://plugin.example",
    };
    const claims = {
      iss: "https://project.supabase.co/auth/v1",
      aud: ["authenticated", "https://plugin.example"],
      sub: "user-123",
      exp: 2_000,
      nbf: 900,
      scope: "openid email profile",
    };
    expect(validateAccessTokenClaims(claims, env, 1_000)).toEqual({
      subject: "user-123",
      scopes: ["openid", "email", "profile"],
    });
    expect(() => validateAccessTokenClaims({ ...claims, iss: "https://attacker.example" }, env, 1_000)).toThrow(/issuer/);
    expect(() => validateAccessTokenClaims({ ...claims, aud: "authenticated" }, env, 1_000)).toThrow(/audience/);
    expect(() => validateAccessTokenClaims({ ...claims, exp: 999 }, env, 1_000)).toThrow(/expired/);
    expect(() => validateAccessTokenClaims({ ...claims, nbf: 1_001 }, env, 1_000)).toThrow(/not active/);
    expect(() => validateAccessTokenClaims({ ...claims, scope: "openid" }, env, 1_000)).toThrow(/missing required scopes/);
  });

  it("rejects non-HTTPS and private-network image URLs", () => {
    expect(() => validateDownloadUrl("http://files.example/image.jpg")).toThrow(/HTTPS/);
    expect(() => validateDownloadUrl("https://127.0.0.1/image.jpg")).toThrow(/Private-network/);
    expect(() => validateDownloadUrl("https://[::1]/image.jpg")).toThrow(/Private-network/);
    expect(() => validateDownloadUrl("https://[fd00::1]/image.jpg")).toThrow(/Private-network/);
    expect(validateDownloadUrl("https://files.openai.com/image.jpg").hostname).toBe("files.openai.com");
  });

  it("enforces image type and size before analysis", async () => {
    const file = { download_url: "https://files.openai.com/image", file_id: "file-1" };
    const publicDns = async () => [{ address: "203.0.113.10", family: 4 }] as never;
    await expect(downloadVehicleImage(file, async () => new Response("text", { headers: { "content-type": "text/plain" } }) as never, publicDns)).rejects.toThrow(/JPEG, PNG, or WebP/);
    await expect(downloadVehicleImage(file, async () => new Response(new Uint8Array(1), { headers: { "content-type": "image/jpeg", "content-length": String(2 * 1024 * 1024 + 1) } }) as never, publicDns)).rejects.toThrow(/2 MB/);
  });

  it("adds top-level OAuth schemes to the actual MCP tool list", async () => {
    const plugin = createDeepSpecPlugin(null, {
      SUPABASE_URL: "https://project.supabase.co",
      SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
    });
    const handlers = Reflect.get(plugin.server, "_requestHandlers") as Map<
      string,
      (request: unknown, extra: unknown) => Promise<{ tools: Array<Record<string, unknown>> }>
    >;
    const listTools = handlers.get("tools/list");
    if (!listTools) throw new Error("tools/list handler was not installed");
    const result = await listTools({ method: "tools/list", params: {} }, {});
    expect(result.tools.find((tool) => tool.name === "analyze_vehicle_image")?.securitySchemes).toEqual([
      { type: "oauth2", scopes: ["openid", "email", "profile"] },
    ]);
  });

  it("serves MCP tools and marks saving as a separate write", async () => {
    server = startPluginServer(0, {
      SUPABASE_URL: "https://project.supabase.co",
      SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
      DEEPSPEC_PLUGIN_PUBLIC_URL: "http://127.0.0.1",
    });
    await new Promise<void>((resolve) => server!.once("listening", () => resolve()));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("test server did not bind");
    const client = new Client({ name: "deepspec-test", version: "0.1.0" });
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${address.port}/mcp`)));
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name)).toEqual(["get_deepspec_profile", "analyze_vehicle_image", "save_deepspec_scan"]);
      expect(tools.tools.find((tool) => tool.name === "analyze_vehicle_image")?.annotations?.readOnlyHint).toBe(true);
      expect(tools.tools.find((tool) => tool.name === "save_deepspec_scan")?.annotations?.readOnlyHint).toBe(false);
      expect(tools.tools.find((tool) => tool.name === "analyze_vehicle_image")?._meta?.["openai/fileParams"]).toEqual(["file"]);
      expect(tools.tools.find((tool) => tool.name === "analyze_vehicle_image")?._meta?.securitySchemes).toEqual([{ type: "oauth2", scopes: ["openid", "email", "profile"] }]);
    } finally {
      await client.close();
    }
  });
});
