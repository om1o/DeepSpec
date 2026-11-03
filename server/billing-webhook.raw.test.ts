import { createHmac } from "node:crypto";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import handler, { config } from "../api/billing-webhook";

const supabaseMock = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("@supabase/supabase-js", () => supabaseMock);

const webhookSecret = "whsec_synthetic_raw_body_fixture";
const rpc = vi.fn();
const rawBody = JSON.stringify({
  id: "evt_synthetic_raw_body",
  type: "checkout.session.completed",
  livemode: false,
  data: {
    object: {
      id: "cs_synthetic_raw_body",
      object: "checkout.session",
      mode: "payment",
      payment_status: "paid",
      customer: "cus_synthetic_raw_body",
      metadata: {
        deepspec_plan_id: "scan_pack",
        supabase_user_id: "11111111-1111-4111-8111-111111111111",
        description: "Café € 🔧 日本語",
      },
    },
  },
});

function signature(body: string) {
  const timestamp = Math.floor(Date.now() / 1000);
  const digest = createHmac("sha256", webhookSecret).update(`${timestamp}.${body}`).digest("hex");
  return `t=${timestamp},v1=${digest}`;
}

// Every continuation byte starts a new chunk, splitting two-, three-, and four-byte characters.
function fragmentedUtf8(bytes: Buffer) {
  const chunks: Buffer[] = [];
  let start = 0;
  for (let index = 1; index < bytes.length; index += 1) {
    if ((bytes[index] & 0xc0) === 0x80) {
      chunks.push(bytes.subarray(start, index));
      start = index;
    }
  }
  chunks.push(bytes.subarray(start));
  return chunks;
}

function createResponse() {
  const response = {
    status: vi.fn(),
    json: vi.fn(),
    setHeader: vi.fn(),
  };
  response.status.mockReturnValue(response);
  return response;
}

function expectFulfilled(response: ReturnType<typeof createResponse>) {
  expect(response.status).toHaveBeenCalledWith(200);
  expect(response.json).toHaveBeenCalledWith({
    eventType: "checkout.session.completed",
    handled: true,
    received: true,
  });
  expect(rpc).toHaveBeenCalledExactlyOnceWith("apply_billing_purchase", expect.objectContaining({
    p_additive: true,
    p_billing_provider: "stripe",
    p_event_key: "cs_synthetic_raw_body",
    p_status: "active",
    p_user_id: "11111111-1111-4111-8111-111111111111",
  }));
  expect(fetch).not.toHaveBeenCalled();
}

describe("billing webhook raw UTF-8 body", () => {
  beforeEach(() => {
    vi.stubEnv("BILLING_PROVIDER", "stripe");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", webhookSecret);
    vi.stubEnv("SUPABASE_URL", "https://synthetic-billing.supabase.test");
    vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_synthetic_raw_body_fixture");
    vi.stubEnv("DEEPSPEC_ENABLE_LIVE_BILLING", "false");
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("Unexpected network request"); }));
    rpc.mockResolvedValue({ data: true, error: null });
    supabaseMock.createClient.mockReturnValue({ rpc });
  });

  afterEach(() => {
    rpc.mockReset();
    supabaseMock.createClient.mockReset();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it.each(["string", "Buffer"] as const)("verifies an intact signed Unicode %s body", async (bodyType) => {
    const response = createResponse();
    await handler({
      method: "POST",
      headers: { "stripe-signature": signature(rawBody) },
      body: bodyType === "string" ? rawBody : Buffer.from(rawBody, "utf8"),
    }, response);

    expectFulfilled(response);
  });

  it("verifies signed Unicode bytes split inside UTF-8 characters across stream chunks", async () => {
    const chunks = fragmentedUtf8(Buffer.from(rawBody, "utf8"));
    expect(Buffer.concat(chunks).toString("utf8")).toBe(rawBody);
    expect(chunks.map((chunk) => chunk.toString("utf8")).join("")).not.toBe(rawBody);
    expect(config.api.bodyParser).toBe(false);
    const request = Object.assign(Readable.from(chunks), {
      method: "POST",
      headers: { "stripe-signature": signature(rawBody) },
    });
    const response = createResponse();

    await handler(request, response);

    expectFulfilled(response);
  });

  it("rejects a changed body byte before any entitlement write", async () => {
    const bytes = Buffer.from(rawBody, "utf8");
    const changedByte = bytes.indexOf(Buffer.from("Café", "utf8"));
    expect(changedByte).toBeGreaterThanOrEqual(0);
    bytes[changedByte] ^= 1;
    const request = Object.assign(Readable.from(fragmentedUtf8(bytes)), {
      method: "POST",
      headers: { "stripe-signature": signature(rawBody) },
    });
    const response = createResponse();

    await handler(request, response);

    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      error: expect.objectContaining({ code: "invalid_signature" }),
    }));
    expect(supabaseMock.createClient).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
});
