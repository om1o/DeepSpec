import { getAccountScope, isAccountScopeCurrent } from "../lib/accountScope";
import { FormEvent, useEffect, useRef, useState } from "react";
import { Link, useLocation, useParams, useSearchParams } from "react-router-dom";
import Button from "../components/ui/Button";
import ScanThumb from "../components/ui/ScanThumb";
import { AIServiceError, getAIErrorDetails, getAIErrorMessage, sendFollowUp } from "../services/aiService";
import { appendChatMessages, createChatMessage, getLookup } from "../services/storage";
import type { Lookup } from "../types";

export default function Chat() {
  const accountScopeRef = useRef(getAccountScope());
  const { id } = useParams();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const [lookup, setLookup] = useState<Lookup | null>(() => (id ? getLookup(id) : null));
  const [question, setQuestion] = useState(() => searchParams.get("q")?.trim().slice(0, 500) ?? "");
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const questionFormRef = useRef<HTMLFormElement | null>(null);
  const questionInputRef = useRef<HTMLTextAreaElement | null>(null);
  const autoSubmitRef = useRef(
    Boolean((location.state as { autoSend?: unknown } | null)?.autoSend),
  );

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView?.({ behavior: "smooth", block: "end" });
  }, [lookup?.chatHistory.length, isSending]);

  useEffect(() => {
    if (!autoSubmitRef.current) return;
    autoSubmitRef.current = false;
    questionFormRef.current?.requestSubmit();
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isAccountScopeCurrent(accountScopeRef.current) || !lookup || !lookup.result || isSending) {
      return;
    }

    const trimmedQuestion = question.trim().slice(0, 500);
    if (!trimmedQuestion) {
      setError("Ask a question first.");
      setErrorCode("invalid_input");
      return;
    }

    await sendQuestion(trimmedQuestion, true);
  }

  async function handleRetryLastQuestion() {
    const lastUserMessage = lookup ? getLastUnansweredUserMessage(lookup) : null;
    if (!lastUserMessage || isSending) {
      return;
    }

    await sendQuestion(lastUserMessage.content, false);
  }

  function chooseSuggestedQuestion(nextQuestion: string) {
    setQuestion(nextQuestion);
    setError(null);
    setErrorCode(null);
    questionInputRef.current?.focus();
  }

  async function sendQuestion(trimmedQuestion: string, shouldSaveUserMessage: boolean) {
    if (!isAccountScopeCurrent(accountScopeRef.current) || !lookup || !lookup.result || isSending) {
      return;
    }

    setError(null);
    setErrorCode(null);
    setIsSending(true);

    let activeLookup = lookup;

    if (shouldSaveUserMessage) {
      const userMessage = createChatMessage("user", trimmedQuestion);
      const savedUserMessage = appendChatMessages(lookup.id, [userMessage]);
      if (!savedUserMessage.ok) {
        setError(savedUserMessage.message);
        setErrorCode("storage");
        setIsSending(false);
        return;
      }

      if (!savedUserMessage.value) {
        setError("This saved scan was not found.");
        setErrorCode("not_found");
        setIsSending(false);
        return;
      }

      activeLookup = savedUserMessage.value;
      setLookup(activeLookup);
      setQuestion("");
    }

    try {
      const answer = await sendFollowUp(activeLookup, trimmedQuestion);
      if (!isAccountScopeCurrent(accountScopeRef.current)) return;
      const assistantMessage = createChatMessage("assistant", answer);
      const savedAssistantMessage = appendChatMessages(activeLookup.id, [assistantMessage]);
      if (!savedAssistantMessage.ok) {
        setError(savedAssistantMessage.message);
        setErrorCode("storage");
        return;
      }

      if (!savedAssistantMessage.value) {
        setError("This saved scan was not found.");
        setErrorCode("not_found");
        return;
      }

      setLookup(savedAssistantMessage.value);
    } catch (chatError) {
      if (!isAccountScopeCurrent(accountScopeRef.current)) return;
      setError(getAIErrorMessage(chatError));
      setErrorCode(chatError instanceof AIServiceError ? chatError.code : null);
    } finally {
      if (isAccountScopeCurrent(accountScopeRef.current)) setIsSending(false);
    }
  }

  if (!lookup) {
    return (
      <main className="grid min-h-dvh place-items-center bg-[var(--ds-page)] px-5 text-center text-[var(--ds-fg-1)]">
        <section className="w-full max-w-sm rounded-[24px] border border-[var(--ds-border)] bg-[var(--ds-elevated)] p-6 shadow-sm">
          <p className="text-sm font-bold text-[#a7cbd4]">Scan not found</p>
          <h1 className="mt-2 text-2xl font-extrabold tracking-tight">Open a saved scan first</h1>
          <p className="mt-3 text-sm leading-6 text-[var(--ds-fg-3)]">Follow-up chat only works from a scan saved on this device.</p>
          <Link className="mt-5 block rounded-full bg-[var(--ds-accent)] px-5 py-3 text-sm font-bold text-white" to="/history">
            Saved scans
          </Link>
        </section>
      </main>
    );
  }

  const partName = lookup.result?.partName ?? "Captured frame";
  const canChat = Boolean(lookup.result);
  const errorDetails = error ? getAIErrorDetails(errorCode) : null;
  const showSafetyWarning = lookup.result?.isSafetyCritical || lookup.result?.safetyTriage === "needs_professional";
  const lastUnansweredUserMessage = getLastUnansweredUserMessage(lookup);
  const canRetryLastQuestion = Boolean(error && lastUnansweredUserMessage && canChat && !isSending);
  const suggestedQuestions = getSuggestedQuestions(showSafetyWarning);

  return (
    <main className="ds-chat-page ds-workbench min-h-dvh px-4 pb-[max(18px,env(safe-area-inset-bottom))] pt-[max(18px,env(safe-area-inset-top))] text-[var(--ds-fg-1)]">
      <div className="mx-auto flex min-h-[calc(100dvh-36px)] w-full max-w-2xl flex-col">
        <header className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <img src="/brand/deepspec-logo.webp" alt="Deep Spec" className="h-12 w-36 rounded-xl bg-[var(--ds-elevated)] object-contain p-1 shadow-sm ring-1 ring-[var(--ds-accent-line)]" />
            <p className="ds-eyebrow mt-6">FOLLOW THE EVIDENCE</p>
            <h1 className="mt-2 text-2xl font-bold tracking-tight">Ask about this scan</h1>
          </div>
          <Link to={`/result/${lookup.id}`} className="ds-workbench-back">
            Back
          </Link>
        </header>
        <Link to="/history" className="mt-3 self-start py-2 text-sm text-[#a7cbd4] underline underline-offset-4">Saved scans</Link>

        <section className="mt-5 grid grid-cols-[76px_1fr] gap-3 rounded-[24px] border border-[var(--ds-border)] bg-[var(--ds-elevated)] p-3 shadow-sm">
          <ScanThumb alt="" className="aspect-square w-full rounded-[18px] border border-[var(--ds-border)] bg-[var(--ds-surface)] object-cover" src={lookup.frame.imageBase64} />
          <div className="min-w-0 py-1">
            <h2 className="truncate text-base font-extrabold tracking-tight">{partName}</h2>
            <p className="mt-1 text-xs font-semibold uppercase tracking-[0.12em] text-[var(--ds-fg-3)]">{lookup.scanCategory}</p>
            <p className="mt-2 text-sm leading-6 text-[var(--ds-fg-3)]">
              {canChat ? "Structured answers. Safety rules still apply." : "Get an AI result first, then chat."}
            </p>
          </div>
        </section>

        {showSafetyWarning ? (
          <section className="mt-4 rounded-[24px] border border-[var(--ds-warn-line)] bg-[var(--ds-warn-soft)] p-4">
            <p className="text-sm font-extrabold text-[var(--ds-warn-ink)]">Safety check needed</p>
            <p className="mt-2 text-sm leading-6 text-[var(--ds-fg-2)]">Confirm this before driving or repairing.</p>
          </section>
        ) : null}

        <section className="mt-4 flex flex-1 flex-col rounded-[24px] border border-[var(--ds-border)] bg-[var(--ds-elevated)] p-4 shadow-sm">
          <div className="flex-1 space-y-3 overflow-y-auto" role="log" aria-label="Conversation" aria-live="polite">
            {lookup.chatHistory.length > 0 ? (
              lookup.chatHistory.map((message) => (
                <article
                  key={message.id}
                  className={
                    message.role === "user"
                      ? "ml-auto max-w-[84%] rounded-[22px] bg-[var(--ds-accent)] px-4 py-3 text-sm leading-6 text-white"
                      : "mr-auto max-w-[90%] rounded-[22px] border border-[var(--ds-border)] bg-[var(--ds-surface)] px-4 py-3 text-sm leading-6 text-[var(--ds-fg-2)]"
                  }
                >
                  <p className="mb-1 text-xs font-bold opacity-80">{message.role === "user" ? "You" : "DeepSpec"}</p>
                  {message.role === "assistant" ? (
                    <StructuredFollowUp content={message.content} />
                  ) : (
                    <p className="whitespace-pre-wrap break-words">{message.content}</p>
                  )}
                </article>
              ))
            ) : (
              <div className="grid min-h-48 place-items-center text-center">
                <div>
                  <p className="text-sm font-bold text-[#a7cbd4]">No questions yet</p>
                  <p className="mt-2 text-sm leading-6 text-[var(--ds-fg-3)]">Ask what a visible marking means or what evidence would help identify the part.</p>
                </div>
              </div>
            )}
            {isSending ? (
              <article className="mr-auto max-w-[90%] rounded-[22px] border border-[var(--ds-border)] bg-[var(--ds-surface)] px-4 py-3 text-sm font-semibold text-[var(--ds-fg-3)]">
                Thinking...
              </article>
            ) : null}
            <div ref={messagesEndRef} aria-hidden="true" />
          </div>

          {error && errorDetails ? (
            <section className="mt-3 rounded-2xl border border-[var(--ds-danger-line)] bg-[var(--ds-danger-soft)] p-3">
              <p className="text-sm font-extrabold text-[var(--ds-danger-ink)]">{errorDetails.title}</p>
              <p className="mt-1 text-sm leading-6 text-[var(--ds-fg-2)]">{error}</p>
              {errorDetails.category === "provider_unavailable" ? (
                <p className="mt-1 text-xs font-semibold leading-5 text-[var(--ds-fg-3)]">{errorDetails.description}</p>
              ) : null}
              {canRetryLastQuestion ? (
                <Button className="mt-3" type="button" onClick={handleRetryLastQuestion}>
                  Retry last question
                </Button>
              ) : null}
            </section>
          ) : null}

          {canChat && !isSending ? (
            <section className="mt-4" aria-label="Suggested follow-up questions">
              <p className="text-xs font-extrabold uppercase tracking-[0.12em] text-[var(--ds-fg-3)]">Ask next</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {suggestedQuestions.map((suggestion) => (
                  <button
                    key={suggestion}
                    className="rounded-[8px] border border-[var(--ds-border)] bg-[var(--ds-surface)] px-3 py-2 text-left text-xs font-bold leading-5 text-[var(--ds-fg-2)]"
                    onClick={() => chooseSuggestedQuestion(suggestion)}
                    type="button"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </section>
          ) : null}

          <form ref={questionFormRef} className="mt-4 space-y-3" onSubmit={handleSubmit}>
            <label className="block">
              <span className="sr-only">Ask a follow-up question</span>
              <textarea
                ref={questionInputRef}
                className="min-h-20 w-full resize-none rounded-2xl border border-[var(--ds-border)] bg-[var(--ds-elevated)] p-3 text-sm leading-6 text-[var(--ds-fg-1)] outline-none placeholder:text-slate-400 focus:border-[var(--ds-accent)]"
                disabled={!canChat || isSending}
                maxLength={500}
                onChange={(event) => setQuestion(event.target.value)}
                placeholder="What markings should I photograph next?"
                value={question}
              />
            </label>
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-semibold text-[var(--ds-fg-3)]">{question.length}/500</p>
              <Button disabled={!canChat || isSending || !question.trim()} type="submit">
                Send
              </Button>
            </div>
          </form>
        </section>
      </div>
    </main>
  );
}

function getLastUnansweredUserMessage(lookup: Lookup) {
  const lastMessage = lookup.chatHistory.at(-1);
  return lastMessage?.role === "user" ? lastMessage : null;
}

const FOLLOW_UP_TITLES = new Map([
  ["OVERVIEW", "Overview"],
  ["WHAT TO CHECK", "What to check"],
  ["MORE DETAIL", "More detail"],
]);

function StructuredFollowUp({ content }: { content: string }) {
  const sections = parseFollowUpSections(content);
  if (sections.length <= 1) {
    return <p className="whitespace-pre-wrap break-words">{content}</p>;
  }

  return (
    <div className="divide-y divide-[var(--ds-border)]">
      {sections.map((section) => (
        section.title === "More detail" ? (
          <details key={section.title} className="py-3 last:pb-0">
            <summary className="cursor-pointer text-xs font-extrabold uppercase tracking-[0.1em] text-[#a7cbd4]">
              {section.title}
            </summary>
            <p className="mt-2 whitespace-pre-wrap break-words">{section.body}</p>
          </details>
        ) : (
          <section key={section.title} className="py-3 first:pt-1 last:pb-0">
            <p className="text-xs font-extrabold uppercase tracking-[0.1em] text-[#a7cbd4]">{section.title}</p>
            <p className="mt-2 whitespace-pre-wrap break-words">{section.body}</p>
          </section>
        )
      ))}
    </div>
  );
}

function parseFollowUpSections(content: string) {
  const sections: { title: string; body: string }[] = [];
  let active: { title: string; lines: string[] } | null = null;

  for (const line of content.split(/\n+/).map((item) => item.trim()).filter(Boolean)) {
    const normalizedHeading = line.replace(/[*#:_-]+/g, " ").trim().replace(/\s+/g, " ").toUpperCase();
    const title = FOLLOW_UP_TITLES.get(normalizedHeading);
    if (title) {
      if (active?.lines.length) sections.push({ title: active.title, body: active.lines.join(" ") });
      active = { title, lines: [] };
      continue;
    }

    if (!active) active = { title: "Answer", lines: [] };
    active.lines.push(line);
  }

  if (active?.lines.length) sections.push({ title: active.title, body: active.lines.join(" ") });
  return sections;
}

function getSuggestedQuestions(showSafetyWarning: boolean) {
  return [
    "What should I photograph next?",
    "What could this be confused with?",
    showSafetyWarning ? "Which warning signs mean stop driving?" : "What visible wear should I look for?",
  ];
}
