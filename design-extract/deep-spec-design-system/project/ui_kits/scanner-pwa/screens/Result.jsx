// Deep Spec — Result screen
// AI identification + Trust check + What it does / sees / evidence / next action

const DEMO_RESULT = {
  partName: "Alternator",
  confidence: "high",
  scanCategory: "electrical",
  capturedAt: "5/19/26, 4:12 PM",
  whatItDoes: "Charges the battery while the engine runs.",
  visibleObservations: [
    "Belt-driven metal housing visible.",
    "Pulley and cooling fins centered in frame.",
    "Plug connector visible on top.",
  ],
  concerns: [],
  evidence: [
    "Pulley and housing match an alternator",
    "Belt-driven mount on the front of the engine",
    "Engine bay context",
  ],
  nextAction: "Optional: capture the label or connector for stronger confirmation.",
  trust: {
    status: "Useful match",
    description: "The image has enough visual evidence for a useful consumer-level explanation.",
    photoQuality: "Good",
    retakeGuidance: "Optional: take a close-up label photo if you need more certainty later.",
    tone: "ok",
  },
};

function ResultScreen({ go }) {
  const r = DEMO_RESULT;
  return (
    <main
      className="min-h-full bg-[#0A0A0A] px-4 pb-8 text-white"
      style={{ paddingTop: "max(18px, env(safe-area-inset-top))" }}
    >
      <div className="mx-auto flex w-full max-w-md flex-col">
        <ScreenHeader
          title={r.partName}
          actions={[{ label: "Back", onClick: () => go("/") }]}
        />

        {/* Frame placeholder — the captured photo */}
        <div
          className="aspect-[3/4] w-full rounded-[24px] border border-white/10"
          style={{
            background: `
              radial-gradient(140% 70% at 30% 25%, rgba(80,80,80,0.50) 0%, rgba(15,15,15,0) 60%),
              radial-gradient(80% 60% at 70% 75%, rgba(50,50,50,0.45) 0%, rgba(10,10,10,0) 60%),
              linear-gradient(160deg, #1E1E20 0%, #0F0F10 70%, #050505 100%)
            `,
          }}
        />

        <div className="mt-5 space-y-4">
          <PrimaryCard>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-bold text-[#FACC15]">AI identification</p>
                <h2 className="mt-2 text-xl font-extrabold tracking-tight">{r.partName}</h2>
              </div>
              <ConfidenceBadge confidence={r.confidence} />
            </div>
            <p className="mt-3 text-xs font-semibold text-white/42">Captured {r.capturedAt}</p>
            <p className="mt-2 text-xs font-extrabold uppercase tracking-[0.14em] text-white/36">
              Dataset bucket: {r.scanCategory}
            </p>
          </PrimaryCard>

          <TrustReviewCard {...r.trust} />

          <PrimaryCard>
            <h2 className="text-sm font-extrabold uppercase tracking-[0.14em] text-white/62">What it does</h2>
            <p className="mt-3 text-sm leading-6 text-[#E5E7EB]">{r.whatItDoes}</p>
          </PrimaryCard>

          <ResultSection title="What I see" items={r.visibleObservations} emptyText="No clear visual clues were returned." />

          <EvidenceCard items={r.evidence} />

          <PrimaryCard>
            <h2 className="text-sm font-extrabold uppercase tracking-[0.14em] text-white/62">Next action</h2>
            <p className="mt-3 text-sm leading-6 text-[#E5E7EB]">{r.nextAction}</p>
          </PrimaryCard>

          {/* Saved-scan controls */}
          <PrimaryCard>
            <p className="text-sm font-extrabold text-white">Saved scan</p>
            <p className="mt-2 text-sm leading-6 text-[#A1A1AA]">
              Your rating and correction stay on this device. This is the data moat for improving Deep Spec later.
            </p>
            <div className="mt-4 grid grid-cols-1 gap-3">
              <NestedRow label="Dataset category" value={r.scanCategory} />
              <NestedRow label="Training label" value={r.partName} />
              <NestedRow label="Review status" value="needs review" />
            </div>
            <div className="mt-4 grid grid-cols-1 gap-3">
              <button
                onClick={() => go("/chat")}
                className="block rounded-full bg-white px-5 py-3 text-center text-sm font-bold text-neutral-950 shadow-[0_12px_40px_rgba(255,255,255,0.16)]"
              >
                Tell me more
              </button>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <Button variant="ghost">Helpful</Button>
              <Button variant="ghost">Wrong</Button>
            </div>
          </PrimaryCard>
        </div>

        <Button className="mt-6 w-full" onClick={() => go("/")}>
          Try another scan
        </Button>
      </div>
    </main>
  );
}

Object.assign(window, { ResultScreen });
