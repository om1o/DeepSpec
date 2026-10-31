import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setActiveAccount } from "../lib/accountScope";
import { runAI, sendFollowUpDetails } from "./aiService";

const { getAuthClient } = vi.hoisted(() => ({ getAuthClient: vi.fn() }));
vi.mock("./auth", () => ({ getAuthClient }));

beforeEach(() => {
  vi.stubEnv("VITE_DEEPSPEC_GUEST_PREVIEW", "true");
  setActiveAccount("verified-owner");
  getAuthClient.mockReset().mockResolvedValue({ auth: { getSession: async () => ({ data: { session: { access_token: "synthetic-account-token" } } }) } });
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

it("sends the account token with identify and chat even when an obsolete preview flag remains", async () => {
  const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({ result: { partName: "Mocked provider result" } }), { status: 200 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ message: "Mocked provider follow-up" }), { status: 200 }));
  await expect(runAI({ type: "vision", imageBase64: "data:image/jpeg;base64,dGVzdA==", userMessage: "Identify my part", systemPrompt: "" })).resolves.toMatchObject({ partName: "Mocked provider result" });
  await expect(runAI({ type: "text", userMessage: "Follow-up question", systemPrompt: "" })).resolves.toBe("Mocked provider follow-up");
  expect(fetch.mock.calls.map(([url]) => url)).toEqual(["/api/identify", "/api/chat"]);
  for (const [, init] of fetch.mock.calls) expect(init?.headers).toHaveProperty("Authorization", "Bearer synthetic-account-token");
  expect(getAuthClient).toHaveBeenCalledTimes(2);
});

it("keeps the account token on photo-backed research requests", async () => {
  const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ message: "Mocked research answer" }), { status: 200 }));
  await expect(sendFollowUpDetails({ frame: { imageBase64: "data:image/jpeg;base64,dGVzdA==" }, chatHistory: [] } as never, "Explain the marking", { research: true, sourceUrls: ["https://example.com/reference"] })).resolves.toMatchObject({ message: "Mocked research answer" });
  expect(fetch.mock.calls[0][1]?.headers).toHaveProperty("Authorization", "Bearer synthetic-account-token");
  expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toMatchObject({ imageBase64: "data:image/jpeg;base64,dGVzdA==", research: true, sourceUrls: ["https://example.com/reference"] });
});
