import type { SupabaseClient } from "@supabase/supabase-js";
import { setActiveAccount } from "../lib/accountScope";
import { getAuthClient } from "./auth";
import { loadServiceOutcomeConsent, saveServiceOutcomeConsent, SERVICE_OUTCOME_POLICY_VERSION } from "./serviceOutcomeConsent";

vi.mock("./auth", () => ({ getAuthClient: vi.fn() }));
const recordId = "10000000-0000-4000-8000-000000000001";
const row = { user_id: "test-user", scan_local_id: "scan-1", record_id: recordId, evaluation_consent: true, policy_version: SERVICE_OUTCOME_POLICY_VERSION, revision: 1, updated_at: "2026-11-26T00:00:00Z" };
function setup(data: unknown = row, error: unknown = null) {
  const query = { select: vi.fn(), eq: vi.fn(), insert: vi.fn(), update: vi.fn(), abortSignal: vi.fn(), maybeSingle: vi.fn().mockResolvedValue({ data, error }) };
  for (const method of [query.select, query.eq, query.insert, query.update, query.abortSignal]) method.mockReturnValue(query);
  const from = vi.fn().mockReturnValue(query);
  vi.mocked(getAuthClient).mockResolvedValue({ from } as unknown as SupabaseClient);
  return { ...query, from };
}
afterEach(() => { vi.resetAllMocks(); vi.restoreAllMocks(); vi.unstubAllEnvs(); });

it("treats a missing per-record consent as off and scopes the read", async () => {
  const query = setup(null);
  expect(await loadServiceOutcomeConsent("scan-1", recordId)).toEqual({ enabled: false, revision: null, updatedAt: null });
  expect(query.eq).toHaveBeenCalledWith("user_id", "test-user");
  expect(query.eq).toHaveBeenCalledWith("scan_local_id", "scan-1");
  expect(query.eq).toHaveBeenCalledWith("record_id", recordId);
});
it("inserts only outcome consent columns after an explicit opt-in", async () => {
  const query = setup();
  expect((await saveServiceOutcomeConsent("scan-1", recordId, true, null)).enabled).toBe(true);
  expect(query.from).toHaveBeenCalledWith("service_outcome_consents");
  expect(query.insert).toHaveBeenCalledWith({ user_id: "test-user", scan_local_id: "scan-1", record_id: recordId, evaluation_consent: true, policy_version: SERVICE_OUTCOME_POLICY_VERSION });
});
it("requires the last server revision when withdrawing", async () => {
  const query = setup({ ...row, evaluation_consent: false, revision: 2 });
  expect((await saveServiceOutcomeConsent("scan-1", recordId, false, 1)).enabled).toBe(false);
  expect(query.update).toHaveBeenCalledWith({ evaluation_consent: false, policy_version: SERVICE_OUTCOME_POLICY_VERSION });
  expect(query.eq).toHaveBeenCalledWith("revision", 1);
});
it.each([{ data: null, error: null }, { data: null, error: { code: "23505" } }])("rejects stale consent writes", async ({ data, error }) => {
  setup(data, error);
  await expect(saveServiceOutcomeConsent("scan-1", recordId, true, 1)).rejects.toThrow("changed elsewhere");
});
it("requires the follow-up record to exist in cloud before consent", async () => {
  setup(null, { code: "23503" });
  await expect(saveServiceOutcomeConsent("scan-1", recordId, true, null)).rejects.toThrow("Sync this follow-up record");
});
it("rejects a mismatched record or owner response", async () => {
  setup({ ...row, record_id: "other" });
  await expect(loadServiceOutcomeConsent("scan-1", recordId)).rejects.toThrow("Could not confirm");
});
it("rejects account switches while loading or saving", async () => {
  const query = setup();
  vi.mocked(getAuthClient).mockImplementation(async () => {
    setActiveAccount("other-user"); setActiveAccount("test-user");
    return { from: query.from } as unknown as SupabaseClient;
  });
  await expect(saveServiceOutcomeConsent("scan-1", recordId, true, null)).rejects.toThrow("Account changed");
  expect(query.from).not.toHaveBeenCalled();
});
it("does not report success when a consent response times out", async () => {
  const query = setup();
  query.maybeSingle.mockRejectedValue(new DOMException("Timed out", "TimeoutError"));
  await expect(saveServiceOutcomeConsent("scan-1", recordId, true, null)).rejects.toThrow("server may have received it");
  expect(query.abortSignal).toHaveBeenCalledWith(expect.any(AbortSignal));
});
