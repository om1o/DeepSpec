import { accountStorageKey } from "../lib/accountScope";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, vi } from "vitest";
import EarlyAccess from "./EarlyAccess";
import { ENGAGEMENT_STORAGE_KEY } from "../services/engagement";
import * as cloudSync from "../services/cloudSync";
import { createLookup } from "../services/storage";
import { getEngagementData } from "../services/engagement";

describe("EarlyAccess", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubEnv("VITE_SUPABASE_URL", "");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("shows the business experiment page", () => {
    renderEarlyAccess();

    expect(screen.getByRole("heading", { name: "Early access" })).toBeInTheDocument();
    expect(screen.getByText("The visual layer for parts")).toBeInTheDocument();
    expect(screen.getByText("Off")).toBeInTheDocument();
    expect(screen.getByText("Your scans are saved on this device. Cloud sync is off for this build.")).toBeInTheDocument();
  });

  it("saves waitlist and feedback entries locally", async () => {
    renderEarlyAccess();

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "tester@example.com" } });
    fireEvent.change(screen.getByLabelText("What should Deep Spec solve?"), {
      target: { value: "Help me understand used-car leaks." },
    });
    await userEvent.click(screen.getByRole("button", { name: "Save waitlist entry" }));

    expect(await screen.findByText("Saved on this device. Cloud sync is off for this build.")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Feedback"), {
      target: { value: "I would pay for scan reports I can send to a mechanic." },
    });
    await userEvent.click(screen.getByRole("button", { name: "Save feedback" }));

    expect(await screen.findByText("Feedback saved on this device. Cloud sync is off for this build.")).toBeInTheDocument();

    const savedData = JSON.parse(localStorage.getItem(accountStorageKey(ENGAGEMENT_STORAGE_KEY)) ?? "{}");
    expect(savedData.waitlist).toHaveLength(1);
    expect(savedData.feedback).toHaveLength(1);
  });

  it("syncs waitlist and feedback when cloud config is present", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
    const waitlistSync = vi.spyOn(cloudSync, "syncWaitlistSignupToCloud").mockResolvedValue({ ok: true, message: "Waitlist entry synced." });
    const feedbackSync = vi.spyOn(cloudSync, "syncFeedbackToCloud").mockResolvedValue({ ok: true, message: "Feedback synced." });
    renderEarlyAccess();

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "tester@example.com" } });
    fireEvent.change(screen.getByLabelText("What should Deep Spec solve?"), {
      target: { value: "Help me understand used-car leaks." },
    });
    await userEvent.click(screen.getByRole("button", { name: "Save waitlist entry" }));

    expect(await screen.findByText("Saved on this device and synced to cloud.")).toBeInTheDocument();
    expect(waitlistSync).toHaveBeenCalledWith(expect.objectContaining({ email: "tester@example.com" }));

    fireEvent.change(screen.getByLabelText("Feedback"), {
      target: { value: "I would pay for scan reports I can send to a mechanic." },
    });
    await userEvent.click(screen.getByRole("button", { name: "Save feedback" }));

    expect(await screen.findByText("Feedback saved on this device and synced to cloud.")).toBeInTheDocument();
    expect(feedbackSync).toHaveBeenCalledWith(expect.objectContaining({ message: "I would pay for scan reports I can send to a mechanic." }));
  });

  it("keeps local Early Access data when cloud sync fails", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
    vi.spyOn(cloudSync, "syncWaitlistSignupToCloud").mockResolvedValue({ ok: false, message: "Cloud sync failed: network unavailable" });
    renderEarlyAccess();

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "tester@example.com" } });
    fireEvent.change(screen.getByLabelText("What should Deep Spec solve?"), {
      target: { value: "Help me understand used-car leaks." },
    });
    await userEvent.click(screen.getByRole("button", { name: "Save waitlist entry" }));

    expect(await screen.findByText("Saved on this device. Cloud sync failed: network unavailable")).toBeInTheDocument();
    const savedData = JSON.parse(localStorage.getItem(accountStorageKey(ENGAGEMENT_STORAGE_KEY)) ?? "{}");
    expect(savedData.waitlist).toHaveLength(1);
  });

  it("submits a specific AR report with no required notes and no attached context by default", async () => {
    const saved = createLookup({ frame: { imageBase64: "private-image", capturedAt: new Date().toISOString() } });
    if (!saved.value) throw new Error("fixture save failed");
    renderEarlyAccess(`/early-access?scan=${saved.value.id}`);
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    await userEvent.selectOptions(screen.getByLabelText("What went wrong?"), "ar_jitter");
    await userEvent.click(screen.getByRole("button", { name: "Save feedback" }));
    expect(getEngagementData().feedback[0]).toMatchObject({ issue: "ar_jitter", category: "scanner" });
    expect(getEngagementData().feedback[0].context).toBeUndefined();
  });

  it("attaches only an explicitly selected, locally owned scan context", async () => {
    const saved = createLookup({ frame: { imageBase64: "private-image", capturedAt: new Date().toISOString() } });
    if (!saved.value) throw new Error("fixture save failed");
    renderEarlyAccess(`/early-access?scan=${saved.value.id}`);
    await userEvent.click(screen.getByRole("checkbox"));
    await userEvent.selectOptions(screen.getByLabelText("What went wrong?"), "wrong_part");
    await userEvent.click(screen.getByRole("button", { name: "Save feedback" }));
    expect(getEngagementData().feedback[0].context).toEqual({ scanId: saved.value.id, predictedPart: "" });
  });

  it("does not expose a scan context for an unknown scan ID", () => {
    renderEarlyAccess("/early-access?scan=someone-elses-scan");
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("blocks duplicate submits while cloud delivery is pending and preserves a failed report locally", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
    let finish!: (result: { ok: boolean; message: string }) => void;
    const sync = vi.spyOn(cloudSync, "syncFeedbackToCloud").mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    renderEarlyAccess();
    await userEvent.selectOptions(screen.getByLabelText("What went wrong?"), "bug");
    await userEvent.click(screen.getByRole("button", { name: "Save feedback" }));
    const pendingButton = screen.getByRole("button", { name: "Sending feedback…" });
    expect(pendingButton).toBeDisabled();
    fireEvent.submit(pendingButton.closest("form")!);
    expect(sync).toHaveBeenCalledTimes(1);
    expect(getEngagementData().feedback).toHaveLength(1);
    await act(async () => finish({ ok: false, message: "Cloud unavailable." }));
    expect(screen.getByRole("status")).toHaveTextContent("Feedback saved on this device. Cloud unavailable.");
    expect(screen.getByRole("button", { name: "Save feedback" })).toBeEnabled();
  });
});

function renderEarlyAccess(path = "/early-access") {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/early-access" element={<EarlyAccess />} />
      </Routes>
    </MemoryRouter>,
  );
}
