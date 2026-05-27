import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { vi } from "vitest";
import Chat from "./Chat";
import { AIServiceError, sendFollowUp } from "../services/aiService";
import { LOOKUPS_STORAGE_KEY } from "../services/storage";
import type { ChatMessage } from "../types";
import type { Lookup } from "../types";

vi.mock("../services/aiService", async () => {
  const actual = await vi.importActual<typeof import("../services/aiService")>("../services/aiService");
  return {
    ...actual,
    sendFollowUp: vi.fn(),
  };
});

const sendFollowUpMock = vi.mocked(sendFollowUp);

const lookup: Lookup = {
  id: "lookup-1",
  createdAt: "2026-05-16T00:00:00.000Z",
  frame: {
    imageBase64: "data:image/jpeg;base64,test-image",
    capturedAt: "2026-05-16T00:00:00.000Z",
  },
  result: {
    partName: "Alternator",
    confidence: "high",
    scanCategory: "electrical",
    candidateMatches: [],
    whatItDoes: "It charges the battery while the engine runs.",
    visibleObservations: ["Belt-driven housing is visible."],
    evidenceRegions: [],
    concerns: [],
    safetyTriage: "can_help",
    isSafetyCritical: false,
    nextAction: "Take another photo if needed.",
    needsBetterPhoto: false,
    evidence: ["The pulley and housing match an alternator."],
    sourceLinks: [],
  },
  analyzedAt: "2026-05-16T00:00:05.000Z",
  rating: null,
  correction: null,
  notes: "",
  scanCategory: "electrical",
  trainingLabel: "Alternator",
  trainingStatus: "raw_unreviewed",
  chatHistory: [],
};

describe("Chat", () => {
  beforeEach(() => {
    localStorage.clear();
    sendFollowUpMock.mockReset();
  });

  it("shows a saved scan not found state", () => {
    renderChat("/result/missing/chat");

    expect(screen.getByText("Scan not found")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Saved scans" })).toHaveAttribute("href", "/history");
  });

  it("sends a follow-up and saves the chat history", async () => {
    sendFollowUpMock.mockResolvedValue("The alternator charges the battery while the engine runs.");
    localStorage.setItem(LOOKUPS_STORAGE_KEY, JSON.stringify([lookup]));

    renderChat(`/result/${lookup.id}/chat`);

    await userEvent.type(screen.getByLabelText("Ask a follow-up question"), "What does it do?");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByText("The alternator charges the battery while the engine runs.")).toBeInTheDocument();

    const chatHistory = JSON.parse(localStorage.getItem(`deep-spec:chat:${lookup.id}`) ?? "[]") as ChatMessage[];
    expect(chatHistory).toHaveLength(2);
    expect(chatHistory.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(sendFollowUpMock).toHaveBeenCalledWith(expect.objectContaining({ id: lookup.id }), "What does it do?");
  });

  it("prefills a suggested question from the result screen", () => {
    localStorage.setItem(LOOKUPS_STORAGE_KEY, JSON.stringify([lookup]));

    renderChat(`/result/${lookup.id}/chat?q=How%20serious%20is%20this%3F`);

    expect(screen.getByLabelText("Ask a follow-up question")).toHaveValue("How serious is this?");
  });

  it("explains provider rate limits without treating them as bad scan answers", async () => {
    sendFollowUpMock.mockRejectedValue(new AIServiceError("rate_limited", "Too many AI chat requests right now. Try again in a few minutes."));
    localStorage.setItem(LOOKUPS_STORAGE_KEY, JSON.stringify([lookup]));

    renderChat(`/result/${lookup.id}/chat`);

    await userEvent.type(screen.getByLabelText("Ask a follow-up question"), "What should I check next?");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByText("AI provider is rate-limited")).toBeInTheDocument();
    expect(screen.getByText("Too many AI chat requests right now. Try again in a few minutes.")).toBeInTheDocument();
    expect(screen.getByText(/not proof the model identified the part incorrectly/i)).toBeInTheDocument();
  });

  it("retries the last unanswered question without duplicating the saved user message", async () => {
    sendFollowUpMock
      .mockRejectedValueOnce(new AIServiceError("provider_error", "The AI provider rejected this request."))
      .mockResolvedValueOnce("Check the belt and battery light symptoms together.");
    localStorage.setItem(LOOKUPS_STORAGE_KEY, JSON.stringify([lookup]));

    renderChat(`/result/${lookup.id}/chat`);

    await userEvent.type(screen.getByLabelText("Ask a follow-up question"), "What should I check next?");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    await userEvent.click(await screen.findByRole("button", { name: "Retry last question" }));

    expect(await screen.findByText("Check the belt and battery light symptoms together.")).toBeInTheDocument();

    const chatHistory = JSON.parse(localStorage.getItem(`deep-spec:chat:${lookup.id}`) ?? "[]") as ChatMessage[];
    expect(chatHistory.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(chatHistory.filter((message) => message.content === "What should I check next?")).toHaveLength(1);
    expect(sendFollowUpMock).toHaveBeenCalledTimes(2);
  });
});

function renderChat(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/result/:id/chat" element={<Chat />} />
      </Routes>
    </MemoryRouter>,
  );
}
