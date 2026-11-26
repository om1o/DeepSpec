import { useEffect, useRef, useState } from "react";
import { getAccountScope, isAccountScopeCurrent } from "../../lib/accountScope";
import { isCloudSyncEnabled } from "../../services/cloudSyncPolicy";
import { loadServiceOutcomeConsent, saveServiceOutcomeConsent, type ServiceOutcomeConsent } from "../../services/serviceOutcomeConsent";

export function ServiceOutcomeConsentPanel({ scanId, recordId, current, disabled = false }: { scanId: string; recordId: string; current: boolean; disabled?: boolean }) {
  const cloudEnabled = isCloudSyncEnabled();
  const [scope] = useState(getAccountScope);
  const [consent, setConsent] = useState<ServiceOutcomeConsent | null>(null);
  const [choice, setChoice] = useState(false);
  const [pending, setPending] = useState(cloudEnabled);
  const [message, setMessage] = useState("Loading outcome consent…");
  const [reload, setReload] = useState(0);
  const request = useRef(0);

  useEffect(() => {
    const requestRef = request;
    const generation = ++requestRef.current;
    if (!cloudEnabled) return () => { requestRef.current++; };
    loadServiceOutcomeConsent(scanId, recordId, scope).then((value) => {
      if (generation !== request.current || !isAccountScopeCurrent(scope)) return;
      setConsent(value); setChoice(value.enabled);
      setMessage(value.enabled ? "Outcome evaluation consent is on." : "Outcome evaluation consent is off.");
    }).catch((error: unknown) => {
      if (generation === request.current && isAccountScopeCurrent(scope)) setMessage(error instanceof Error ? error.message : "Outcome consent could not be loaded.");
    }).finally(() => {
      if (generation === request.current && isAccountScopeCurrent(scope)) setPending(false);
    });
    return () => { requestRef.current++; };
  }, [scanId, recordId, scope, cloudEnabled, reload]);

  async function save() {
    if (!cloudEnabled || disabled || pending || !consent || !isAccountScopeCurrent(scope) || (choice && !current)) return;
    const generation = ++request.current;
    setPending(true); setMessage("Saving outcome consent to the cloud…");
    try {
      const value = await saveServiceOutcomeConsent(scanId, recordId, choice, consent.revision, scope);
      if (generation !== request.current || !isAccountScopeCurrent(scope)) return;
      setConsent(value); setChoice(value.enabled);
      setMessage(value.enabled ? "Outcome consent saved. Review and evaluation still require a human reviewer." : "Outcome consent withdrawn. This outcome is excluded from future evaluation exports.");
    } catch (error) {
      if (generation !== request.current || !isAccountScopeCurrent(scope)) return;
      setChoice(consent.enabled); setConsent(null);
      setMessage(`${error instanceof Error ? error.message : "Outcome consent change was not confirmed."} Reload consent status before continuing.`);
    } finally {
      if (generation === request.current && isAccountScopeCurrent(scope)) setPending(false);
    }
  }

  function reloadStatus() {
    setPending(true); setConsent(null); setChoice(false); setReload((value) => value + 1);
  }

  if (!isAccountScopeCurrent(scope)) return <section aria-label="Follow-up outcome evaluation consent"><p role="status">Account changed. Reopen this scan to check outcome consent.</p></section>;
  const blocked = !cloudEnabled || disabled || pending || !consent || !isAccountScopeCurrent(scope);
  return <section aria-label="Follow-up outcome evaluation consent" className="mt-3 rounded-xl border border-[var(--ds-border)] p-3 space-y-2">
    <h4 className="text-sm font-bold">Optional outcome evaluation</h4>
    <p className="text-sm">Allow a DeepSpec reviewer to inspect this follow-up record and its correction history, then use only its self-reported outcome category linked to this scan for evaluation. Notes, photos, VIN and recorder name are not included in the evaluation export. This is separate from scan training consent and does not start training.</p>
    {!current ? <p className="text-sm">This entry was corrected or retracted. You can withdraw existing consent, but cannot opt it in.</p> : null}
    <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={choice} disabled={blocked || (!current && !choice)} onChange={(event) => setChoice(event.target.checked)} />Allow this follow-up outcome to be considered for evaluation</label>
    <div className="flex flex-wrap gap-2"><button type="button" className="min-h-11 rounded-lg border px-3 text-sm disabled:opacity-50" disabled={blocked || choice === consent.enabled || (choice && !current)} onClick={() => void save()}>{pending ? "Please wait…" : "Save outcome consent"}</button><button type="button" className="min-h-11 text-sm underline disabled:opacity-50" disabled={!cloudEnabled || pending || !isAccountScopeCurrent(scope)} onClick={reloadStatus}>Reload outcome consent</button></div>
    <p role="status" className="text-sm">{cloudEnabled ? message : "Cloud sync is off. Existing outcome consent cannot be checked or changed here; turning off sync does not withdraw it."}</p>
  </section>;
}
