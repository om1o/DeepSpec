import { accountStorageKey, setActiveAccount } from "../lib/accountScope";
import { createLookup, getLookup } from "../services/storage";
import { act, render, screen } from "@testing-library/react";
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
    localStorage.setItem(accountStorageKey(LOOKUPS_STORAGE_KEY), JSON.stringify([lookup]));

    renderChat(`/result/${lookup.id}/chat`);

    await userEvent.type(screen.getByLabelText("Ask a follow-up question"), "What does it do?");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByText("The alternator charges the battery while the engine runs.")).toBeInTheDocument();

    const chatHistory = JSON.parse(localStorage.getItem(accountStorageKey(`deep-spec:chat:${lookup.id}`)) ?? "[]") as ChatMessage[];
    expect(chatHistory).toHaveLength(2);
    expect(chatHistory.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(sendFollowUpMock).toHaveBeenCalledWith(expect.objectContaining({ id: lookup.id }), "What does it do?");
  });

  it.each(["other-user", "test-user"])("discards a pending answer after account change ending at %s", async (finalAccount) => {
    const saved = createLookup({ frame: lookup.frame, result: lookup.result });
    let resolveAnswer!: (answer: string) => void;
    sendFollowUpMock.mockReturnValueOnce(new Promise((resolve) => { resolveAnswer = resolve; }));
    renderChat(`/result/${saved.value!.id}/chat`);
    await userEvent.type(screen.getByLabelText("Ask a follow-up question"), "What is this?");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    setActiveAccount("other-user");
    setActiveAccount(finalAccount);
    await act(async () => { resolveAnswer("Private answer from old session"); });
    expect(screen.queryByText("Private answer from old session")).not.toBeInTheDocument();
    setActiveAccount("test-user");
    expect(getLookup(saved.value!.id)?.chatHistory.map((message) => message.role)).toEqual(["user"]);
  });

  it("prefills a suggested question from the result screen", () => {
    localStorage.setItem(accountStorageKey(LOOKUPS_STORAGE_KEY), JSON.stringify([lookup]));

    renderChat(`/result/${lookup.id}/chat?q=How%20serious%20is%20this%3F`);

    expect(screen.getByLabelText("Ask a follow-up question")).toHaveValue("How serious is this?");
  });

  it("automatically sends a question submitted from the result screen", async () => {
    sendFollowUpMock.mockResolvedValue("Check the belt, connector, and visible label next.");
    localStorage.setItem(accountStorageKey(LOOKUPS_STORAGE_KEY), JSON.stringify([lookup]));

    renderChat(
      `/result/${lookup.id}/chat?q=What%20should%20I%20check%20next%3F`,
      { autoSend: true },
    );

    expect(await screen.findByText("Check the belt, connector, and visible label next.")).toBeInTheDocument();
    expect(sendFollowUpMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: lookup.id }),
      "What should I check next?",
    );
    expect(getLookup(lookup.id)?.chatHistory.map((message) => message.role)).toEqual(["user", "assistant"]);
  });

  it("renders a long answer in calm zones with optional detail", async () => {
    const structuredAnswer = [
      "OVERVIEW",
      "This is the likely charging component. It supports the electrical system while the engine runs.",
      "WHAT TO CHECK",
      "Inspect the belt path first. Look for a readable label next. Check the connector without forcing it.",
      "MORE DETAIL",
      "The housing shape supports the match. Similar rotating accessories can still look alike from one angle. A second photo can reduce that uncertainty.",
    ].join("\n");
    localStorage.setItem(accountStorageKey(LOOKUPS_STORAGE_KEY), JSON.stringify([{
      ...lookup,
      chatHistory: [{ id: "answer-1", role: "assistant", content: structuredAnswer, timestamp: "2026-05-16T00:01:00.000Z" }],
    }]));

    renderChat(`/result/${lookup.id}/chat`);

    expect(screen.getByText("Overview")).toBeInTheDocument();
    expect(screen.getByText("What to check")).toBeInTheDocument();
    const details = screen.getByText("More detail").closest("details");
    expect(details).not.toHaveAttribute("open");
    await userEvent.click(screen.getByText("More detail"));
    expect(details).toHaveAttribute("open");
  });

  it("offers a small set of follow-up prompts without sending them immediately", async () => {
    localStorage.setItem(accountStorageKey(LOOKUPS_STORAGE_KEY), JSON.stringify([lookup]));

    renderChat(`/result/${lookup.id}/chat`);

    await userEvent.click(screen.getByRole("button", { name: "What could this be confused with?" }));
    expect(screen.getByLabelText("Ask a follow-up question")).toHaveValue("What could this be confused with?");
    expect(sendFollowUpMock).not.toHaveBeenCalled();
  });

  it("explains provider rate limits without treating them as bad scan answers", async () => {
    sendFollowUpMock.mockRejectedValue(new AIServiceError("rate_limited", "Too many AI chat requests right now. Try again in a few minutes."));
    localStorage.setItem(accountStorageKey(LOOKUPS_STORAGE_KEY), JSON.stringify([lookup]));

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
    localStorage.setItem(accountStorageKey(LOOKUPS_STORAGE_KEY), JSON.stringify([lookup]));

    renderChat(`/result/${lookup.id}/chat`);

    await userEvent.type(screen.getByLabelText("Ask a follow-up question"), "What should I check next?");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    await userEvent.click(await screen.findByRole("button", { name: "Retry last question" }));

    expect(await screen.findByText("Check the belt and battery light symptoms together.")).toBeInTheDocument();

    const chatHistory = JSON.parse(localStorage.getItem(accountStorageKey(`deep-spec:chat:${lookup.id}`)) ?? "[]") as ChatMessage[];
    expect(chatHistory.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(chatHistory.filter((message) => message.content === "What should I check next?")).toHaveLength(1);
    expect(sendFollowUpMock).toHaveBeenCalledTimes(2);
  });
});

function renderChat(path: string, state?: unknown) {
  const url = new URL(path, "https://deepspec.test");
  render(
    <MemoryRouter initialEntries={[{ pathname: url.pathname, search: url.search, state }]}>
      <Routes>
        <Route path="/result/:id/chat" element={<Chat />} />
      </Routes>
    </MemoryRouter>,
  );
}
