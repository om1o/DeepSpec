import { execFileSync } from "node:child_process";
import { expect, it } from "vitest";

it("passes authorization headers through the Vite billing portal wrapper", () => {
  const output = execFileSync(process.execPath, ["--input-type=module", "-e", `
    import assert from "node:assert/strict";
    import { Readable } from "node:stream";
    import configExport from "./vite.config.ts";

    const calls = [];
    const modules = {
      createPortalResponse: async (...args) => {
        calls.push(args);
        return { status: 200, body: { url: "https://billing.example/portal" } };
      },
    };
    const config = await configExport({ command: "serve", mode: "test" });
    const plugin = config.plugins.flat(10).find(entry => entry?.name === "deep-spec-api");
    const routes = new Map();
    plugin.configureServer({
      middlewares: { use: (route, handler) => routes.set(route, handler) },
      ssrLoadModule: async () => modules,
    });
    const request = Object.assign(Readable.from(["{}"]), {
      method: "POST",
      headers: { authorization: "Bearer synthetic-session" },
    });
    const response = {
      statusCode: 200,
      setHeader() {},
      end(body) { this.body = JSON.parse(body); },
    };
    await routes.get("/api/billing-portal")(request, response);
    assert.equal(response.statusCode, 200);
    assert.equal(calls.length, 1);
    assert.equal(calls[0][2].authorization, "Bearer synthetic-session");
    console.log("Vite billing portal header parity passed");
  `], {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: 10_000,
  });

  expect(output).toContain("Vite billing portal header parity passed");
});
