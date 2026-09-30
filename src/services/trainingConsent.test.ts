import type { SupabaseClient } from "@supabase/supabase-js";
import { setActiveAccount } from "../lib/accountScope";
import { getAuthClient } from "./auth";
import { loadTrainingConsent, saveTrainingConsent, TRAINING_CONSENT_POLICY_VERSION } from "./trainingConsent";

vi.mock("./auth", () => ({ getAuthClient: vi.fn() }));
const row = { user_id: "test-user", scan_local_id: "scan-1", training_consent: true, policy_version: TRAINING_CONSENT_POLICY_VERSION, revision: 1, updated_at: "2026-09-27T00:00:00Z" };
function setup(data: unknown = row, error: unknown = null) {
  const query = { select: vi.fn(), eq: vi.fn(), insert: vi.fn(), update: vi.fn(), abortSignal: vi.fn(), maybeSingle: vi.fn().mockResolvedValue({ data, error }) };
  for (const method of [query.select, query.eq, query.insert, query.update, query.abortSignal]) method.mockReturnValue(query);
  const from = vi.fn().mockReturnValue(query);
  vi.mocked(getAuthClient).mockResolvedValue({ from } as unknown as SupabaseClient);
  return { ...query, from };
}
afterEach(() => { vi.resetAllMocks(); vi.restoreAllMocks(); });
it("treats absent consent as off and scopes cloud reads to the current user", async () => {
  const query = setup(null);
  expect(await loadTrainingConsent("scan-1")).toEqual({ enabled: false, revision: null, updatedAt: null });
  expect(query.eq).toHaveBeenCalledWith("user_id", "test-user");
  expect(query.eq).toHaveBeenCalledWith("scan_local_id", "scan-1");
});
it("inserts only permitted columns for an explicit first opt-in", async () => {
  const query = setup();
  expect((await saveTrainingConsent("scan-1", true, null)).enabled).toBe(true);
  expect(query.insert).toHaveBeenCalledWith({ user_id: "test-user", scan_local_id: "scan-1", training_consent: true, policy_version: TRAINING_CONSENT_POLICY_VERSION });
});
it("requires the expected server revision for withdrawal", async () => {
  const query = setup({ ...row, training_consent: false, revision: 2 });
  expect((await saveTrainingConsent("scan-1", false, 1)).enabled).toBe(false);
  expect(query.update).toHaveBeenCalledWith({ training_consent: false, policy_version: TRAINING_CONSENT_POLICY_VERSION });
  expect(query.eq).toHaveBeenCalledWith("revision", 1);
});
it.each([{ data: null, error: null }, { data: null, error: { code: "23505" } }])("rejects concurrent changes without reporting success", async ({ data, error }) => {
  setup(data, error);
  await expect(saveTrainingConsent("scan-1", true, 1)).rejects.toThrow("changed elsewhere");
});
it("explains missing cloud scan without confirming consent", async () => {
  setup(null, { code: "23503" });
  await expect(saveTrainingConsent("scan-1", true, null)).rejects.toThrow("First save this scan to the cloud");
});
it("rejects an unverified or mismatched returned row", async () => {
  setup({ ...row, user_id: "other-user" });
  await expect(loadTrainingConsent("scan-1")).rejects.toThrow("Could not confirm");
});
it("rejects an account switch away and back while getting the client", async () => {
  const query = setup();
  vi.mocked(getAuthClient).mockImplementation(async () => {
    setActiveAccount("other-user"); setActiveAccount("test-user");
    return { from: query.from } as unknown as SupabaseClient;
  });
  await expect(saveTrainingConsent("scan-1", true, null)).rejects.toThrow("Account changed");
  expect(query.from).not.toHaveBeenCalled();
});
it("rejects an account switch during the database response", async () => {
  const query = setup();
  query.maybeSingle.mockImplementation(async () => { setActiveAccount("other-user"); return { data: row, error: null }; });
  await expect(loadTrainingConsent("scan-1")).rejects.toThrow("Account changed");
});
it.each(["read", "save"])("bounds the %s request and explains a rejected timeout without confirming a change", async (operation) => {
  const query = setup();
  const timeout = vi.spyOn(AbortSignal, "timeout");
  query.maybeSingle.mockRejectedValue(new DOMException("Timed out", "TimeoutError"));
  await expect(operation === "read" ? loadTrainingConsent("scan-1") : saveTrainingConsent("scan-1", false, 1))
    .rejects.toThrow(operation === "read" ? "could not be loaded" : "The server may have received it. Reload consent status");
  expect(timeout).toHaveBeenCalledWith(15000);
  expect(query.abortSignal).toHaveBeenCalledWith(expect.any(AbortSignal));
});
