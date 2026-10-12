import { describe, expect, it } from "vitest";
import { getQaScanAccess } from "./qaScanAccess.shared";

const now = Date.parse("2026-10-12T12:00:00Z");
const user = { id: "qa-owner", email_confirmed_at: "2026-10-01", app_metadata: { deepspec_scan_qa: true } };
const env = { NODE_ENV: "development", DEEPSPEC_ENFORCE_SCAN_CREDITS: "false", DEEPSPEC_QA_SCAN_USER_ID: user.id, DEEPSPEC_QA_SCAN_EXPIRES_AT: "2026-10-12T13:00:00Z" };

describe("scoped non-production QA scan access", () => {
  it.each([
    { NODE_ENV: "development" },
    { NODE_ENV: "test" },
    { NODE_ENV: "production", VERCEL_ENV: "preview" },
  ])("accepts explicit non-production environments: %j", (runtime) => {
    expect(getQaScanAccess(user, { ...env, ...runtime }, now)).toEqual({ mode: "non-production", expiresAt: env.DEEPSPEC_QA_SCAN_EXPIRES_AT, userId: user.id });
  });
  it.each([
    { NODE_ENV: "production" },
    { VERCEL_ENV: "production" },
    { NODE_ENV: "production", VERCEL_ENV: "production" },
    { NODE_ENV: undefined },
    { NODE_ENV: "staging" },
    { VERCEL_ENV: "unknown" },
    { NODE_ENV: "production", VERCEL_ENV: "development" },
    { DEEPSPEC_ENFORCE_SCAN_CREDITS: undefined },
    { DEEPSPEC_ENFORCE_SCAN_CREDITS: "true" },
    { DEEPSPEC_QA_SCAN_USER_ID: "other-user" },
    { DEEPSPEC_QA_SCAN_USER_ID: "" },
    { DEEPSPEC_QA_SCAN_EXPIRES_AT: "2026-10-12T12:00:00Z" },
    { DEEPSPEC_QA_SCAN_EXPIRES_AT: "2026-10-11T12:00:00Z" },
    { DEEPSPEC_QA_SCAN_EXPIRES_AT: "2026-10-13T12:00:01Z" },
    { DEEPSPEC_QA_SCAN_EXPIRES_AT: "tomorrow" },
    { DEEPSPEC_QA_SCAN_EXPIRES_AT: "2026-10-12" },
    { DEEPSPEC_QA_SCAN_EXPIRES_AT: "2026-99-99T13:00:00Z" },
    { DEEPSPEC_QA_SCAN_EXPIRES_AT: undefined },
  ])("fails closed for production, unknown, incomplete or expired configuration: %j", (override) => {
    expect(getQaScanAccess(user, { ...env, ...override }, now)).toBeUndefined();
  });
  it.each([
    { is_anonymous: true },
    { email_confirmed_at: undefined },
    { app_metadata: {} },
    { app_metadata: { deepspec_scan_qa: "true" } },
    { app_metadata: {}, user_metadata: { deepspec_scan_qa: true } },
  ])("rejects unverified and self-marked users: %j", (override) => {
    expect(getQaScanAccess({ ...user, ...override }, env, now)).toBeUndefined();
  });
});
