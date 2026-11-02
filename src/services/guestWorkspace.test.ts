import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setActiveGuestPreview } from "../lib/accountScope";
import { runAI } from "./aiService";
import { readCloudLookups } from "./cloudHistory";
import { getCloudSyncStatus, syncAnalysisFailuresToCloud, syncFeedbackToCloud, syncLookupToCloud, syncLookupsToCloud, syncWaitlistSignupToCloud, verifyCloudHealth } from "./cloudSync";
import { loadTrainingConsent, saveTrainingConsent } from "./trainingConsent";

const { getAuthClient } = vi.hoisted(() => ({ getAuthClient: vi.fn() }));
vi.mock("./auth", () => ({ getAuthClient, isSupabaseAuthConfigured: () => true }));

beforeEach(() => {
  vi.stubEnv("VITE_DEEPSPEC_GUEST_PREVIEW", "true");
  vi.stubEnv("VITE_SUPABASE_URL", "https://configured.supabase.co");
  vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
  getAuthClient.mockReset().mockResolvedValue({ auth: { getSession: async () => ({ data: { session: { access_token: "existing-private-account-token" } } }) } });
  setActiveGuestPreview();
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

it("sends actual identify/chat payloads without acquiring or sending an existing account token", async () => {
  localStorage.setItem("sb-existing-auth-token", "private session unchanged");
  const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({ result: { partName: "Provider result" } }), { status: 200 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ message: "Provider follow-up answer" }), { status: 200 }));
  await expect(runAI({ type: "vision", imageBase64: "data:image/jpeg;base64,user-photo", userMessage: "Identify my part", systemPrompt: "" })).resolves.toMatchObject({ partName: "Provider result" });
  await expect(runAI({ type: "text", userMessage: "A real follow-up question", systemPrompt: "" })).resolves.toBe("Provider follow-up answer");
  expect(fetch.mock.calls.map(([url]) => url)).toEqual(["/api/identify", "/api/chat"]);
  for (const [, init] of fetch.mock.calls) expect(init?.headers).not.toHaveProperty("Authorization");
  expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toMatchObject({ imageBase64: "data:image/jpeg;base64,user-photo" });
  expect(getAuthClient).not.toHaveBeenCalled();
  expect(localStorage.getItem("sb-existing-auth-token")).toBe("private session unchanged");
});

it("does not connect to account cloud reads, writes, health checks or training consent", async () => {
  expect(getCloudSyncStatus().configured).toBe(false);
  expect(await readCloudLookups()).toEqual({ ok: true, value: [] });
  expect((await syncLookupToCloud({ id: "guest-scan" } as never)).ok).toBe(false);
  expect((await syncLookupsToCloud([{ id: "guest-scan" } as never])).synced).toBe(0);
  expect((await syncAnalysisFailuresToCloud({ id: "guest-scan" } as never)).ok).toBe(false);
  expect((await syncFeedbackToCloud({} as never)).ok).toBe(false);
  expect((await syncWaitlistSignupToCloud({} as never)).ok).toBe(false);
  expect((await verifyCloudHealth()).configured).toBe(false);
  await expect(loadTrainingConsent("guest-scan")).rejects.toThrow(/account-backed/);
  await expect(saveTrainingConsent("guest-scan", true, null)).rejects.toThrow(/account-backed/);
  expect(getAuthClient).not.toHaveBeenCalled();
});

it("retains the real account Authorization behavior when the guest build flag is off", async () => {
  vi.stubEnv("VITE_DEEPSPEC_GUEST_PREVIEW", "false");
  const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ message: "Account answer" }), { status: 200 }));
  await runAI({ type: "text", userMessage: "Account question", systemPrompt: "" });
  expect(fetch.mock.calls[0][1]?.headers).toHaveProperty("Authorization", "Bearer existing-private-account-token");
  expect(getAuthClient).toHaveBeenCalledOnce();
});
