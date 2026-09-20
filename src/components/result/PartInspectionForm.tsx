import { useState } from "react";
import { emptyPartInspection, inspectionValidationError } from "../../lib/partInspection";
import { getCloudSyncStatus, syncLookupToCloud } from "../../services/cloudSync";
import { saveLookupInspection } from "../../services/storage";
import type { Lookup, PartInspectionDraft } from "../../types";

export function PartInspectionForm({ lookup, onSaved }: { lookup: Lookup; onSaved: (lookup: Lookup) => void }) {
  const [draft, setDraft] = useState<PartInspectionDraft>(lookup.inspection ?? { ...emptyPartInspection });
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const fieldClass = "mt-1 w-full rounded-xl border border-neutral-300 bg-white p-3 text-sm text-neutral-900";
  function change(key: keyof PartInspectionDraft, value: string) {
    setDraft((current) => ({ ...current, [key]: value }));
    setMessage("");
  }
  async function save() {
    const error = inspectionValidationError(draft);
    if (error) { setMessage(error); return; }
    const result = saveLookupInspection(lookup.id, draft, lookup);
    if (!result.ok || !result.value) {
      setMessage(result.ok ? "Saved scan not found." : result.message);
      return;
    }
    onSaved(result.value);
    setMessage("Inspection saved on this device.");
    if (!getCloudSyncStatus().configured) return;
    setSaving(true);
    try {
      const sync = await syncLookupToCloud(result.value);
      setMessage(sync.ok ? "Inspection saved on this device and synced to the cloud." : `Saved on this device. Cloud sync failed: ${sync.message}`);
    } catch {
      setMessage("Saved on this device. Cloud sync failed; try saving again when connected.");
    } finally { setSaving(false); }
  }
  return (
    <details className="rounded-[22px] border border-neutral-200 bg-white p-4 shadow-sm">
      <summary className="cursor-pointer text-sm font-extrabold">Human inspection{lookup.inspection ? " — saved" : " — optional"}</summary>
      <p className="mt-3 text-sm text-neutral-600">Record what you checked yourself. These notes stay separate from the AI result and do not grant permission to train a model.</p>
      <form className="mt-4" onSubmit={(event) => { event.preventDefault(); void save(); }}>
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
          <p className="text-xs text-neutral-600">No visible damage does not mean the part works. A recorded test is not a safety certification.</p>
          <label className="block text-sm font-semibold">Test method and result<textarea className={fieldClass} maxLength={1000} value={draft.functionalNotes} onChange={(event) => change("functionalNotes", event.target.value)} /></label>
          <label className="block text-sm font-semibold">Inspector name (self-reported)<input className={fieldClass} maxLength={1000} value={draft.inspectorName} onChange={(event) => change("inspectorName", event.target.value)} /></label>
          <button type="submit" className="rounded-full bg-neutral-900 px-4 py-3 text-sm font-bold text-white">{saving ? "Syncing inspection…" : "Save inspection"}</button>
        </fieldset>
        {lookup.inspection ? <p className="mt-3 text-xs text-neutral-500">Last recorded: {new Date(lookup.inspection.inspectedAt).toLocaleString()}</p> : null}
        <p role="status" className="mt-3 text-sm">{message}</p>
      </form>
    </details>
  );
}
