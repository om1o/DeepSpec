// Deep Spec — History (saved scans) screen

const DEMO_LOOKUPS = [
  { id: "a", title: "Alternator",        status: "high confidence",        category: "electrical", rating: "up",   thumb: "warm" },
  { id: "b", title: "Brake fluid reservoir cap", status: "Useful match",   category: "fluid",      rating: null,   thumb: "cool" },
  { id: "c", title: "Coolant overflow tank",     status: "Better photo needed", category: "fluid",  rating: null,   thumb: "dim" },
  { id: "d", title: "Engine air filter",         status: "medium confidence",   category: "air intake", rating: "up", thumb: "warm" },
  { id: "e", title: "Unidentified component",    status: "AI error saved",      category: "uncategorized", rating: "down", thumb: "cool" },
];

function thumbGradient(kind) {
  const map = {
    warm: "linear-gradient(135deg, #3a2a18 0%, #1a1108 70%, #0a0604 100%)",
    cool: "linear-gradient(135deg, #1a2230 0%, #0f141c 70%, #050709 100%)",
    dim:  "linear-gradient(135deg, #1f1f22 0%, #121214 70%, #050505 100%)",
  };
  return map[kind] || map.dim;
}

function HistoryScreen({ go }) {
  return (
    <main
      className="min-h-full bg-[#0A0A0A] px-4 pb-8 text-white"
      style={{ paddingTop: "max(18px, env(safe-area-inset-top))" }}
    >
      <div className="mx-auto w-full max-w-md">
        <ScreenHeader
          title="Saved scans"
          actions={[
            { label: "Join", onClick: () => go("/early-access") },
            { label: "Scan", onClick: () => go("/") },
          ]}
        />

        <div className="mt-2 space-y-3">
          {DEMO_LOOKUPS.map((l) => (
            <button
              key={l.id}
              onClick={() => go("/result/" + l.id)}
              className="grid w-full grid-cols-[88px_1fr] gap-3 rounded-[24px] border border-white/10 bg-[#171717] p-3 text-left text-white transition hover:border-white/20"
            >
              <div
                className="aspect-square w-full rounded-[18px] border border-white/10"
                style={{ background: thumbGradient(l.thumb) }}
                aria-hidden
              />
              <div className="min-w-0 py-1">
                <div className="flex items-start justify-between gap-2">
                  <h2 className="truncate text-base font-extrabold tracking-tight">{l.title}</h2>
                  {l.rating ? (
                    <span className="shrink-0 text-xs font-bold text-white/50">
                      {l.rating === "up" ? "Helpful" : "Wrong"}
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 truncate text-xs font-semibold text-white/42">5/18/26, 2:08 PM</p>
                <p className="mt-3 text-sm font-semibold text-[#A1A1AA]">{l.status}</p>
                <p className="mt-1 text-xs font-semibold uppercase tracking-[0.12em] text-white/36">{l.category}</p>
              </div>
            </button>
          ))}
        </div>
      </div>
    </main>
  );
}

Object.assign(window, { HistoryScreen });
