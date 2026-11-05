import { accountStorageKey, getAccountScope, setActiveAccount } from "../lib/accountScope";
import { confirmVehicleContextField } from "../lib/vehicleContext";
import { readVehicleProfile, saveVehicleProfile, VEHICLE_PROFILE_STORAGE_KEY } from "./vehicleProfile";

describe("selected vehicle profile", () => {
  beforeEach(() => { localStorage.clear(); setActiveAccount("vehicle-owner-a"); });
  afterEach(() => { vi.restoreAllMocks(); setActiveAccount(null); });

  it("round trips confirmed context and explicitly clears only the selected profile", () => {
    const context = confirmVehicleContextField({ year: "2014", mileage: "120000", mileageUnit: "mi" }, "mileage", true, "2026-11-05T12:00:00.000Z");
    localStorage.setItem(accountStorageKey("deep-spec:lookups"), "saved scans remain");
    expect(readVehicleProfile()).toEqual({ ok: true, value: undefined });
    expect(saveVehicleProfile(context)).toEqual({ ok: true, value: context });
    expect(readVehicleProfile()).toEqual({ ok: true, value: context });
    expect(saveVehicleProfile(undefined)).toEqual({ ok: true, value: undefined });
    expect(readVehicleProfile()).toEqual({ ok: true, value: undefined });
    expect(localStorage.getItem(accountStorageKey("deep-spec:lookups"))).toBe("saved scans remain");
  });

  it("isolates accounts and refuses stale scopes even after switching back", () => {
    const scope = getAccountScope();
    expect(saveVehicleProfile({ make: "Toyota" }, scope).ok).toBe(true);
    setActiveAccount("vehicle-owner-b");
    expect(readVehicleProfile()).toEqual({ ok: true, value: undefined });
    expect(saveVehicleProfile({ make: "Honda" }).ok).toBe(true);
    expect(readVehicleProfile(scope).ok).toBe(false);
    expect(saveVehicleProfile(undefined, scope).ok).toBe(false);
    setActiveAccount("vehicle-owner-a");
    expect(saveVehicleProfile({ make: "Ford" }, scope).ok).toBe(false);
    expect(readVehicleProfile()).toEqual({ ok: true, value: { make: "Toyota" } });
    setActiveAccount("vehicle-owner-b");
    expect(readVehicleProfile()).toEqual({ ok: true, value: { make: "Honda" } });
  });

  it("requires sign-in for reads and writes", () => {
    setActiveAccount(null);
    expect(readVehicleProfile().ok).toBe(false);
    expect(saveVehicleProfile({ year: "2014" }).ok).toBe(false);
    expect(localStorage.length).toBe(0);
  });

  it("does not expose a record if the account changes during a read", () => {
    saveVehicleProfile({ make: "Toyota" });
    const getItem = Storage.prototype.getItem;
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(function (this: Storage, key) {
      const value = getItem.call(this, key);
      setActiveAccount("vehicle-owner-b");
      return value;
    });
    expect(readVehicleProfile().ok).toBe(false);
  });

  it.each(["{broken", "null", "[]", "{}"])("reports corrupt data without erasing its bytes: %s", (raw) => {
    const key = accountStorageKey(VEHICLE_PROFILE_STORAGE_KEY);
    localStorage.setItem(key, raw);
    expect(readVehicleProfile().ok).toBe(false);
    expect(localStorage.getItem(key)).toBe(raw);
  });

  it("preserves usable facts while stripping stale confirmation from stored profiles", () => {
    localStorage.setItem(accountStorageKey(VEHICLE_PROFILE_STORAGE_KEY), JSON.stringify({ engine: "2.5L", confirmedFields: { engine: { value: "2.0L", confirmedAt: "2026-11-05T12:00:00.000Z" } } }));
    expect(readVehicleProfile()).toEqual({ ok: true, value: { engine: "2.5L" } });
  });

  it("keeps the previous profile when a write or clear fails", () => {
    saveVehicleProfile({ make: "Toyota" });
    const key = accountStorageKey(VEHICLE_PROFILE_STORAGE_KEY);
    const raw = localStorage.getItem(key);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("Full", "QuotaExceededError"); });
    expect(saveVehicleProfile({ make: "Honda" }).ok).toBe(false);
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => { throw new Error("Unavailable"); });
    expect(saveVehicleProfile(undefined).ok).toBe(false);
    expect(localStorage.getItem(key)).toBe(raw);
  });
});
