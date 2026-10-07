import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PartInspectionForm } from "./PartInspectionForm";
import { createLookup, deleteLookup, getLookup, saveLookupInspection } from "../../services/storage";
import { emptyPartInspection } from "../../lib/partInspection";
import * as cloud from "../../services/cloudSync";
import * as report from "../../services/report";
import { getAccountScope, setActiveAccount } from "../../lib/accountScope";
import { inspectionDraftKey, readInspectionDraft } from "../../services/inspectionDraft";

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(cloud, "getCloudSyncStatus").mockReturnValue({ configured: false, message: "Local only" });
});
afterEach(() => vi.restoreAllMocks());

function setup() {
  const lookup = createLookup({ frame: { imageBase64: "data:image/jpeg;base64,test", capturedAt: "2026-09-26T12:00:00Z" } }).value;
  const onSaved = vi.fn();
  const view = render(<PartInspectionForm lookup={lookup} onSaved={onSaved} />);
  return { lookup, onSaved, ...view };
}

it("recovers incomplete notes only after an explicit restore, then discards them", async () => {
  const user = userEvent.setup();
  const { lookup, unmount } = setup();
  await user.click(screen.getByText("Human inspection — optional"));
  await user.type(screen.getByLabelText("Visible condition notes"), "  Check mounting bolt  ");
  expect(getLookup(lookup.id)?.inspection).toBeUndefined();
  unmount();
  const reopened = render(<PartInspectionForm lookup={getLookup(lookup.id)!} onSaved={vi.fn()} />);
  expect(screen.getByText("Human inspection — draft available")).toBeInTheDocument();
  await user.click(screen.getByText("Human inspection — draft available"));
  expect(screen.getByLabelText("Visible condition notes")).toHaveValue("");
  await user.click(screen.getByRole("button", { name: "Restore draft" }));
  expect(screen.getByLabelText("Visible condition notes")).toHaveValue("  Check mounting bolt  ");
  expect(getLookup(lookup.id)?.inspection).toBeUndefined();
  await user.click(screen.getByRole("button", { name: "Discard draft" }));
  expect(screen.getByLabelText("Visible condition notes")).toHaveValue("");
  reopened.unmount();
  render(<PartInspectionForm lookup={getLookup(lookup.id)!} onSaved={vi.fn()} />);
  expect(screen.queryByText("Human inspection — draft available")).not.toBeInTheDocument();
});

