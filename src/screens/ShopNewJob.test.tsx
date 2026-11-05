import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ShopNewJob from "./ShopNewJob";
import { getShopJobs, getVehicleContextForJob } from "../services/shop";
import { isVehicleFieldConfirmed } from "../lib/vehicleContext";
import { setActiveAccount } from "../lib/accountScope";

const navigate = vi.hoisted(() => vi.fn());
vi.mock("react-router-dom", async () => ({ ...await vi.importActual<typeof import("react-router-dom")>("react-router-dom"), useNavigate: () => navigate }));
function field(label: string | RegExp, value: string) { fireEvent.change(screen.getByLabelText(label), { target: { value } }); }
function requiredJobFields() { field(/Job title/, "Noise check"); field(/Technician/, "Sam"); field(/Symptom \/ complaint/, "Noise when cold"); }

beforeEach(() => { localStorage.clear(); setActiveAccount("vehicle-intake-test"); navigate.mockClear(); });
describe("ShopNewJob vehicle intake", () => {
  it("keeps year, make and model required even though the shared editor allows unknown context", async () => {
    render(<MemoryRouter><ShopNewJob /></MemoryRouter>);
    requiredJobFields();
    await userEvent.click(screen.getByRole("button", { name: "Start scan" }));
    expect(screen.getByRole("alert")).toHaveTextContent("vehicle year, vehicle make, vehicle model");
    expect(navigate).not.toHaveBeenCalled();
    expect(getShopJobs()).toEqual([]);
  });

  it("persists explicit context confirmations and job extras through shared editor changes", async () => {
    render(<MemoryRouter><ShopNewJob /></MemoryRouter>);
    requiredJobFields(); field("Year", "2014"); field("Make", "Toyota"); field("Model", "Camry");
    field("Mileage", "120000"); field("VIN", "1HGCM82633A004352"); field("Customer name", "A. Driver"); field("Bay / RO number", "RO-7");
    await userEvent.selectOptions(screen.getByLabelText("Mileage unit"), "mi");
    await userEvent.click(screen.getByRole("button", { name: "Confirm mileage" }));
    await userEvent.selectOptions(screen.getByLabelText("Modifications", { exact: true }), "none_known");
    await userEvent.click(screen.getByRole("button", { name: "Confirm modifications" }));
    expect(screen.getAllByLabelText(/Symptom \/ complaint/)).toHaveLength(1);
    await userEvent.click(screen.getByRole("button", { name: "Start scan" }));
    const job = getShopJobs()[0];
    expect(job).toMatchObject({ symptom: "Noise when cold", customerName: "A. Driver", bayOrRo: "RO-7", mileage: "120000", mileageUnit: "mi", modifications: { status: "none_known" } });
    const context = getVehicleContextForJob(job);
    expect(isVehicleFieldConfirmed(context, "mileage")).toBe(true);
    expect(isVehicleFieldConfirmed(context, "modifications")).toBe(true);
    expect(isVehicleFieldConfirmed(context, "vin")).toBe(false);
    expect(navigate).toHaveBeenCalledWith(`/scan?jobId=${encodeURIComponent(job.id)}`);
  });
});
