import { cx } from "../../lib/utils";

type IdentifyButtonProps = {
  isVisible: boolean;
  isDisabled: boolean;
  isReady: boolean;
  onIdentify: () => void;
};

export default function IdentifyButton({ isVisible, isDisabled, isReady, onIdentify }: IdentifyButtonProps) {
  return (
    <div
      aria-hidden={!isVisible}
      className={cx(
        "fixed inset-x-0 bottom-[max(18px,env(safe-area-inset-bottom))] z-20 grid place-items-center transition duration-300",
        isVisible ? "translate-y-0 opacity-100" : "translate-y-8 opacity-0 pointer-events-none",
      )}
    >
      <DSButton isReady={isReady} isDisabled={isDisabled} onIdentify={onIdentify} />
    </div>
  );
}

function DSButton({ isReady, isDisabled, onIdentify }: { isReady: boolean; isDisabled: boolean; onIdentify: () => void }) {
  return (
    <div className="relative grid size-[86px] place-items-center rounded-full bg-black/18 ring-1 ring-white/14 backdrop-blur-xl">
      {isReady && !isDisabled && (
        <span
          aria-hidden
          className="absolute inset-1 rounded-full animate-[ds-pulse-ring_1.6s_ease-out_infinite]"
          style={{ boxShadow: "0 0 0 0 rgba(11,116,255,0.52)" }}
        />
      )}
      <button
        disabled={isDisabled}
        onClick={onIdentify}
        className="relative grid size-[72px] place-items-center rounded-full bg-white text-[0] transition-transform active:scale-95 disabled:pointer-events-none disabled:opacity-45"
        style={{
          border: "5px solid rgba(255,255,255,0.58)",
          boxShadow: isReady && !isDisabled
            ? "0 0 0 2px rgba(11,116,255,0.78), 0 0 0 7px rgba(7,17,30,0.62), 0 18px 44px rgba(2,6,23,0.58)"
            : "0 18px 44px rgba(2,6,23,0.58)",
        }}
        aria-label="Scan now"
        type="button"
      >
        <span className="block size-[42px] rounded-full bg-[linear-gradient(135deg,var(--ds-accent),var(--ds-logo-blue-deep))]" />
      </button>
    </div>
  );
}
