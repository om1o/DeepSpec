import { execFileSync } from "node:child_process";
import { expect, it } from "vitest";

it("Vite retains session, credit and chat gates even with obsolete guest flags", () => {
  // Exercise the native config in Node, as Vite does. Its Tailwind loader uses
  // dynamic import from Function, which the Vitest module VM cannot execute.
  const output = execFileSync(process.execPath, ["--input-type=module", "-e", `
    import assert from "node:assert/strict";
    import { Readable } from "node:stream";
    import configExport from "./vite.config.ts";
    const calls = {};
    const record = (name, result) => async (...args) => {
      (calls[name] ??= []).push(args);
      return typeof result === "function" ? result(...args) : result;
    };
    const modules = {
      enforceRateLimit: record("limit", { ok: true }),
      requireSession: record("auth", { ok: false, status: 401, body: { error: { code: "invalid_session" } } }),
      reserveScanCredit: record("credit", { ok: false, error: { status: 402, body: { error: { code: "scan_limit_reached" } } } }),
      consumeReservedScanCredit: record("finalize"),
      validateIdentifyRequest: () => undefined,
      createIdentifyResponse: record("identify"),
      createChatResponse: record("chat", { status: 503, body: { error: { code: "feature_disabled" } } }),
      isChatEnabled: () => true,
    };
    const config = await configExport({ command: "serve", mode: "test" });
    const plugin = config.plugins.flat(10).find(entry => entry?.name === "deep-spec-api");
    const routes = new Map();
    plugin.configureServer({
      middlewares: { use: (route, handler) => routes.set(route, handler) },
      ssrLoadModule: async () => modules,
    });
    const run = async path => {
      for (const key of Object.keys(calls)) delete calls[key];
      const req = Object.assign(Readable.from([JSON.stringify({ imageBase64: "data:image/jpeg;base64,aGVsbG8=", userMessage: "What next?" })]), { method: "POST", headers: { authorization: "Bearer synthetic-session" } });
      const res = { statusCode: 200, setHeader() {}, end(body) { this.body = JSON.parse(body); } };
      await routes.get(path)(req, res);
      return res;
    };
    for (const path of ["/api/identify", "/api/chat"]) {
      const res = await run(path);
      assert.equal(res.statusCode, 401);
      assert.equal(res.body.error.code, "invalid_session");
      assert.equal(calls.auth.length, 1);
      assert.equal(calls.auth[0][0].authorization, "Bearer synthetic-session");
      assert.equal(calls.auth[0][1].DEEPSPEC_GUEST_PREVIEW, "true");
      assert.equal(calls.identify, undefined);
      assert.equal(calls.chat, undefined);
      assert.equal(calls.credit, undefined);
    }
    modules.requireSession = record("auth", { ok: true });
    const exhausted = await run("/api/identify");
    assert.equal(exhausted.statusCode, 402);
    assert.equal(calls.auth.length, 1);
    assert.equal(calls.credit.length, 1);
    assert.equal(calls.identify, undefined);
    assert.equal(calls.finalize, undefined);
    modules.isChatEnabled = (env) => env.DEEPSPEC_ENABLE_CHAT === "true";
    const disabled = await run("/api/chat");
    assert.equal(disabled.statusCode, 503);
    assert.equal(calls.chat[0][0], undefined);
    assert.equal(calls.chat[0][1].DEEPSPEC_ENABLE_CHAT, "false");
    assert.equal(calls.limit, undefined);
    assert.equal(calls.auth, undefined);
    console.log("4 Vite middleware gate scenarios passed");
  `], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, DEEPSPEC_GUEST_PREVIEW: "true", VERCEL_ENV: "preview", DEEPSPEC_ENABLE_CHAT: "false" },
    timeout: 10_000,
  });
  expect(output).toContain("4 Vite middleware gate scenarios passed");
});
