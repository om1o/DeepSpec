import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setActiveAccount } from "../../lib/accountScope";
import { collectInspectionReport } from "../../services/inspectionReport";
import { buildInspectionReportHtml } from "../../lib/inspectionReportHtml";
import { downloadHtmlFile } from "../../services/report";
import { assertJobInspectionContextCurrent, buildJobInspectionReportScope, jobInspectionContextSignature } from "../../services/jobInspectionHandoff";
import type { InspectionReportSnapshot } from "../../types/inspectionReport";
import type { JobInspectionContext, JobInspectionReportScope } from "../../types/jobInspectionHandoff";
import { InspectionReportExport } from "./InspectionReportExport";

vi.mock("../../services/inspectionReport", () => ({ collectInspectionReport: vi.fn() }));
vi.mock("../../lib/inspectionReportHtml", () => ({ buildInspectionReportHtml: vi.fn(() => "<!doctype html><title>Inspection</title>"), getInspectionReportFilename: () => "inspection.html" }));
vi.mock("../../services/report", () => ({ downloadHtmlFile: vi.fn() }));
vi.mock("../../services/jobInspectionHandoff", () => ({ assertJobInspectionContextCurrent: vi.fn(), buildJobInspectionReportScope: vi.fn(), jobInspectionContextSignature: vi.fn((value) => JSON.stringify(value)) }));

// Context construction/validation is covered by the real service tests. These
// distinguish immutable context identities while exercising the export boundary.
const jobContext = (jobId = "job-a"): JobInspectionContext => ({ job: { id: jobId, createdAt: "2026-11-05T12:00:00Z", updatedAt: "2026-11-05T12:00:00Z",
  orgId: "org-a", make: "Example", model: "Model", year: "2015", title: "Private title", technicianName: "Private technician", symptom: "Noise",
  reviewStatus: "needs_review", status: "open", scanIds: ["saved-root"] }, scans: snapshot().scans, unavailableScanIds: [], conflictingScanIds: [] });
function jobScope(): JobInspectionReportScope {
  return { version: 1, jobId: "job-a", rootLookupId: "saved-root", jobScanIds: ["saved-root", "excluded-scan", "unavailable-scan", "conflicting-scan"],
    includedJobScanIds: ["saved-root"], excludedJobScanIds: ["excluded-scan"], unavailableJobScanIds: ["unavailable-scan"],
    outsideJobScanIds: [], conflictingJobScanIds: ["conflicting-scan"], vehicleDifferences: [{ lookupId: "saved-root", fields: ["model"] }] };
}

function snapshot(): InspectionReportSnapshot {
  const image = "data:image/png;base64,iVBORw0KGgo=";
  return { version: 1, createdAt: "2026-11-05T12:00:00Z", rootLookupId: "saved-root", map: null, embeddedBytes: 8, missing: [], scans: [{
    id: "saved-root", createdAt: "2026-11-05T11:00:00Z", frame: { imageBase64: image, capturedAt: "2026-11-05T11:00:00Z" },
    photos: [{ id: "original", label: "overview", imageBase64: image, capturedAt: "2026-11-05T11:00:00Z" }, { id: "close", label: "close_up", imageBase64: image, capturedAt: "2026-11-05T11:01:00Z" }],
    rating: null, correction: null, notes: "private note", scanCategory: "engine", trainingLabel: "Engine", trainingStatus: "raw_unreviewed", chatHistory: [],
    provenance: { captureMode: "upload", analysisSource: "ai_detection", savedAt: "2026-11-05T11:01:00Z" },
  }] };
}

function open() {
  fireEvent.click(screen.getByRole("button", { name: "Inspection report with photos" }));
}

