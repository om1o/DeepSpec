import { accountStorageKey, setActiveAccount } from "../lib/accountScope";
import { appendChatMessages, createChatMessage, createLookup, deleteLookup, getLookup } from "../services/storage";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Link, MemoryRouter, Route, Routes } from "react-router-dom";
import { vi } from "vitest";
import Chat from "./Chat";
import { AIServiceError, sendFollowUp, sendFollowUpDetails } from "../services/aiService";
import { syncLookupChatToCloud } from "../services/cloudSync";
import { readCloudLookup } from "../services/cloudHistory";
import { LOOKUPS_STORAGE_KEY } from "../services/storage";
import type { ChatMessage } from "../types";
import type { Lookup } from "../types";

vi.mock("../services/aiService", async () => {
  const actual = await vi.importActual<typeof import("../services/aiService")>("../services/aiService");
  return {
    ...actual,
    sendFollowUp: vi.fn(),
    sendFollowUpDetails: vi.fn(),
  };
});

vi.mock("../services/cloudSync", () => ({
  syncLookupChatToCloud: vi.fn(),
}));

const sendFollowUpMock = vi.mocked(sendFollowUp);
const sendFollowUpDetailsMock = vi.mocked(sendFollowUpDetails);
const syncLookupChatToCloudMock = vi.mocked(syncLookupChatToCloud);
vi.mock("../services/cloudHistory", () => ({ readCloudLookup: vi.fn() }));
const readCloudLookupMock = vi.mocked(readCloudLookup);

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
    vi.stubEnv("VITE_ENABLE_CLOUD_SYNC", "true");
    localStorage.clear();
    readCloudLookupMock.mockReset();
    readCloudLookupMock.mockResolvedValue({ ok: true, value: null });
    sendFollowUpMock.mockReset();
    sendFollowUpDetailsMock.mockReset();
    syncLookupChatToCloudMock.mockReset();
    syncLookupChatToCloudMock.mockResolvedValue({ ok: true, message: "Scan synced." });
  });

  afterEach(() => vi.unstubAllEnvs());

  it("saves an answered exchange locally without cloud calls or a misleading retry when cloud sync is off", async () => {
    vi.stubEnv("VITE_ENABLE_CLOUD_SYNC", "false");
    sendFollowUpMock.mockResolvedValue("This answer stays with your saved photo.");
    localStorage.setItem(accountStorageKey(LOOKUPS_STORAGE_KEY), JSON.stringify([lookup]));
    renderChat(`/result/${lookup.id}/chat`);
    await userEvent.type(screen.getByLabelText("Ask a follow-up question"), "What should I photograph next?");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText("This answer stays with your saved photo.")).toBeInTheDocument();
    expect(getLookup(lookup.id)?.chatHistory.map((message) => message.content)).toEqual([
      "What should I photograph next?", "This answer stays with your saved photo.",
    ]);
    expect(sendFollowUpMock).toHaveBeenCalledTimes(1);
    expect(syncLookupChatToCloudMock).not.toHaveBeenCalled();
    expect(readCloudLookupMock).not.toHaveBeenCalled();
    expect(screen.getByText("Cloud sync is off. Saved conversations stay on this device.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry cloud save" })).not.toBeInTheDocument();
    expect(screen.queryByText("Conversation needs cloud sync")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Ask a follow-up question")).toBeEnabled();
  });

  it("explains unavailable cloud-only photos without fetching or claiming the scan is absent", async () => {
    vi.stubEnv("VITE_ENABLE_CLOUD_SYNC", "false");
    localStorage.setItem(accountStorageKey(LOOKUPS_STORAGE_KEY), JSON.stringify([{ ...lookup, frame: { ...lookup.frame, imageBase64: "https://example.test/signed-photo.jpg" } }]));
    renderChat(`/result/${lookup.id}/chat`);
    expect(await screen.findByText("Cloud history is off. Open a scan whose photos are saved on this device.")).toBeInTheDocument();
    expect(readCloudLookupMock).not.toHaveBeenCalled();
    expect(sendFollowUpMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Retry loading scan" })).not.toBeInTheDocument();
  });

  it("shows a saved scan not found state", async () => {
    renderChat("/result/missing/chat");

    expect(await screen.findByText("Scan not found")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Saved scans" })).toHaveAttribute("href", "/history");
  });

  it("restores an exact cloud scan before sending and syncing its chat", async () => {
    readCloudLookupMock.mockResolvedValue({ ok: true, value: lookup });
    sendFollowUpMock.mockResolvedValue("Restored answer.");
    renderChat(`/result/${lookup.id}/chat`);
    expect(screen.getByRole("heading", { name: "Loading saved scan" })).toBeInTheDocument();
    await userEvent.type(await screen.findByLabelText("Ask a follow-up question"), "What is this?");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText("Restored answer.")).toBeInTheDocument();
    expect(readCloudLookupMock).toHaveBeenCalledWith(lookup.id);
    expect(getLookup(lookup.id)?.chatHistory).toHaveLength(2);
    expect(syncLookupChatToCloudMock).toHaveBeenCalledWith(expect.objectContaining({ id: lookup.id }));
  });

  it("retries a cloud lookup failure for the same scan", async () => {
    readCloudLookupMock.mockRejectedValueOnce(new Error("Offline")).mockResolvedValueOnce({ ok: true, value: lookup });
    renderChat(`/result/${lookup.id}/chat`);
    await userEvent.click(await screen.findByRole("button", { name: "Retry loading scan" }));
    expect(await screen.findByLabelText("Ask a follow-up question")).toBeEnabled();
    expect(readCloudLookupMock.mock.calls).toEqual([[lookup.id], [lookup.id]]);
  });

  it("rejects a cloud response for a different scan", async () => {
    readCloudLookupMock.mockResolvedValue({ ok: true, value: { ...lookup, id: "different" } });
    renderChat(`/result/${lookup.id}/chat`);
    expect(await screen.findByText("Scan not found")).toBeInTheDocument();
    expect(getLookup("different")).toBeNull();
  });

  it("times out a pending cloud load, retries, and ignores the late original response", async () => {
    vi.useFakeTimers();
    try {
      let finishOld!: (value: Awaited<ReturnType<typeof readCloudLookup>>) => void;
      let finishRetry!: (value: Awaited<ReturnType<typeof readCloudLookup>>) => void;
      readCloudLookupMock
        .mockImplementationOnce(() => new Promise((resolve) => { finishOld = resolve; }))
        .mockImplementationOnce(() => new Promise((resolve) => { finishRetry = resolve; }));
      renderChat(`/result/${lookup.id}/chat`);
      expect(screen.getByRole("heading", { name: "Loading saved scan" })).toBeInTheDocument();
      await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
      expect(screen.getByRole("alert")).toHaveTextContent("timed out");
      fireEvent.click(screen.getByRole("button", { name: "Retry loading scan" }));
      await act(async () => { finishOld({ ok: true, value: { ...lookup, notes: "Stale cloud response" } }); });
      expect(getLookup(lookup.id)).toBeNull();
      expect(screen.getByRole("heading", { name: "Loading saved scan" })).toBeInTheDocument();
      await act(async () => { finishRetry({ ok: true, value: { ...lookup, notes: "Current cloud response" } }); });
      expect(screen.getByLabelText("Ask a follow-up question")).toBeEnabled();
      expect(getLookup(lookup.id)?.notes).toBe("Current cloud response");
      await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(readCloudLookupMock.mock.calls).toEqual([[lookup.id], [lookup.id]]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("preserves a local scan created while cloud restoration is pending", async () => {
    let finish!: (value: Awaited<ReturnType<typeof readCloudLookup>>) => void;
    readCloudLookupMock.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    renderChat(`/result/${lookup.id}/chat`);
    const local = {
      ...lookup,
      notes: "New receiving note",
      correction: "Local correction",
      chatHistory: [{ id: "local-answer", role: "assistant" as const, content: "Keep this local conversation.", timestamp: lookup.createdAt }],
    };
    localStorage.setItem(accountStorageKey(LOOKUPS_STORAGE_KEY), JSON.stringify([local]));
    await act(async () => { finish({ ok: true, value: lookup }); });
    expect(await screen.findByText("Keep this local conversation.")).toBeInTheDocument();
    expect(getLookup(lookup.id)).toMatchObject({ notes: local.notes, correction: local.correction, chatHistory: local.chatHistory });
    expect(sendFollowUpMock).not.toHaveBeenCalled();
  });

  it("refreshes an expired local photo group and retains newer edits and fresh photos across answers", async () => {
    const expired = cloudPhotoLookup("expired");
    const fresh = cloudPhotoLookup("fresh");
    localStorage.setItem(accountStorageKey(LOOKUPS_STORAGE_KEY), JSON.stringify([expired]));
    let finish!: (value: Awaited<ReturnType<typeof readCloudLookup>>) => void;
    readCloudLookupMock.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    sendFollowUpMock.mockResolvedValueOnce("First fresh-photo answer.").mockResolvedValueOnce("Second fresh-photo answer.");
    renderChat(`/result/${lookup.id}/chat`);
    expect(screen.getByRole("heading", { name: "Loading saved scan" })).toBeInTheDocument();
    const edited = { ...expired, notes: "New local note", correction: "New local correction", rating: "down" as const };
    localStorage.setItem(accountStorageKey(LOOKUPS_STORAGE_KEY), JSON.stringify([edited]));
    await act(async () => { finish({ ok: true, value: { ...fresh, notes: "Old cloud note", result: { ...lookup.result!, partName: "Old cloud identity" } } }); });
    expect(screen.getByRole("img", { name: "Saved photo of Alternator" })).toHaveAttribute("src", fresh.frame.imageBase64);
    await userEvent.type(screen.getByLabelText("Ask a follow-up question"), "Compare both views.");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText("First fresh-photo answer.")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Ask a follow-up question"), "Which view shows the marking?");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText("Second fresh-photo answer.")).toBeInTheDocument();
    expect(readCloudLookupMock).toHaveBeenCalledExactlyOnceWith(lookup.id);
    for (const [sent] of sendFollowUpMock.mock.calls) {
      expect(sent).toMatchObject({ notes: edited.notes, correction: edited.correction, rating: "down", result: { partName: "Alternator" }, photos: fresh.photos });
      expect(sent.photos?.map((photo) => photo.id)).toEqual(expired.photos?.map((photo) => photo.id));
    }
    expect(getLookup(lookup.id)).toMatchObject({ notes: edited.notes, correction: edited.correction, rating: "down", photos: expired.photos });
    expect(getLookup(lookup.id)?.chatHistory).toHaveLength(4);
  });

  it.each(["missing", "identity", "path"])("rejects a %s photo mismatch without partially refreshing the group", async (change) => {
    const expired = cloudPhotoLookup("expired");
    const fresh = cloudPhotoLookup("fresh");
    if (change === "missing") fresh.photos = fresh.photos!.slice(0, 1);
    if (change === "identity") fresh.photos![1].id = "different-photo";
    if (change === "path") fresh.photos![1].imageBase64 = "https://example.test/different-photo.jpg?token=fresh";
    localStorage.setItem(accountStorageKey(LOOKUPS_STORAGE_KEY), JSON.stringify([expired]));
    readCloudLookupMock.mockResolvedValue({ ok: true, value: fresh });
    renderChat(`/result/${lookup.id}/chat`);
    expect(await screen.findByRole("alert")).toHaveTextContent("no partial photo group was loaded");
    expect(screen.queryByLabelText("Ask a follow-up question")).not.toBeInTheDocument();
    expect(getLookup(lookup.id)?.photos).toEqual(expired.photos);
    expect(sendFollowUpMock).not.toHaveBeenCalled();
  });

  it.each(["device", "cloud"])("keeps %s original-photo chat usable when unrelated cutout URLs are stale or missing", async (source) => {
    const focusBox = { x: 0.1, y: 0.2, width: 0.3, height: 0.4, confidence: 0.9 };
    const original = source === "cloud" ? cloudPhotoLookup("expired") : lookup;
    const local: Lookup = { ...original, focusBox, focusMode: "crop", isolatedImageBase64: "https://example.test/removed-cutout.png?token=expired",
      isolatedObjects: [{ name: "Selected part", category: "electrical", primary: true, focusBox,
        isolatedImageBase64: "https://example.test/old-object.png?token=expired" }],
    };
    localStorage.setItem(accountStorageKey(LOOKUPS_STORAGE_KEY), JSON.stringify([local]));
    readCloudLookupMock.mockResolvedValue({ ok: true, value: cloudPhotoLookup("fresh") });
    sendFollowUpMock.mockResolvedValue("The original photos remain available.");
    renderChat(`/result/${lookup.id}/chat`);
    await userEvent.type(await screen.findByLabelText("Ask a follow-up question"), "Inspect the original photo.");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText("The original photos remain available.")).toBeInTheDocument();
    expect(readCloudLookupMock).toHaveBeenCalledTimes(source === "cloud" ? 1 : 0);
    expect(sendFollowUpMock).toHaveBeenCalledWith(expect.objectContaining({ focusBox, focusMode: "crop",
      isolatedObjects: local.isolatedObjects,
      ...(source === "cloud" ? { photos: cloudPhotoLookup("fresh").photos } : { frame: lookup.frame }),
    }), "Inspect the original photo.");
    expect(getLookup(lookup.id)?.focusBox).toEqual(focusBox);
  });

  it.each(["account", "unmount"])("ignores an existing photo group's refresh after %s changes", async (change) => {
    const expired = cloudPhotoLookup("expired");
    localStorage.setItem(accountStorageKey(LOOKUPS_STORAGE_KEY), JSON.stringify([expired]));
    let finish!: (value: Awaited<ReturnType<typeof readCloudLookup>>) => void;
    readCloudLookupMock.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const view = renderChat(`/result/${lookup.id}/chat`);
    if (change === "account") setActiveAccount("other-user");
    else view.unmount();
    await act(async () => { finish({ ok: true, value: cloudPhotoLookup("fresh") }); });
    if (change === "account") expect(getLookup(lookup.id)).toBeNull();
    setActiveAccount("test-user");
    expect(getLookup(lookup.id)?.photos).toEqual(expired.photos);
    expect(sendFollowUpMock).not.toHaveBeenCalled();
  });

  it("does not restore a local scan deleted during photo refresh", async () => {
    localStorage.setItem(accountStorageKey(LOOKUPS_STORAGE_KEY), JSON.stringify([cloudPhotoLookup("expired")]));
    let finish!: (value: Awaited<ReturnType<typeof readCloudLookup>>) => void;
    readCloudLookupMock.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    renderChat(`/result/${lookup.id}/chat`);
    deleteLookup(lookup.id);
    await act(async () => { finish({ ok: true, value: cloudPhotoLookup("fresh") }); });
    expect(await screen.findByText("Scan not found")).toBeInTheDocument();
    expect(getLookup(lookup.id)).toBeNull();
  });

  it("refreshes signed photos again before a question after the signing window ages", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    try {
      localStorage.setItem(accountStorageKey(LOOKUPS_STORAGE_KEY), JSON.stringify([cloudPhotoLookup("expired")]));
      readCloudLookupMock.mockResolvedValueOnce({ ok: true, value: cloudPhotoLookup("fresh") })
        .mockResolvedValueOnce({ ok: true, value: cloudPhotoLookup("refreshed-again") });
      sendFollowUpMock.mockResolvedValue("Still using live photo references.");
      renderChat(`/result/${lookup.id}/chat`);
      await screen.findByLabelText("Ask a follow-up question");
      now.mockReturnValue(1_000_000 + 51 * 60 * 1000);
      await userEvent.type(screen.getByLabelText("Ask a follow-up question"), "Compare the views now.");
      await userEvent.click(screen.getByRole("button", { name: "Send" }));
      expect(await screen.findByText("Still using live photo references.")).toBeInTheDocument();
      expect(readCloudLookupMock).toHaveBeenCalledTimes(2);
      expect(sendFollowUpMock).toHaveBeenCalledWith(expect.objectContaining({ photos: cloudPhotoLookup("refreshed-again").photos }), "Compare the views now.");
    } finally {
      now.mockRestore();
    }
  });

  it.each(["account", "unmount"])("does not materialize a cloud scan after %s changes", async (change) => {
    let finish!: (value: Awaited<ReturnType<typeof readCloudLookup>>) => void;
    readCloudLookupMock.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const view = renderChat(`/result/${lookup.id}/chat`);
    if (change === "account") setActiveAccount("other-user");
    else view.unmount();
    await act(async () => { finish({ ok: true, value: lookup }); });
    expect(getLookup(lookup.id)).toBeNull();
    setActiveAccount("test-user");
    expect(getLookup(lookup.id)).toBeNull();
    expect(sendFollowUpMock).not.toHaveBeenCalled();
  });

  it("blocks chat while local preparation fails and recovers without an AI call", async () => {
    readCloudLookupMock.mockResolvedValue({ ok: true, value: lookup });
    const write = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("Full", "QuotaExceededError"); });
    renderChat(`/result/${lookup.id}/chat`);
    expect(await screen.findByRole("alert")).toHaveTextContent("could not be prepared for chat");
    expect(screen.queryByLabelText("Ask a follow-up question")).not.toBeInTheDocument();
    write.mockRestore();
    await userEvent.click(screen.getByRole("button", { name: "Retry loading scan" }));
    expect(await screen.findByLabelText("Ask a follow-up question")).toBeEnabled();
    expect(getLookup(lookup.id)?.id).toBe(lookup.id);
    expect(sendFollowUpMock).not.toHaveBeenCalled();
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
    expect(syncLookupChatToCloudMock).toHaveBeenCalledWith(expect.objectContaining({
      id: lookup.id,
      chatHistory: expect.arrayContaining([
        expect.objectContaining({ role: "user", content: "What does it do?" }),
        expect.objectContaining({ role: "assistant", content: "The alternator charges the battery while the engine runs." }),
      ]),
    }));
  });

  it("keeps a local reply and retries cloud sync without another provider call", async () => {
    sendFollowUpMock.mockResolvedValue("Keep this answer locally.");
    syncLookupChatToCloudMock
      .mockResolvedValueOnce({ ok: false, message: "Cloud save was not confirmed." })
      .mockResolvedValueOnce({ ok: true, message: "Scan synced." });
    localStorage.setItem(accountStorageKey(LOOKUPS_STORAGE_KEY), JSON.stringify([lookup]));
    renderChat(`/result/${lookup.id}/chat`);

    await userEvent.type(screen.getByLabelText("Ask a follow-up question"), "Will this be saved?");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByText("Cloud save was not confirmed.")).toBeInTheDocument();
    expect(getLookup(lookup.id)?.chatHistory.map((message) => message.content)).toEqual([
      "Will this be saved?",
      "Keep this answer locally.",
    ]);

    await userEvent.click(screen.getByRole("button", { name: "Retry cloud save" }));

    expect(syncLookupChatToCloudMock).toHaveBeenCalledTimes(2);
    expect(sendFollowUpMock).toHaveBeenCalledTimes(1);
    expect(await screen.findByLabelText("Ask a follow-up question")).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Retry cloud save" })).not.toBeInTheDocument();
  });

  it.each([true, false])("serializes a failed-question retry behind cloud retry (cloud success: %s)", async (cloudRetrySucceeds) => {
    let finishCloudRetry!: (value: Awaited<ReturnType<typeof syncLookupChatToCloud>>) => void;
    syncLookupChatToCloudMock
      .mockResolvedValueOnce({ ok: false, message: "First cloud failure." })
      .mockImplementationOnce(() => new Promise((resolve) => { finishCloudRetry = resolve; }));
    sendFollowUpMock
      .mockResolvedValueOnce("First answer.")
      .mockRejectedValueOnce(new AIServiceError("provider_error", "Second request failed."))
      .mockResolvedValueOnce("Second answer.");
    localStorage.setItem(accountStorageKey(LOOKUPS_STORAGE_KEY), JSON.stringify([lookup]));
    renderChat(`/result/${lookup.id}/chat`);
    fireEvent.change(screen.getByLabelText("Ask a follow-up question"), { target: { value: "First question" } });
    await userEvent.click(screen.getByText("Send", { selector: "button" }));
    await screen.findByText("First cloud failure.");
    const firstHistory = getLookup(lookup.id)!.chatHistory;
    fireEvent.change(screen.getByLabelText("Ask a follow-up question"), { target: { value: "Second question" } });
    await userEvent.click(screen.getByText("Send", { selector: "button" }));
    await screen.findByText("Second request failed.");
    await userEvent.click(screen.getByText("Retry cloud save", { selector: "button" }));
    const questionRetry = screen.getByText("Retry last question", { selector: "button" });
    await userEvent.click(questionRetry);
    expect(sendFollowUpMock).toHaveBeenCalledTimes(2);
    expect(questionRetry).toBeDisabled();
    expect(getLookup(lookup.id)!.chatHistory).toEqual(firstHistory);
    expect(syncLookupChatToCloudMock).toHaveBeenCalledTimes(2);
    await act(async () => { finishCloudRetry({ ok: cloudRetrySucceeds, message: "Cloud retry settled." }); });
    await userEvent.click(screen.getByText("Retry last question", { selector: "button" }));
    const finalHistory = getLookup(lookup.id)!.chatHistory;
    expect(finalHistory.map((message) => message.content)).toEqual(["First question", "First answer.", "Second question", "Second answer."]);
    expect(finalHistory.slice(0, 2)).toEqual(firstHistory);
    expect(sendFollowUpMock).toHaveBeenCalledTimes(3);
    expect(syncLookupChatToCloudMock).toHaveBeenCalledTimes(3);
    expect(syncLookupChatToCloudMock.mock.calls[2][0].chatHistory).toEqual(finalHistory);
    expect(screen.queryByText("Retry cloud save", { selector: "button" })).not.toBeInTheDocument();
  });

  it.each([true, false])("retains an answered exchange while cloud retry is pending (cloud success: %s)", async (cloudRetrySucceeds) => {
    let finishCloudRetry!: (value: Awaited<ReturnType<typeof syncLookupChatToCloud>>) => void;
    syncLookupChatToCloudMock
      .mockResolvedValueOnce({ ok: false, message: "First cloud failure." })
      .mockImplementationOnce(() => new Promise((resolve) => { finishCloudRetry = resolve; }));
    sendFollowUpMock.mockResolvedValueOnce("First answer.").mockResolvedValueOnce("Retained second answer.");
    localStorage.setItem(accountStorageKey(LOOKUPS_STORAGE_KEY), JSON.stringify([lookup]));
    renderChat(`/result/${lookup.id}/chat`);
    fireEvent.change(screen.getByLabelText("Ask a follow-up question"), { target: { value: "First question" } });
    await userEvent.click(screen.getByText("Send", { selector: "button" }));
    await screen.findByText("First cloud failure.");
    const firstHistory = getLookup(lookup.id)!.chatHistory;
    fireEvent.change(screen.getByLabelText("Ask a follow-up question"), { target: { value: "Second question" } });
    const failedKey = accountStorageKey(LOOKUPS_STORAGE_KEY);
    const originalWrite = Storage.prototype.setItem;
    const writeSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (key, value) {
      if (key === failedKey) throw new DOMException("Full", "QuotaExceededError");
      originalWrite.call(this, key, value);
    });
    try {
      await userEvent.click(screen.getByText("Send", { selector: "button" }));
      expect(screen.getByText("Retry saving answer", { selector: "button" })).toBeEnabled();
    } finally {
      writeSpy.mockRestore();
    }
    expect(getLookup(lookup.id)!.chatHistory).toEqual(firstHistory);
    await userEvent.click(screen.getByText("Retry cloud save", { selector: "button" }));
    const localRetry = screen.getByText("Retry saving answer", { selector: "button" });
    await userEvent.click(localRetry);
    expect(getLookup(lookup.id)!.chatHistory).toEqual(firstHistory);
    expect(localRetry).toBeDisabled();
    expect(screen.getByText("Retained second answer.")).toBeInTheDocument();
    expect(sendFollowUpMock).toHaveBeenCalledTimes(2);
    expect(syncLookupChatToCloudMock).toHaveBeenCalledTimes(2);
    await act(async () => { finishCloudRetry({ ok: cloudRetrySucceeds, message: "Cloud retry settled." }); });
    await userEvent.click(screen.getByText("Retry saving answer", { selector: "button" }));
    const finalHistory = getLookup(lookup.id)!.chatHistory;
    expect(finalHistory.map((message) => message.content)).toEqual(["First question", "First answer.", "Second question", "Retained second answer."]);
    expect(finalHistory.slice(0, 2)).toEqual(firstHistory);
    expect(new Set(finalHistory.map((message) => message.id)).size).toBe(4);
    expect(sendFollowUpMock).toHaveBeenCalledTimes(2);
    expect(syncLookupChatToCloudMock).toHaveBeenCalledTimes(3);
    expect(syncLookupChatToCloudMock.mock.calls[2][0].chatHistory).toEqual(finalHistory);
    expect(screen.queryByText("Retry saving answer", { selector: "button" })).not.toBeInTheDocument();
  });

  it("keeps cloud retry unavailable while a question retry awaits its answer", async () => {
    let finishAnswer!: (value: string) => void;
    syncLookupChatToCloudMock.mockResolvedValueOnce({ ok: false, message: "First cloud failure." });
    sendFollowUpMock
      .mockResolvedValueOnce("First answer.")
      .mockRejectedValueOnce(new AIServiceError("provider_error", "Second request failed."))
      .mockImplementationOnce(() => new Promise((resolve) => { finishAnswer = resolve; }));
    localStorage.setItem(accountStorageKey(LOOKUPS_STORAGE_KEY), JSON.stringify([lookup]));
    renderChat(`/result/${lookup.id}/chat`);
    fireEvent.change(screen.getByLabelText("Ask a follow-up question"), { target: { value: "First question" } });
    await userEvent.click(screen.getByText("Send", { selector: "button" }));
    await screen.findByText("First cloud failure.");
    const firstHistory = getLookup(lookup.id)!.chatHistory;
    fireEvent.change(screen.getByLabelText("Ask a follow-up question"), { target: { value: "Second question" } });
    await userEvent.click(screen.getByText("Send", { selector: "button" }));
    await screen.findByText("Second request failed.");
    await userEvent.click(screen.getByText("Retry last question", { selector: "button" }));
    expect(screen.queryByText("Retry cloud save", { selector: "button" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Ask a follow-up question")).toBeDisabled();
    expect(syncLookupChatToCloudMock).toHaveBeenCalledTimes(1);
    expect(getLookup(lookup.id)!.chatHistory).toEqual(firstHistory);
    await act(async () => { finishAnswer("Second answer."); });
    const finalHistory = getLookup(lookup.id)!.chatHistory;
    expect(finalHistory.map((message) => message.content)).toEqual(["First question", "First answer.", "Second question", "Second answer."]);
    expect(finalHistory.slice(0, 2)).toEqual(firstHistory);
    expect(syncLookupChatToCloudMock).toHaveBeenCalledTimes(2);
    expect(syncLookupChatToCloudMock.mock.calls[1][0].chatHistory).toEqual(finalHistory);
    expect(sendFollowUpMock).toHaveBeenCalledTimes(3);
  });

  it("does not retry a failed cloud save after the account changes", async () => {
    sendFollowUpMock.mockResolvedValue("Private answer.");
    syncLookupChatToCloudMock.mockResolvedValue({ ok: false, message: "Cloud save was not confirmed." });
    localStorage.setItem(accountStorageKey(LOOKUPS_STORAGE_KEY), JSON.stringify([lookup]));
    renderChat(`/result/${lookup.id}/chat`);
    await userEvent.type(screen.getByLabelText("Ask a follow-up question"), "Private question");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    await screen.findByRole("button", { name: "Retry cloud save" });

    setActiveAccount("other-user");
    await userEvent.click(screen.getByRole("button", { name: "Retry cloud save" }));

    expect(syncLookupChatToCloudMock).toHaveBeenCalledTimes(1);
    setActiveAccount("test-user");
    expect(getLookup(lookup.id)?.chatHistory.map((message) => message.content)).toEqual([
      "Private question",
      "Private answer.",
    ]);
  });

  it("keeps the question before its answer when message creation crosses a clock tick", async () => {
    sendFollowUpMock.mockResolvedValue("The answer follows your question.");
    localStorage.setItem(accountStorageKey(LOOKUPS_STORAGE_KEY), JSON.stringify([lookup]));
    renderChat(`/result/${lookup.id}/chat`);
    await userEvent.type(screen.getByLabelText("Ask a follow-up question"), "What is visible?");
    const clock = vi.spyOn(Date.prototype, "toISOString")
      .mockReturnValueOnce("2026-05-16T00:01:00.000Z")
      .mockReturnValueOnce("2026-05-16T00:01:00.001Z");
    try {
      await userEvent.click(screen.getByRole("button", { name: "Send" }));
      await screen.findByText("The answer follows your question.");
      expect(getLookup(lookup.id)?.chatHistory.map((message) => message.role)).toEqual(["user", "assistant"]);
      expect(getLookup(lookup.id)?.chatHistory.map((message) => message.timestamp)).toEqual([
        "2026-05-16T00:01:00.000Z",
        "2026-05-16T00:01:00.001Z",
      ]);
    } finally {
      clock.mockRestore();
    }
  });

  it("keeps the saved photo and existing source references beside the full conversation", async () => {
    localStorage.setItem(accountStorageKey(LOOKUPS_STORAGE_KEY), JSON.stringify([{
      ...lookup,
      result: {
        ...lookup.result!,
        sourceLinks: [{ label: "Alternator inspection video", url: "https://www.youtube.com/watch?v=inspection", sourceType: "reference" }],
      },
    }]));

    renderChat(`/result/${lookup.id}/chat`);

    expect(screen.getByRole("heading", { name: "Ask DeepSpec" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Saved photo of Alternator" })).toHaveAttribute("src", lookup.frame.imageBase64);
    expect(screen.getByRole("link", { name: "Full result" })).toHaveAttribute("href", `/result/${lookup.id}`);
    await userEvent.click(screen.getByRole("button", { name: /Sources/ }));
    expect(screen.getByRole("link", { name: /Alternator inspection video/ })).toHaveAttribute("href", "https://www.youtube.com/watch?v=inspection");
  });

  it("renders assistant Markdown while preserving the original stored answer", async () => {
    const answer = "**Visible evidence:**\n\n- Belt pulley\n- Vented housing";
    sendFollowUpMock.mockResolvedValue(answer);
    localStorage.setItem(accountStorageKey(LOOKUPS_STORAGE_KEY), JSON.stringify([lookup]));
    renderChat(`/result/${lookup.id}/chat`);

    await userEvent.type(screen.getByLabelText("Ask a follow-up question"), "What is visible?");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));

    expect((await screen.findByText("Visible evidence:")).tagName).toBe("STRONG");
    expect(within(screen.getByRole("log")).getByRole("list")).toHaveTextContent("Belt pulley");
    expect(getLookup(lookup.id)?.chatHistory.at(-1)?.content).toBe(answer);
  });

  it("researches an explicit video reference and saves real answer sources with the conversation", async () => {
    const sources = [{ label: "Inspection reference", url: "https://www.denso-am.eu/alternators", sourceType: "reference" as const }];
    sendFollowUpDetailsMock.mockResolvedValue({
      message: "Visible evidence\nThe pulley is visible.\n\nNext check\nPhotograph the label.",
      sources,
      searchSuggestions: '<a href="https://www.google.com/search?q=alternator" target="_blank">Search suggestions</a>',
    });
    localStorage.setItem(accountStorageKey(LOOKUPS_STORAGE_KEY), JSON.stringify([lookup]));
    renderChat(`/result/${lookup.id}/chat`);
    await userEvent.click(screen.getByRole("checkbox", { name: "Research web and video sources" }));
    await userEvent.type(screen.getByLabelText("Reference URL (optional)"), "https://www.youtube.com/watch?v=inspection");
    await userEvent.type(screen.getByLabelText("Ask a follow-up question"), "Compare this reference with my photo.");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByText(/The pulley is visible/)).toBeInTheDocument();
    expect(sendFollowUpDetailsMock).toHaveBeenCalledWith(expect.objectContaining({ id: lookup.id }), "Compare this reference with my photo.", {
      research: true,
      sourceUrls: ["https://www.youtube.com/watch?v=inspection"],
    });
    expect(sendFollowUpMock).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: /Inspection reference/ })).toHaveAttribute("href", sources[0].url);
    const suggestions = screen.getByTitle("Google Search suggestions");
    expect(suggestions).toHaveAttribute("sandbox", "allow-popups allow-popups-to-escape-sandbox");
    expect(suggestions).toHaveAttribute("referrerpolicy", "no-referrer");
    const savedAnswer = getLookup(lookup.id)?.chatHistory.at(-1);
    expect(savedAnswer?.sources).toEqual(sources);
    expect(savedAnswer?.content).toContain("Visible evidence\nThe pulley is visible.\n\nNext check");
    expect(JSON.stringify(getLookup(lookup.id)?.chatHistory)).not.toContain("Search suggestions");
  });

  it("retries research using the original reference after controls change", async () => {
    sendFollowUpDetailsMock
      .mockRejectedValueOnce(new AIServiceError("provider_error", "Temporary research failure."))
      .mockResolvedValueOnce({ message: "Use the visible markings to compare this part." });
    localStorage.setItem(accountStorageKey(LOOKUPS_STORAGE_KEY), JSON.stringify([lookup]));
    renderChat(`/result/${lookup.id}/chat`);
    await userEvent.click(screen.getByRole("checkbox", { name: "Research web and video sources" }));
    await userEvent.type(screen.getByLabelText("Reference URL (optional)"), "https://example.com/inspection");
    await userEvent.type(screen.getByLabelText("Ask a follow-up question"), "Compare this source.");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    await screen.findByText("Temporary research failure.");
    await userEvent.click(screen.getByRole("checkbox", { name: "Research web and video sources" }));
    await userEvent.click(screen.getByRole("button", { name: "Retry last question" }));
    expect(await screen.findByText("Use the visible markings to compare this part.")).toBeInTheDocument();
    expect(sendFollowUpDetailsMock).toHaveBeenLastCalledWith(expect.anything(), "Compare this source.", { research: true, sourceUrls: ["https://example.com/inspection"] });
    expect(sendFollowUpMock).not.toHaveBeenCalled();
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
    expect(screen.queryByRole("button", { name: "Retry last question" })).not.toBeInTheDocument();
  });

  it.each([
    ["incomplete_response", "AI reply was incomplete", true],
    ["timeout", "AI reply timed out", true],
    ["response_blocked", "AI could not answer this question", false],
  ] as const)("keeps saved history intact after %s and offers the appropriate recovery", async (code, title, canRetry) => {
    const messages: ChatMessage[] = [
      { id: "old-user", role: "user", content: "Earlier question", timestamp: lookup.createdAt },
      { id: "old-answer", role: "assistant", content: "Earlier complete answer", timestamp: lookup.createdAt },
    ];
    localStorage.setItem(accountStorageKey(LOOKUPS_STORAGE_KEY), JSON.stringify([{ ...lookup, chatHistory: messages }]));
    sendFollowUpMock.mockRejectedValueOnce(new AIServiceError(code, "The request did not produce a complete answer."))
      .mockResolvedValueOnce("New complete answer.");
    const view = renderChat(`/result/${lookup.id}/chat`);
    fireEvent.change(screen.getByLabelText("Ask a follow-up question"), { target: { value: "New question" } });
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText(title)).toBeInTheDocument();
    expect(getLookup(lookup.id)?.chatHistory).toEqual(messages);
    expect(syncLookupChatToCloudMock).not.toHaveBeenCalled();
    if (canRetry) {
      await userEvent.click(screen.getByRole("button", { name: "Retry last question" }));
    } else {
      expect(screen.queryByRole("button", { name: "Retry last question" })).not.toBeInTheDocument();
      fireEvent.change(screen.getByLabelText("Ask a follow-up question"), { target: { value: "Changed question" } });
      await userEvent.click(screen.getByRole("button", { name: "Send" }));
    }
    await screen.findByText("New complete answer.");
    const history = getLookup(lookup.id)!.chatHistory;
    expect(history.map((message) => message.content)).toEqual([
      "Earlier question", "Earlier complete answer", canRetry ? "New question" : "Changed question", "New complete answer.",
    ]);
    expect(sendFollowUpMock).toHaveBeenCalledTimes(2);
    view.unmount();
    renderChat(`/result/${lookup.id}/chat`);
    expect(screen.getByText("New complete answer.")).toBeInTheDocument();
    expect(getLookup(lookup.id)?.chatHistory).toEqual(history);
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

function cloudPhotoLookup(token: string): Lookup {
  const overview = `https://example.test/overview.jpg?token=${token}`;
  return { ...lookup, cloudRevision: 1, frame: { ...lookup.frame, imageBase64: overview }, photos: [
    { id: "overview-id", label: "overview", capturedAt: lookup.frame.capturedAt, imageBase64: overview },
    { id: "marking-id", label: "marking", capturedAt: lookup.frame.capturedAt, imageBase64: `https://example.test/marking.jpg?token=${token}` },
  ] };
}

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
