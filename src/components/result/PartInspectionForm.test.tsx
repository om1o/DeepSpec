import { setActiveAccount } from "../../lib/accountScope";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PartInspectionForm } from "./PartInspectionForm";
import { createLookup, deleteLookup, getLookup, saveLookupInspection } from "../../services/storage";
import * as cloud from "../../services/cloudSync";
import * as report from "../../services/report";

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(cloud, "getCloudSyncStatus").mockReturnValue({ configured: false, message: "Local only" });
});
afterEach(() => vi.restoreAllMocks());

it.each(["updated", "removed", "updated-rejected", "removed-rejected", "unchanged"])("reports delayed inspection sync against current device evidence: %s", async (mode) => {
  const user = userEvent.setup();
  vi.mocked(cloud.getCloudSyncStatus).mockReturnValue({ configured: true, message: "Ready" });
  let finish!: (value: Awaited<ReturnType<typeof cloud.syncLookupToCloud>>) => void;
  let fail!: (error: Error) => void;
  vi.spyOn(cloud, "syncLookupToCloud").mockReturnValue(new Promise((resolve, reject) => { finish = resolve; fail = reject; }));
  const { lookup } = setup();
  await user.click(screen.getByText("Human inspection — optional"));
  await user.type(screen.getByLabelText("Inspector name (self-reported)"), "Pat");
  await user.click(screen.getByRole("button", { name: "Save inspection" }));
  expect(screen.getByRole("button", { name: "Syncing inspection…" })).toBeDisabled();
  if (mode.startsWith("updated")) {
    expect(saveLookupInspection(lookup.id, { ...getLookup(lookup.id)!.inspection!, inspectorName: "Alex" }).ok).toBe(true);
  } else if (mode.startsWith("removed")) {
    expect(deleteLookup(lookup.id).ok).toBe(true);
  }
  await act(async () => {
    if (mode.endsWith("rejected")) fail(new Error("Network interrupted"));
    else finish({ ok: true, message: "Synced" });
  });
  if (mode === "unchanged") {
    expect(screen.getByRole("status")).toHaveTextContent("Inspection saved on this device and synced to the cloud.");
  } else {
    expect(screen.getByRole("status")).toHaveTextContent("Device inspection changed or was removed while syncing. Reopen the scan to review its current save status.");
    expect(getLookup(lookup.id)?.inspection?.inspectorName).toBe(mode.startsWith("updated") ? "Alex" : undefined);
  }
  expect(screen.getByRole("button", { name: "Save inspection" })).toBeEnabled();
});

function setup() {
  const lookup = createLookup({ frame: { imageBase64: "data:image/jpeg;base64,test", capturedAt: "2026-09-20T12:00:00Z" } }).value;
  const onSaved = vi.fn();
  const view = render(<PartInspectionForm lookup={lookup} onSaved={onSaved} />);
  return { lookup, onSaved, ...view };
}

it.each(["updated", "removed"])("does not overwrite device changes made while the form was open: %s", async (mode) => {
  const user = userEvent.setup();
  const { lookup, onSaved } = setup();
  const sync = vi.spyOn(cloud, "syncLookupToCloud");
  await user.click(screen.getByText("Human inspection — optional"));
  await user.type(screen.getByLabelText("Inspector name (self-reported)"), "Pat");
  if (mode === "updated") {
    saveLookupInspection(lookup.id, { confirmedPartName: "", partNumber: "", identityEvidence: "", visibleCondition: "not_inspected", visibleNotes: "", functionalStatus: "not_tested", functionalNotes: "", inspectorName: "Alex" });
  } else {
    deleteLookup(lookup.id);
  }
  await user.click(screen.getByRole("button", { name: "Save inspection" }));
  expect(screen.getByRole("status")).toHaveTextContent("Inspection changed or was removed since you opened this form");
  expect(getLookup(lookup.id)?.inspection?.inspectorName).toBe(mode === "updated" ? "Alex" : undefined);
  expect(screen.getByLabelText("Inspector name (self-reported)")).toHaveValue("Pat");
  expect(onSaved).not.toHaveBeenCalled();
  expect(sync).not.toHaveBeenCalled();
});

