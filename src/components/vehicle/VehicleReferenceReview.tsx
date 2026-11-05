import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ShopVehicleContext } from "../../types";
import type { VehicleIdentityReference, VehicleReferenceQuery } from "../../types/vehicleReference";
import { getAccountScope, isAccountScopeCurrent } from "../../lib/accountScope";
import { isVehicleFieldConfirmed, updateVehicleContextField } from "../../lib/vehicleContext";
import { normalizeVehicleReferenceQuery, referenceAllowsSuggestions } from "../../lib/vehicleReference";
import { requestVehicleReference } from "../../services/vehicleReference";
import { appendVehicleReference, readVehicleReferences } from "../../services/vehicleReferenceStore";

type Props = { value: ShopVehicleContext | undefined; onChange: (value: ShopVehicleContext | undefined) => void; disabled?: boolean };
type Binding = { fingerprint: string; revision: number };
type Pending = { reference: VehicleIdentityReference; binding: Binding };
const BUTTON = "min-h-11 rounded-lg border border-[var(--ds-border)] px-3 py-2 text-sm disabled:opacity-50";
const FIELDS = [["year", "year", "Year"], ["make", "make", "Make"], ["model", "model", "Model"], ["engine", "engineModel", "Engine model"]] as const;
const ATTRIBUTES = [["engineManufacturer", "Engine manufacturer"], ["cylinders", "Cylinders"], ["displacementL", "Displacement (L)"], ["fuelType", "Fuel type"]] as const;
const errorMessage = (error: unknown) => error instanceof Error ? error.message : "Vehicle reference could not be saved or loaded. Your vehicle details were kept; try again.";

function queryFor(value: ShopVehicleContext | undefined): VehicleReferenceQuery | null {
  const year = value?.year?.trim();
  if (year && !/^\d{4}$/.test(year)) return null;
  return normalizeVehicleReferenceQuery({ vin: value?.vin, ...(year ? { modelYear: Number(year) } : {}) });
}

/** Local history loads only when opened. Network lookup always needs its own explicit action. */
export function VehicleReferenceReview(props: Props) {
  const [opened, setOpened] = useState(false);
  const vin = normalizeVehicleReferenceQuery({ vin: props.value?.vin })?.vin ?? "invalid";
  const scope = getAccountScope();
  return <details className="mt-4 rounded-xl border border-[var(--ds-border)] p-3" onToggle={(event) => { if (event.currentTarget.open) setOpened(true); }}>
    <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold">NHTSA VIN reference</summary>
    {opened ? <ReferencePanel key={`${scope.userId}:${scope.generation}:${vin}`} {...props} vin={vin} /> : null}
  </details>;
}

