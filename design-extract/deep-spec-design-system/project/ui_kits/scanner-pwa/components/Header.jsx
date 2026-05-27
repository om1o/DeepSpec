// Deep Spec — Screen header used on Result / History / Chat / EarlyAccess
// Wordmark eyebrow + screen title + pill action(s) on the right.

function ScreenHeader({ title, actions = [] }) {
  return (
    <header className="mb-5 flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-[13px] font-extrabold uppercase tracking-[0.18em] text-white/70">Deep Spec</p>
        <h1 className="mt-2 truncate text-2xl font-extrabold tracking-tight">{title}</h1>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {actions.map((a) => (
          <button
            key={a.label}
            onClick={a.onClick}
            className="rounded-full bg-white/10 px-4 py-2 text-sm font-bold text-white"
          >
            {a.label}
          </button>
        ))}
      </div>
    </header>
  );
}

Object.assign(window, { ScreenHeader });
