import { useEffect, useRef, useState } from "react";
import { getAccountScope, isAccountScopeCurrent } from "../../lib/accountScope";
import { loadTrainingConsent, saveTrainingConsent, type TrainingConsent } from "../../services/trainingConsent";

export function TrainingConsentPanel({ scanId }: { scanId: string }) {
  const [scope] = useState(getAccountScope);
  const [consent, setConsent] = useState<TrainingConsent | null>(null);
  const [choice, setChoice] = useState(false);
  const [pending, setPending] = useState(true);
  const [message, setMessage] = useState("Loading cloud consent…");
  const [reload, setReload] = useState(0);
  const request = useRef(0);

  useEffect(() => {
    const requestRef = request;
    const generation = ++request.current;
    loadTrainingConsent(scanId, scope).then((value) => {
      if (request.current !== generation || !isAccountScopeCurrent(scope)) return;
      setConsent(value);
      setChoice(value.enabled);
      setMessage(value.enabled ? "Cloud consent is on." : "Cloud consent is off.");
    }).catch((error: unknown) => {
      if (request.current === generation && isAccountScopeCurrent(scope)) setMessage(error instanceof Error ? error.message : "Consent status could not be loaded.");
    }).finally(() => {
      if (request.current === generation && isAccountScopeCurrent(scope)) setPending(false);
    });
    return () => { requestRef.current++; };
  }, [scanId, scope, reload]);

  function reloadStatus() {
    setPending(true);
    setConsent(null);
    setChoice(false);
    setMessage("Loading cloud consent…");
    setReload((value) => value + 1);
  }

  async function save() {
    if (pending || !consent || !isAccountScopeCurrent(scope)) return;
    const generation = ++request.current;
    setPending(true);
    setMessage("Saving consent to the cloud…");
    try {
      const value = await saveTrainingConsent(scanId, choice, consent.revision, scope);
      if (generation !== request.current || !isAccountScopeCurrent(scope)) return;
      setConsent(value);
      setChoice(value.enabled);
      setMessage(value.enabled ? "Consent saved to the cloud. This scan may be reviewed for future model improvement." : "Consent withdrawn in the cloud. This scan is excluded from future training datasets.");
    } catch (error) {
      if (generation !== request.current || !isAccountScopeCurrent(scope)) return;
      setChoice(consent.enabled);
      setConsent(null);
      setMessage(`${error instanceof Error ? error.message : "Consent change was not confirmed."} Last confirmed choice was ${consent.enabled ? "on" : "off"}. Reload consent status before continuing.`);
    } finally {
      if (generation === request.current && isAccountScopeCurrent(scope)) setPending(false);
    }
  }

  return <section aria-label="Training consent" className="rounded-xl border border-[var(--ds-border)] p-4 space-y-3">
    <h2 className="text-sm font-bold">Help improve DeepSpec — optional</h2>
    <p className="text-sm text-[var(--ds-fg-2)]">Allow this scan’s photo, analysis and corrections to be reviewed for future model improvement. This does not start automatic training. Your choice does not affect scanning.</p>
    <label className="flex items-start gap-3 text-sm">
      <input type="checkbox" className="mt-1" checked={choice} disabled={pending || !consent || !isAccountScopeCurrent(scope)} onChange={(event) => setChoice(event.target.checked)} />
      Allow this scan to be considered for training
    </label>
    <p className="text-xs text-[var(--ds-fg-2)]">Off by default. You can withdraw consent here. Withdrawal excludes this scan from future datasets; it cannot promise to reverse any training already completed.</p>
    <div className="flex flex-wrap gap-3">
      <button type="button" className="rounded-lg border border-[var(--ds-border)] px-3 py-2 text-sm disabled:opacity-50" disabled={pending || !consent || choice === consent.enabled || !isAccountScopeCurrent(scope)} onClick={() => void save()}>{pending ? "Please wait…" : "Save consent choice"}</button>
      <button type="button" className="text-sm underline disabled:opacity-50" disabled={pending || !isAccountScopeCurrent(scope)} onClick={reloadStatus}>Reload consent status</button>
    </div>
    <p role="status" className="text-sm">{message}</p>
  </section>;
}
