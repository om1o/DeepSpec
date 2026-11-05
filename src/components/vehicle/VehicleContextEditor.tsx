import { useId } from "react";
import type { ShopVehicleContext, VehicleContextField } from "../../types";
import { confirmVehicleContextField, isVehicleFieldConfirmed, updateVehicleContextField } from "../../lib/vehicleContext";

type Props = {
  value: ShopVehicleContext | undefined;
  onChange: (value: ShopVehicleContext | undefined) => void;
  disabled?: boolean;
  hideSymptom?: boolean;
};

const TEXT_FIELDS = [
  ["year", "Year", 20], ["make", "Make", 120], ["model", "Model", 120],
  ["engine", "Engine", 120], ["vin", "VIN", 17],
] as const;
const FIELD = "mt-1 block min-h-11 w-full rounded-lg border border-[var(--ds-border)] bg-[var(--ds-surface)] px-3 py-2 text-sm text-[var(--ds-fg-1)]";

/** User-entered context. Confirmation is an explicit user action, never VIN decoding. */
export function VehicleContextEditor({ value, onChange, disabled = false, hideSymptom = false }: Props) {
  const id = useId();
  const modifications = value?.modifications;
  function confirmation(field: VehicleContextField, label: string, supplied: boolean) {
    const confirmed = isVehicleFieldConfirmed(value, field);
    const canConfirm = isVehicleFieldConfirmed(confirmVehicleContextField(value, field, true), field);
    return <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
      <span aria-label={`${label} confirmation`} className="text-xs text-[var(--ds-fg-3)]">{confirmed ? "User-confirmed" : supplied ? "Supplied, not confirmed" : "Not supplied"}</span>
      <button type="button" className="min-h-10 rounded-lg border border-[var(--ds-border)] px-3 py-2 text-xs disabled:opacity-50"
        disabled={disabled || (!confirmed && !canConfirm)} aria-pressed={confirmed}
        onClick={() => onChange(confirmVehicleContextField(value, field, !confirmed))}>
        {confirmed ? `Clear ${label.toLowerCase()} confirmation` : `Confirm ${label.toLowerCase()}`}
      </button>
    </div>;
  }
  return <fieldset disabled={disabled} className="rounded-2xl border border-[var(--ds-border)] p-4 text-[var(--ds-fg-2)]">
    <legend className="px-1 text-base font-bold">Vehicle details</legend>
    <p className="text-xs text-[var(--ds-fg-3)]">Confirm only details you checked yourself. Entering a VIN does not verify it or confirm part fitment. Changes clear that field&apos;s confirmation.</p>
    <div className="mt-4 grid gap-4 sm:grid-cols-2">
      {TEXT_FIELDS.map(([field, label, maxLength]) => <div key={field}>
        <label htmlFor={`${id}-${field}`} className="text-sm font-semibold">{label}</label>
        <input id={`${id}-${field}`} className={FIELD} maxLength={maxLength} autoCapitalize={field === "vin" ? "characters" : "off"}
          value={value?.[field] ?? ""} onChange={(event) => onChange(updateVehicleContextField(value, field, event.target.value))} />
        {confirmation(field, label, Boolean(value?.[field]?.trim()))}
      </div>)}
      <div>
        <label htmlFor={`${id}-mileage`} className="text-sm font-semibold">Mileage</label>
        <input id={`${id}-mileage`} className={FIELD} maxLength={120} value={value?.mileage ?? ""}
          onChange={(event) => onChange(updateVehicleContextField(value, "mileage", event.target.value))} />
        <label htmlFor={`${id}-mileage-unit`} className="mt-2 block text-xs font-semibold">Mileage unit</label>
        <select id={`${id}-mileage-unit`} className={FIELD} value={value?.mileageUnit ?? "unknown"}
          onChange={(event) => onChange(updateVehicleContextField(value, "mileageUnit", event.target.value === "mi" || event.target.value === "km" ? event.target.value : "unknown"))}>
          <option value="unknown">Unknown</option><option value="mi">Miles</option><option value="km">Kilometers</option>
        </select>
        {confirmation("mileage", "Mileage", Boolean(value?.mileage?.trim()))}
      </div>
    </div>
    <div className="mt-4">
      <label htmlFor={`${id}-modifications`} className="text-sm font-semibold">Modifications</label>
      <select id={`${id}-modifications`} className={FIELD} value={modifications?.status ?? "unknown"}
        onChange={(event) => onChange(updateVehicleContextField(value, "modifications", { status: event.target.value as "unknown" | "none_known" | "modified" }))}>
        <option value="unknown">Unknown</option><option value="none_known">None known</option><option value="modified">Modified</option>
      </select>
      {modifications?.status === "modified" ? <label htmlFor={`${id}-modification-details`} className="mt-3 block text-sm font-semibold">Modification details
        <textarea id={`${id}-modification-details`} className={FIELD} maxLength={600} value={modifications.details ?? ""}
          onChange={(event) => onChange(updateVehicleContextField(value, "modifications", { status: "modified", details: event.target.value }))} />
      </label> : null}
      {confirmation("modifications", "Modifications", Boolean(modifications && modifications.status !== "unknown"))}
    </div>
    {!hideSymptom ? <div className="mt-4">
      <label htmlFor={`${id}-symptom`} className="block text-sm font-semibold">Symptom / complaint (optional)</label>
      <textarea id={`${id}-symptom`} aria-describedby={`${id}-symptom-help`} className={FIELD} maxLength={500} value={value?.symptom ?? ""}
        onChange={(event) => onChange(updateVehicleContextField(value, "symptom", event.target.value))} />
      <span id={`${id}-symptom-help`} className="mt-1 block text-xs font-normal text-[var(--ds-fg-3)]">Describe what you noticed. A reported symptom is separate from what a photo shows.</span>
    </div> : null}
  </fieldset>;
}
