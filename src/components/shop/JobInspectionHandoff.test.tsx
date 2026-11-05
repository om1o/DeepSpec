import { webcrypto } from "node:crypto";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { accountStorageKey, setActiveAccount } from "../../lib/accountScope";
import { readJobInspectionContext } from "../../services/jobInspectionHandoff";
import { attachScanToJob, createShopJob, updateShopJob } from "../../services/shop";
import { createLookup, LOOKUPS_STORAGE_KEY, readLookups } from "../../services/storage";
import type { Lookup, ShopJob } from "../../types";
import type { JobInspectionContext } from "../../types/jobInspectionHandoff";
import { JobInspectionHandoff, JobInspectionThumbnail } from "./JobInspectionHandoff";

const report = vi.hoisted(() => ({ render: vi.fn() }));
vi.mock("../result/InspectionReportExport", () => ({ InspectionReportExport: (props: { lookupId: string; jobContext: JobInspectionContext; disabled?: boolean }) => {
  report.render(props); return <div data-testid="report" data-disabled={String(Boolean(props.disabled))}>Report for {props.lookupId}</div>;
} }));
const stamp = "2026-11-05T12:00:00.000Z";
const frame = { imageBase64: "data:image/png;base64,c3ludGhldGlj", capturedAt: stamp };
let job: ShopJob;
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); setActiveAccount("job-handoff-owner"); vi.stubGlobal("crypto", webcrypto);
  job = createShopJob({ title: "Inspection job", year: "2014", make: "Subaru", model: "Forester", engine: "2.5 L", symptom: "Noise", technicianName: "Mechanic" }).value!;
});
afterEach(() => { vi.unstubAllGlobals(); });
function scan(id: string, options: Partial<Lookup> = {}) {
  const result = createLookup({ frame: options.photos?.[0] ?? frame, jobId: options.jobId ?? job.id, vehicleContext: options.vehicleContext, photos: options.photos }, id);
  if (!result.ok) throw new Error(result.message);
  return result.value;
}
function Location() { const location = useLocation(); return <p data-testid="location">{location.pathname}{location.search}</p>; }
function open(context: JobInspectionContext, query = "", disabled = false) {
  return render(<MemoryRouter initialEntries={[`/shop/${job.id}${query}`]}><Routes>
    <Route path="/shop/:jobId" element={<><JobInspectionHandoff context={context} disabled={disabled} /><Location /></>} />
    <Route path="/result/:id" element={<Location />} />
  </Routes></MemoryRouter>);
}

