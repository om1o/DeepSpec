import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, vi } from "vitest";
import EarlyAccess from "./EarlyAccess";
import { ENGAGEMENT_STORAGE_KEY } from "../services/engagement";
import * as cloudSync from "../services/cloudSync";

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

    const savedData = JSON.parse(localStorage.getItem(ENGAGEMENT_STORAGE_KEY) ?? "{}");
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
    const savedData = JSON.parse(localStorage.getItem(ENGAGEMENT_STORAGE_KEY) ?? "{}");
    expect(savedData.waitlist).toHaveLength(1);
  });
});

function renderEarlyAccess() {
  render(
    <MemoryRouter initialEntries={["/early-access"]}>
      <Routes>
        <Route path="/early-access" element={<EarlyAccess />} />
      </Routes>
    </MemoryRouter>,
  );
}
