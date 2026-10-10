import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import accountEntitlement from "../api/account-entitlement";
import billingCheckout from "../api/billing-checkout";
import billingPortal from "../api/billing-portal";
import billingWebhook from "../api/billing-webhook";
import chat from "../api/chat";
import identify from "../api/identify";

const endpoints = [
  { name: "account-entitlement", handler: accountEntitlement },
  { name: "billing-checkout", handler: billingCheckout },
  { name: "billing-portal", handler: billingPortal },
  { name: "billing-webhook", handler: billingWebhook },
  { name: "chat", handler: chat },
  { name: "identify", handler: identify },
];

describe("Vercel Hobby deployment layout", () => {
  it("routes client-side paths to the SPA without intercepting API functions", () => {
    const config = JSON.parse(readFileSync(resolve(process.cwd(), "vercel.json"), "utf8"));

    expect(config.rewrites).toEqual([
      { source: "/((?!api/).*)", destination: "/index.html" },
    ]);
  });

  it("keeps only HTTP entry points in api, within the 12-function limit", () => {
    // Vercel discovers files in api as functions, including helpers and tests.
    const files = readdirSync(resolve(process.cwd(), "api"), { recursive: true });
    expect(files.sort()).toEqual(endpoints.map(({ name }) => `${name}.ts`).sort());
    expect(files.length).toBeLessThanOrEqual(12);
  });

  it.each(endpoints)("loads /api/$name and preserves its method guard", async ({ handler }) => {
    const response = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
      setHeader: vi.fn(),
    };

    await handler({ method: "OPTIONS" }, response);

    expect(response.status).toHaveBeenCalledWith(405);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      error: expect.objectContaining({ code: "method_not_allowed" }),
    }));
    expect(response.setHeader).toHaveBeenCalledWith("Cache-Control", "no-store");
  });
});
