import { cx } from "../../lib/utils";
import {
  SCANNER_RETICLE_ASPECT_RATIO,
  SCANNER_RETICLE_CENTER_Y_RATIO,
  SCANNER_RETICLE_MAX_WIDTH_PX,
  SCANNER_RETICLE_WIDTH_RATIO,
} from "../../lib/scannerReticle";

type ReticleProps = {
  isVisible: boolean;
  isLocked: boolean;
  label?: string;
  progress: number;
};

export default function Reticle({ isLocked, isVisible, label, progress }: ReticleProps) {
  const safeProgress = Math.max(0, Math.min(1, progress));

  return (
    <div
      aria-hidden="true"
      data-testid="object-reticle"
      className={cx(
        "pointer-events-none fixed left-1/2 z-10 -translate-x-1/2 -translate-y-1/2 transition-opacity duration-300",
        isVisible ? "opacity-100" : "opacity-0",
      )}
      style={{
        aspectRatio: `${SCANNER_RETICLE_ASPECT_RATIO}`,
        top: `${SCANNER_RETICLE_CENTER_Y_RATIO * 100}dvh`,
        width: `min(${SCANNER_RETICLE_WIDTH_RATIO * 100}vw, ${SCANNER_RETICLE_MAX_WIDTH_PX}px)`,
      }}
    >
      <div className="absolute inset-0 rounded-[30px] border border-white/18 bg-black/5 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08),0_0_34px_rgba(11,116,255,0.25)]" />
      <div className={cx("scanner-sweep", isLocked ? "opacity-0" : "opacity-100")} />
      <div className="scanner-corner scanner-corner-tl" />
      <div className="scanner-corner scanner-corner-tr" />
      <div className="scanner-corner scanner-corner-bl" />
      <div className="scanner-corner scanner-corner-br" />

      {label ? (
        <div className="absolute left-1/2 top-[calc(100%+14px)] -translate-x-1/2 rounded-full bg-black/55 px-3 py-1.5 text-[11px] font-extrabold uppercase tracking-[0.16em] text-white/88 ring-1 ring-white/12 backdrop-blur-md">
          {label}
        </div>
      ) : null}
      <div className="absolute left-1/2 top-[calc(100%+48px)] w-[min(240px,70vw)] -translate-x-1/2 rounded-full bg-black/45 p-1.5 ring-1 ring-white/12 backdrop-blur-md">
        <div className="h-1.5 overflow-hidden rounded-full bg-white/14">
          <div
            className={cx(
              "h-full rounded-full transition-[width,background-color] duration-200",
              isLocked ? "bg-[var(--ds-ok)]" : "bg-[var(--ds-accent)]",
            )}
            style={{ width: `${Math.round(safeProgress * 100)}%` }}
          />
        </div>
      </div>
    </div>
  );
}
