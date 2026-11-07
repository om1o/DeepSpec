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

it("preserves signed Unicode bytes through the Vite billing webhook stream wrapper", () => {
  const output = execFileSync(process.execPath, ["--input-type=module", "-e", `
    import assert from "node:assert/strict";
    import { createHmac } from "node:crypto";
    import { Readable } from "node:stream";
    import configExport from "./vite.config.ts";

    const rawBody = JSON.stringify({
      type: "checkout.session.completed",
      data: { object: { metadata: { description: "Café € 🔧 日本語" } } },
    });
    const secret = "whsec_synthetic_vite_raw_body";
    const timestamp = Math.floor(Date.now() / 1000);
    const digest = createHmac("sha256", secret).update(timestamp + "." + rawBody).digest("hex");
    const signature = "t=" + timestamp + ",v1=" + digest;
    const bytes = Buffer.from(rawBody, "utf8");
    const chunks = [];
    let start = 0;
    for (let index = 1; index < bytes.length; index += 1) {
      if ((bytes[index] & 0xc0) === 0x80) {
        chunks.push(bytes.subarray(start, index));
        start = index;
      }
    }
    chunks.push(bytes.subarray(start));
    assert.equal(Buffer.concat(chunks).toString("utf8"), rawBody);
    assert.notEqual(chunks.map(chunk => chunk.toString("utf8")).join(""), rawBody);

    const calls = [];
    const modules = {
      createWebhookResponse: async (...args) => {
        calls.push(args);
        assert.equal(args[0], rawBody);
        assert.equal(args[1]["stripe-signature"], signature);
        assert.equal(createHmac("sha256", secret).update(timestamp + "." + args[0]).digest("hex"), digest);
        return { status: 200, body: { eventType: "checkout.session.completed", handled: true, received: true } };
      },
    };
    const config = await configExport({ command: "serve", mode: "test" });
    const plugin = config.plugins.flat(10).find(entry => entry?.name === "deep-spec-api");
    const routes = new Map();
    plugin.configureServer({
      middlewares: { use: (route, handler) => routes.set(route, handler) },
      ssrLoadModule: async () => modules,
    });
    const request = Object.assign(Readable.from(chunks), {
      method: "POST",
      headers: { "stripe-signature": signature, "content-type": "application/json" },
    });
    const response = {
      statusCode: 200,
      setHeader() {},
      end(body) { this.body = JSON.parse(body); },
    };
    await routes.get("/api/billing-webhook")(request, response);
    assert.equal(response.statusCode, 200);
    assert.equal(calls.length, 1);
    assert.deepEqual(response.body, { eventType: "checkout.session.completed", handled: true, received: true });
    console.log("Vite billing webhook Unicode parity passed");
  `], {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: 10_000,
  });

  expect(output).toContain("Vite billing webhook Unicode parity passed");
});
