import { getAccountScope, isAccountScopeCurrent, type AccountScope } from "../lib/accountScope";
import { getAuthClient } from "./auth";

export const TRAINING_CONSENT_POLICY_VERSION = "2026-09-27-v1";
export type TrainingConsent = { enabled: boolean; revision: number | null; updatedAt: string | null };
const columns = "user_id,scan_local_id,training_consent,policy_version,revision,updated_at";

function checkScope(scope: AccountScope) {
  if (!isAccountScopeCurrent(scope)) throw new Error("Account changed. Reopen this scan before changing consent.");
}

function parseRow(row: Record<string, unknown>, scanId: string, scope: AccountScope): TrainingConsent {
  if (row.user_id !== scope.userId || row.scan_local_id !== scanId || typeof row.training_consent !== "boolean" ||
      !Number.isSafeInteger(row.revision) || typeof row.updated_at !== "string" ||
      (row.training_consent && row.policy_version !== TRAINING_CONSENT_POLICY_VERSION)) {
    throw new Error("Could not confirm the saved consent. Reload its status before continuing.");
  }
  return { enabled: row.training_consent, revision: row.revision as number, updatedAt: row.updated_at };
}

export async function loadTrainingConsent(scanId: string, scope = getAccountScope()): Promise<TrainingConsent> {
  checkScope(scope);
  const client = await getAuthClient();
  checkScope(scope);
  if (!client) throw new Error("Cloud connection unavailable. Consent status could not be loaded.");
  const { data, error } = await client.from("scan_training_consent").select(columns)
    .eq("user_id", scope.userId!).eq("scan_local_id", scanId).abortSignal(AbortSignal.timeout(15000)).maybeSingle()
    .then((response) => response, () => {
      checkScope(scope);
      throw new Error("Consent status could not be loaded. Check your connection and retry.");
    });
  checkScope(scope);
  if (error) throw new Error("Consent status could not be loaded. Check your connection and retry.");
  return data ? parseRow(data, scanId, scope) : { enabled: false, revision: null, updatedAt: null };
}

export async function saveTrainingConsent(scanId: string, enabled: boolean, expectedRevision: number | null, scope = getAccountScope()): Promise<TrainingConsent> {
  checkScope(scope);
  const client = await getAuthClient();
  checkScope(scope);
  if (!client) throw new Error("Cloud connection unavailable. Consent change was not confirmed.");
  const query = expectedRevision === null ? client.from("scan_training_consent").insert({
    user_id: scope.userId!, scan_local_id: scanId, training_consent: enabled,
    policy_version: TRAINING_CONSENT_POLICY_VERSION,
  }) : client.from("scan_training_consent").update({ training_consent: enabled, policy_version: TRAINING_CONSENT_POLICY_VERSION })
    .eq("user_id", scope.userId!).eq("scan_local_id", scanId).eq("revision", expectedRevision);
  const { data, error } = await query.select(columns).abortSignal(AbortSignal.timeout(15000)).maybeSingle()
    .then((response) => response, () => {
      checkScope(scope);
      throw new Error("Consent change was not confirmed. The server may have received it. Reload consent status before continuing.");
    });
  checkScope(scope);
  if (error?.code === "23505" || (!error && !data)) throw new Error("Consent changed elsewhere. Reload its status before changing it again.");
  if (error || !data) throw new Error("Consent change was not confirmed. First save this scan to the cloud, then check your connection and reload its status.");
  const confirmed = parseRow(data, scanId, scope);
  if (confirmed.enabled !== enabled) throw new Error("Consent change was not confirmed. Reload its status before continuing.");
  return confirmed;
}
