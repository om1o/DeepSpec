import { FormEvent, useEffect, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import Button from "../components/ui/Button";
import ScanThumb from "../components/ui/ScanThumb";
import { AIServiceError, getAIErrorDetails, getAIErrorMessage, sendFollowUp } from "../services/aiService";
import { appendChatMessages, createChatMessage, getLookup } from "../services/storage";
import type { Lookup } from "../types";

export default function Chat() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const [lookup, setLookup] = useState<Lookup | null>(() => (id ? getLookup(id) : null));
  const [question, setQuestion] = useState(() => searchParams.get("q")?.trim().slice(0, 500) ?? "");
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    messagesEndRef.current?.scrollIntoView?.({ behavior: reduceMotion ? "auto" : "smooth", block: "end" });
  }, [lookup?.chatHistory.length, isSending]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!lookup || !lookup.result || isSending) {
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

  async function sendQuestion(trimmedQuestion: string, shouldSaveUserMessage: boolean) {
    if (!lookup || !lookup.result || isSending) {
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
      setError(getAIErrorMessage(chatError));
      setErrorCode(chatError instanceof AIServiceError ? chatError.code : null);
    } finally {
      setIsSending(false);
    }
  }

  if (!lookup) {
    return (
      <main className="grid min-h-dvh place-items-center bg-[var(--ds-page)] pb-[max(1.25rem,env(safe-area-inset-bottom))] pl-[max(1.25rem,env(safe-area-inset-left))] pr-[max(1.25rem,env(safe-area-inset-right))] pt-[max(1.25rem,env(safe-area-inset-top))] text-center text-slate-950">
        <section className="w-full max-w-sm rounded-[24px] border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-sm font-bold text-[var(--ds-accent)]">Scan not found</p>
          <h1 className="mt-2 text-2xl font-extrabold tracking-tight">Open a saved scan first</h1>
          <p className="mt-3 text-sm leading-6 text-neutral-500">Follow-up chat only works from a scan saved on this device.</p>
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

  return (
    <main className="chat-page h-dvh overflow-hidden bg-[var(--ds-page)] pb-[max(18px,env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] pt-[max(18px,env(safe-area-inset-top))] text-slate-950">
      <div className="chat-shell mx-auto flex h-full min-h-0 w-full max-w-2xl flex-col">
        <header className="grid shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-2 text-white">
          <div className="min-w-0">
            <img src="/brand/deepspec-logo.webp" alt="Deep Spec" className="h-12 w-32 rounded-xl bg-white object-contain p-1 shadow-sm ring-1 ring-[var(--ds-accent-line)] sm:w-36" />
          </div>
          <nav aria-label="Chat navigation" className="flex shrink-0 items-center gap-2">
            <Link to="/history" className="inline-flex min-h-11 items-center rounded-full bg-white px-3 text-sm font-bold text-slate-700 shadow-sm ring-1 ring-slate-200 sm:px-4">
              History
            </Link>
            <Link to={`/result/${lookup.id}`} className="inline-flex min-h-11 items-center rounded-full bg-white px-3 text-sm font-bold text-slate-700 shadow-sm ring-1 ring-slate-200 sm:px-4">
              Back
            </Link>
          </nav>
          <h1 className="col-span-2 line-clamp-2 text-2xl font-extrabold tracking-tight">Ask about this scan</h1>
        </header>

        <section className="mt-4 grid shrink-0 grid-cols-[64px_1fr] gap-3 rounded-[24px] border border-slate-200 bg-white p-3 shadow-sm sm:mt-5 sm:grid-cols-[76px_1fr]">
          <ScanThumb alt="" className="aspect-square w-full rounded-[18px] border border-neutral-200 bg-neutral-100 object-cover" src={lookup.frame.imageBase64} />
          <div className="min-w-0 py-1">
            <h2 className="line-clamp-2 break-words text-base font-extrabold tracking-tight">{partName}</h2>
            <p className="mt-1 text-xs font-semibold uppercase tracking-[0.12em] text-neutral-400">{lookup.scanCategory}</p>
            <p className="mt-2 text-sm leading-6 text-neutral-500">
              {canChat ? "Short follow-ups. Safety rules still apply." : "This scan needs an AI result before chat can help."}
            </p>
          </div>
        </section>

        {showSafetyWarning ? (
          <section className="mt-3 shrink-0 rounded-[24px] border border-[var(--ds-warn-line)] bg-[var(--ds-warn-soft)] p-3 sm:mt-4 sm:p-4">
            <p className="text-sm font-extrabold text-[var(--ds-warn-ink)]">Professional verification needed</p>
            <p className="mt-2 text-sm leading-6 text-neutral-700">I can explain the scan, but risky repairs need a mechanic.</p>
          </section>
        ) : null}

        <section className="chat-message-panel mt-3 flex min-h-0 flex-1 flex-col rounded-[24px] border border-slate-200 bg-white p-3 shadow-sm sm:mt-4 sm:p-4">
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain">
            {lookup.chatHistory.length > 0 ? (
              lookup.chatHistory.map((message) => (
                <article
                  key={message.id}
                  className={
                    message.role === "user"
                      ? "ml-auto max-w-[84%] break-words rounded-[22px] bg-[var(--ds-accent)] px-4 py-3 text-sm leading-6 text-white [overflow-wrap:anywhere]"
                      : "mr-auto max-w-[90%] break-words rounded-[22px] border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm leading-6 text-neutral-800 [overflow-wrap:anywhere]"
                  }
                >
                  {message.content}
                </article>
              ))
            ) : (
              <div className="grid min-h-48 place-items-center text-center">
                <div>
                  <p className="text-sm font-bold text-[var(--ds-accent)]">No questions yet</p>
                  <p className="mt-2 text-sm leading-6 text-neutral-500">Ask one clear question about this saved scan.</p>
                </div>
              </div>
            )}
            {isSending ? (
              <article className="mr-auto max-w-[90%] rounded-[22px] border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm font-semibold text-neutral-400">
                Thinking...
              </article>
            ) : null}
            <div ref={messagesEndRef} aria-hidden="true" />
          </div>

          {error && errorDetails ? (
            <section className="mt-3 rounded-2xl border border-[var(--ds-danger-line)] bg-[var(--ds-danger-soft)] p-3">
              <p className="text-sm font-extrabold text-[var(--ds-danger-ink)]">{errorDetails.title}</p>
              <p className="mt-1 text-sm leading-6 text-neutral-700">{error}</p>
              {errorDetails.category === "provider_unavailable" ? (
                <p className="mt-1 text-xs font-semibold leading-5 text-neutral-500">{errorDetails.description}</p>
              ) : null}
              {canRetryLastQuestion ? (
                <Button className="mt-3" type="button" onClick={handleRetryLastQuestion}>
                  Retry last question
                </Button>
              ) : null}
            </section>
          ) : null}

          <form className="mt-3 shrink-0 space-y-3 sm:mt-4" onSubmit={handleSubmit}>
            <label className="block">
              <span className="sr-only">Ask a follow-up question</span>
              <textarea
                className="min-h-20 w-full resize-none rounded-2xl border border-slate-200 bg-white p-3 text-base leading-6 text-slate-950 outline-none placeholder:text-slate-400 focus:border-[var(--ds-accent)]"
                disabled={!canChat || isSending}
                maxLength={500}
                onChange={(event) => setQuestion(event.target.value)}
                placeholder="Example: Is this leak serious?"
                value={question}
              />
            </label>
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-semibold text-neutral-400">{question.length}/500</p>
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
