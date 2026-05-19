import { Link } from "react-router-dom";
import { cx } from "../../lib/utils";

type IdentifyButtonProps = {
  isVisible: boolean;
  isDisabled: boolean;
  onIdentify: () => void;
};

export default function IdentifyButton({ isVisible, isDisabled, onIdentify }: IdentifyButtonProps) {
  return (
    <div
      className={cx(
        "fixed inset-x-0 bottom-8 z-20 transition duration-300",
        isVisible ? "translate-y-0 opacity-100" : "translate-y-8 opacity-0",
      )}
    >
      <div className="mx-auto w-full max-w-md px-3">
        <div className="relative rounded-t-[28px] bg-[#F5F5F5] px-3 pb-[max(10px,env(safe-area-inset-bottom))] pt-6 text-[#0A0A0A] shadow-[0_-22px_60px_rgba(0,0,0,0.42)]">
          <button
            aria-label="Identify"
            className="absolute left-1/2 top-0 grid size-16 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-[5px] border-[#F5F5F5] bg-[#0A0A0A] text-white shadow-[0_10px_40px_rgba(0,0,0,0.35)] transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={!isVisible || isDisabled}
            onClick={onIdentify}
          >
            <span className="grid size-9 place-items-center rounded-full bg-[#FACC15] text-[13px] font-black text-[#0A0A0A]">DS</span>
          </button>

          <div className="mt-6 flex h-10 items-center gap-3 rounded-full bg-white px-4 text-sm font-semibold text-[#52525B] shadow-sm ring-1 ring-black/8">
            <span className="grid size-5 place-items-center rounded-full bg-[#FACC15] text-[9px] font-black text-[#0A0A0A]">
              AI
            </span>
            <span className="truncate">Ask about this car part</span>
          </div>

          <div className="mt-2 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">
            {["Identify", "Damage", "Leak", "Safety"].map((prompt) => (
              <span key={prompt} className="shrink-0 rounded-full bg-[#EDEDED] px-3 py-1.5 text-[11px] font-extrabold text-[#3F3F46]">
                {prompt}
              </span>
            ))}
          </div>

          <div className="mt-2 grid grid-cols-2 gap-2">
            <div className="rounded-[16px] bg-white p-2.5 ring-1 ring-black/8">
              <p className="text-[11px] font-black uppercase tracking-[0.12em] text-[#71717A]">Mode</p>
              <p className="mt-1 text-sm font-black">Part scan</p>
            </div>
            <div className="rounded-[16px] bg-white p-2.5 ring-1 ring-black/8">
              <p className="text-[11px] font-black uppercase tracking-[0.12em] text-[#71717A]">Output</p>
              <p className="mt-1 text-sm font-black">Safety first</p>
            </div>
          </div>

          <nav className="mt-2 grid grid-cols-3 rounded-full bg-[#EDEDED] p-1 text-center text-[11px] font-black uppercase tracking-[0.12em] text-[#71717A]">
            <span className="rounded-full bg-[#0A0A0A] px-3 py-1.5 text-white">Scan</span>
            <Link className="px-3 py-2" to="/history">
              Saved
            </Link>
            <Link className="px-3 py-2" to="/early-access">
              Help
            </Link>
          </nav>
        </div>
      </div>
    </div>
  );
}
