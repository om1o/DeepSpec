import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, vi } from "vitest";
import EarlyAccess from "./EarlyAccess";
import { ENGAGEMENT_STORAGE_KEY } from "../services/engagement";

describe("EarlyAccess", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubEnv("VITE_SUPABASE_URL", "");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("shows the business experiment page", () => {
    renderEarlyAccess();

    expect(screen.getByRole("heading", { name: "Early access" })).toBeInTheDocument();
    expect(screen.getByText("Business experiment")).toBeInTheDocument();
    expect(screen.getByText("Off")).toBeInTheDocument();
    expect(screen.getByText("Cloud sync is off. Add Supabase public config after parent-approved privacy setup.")).toBeInTheDocument();
  });

  it("does not call cloud waitlist or feedback sync ready when Supabase config is only present", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
    renderEarlyAccess();

    expect(screen.getByText("Verify")).toBeInTheDocument();
    expect(
      screen.getByText("Cloud sync is configured, but production readiness still depends on the Supabase verifier passing."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "This saves locally right now. Cloud waitlist sync stays off until parent-approved privacy terms and the Supabase verifier pass.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Tell us what would make Deep Spec worth coming back to. Feedback stays local until cloud health, privacy terms, and backend sync are verified.",
      ),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "tester@example.com" } });
    fireEvent.change(screen.getByLabelText("What problem should Deep Spec solve?"), {
      target: { value: "Help me understand used-car leaks." },
    });
    await userEvent.click(screen.getByRole("button", { name: "Save waitlist entry" }));

    expect(
      await screen.findByText("Saved on this device. Cloud waitlist sync waits for Supabase verifier and privacy review."),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Feedback"), {
      target: { value: "I would pay for scan reports I can send to a mechanic." },
    });
    await userEvent.click(screen.getByRole("button", { name: "Save feedback" }));

    expect(
      await screen.findByText("Feedback saved locally. Cloud feedback sync waits for Supabase verifier and privacy review."),
    ).toBeInTheDocument();
  });

  it("keeps engagement forms local even after cloud health is verified", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
    localStorage.setItem(
      "deep-spec:cloud-health",
      JSON.stringify({
        checkedAt: "2026-05-22T17:05:00.000Z",
        configured: true,
        lastVerifiedAt: "2026-05-22T17:05:00.000Z",
        message: "Cloud sync passed runtime health checks.",
        overall: "ready",
        projectUrl: "https://example.supabase.co",
        checks: {
          anonymousAuth: { id: "anonymousAuth", label: "Anonymous auth", message: "Passed.", status: "pass" },
          configured: { id: "configured", label: "Supabase config", message: "Passed.", status: "pass" },
          rlsIsolation: { id: "rlsIsolation", label: "RLS isolation", message: "Passed.", status: "pass" },
          rowUpsert: { id: "rowUpsert", label: "Row upsert", message: "Passed.", status: "pass" },
          storageUpload: { id: "storageUpload", label: "Image upload", message: "Passed.", status: "pass" },
        },
      }),
    );
    renderEarlyAccess();

    expect(screen.getByText("Ready")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Cloud health is verified, but early-access contact data still saves locally until privacy-approved engagement sync is enabled.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "This saves locally right now. Cloud health is verified, but waitlist sync stays off until parent-approved privacy terms enable engagement storage.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Tell us what would make Deep Spec worth coming back to. Cloud health is verified, but feedback still saves locally until privacy-approved engagement sync is enabled.",
      ),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "tester@example.com" } });
    fireEvent.change(screen.getByLabelText("What problem should Deep Spec solve?"), {
      target: { value: "Help me understand used-car leaks." },
    });
    await userEvent.click(screen.getByRole("button", { name: "Save waitlist entry" }));

    expect(
      await screen.findByText(
        "Saved on this device. Cloud health is verified; waitlist sync still waits for privacy-approved engagement storage.",
      ),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Feedback"), {
      target: { value: "I would pay for scan reports I can send to a mechanic." },
    });
    await userEvent.click(screen.getByRole("button", { name: "Save feedback" }));

    expect(
      await screen.findByText(
        "Feedback saved locally. Cloud health is verified; feedback sync still waits for privacy-approved engagement storage.",
      ),
    ).toBeInTheDocument();
  });

  it("saves waitlist and feedback entries locally", async () => {
    renderEarlyAccess();

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "tester@example.com" } });
    fireEvent.change(screen.getByLabelText("What problem should Deep Spec solve?"), {
      target: { value: "Help me understand used-car leaks." },
    });
    await userEvent.click(screen.getByRole("button", { name: "Save waitlist entry" }));

    expect(await screen.findByText("Saved on this device. Backend sync comes after privacy review.")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Feedback"), {
      target: { value: "I would pay for scan reports I can send to a mechanic." },
    });
    await userEvent.click(screen.getByRole("button", { name: "Save feedback" }));

    expect(await screen.findByText("Feedback saved locally.")).toBeInTheDocument();

    const savedData = JSON.parse(localStorage.getItem(ENGAGEMENT_STORAGE_KEY) ?? "{}");
    expect(savedData.waitlist).toHaveLength(1);
    expect(savedData.feedback).toHaveLength(1);
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
