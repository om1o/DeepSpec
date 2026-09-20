import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PartInspectionForm } from "./PartInspectionForm";
import { createLookup, getLookup } from "../../services/storage";
import * as cloud from "../../services/cloudSync";

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(cloud, "getCloudSyncStatus").mockReturnValue({ configured: false, message: "Local only" });
});
afterEach(() => vi.restoreAllMocks());

function setup() {
  const lookup = createLookup({ frame: { imageBase64: "data:image/jpeg;base64,test", capturedAt: "2026-09-20T12:00:00Z" } }).value;
  const onSaved = vi.fn();
  const view = render(<PartInspectionForm lookup={lookup} onSaved={onSaved} />);
  return { lookup, onSaved, ...view };
}

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
