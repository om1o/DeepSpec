import { accountStorageKey, setActiveAccount } from "../lib/accountScope";
import { appendChatMessages, createChatMessage, createLookup, deleteLookup, getLookup } from "../services/storage";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Link, MemoryRouter, Route, Routes } from "react-router-dom";
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
    expect(getLookup(saved.value!.id)?.chatHistory.map((message) => message.role)).toEqual([]);
  });

  it("does not persist a question while the request is pending or after infrastructure failure", async () => {
    localStorage.setItem(accountStorageKey(LOOKUPS_STORAGE_KEY), JSON.stringify([lookup]));
    let rejectAnswer!: (error: Error) => void;
    sendFollowUpMock.mockReturnValueOnce(new Promise((_, reject) => { rejectAnswer = reject; }));
    const view = renderChat(`/result/${lookup.id}/chat`);
    await userEvent.type(screen.getByLabelText("Ask a follow-up question"), "What is this?");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(getLookup(lookup.id)?.chatHistory).toEqual([]);
    await act(async () => { rejectAnswer(new AIServiceError("rate_limit_unavailable", "Limiter unavailable.")); });
    expect(getLookup(lookup.id)?.chatHistory).toEqual([]);
    expect(screen.getByRole("button", { name: "Retry last question" })).toBeInTheDocument();
    view.unmount();
    renderChat(`/result/${lookup.id}/chat`);
    expect(screen.getByText("No questions yet")).toBeInTheDocument();
  });

  it.each(["primary", "auxiliary"])("retries a completed answer after %s failure without another provider call", async (failure) => {
    localStorage.setItem(accountStorageKey(LOOKUPS_STORAGE_KEY), JSON.stringify([lookup]));
    sendFollowUpMock.mockResolvedValue("Check the marking.");
    renderChat(`/result/${lookup.id}/chat`);
    await userEvent.type(screen.getByLabelText("Ask a follow-up question"), "What is this?");
    const failedKey = accountStorageKey(failure === "primary" ? LOOKUPS_STORAGE_KEY : `deep-spec:chat:${lookup.id}`);
    const originalWrite = Storage.prototype.setItem;
    const writeSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (key, value) {
      if (key === failedKey) throw new DOMException("Full", "QuotaExceededError");
      originalWrite.call(this, key, value);
    });
    try {
      await userEvent.click(screen.getByRole("button", { name: "Send" }));
      expect(getLookup(lookup.id)?.chatHistory).toHaveLength(failure === "primary" ? 0 : 2);
      expect(screen.getByText("Check the marking.")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
      expect(screen.getByLabelText("Ask a follow-up question")).toBeDisabled();
      expect(screen.queryByRole("button", { name: "Retry last question" })).not.toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: "Retry saving answer" }));
      expect(sendFollowUpMock).toHaveBeenCalledTimes(1);
      expect(screen.getAllByText("Check the marking.")).toHaveLength(1);
    } finally {
      writeSpy.mockRestore();
    }
    const partialHistory = getLookup(lookup.id)!.chatHistory;
    await userEvent.click(screen.getByRole("button", { name: "Retry saving answer" }));
    expect(sendFollowUpMock).toHaveBeenCalledTimes(1);
    const saved = getLookup(lookup.id)!.chatHistory;
    expect(saved.map((message) => message.content)).toEqual(["What is this?", "Check the marking."]);
    if (failure === "auxiliary") expect(saved).toEqual(partialHistory);
    expect(JSON.parse(localStorage.getItem(accountStorageKey(`deep-spec:chat:${lookup.id}`))!)).toEqual(saved);
    expect(screen.queryByRole("button", { name: "Retry saving answer" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Ask a follow-up question")).toHaveValue("");
    expect(screen.getByLabelText("Ask a follow-up question")).toBeEnabled();
  });

  it.each(["other-user", "test-user", null])("blocks a completed save retry after switching accounts to %s", async (finalAccount) => {
    localStorage.setItem(accountStorageKey(LOOKUPS_STORAGE_KEY), JSON.stringify([lookup]));
    sendFollowUpMock.mockResolvedValue("Private retained answer.");
    renderChat(`/result/${lookup.id}/chat`);
    await userEvent.type(screen.getByLabelText("Ask a follow-up question"), "Private question");
    const writeSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("Full", "QuotaExceededError"); });
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    writeSpy.mockRestore();
    setActiveAccount("other-user");
    localStorage.setItem(accountStorageKey(LOOKUPS_STORAGE_KEY), JSON.stringify([lookup]));
    const otherKey = accountStorageKey(LOOKUPS_STORAGE_KEY);
    const otherBefore = localStorage.getItem(otherKey);
    setActiveAccount(finalAccount);
    await userEvent.click(screen.getByRole("button", { name: "Retry saving answer" }));
    expect(sendFollowUpMock).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(otherKey)).toBe(otherBefore);
    setActiveAccount("test-user");
    expect(getLookup(lookup.id)?.chatHistory).toEqual([]);
  });

  it.each(["/result/lookup-2/chat", "/away"])("ignores a provider completion after navigating to %s", async (destination) => {
    localStorage.setItem(accountStorageKey(LOOKUPS_STORAGE_KEY), JSON.stringify([lookup, { ...lookup, id: "lookup-2" }]));
    let resolveAnswer!: (answer: string) => void;
    sendFollowUpMock.mockReturnValueOnce(new Promise((resolve) => { resolveAnswer = resolve; }));
    renderChat(`/result/${lookup.id}/chat`, destination);
    await userEvent.type(screen.getByLabelText("Ask a follow-up question"), "Old page question");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    await userEvent.click(screen.getByRole("link", { name: "Navigate away" }));
    await act(async () => { resolveAnswer("Old page answer"); });
    expect(screen.queryByText("Old page answer")).not.toBeInTheDocument();
    expect(getLookup(lookup.id)?.chatHistory).toEqual([]);
    expect(getLookup("lookup-2")?.chatHistory).toEqual([]);
    if (destination.endsWith("chat")) {
      expect(screen.getByRole("link", { name: "Back" })).toHaveAttribute("href", "/result/lookup-2");
      expect(screen.getByLabelText("Ask a follow-up question")).toBeEnabled();
    }
  });

  it("clears a completed unsaved exchange when the scan route changes", async () => {
    localStorage.setItem(accountStorageKey(LOOKUPS_STORAGE_KEY), JSON.stringify([lookup, { ...lookup, id: "lookup-2" }]));
    sendFollowUpMock.mockResolvedValue("First scan answer.");
    renderChat(`/result/${lookup.id}/chat`, "/result/lookup-2/chat");
    await userEvent.type(screen.getByLabelText("Ask a follow-up question"), "First scan question");
    const writeSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("Full", "QuotaExceededError"); });
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    writeSpy.mockRestore();
    expect(screen.getByText("First scan answer.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("link", { name: "Navigate away" }));
    expect(screen.queryByText("First scan answer.")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry saving answer" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Ask a follow-up question")).toHaveValue("");
    expect(getLookup("lookup-2")?.chatHistory).toEqual([]);
  });

  it("does not recreate a deleted scan when retrying the retained answer", async () => {
    localStorage.setItem(accountStorageKey(LOOKUPS_STORAGE_KEY), JSON.stringify([lookup]));
    sendFollowUpMock.mockResolvedValue("Retained answer.");
    renderChat(`/result/${lookup.id}/chat`);
    await userEvent.type(screen.getByLabelText("Ask a follow-up question"), "Question");
    const writeSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("Full", "QuotaExceededError"); });
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    writeSpy.mockRestore();
    expect(deleteLookup(lookup.id).ok).toBe(true);
    await userEvent.click(screen.getByRole("button", { name: "Retry saving answer" }));
    expect(screen.getByText("This saved scan was not found.")).toBeInTheDocument();
    expect(getLookup(lookup.id)).toBeNull();
    expect(sendFollowUpMock).toHaveBeenCalledTimes(1);
  });

  it("reopens the durable exchange after an auxiliary-write failure without another provider call", async () => {
    localStorage.setItem(accountStorageKey(LOOKUPS_STORAGE_KEY), JSON.stringify([lookup]));
    appendChatMessages(lookup.id, [createChatMessage("user", "Earlier question"), createChatMessage("assistant", "Earlier answer")]);
    sendFollowUpMock.mockResolvedValue("New completed answer.");
    const view = renderChat(`/result/${lookup.id}/chat`);
    await userEvent.type(screen.getByLabelText("Ask a follow-up question"), "New question");
    const originalWrite = Storage.prototype.setItem;
    const failedKey = accountStorageKey(`deep-spec:chat:${lookup.id}`);
    const writeSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (key, value) {
      if (key === failedKey) throw new DOMException("Full", "QuotaExceededError");
      originalWrite.call(this, key, value);
    });
    const removeSpy = vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => { throw new Error("Unavailable"); });
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    writeSpy.mockRestore();
    removeSpy.mockRestore();
    view.unmount();
    renderChat(`/result/${lookup.id}/chat`);
    expect(screen.getByText("Earlier answer")).toBeInTheDocument();
    expect(screen.getByText("New completed answer.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry last question" })).not.toBeInTheDocument();
    expect(sendFollowUpMock).toHaveBeenCalledTimes(1);
  });

  it("prefills a suggested question from the result screen", () => {
    localStorage.setItem(accountStorageKey(LOOKUPS_STORAGE_KEY), JSON.stringify([lookup]));

    renderChat(`/result/${lookup.id}/chat?q=How%20serious%20is%20this%3F`);

    expect(screen.getByLabelText("Ask a follow-up question")).toHaveValue("How serious is this?");
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

  it("explains when beta chat is disabled without offering a retry", async () => {
    sendFollowUpMock.mockRejectedValue(new AIServiceError("feature_disabled", "Follow-up chat is unavailable in this beta."));
    localStorage.setItem(accountStorageKey(LOOKUPS_STORAGE_KEY), JSON.stringify([lookup]));

    const view = renderChat(`/result/${lookup.id}/chat`);

    await userEvent.type(screen.getByLabelText("Ask a follow-up question"), "What should I check next?");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByText("Follow-up chat is unavailable")).toBeInTheDocument();
    expect(screen.getByText("Follow-up chat is unavailable in this beta.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry last question" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Ask a follow-up question")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    expect(sendFollowUpMock).toHaveBeenCalledTimes(1);
    expect(getLookup(lookup.id)?.chatHistory).toEqual([]);
    view.unmount();
    renderChat(`/result/${lookup.id}/chat`);
    await userEvent.type(screen.getByLabelText("Ask a follow-up question"), "Another question after reload?");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText("Follow-up chat is unavailable")).toBeInTheDocument();
    expect(getLookup(lookup.id)?.chatHistory).toEqual([]);
    expect(localStorage.getItem(accountStorageKey(`deep-spec:chat:${lookup.id}`))).toBeNull();
  });

  it("preserves earlier conversation history on disabled chat", async () => {
    const messages: ChatMessage[] = [
      { id: "old-user", role: "user", content: "Earlier question", timestamp: lookup.createdAt },
      { id: "old-answer", role: "assistant", content: "Earlier answer", timestamp: lookup.createdAt },
    ];
    localStorage.setItem(accountStorageKey(LOOKUPS_STORAGE_KEY), JSON.stringify([{ ...lookup, chatHistory: messages }]));
    sendFollowUpMock.mockRejectedValue(new AIServiceError("feature_disabled", "Follow-up chat is unavailable in this beta."));
    renderChat(`/result/${lookup.id}/chat`);
    await userEvent.type(screen.getByLabelText("Ask a follow-up question"), "New question");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText("Follow-up chat is unavailable")).toBeInTheDocument();
    expect(getLookup(lookup.id)?.chatHistory).toEqual(messages);
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

function renderChat(path: string, destination = "/away") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Link to={destination}>Navigate away</Link>
      <Routes>
        <Route path="/result/:id/chat" element={<Chat />} />
        <Route path="/away" element={<p>Another page</p>} />
      </Routes>
    </MemoryRouter>,
  );
}
