import { useCallback, useState } from "react";
import { updateLookup } from "../services/storage";

type Props = {
  lookupId: string;
  initial: string | null | undefined;
};

export function CorrectionField({ lookupId, initial }: Props) {
  const [draft, setDraft] = useState(() => initial ?? "");

  const save = useCallback(async () => {
    try {
      await updateLookup(lookupId, { correction: draft.trim() || null });
    } catch (e) {
      console.error("[correction-field]", e);
    }
  }, [draft, lookupId]);

  return (
    <div className="mb-4 rounded-xl border border-ds-border-light bg-neutral-50 p-4 dark:border-ds-border dark:bg-neutral-900/40">
      <label htmlFor={`cor-${lookupId}`} className="mb-2 block text-[13px] text-ds-muted-light dark:text-ds-muted">
        What was it actually?
      </label>
      <textarea
        id={`cor-${lookupId}`}
        value={draft}
        maxLength={2000}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void save()}
        placeholder="Describe the real part (optional)."
        rows={3}
        className="w-full resize-none rounded-lg border border-ds-border-light bg-white p-3 text-[14px] text-neutral-900 dark:border-ds-border dark:bg-ds-card dark:text-ds-text"
      />
    </div>
  );
}