it("requires an explicit choice and passes the exact issued context to the full report", () => {
  scan("first"); scan("second"); const context = readJobInspectionContext(job.id)!; open(context);
  expect(screen.getByLabelText("Overview inspection")).toHaveValue("");
  expect(screen.queryByTestId("report")).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Overview inspection"), { target: { value: "second" } });
  expect(screen.getByTestId("location")).toHaveTextContent("?overview=second");
  expect(report.render).toHaveBeenLastCalledWith({ lookupId: "second", jobContext: context, disabled: false });
  expect(screen.getByText(/does not combine every scan in this job/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("link", { name: "Open this inspection" }));
  expect(screen.getByTestId("location")).toHaveTextContent("/result/second");
});

it("retains a valid query selection without choosing a replacement for an invalid one", () => {
  scan("first"); scan("second"); const context = readJobInspectionContext(job.id)!;
  const view = open(context, "?overview=second&keep=other");
  expect(screen.getByLabelText("Overview inspection")).toHaveValue("second");
  fireEvent.change(screen.getByLabelText("Overview inspection"), { target: { value: "first" } });
  expect(screen.getByTestId("location")).toHaveTextContent("overview=first&keep=other");
  view.unmount(); open(context, "?overview=not-a-member");
  expect(screen.getByLabelText("Overview inspection")).toHaveValue("");
  expect(screen.queryByTestId("report")).not.toBeInTheDocument();
  expect(screen.getByRole("alert")).toHaveTextContent("no replacement was selected automatically");
});

it("excludes foreign membership and displays missing references separately", () => {
  scan("valid"); scan("foreign", { jobId: "other-job" });
  attachScanToJob(job.id, "foreign"); attachScanToJob(job.id, "missing");
  open(readJobInspectionContext(job.id)!, "?overview=foreign");
  expect(screen.getByText(/Conflicting job membership: foreign/)).toBeInTheDocument();
  expect(screen.getByText(/Unavailable on this device: missing/)).toBeInTheDocument();
  expect(screen.getAllByRole("option")).toHaveLength(2);
  expect(screen.queryByTestId("report")).not.toBeInTheDocument();
});

it("shows the actual first original and frozen vehicle differences, never a frame or cutout substitute", () => {
  const original = "data:image/png;base64,b3JpZ2luYWw=";
  scan("angled", { photos: [{ id: "angle-a", label: "other", imageBase64: original, capturedAt: stamp }], vehicleContext: { year: "2015", make: "Subaru", model: "Outback", engine: "2.5 L" } });
  open(readJobInspectionContext(job.id)!, "?overview=angled");
  expect(screen.getByAltText("First original of Unidentified scan")).toHaveAttribute("src", original);
  const selected = screen.getByLabelText("Selected overview inspection");
  expect(selected).toHaveTextContent("year: 2015 (supplied, unconfirmed)");
  expect(selected).toHaveTextContent("Saved vehicle details differ from this job: year, model");
  expect(selected).toHaveTextContent("not a verified photo exposure date");
});

it("does not fall back to frame when an explicit photo array is empty", () => {
  const value = scan("empty");
  const thumb = render(<JobInspectionThumbnail scan={{ ...value, photos: [] }} alt="Overview" />);
  expect(screen.getByRole("img", { name: "Overview" }).tagName).toBe("DIV");
  thumb.rerender(<JobInspectionThumbnail scan={{ ...value, photos: undefined }} alt="Overview" />);
  expect(screen.getByRole("img", { name: "Overview" })).toHaveAttribute("src", frame.imageBase64);
  thumb.unmount();
  // Exercise the presentation boundary directly: a corrupted/partial older
  // import can have no current photo; no mutation is attempted by this panel.
  const context = readJobInspectionContext(job.id)!;
  context.scans = [{ ...value, photos: [] }];
  open(context, "?overview=empty");
  expect(screen.getByLabelText("Overview inspection")).toBeDisabled();
  expect(screen.getByText(/First original unavailable: empty/)).toBeInTheDocument();
  expect(screen.queryByTestId("report")).not.toBeInTheDocument();
});

it("does not turn equivalent whitespace or unknown vehicle facts into a contradiction", () => {
  scan("whitespace", { vehicleContext: { make: " SUBARU ", model: "Forester", engine: "2.5   L", year: "unknown" } });
  const context = readJobInspectionContext(job.id)!; const view = open(context, "?overview=whitespace");
  expect(screen.queryByText(/Saved vehicle details differ/)).not.toBeInTheDocument();
  expect(screen.getByText(/matching or missing vehicle details do not establish/)).toBeInTheDocument();
  view.unmount(); scan("placeholder", { vehicleContext: { model: "n/a", engine: "not supplied" } });
  open(readJobInspectionContext(job.id)!, "?overview=placeholder");
  expect(screen.queryByText(/Saved vehicle details differ/)).not.toBeInTheDocument();
});

it("rejects a stale job or removed scan immediately before navigation and selection", () => {
  scan("first"); scan("second"); const context = readJobInspectionContext(job.id)!; open(context, "?overview=first");
  updateShopJob(job.id, { notes: "A different editor changed the job" });
  fireEvent.click(screen.getByRole("link", { name: "Open this inspection" }));
  expect(screen.getByTestId("location")).toHaveTextContent(`/shop/${job.id}`);
  expect(screen.getByRole("alert")).toHaveTextContent(/changed/);
  fireEvent.change(screen.getByLabelText("Overview inspection"), { target: { value: "second" } });
  expect(screen.getByTestId("location")).toHaveTextContent("overview=first");
});

it("rejects a removed selected original even when membership itself is unchanged", () => {
  scan("first"); const context = readJobInspectionContext(job.id)!; open(context, "?overview=first");
  localStorage.setItem(accountStorageKey(LOOKUPS_STORAGE_KEY), JSON.stringify(readLookups().value.filter((entry) => entry.id !== "first")));
  fireEvent.click(screen.getByRole("link", { name: "Open this inspection" }));
  expect(screen.getByTestId("location")).toHaveTextContent(`/shop/${job.id}`);
  expect(screen.getByRole("alert")).toHaveTextContent(/changed/);
});

it("blocks pending edits and hides owner data after an account change", () => {
  scan("first"); const context = readJobInspectionContext(job.id)!;
  const view = open(context, "?overview=first", true);
  expect(screen.getByLabelText("Overview inspection")).toBeDisabled();
  expect(screen.getByTestId("report")).toHaveAttribute("data-disabled", "true");
  fireEvent.click(screen.getByRole("link", { name: "Open this inspection" }));
  expect(screen.getByTestId("location")).toHaveTextContent(`/shop/${job.id}`);
  view.unmount();
  const second = render(<MemoryRouter><JobInspectionHandoff context={context} /></MemoryRouter>);
  setActiveAccount("another-owner");
  second.rerender(<MemoryRouter><JobInspectionHandoff context={context} /></MemoryRouter>);
  expect(screen.getByRole("alert")).toHaveTextContent("Job inspections are hidden");
  expect(screen.queryByLabelText("Overview inspection")).not.toBeInTheDocument();
});

it("keeps unidentified scans eligible without inventing a successful model result", () => {
  scan("no-result"); open(readJobInspectionContext(job.id)!, "?overview=no-result");
  const selected = screen.getByLabelText("Selected overview inspection");
  expect(within(selected).getByRole("heading", { name: "Unidentified scan" })).toBeInTheDocument();
  expect(selected).toHaveTextContent("No vehicle details retained; same vehicle is unconfirmed");
  expect(screen.getByTestId("report")).toHaveTextContent("no-result");
});
