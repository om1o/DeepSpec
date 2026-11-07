import { webcrypto } from "node:crypto";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Link, MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { accountStorageKey, setActiveAccount } from "../lib/accountScope";
import { downloadTextFile } from "../services/report";
import { attachScanToJob, createShopJob, getShopJob, SHOP_JOBS_STORAGE_KEY, updateShopJob } from "../services/shop";
import { createLookup, deleteLookup, LOOKUPS_STORAGE_KEY } from "../services/storage";
import type { ShopJob as Job } from "../types";
import ShopJob from "./ShopJob";

vi.mock("../services/report", () => ({ downloadTextFile: vi.fn() }));
vi.mock("../components/result/InspectionReportExport", () => ({ InspectionReportExport: ({ lookupId, disabled }: { lookupId: string; disabled?: boolean }) => <p data-testid="report" data-disabled={String(Boolean(disabled))}>Report for {lookupId}</p> }));
const frame = { imageBase64: "data:image/png;base64,c3ludGhldGlj", capturedAt: "2026-11-05T12:00:00.000Z" };
let job: Job;
function makeJob(title = "Alternator noise") { return createShopJob({ title, year: "2014", make: "Subaru", model: "Forester", symptom: "Whine", technicianName: "Mechanic", notes: "Saved initial notes", vin: "JF2SJABC1EH000001" }).value!; }
beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); setActiveAccount("job-page-owner"); vi.stubGlobal("crypto", webcrypto); job = makeJob(); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function Location() { const location = useLocation(); return <p data-testid="location">{location.pathname}{location.search}</p>; }
function open(query = "", other?: Job) {
  return render(<MemoryRouter initialEntries={[`/shop/${job.id}${query}`]}>
    {other ? <Link to={`/shop/${other.id}`}>Other job</Link> : null}
    <Routes><Route path="/shop/:jobId" element={<><ShopJob /><Location /></>} /><Route path="/result/:id" element={<Location />} /></Routes>
  </MemoryRouter>);
}
function storageNotice(key: string) { window.dispatchEvent(new StorageEvent("storage", { key, storageArea: localStorage })); }

it("shows honest review activity and distinguishes the quick text summary from the full report", () => {
  createLookup({ frame, jobId: job.id, reviewStatus: "confirmed" }, "overview"); open();
  expect(screen.getByRole("heading", { name: "Review activity" })).toBeInTheDocument();
  expect(screen.queryByText("Job accuracy")).not.toBeInTheDocument();
  expect(screen.getAllByText("Marked useful").length).toBeGreaterThan(0);
  expect(screen.getByText(/not measured diagnostic accuracy or vehicle safety/)).toBeInTheDocument();
  expect(screen.queryByTestId("report")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Quick text summary" }));
  expect(downloadTextFile).toHaveBeenCalledTimes(1);
  expect(vi.mocked(downloadTextFile).mock.calls[0][0]).toBe(`deepspec-shop-report-${job.id}.txt`);
  expect(screen.getByRole("status")).toHaveTextContent("does not include the full inspection photos or history");
  fireEvent.change(screen.getByLabelText("Overview inspection"), { target: { value: "overview" } });
  expect(screen.getByTestId("report")).toHaveTextContent("overview");
});

it("preserves entered fields on external job changes and blocks overwriting them until explicit review", () => {
  open(); fireEvent.change(screen.getByLabelText("Notes"), { target: { value: "My unsaved measurement" } });
  act(() => { updateShopJob(job.id, { notes: "Another mechanic's saved notes", status: "in_progress" }); });
  expect(screen.getByLabelText("Notes")).toHaveValue("My unsaved measurement");
  expect(screen.getByRole("button", { name: "Save job" })).toBeDisabled();
  expect(screen.getByText(/Your entered fields have not been overwritten/)).toBeInTheDocument();
  expect(getShopJob(job.id)?.notes).toBe("Another mechanic's saved notes");
  fireEvent.click(screen.getByRole("button", { name: "Replace form with saved fields" }));
  expect(screen.getByLabelText("Notes")).toHaveValue("Another mechanic's saved notes");
  expect(screen.getByLabelText("Status")).toHaveValue("in_progress");
  expect(screen.getByRole("button", { name: "Save job" })).not.toBeDisabled();
});

it("checks a missed cross-tab change at Save instead of relying only on subscription delivery", () => {
  open(); fireEvent.change(screen.getByLabelText("Notes"), { target: { value: "My pending note" } });
  const key = accountStorageKey(SHOP_JOBS_STORAGE_KEY);
  localStorage.setItem(key, JSON.stringify([{ ...getShopJob(job.id), notes: "Concurrent saved note" }]));
  fireEvent.click(screen.getByRole("button", { name: "Save job" }));
  expect(getShopJob(job.id)?.notes).toBe("Concurrent saved note");
  expect(screen.getByLabelText("Notes")).toHaveValue("My pending note");
  expect(screen.getByRole("status")).toHaveTextContent("saved job fields changed elsewhere");
});

it("acknowledges a successful local edit while preserving frozen scan context", () => {
  const original = createLookup({ frame, jobId: job.id, vehicleContext: { vin: job.vin, make: "Subaru" } }, "overview").value;
  open("?overview=overview"); fireEvent.change(screen.getByLabelText("VIN"), { target: { value: "JF2SJABC1EH000002" } });
  expect(screen.getByTestId("report")).toHaveAttribute("data-disabled", "true");
  fireEvent.click(screen.getByRole("button", { name: "Save job" }));
  expect(getShopJob(job.id)?.vin).toBe("JF2SJABC1EH000002");
  expect(original.vehicleContext?.vin).toBe("JF2SJABC1EH000001");
  expect(screen.getByRole("status")).toHaveTextContent("Existing scan snapshots retain their saved vehicle details");
  expect(screen.getByTestId("report")).toHaveAttribute("data-disabled", "false");
});

it("keeps failed edits visible and does not report success on quota failure", () => {
  open(); fireEvent.change(screen.getByLabelText("Notes"), { target: { value: "Retain after quota failure" } });
  const originalSet = Storage.prototype.setItem;
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
    if (key === accountStorageKey(SHOP_JOBS_STORAGE_KEY)) throw new DOMException("Quota exceeded", "QuotaExceededError");
    return originalSet.call(this, key, value);
  });
  fireEvent.click(screen.getByRole("button", { name: "Save job" }));
  expect(screen.getByLabelText("Notes")).toHaveValue("Retain after quota failure");
  expect(screen.getByRole("status")).toHaveTextContent("could not save");
  expect(getShopJob(job.id)?.notes).toBe("Saved initial notes");
});

