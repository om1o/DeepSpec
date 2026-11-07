import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ShopVehicleContext } from "../../types";
import type { VehicleIdentityReference } from "../../types/vehicleReference";
import { VEHICLE_REFERENCE_ADAPTER_VERSION, VEHICLE_REFERENCE_SOURCE_URL } from "../../types/vehicleReference";
import { getAccountScope, setActiveAccount } from "../../lib/accountScope";
import { confirmVehicleContextField, isVehicleFieldConfirmed } from "../../lib/vehicleContext";
import { requestVehicleReference } from "../../services/vehicleReference";
import { appendVehicleReference, readVehicleReferences } from "../../services/vehicleReferenceStore";
import { VehicleReferenceReview } from "./VehicleReferenceReview";

vi.mock("../../services/vehicleReference", () => ({ requestVehicleReference: vi.fn() }));
vi.mock("../../services/vehicleReferenceStore", () => ({ appendVehicleReference: vi.fn(), readVehicleReferences: vi.fn() }));

const VIN = "1HGCM82633A004352", OTHER_VIN = "2T1BURHE6JC003971";
function reference(overrides: Partial<VehicleIdentityReference> = {}): VehicleIdentityReference {
  return {
    version: 1, id: "b0cbf559-868e-4f14-9755-7d22171ad102", provider: "nhtsa-vpic", adapterVersion: VEHICLE_REFERENCE_ADAPTER_VERSION,
    sourceUrl: VEHICLE_REFERENCE_SOURCE_URL, retrievedAt: "2026-11-05T12:00:00.000Z", query: { vin: VIN, modelYear: 2003 },
    facts: { year: "2003", make: "HONDA", model: "Accord", engineModel: "J30A4", cylinders: "6", displacementL: "3.0", fuelType: "Gasoline", engineManufacturer: "Honda" },
    decode: { codes: ["0"], messages: ["VIN decoded cleanly." ] }, ...overrides,
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function setup(initial: ShopVehicleContext | undefined = { vin: VIN, year: "2003" }, initiallyDisabled = false) {
  let value = initial, disabled = initiallyDisabled;
  const changed = vi.fn((next: ShopVehicleContext | undefined) => { value = next; view.rerender(component()); });
  const component = () => <VehicleReferenceReview value={value} onChange={changed} disabled={disabled} />;
  const view = render(component());
  return {
    ...view, changed, latest: () => value,
    update(next: ShopVehicleContext | undefined) { value = next; view.rerender(component()); },
    disable(next: boolean) { disabled = next; view.rerender(component()); },
  };
}
function openPanel() {
  const details = screen.getByText("NHTSA VIN reference", { selector: "summary" }).closest("details")!;
  details.open = true;
  fireEvent(details, new Event("toggle"));
}
const lookupButton = () => screen.getByRole("button", { name: "Look up VIN with NHTSA" });
async function lookupAndReview() {
  await userEvent.click(lookupButton());
  return screen.findByRole("region", { name: "Saved NHTSA reference" });
}
let saved: VehicleIdentityReference[];
beforeEach(() => {
  vi.resetAllMocks(); saved = []; setActiveAccount("vehicle-reference-owner");
  vi.mocked(requestVehicleReference).mockResolvedValue(reference());
  vi.mocked(readVehicleReferences).mockImplementation(async (vin) => saved.filter((entry) => entry.query.vin === vin));
  vi.mocked(appendVehicleReference).mockImplementation(async (entry) => { saved = [...saved.filter((previous) => previous.id !== entry.id), entry]; return entry; });
});
afterEach(() => { cleanup(); setActiveAccount(null); });

describe("VehicleReferenceReview", () => {
  it("keeps the saved reference attached when copying a decoded field", async () => {
    const ui = setup(); openPanel();
    const panel = await lookupAndReview();
    await userEvent.click(within(panel).getByRole("button", { name: "Use decoded make" }));
    expect(ui.latest()).toMatchObject({
      make: "HONDA", referenceOrigins: { references: [reference()], fields: { make: reference().id } },
    });
  });

  it("opens a source carried by saved vehicle fields when this device has no lookup history", async () => {
    const source = reference();
    const context = { vin: VIN, make: "HONDA", referenceOrigins: { references: [source], fields: { make: source.id } } };
    const ui = setup(context); openPanel();
    await screen.findByText("No saved references for this VIN on this device.");
    await userEvent.click(screen.getByRole("button", { name: "Review field source" }));
    const panel = screen.getByRole("region", { name: "Saved NHTSA reference" });
    expect(within(panel).getByText(/VIN decoded cleanly/)).toBeInTheDocument();
    expect(within(panel).getByRole("link", { name: "NHTSA vPIC source" })).toHaveAttribute("href", source.sourceUrl);
    expect(ui.latest()).toEqual(context);
    expect(ui.changed).not.toHaveBeenCalled();
    expect(requestVehicleReference).not.toHaveBeenCalled();
  });

  it("does no automatic network lookup and loads only device history when opened", async () => {
    setup();
    expect(readVehicleReferences).not.toHaveBeenCalled(); expect(requestVehicleReference).not.toHaveBeenCalled();
    openPanel();
    await screen.findByText("No saved references for this VIN on this device.");
    expect(readVehicleReferences).toHaveBeenCalledWith(VIN, getAccountScope());
    expect(requestVehicleReference).not.toHaveBeenCalled(); expect(appendVehicleReference).not.toHaveBeenCalled();
    expect(screen.getByText(/Lookup sends only this VIN and the optional model year/)).toBeInTheDocument();
  });

  it.each([
    { vin: "1HGCM826" }, { vin: "1HGCM82633A00435I" }, { vin: VIN, year: "1980" },
    { vin: VIN, year: "2100" }, { vin: VIN, year: "2003.0" }, { vin: VIN, year: "2e3" }, { vin: VIN, year: "unknown" },
  ])("rejects an invalid lookup query without a request: %j", (context) => {
    setup(context); openPanel();
    expect(lookupButton()).toBeDisabled(); fireEvent.click(lookupButton());
    expect(requestVehicleReference).not.toHaveBeenCalled();
  });

  it("permits missing year and sends only canonical VIN, never the other editor details", async () => {
    vi.mocked(requestVehicleReference).mockResolvedValue(reference({ query: { vin: VIN } }));
    setup({ vin: VIN.toLowerCase(), make: "Manual make", symptom: "Private complaint", notes: "Private notes", customerName: "Private customer" }); openPanel();
    await lookupAndReview();
    expect(requestVehicleReference).toHaveBeenCalledExactlyOnceWith({ vin: VIN }, getAccountScope());
  });

  it("sends an optional numeric model year and waits for device acknowledgement before allowing suggestions", async () => {
    const saving = deferred<VehicleIdentityReference>();
    vi.mocked(appendVehicleReference).mockReturnValueOnce(saving.promise);
    const ui = setup(); openPanel(); await userEvent.click(lookupButton());
    await waitFor(() => expect(appendVehicleReference).toHaveBeenCalledOnce());
    expect(requestVehicleReference).toHaveBeenCalledExactlyOnceWith({ vin: VIN, modelYear: 2003 }, getAccountScope());
    expect(screen.queryByRole("region", { name: "Saved NHTSA reference" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Use decoded engine" })).not.toBeInTheDocument();
    expect(ui.changed).not.toHaveBeenCalled();
    await act(async () => { saving.resolve(reference()); });
    const review = await screen.findByRole("region", { name: "Saved NHTSA reference" });
    expect(within(review).getByRole("link", { name: "NHTSA vPIC source" })).toHaveAttribute("href", VEHICLE_REFERENCE_SOURCE_URL);
    expect(within(review).getByRole("link")).toHaveAttribute("rel", "noreferrer noopener");
    expect(within(review).getByText(/Retrieved/)).toHaveTextContent("2026-11-05T12:00:00.000Z");
  });

  it("retains a failed local save for an exact retry without issuing another lookup", async () => {
    vi.mocked(appendVehicleReference).mockRejectedValueOnce(new Error("Device storage is full. Free space and retry."));
    setup(); openPanel(); await userEvent.click(lookupButton());
    await screen.findByText("Device storage is full. Free space and retry.");
    expect(lookupButton()).toBeDisabled();
    expect(screen.queryByRole("region", { name: "Saved NHTSA reference" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Retry saving reference" }));
    await screen.findByRole("region", { name: "Saved NHTSA reference" });
    expect(requestVehicleReference).toHaveBeenCalledOnce(); expect(appendVehicleReference).toHaveBeenCalledTimes(2);
    expect(vi.mocked(appendVehicleReference).mock.calls[0]).toEqual(vi.mocked(appendVehicleReference).mock.calls[1]);
  });

  it("labels a supplied model year as potentially echoed and still clears its confirmation on explicit use", async () => {
    const ui = setup(confirmVehicleContextField({ vin: VIN, year: "2003" }, "year", true)); openPanel();
    const review = await lookupAndReview();
    expect(within(review).getByLabelText("Year comparison")).toHaveTextContent("NHTSA may return the model year supplied in this request; this does not independently verify the year.");
    await userEvent.click(within(review).getByRole("button", { name: "Use decoded year" }));
    expect(ui.latest()?.year).toBe("2003"); expect(isVehicleFieldConfirmed(ui.latest(), "year")).toBe(false);
  });

  it("does not save or apply a failed lookup, and makes the action available again", async () => {
    vi.mocked(requestVehicleReference).mockRejectedValueOnce(new Error("Vehicle lookup is temporarily limited. Wait before trying again."));
    const ui = setup(); openPanel(); await userEvent.click(lookupButton());
    await screen.findByText(/Vehicle lookup is temporarily limited/);
    expect(lookupButton()).toBeEnabled(); expect(appendVehicleReference).not.toHaveBeenCalled(); expect(ui.changed).not.toHaveBeenCalled();
  });

  it.each([{ codes: [] }, { codes: ["1"] }, { codes: ["0", "1"] }, { codes: ["0", "0"] }])("shows returned facts but blocks suggestions for decode codes $codes", async ({ codes }) => {
    vi.mocked(requestVehicleReference).mockResolvedValue(reference({ decode: { codes, messages: ["Check supplied VIN."] } }));
    const ui = setup(); openPanel(); const review = await lookupAndReview();
    expect(within(review).getByText("Decoded: Accord")).toBeInTheDocument();
    expect(within(review).getByText(/does not have an unambiguous successful decode/)).toBeInTheDocument();
    expect(within(review).getByRole("button", { name: "Use decoded model" })).toBeDisabled();
    expect(ui.changed).not.toHaveBeenCalled();
  });

  it("never constructs a missing engine model from separate engine attributes", async () => {
    vi.mocked(requestVehicleReference).mockResolvedValue(reference({ facts: { cylinders: "6", displacementL: "3.0", fuelType: "Gasoline" } }));
    setup(); openPanel(); const review = await lookupAndReview();
    expect(within(review).getByRole("button", { name: "Use decoded engine" })).toBeDisabled();
    expect(within(review).getByLabelText("Engine model comparison")).toHaveTextContent("Decoded: not reported");
    expect(within(review).getByText("3.0")).toBeInTheDocument();
  });

  it("clears only each applied field's confirmation and uses current values for sequential application", async () => {
    let context = confirmVehicleContextField({ vin: VIN, year: "2003", make: "Custom make", model: "Existing model", engine: "Replacement engine", mileage: "120000", mileageUnit: "mi", modifications: { status: "modified", details: "Engine swap" }, notes: "Keep shop note", customerName: "Keep customer" }, "make", true);
    context = confirmVehicleContextField(context, "model", true); context = confirmVehicleContextField(context, "engine", true);
    const ui = setup(context); openPanel(); const review = await lookupAndReview();
    expect(within(review).getByLabelText("Engine model comparison")).toHaveTextContent("Conflicts with your confirmed value.");
    expect(within(review).getByText(/Recorded modifications: Engine swap/)).toBeInTheDocument();
    await userEvent.click(within(review).getByRole("button", { name: "Use decoded make" }));
    expect(ui.latest()?.make).toBe("HONDA"); expect(isVehicleFieldConfirmed(ui.latest(), "make")).toBe(false);
    expect(isVehicleFieldConfirmed(ui.latest(), "model")).toBe(true); expect(isVehicleFieldConfirmed(ui.latest(), "engine")).toBe(true);
    ui.update({ ...ui.latest(), symptom: "New unrelated edit" });
    await userEvent.click(screen.getByRole("button", { name: "Use decoded engine" }));
    expect(ui.latest()).toMatchObject({ make: "HONDA", model: "Existing model", engine: "J30A4", symptom: "New unrelated edit", notes: "Keep shop note", customerName: "Keep customer", mileage: "120000", mileageUnit: "mi", modifications: { status: "modified", details: "Engine swap" } });
    expect(isVehicleFieldConfirmed(ui.latest(), "engine")).toBe(false); expect(isVehicleFieldConfirmed(ui.latest(), "model")).toBe(true);
    expect(appendVehicleReference).toHaveBeenCalledOnce(); expect(requestVehicleReference).toHaveBeenCalledOnce();
  });

  it.each([
    { year: "2004" }, { modifications: { status: "modified" as const, details: "New engine" } }, { customerName: "Changed private field" }, { make: "Manual edit " },
  ])("rejects a pending response when any editor context changes: %j", async (edit) => {
    const response = deferred<VehicleIdentityReference>(); vi.mocked(requestVehicleReference).mockReturnValueOnce(response.promise);
    const ui = setup(); openPanel(); await userEvent.click(lookupButton());
    ui.update({ ...ui.latest(), ...edit });
    await act(async () => { response.resolve(reference()); });
    await screen.findByText(/Vehicle details changed during lookup/);
    expect(appendVehicleReference).not.toHaveBeenCalled(); expect(ui.changed).not.toHaveBeenCalled();
  });

  it("rejects a response even if changed details are reverted while the request is pending", async () => {
    const response = deferred<VehicleIdentityReference>(); vi.mocked(requestVehicleReference).mockReturnValueOnce(response.promise);
    const ui = setup(); openPanel(); await userEvent.click(lookupButton());
    ui.update({ vin: VIN, year: "2004" }); ui.update({ vin: VIN, year: "2003" });
    await act(async () => { response.resolve(reference()); });
    expect(appendVehicleReference).not.toHaveBeenCalled(); await screen.findByText(/Vehicle details changed during lookup/);
  });

  it("does not automatically review a reference if context changed during its device save", async () => {
    const saving = deferred<VehicleIdentityReference>(); vi.mocked(appendVehicleReference).mockReturnValueOnce(saving.promise);
    const ui = setup(); openPanel(); await userEvent.click(lookupButton());
    await waitFor(() => expect(appendVehicleReference).toHaveBeenCalledOnce());
    ui.update({ vin: VIN, year: "2004" });
    await act(async () => { saved = [reference()]; saving.resolve(reference()); });
    await screen.findByText(/Vehicle details changed while the reference was being saved/);
    expect(screen.queryByRole("region", { name: "Saved NHTSA reference" })).not.toBeInTheDocument(); expect(ui.changed).not.toHaveBeenCalled();
    await userEvent.click(await screen.findByRole("button", { name: "Review saved reference" }));
    expect(await screen.findByRole("region", { name: "Saved NHTSA reference" })).toHaveTextContent("The queried year differs from the current editor.");
  });

  it("prevents retrying an unsaved result against subsequently changed context", async () => {
    vi.mocked(appendVehicleReference).mockRejectedValueOnce(new Error("Save failed."));
    const ui = setup(); openPanel(); await userEvent.click(lookupButton()); await screen.findByText("Save failed.");
    ui.update({ vin: VIN, year: "2004" }); await userEvent.click(screen.getByRole("button", { name: "Retry saving reference" }));
    await screen.findByText(/Vehicle details changed after this lookup/); expect(appendVehicleReference).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByRole("button", { name: "Discard unsaved reference" }));
    expect(lookupButton()).toBeEnabled(); expect(ui.latest()?.year).toBe("2004");
  });

  it.each(["account", "unmount", "vin"] as const)("ignores a late lookup after %s changes", async (change) => {
    const response = deferred<VehicleIdentityReference>(); vi.mocked(requestVehicleReference).mockReturnValueOnce(response.promise);
    const ui = setup(); openPanel(); await userEvent.click(lookupButton());
    if (change === "account") { setActiveAccount("other-owner"); ui.update({ vin: VIN, year: "2003" }); }
    else if (change === "vin") ui.update({ vin: OTHER_VIN, year: "2003" });
    else ui.unmount();
    await act(async () => { response.resolve(reference()); });
    expect(appendVehicleReference).not.toHaveBeenCalled(); expect(ui.changed).not.toHaveBeenCalled();
    expect(screen.queryByRole("region", { name: "Saved NHTSA reference" })).not.toBeInTheDocument();
  });

  it("keeps saved history local and requires explicit review even when the old query year differs", async () => {
    saved = [reference()]; const ui = setup({ vin: VIN, year: "2004" }); openPanel();
    const choose = await screen.findByRole("button", { name: "Review saved reference" });
    expect(screen.queryByRole("region", { name: "Saved NHTSA reference" })).not.toBeInTheDocument();
    await userEvent.click(choose);
    expect(screen.getByRole("region", { name: "Saved NHTSA reference" })).toHaveTextContent("The queried year differs from the current editor.");
    await userEvent.click(screen.getByRole("button", { name: "Use decoded year" }));
    expect(ui.latest()?.year).toBe("2003"); expect(isVehicleFieldConfirmed(ui.latest(), "year")).toBe(false);
    expect(requestVehicleReference).not.toHaveBeenCalled(); expect(appendVehicleReference).not.toHaveBeenCalled();
  });

  it("does not show another VIN's late history or auto-select the prior reference after switching back", async () => {
    const history = deferred<VehicleIdentityReference[]>(); vi.mocked(readVehicleReferences).mockReturnValueOnce(history.promise);
    const ui = setup(); openPanel(); ui.update({ vin: OTHER_VIN });
    await act(async () => { history.resolve([reference()]); });
    expect(screen.queryByRole("button", { name: "Review saved reference" })).not.toBeInTheDocument();
    saved = [reference()]; ui.update({ vin: VIN });
    await screen.findByRole("button", { name: "Review saved reference" });
    expect(screen.queryByRole("region", { name: "Saved NHTSA reference" })).not.toBeInTheDocument();
  });

  it("shows history read errors honestly and can retry without a network lookup", async () => {
    vi.mocked(readVehicleReferences).mockRejectedValueOnce(new Error("Saved references are corrupt; they were preserved."));
    setup(); openPanel(); expect(await screen.findByRole("alert")).toHaveTextContent("Saved references are corrupt");
    expect(screen.queryByText("No saved references for this VIN on this device.")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Reload saved references" }));
    await screen.findByText("No saved references for this VIN on this device."); expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(requestVehicleReference).not.toHaveBeenCalled();
  });

  it("disables lookup, history selection and applying values while the editor owner is busy", async () => {
    saved = [reference()]; const ui = setup(undefined, true); ui.update({ vin: VIN, year: "2003" }); openPanel();
    const history = await screen.findByRole("button", { name: "Review saved reference" });
    expect(lookupButton()).toBeDisabled(); expect(history).toBeDisabled(); expect(screen.getByRole("button", { name: "Reload saved references" })).toBeDisabled();
    ui.disable(false); await userEvent.click(history); ui.disable(true);
    expect(screen.getByRole("button", { name: "Use decoded year" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Use decoded year" })); expect(ui.changed).not.toHaveBeenCalled();
    expect(requestVehicleReference).not.toHaveBeenCalled();
  });

  it("rejects an in-flight result if the editor becomes disabled, and prevents duplicate submissions", async () => {
    const response = deferred<VehicleIdentityReference>(); vi.mocked(requestVehicleReference).mockReturnValueOnce(response.promise);
    const ui = setup(); openPanel(); fireEvent.click(lookupButton()); fireEvent.click(lookupButton());
    expect(requestVehicleReference).toHaveBeenCalledOnce(); ui.disable(true);
    await act(async () => { response.resolve(reference()); });
    expect(appendVehicleReference).not.toHaveBeenCalled(); expect(ui.changed).not.toHaveBeenCalled();
  });
});
