import { getAccountScope, isAccountScopeCurrent, type AccountScope } from "../lib/accountScope";
import { normalizeVehicleContext } from "../lib/vehicleContext";
import type { ShopVehicleContext } from "../types";

export const VEHICLE_PROFILE_STORAGE_KEY = "deep-spec:vehicle-profile";
export type VehicleProfileResult = { ok: true; value: ShopVehicleContext | undefined } | { ok: false; message: string };
const accountChanged = (): VehicleProfileResult => ({ ok: false, message: "Account changed. Reopen vehicle details in the signed-in account." });
const keyFor = (scope: AccountScope) => `deep-spec:account:${encodeURIComponent(scope.userId!)}:${VEHICLE_PROFILE_STORAGE_KEY}`;

/** A selected profile is a device preference. Saved scans retain their own snapshots. */
export function readVehicleProfile(scope = getAccountScope()): VehicleProfileResult {
  if (!isAccountScopeCurrent(scope)) return accountChanged();
  try {
    const raw = localStorage.getItem(keyFor(scope));
    if (!isAccountScopeCurrent(scope)) return accountChanged();
    if (raw === null) return { ok: true, value: undefined };
    const parsed: unknown = JSON.parse(raw);
    const value = normalizeVehicleContext(parsed);
    if (!value) return { ok: false, message: "Saved vehicle details could not be read. The stored record was kept; review and save the details again." };
    return { ok: true, value };
  } catch {
    return { ok: false, message: "Saved vehicle details could not be read on this device. The stored record was kept." };
  }
}

export function saveVehicleProfile(value: ShopVehicleContext | undefined, scope = getAccountScope()): VehicleProfileResult {
  if (!isAccountScopeCurrent(scope)) return accountChanged();
  const normalized = normalizeVehicleContext(value);
  if (value !== undefined && !normalized) return { ok: false, message: "Add valid vehicle details, or explicitly clear the selected vehicle." };
  try {
    const key = keyFor(scope);
    const serialized = normalized ? JSON.stringify(normalized) : undefined;
    if (!isAccountScopeCurrent(scope)) return accountChanged();
    if (serialized === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, serialized);
    if (!isAccountScopeCurrent(scope)) return accountChanged();
    return { ok: true, value: normalized };
  } catch {
    return { ok: false, message: "Vehicle details could not be saved on this device. Keep the editor open and retry." };
  }
}
