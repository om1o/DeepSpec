import { Link } from "react-router-dom";
import { cx } from "../../lib/utils";

type IdentifyButtonProps = {
  isVisible: boolean;
  isDisabled: boolean;
  isReady: boolean;
  onIdentify: () => void;
};

export default function IdentifyButton({ isVisible, isDisabled, isReady, onIdentify }: IdentifyButtonProps) {
  const scanModes = [
    { label: "Identify", className: "bg-[var(--ds-feature-identify)] text-white" },
    { label: "Damage", className: "bg-[var(--ds-feature-damage)] text-white" },
    { label: "Leak", className: "bg-[var(--ds-feature-leak)] text-[var(--ds-logo-ink)]" },
    { label: "Safety", className: "bg-[var(--ds-feature-safety)] text-white" },
  ];

  return (
    <div
      aria-hidden={!isVisible}
      className={cx(
        "fixed inset-x-0 bottom-0 z-20 transition-transform duration-300",
        isVisible ? "translate-y-0" : "translate-y-full pointer-events-none",
      )}
    >
      <div className="absolute -top-10 left-1/2 z-30 -translate-x-1/2">
        <DSButton isReady={isReady} isDisabled={isDisabled} onIdentify={onIdentify} />
      </div>

      <div className="rounded-t-[28px] border border-white/70 bg-[var(--ds-panel)] px-4 pb-[max(16px,env(safe-area-inset-bottom))] shadow-[0_-22px_70px_rgba(2,6,23,0.45)]">
        <div className="pb-1 pt-14">
          <div className="flex h-11 items-center gap-2 rounded-full border border-slate-200 bg-white pl-1.5 pr-3 shadow-sm">
            <span className="grid h-8 min-w-8 place-items-center rounded-full bg-[var(--ds-accent)] px-2 text-[10px] font-black tracking-wide text-white">
              AI
            </span>
            <span className="min-w-0 truncate text-[13px] font-semibold text-slate-500">Scan, save, then ask about the result</span>
          </div>
        </div>

        <div className="no-scrollbar mt-3 flex gap-2 overflow-x-auto">
          {scanModes.map((mode) => (
            <button
              key={mode.label}
              className={cx("h-8 shrink-0 rounded-full px-3.5 text-[11px] font-extrabold shadow-sm", mode.className)}
              type="button"
            >
              {mode.label}
            </button>
          ))}
        </div>

        <div className="mt-3 grid grid-cols-3 rounded-full bg-slate-100 p-1">
          <button className="h-9 rounded-full bg-slate-950 text-[11.5px] font-extrabold text-white" type="button">
            Scan
          </button>
          <Link to="/history" className="flex h-9 items-center justify-center text-[11.5px] font-extrabold text-slate-500">
            Saved
          </Link>
          <Link to="/early-access" className="flex h-9 items-center justify-center text-[11.5px] font-extrabold text-slate-500">
            Access
          </Link>
        </div>
      </div>
    </div>
  );
}

function DSButton({ isReady, isDisabled, onIdentify }: { isReady: boolean; isDisabled: boolean; onIdentify: () => void }) {
  return (
    <div className="relative">
      {isReady && !isDisabled && (
        <span
          aria-hidden
          className="absolute inset-0 rounded-full animate-[ds-pulse-ring_1.6s_ease-out_infinite]"
          style={{ boxShadow: "0 0 0 0 rgba(11,116,255,0.52)" }}
        />
      )}
      <button
        disabled={isDisabled}
        onClick={onIdentify}
        className="relative grid h-20 w-20 place-items-center rounded-full text-white transition-transform active:scale-95 disabled:pointer-events-none disabled:opacity-45"
        style={{
          background: "linear-gradient(135deg, var(--ds-accent), var(--ds-logo-blue-deep))",
          border: "6px solid var(--ds-panel)",
          boxShadow: isReady && !isDisabled
            ? "0 0 0 2px rgba(11,116,255,0.78), 0 0 0 5px rgba(7,17,30,0.92), 0 14px 34px rgba(2,6,23,0.48)"
            : "0 14px 34px rgba(2,6,23,0.48)",
        }}
        aria-label="Scan now"
        type="button"
      >
        <span className="text-[13px] font-black uppercase tracking-[0.08em]">Scan</span>
      </button>
    </div>
  );
}