it("refreshes scan membership and removes a deleted selected overview without substituting another", () => {
  createLookup({ frame, jobId: job.id }, "overview"); attachScanToJob(job.id, "overview");
  open("?overview=overview");
  act(() => { createLookup({ frame, jobId: job.id }, "second"); });
  expect(screen.getAllByRole("option").some((option) => option.getAttribute("value") === "second")).toBe(true);
  act(() => { deleteLookup("overview"); });
  expect(screen.queryByTestId("report")).not.toBeInTheDocument();
  expect(screen.getByLabelText("Overview inspection")).toHaveValue("");
  expect(screen.getByText(/Unavailable on this device: overview/)).toBeInTheDocument();
  expect(screen.getByText(/no replacement was selected automatically/)).toBeInTheDocument();
});

it("preserves unsaved text but blocks actions for deleted or unreadable jobs, and allows a retry", () => {
  open(); fireEvent.change(screen.getByLabelText("Notes"), { target: { value: "Retained local text" } });
  const key = accountStorageKey(SHOP_JOBS_STORAGE_KEY), saved = localStorage.getItem(key)!;
  act(() => { localStorage.setItem(key, "[]"); storageNotice(key); });
  expect(screen.getByLabelText("Notes")).toHaveValue("Retained local text");
  expect(screen.getByRole("button", { name: "Save job" })).toBeDisabled();
  expect(screen.getByText(/last displayed snapshot and your entered text are retained/)).toBeInTheDocument();
  act(() => { localStorage.setItem(key, "{broken"); storageNotice(key); });
  expect(screen.getByText(/Shop jobs could not be read safely/)).toBeInTheDocument();
  localStorage.setItem(key, saved); fireEvent.click(screen.getByRole("button", { name: "Retry reading job" }));
  expect(screen.getByRole("button", { name: "Save job" })).not.toBeDisabled();
  expect(screen.getByLabelText("Notes")).toHaveValue("Retained local text");
});

it("does not render unreadable scan storage as an empty job or silently redirect", () => {
  localStorage.setItem(accountStorageKey(LOOKUPS_STORAGE_KEY), "{broken"); open();
  expect(screen.getByRole("alert")).toHaveTextContent("could not be read safely");
  expect(screen.queryByText("No available scans attached")).not.toBeInTheDocument();
  expect(screen.getByTestId("location")).toHaveTextContent(`/shop/${job.id}`);
});

it("renders signed out without subscribing to account storage or exposing saved job details", () => {
  setActiveAccount(null);
  expect(() => open()).not.toThrow();
  expect(screen.getByRole("alert")).toHaveTextContent("Account changed. Job details are hidden");
  expect(screen.queryByRole("heading", { name: "Alternator noise" })).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Notes")).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Return to jobs" })).toHaveAttribute("href", "/shop");
});

it("keys forms by route and rejects stale-account actions without writing either account", () => {
  const other = makeJob("Other vehicle"); open("", other);
  fireEvent.change(screen.getByLabelText("Notes"), { target: { value: "First job unsaved" } });
  fireEvent.click(screen.getByRole("link", { name: "Other job" }));
  expect(screen.getByRole("heading", { name: "Other vehicle" })).toBeInTheDocument();
  expect(screen.getByLabelText("Notes")).toHaveValue("Saved initial notes");
  expect(getShopJob(job.id)?.notes).toBe("Saved initial notes");
  setActiveAccount("another-owner");
  fireEvent.click(screen.getByRole("button", { name: "Save job" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Account changed");
  expect(screen.queryByLabelText("Notes")).not.toBeInTheDocument();
  expect(localStorage.getItem(accountStorageKey(SHOP_JOBS_STORAGE_KEY))).toBeNull();
});
