import { accountStorageKey, isAccountScopeCurrent, type AccountScope } from "../lib/accountScope";
import { emptyPartInspection } from "../lib/partInspection";
import type { PartInspectionDraft } from "../types";

export type InspectionRecovery = {
  version: 1;
  draft: PartInspectionDraft;
  deviceInspection: string | null;
  displayedInspection: string;
  updatedAt: string;
};
export type DraftRead = { raw: string | null; record: InspectionRecovery | null; message: string };
type DraftWrite = { ok: true; raw: string | null } | { ok: false; message: string };

export const inspectionDraftKey = (id: string) => accountStorageKey(`inspection-draft:${encodeURIComponent(id)}`);
const accountChanged = "Account changed. Reopen the scan before using inspection drafts.";
const storageFailed = "Draft could not be kept on this device. Download a copy before leaving this page.";
const keys = Object.keys(emptyPartInspection) as (keyof PartInspectionDraft)[];

function parseRecord(raw: string): InspectionRecovery | null {
  if (raw.length > 40_000) return null;
  try {
    const value = JSON.parse(raw) as InspectionRecovery;
    if (!value || value.version !== 1 || !value.draft
      || keys.some((key) => typeof value.draft[key] !== "string" || value.draft[key].length > 1000)
      || !["not_inspected", "no_visible_damage", "visible_damage", "uncertain"].includes(value.draft.visibleCondition)
      || !["not_tested", "passed", "failed", "inconclusive"].includes(value.draft.functionalStatus)
      || !(value.deviceInspection === null || typeof value.deviceInspection === "string")
      || typeof value.displayedInspection !== "string"
      || typeof value.updatedAt !== "string" || !Number.isFinite(Date.parse(value.updatedAt))) return null;
    // Keep only draft fields. Incomplete text and whitespace must survive exactly.
    return { ...value, draft: Object.fromEntries(keys.map((key) => [key, value.draft[key]])) as PartInspectionDraft };
  } catch { return null; }
}

export function readInspectionDraft(scope: AccountScope, id: string): DraftRead {
  if (!isAccountScopeCurrent(scope)) return { raw: null, record: null, message: accountChanged };
  try {
    const raw = localStorage.getItem(inspectionDraftKey(id));
    const record = raw === null ? null : parseRecord(raw);
    return { raw, record, message: raw !== null && !record ? "A device draft could not be read. Discard it to start a new draft." : "" };
  } catch { return { raw: null, record: null, message: storageFailed }; }
}

// An optimistic guard, not a cross-tab transaction. Never knowingly replace
// another tab's copy. Failed writes leave the current form available to export.
export function writeInspectionDraft(scope: AccountScope, id: string, expectedRaw: string | null, record: InspectionRecovery | null): DraftWrite {
  if (!isAccountScopeCurrent(scope)) return { ok: false, message: accountChanged };
  try {
    const key = inspectionDraftKey(id);
    if (localStorage.getItem(key) !== expectedRaw) {
      return { ok: false, message: "Another tab changed the device draft. Download your notes, then reopen the scan to review that draft." };
    }
    const raw = record === null ? null : JSON.stringify(record);
    if (raw !== null && !parseRecord(raw)) return { ok: false, message: storageFailed };
    if (raw === null) localStorage.removeItem(key);
    else localStorage.setItem(key, raw);
    return { ok: true, raw };
  } catch { return { ok: false, message: storageFailed }; }
}
