// Deep Spec — Chat (follow-up Q&A) screen

const { useState: useStateChat } = React;

function ChatScreen({ go }) {
  const [question, setQuestion] = useStateChat("");
  const [thread, setThread] = useStateChat([
    { id: 1, role: "user",      content: "Is this leak serious?" },
    { id: 2, role: "assistant", content: "The reservoir looks low but not empty. Top it off, then check again after 50 miles. If it drops, get the system inspected before driving further." },
  ]);
  const [isSending, setIsSending] = useStateChat(false);

  function handleSubmit(e) {
    e.preventDefault();
    const trimmed = question.trim();
    if (!trimmed || isSending) return;
    const userMsg = { id: Date.now(), role: "user", content: trimmed };
    setThread((t) => [...t, userMsg]);
    setQuestion("");
    setIsSending(true);
    setTimeout(() => {
      setThread((t) => [...t, { id: Date.now() + 1, role: "assistant", content: "Short answer with a safety hedge. Verify with a mechanic if anything seems off." }]);
      setIsSending(false);
    }, 900);
  }

  return (
    <main
      className="flex min-h-full flex-col bg-[#0A0A0A] px-4 pb-4 text-white"
      style={{ paddingTop: "max(18px, env(safe-area-inset-top))" }}
    >
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col">
        <ScreenHeader
          title="Ask about this scan"
          actions={[{ label: "Back", onClick: () => go("/result/demo") }]}
        />

        {/* Scan strip */}
        <section className="grid grid-cols-[76px_1fr] gap-3 rounded-[24px] border border-white/10 bg-[#171717] p-3">
          <div
            className="aspect-square w-full rounded-[18px] border border-white/10"
            style={{ background: "linear-gradient(135deg, #2a2018 0%, #15110a 70%, #060403 100%)" }}
          />
          <div className="min-w-0 py-1">
            <h2 className="truncate text-base font-extrabold tracking-tight">Alternator</h2>
            <p className="mt-1 text-xs font-semibold uppercase tracking-[0.12em] text-white/36">electrical</p>
            <p className="mt-2 text-sm leading-6 text-[#A1A1AA]">Short follow-ups. Safety rules still apply.</p>
          </div>
        </section>

        {/* Conversation card */}
        <section className="mt-4 flex flex-1 flex-col rounded-[24px] border border-white/10 bg-[#171717] p-4">
          <div className="flex-1 space-y-3 overflow-y-auto">
            {thread.map((m) => (
              <article
                key={m.id}
                className={
                  m.role === "user"
                    ? "ml-auto max-w-[84%] rounded-[22px] bg-white px-4 py-3 text-sm leading-6 text-neutral-950"
                    : "mr-auto max-w-[90%] rounded-[22px] border border-white/10 bg-white/[0.06] px-4 py-3 text-sm leading-6 text-white/86"
                }
              >
                {m.content}
              </article>
            ))}
            {isSending && (
              <article className="mr-auto max-w-[90%] rounded-[22px] border border-white/10 bg-white/[0.06] px-4 py-3 text-sm font-semibold text-white/60">
                Thinking...
              </article>
            )}
          </div>

          <form className="mt-4 space-y-3" onSubmit={handleSubmit}>
            <label className="block">
              <span className="sr-only">Ask a follow-up question</span>
              <TextArea
                className="min-h-20"
                disabled={isSending}
                maxLength={500}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="Example: What fluid do I use?"
                value={question}
              />
            </label>
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-semibold text-white/36">{question.length}/500</p>
              <Button disabled={isSending || !question.trim()} type="submit">Send</Button>
            </div>
          </form>
        </section>
      </div>
    </main>
  );
}

Object.assign(window, { ChatScreen });
