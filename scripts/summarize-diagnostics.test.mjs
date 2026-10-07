import { summarizeDiagnostics } from "./summarize-diagnostics.mjs";
import { describe, expect, it } from "vitest";

const event = {
  schema: 1, eventId: "11111111-1111-4111-8111-111111111111", occurredAt: "2026-09-29T00:00:00.000Z",
  release: "unknown", stage: "identify", code: "not_configured", status: 500, durationMs: 12,
};
const line = (value) => `[DeepSpec diagnostics] ${JSON.stringify(value)}`;

describe("private operator diagnostics summary", () => {
  it("counts final requests once and lists a synthetic failure for review", () => {
    const success = { ...event, eventId: "22222222-2222-4222-8222-222222222222", code: "ok", status: 200, durationMs: 20 };
    expect(summarizeDiagnostics([line(event), line(event), `timestamp ${line(success)}`].join("\n"))).toMatchObject({
      requests: 2, failures: 1, successes: 1, duplicates: 1, rejected: 0,
      byCode: { not_configured: 1, ok: 1 }, medianDurationMs: 16, recentFailures: [event],
    });
  });

  it("never echoes raw logs, extra fields, unknown codes or injected release text", () => {
    const secret = "Bearer sensitive-token";
    const input = [secret, line({ ...event, photo: secret }), line({ ...event, code: secret }),
      line({ ...event, release: secret }), "[DeepSpec diagnostics] broken-json"].join("\n");
    const summary = summarizeDiagnostics(input);
    expect(summary).toMatchObject({ requests: 0, rejected: 4, medianDurationMs: null });
    expect(JSON.stringify(summary)).not.toContain(secret);
  });

  it("rejects mismatched status, malformed IDs and unbounded timings", () => {
    const input = [line({ ...event, status: 200 }), line({ ...event, eventId: "user@example.com" }),
      line({ ...event, durationMs: -1 }), line({ ...event, durationMs: 3_600_001 }),
      line({ ...event, occurredAt: "not a date" })].join("\n");
    expect(summarizeDiagnostics(input)).toMatchObject({ requests: 0, rejected: 5 });
  });

  it("refuses conflicting duplicate IDs instead of hiding disagreement", () => {
    expect(() => summarizeDiagnostics(`${line(event)}\n${line({ ...event, durationMs: 13 })}`)).toThrow("Conflicting duplicate");
  });

  it("bounds input and the incident list", () => {
    expect(() => summarizeDiagnostics("x".repeat(10 * 1024 * 1024 + 1))).toThrow("10 MiB");
    const events = Array.from({ length: 25 }, (_, index) => line({ ...event, eventId: `${String(index).padStart(8, "0")}-1111-4111-8111-111111111111` }));
    expect(summarizeDiagnostics(events.join("\n")).recentFailures).toHaveLength(20);
  });
});
