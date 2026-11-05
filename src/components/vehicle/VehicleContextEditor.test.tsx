import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ShopVehicleContext } from "../../types";
import { confirmVehicleContextField, isVehicleFieldConfirmed } from "../../lib/vehicleContext";
import { VehicleContextEditor } from "./VehicleContextEditor";

function setup(initial?: ShopVehicleContext, disabled = false) {
  const changed = vi.fn();
  function Controlled() {
    const [value, setValue] = useState(initial);
    return <VehicleContextEditor value={value} disabled={disabled} onChange={(next) => { changed(next); setValue(next); }} />;
  }
  render(<Controlled />);
  return { changed, latest: () => changed.mock.calls.at(-1)?.[0] as ShopVehicleContext };
}

describe("VehicleContextEditor", () => {
  it("keeps supplied VIN unconfirmed until the user explicitly confirms it", async () => {
    const { changed, latest } = setup({ vin: "1HGCM82633A004352" });
    expect(changed).not.toHaveBeenCalled();
    expect(screen.getByLabelText("VIN confirmation")).toHaveTextContent("Supplied, not confirmed");
    await userEvent.click(screen.getByRole("button", { name: "Confirm vin" }));
    expect(isVehicleFieldConfirmed(latest(), "vin")).toBe(true);
    expect(screen.getByLabelText("VIN confirmation")).toHaveTextContent("User-confirmed");
    await userEvent.click(screen.getByRole("button", { name: "Clear vin confirmation" }));
    expect(isVehicleFieldConfirmed(latest(), "vin")).toBe(false);
  });

  it("clears only the edited field confirmation and preserves shop extras and spaces", async () => {
    let context = confirmVehicleContextField({ make: "Toyota", model: "Camry", symptom: "Noise at idle", bayOrRo: "RO-7", notes: "Customer note" }, "make", true);
    context = confirmVehicleContextField(context, "model", true);
    const { latest } = setup(context);
    await userEvent.clear(screen.getByLabelText("Make", { exact: true }));
    await userEvent.type(screen.getByLabelText("Make", { exact: true }), "Land Rover");
    expect(screen.getByLabelText("Make", { exact: true })).toHaveValue("Land Rover");
    expect(isVehicleFieldConfirmed(latest(), "make")).toBe(false);
    expect(isVehicleFieldConfirmed(latest(), "model")).toBe(true);
    expect(latest()).toMatchObject({ symptom: "Noise at idle", bayOrRo: "RO-7", notes: "Customer note" });
  });

  it("requires mileage units and invalidates confirmation when the unit changes", async () => {
    const { latest } = setup({ mileage: "120000" });
    expect(screen.getByRole("button", { name: "Confirm mileage" })).toBeDisabled();
    await userEvent.selectOptions(screen.getByLabelText("Mileage unit"), "mi");
    await userEvent.click(screen.getByRole("button", { name: "Confirm mileage" }));
    expect(isVehicleFieldConfirmed(latest(), "mileage")).toBe(true);
    await userEvent.selectOptions(screen.getByLabelText("Mileage unit"), "km");
    expect(isVehicleFieldConfirmed(latest(), "mileage")).toBe(false);
    expect(latest()).toMatchObject({ mileage: "120000", mileageUnit: "km" });
  });

  it("requires modification details, clears their confirmation on edit, and distinguishes unknown", async () => {
    const { latest } = setup();
    expect(screen.getByRole("button", { name: "Confirm modifications" })).toBeDisabled();
    await userEvent.selectOptions(screen.getByLabelText("Modifications", { exact: true }), "modified");
    expect(screen.getByRole("button", { name: "Confirm modifications" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Modification details"), { target: { value: "Replacement engine" } });
    await userEvent.click(screen.getByRole("button", { name: "Confirm modifications" }));
    expect(isVehicleFieldConfirmed(latest(), "modifications")).toBe(true);
    fireEvent.change(screen.getByLabelText("Modification details"), { target: { value: "Replacement engine; details pending" } });
    expect(isVehicleFieldConfirmed(latest(), "modifications")).toBe(false);
    await userEvent.selectOptions(screen.getByLabelText("Modifications", { exact: true }), "unknown");
    expect(latest().modifications).toEqual({ status: "unknown" });
    expect(screen.getByRole("button", { name: "Confirm modifications" })).toBeDisabled();
  });

  it("does not confirm an unknown text value and supports an explicit none-known modification record", async () => {
    const { latest } = setup({ engine: "Unknown" });
    expect(screen.getByRole("button", { name: "Confirm engine" })).toBeDisabled();
    await userEvent.selectOptions(screen.getByLabelText("Modifications", { exact: true }), "none_known");
    await userEvent.click(screen.getByRole("button", { name: "Confirm modifications" }));
    expect(latest().modifications).toEqual({ status: "none_known" });
    expect(isVehicleFieldConfirmed(latest(), "modifications")).toBe(true);
  });

  it("disables text, selectors and confirmation while its owner is busy", () => {
    const { changed } = setup({ make: "Toyota" }, true);
    expect(screen.getByLabelText("Make", { exact: true })).toBeDisabled();
    expect(screen.getByLabelText("Mileage unit")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Confirm make" })).toBeDisabled();
    expect(changed).not.toHaveBeenCalled();
  });

  it("records an optional symptom without treating it as confirmed vehicle identity", () => {
    const { latest } = setup(confirmVehicleContextField({ model: "Camry" }, "model", true));
    fireEvent.change(screen.getByLabelText("Symptom / complaint (optional)"), { target: { value: "Rattle only while cold" } });
    expect(latest().symptom).toBe("Rattle only while cold");
    expect(isVehicleFieldConfirmed(latest(), "model")).toBe(true);
    expect(screen.queryByRole("button", { name: /Confirm symptom/i })).not.toBeInTheDocument();
  });
});
