import { expect, it } from "vitest";
import { assertPrivateStorageDenied } from "./storage-access-check.mjs";

it.each([
  { statusCode: "400", message: "Object not found" },
  { status: 403, message: "Access denied" },
  { status: 404, message: "Object not found" },
])("accepts an explicit private-object denial: %j", (error) => {
  expect(() => assertPrivateStorageDenied({ error })).not.toThrow();
});

it("fails when another account receives the image", () => {
  expect(() => assertPrivateStorageDenied({ data: new Blob(["image"]), error: null })).toThrow(/could download/i);
});

it.each([
  { status: 500, message: "Object not found" },
  { status: 401, message: "Expired token" },
  { status: 400, message: "Invalid request" },
  { message: "fetch failed" },
])("does not turn an infrastructure or auth failure into an isolation pass: %j", (error) => {
  expect(() => assertPrivateStorageDenied({ error })).toThrow(/inconclusive/i);
});
