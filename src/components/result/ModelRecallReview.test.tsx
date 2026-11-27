import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ModelRecallReview } from "./ModelRecallReview";
import { NHTSA_VIN_RECALL_URL, requestModelRecalls, type ModelRecallResult } from "../../services/modelRecalls";

vi.mock("../../services/modelRecalls", async (original) => ({
  ...await original<typeof import("../../services/modelRecalls")>(),
  requestModelRecalls: vi.fn(),
}));

const vehicle = { year: "2012", make: "Acura", model: "RDX", vin: "1HGCM82633A004352" };
const result = {
  query: { year: 2012, make: "Acura", model: "RDX" }, retrievedAt: "2026-11-26T12:00:00.000Z",
  sourceUrl: "https://api.nhtsa.gov/recalls/recallsByVehicle?make=Acura&model=RDX&modelYear=2012",
  recalls: [{ campaignNumber: "19V182000", component: "AIR BAGS", summary: "Model-wide recall.", consequence: "Risk of injury.", remedy: "See dealer." }],
};

describe("ModelRecallReview", () => {
  afterEach(() => { cleanup(); vi.resetAllMocks(); });

  it("offers VIN lookup even when model context is missing", () => {
    render(<ModelRecallReview />);
    const panel = screen.getByRole("region", { name: "Safety recalls" });
    expect(within(panel).getByRole("link", { name: /Check this vehicle's VIN at NHTSA/ })).toHaveAttribute("href", NHTSA_VIN_RECALL_URL);
    expect(within(panel).queryByRole("button", { name: "Search model-wide recalls" })).not.toBeInTheDocument();
    expect(panel).toHaveTextContent("Add a valid year, make, and model");
    expect(panel).toHaveTextContent("sends the displayed year, make, and model to NHTSA");
  });

  it("labels campaigns as model-wide, preserves source, and never calls them VIN-open recalls", async () => {
    vi.mocked(requestModelRecalls).mockResolvedValue(result);
    render(<ModelRecallReview vehicleContext={vehicle} />);
    const panel = screen.getByRole("region", { name: "Safety recalls" });
    expect(panel).toHaveTextContent("not all user-confirmed");
    await userEvent.click(within(panel).getByRole("button", { name: "Search model-wide recalls" }));
    expect(requestModelRecalls).toHaveBeenCalledWith(vehicle);
    expect(await within(panel).findByText(/NHTSA returned 1 model-wide campaign/)).toBeInTheDocument();
    expect(panel).toHaveTextContent("may not apply to this VIN or may already be repaired");
    expect(within(panel).getByRole("link", { name: "NHTSA model data" })).toHaveAttribute("href", result.sourceUrl);
    expect(within(panel).getByText("AIR BAGS · 19V182000")).toBeInTheDocument();
    expect(panel).not.toHaveTextContent("open recall for your VIN");
  });

  it("treats zero model results as no VIN or safety clearance", async () => {
    vi.mocked(requestModelRecalls).mockResolvedValue({ ...result, recalls: [] });
    render(<ModelRecallReview vehicleContext={vehicle} />);
    await userEvent.click(screen.getByRole("button", { name: "Search model-wide recalls" }));
    expect(await screen.findByText(/This does not clear the VIN or establish that the vehicle is safe/)).toBeInTheDocument();
  });

  it("shows a bounded failure and discards old results when vehicle details change", async () => {
    vi.mocked(requestModelRecalls).mockResolvedValueOnce(result).mockRejectedValueOnce(new Error("NHTSA is unavailable."));
    const view = render(<ModelRecallReview vehicleContext={vehicle} />);
    await userEvent.click(screen.getByRole("button", { name: "Search model-wide recalls" }));
    await screen.findByText(/NHTSA returned 1 model-wide campaign/);
    view.rerender(<ModelRecallReview vehicleContext={{ ...vehicle, year: "2013" }} />);
    expect(screen.queryByText(/NHTSA returned 1 model-wide campaign/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Search model-wide recalls" }));
    expect(await screen.findByRole("status")).toHaveTextContent("NHTSA is unavailable.");
  });

  it("does not revive an old result when vehicle details change away and back", async () => {
    vi.mocked(requestModelRecalls).mockResolvedValue(result);
    const view = render(<ModelRecallReview vehicleContext={vehicle} />);
    await userEvent.click(screen.getByRole("button", { name: "Search model-wide recalls" }));
    await screen.findByText(/NHTSA returned 1 model-wide campaign/);
    view.rerender(<ModelRecallReview vehicleContext={{ ...vehicle, year: "2013" }} />);
    view.rerender(<ModelRecallReview vehicleContext={vehicle} />);
    expect(screen.queryByText(/NHTSA returned 1 model-wide campaign/)).not.toBeInTheDocument();
  });

  it("ignores an older lookup that finishes while a new vehicle query is pending", async () => {
    let resolveFirst!: (value: ModelRecallResult) => void;
    let resolveSecond!: (value: ModelRecallResult) => void;
    vi.mocked(requestModelRecalls)
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveSecond = resolve; }));
    const view = render(<ModelRecallReview vehicleContext={vehicle} />);
    await userEvent.click(screen.getByRole("button", { name: "Search model-wide recalls" }));
    view.rerender(<ModelRecallReview vehicleContext={{ ...vehicle, year: "2013" }} />);
    await userEvent.click(screen.getByRole("button", { name: "Search model-wide recalls" }));
    await act(async () => resolveFirst(result));
    expect(screen.getByRole("button", { name: "Checking NHTSA…" })).toBeDisabled();
    expect(screen.queryByText(/NHTSA returned 1 model-wide campaign/)).not.toBeInTheDocument();
    await act(async () => resolveSecond({ ...result, query: { ...result.query, year: 2013 } }));
    expect(await screen.findByText(/NHTSA returned 1 model-wide campaign/)).toBeInTheDocument();
  });
});
