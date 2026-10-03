import assert from "node:assert/strict";
import test from "node:test";
import { evaluateIndexingHeader } from "./verify-deployment-indexing.mjs";

test("production must not be noindex", () => {
  assert.equal(evaluateIndexingHeader(null, true), null);
  assert.match(evaluateIndexingHeader("noindex", true), /Production/);
});

test("preview must be noindex", () => {
  assert.equal(evaluateIndexingHeader("noindex", false), null);
  assert.match(evaluateIndexingHeader(null, false), /Preview/);
});
