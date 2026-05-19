import { cx } from "../../lib/utils";

type ReticleProps = {
  isVisible: boolean;
};

export default function Reticle({ isVisible }: ReticleProps) {
  return (
    <div
      className={cx(
        "pointer-events-none fixed left-1/2 top-[43vh] z-10 aspect-[4/3] w-[72vw] max-w-[380px] -translate-x-1/2 -translate-y-1/2 transition-opacity duration-300",
        isVisible ? "opacity-100" : "opacity-0",
      )}
      aria-hidden="true"
    >
      <div className="absolute inset-0 rounded-[22px] border border-dashed border-[#FACC15]/38 shadow-[0_0_28px_rgba(250,204,21,0.32)]" />
      <div className="scanner-corner scanner-corner-tl" />
      <div className="scanner-corner scanner-corner-tr" />
      <div className="scanner-corner scanner-corner-bl" />
      <div className="scanner-corner scanner-corner-br" />
      {isVisible ? (
        <p className="scanner-helper absolute left-1/2 top-[calc(100%+18px)] w-max -translate-x-1/2 rounded-full bg-black/56 px-3 py-2 text-xs font-extrabold text-[#FACC15] ring-1 ring-[#FACC15]/20 backdrop-blur-md">
          Tap Identify when ready
        </p>
      ) : null}
    </div>
  );
}
