// Deep Spec UI Kit — App shell
// Hash-based screen switcher inside an iPhone-15 frame.

const { useState: useAppState, useEffect: useAppEffect } = React;

function parseRoute(hash) {
  const h = (hash || "").replace(/^#/, "") || "/";
  if (h === "/" || h === "")              return "scanner";
  if (h === "/chat" || h.endsWith("/chat")) return "chat";
  if (h.startsWith("/result"))             return "result";
  if (h === "/history")                    return "history";
  if (h === "/early-access")               return "early-access";
  return "scanner";
}

const SCREEN_LABELS = {
  scanner:        "01 Scanner",
  result:         "02 Result",
  history:        "03 Saved scans",
  chat:           "04 Chat",
  "early-access": "05 Early access",
};

function App() {
  const [route, setRoute] = useAppState(parseRoute(window.location.hash));

  useAppEffect(() => {
    const onHash = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  function go(path) {
    if (path.startsWith("/result/") && path.endsWith("/chat") === false) {
      window.location.hash = path;
    } else {
      window.location.hash = path;
    }
  }

  let screen = null;
  if (route === "scanner")             screen = <ScannerScreen go={go} />;
  else if (route === "result")         screen = <ResultScreen go={go} />;
  else if (route === "history")        screen = <HistoryScreen go={go} />;
  else if (route === "chat")           screen = <ChatScreen go={go} />;
  else if (route === "early-access")   screen = <EarlyAccessScreen go={go} />;

  const isFullscreen = route === "scanner";

  return (
    <div className="min-h-dvh w-full grid place-items-center py-10 px-4 text-white" style={{ background: "#050505" }}>
      <div className="w-full max-w-sm">
        {/* Top label + nav strip */}
        <div className="mb-6 flex flex-col items-center gap-3">
          <div className="text-[10.5px] font-extrabold tracking-[0.22em] uppercase" style={{ color: "#FACC15" }}>
            Deep Spec · scanner PWA · UI kit
          </div>
          <div className="ds-toggle" key={"tab-toggle-" + route}>
            {[
              { k: "scanner",       p: "/",              l: "Scan" },
              { k: "result",        p: "/result/demo",   l: "Result" },
              { k: "history",       p: "/history",       l: "Saved" },
              { k: "chat",          p: "/chat",          l: "Chat" },
              { k: "early-access",  p: "/early-access",  l: "Join" },
            ].map((tab) => {
              const isActive = route === tab.k;
              const pillStyle = isActive
                ? { padding: "0 12px", height: 32, borderRadius: 9999, fontSize: 11, fontWeight: 800, fontFamily: "inherit", border: 0, cursor: "pointer", backgroundColor: "#FFFFFF", color: "#0A0A0A", boxShadow: "0 6px 18px rgba(255,255,255,0.18)" }
                : { padding: "0 12px", height: 32, borderRadius: 9999, fontSize: 11, fontWeight: 800, fontFamily: "inherit", border: 0, cursor: "pointer", backgroundColor: "transparent", color: "rgba(255,255,255,0.70)", boxShadow: "none" };
              return (
                <button
                  key={tab.k + "-" + (isActive ? "on" : "off")}
                  type="button"
                  onClick={() => go(tab.p)}
                  style={pillStyle}
                >
                  {tab.l}
                </button>
              );
            })}
          </div>
        </div>

        {/* iPhone-15 frame */}
        <div className="relative mx-auto" style={{ width: 390, maxWidth: "100%" }}>
          <div
            className="relative rounded-[54px] p-[10px] bg-black"
            style={{
              boxShadow: "0 30px 80px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.06), 0 1px 0 rgba(255,255,255,0.10) inset",
            }}
          >
            <div
              className="relative overflow-hidden rounded-[44px] bg-[#0A0A0A]"
              style={{ width: "100%", aspectRatio: "390 / 844" }}
              data-screen-label={SCREEN_LABELS[route]}
            >
              {/* Faux iOS status bar */}
              <div className="absolute top-0 left-0 right-0 z-50 h-[14px] pointer-events-none">
                <div className="absolute top-1.5 left-6 text-[10.5px] font-bold text-white/90">9:41</div>
                <div className="absolute top-2 left-1/2 -translate-x-1/2 w-24 h-6 rounded-full bg-black" />
                <div className="absolute top-1.5 right-6 text-[10px] font-bold text-white/90">●●●●</div>
              </div>

              {/* Scrollable screen body */}
              <div className={"absolute inset-0 " + (isFullscreen ? "overflow-hidden" : "overflow-y-auto")}>
                {screen}
              </div>
            </div>
          </div>
        </div>

        <p className="mt-6 text-center text-[11px] font-medium text-white/45 max-w-sm mx-auto leading-relaxed">
          Click any pill above to flip screens. Built from the live <span className="font-bold text-white/70">om1o/DeepSpec</span> source — every class, copy string and component shape is lifted, not invented.
        </p>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
