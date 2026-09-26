import { getAccountScope, isAccountScopeCurrent } from "../../lib/accountScope";
import { useRef, useState } from "react";
import { emptyPartInspection, inspectionValidationError } from "../../lib/partInspection";
import { getCloudSyncStatus, syncLookupToCloud } from "../../services/cloudSync";
import { getLookup, saveLookupInspection } from "../../services/storage";
import { downloadTextFile } from "../../services/report";
import type { Lookup, PartInspectionDraft } from "../../types";

export function PartInspectionForm({ lookup, onSaved }: { lookup: Lookup; onSaved: (lookup: Lookup) => void }) {
  const [scope] = useState(getAccountScope);
  const [draft, setDraft] = useState<PartInspectionDraft>(lookup.inspection ?? { ...emptyPartInspection });
  const [savedDraft, setSavedDraft] = useState<PartInspectionDraft>(lookup.inspection ?? { ...emptyPartInspection });
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [openedDeviceInspection] = useState(() => {
    const saved = getLookup(lookup.id);
    return saved ? JSON.stringify(saved.inspection ?? null) : undefined;
  });
  const deviceInspection = useRef(openedDeviceInspection);
  const displayedInspection = useRef(JSON.stringify(lookup.inspection ?? null));
  const hasUnsavedChanges = (Object.keys(emptyPartInspection) as (keyof PartInspectionDraft)[])
    .some((key) => draft[key] !== savedDraft[key]);
  const fieldClass = "mt-1 w-full rounded-xl border border-neutral-300 bg-[var(--ds-elevated)] p-3 text-sm text-[var(--ds-fg-1)]";
  function change(key: keyof PartInspectionDraft, value: string) {
    setDraft((current) => ({ ...current, [key]: value }));
    setMessage("");
  }
  function downloadDraft() {
    if (!isAccountScopeCurrent(scope)) { setMessage("Account changed. Reopen the scan before downloading an inspection draft."); return; }
    const content = [
      "DeepSpec — UNSAVED INSPECTION DRAFT",
      "Recovery copy only. May be incomplete. Not a saved inspection or a safety certification.",
      `Scan: ${lookup.id}`, "",
      `Inspector: ${draft.inspectorName}`,
      `Part name entered: ${draft.confirmedPartName}`,
      `Part number entered: ${draft.partNumber}`,
      `Identity evidence: ${draft.identityEvidence}`,
      `Visible condition: ${draft.visibleCondition.replaceAll("_", " ")}`,
      `Visible notes: ${draft.visibleNotes}`,
      `Functional test: ${draft.functionalStatus.replaceAll("_", " ")}`,
      `Test method and result: ${draft.functionalNotes}`,
    ].join("\n");
    try { downloadTextFile("deep-spec-inspection-draft.txt", content); }
    catch { setMessage("Draft download could not start. Your text is still here; copy it before leaving this page."); }
  }
  async function save() {
    if (!isAccountScopeCurrent(scope)) { setMessage("Account changed. Reopen the scan before saving an inspection."); return; }
    const error = inspectionValidationError(draft);
    if (error) { setMessage(error); return; }
    const current = getLookup(lookup.id);
    if ((current ? JSON.stringify(current.inspection ?? null) : undefined) !== deviceInspection.current
      || JSON.stringify(lookup.inspection ?? null) !== displayedInspection.current) {
      setMessage("Inspection changed or was removed since you opened this form. Your draft is still here; copy it before reopening the scan to review the saved version.");
      return;
    }
    const result = saveLookupInspection(lookup.id, draft, lookup);
    if (!result.ok || !result.value) {
      setMessage(result.ok ? "Saved scan not found." : result.message);
      return;
    }
    deviceInspection.current = JSON.stringify(result.value.inspection ?? null);
    displayedInspection.current = deviceInspection.current;
    setSavedDraft(result.value.inspection!);
    setDraft(result.value.inspection!);
    onSaved(result.value);
    setMessage("Inspection saved on this device.");
    if (!getCloudSyncStatus().configured) return;
    setSaving(true);
    try {
      const sync = await syncLookupToCloud(result.value);
      if (!isAccountScopeCurrent(scope)) return;
      setMessage(sync.ok ? "Inspection saved on this device and synced to the cloud." : `Saved on this device. Cloud sync failed: ${sync.message}`);
    } catch {
      if (!isAccountScopeCurrent(scope)) return;
      setMessage("Saved on this device. Cloud sync failed; try saving again when connected.");
    } finally {
      if (isAccountScopeCurrent(scope)) {
        if (JSON.stringify(getLookup(lookup.id)?.inspection) !== JSON.stringify(result.value.inspection)) {
          setMessage("Device inspection changed or was removed while syncing. Reopen the scan to review its current save status.");
        }
        setSaving(false);
      }
    }
  }
  return (
    <details className="rounded-[22px] border border-[var(--ds-border)] bg-[var(--ds-elevated)] p-4 shadow-sm">
      <summary className="cursor-pointer text-sm font-extrabold">Human inspection{lookup.inspection ? " — saved" : " — optional"}</summary>
      <p className="mt-3 text-sm text-[var(--ds-fg-3)]">Record what you checked yourself. These notes stay separate from the AI result and do not grant permission to train a model.</p>
      <form className="mt-4" onSubmit={(event) => { event.preventDefault(); void save(); }}>
        {hasUnsavedChanges ? <aside aria-label="Inspection draft recovery" className="mb-4 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-amber-950">
          <p className="text-sm font-bold">Unsaved inspection changes</p>
          <p className="mt-1 text-xs leading-relaxed">Save before leaving this page. If saving is blocked, download a copy of your draft to keep your notes.</p>
          <button type="button" onClick={downloadDraft} className="mt-3 rounded-full border border-amber-400 px-4 py-2 text-sm font-bold">Download draft</button>
        </aside> : null}
        <fieldset disabled={saving} className="space-y-3">
          {([
            ["confirmedPartName", "Confirmed part name"], ["partNumber", "Part number"],
            ["identityEvidence", "Identity evidence (label, catalog, or other check)"],
          ] as const).map(([key, label]) => <label className="block text-sm font-semibold" key={key}>{label}<input className={fieldClass} maxLength={1000} value={draft[key]} onChange={(event) => change(key, event.target.value)} /></label>)}
          <label className="block text-sm font-semibold">Visible condition
            <select className={fieldClass} value={draft.visibleCondition} onChange={(event) => change("visibleCondition", event.target.value)}>
              <option value="not_inspected">Not inspected</option><option value="no_visible_damage">No visible damage observed</option><option value="visible_damage">Visible damage observed</option><option value="uncertain">Uncertain</option>
            </select>
          </label>
          <label className="block text-sm font-semibold">Visible condition notes<textarea className={fieldClass} maxLength={1000} value={draft.visibleNotes} onChange={(event) => change("visibleNotes", event.target.value)} /></label>
          <label className="block text-sm font-semibold">Functional test
            <select className={fieldClass} value={draft.functionalStatus} onChange={(event) => change("functionalStatus", event.target.value)}>
              <option value="not_tested">Not tested</option><option value="passed">Passed recorded test</option><option value="failed">Failed recorded test</option><option value="inconclusive">Inconclusive</option>
            </select>
          </label>
          <p className="text-xs text-[var(--ds-fg-3)]">No visible damage does not mean the part works. A recorded test is not a safety certification.</p>
          <label className="block text-sm font-semibold">Test method and result<textarea className={fieldClass} maxLength={1000} value={draft.functionalNotes} onChange={(event) => change("functionalNotes", event.target.value)} /></label>
          <label className="block text-sm font-semibold">Inspector name (self-reported)<input className={fieldClass} maxLength={1000} value={draft.inspectorName} onChange={(event) => change("inspectorName", event.target.value)} /></label>
          <button type="submit" className="rounded-full bg-neutral-900 px-4 py-3 text-sm font-bold text-white">{saving ? "Syncing inspection…" : "Save inspection"}</button>
        </fieldset>
        {lookup.inspection ? <p className="mt-3 text-xs text-[var(--ds-fg-3)]">Last recorded: {new Date(lookup.inspection.inspectedAt).toLocaleString()}</p> : null}
        <p role="status" className="mt-3 text-sm">{message}</p>
      </form>
    </details>
  );
}
