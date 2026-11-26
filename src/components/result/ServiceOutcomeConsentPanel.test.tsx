import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { setActiveAccount } from "../../lib/accountScope";
import { isCloudSyncEnabled } from "../../services/cloudSyncPolicy";
import { loadServiceOutcomeConsent, saveServiceOutcomeConsent, type ServiceOutcomeConsent } from "../../services/serviceOutcomeConsent";
import { ServiceOutcomeConsentPanel } from "./ServiceOutcomeConsentPanel";

vi.mock("../../services/serviceOutcomeConsent", () => ({ loadServiceOutcomeConsent: vi.fn(), saveServiceOutcomeConsent: vi.fn() }));
vi.mock("../../services/cloudSyncPolicy", () => ({ isCloudSyncEnabled: vi.fn(() => true) }));
const off: ServiceOutcomeConsent = { enabled: false, revision: null, updatedAt: null };
const on: ServiceOutcomeConsent = { enabled: true, revision: 1, updatedAt: "2026-11-26T00:00:00Z" };
const props = { scanId: "scan-1", recordId: "record-1", current: true };
beforeEach(() => { vi.mocked(isCloudSyncEnabled).mockReturnValue(true); vi.mocked(loadServiceOutcomeConsent).mockResolvedValue(off); });
afterEach(() => { vi.resetAllMocks(); });

it("keeps the separate outcome choice off until explicitly saved", async () => {
  const user = userEvent.setup();
  vi.mocked(saveServiceOutcomeConsent).mockResolvedValue(on);
  render(<ServiceOutcomeConsentPanel {...props} />);
  await screen.findByText("Outcome evaluation consent is off.");
  expect(screen.getByText(/separate from scan training consent/)).toBeInTheDocument();
  expect(screen.getByRole("checkbox")).not.toBeChecked();
  expect(screen.getByRole("button", { name: "Save outcome consent" })).toBeDisabled();
  await user.click(screen.getByRole("checkbox"));
  await user.click(screen.getByRole("button", { name: "Save outcome consent" }));
  expect(saveServiceOutcomeConsent).toHaveBeenCalledWith("scan-1", "record-1", true, null, expect.objectContaining({ userId: "test-user" }));
  expect(screen.getByRole("status")).toHaveTextContent("human reviewer");
});
it("allows withdrawal from a corrected follow-up but blocks a new opt-in", async () => {
  const user = userEvent.setup();
  vi.mocked(loadServiceOutcomeConsent).mockResolvedValue(on);
  vi.mocked(saveServiceOutcomeConsent).mockResolvedValue({ enabled: false, revision: 2, updatedAt: "2026-11-26T01:00:00Z" });
  render(<ServiceOutcomeConsentPanel {...props} current={false} />);
  await screen.findByText("Outcome evaluation consent is on.");
  expect(screen.getByRole("checkbox")).toBeChecked();
  await user.click(screen.getByRole("checkbox"));
  await user.click(screen.getByRole("button", { name: "Save outcome consent" }));
  expect(saveServiceOutcomeConsent).toHaveBeenCalledWith("scan-1", "record-1", false, 1, expect.anything());
  expect(screen.getByRole("checkbox")).toBeDisabled();
});
it("does not silently claim a failed withdrawal", async () => {
  const user = userEvent.setup();
  vi.mocked(loadServiceOutcomeConsent).mockResolvedValue(on);
  vi.mocked(saveServiceOutcomeConsent).mockRejectedValue(new Error("Cloud write failed."));
  render(<ServiceOutcomeConsentPanel {...props} />);
  await screen.findByText("Outcome evaluation consent is on.");
  await user.click(screen.getByRole("checkbox"));
  await user.click(screen.getByRole("button", { name: "Save outcome consent" }));
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Cloud write failed"));
  expect(screen.getByRole("checkbox")).toBeChecked();
  expect(screen.queryByText(/excluded from future evaluation exports/)).not.toBeInTheDocument();
});
it("blocks changes while cloud sync is off", async () => {
  vi.mocked(isCloudSyncEnabled).mockReturnValue(false);
  render(<ServiceOutcomeConsentPanel {...props} />);
  expect(screen.getByRole("checkbox")).toBeDisabled();
  expect(screen.getByRole("status")).toHaveTextContent("turning off sync does not withdraw");
  expect(loadServiceOutcomeConsent).not.toHaveBeenCalled();
});
it("ignores a stale previous-account load", async () => {
  let resolve!: (value: ServiceOutcomeConsent) => void;
  vi.mocked(loadServiceOutcomeConsent).mockReturnValue(new Promise((done) => { resolve = done; }));
  const view = render(<ServiceOutcomeConsentPanel {...props} />);
  setActiveAccount("other-user"); setActiveAccount("test-user");
  view.rerender(<ServiceOutcomeConsentPanel {...props} />);
  await act(async () => resolve(on));
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("Account changed");
});
