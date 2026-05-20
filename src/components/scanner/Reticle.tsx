import { cx } from "../../lib/utils";
import type { CameraObjectTarget } from "../../hooks/useObjectTarget";

type ReticleProps = {
  isVisible: boolean;
  target: CameraObjectTarget | null;
};

export default function Reticle({ isVisible, target }: ReticleProps) {
  if (!target) {
    return null;
  }

  return (
    <div
      aria-hidden="true"
      data-testid="object-reticle"
      style={{
        height: target.height,
        left: target.left,
        top: target.top,
        width: target.width,
      }}
      className={cx(
        "pointer-events-none fixed z-10 transition-[height,left,opacity,top,width] duration-200",
        isVisible ? "opacity-100" : "opacity-0",
      )}
    >
      <div className="absolute inset-0 rounded-[18px] border border-dashed border-[#FACC15]/45 shadow-[0_0_20px_rgba(250,204,21,0.30)]" />
      <div className="scanner-sweep" />
      <div className="scanner-corner scanner-corner-tl" />
      <div className="scanner-corner scanner-corner-tr" />
      <div className="scanner-corner scanner-corner-bl" />
      <div className="scanner-corner scanner-corner-br" />
      {isVisible ? (
        <div className="absolute left-1/2 top-[calc(100%+14px)] w-[min(220px,70vw)] -translate-x-1/2 rounded-full bg-black/58 p-1 backdrop-blur-md">
          <div className="h-1.5 overflow-hidden rounded-full bg-white/12">
            <div
              className="h-full rounded-full bg-[#FACC15] transition-[width] duration-200"
              style={{ width: `${Math.round(target.holdProgress * 100)}%` }}
            />
          </div>
          <p className="mt-1.5 text-center text-[11px] font-extrabold uppercase tracking-[0.12em] text-[#FACC15]">
            {target.isLocked ? "Capturing" : "Hold still"}
          </p>
        </div>
      ) : null}
    </div>
  );
}