describe("InspectionReportExport", () => {
  beforeEach(() => { vi.clearAllMocks(); setActiveAccount("report-owner"); vi.mocked(collectInspectionReport).mockResolvedValue(snapshot());
    vi.mocked(assertJobInspectionContextCurrent).mockReset(); vi.mocked(buildJobInspectionReportScope).mockReturnValue(jobScope());
    vi.mocked(jobInspectionContextSignature).mockImplementation((value) => JSON.stringify(value)); });

  it("attaches job coverage to the one collected snapshot and previews excluded/conflicting scans", async () => {
    const collected = snapshot(), context = jobContext();
    collected.scans.push({ ...collected.scans[0], id: "conflicting-scan" }, { ...collected.scans[0], id: "outside-scan" });
    const coverage = { ...jobScope(), outsideJobScanIds: ["outside-scan"] };
    vi.mocked(collectInspectionReport).mockResolvedValue(collected);
    vi.mocked(buildJobInspectionReportScope).mockReturnValue(coverage);
    render(<InspectionReportExport lookupId="saved-root" jobContext={context} />); open();
    fireEvent.click(screen.getByRole("button", { name: "Prepare report" }));
    await screen.findByRole("button", { name: "Download inspection HTML" });
    expect(collectInspectionReport).toHaveBeenCalledTimes(1);
    expect(buildJobInspectionReportScope).toHaveBeenCalledWith(context, collected);
    const preview = screen.getByLabelText("Job report scope");
    expect(preview).toHaveTextContent("not an all-job report");
    expect(preview).toHaveTextContent("Included through linked evidence; job association conflicts");
    expect(preview).toHaveTextContent("saved-root: model");
    expect(screen.getByRole("link", { name: "excluded-scan" })).toHaveAttribute("href", "/result/excluded-scan");
    fireEvent.click(screen.getByRole("button", { name: "Download inspection HTML" }));
    const exported = vi.mocked(buildInspectionReportHtml).mock.calls[0][0];
    expect(exported.jobScope).toEqual(coverage);
    expect(exported.scans).toBe(collected.scans);
    expect(collected.jobScope).toBeUndefined();
    expect(vi.mocked(assertJobInspectionContextCurrent).mock.calls.length).toBeGreaterThanOrEqual(4);
    expect(collectInspectionReport).toHaveBeenCalledTimes(1);
  });

  it("checks job context before collection and after collection without publishing a stale snapshot", async () => {
    vi.mocked(assertJobInspectionContextCurrent).mockImplementationOnce(() => { throw new Error("Job changed. Reopen it."); });
    render(<InspectionReportExport lookupId="saved-root" jobContext={jobContext()} />); open();
    fireEvent.click(screen.getByRole("button", { name: "Prepare report" }));
    expect(collectInspectionReport).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("Job changed");
    let resolve!: (value: InspectionReportSnapshot) => void;
    vi.mocked(collectInspectionReport).mockImplementation(() => new Promise((done) => { resolve = done; }));
    fireEvent.click(screen.getByRole("button", { name: "Prepare report" }));
    vi.mocked(assertJobInspectionContextCurrent).mockImplementation(() => { throw new Error("Job changed during collection."); });
    await act(async () => resolve(snapshot()));
    expect(screen.queryByLabelText("Prepared report contents")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Job changed during collection");
  });

  it.each(["lookup", "context", "disabled"])("hides a prepared download immediately after a %s change and does not revive it", async (change) => {
    const context = jobContext();
    const view = render(<InspectionReportExport lookupId="saved-root" jobContext={context} />); open();
    fireEvent.click(screen.getByRole("button", { name: "Prepare report" }));
    await screen.findByRole("button", { name: "Download inspection HTML" });
    view.rerender(<InspectionReportExport lookupId={change === "lookup" ? "new-root" : "saved-root"} jobContext={change === "context" ? jobContext("job-b") : context} disabled={change === "disabled"} />);
    expect(screen.queryByLabelText("Prepared report contents")).not.toBeInTheDocument();
    view.rerender(<InspectionReportExport lookupId="saved-root" jobContext={context} />);
    expect(screen.queryByRole("button", { name: "Download inspection HTML" })).not.toBeInTheDocument();
    expect(downloadHtmlFile).not.toHaveBeenCalled();
  });

  it.each(["lookup", "context", "disabled", "unmount"])("ignores late preparation after a %s change", async (change) => {
    let resolve!: (value: InspectionReportSnapshot) => void;
    vi.mocked(collectInspectionReport).mockImplementation(() => new Promise((done) => { resolve = done; }));
    const view = render(<InspectionReportExport lookupId="saved-root" jobContext={jobContext()} />); open();
    fireEvent.click(screen.getByRole("button", { name: "Prepare report" }));
    const signal = vi.mocked(collectInspectionReport).mock.calls[0][1]?.signal;
    if (change === "unmount") view.unmount();
    else view.rerender(<InspectionReportExport lookupId={change === "lookup" ? "new-root" : "saved-root"} jobContext={jobContext(change === "context" ? "job-b" : "job-a")} disabled={change === "disabled"} />);
    expect(signal?.aborted).toBe(true);
    await act(async () => resolve(snapshot()));
    expect(screen.queryByLabelText("Prepared report contents")).not.toBeInTheDocument();
    expect(downloadHtmlFile).not.toHaveBeenCalled();
  });

  it("rechecks the job immediately before and after rendering a download", async () => {
    render(<InspectionReportExport lookupId="saved-root" jobContext={jobContext()} />); open();
    fireEvent.click(screen.getByRole("button", { name: "Prepare report" }));
    await screen.findByRole("button", { name: "Download inspection HTML" });
    vi.mocked(buildInspectionReportHtml).mockImplementationOnce(() => {
      vi.mocked(assertJobInspectionContextCurrent).mockImplementation(() => { throw new Error("Job membership changed."); });
      return "<!doctype html>";
    });
    fireEvent.click(screen.getByRole("button", { name: "Download inspection HTML" }));
    expect(downloadHtmlFile).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Prepared report contents")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Job membership changed");
  });

  it("rejects a changed job before the HTML renderer or download can run", async () => {
    render(<InspectionReportExport lookupId="saved-root" jobContext={jobContext()} />); open();
    fireEvent.click(screen.getByRole("button", { name: "Prepare report" }));
    await screen.findByRole("button", { name: "Download inspection HTML" });
    vi.mocked(assertJobInspectionContextCurrent).mockImplementation(() => { throw new Error("Selected scan left this job."); });
    fireEvent.click(screen.getByRole("button", { name: "Download inspection HTML" }));
    expect(buildInspectionReportHtml).not.toHaveBeenCalled();
    expect(downloadHtmlFile).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Prepared report contents")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Selected scan left this job");
  });

  it("does not invent a legacy photo for an explicit empty saved group", async () => {
    const value = snapshot(); value.scans[0].photos = [];
    vi.mocked(collectInspectionReport).mockResolvedValue(value);
    render(<InspectionReportExport lookupId="saved-root" />); open();
    fireEvent.click(screen.getByRole("button", { name: "Prepare report" }));
    await screen.findByRole("button", { name: "Download inspection HTML" });
    expect(screen.getByLabelText("Prepared report contents")).toHaveTextContent("0 photo references");
    expect(screen.queryByRole("img", { hidden: true })).not.toBeInTheDocument();
  });

  it("prepares saved IDs and requires a separate download with explicit privacy choices", async () => {
    render(<InspectionReportExport lookupId="saved-root" />);
    open();
    expect(screen.getByRole("checkbox", { name: "Include saved VIN" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Include private scan and vehicle notes" })).not.toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Prepare report" }));
    await screen.findByRole("button", { name: "Download inspection HTML" });
    expect(collectInspectionReport).toHaveBeenCalledWith("saved-root", expect.objectContaining({ signal: expect.any(AbortSignal), onProgress: expect.any(Function) }), expect.objectContaining({ userId: "report-owner" }));
    expect(downloadHtmlFile).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Prepared report contents")).toHaveTextContent("2 photo references");
    expect(screen.getByText("Review included photos")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "Include saved VIN" }));
    fireEvent.click(screen.getByRole("button", { name: "Download inspection HTML" }));
    expect(buildInspectionReportHtml).toHaveBeenCalledWith(expect.objectContaining({ rootLookupId: "saved-root" }), { includeVin: true, includePrivateNotes: false, includeDiagnosticOriginals: false });
    expect(downloadHtmlFile).toHaveBeenCalledWith("inspection.html", expect.stringContaining("<!doctype html>"));
  });

  it("requires a separate opt-in for unredacted diagnostic originals", async () => {
    render(<InspectionReportExport lookupId="saved-root" />); open();
    const original = screen.getByRole("checkbox", { name: "Include original diagnostic files, unredacted" });
    expect(original).not.toBeChecked();
    fireEvent.click(original);
    expect(screen.getByText(/Original diagnostic files may contain VINs/)).toHaveTextContent("even when Include saved VIN is off");
    expect(screen.getByRole("checkbox", { name: "Include saved VIN" })).not.toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Prepare report" }));
    fireEvent.click(await screen.findByRole("button", { name: "Download inspection HTML" }));
    expect(buildInspectionReportHtml).toHaveBeenCalledWith(expect.anything(), { includeVin: false, includePrivateNotes: false, includeDiagnosticOriginals: true });
  });

  it("lists missing evidence and labels the incomplete download explicitly", async () => {
    const value = snapshot();
    value.missing.push({ kind: "photo", lookupId: "linked-scan", photoId: "mounts", message: "Saved photo is unavailable." });
    vi.mocked(collectInspectionReport).mockResolvedValue(value);
    render(<InspectionReportExport lookupId="saved-root" />);
    open();
    fireEvent.click(screen.getByRole("button", { name: "Prepare report" }));
    expect(await screen.findByRole("button", { name: "Download with missing evidence" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Download inspection HTML" })).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("linked-scan / mounts: Saved photo is unavailable.");
    expect(downloadHtmlFile).not.toHaveBeenCalled();
  });

  it("cancels collection and ignores a late successful response", async () => {
    let resolve!: (value: InspectionReportSnapshot) => void;
    vi.mocked(collectInspectionReport).mockImplementation(() => new Promise((done) => { resolve = done; }));
    render(<InspectionReportExport lookupId="saved-root" />);
    open();
    fireEvent.click(screen.getByRole("button", { name: "Prepare report" }));
    const signal = vi.mocked(collectInspectionReport).mock.calls[0][1]?.signal;
    fireEvent.click(screen.getByRole("button", { name: "Cancel preparation" }));
    expect(signal?.aborted).toBe(true);
    await act(async () => resolve(snapshot()));
    expect(screen.queryByLabelText("Prepared report contents")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("canceled");
  });

  it("does not expose a completed snapshot after an account change", async () => {
    let resolve!: (value: InspectionReportSnapshot) => void;
    vi.mocked(collectInspectionReport).mockImplementation(() => new Promise((done) => { resolve = done; }));
    render(<InspectionReportExport lookupId="saved-root" />);
    open();
    fireEvent.click(screen.getByRole("button", { name: "Prepare report" }));
    setActiveAccount("other-owner");
    await act(async () => resolve(snapshot()));
    expect(screen.queryByLabelText("Prepared report contents")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Account changed");
  });

  it("blocks download if the owner changes after preparation", async () => {
    render(<InspectionReportExport lookupId="saved-root" />);
    open();
    fireEvent.click(screen.getByRole("button", { name: "Prepare report" }));
    const button = await screen.findByRole("button", { name: "Download inspection HTML" });
    setActiveAccount("other-owner");
    fireEvent.click(button);
    expect(downloadHtmlFile).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Prepared report contents")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Account changed");
  });

  it("prevents export of pending unsaved changes and reports preparation failures without download", async () => {
    const view = render(<InspectionReportExport lookupId="saved-root" disabled />);
    open();
    expect(screen.getByRole("button", { name: "Prepare report" })).toBeDisabled();
    expect(collectInspectionReport).not.toHaveBeenCalled();
    view.rerender(<InspectionReportExport lookupId="saved-root" />);
    vi.mocked(collectInspectionReport).mockRejectedValue(new Error("Inspection changed during preparation. Try again."));
    fireEvent.click(screen.getByRole("button", { name: "Prepare report" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Inspection changed"));
    expect(downloadHtmlFile).not.toHaveBeenCalled();
  });
});