it("saves an inspection and reloads it with function explicitly untested", async () => {
  const user = userEvent.setup();
  const { lookup, onSaved, unmount } = setup();
  await user.click(screen.getByText("Human inspection — optional"));
  expect(screen.getByLabelText("Functional test")).toHaveValue("not_tested");
  expect(screen.getByLabelText("Confirmed part name")).toHaveValue("");
  await user.type(screen.getByLabelText("Inspector name (self-reported)"), "Pat");
  await user.selectOptions(screen.getByLabelText("Visible condition"), "no_visible_damage");
  await user.click(screen.getByRole("button", { name: "Save inspection" }));
  expect(screen.getByRole("status")).toHaveTextContent("Inspection saved on this device.");
  expect(onSaved).toHaveBeenCalledOnce();
  unmount();
  render(<PartInspectionForm lookup={getLookup(lookup.id)!} onSaved={onSaved} />);
  await user.click(screen.getByText("Human inspection — saved"));
  expect(screen.getByLabelText("Inspector name (self-reported)")).toHaveValue("Pat");
  expect(screen.getByLabelText("Visible condition")).toHaveValue("no_visible_damage");
  expect(screen.getByLabelText("Functional test")).toHaveValue("not_tested");
});

it("requires a test record before saving a passed test", async () => {
  const user = userEvent.setup();
  const { onSaved } = setup();
  await user.click(screen.getByText("Human inspection — optional"));
  await user.type(screen.getByLabelText("Inspector name (self-reported)"), "Pat");
  await user.selectOptions(screen.getByLabelText("Functional test"), "passed");
  await user.click(screen.getByRole("button", { name: "Save inspection" }));
  expect(screen.getByRole("status")).toHaveTextContent("Record the test performed and its result.");
  expect(onSaved).not.toHaveBeenCalled();
});

it("allows another save after the parent receives the saved inspection", async () => {
  const user = userEvent.setup();
  const { lookup, onSaved, rerender } = setup();
  await user.click(screen.getByText("Human inspection — optional"));
  await user.type(screen.getByLabelText("Inspector name (self-reported)"), "Pat");
  await user.click(screen.getByRole("button", { name: "Save inspection" }));
  rerender(<PartInspectionForm lookup={getLookup(lookup.id)!} onSaved={onSaved} />);
  await user.type(screen.getByLabelText("Visible condition notes"), "Housing checked");
  await user.click(screen.getByRole("button", { name: "Save inspection" }));
  expect(getLookup(lookup.id)?.inspection?.visibleNotes).toBe("Housing checked");
  expect(onSaved).toHaveBeenCalledTimes(2);
});

it("preserves a draft when newer cloud inspection data arrives through the parent", async () => {
  const user = userEvent.setup();
  const { lookup, onSaved, rerender } = setup();
  await user.click(screen.getByText("Human inspection — optional"));
  await user.type(screen.getByLabelText("Inspector name (self-reported)"), "Pat");
  const newer = { ...lookup, inspection: { confirmedPartName: "", partNumber: "", identityEvidence: "", visibleCondition: "not_inspected" as const, visibleNotes: "", functionalStatus: "not_tested" as const, functionalNotes: "", inspectorName: "Alex", inspectedAt: "2026-09-26T12:00:00Z" } };
  rerender(<PartInspectionForm lookup={newer} onSaved={onSaved} />);
  await user.click(screen.getByRole("button", { name: "Save inspection" }));
  expect(screen.getByRole("status")).toHaveTextContent("Inspection changed or was removed since you opened this form");
  expect(screen.getByLabelText("Inspector name (self-reported)")).toHaveValue("Pat");
  expect(onSaved).not.toHaveBeenCalled();
});

it("reports local save success separately from cloud failure", async () => {
  const user = userEvent.setup();
  vi.mocked(cloud.getCloudSyncStatus).mockReturnValue({ configured: true, message: "Ready" });
  vi.spyOn(cloud, "syncLookupToCloud").mockResolvedValue({ ok: false, message: "Migration required" });
  const { lookup } = setup();
  await user.click(screen.getByText("Human inspection — optional"));
  await user.type(screen.getByLabelText("Inspector name (self-reported)"), "Pat");
  await user.click(screen.getByRole("button", { name: "Save inspection" }));
  expect(await screen.findByText("Saved on this device. Cloud sync failed: Migration required")).toBeInTheDocument();
  expect(getLookup(lookup.id)?.inspection?.inspectorName).toBe("Pat");
});

