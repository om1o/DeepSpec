// Deep Spec — Scanner screen
// Fullscreen viewfinder, header, reticle, fixed Identify CTA.

const { useState: useStateScanner, useEffect: useEffectScanner } = React;

function ScannerScreen({ go }) {
  // Mock the "stillness detected" beat — after 1.4s, mark the device steady.
  const [isStable, setIsStable] = useStateScanner(false);
  const [isAnalyzing, setIsAnalyzing] = useStateScanner(false);

  useEffectScanner(() => {
    const t = setTimeout(() => setIsStable(true), 1400);
    return () => clearTimeout(t);
  }, []);

  function handleIdentify() {
    setIsAnalyzing(true);
    setTimeout(() => {
      setIsAnalyzing(false);
      go("/result/demo");
    }, 1200);
  }

  return (
    <main className="relative h-full w-full overflow-hidden bg-[#0A0A0A] text-white">
      <FakeCameraFeed />
      <CameraScrim />

      {/* Header */}
      <header
        className="absolute left-0 right-0 z-20 px-5"
        style={{ top: "max(18px, env(safe-area-inset-top))" }}
      >
        <div className="flex items-center justify-between gap-3">
          <p className="text-[13px] font-extrabold uppercase tracking-[0.18em] text-white/92">Deep Spec</p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => go("/early-access")}
              className="rounded-full bg-black/35 px-3 py-2 text-xs font-extrabold text-white/82 backdrop-blur-md"
            >
              Join
            </button>
            <button
              onClick={() => go("/history")}
              className="rounded-full bg-black/35 px-3 py-2 text-xs font-extrabold text-white/82 backdrop-blur-md"
            >
              Saved
            </button>
          </div>
        </div>
        <p className="mt-2 text-sm font-medium text-white/68">
          {isStable ? "Hold steady and scan the part" : "Point at a car part and hold steady"}
        </p>
      </header>

      <Reticle isVisible={isStable} />

      {/* Identify button (fixed bottom) */}
      <div
        className={
          "absolute inset-x-0 z-20 px-4 transition duration-300 " +
          (isStable ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0")
        }
        style={{ bottom: "max(24px, env(safe-area-inset-bottom))" }}
      >
        <Button
          className="h-14 w-full text-base"
          disabled={!isStable || isAnalyzing}
          onClick={handleIdentify}
        >
          Identify
        </Button>
      </div>

      {/* Analyzing overlay */}
      {isAnalyzing && (
        <div className="absolute inset-0 z-40 grid place-items-center bg-black/70 backdrop-blur-md">
          <div className="rounded-full border border-white/10 bg-white/10 px-5 py-3 text-sm font-bold text-white shadow-2xl">
            Analyzing photo...
          </div>
        </div>
      )}
    </main>
  );
}

Object.assign(window, { ScannerScreen });
