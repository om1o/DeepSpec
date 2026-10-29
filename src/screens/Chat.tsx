import { getAccountScope, isAccountScopeCurrent } from "../lib/accountScope";
import { FormEvent, useEffect, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { BrandLockup } from "../components/BrandLockup";
import { ScanSources } from "../components/result/ScanSources";
import Button from "../components/ui/Button";
import ScanThumb from "../components/ui/ScanThumb";
import { AIServiceError, getAIErrorDetails, getAIErrorMessage, sendFollowUp, sendFollowUpDetails } from "../services/aiService";
import { appendChatMessages, createChatMessage, getLookup } from "../services/storage";
import type { ChatMessage, Lookup } from "../types";
import "./chatWorkspace.css";

type ResearchOptions = { research: boolean; sourceUrls: string[] };

export default function Chat() {
  const { id } = useParams();
  const scope = getAccountScope();
  return <ChatConversation key={JSON.stringify([id, scope.userId, scope.generation])} id={id} />;
}

function ChatConversation({ id }: { id: string | undefined }) {
  const accountScopeRef = useRef(getAccountScope());
  const isMountedRef = useRef(true);
  const [searchParams] = useSearchParams();
  const [lookup, setLookup] = useState<Lookup | null>(() => (id ? getLookup(id) : null));
  const [question, setQuestion] = useState(() => searchParams.get("q")?.trim().slice(0, 500) ?? "");
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);
  const [pendingExchange, setPendingExchange] = useState<ChatMessage[] | null>(null);
  const [research, setResearch] = useState(false);
  const [sourceUrl, setSourceUrl] = useState("");
  const [searchSuggestionsByMessage, setSearchSuggestionsByMessage] = useState<Record<string, string>>({});
  const pendingOptionsRef = useRef<ResearchOptions | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const isChatDisabled = errorCode === "feature_disabled";

  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  function isCurrentConversation() {
    return isMountedRef.current && isAccountScopeCurrent(accountScopeRef.current);
  }

  useEffect(() => {
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    messagesEndRef.current?.scrollIntoView?.({ behavior: reducedMotion ? "auto" : "smooth", block: "end" });
  }, [lookup?.chatHistory.length, isSending]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isCurrentConversation() || !lookup || !lookup.result || isSending || isChatDisabled || pendingExchange) {
      return;
    }

    const trimmedQuestion = question.trim().slice(0, 500);
    if (!trimmedQuestion) {
      setError("Ask a question first.");
      setErrorCode("invalid_input");
      return;
    }

    await sendQuestion(trimmedQuestion, true, {
      research,
      sourceUrls: research && sourceUrl.trim() ? [sourceUrl.trim()] : [],
    });
  }

  async function handleRetryLastQuestion() {
    if (pendingExchange) return;
    const lastUserMessage = lookup ? getLastUnansweredUserMessage(lookup) : null;
    const retryQuestion = pendingQuestion ?? lastUserMessage?.content;
    if (!retryQuestion || isSending) {
      return;
    }

    await sendQuestion(retryQuestion, Boolean(pendingQuestion), pendingOptionsRef.current ?? undefined);
  }

  async function sendQuestion(trimmedQuestion: string, shouldSaveUserMessage: boolean, options?: ResearchOptions) {
    if (!isCurrentConversation() || !lookup || !lookup.result || isSending || isChatDisabled || pendingExchange) {
      return;
    }

    setError(null);
    setErrorCode(null);
    setIsSending(true);
    pendingOptionsRef.current = options ?? { research: false, sourceUrls: [] };

    // Keep new questions in memory until an answer is available. A disabled or
    // failed request must not leave an unanswered question in durable history.
    if (shouldSaveUserMessage) setPendingQuestion(trimmedQuestion);

    try {
      const answer: Awaited<ReturnType<typeof sendFollowUpDetails>> = options?.research
        ? await sendFollowUpDetails(lookup, trimmedQuestion, options)
        : { message: await sendFollowUp(lookup, trimmedQuestion) };
      if (!isCurrentConversation()) return;
      const userMessage = shouldSaveUserMessage ? createChatMessage("user", trimmedQuestion) : null;
      const assistantMessage = {
        ...createChatMessage("assistant", answer.message),
        ...(answer.sources?.length ? { sources: answer.sources } : {}),
      };
      if (answer.searchSuggestions) {
        setSearchSuggestionsByMessage((current) => ({ ...current, [assistantMessage.id]: answer.searchSuggestions! }));
      }
      // Reuse these IDs on every persistence retry, including partial writes.
      const messages = [
        ...(userMessage ? [userMessage] : []),
        assistantMessage,
      ];
      setPendingExchange(messages);
      setPendingQuestion(null);
      persistExchange(messages);
    } catch (chatError) {
      if (!isCurrentConversation()) return;
      setError(getAIErrorMessage(chatError));
      setErrorCode(chatError instanceof AIServiceError ? chatError.code : null);
    } finally {
      if (isCurrentConversation()) setIsSending(false);
    }
  }

  function persistExchange(messages: ChatMessage[]) {
    if (!isCurrentConversation() || !lookup || isChatDisabled) return;
    const savedConversation = appendChatMessages(lookup.id, messages);
    if (!isCurrentConversation()) return;
    if (!savedConversation.ok || !savedConversation.value) {
      setError(savedConversation.ok ? "This saved scan was not found." : savedConversation.message);
      setErrorCode("storage");
      return;
    }
    setLookup(savedConversation.value);
    setPendingExchange(null);
    setError(null);
    setErrorCode(null);
    setQuestion("");
    pendingOptionsRef.current = null;
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
  const canRetryLastQuestion = Boolean(error && errorCode !== "feature_disabled" && !pendingExchange && (pendingQuestion || lastUnansweredUserMessage) && canChat && !isSending);
  const visibleMessages = [...lookup.chatHistory, ...(pendingExchange ?? []).filter((message) => !lookup.chatHistory.some((saved) => saved.id === message.id))];

  const inputDisabled = !canChat || isSending || isChatDisabled || Boolean(pendingExchange);

  return (
    <main className="ds-chat-page ds-workbench ds-chat-workspace text-[var(--ds-fg-1)]">
      <div className="ds-chat-shell">
        <header className="ds-chat-header">
          <div>
            <BrandLockup />
            <div className="ds-chat-heading">
              <p className="ds-eyebrow">YOUR PHOTO. A FULL CONVERSATION.</p>
              <h1 className="text-2xl font-bold tracking-tight">Ask DeepSpec</h1>
            </div>
          </div>
          <nav className="flex items-center gap-3" aria-label="Scan navigation">
            <Link to="/history" className="ds-chat-saved-link">Saved scans</Link>
            <Link to={`/result/${lookup.id}`} className="ds-workbench-back">Back</Link>
          </nav>
        </header>

        <div className="ds-chat-columns">
          <aside className="ds-chat-context" aria-label="Scan photo and AI overview">
            <Link to={`/result/${lookup.id}`} className="ds-chat-photo-link" aria-label="Open full scan photo">
              <ScanThumb alt={`Saved photo of ${partName}`} className="ds-chat-photo" src={lookup.frame.imageBase64} />
            </Link>
            <div className="ds-chat-context-heading">
              <p className="ds-eyebrow">AI OVERVIEW</p>
              <h2 className="text-base font-bold tracking-tight">{partName}</h2>
              <Link to={`/result/${lookup.id}`} className="ds-chat-open-view">Open AI view <svg aria-hidden="true" width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M4 12 12 4M4 4h8v8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg></Link>
            </div>
            <div className="ds-chat-context-full">
              {lookup.result ? (
                <>
                  <p className="text-sm leading-6 text-[var(--ds-fg-3)]">{lookup.result.whatItDoes}</p>
                  {lookup.result.concerns.length > 0 ? (
                    <section className="ds-chat-context-section" aria-label="Visible concerns">
                      <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--ds-fg-3)]">What needs attention</h3>
                      <ul className="mt-2 space-y-2 text-sm leading-6">
                        {lookup.result.concerns.map((concern, index) => <li key={index}>{concern}</li>)}
                      </ul>
                    </section>
                  ) : null}
                  <ScanSources sources={lookup.result.sourceLinks} title="Scan references" />
                </>
              ) : <p className="text-sm leading-6 text-[var(--ds-fg-3)]">Get an AI result first, then chat.</p>}
            </div>
          </aside>

          <section className="ds-chat-conversation" aria-label="Full scan conversation">
            {showSafetyWarning ? (
              <section className="ds-chat-safety rounded-2xl border border-[var(--ds-warn-line)] bg-[var(--ds-warn-soft)] p-3">
                <p className="text-sm font-extrabold text-[var(--ds-warn-ink)]">Safety check needed</p>
                <p className="mt-1 text-sm leading-6 text-[var(--ds-fg-2)]">Confirm this before driving or repairing.</p>
              </section>
            ) : null}

            <div className="ds-chat-log" role="log" aria-label="Conversation" aria-live="polite">
              {visibleMessages.length > 0 ? (
                visibleMessages.map((message) => (
                  <article
                    key={message.id}
                    className={message.role === "user" ? "ds-chat-message ds-chat-message-user ml-auto" : "ds-chat-message ds-chat-message-assistant mr-auto"}
                  >
                    <p className="mb-1 text-xs font-bold opacity-80">{message.role === "user" ? "You" : "DeepSpec"}</p>
                    <p className="whitespace-pre-wrap break-words">{message.content}</p>
                    {message.role === "assistant" && message.sources?.length ? <ScanSources sources={message.sources} title="Sources used for this answer" /> : null}
                    {searchSuggestionsByMessage[message.id] ? (
                      <iframe
                        title="Google Search suggestions"
                        className="ds-chat-search-suggestions"
                        srcDoc={searchSuggestionsByMessage[message.id]}
                        sandbox="allow-popups allow-popups-to-escape-sandbox"
                        referrerPolicy="no-referrer"
                      />
                    ) : null}
                  </article>
                ))
              ) : (
                <div className="ds-chat-empty">
                  <div>
                    <p className="text-base font-bold">No questions yet</p>
                    <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-[var(--ds-fg-3)]">Ask about a visible problem, a marking, or the next check. Your saved photo stays with the conversation.</p>
                  </div>
                </div>
              )}
              {isSending ? (
                <article className="ds-chat-message ds-chat-message-assistant mr-auto text-[var(--ds-fg-3)]">
                  {pendingOptionsRef.current?.research ? "Researching your question…" : "Looking at your scan…"}
                </article>
              ) : null}
              <div ref={messagesEndRef} aria-hidden="true" />
            </div>

            {error && errorDetails ? (
              <section className="ds-chat-error rounded-2xl border border-[var(--ds-danger-line)] bg-[var(--ds-danger-soft)] p-3">
                <p className="text-sm font-extrabold text-[var(--ds-danger-ink)]">{errorDetails.title}</p>
                <p className="mt-1 text-sm leading-6 text-[var(--ds-fg-2)]">{error}</p>
                {errorDetails.category === "provider_unavailable" ? (
                  <p className="mt-1 text-xs font-semibold leading-5 text-[var(--ds-fg-3)]">{errorDetails.description}</p>
                ) : null}
                {canRetryLastQuestion ? <Button className="mt-3" type="button" onClick={handleRetryLastQuestion}>Retry last question</Button> : null}
                {pendingExchange ? (
                  <>
                    <p className="mt-2 text-sm leading-6 text-[var(--ds-fg-2)]">Your answer is kept on this page. Retry saving before leaving or reloading.</p>
                    <Button className="mt-3" type="button" disabled={isSending} onClick={() => persistExchange(pendingExchange)}>Retry saving answer</Button>
                  </>
                ) : null}
              </section>
            ) : null}

            <form className="ds-chat-composer" onSubmit={handleSubmit}>
              <label className="block">
                <span className="sr-only">Ask a follow-up question</span>
                <textarea
                  className="ds-chat-input"
                  disabled={inputDisabled}
                  maxLength={500}
                  onChange={(event) => setQuestion(event.target.value)}
                  placeholder="Ask about this photo, a problem, or a reference…"
                  value={question}
                />
              </label>
              <div className="ds-chat-compose-actions">
                <label className="ds-chat-research-toggle">
                  <input type="checkbox" checked={research} onChange={(event) => setResearch(event.target.checked)} disabled={inputDisabled} />
                  Research web and video sources
                </label>
                <span className="ds-chat-counter">{question.length}/500</span>
                <Button disabled={inputDisabled || !question.trim()} type="submit">Send</Button>
              </div>
              {research ? (
                <label className="ds-chat-reference-label">
                  Reference URL (optional)
                  <input
                    className="ds-chat-reference-input"
                    type="url"
                    maxLength={2048}
                    disabled={inputDisabled}
                    value={sourceUrl}
                    onChange={(event) => setSourceUrl(event.target.value)}
                    placeholder="Paste a YouTube video or reference link"
                  />
                </label>
              ) : null}
            </form>
          </section>
        </div>
      </div>
    </main>
  );
}

function getLastUnansweredUserMessage(lookup: Lookup) {
  const lastMessage = lookup.chatHistory.at(-1);
  return lastMessage?.role === "user" ? lastMessage : null;
}