it("does not announce saved or sync when local storage fails", async () => {
  const user = userEvent.setup();
  const { onSaved } = setup();
  const sync = vi.spyOn(cloud, "syncLookupToCloud");
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("quota", "QuotaExceededError"); });
  await user.click(screen.getByText("Human inspection — optional"));
  await user.type(screen.getByLabelText("Inspector name (self-reported)"), "Pat");
  await user.click(screen.getByRole("button", { name: "Save inspection" }));
  expect(screen.getByRole("status")).toHaveTextContent("storage is full");
  expect(onSaved).not.toHaveBeenCalled();
  expect(sync).not.toHaveBeenCalled();
});

it("exports an unfinished draft after device storage fails without claiming it was saved", async () => {
  const user = userEvent.setup();
  const { onSaved } = setup();
  const download = vi.spyOn(report, "downloadTextFile").mockImplementation(() => {});
  const sync = vi.spyOn(cloud, "syncLookupToCloud");
  await user.click(screen.getByText("Human inspection — optional"));
  expect(screen.queryByRole("button", { name: "Download draft" })).not.toBeInTheDocument();
  await user.type(screen.getByLabelText("Inspector name (self-reported)"), "Pat");
  await user.type(screen.getByLabelText("Visible condition notes"), "Housing crack near mounting bolt");
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("quota", "QuotaExceededError"); });
  await user.click(screen.getByRole("button", { name: "Save inspection" }));
  expect(screen.getByRole("status")).toHaveTextContent("storage is full");
  expect(screen.getByText("Unsaved inspection changes")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Download draft" }));
  expect(download).toHaveBeenCalledWith("deep-spec-inspection-draft.txt", expect.stringContaining("UNSAVED INSPECTION DRAFT"));
  const content = download.mock.calls[0][1];
  expect(content).toContain("Housing crack near mounting bolt");
  expect(content).toContain("Inspector: Pat");
  expect(content).toContain("Functional test: not tested");
  expect(screen.getByRole("status")).toHaveTextContent("storage is full");
  expect(onSaved).not.toHaveBeenCalled();
  expect(sync).not.toHaveBeenCalled();
});

it("removes the unsaved indicator after saving and shows it again for another edit", async () => {
  const user = userEvent.setup();
  setup();
  await user.click(screen.getByText("Human inspection — optional"));
  await user.type(screen.getByLabelText("Inspector name (self-reported)"), "Pat");
  expect(screen.getByText("Unsaved inspection changes")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Save inspection" }));
  expect(screen.queryByText("Unsaved inspection changes")).not.toBeInTheDocument();
  await user.type(screen.getByLabelText("Visible condition notes"), "Another check");
  expect(screen.getByText("Unsaved inspection changes")).toBeInTheDocument();
});

it("blocks draft export from a form belonging to a previous account", async () => {
  const user = userEvent.setup();
  setup();
  const download = vi.spyOn(report, "downloadTextFile").mockImplementation(() => {});
  await user.click(screen.getByText("Human inspection — optional"));
  await user.type(screen.getByLabelText("Inspector name (self-reported)"), "Pat");
  setActiveAccount("other-account");
  await user.click(screen.getByRole("button", { name: "Download draft" }));
  expect(download).not.toHaveBeenCalled();
  expect(screen.getByRole("status")).toHaveTextContent("Account changed");
});

it.each(["different-account", "round-trip"])("rejects a stale mounted inspection form: %s", async (mode) => {
  const user = userEvent.setup();
  const { lookup, onSaved } = setup();
  const sync = vi.spyOn(cloud, "syncLookupToCloud");
  await user.click(screen.getByText("Human inspection — optional"));
  await user.type(screen.getByLabelText("Inspector name (self-reported)"), "Pat");
  setActiveAccount("other-account");
  if (mode === "round-trip") setActiveAccount("test-user");
  await user.click(screen.getByRole("button", { name: "Save inspection" }));
  expect(screen.getByRole("status")).toHaveTextContent("Account changed");
  expect(onSaved).not.toHaveBeenCalled();
  expect(sync).not.toHaveBeenCalled();
  expect(getLookup(lookup.id)?.inspection).toBeUndefined();
  setActiveAccount("test-user");
  expect(getLookup(lookup.id)?.inspection).toBeUndefined();
});
