// Deep Spec — Reticle. A pure-CSS scanner viewfinder shape.

function ReticleCorner({ pos }) {
  const map = {
    tl: "top-0 left-0 border-t-[3px] border-l-[3px] rounded-tl-[18px]",
    tr: "top-0 right-0 border-t-[3px] border-r-[3px] rounded-tr-[18px]",
    bl: "bottom-0 left-0 border-b-[3px] border-l-[3px] rounded-bl-[18px]",
    br: "right-0 bottom-0 border-r-[3px] border-b-[3px] rounded-br-[18px]",
  };
  return (
    <div
      className={`absolute w-6 h-6 ${map[pos]}`}
      style={{
        borderColor: "rgba(250,204,21,0.88)",
        filter: "drop-shadow(0 0 8px rgba(250,204,21,0.42))",
      }}
    />
  );
}

function Reticle({ isVisible = true }) {
  return (
    <div
      className={
        "pointer-events-none absolute left-1/2 z-10 aspect-[4/3] w-[70%] max-w-[360px] " +
        "-translate-x-1/2 -translate-y-1/2 transition-opacity duration-300 " +
        (isVisible ? "opacity-100" : "opacity-0")
      }
      style={{ top: "45%" }}
      aria-hidden="true"
    >
      <div className="absolute inset-0 rounded-[18px] border border-dashed border-[#FACC15]/45 shadow-[0_0_20px_rgba(250,204,21,0.3)]" />
      <ReticleCorner pos="tl" />
      <ReticleCorner pos="tr" />
      <ReticleCorner pos="bl" />
      <ReticleCorner pos="br" />
      {isVisible && (
        <p className="absolute left-1/2 top-[calc(100%+18px)] w-max -translate-x-1/2 rounded-full bg-black/50 px-3 py-2 text-xs font-semibold text-[#FACC15] backdrop-blur-md">
          Tap Identify when ready
        </p>
      )}
    </div>
  );
}

function CameraScrim() {
  return (
    <div
      className="pointer-events-none absolute inset-0"
      style={{
        background:
          "linear-gradient(to bottom, rgba(0,0,0,0.52), rgba(0,0,0,0) 28%, rgba(0,0,0,0) 62%, rgba(0,0,0,0.62))",
      }}
    />
  );
}

function FakeCameraFeed() {
  // Stand-in for the live camera — moody engine-bay gradient
  return (
    <div
      className="absolute inset-0"
      style={{
        background: `
          radial-gradient(140% 70% at 18% 18%, rgba(70,70,70,0.55) 0%, rgba(20,20,20,0) 55%),
          radial-gradient(120% 80% at 82% 70%, rgba(40,40,40,0.50) 0%, rgba(10,10,10,0) 60%),
          radial-gradient(60% 40% at 50% 50%, rgba(58,52,40,0.45) 0%, rgba(28,28,30,0) 70%),
          linear-gradient(165deg, #1C1C1E 0%, #0F0F10 60%, #0A0A0A 100%)
        `,
      }}
    />
  );
}

Object.assign(window, { Reticle, ReticleCorner, CameraScrim, FakeCameraFeed });
