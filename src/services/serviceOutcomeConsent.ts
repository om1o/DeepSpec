import { getAccountScope, isAccountScopeCurrent, type AccountScope } from "../lib/accountScope";
import { getAuthClient } from "./auth";
import { assertCloudSyncEnabled } from "./cloudSyncPolicy";

export const SERVICE_OUTCOME_POLICY_VERSION = "2026-11-26-v1";
export type ServiceOutcomeConsent = { enabled: boolean; revision: number | null; updatedAt: string | null };
const columns = "user_id,scan_local_id,record_id,evaluation_consent,policy_version,revision,updated_at";

function checkScope(scope: AccountScope) {
  if (!isAccountScopeCurrent(scope)) throw new Error("Account changed. Reopen this scan before changing outcome consent.");
}

function parseRow(row: Record<string, unknown>, scanId: string, recordId: string, scope: AccountScope): ServiceOutcomeConsent {
  if (row.user_id !== scope.userId || row.scan_local_id !== scanId || row.record_id !== recordId ||
      typeof row.evaluation_consent !== "boolean" || !Number.isSafeInteger(row.revision) ||
      typeof row.updated_at !== "string" || (row.evaluation_consent && row.policy_version !== SERVICE_OUTCOME_POLICY_VERSION)) {
    throw new Error("Could not confirm the saved outcome consent. Reload its status before continuing.");
  }
  return { enabled: row.evaluation_consent, revision: row.revision as number, updatedAt: row.updated_at };
}

export async function loadServiceOutcomeConsent(scanId: string, recordId: string, scope = getAccountScope()): Promise<ServiceOutcomeConsent> {
  assertCloudSyncEnabled(); checkScope(scope);
  const client = await getAuthClient(); checkScope(scope);
  if (!client) throw new Error("Cloud connection unavailable. Outcome consent could not be loaded.");
  const { data, error } = await client.from("service_outcome_consents").select(columns)
    .eq("user_id", scope.userId!).eq("scan_local_id", scanId).eq("record_id", recordId)
    .abortSignal(AbortSignal.timeout(15000)).maybeSingle()
    .then((response) => response, () => { checkScope(scope); throw new Error("Outcome consent could not be loaded. Check your connection and retry."); });
  checkScope(scope);
  if (error) throw new Error("Outcome consent could not be loaded. Check your connection and database migration.");
  return data ? parseRow(data, scanId, recordId, scope) : { enabled: false, revision: null, updatedAt: null };
}

export async function saveServiceOutcomeConsent(scanId: string, recordId: string, enabled: boolean, expectedRevision: number | null, scope = getAccountScope()): Promise<ServiceOutcomeConsent> {
  assertCloudSyncEnabled(); checkScope(scope);
  const client = await getAuthClient(); checkScope(scope);
  if (!client) throw new Error("Cloud connection unavailable. Outcome consent change was not confirmed.");
  const query = expectedRevision === null ? client.from("service_outcome_consents").insert({
    user_id: scope.userId!, scan_local_id: scanId, record_id: recordId,
    evaluation_consent: enabled, policy_version: SERVICE_OUTCOME_POLICY_VERSION,
  }) : client.from("service_outcome_consents").update({ evaluation_consent: enabled, policy_version: SERVICE_OUTCOME_POLICY_VERSION })
    .eq("user_id", scope.userId!).eq("scan_local_id", scanId).eq("record_id", recordId).eq("revision", expectedRevision);
  const { data, error } = await query.select(columns).abortSignal(AbortSignal.timeout(15000)).maybeSingle()
    .then((response) => response, () => { checkScope(scope); throw new Error("Outcome consent change was not confirmed. The server may have received it. Reload consent status before continuing."); });
  checkScope(scope);
  if (error?.code === "23505" || (!error && !data)) throw new Error("Outcome consent changed elsewhere. Reload its status before changing it again.");
  if (error?.code === "23503" || error?.code === "23514") throw new Error("Sync this follow-up record to the cloud first, then reload its consent status.");
  if (error || !data) throw new Error("Outcome consent change was not confirmed. Check the cloud connection and database migration.");
  const confirmed = parseRow(data, scanId, recordId, scope);
  if (confirmed.enabled !== enabled) throw new Error("Outcome consent change was not confirmed. Reload its status before continuing.");
  return confirmed;
}