function ReferencePanel({ value, onChange, disabled = false, vin }: Props & { vin: string }) {
  const [scope] = useState(getAccountScope);
  const [history, setHistory] = useState<VehicleIdentityReference[] | null>(null);
  const [historyError, setHistoryError] = useState("");
  const [selected, setSelected] = useState<VehicleIdentityReference | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const mounted = useRef(false), busyRef = useRef(false), historyRequest = useRef(0);
  const fingerprint = JSON.stringify(value ?? null);
  const latest = useRef({ value, onChange, disabled, fingerprint, revision: 0 });
  useLayoutEffect(() => {
    const revision = latest.current.revision + (latest.current.fingerprint !== fingerprint || latest.current.disabled !== disabled ? 1 : 0);
    latest.current = { value, onChange, disabled, fingerprint, revision };
  }, [value, onChange, disabled, fingerprint]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (vin === "invalid" || !isAccountScopeCurrent(scope)) return;
    let alive = true;
    const sequence = ++historyRequest.current;
    void readVehicleReferences(vin, scope).then((entries) => {
      if (alive && isAccountScopeCurrent(scope) && historyRequest.current === sequence) setHistory(entries);
    }).catch((error: unknown) => {
      if (alive && isAccountScopeCurrent(scope) && historyRequest.current === sequence) setHistoryError(errorMessage(error));
    });
    return () => { alive = false; };
  }, [vin, scope]);

  const current = () => mounted.current && isAccountScopeCurrent(scope);
  const matches = (binding: Binding) => current() && !latest.current.disabled && binding.fingerprint === latest.current.fingerprint && binding.revision === latest.current.revision;
  function begin(): Binding | null {
    if (!current() || latest.current.disabled || busyRef.current) return null;
    busyRef.current = true; setBusy(true); setMessage("");
    return { fingerprint: latest.current.fingerprint, revision: latest.current.revision };
  }
  function finish() { busyRef.current = false; if (current()) setBusy(false); }
  async function refreshHistory() {
    const sequence = ++historyRequest.current;
    try {
      const entries = await readVehicleReferences(vin, scope);
      if (current() && historyRequest.current === sequence) { setHistory(entries); setHistoryError(""); }
    } catch (error) { if (current() && historyRequest.current === sequence) setHistoryError(errorMessage(error)); }
  }
  async function saveReference(reference: VehicleIdentityReference, binding: Binding) {
    if (!matches(binding)) { if (current()) setMessage("Vehicle details changed during lookup. No suggestion was applied. Look up the current details again."); return; }
    setPending({ reference, binding });
    const saved = await appendVehicleReference(reference, scope);
    if (!current()) return;
    setPending(null);
    if (!matches(binding)) {
      setMessage("Vehicle details changed while the reference was being saved. Review it explicitly from saved references before using it.");
    } else { setSelected(saved); setMessage("Reference saved on this device. Review each field before using it."); }
    // The acknowledged reference is immediately available even if a subsequent read fails.
    setHistory((previous) => [saved, ...(previous ?? []).filter((entry) => entry.id !== saved.id)].sort((a, b) => Date.parse(b.retrievedAt) - Date.parse(a.retrievedAt)));
    void refreshHistory();
  }
  async function lookup() {
    const query = queryFor(latest.current.value);
    if (!query || pending) return;
    const binding = begin(); if (!binding) return;
    setSelected(null);
    try { await saveReference(await requestVehicleReference(query, scope), binding); }
    catch (error) { if (current()) setMessage(errorMessage(error)); }
    finally { finish(); }
  }
  async function retrySave() {
    if (!pending) return;
    if (!matches(pending.binding)) { if (current()) setMessage("Vehicle details changed after this lookup. Discard the unsaved reference and look up the current details again."); return; }
    if (!begin()) return;
    try { await saveReference(pending.reference, pending.binding); }
    catch (error) { if (current()) setMessage(errorMessage(error)); }
    finally { finish(); }
  }
  async function reload() { if (!begin()) return; try { await refreshHistory(); } finally { finish(); } }
  function apply(field: typeof FIELDS[number][0], fact: typeof FIELDS[number][1]) {
    if (!current() || latest.current.disabled || busyRef.current || !selected || !referenceAllowsSuggestions(selected)) return;
    const currentVin = normalizeVehicleReferenceQuery({ vin: latest.current.value?.vin })?.vin;
    const decoded = selected.facts[fact];
    if (selected.query.vin !== currentVin || !decoded) return;
    latest.current.onChange(updateVehicleContextField(latest.current.value, field, decoded));
    setMessage(`Decoded ${field} copied into the editor; its confirmation was cleared. Save the vehicle details when ready.`);
  }

  if (!isAccountScopeCurrent(scope)) return <p role="status" className="text-sm">Sign in and reopen vehicle details to review private device references.</p>;
  const query = queryFor(value);
  const controlsDisabled = disabled || busy;
  const canSuggest = selected ? referenceAllowsSuggestions(selected) : false;
  return <div className="space-y-4 text-sm">
    <p>Lookup sends only this VIN and the optional model year to NHTSA through DeepSpec. The returned reference is saved to your account&apos;s history on this device.</p>
    <p className="text-xs text-[var(--ds-fg-3)]">VIN decoding describes manufacturer-reported vehicle details. It cannot confirm the installed engine, modifications, part fitment or current condition.</p>
    {!query ? <p>Enter a complete 17-character VIN. If you supply a model year, use four digits from 1981 to 2099.</p> : <p>Lookup query: <span className="break-all">{query.vin}</span> · Model year: {query.modelYear ?? "not supplied"}</p>}
    <button type="button" className={BUTTON} disabled={controlsDisabled || !query || Boolean(pending)} onClick={() => void lookup()}>Look up VIN with NHTSA</button>
    {busy ? <p role="status">Loading or saving reference…</p> : null}
    {message ? <p role="status" className="whitespace-pre-wrap">{message}</p> : null}
    {pending ? <div className="space-y-2 rounded-lg border border-[var(--ds-border)] p-3">
      <p>The returned reference has not been acknowledged as saved. It is kept here for a retry; suggestions stay unavailable until it is saved.</p>
      <div className="flex flex-wrap gap-2"><button type="button" className={BUTTON} disabled={controlsDisabled} onClick={() => void retrySave()}>Retry saving reference</button>
        <button type="button" className={BUTTON} disabled={controlsDisabled} onClick={() => { if (current() && !busyRef.current && !latest.current.disabled) { setPending(null); setMessage("Unsaved reference discarded. Saved history and vehicle details were kept."); } }}>Discard unsaved reference</button></div>
    </div> : null}
    {selected ? <section aria-label="Saved NHTSA reference" className="space-y-3 rounded-lg border border-[var(--ds-border)] p-3">
      <h4 className="font-semibold">Saved reference for review</h4>
      <p><a className="underline" href={selected.sourceUrl} target="_blank" rel="noreferrer noopener">NHTSA vPIC source</a> · Retrieved <time dateTime={selected.retrievedAt}>{selected.retrievedAt}</time></p>
      <p>Original query: <span className="break-all">{selected.query.vin}</span> · Model year: {selected.query.modelYear ?? "not supplied"}</p>
      {String(selected.query.modelYear ?? "") !== (value?.year?.trim() ?? "") ? <p>The queried year differs from the current editor. Review the returned year and vehicle identity before using any field.</p> : null}
      <p>Decode codes: {selected.decode.codes.length ? selected.decode.codes.join(", ") : "not supplied"}</p>
      {selected.decode.messages.map((text, index) => <p key={index} className="whitespace-pre-wrap break-words">{text}</p>)}
      {!canSuggest ? <p role="note">This response does not have an unambiguous successful decode. Returned details remain visible for reference; enter checked details manually.</p> : null}
      {value?.modifications?.status === "modified" ? <p className="whitespace-pre-wrap break-words">Recorded modifications: {value.modifications.details || "details not supplied"}. A VIN reference cannot establish whether these changes altered the installed engine or other parts.</p> : <p>Modification status: {value?.modifications?.status === "none_known" ? "none known (user supplied)" : "unknown"}.</p>}
      <div className="grid gap-3 sm:grid-cols-2">{FIELDS.map(([field, fact, label]) => {
        const entered = value?.[field], decoded = selected.facts[fact], confirmed = isVehicleFieldConfirmed(value, field);
        const conflict = Boolean(entered?.trim() && decoded && entered.trim().toLowerCase() !== decoded.trim().toLowerCase());
        return <div key={field} className="min-w-0 rounded-lg border border-[var(--ds-border)] p-3" aria-label={`${label} comparison`}>
          <h5 className="font-semibold">{label}</h5><p className="break-words">Current: {entered || "not supplied"} {confirmed ? "(user-confirmed)" : "(not confirmed)"}</p>
          <p className="break-words">Decoded: {decoded || "not reported"}</p>
          {field === "year" && selected.query.modelYear !== undefined ? <p>NHTSA may return the model year supplied in this request; this does not independently verify the year.</p> : null}
          {conflict ? <p>{confirmed ? "Conflicts with your confirmed value." : "Differs from the current value."} Check the vehicle before replacing it.</p> : null}
          <button type="button" className={`${BUTTON} mt-2`} disabled={controlsDisabled || !canSuggest || !decoded} onClick={() => apply(field, fact)}>Use decoded {field}</button>
        </div>;
      })}</div>
      <dl className="space-y-1">{ATTRIBUTES.map(([key, label]) => <div key={key} className="flex flex-wrap gap-x-2"><dt>{label}:</dt><dd className="break-words">{selected.facts[key] || "not reported"}</dd></div>)}</dl>
      <p className="text-xs text-[var(--ds-fg-3)]">Engine attributes are separate source facts; they do not supply a missing engine model or code. Using a field changes this editor only and clears that field&apos;s confirmation. Use the existing Save action to keep vehicle details for future photos. Saved scans and photo drafts keep their original context.</p>
    </section> : null}
    {vin !== "invalid" ? <section aria-label="Device reference history" className="space-y-2">
      <h4 className="font-semibold">Saved references on this device</h4>
      <p className="text-xs">Up to 20 references per VIN. Selecting an old reference does not confirm the current vehicle details.</p>
      <button type="button" className={BUTTON} disabled={controlsDisabled} onClick={() => void reload()}>Reload saved references</button>
      {historyError ? <p role="alert">{historyError}</p> : history === null ? <p role="status">Loading device history…</p> : null}
      {history?.length === 0 ? <p>No saved references for this VIN on this device.</p> : null}
      {history?.map((reference) => <div key={reference.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--ds-border)] p-2">
        <span>Retrieved {reference.retrievedAt}; queried year {reference.query.modelYear ?? "not supplied"}</span>
        <button type="button" className={BUTTON} disabled={controlsDisabled || Boolean(pending)} onClick={() => {
          if (current() && !latest.current.disabled && !busyRef.current && reference.query.vin === normalizeVehicleReferenceQuery({ vin: latest.current.value?.vin })?.vin) { setSelected(reference); setMessage("Saved reference opened. Review it against the current editor; no fields were changed."); }
        }}>Review saved reference</button>
      </div>)}
    </section> : null}
  </div>;
}
