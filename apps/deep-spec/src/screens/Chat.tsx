import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Button, Card } from "../components/ui";
import { AIServiceError, runAI } from "../services/aiService";
import { FOLLOWUP_PROMPT } from "../services/systemPrompts";
import { appendChatMessage, getLookup, updateLookup } from "../services/storage";
import { useStorageRevision } from "../hooks/useStorageRevision";
import type { ChatMessage, Lookup } from "../types";

function buildFollowUpUserBlob(lookup: Lookup, newest: string) {
  const history = [...lookup.chatHistory]
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
    .join("\n");

  return [
    `Original part identification: ${lookup.result.partName}`,
    `Summary: ${lookup.result.whatItDoes}`,
    `Safety-critical (from photo pass): ${lookup.result.isSafetyCritical}`,
    lookup.userCarContext ? `Vehicle notes: ${lookup.userCarContext}` : "",
    lookup.userProblemContext ? `Problem notes: ${lookup.userProblemContext}` : "",
    history ? `Chat so far:\n${history}` : "",
    `User question:\n${newest}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export default function Chat() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const rev = useStorageRevision();
  const [ticket, setTicket] = useState<{ id: string; lookup: Lookup | null } | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let ok = true;
    void getLookup(id).then((l) => {
      if (!ok) return;
      setTicket({ id, lookup: l ?? null });
    });
    return () => {
      ok = false;
    };
  }, [id, rev]);

  const ticketMatches = Boolean(id && ticket && ticket.id === id);
  const lookup = ticketMatches && ticket?.lookup ? ticket.lookup : null;
  const phase: "loading" | "ready" | "missing" = !id
    ? "missing"
    : !ticketMatches
      ? "loading"
      : lookup
        ? "ready"
        : "missing";

  const messages = lookup?.chatHistory ?? [];

  const send = useCallback(async () => {
    if (!lookup) return;
    const text = draft.trim().slice(0, 500);
    if (!text) return;

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: text,
      timestamp: new Date().toISOString(),
    };

    setBusy(true);
    setError(null);
    const blob = buildFollowUpUserBlob(lookup, text);

    try {
      await updateLookup(lookup.id, { chatHistory: [...lookup.chatHistory, userMsg] });
      setDraft("");

      const body = await runAI({
        type: "text",
        userMessage: blob,
        systemPrompt: FOLLOWUP_PROMPT,
        responseAsJson: false,
      });
      const content = typeof body === "string" ? body : "";

      await appendChatMessage(lookup.id, {
        id: crypto.randomUUID(),
        role: "assistant",
        content,
        timestamp: new Date().toISOString(),
      });
    } catch (e) {
      const msg = e instanceof AIServiceError ? e.message : "Could not reply.";
      setError(msg);
    } finally {
      setBusy(false);
    }
  }, [draft, lookup]);

  if (phase === "loading") {
    return (
      <div className="flex min-h-dvh flex-col px-6 py-24 text-center text-ds-muted">
        Loading chat…
      </div>
    );
  }

  if (phase === "missing" || !lookup) {
    return (
      <div className="px-4 py-14 text-center">
        <p className="mb-6 dark:text-ds-text">Lookup not found.</p>
        <Link className="text-ds-primary" to="/">
          Home
        </Link>
      </div>
    );
  }

  const canSend = draft.trim().length > 0 && !busy;

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center gap-3 border-b border-ds-border-light px-4 py-3 dark:border-ds-border">
        <Button type="button" variant="ghost" className="-ml-2 px-2" onClick={() => navigate(`/result/${lookup.id}`)}>
          Back
        </Button>
      </header>

      <Card className="mx-4 mt-4 flex gap-3 border-0 p-3 shadow-sm dark:bg-ds-card">
        <div className="h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-neutral-200 dark:bg-neutral-800">
          {lookup.imageBase64 ? (
            <img src={lookup.imageBase64} alt="" className="h-full w-full object-cover" />
          ) : null}
        </div>
        <div className="min-w-0">
          <div className="truncate text-[16px] font-semibold">{lookup.result.partName}</div>
          <div className="truncate text-[13px] text-ds-muted-light dark:text-ds-muted">Follow-up chat</div>
        </div>
      </Card>

      <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 pb-44 pt-4">
        {messages.length === 0 ? (
          <p className="text-[14px] text-ds-muted-light dark:text-ds-muted">Ask cautiously — replies are AI guesses.</p>
        ) : null}
        {messages.map((m) => (
          <div key={m.id} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
            <div
              className={
                m.role === "user"
                  ? "max-w-[88%] rounded-2xl bg-ds-primary px-4 py-2 text-[14px] text-white"
                  : "max-w-[88%] rounded-2xl border border-ds-border-light bg-neutral-50 px-4 py-2 text-[14px] text-neutral-900 dark:border-ds-border dark:bg-ds-card dark:text-ds-text"
              }
            >
              {m.content}
            </div>
          </div>
        ))}
        {busy ? (
          <p className="animate-pulse text-[13px] text-ds-muted-light dark:text-ds-muted">Reply on the way…</p>
        ) : null}
      </div>

      {error ? (
        <div className="px-4 pb-2">
          <div className="rounded-lg bg-red-500/15 px-3 py-2 text-[14px] text-red-800 dark:text-red-200">{error}</div>
        </div>
      ) : null}

      <footer className="fixed bottom-0 left-0 right-0 border-t border-ds-border-light bg-white px-4 py-3 dark:border-ds-border dark:bg-neutral-950">
        <div className="mb-2 text-right text-[11px] text-ds-muted-light dark:text-ds-muted">
          {draft.length}/500 characters
        </div>
        <div className="flex gap-2">
          <textarea
            value={draft}
            maxLength={500}
            placeholder="Ask a question…"
            rows={2}
            onChange={(e) => setDraft(e.target.value)}
            className="min-h-[48px] flex-1 resize-none rounded-xl border border-ds-border-light bg-white px-3 py-3 text-[15px] text-neutral-900 dark:border-ds-border dark:bg-ds-card dark:text-ds-text"
          />
          <Button type="button" variant="primary" className="self-end" disabled={!canSend} onClick={() => void send()}>
            Send
          </Button>
        </div>
      </footer>
    </div>
  );
}