it("keeps a recovery copy but refuses to restore it over a newer saved inspection", async () => {
  const user = userEvent.setup();
  const { lookup, unmount } = setup();
  await user.click(screen.getByText("Human inspection — optional"));
  await user.type(screen.getByLabelText("Visible condition notes"), "Old unfinished notes");
  saveLookupInspection(lookup.id, { ...emptyPartInspection, inspectorName: "Alex", visibleNotes: "Newer checked notes" });
  unmount();
  render(<PartInspectionForm lookup={getLookup(lookup.id)!} onSaved={vi.fn()} />);
  await user.click(screen.getByText("Human inspection — draft available"));
  expect(screen.getByRole("button", { name: "Restore draft" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Download recovery copy" })).toBeEnabled();
  expect(screen.getByLabelText("Visible condition notes")).toHaveValue("Newer checked notes");
  await user.click(screen.getByRole("button", { name: "Discard draft" }));
  expect(getLookup(lookup.id)?.inspection?.visibleNotes).toBe("Newer checked notes");
});

it("clears recovery only after a successful local save, even when cloud sync fails", async () => {
  const user = userEvent.setup();
  const { lookup, unmount } = setup();
  vi.mocked(cloud.getCloudSyncStatus).mockReturnValue({ configured: true, message: "Ready" });
  vi.spyOn(cloud, "syncLookupToCloud").mockRejectedValue(new Error("offline"));
  await user.click(screen.getByText("Human inspection — optional"));
  await user.type(screen.getByLabelText("Inspector name (self-reported)"), "Pat");
  await user.click(screen.getByRole("button", { name: "Save inspection" }));
  expect(await screen.findByText("Saved on this device. Cloud sync failed; try saving again when connected.")).toBeInTheDocument();
  expect(readInspectionDraft(getAccountScope(), lookup.id).raw).toBeNull();
  unmount();
  render(<PartInspectionForm lookup={getLookup(lookup.id)!} onSaved={vi.fn()} />);
  expect(screen.getByText("Human inspection — saved")).toBeInTheDocument();
});

it("does not replace or clear another open form's recovery copy", async () => {
  const user = userEvent.setup();
  const { lookup, container: first } = setup();
  const { container: second } = render(<PartInspectionForm lookup={lookup} onSaved={vi.fn()} />);
  for (const form of [first, second]) await user.click(within(form).getByText("Human inspection — optional"));
  await user.type(within(first).getByLabelText("Visible condition notes"), "First unfinished notes");
  await user.type(within(second).getByLabelText("Inspector name (self-reported)"), "Alex");
  expect(within(second).getByText(/Another tab changed the device draft/)).toBeInTheDocument();
  await user.click(within(second).getByRole("button", { name: "Discard draft" }));
  expect(within(second).getByLabelText("Inspector name (self-reported)")).toHaveValue("Alex");
  await user.click(within(second).getByRole("button", { name: "Save inspection" }));
  expect(getLookup(lookup.id)?.inspection?.inspectorName).toBe("Alex");
  expect(readInspectionDraft(getAccountScope(), lookup.id).record?.draft.visibleNotes).toBe("First unfinished notes");
});

it("warns about failed backup and keeps current text downloadable", async () => {
  const user = userEvent.setup();
  setup();
  const download = vi.spyOn(report, "downloadTextFile").mockImplementation(() => {});
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("quota", "QuotaExceededError"); });
  await user.click(screen.getByText("Human inspection — optional"));
  await user.type(screen.getByLabelText("Visible condition notes"), "Notes still here");
  expect(screen.getByText(/Draft could not be kept on this device/)).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Download draft" }));
  expect(download).toHaveBeenCalledWith(expect.any(String), expect.stringContaining("Notes still here"));
});

it("isolates recovery by account and rejects an old mounted form after switching away and back", async () => {
  const user = userEvent.setup();
  const { lookup, unmount } = setup();
  await user.click(screen.getByText("Human inspection — optional"));
  await user.type(screen.getByLabelText("Visible condition notes"), "Private notes for first account");
  const before = localStorage.getItem(inspectionDraftKey(lookup.id));
  setActiveAccount("second-user");
  expect(readInspectionDraft(getAccountScope(), lookup.id).raw).toBeNull();
  await user.type(screen.getByLabelText("Visible condition notes"), "LEAK");
  expect(screen.getByRole("status")).toHaveTextContent("Account changed");
  expect(readInspectionDraft(getAccountScope(), lookup.id).raw).toBeNull();
  setActiveAccount("test-user");
  await user.click(screen.getByRole("button", { name: "Discard draft" }));
  expect(localStorage.getItem(inspectionDraftKey(lookup.id))).toBe(before);
  unmount();
  render(<PartInspectionForm lookup={getLookup(lookup.id)!} onSaved={vi.fn()} />);
  await user.click(screen.getByText("Human inspection — draft available"));
  await user.click(screen.getByRole("button", { name: "Restore draft" }));
  expect(screen.getByLabelText("Visible condition notes")).toHaveValue("Private notes for first account");
});

it("requires discarding a malformed recovery record before starting again", async () => {
  const user = userEvent.setup();
  const { lookup, unmount } = setup();
  unmount();
  localStorage.setItem(inspectionDraftKey(lookup.id), "{broken");
  render(<PartInspectionForm lookup={lookup} onSaved={vi.fn()} />);
  await user.click(screen.getByText("Human inspection — draft available"));
  expect(screen.queryByRole("button", { name: "Restore draft" })).not.toBeInTheDocument();
  expect(screen.getByLabelText("Visible condition notes")).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Discard draft" }));
  expect(screen.getByLabelText("Visible condition notes")).toBeEnabled();
  expect(localStorage.getItem(inspectionDraftKey(lookup.id))).toBeNull();
});

it("rechecks a saved inspection when restore is clicked", async () => {
  const user = userEvent.setup();
  const { lookup, unmount } = setup();
  await user.click(screen.getByText("Human inspection — optional"));
  await user.type(screen.getByLabelText("Visible condition notes"), "Unfinished notes");
  unmount();
  render(<PartInspectionForm lookup={lookup} onSaved={vi.fn()} />);
  await user.click(screen.getByText("Human inspection — draft available"));
  saveLookupInspection(lookup.id, { ...emptyPartInspection, inspectorName: "New inspector" });
  await user.click(screen.getByRole("button", { name: "Restore draft" }));
  expect(screen.getByRole("status")).toHaveTextContent("Inspection or device draft changed");
  expect(screen.getByLabelText("Visible condition notes")).toHaveValue("");
});

it.each([true, false])("does not retain or recreate a deleted scan's device draft (already edited: %s)", async (alreadyEdited) => {
  const user = userEvent.setup();
  const { lookup } = setup();
  await user.click(screen.getByText("Human inspection — optional"));
  if (alreadyEdited) {
    await user.type(screen.getByLabelText("Visible condition notes"), "Private draft");
    expect(readInspectionDraft(getAccountScope(), lookup.id).record).not.toBeNull();
  }
  expect(deleteLookup(lookup.id).ok).toBe(true);
  expect(readInspectionDraft(getAccountScope(), lookup.id).raw).toBeNull();
  await user.type(screen.getByLabelText("Visible condition notes"), " more");
  expect(readInspectionDraft(getAccountScope(), lookup.id).raw).toBeNull();
});
