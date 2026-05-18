import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import EarlyAccess from "./EarlyAccess";
import { ENGAGEMENT_STORAGE_KEY } from "../services/engagement";

describe("EarlyAccess", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("shows the business experiment page", () => {
    renderEarlyAccess();

    expect(screen.getByRole("heading", { name: "Early access" })).toBeInTheDocument();
    expect(screen.getByText("Business experiment")).toBeInTheDocument();
    expect(screen.getByText("Off")).toBeInTheDocument();
    expect(screen.getByText("Cloud sync is off. Add Supabase public config after parent-approved privacy setup.")).toBeInTheDocument();
  });

  it("saves waitlist and feedback entries locally", async () => {
    renderEarlyAccess();

    await userEvent.type(screen.getByLabelText("Email"), "tester@example.com");
    await userEvent.type(screen.getByLabelText("What problem should Deep Spec solve?"), "Help me understand used-car leaks.");
    await userEvent.click(screen.getByRole("button", { name: "Save waitlist entry" }));

    expect(await screen.findByText("Saved on this device. Backend sync comes after privacy review.")).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText("Feedback"), "I would pay for scan reports I can send to a mechanic.");
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
