import { FormEvent, useState } from "react";
import { Link, useParams } from "react-router-dom";
import Button from "../components/ui/Button";
import { getAIErrorMessage, sendFollowUp } from "../services/aiService";
import { appendChatMessages, createChatMessage, getLookup } from "../services/storage";
import type { Lookup } from "../types";

export default function Chat() {
  const { id } = useParams();
  const [lookup, setLookup] = useState<Lookup | null>(() => (id ? getLookup(id) : null));
  const [question, setQuestion] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!lookup || !lookup.result || isSending) {
      return;
    }

    const trimmedQuestion = question.trim().slice(0, 500);
    if (!trimmedQuestion) {
      setError("Ask a question first.");
      return;
    }

    setError(null);
    setIsSending(true);

    const userMessage = createChatMessage("user", trimmedQuestion);
    const savedUserMessage = appendChatMessages(lookup.id, [userMessage]);
    if (!savedUserMessage.ok) {
      setError(savedUserMessage.message);
      setIsSending(false);
      return;
    }

    if (!savedUserMessage.value) {
      setError("This saved scan was not found.");
      setIsSending(false);
      return;
    }

    setLookup(savedUserMessage.value);
    setQuestion("");

    try {
      const answer = await sendFollowUp(savedUserMessage.value, trimmedQuestion);
      const assistantMessage = createChatMessage("assistant", answer);
      const savedAssistantMessage = appendChatMessages(lookup.id, [assistantMessage]);
      if (!savedAssistantMessage.ok) {
        setError(savedAssistantMessage.message);
        return;
      }

      if (!savedAssistantMessage.value) {
        setError("This saved scan was not found.");
        return;
      }

      setLookup(savedAssistantMessage.value);
    } catch (chatError) {
      setError(getAIErrorMessage(chatError));
    } finally {
      setIsSending(false);
    }
  }

  if (!lookup) {
    return (
      <main className="grid min-h-dvh place-items-center bg-[#0A0A0A] px-5 text-center text-white">
        <section className="w-full max-w-sm rounded-[24px] border border-white/10 bg-[#171717] p-6">
          <p className="text-sm font-bold text-[#FACC15]">Scan not found</p>
          <h1 className="mt-2 text-2xl font-extrabold tracking-tight">Open a saved scan first</h1>
          <p className="mt-3 text-sm leading-6 text-[#A1A1AA]">Follow-up chat only works from a scan saved on this device.</p>
          <Link className="mt-5 block rounded-full bg-white px-5 py-3 text-sm font-bold text-neutral-950" to="/history">
            Saved scans
          </Link>
        </section>
      </main>
    );
  }

  const partName = lookup.result?.partName ?? "Captured frame";
  const canChat = Boolean(lookup.result);
  const showSafetyWarning = lookup.result?.isSafetyCritical || lookup.result?.safetyTriage === "needs_professional";

  return (
    <main className="min-h-dvh bg-[#0A0A0A] px-4 pb-[max(18px,env(safe-area-inset-bottom))] pt-[max(18px,env(safe-area-inset-top))] text-white">
      <div className="mx-auto flex min-h-[calc(100dvh-36px)] w-full max-w-md flex-col">
        <header className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[13px] font-extrabold uppercase tracking-[0.18em] text-white/70">Deep Spec</p>
            <h1 className="mt-2 truncate text-2xl font-extrabold tracking-tight">Ask about this scan</h1>
          </div>
          <Link to={`/result/${lookup.id}`} className="rounded-full bg-white/10 px-4 py-2 text-sm font-bold text-white">
            Back
          </Link>
        </header>

        <section className="mt-5 grid grid-cols-[76px_1fr] gap-3 rounded-[24px] border border-white/10 bg-[#171717] p-3">
          <img alt="" className="aspect-square w-full rounded-[18px] border border-white/10 bg-black object-cover" src={lookup.frame.imageBase64} />
          <div className="min-w-0 py-1">
            <h2 className="truncate text-base font-extrabold tracking-tight">{partName}</h2>
            <p className="mt-1 text-xs font-semibold uppercase tracking-[0.12em] text-white/36">{lookup.scanCategory}</p>
            <p className="mt-2 text-sm leading-6 text-[#A1A1AA]">
              {canChat ? "Short follow-ups. Safety rules still apply." : "This scan needs an AI result before chat can help."}
            </p>
          </div>
        </section>

        {showSafetyWarning ? (
          <section className="mt-4 rounded-[24px] border border-[#F59E0B]/30 bg-[#F59E0B]/10 p-4">
            <p className="text-sm font-extrabold text-[#FACC15]">Professional verification needed</p>
            <p className="mt-2 text-sm leading-6 text-white/82">I can explain the scan, but risky repairs need a mechanic.</p>
          </section>
        ) : null}

        <section className="mt-4 flex flex-1 flex-col rounded-[24px] border border-white/10 bg-[#171717] p-4">
          <div className="flex-1 space-y-3 overflow-y-auto">
            {lookup.chatHistory.length > 0 ? (
              lookup.chatHistory.map((message) => (
                <article
                  key={message.id}
                  className={
                    message.role === "user"
                      ? "ml-auto max-w-[84%] rounded-[22px] bg-white px-4 py-3 text-sm leading-6 text-neutral-950"
                      : "mr-auto max-w-[90%] rounded-[22px] border border-white/10 bg-white/[0.06] px-4 py-3 text-sm leading-6 text-white/86"
                  }
                >
                  {message.content}
                </article>
              ))
            ) : (
              <div className="grid min-h-48 place-items-center text-center">
                <div>
                  <p className="text-sm font-bold text-[#FACC15]">No questions yet</p>
                  <p className="mt-2 text-sm leading-6 text-[#A1A1AA]">Ask one clear question about this saved scan.</p>
                </div>
              </div>
            )}
            {isSending ? (
              <article className="mr-auto max-w-[90%] rounded-[22px] border border-white/10 bg-white/[0.06] px-4 py-3 text-sm font-semibold text-white/60">
                Thinking...
              </article>
            ) : null}
          </div>

          {error ? <p className="mt-3 text-sm font-semibold text-[#FCA5A5]">{error}</p> : null}

          <form className="mt-4 space-y-3" onSubmit={handleSubmit}>
            <label className="block">
              <span className="sr-only">Ask a follow-up question</span>
              <textarea
                className="min-h-20 w-full resize-none rounded-2xl border border-white/10 bg-black/28 p-3 text-sm leading-6 text-white outline-none placeholder:text-white/32 focus:border-[#FACC15]/50"
                disabled={!canChat || isSending}
                maxLength={500}
                onChange={(event) => setQuestion(event.target.value)}
                placeholder="Example: Is this leak serious?"
                value={question}
              />
            </label>
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-semibold text-white/36">{question.length}/500</p>
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
