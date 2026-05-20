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
        "fixed inset-x-0 bottom-[max(24px,env(safe-area-inset-bottom))] z-20 px-4 transition duration-300",
        isVisible ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0 pointer-events-none",
      )}
    >
      <button
        className={cx(
          "h-14 w-full rounded-full bg-white text-base font-bold text-neutral-950 transition duration-200",
          "disabled:pointer-events-none disabled:opacity-45",
          isReady && !isDisabled
            ? "shadow-[0_12px_40px_rgba(255,255,255,0.28)]"
            : "shadow-[0_12px_40px_rgba(255,255,255,0.16)]",
        )}
        disabled={isDisabled}
        onClick={onIdentify}
      >
        Identify
      </button>
    </div>
  );
}
