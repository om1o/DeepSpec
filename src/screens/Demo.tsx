import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { BrandLockup } from "../components/BrandLockup";
import "./demo.css";

const STORAGE_KEY = "deepspec.demo.saved-samples.v1";
const samples = [
  {
    id: "rotor",
    name: "Brake rotor",
    image: "/demo/brake-rotor.webp",
    alt: "A brake rotor on a workshop bench",
    title: "Likely a ventilated brake rotor",
    summary: "The circular friction surface and centre hub are consistent with a brake rotor. This component works with the brake pads to slow the wheel.",
    evidence: ["Circular friction surface", "Centre hub and bolt holes", "A closer view of the rotor edge"],
    uncertainty: "Fitment and serviceability are unconfirmed. Check the part number, vehicle details and measured thickness with a qualified mechanic.",
    answers: [
      "Brake pads clamp the rotor to turn the wheel’s movement into heat. The rotor and pads work together as part of the braking system.",
      "Look for a stamped part number and minimum-thickness marking. Match them to the vehicle and manufacturer’s specification; a photo cannot confirm fitment or safe wear limits.",
      "Ask whether the measured thickness, surface condition and runout meet the manufacturer’s limits, and whether the pads need attention too.",
    ],
  },
  {
    id: "engine",
    name: "Engine bay",
    image: "/test-fixtures/engine-scan-test.jpg",
    alt: "An example engine bay photographed from above",
    title: "An engine-bay overview",
    summary: "This wider view provides useful context. A close, well-lit photo of one component and its markings would help narrow an identification.",
    evidence: ["Multiple components in one frame", "Engine cover and nearby connections", "Part markings need a closer photo"],
    uncertainty: "This example does not identify a vehicle model or diagnose a fault. Capture the specific component and confirm its markings before your next step.",
    answers: [
      "The engine bay contains the engine and supporting systems. Choose one component for a closer look rather than treating every visible part as one identification.",
      "With the vehicle safely parked and the engine off and cool, photograph the component’s label, connectors and surrounding context. Avoid moving or hot parts.",
      "Bring the component’s markings, vehicle details and any symptoms. Ask what checks are needed before deciding whether a part needs repair or replacement.",
    ],
  },
] as const;
const questions = ["What does it do?", "Which details should I check?", "What should I ask a mechanic?"];
type SampleId = (typeof samples)[number]["id"];
type Phase = "ready" | "scanning" | "reviewing" | "review";

function readSaved(): SampleId[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(value) ? samples.filter((sample) => value.includes(sample.id)).map((sample) => sample.id) : [];
  } catch {
    return [];
  }
}

function Arrow() {
  return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

/** An isolated, authored example. It never reads or changes account scan data. */
export default function Demo() {
  const [selected, setSelected] = useState<SampleId>("rotor");
  const [phase, setPhase] = useState<Phase>("ready");
  const [view, setView] = useState<"scan" | "saved">("scan");
  const [saved, setSaved] = useState(readSaved);
  const [question, setQuestion] = useState<number | null>(null);
  const [notice, setNotice] = useState("");
  const sample = samples.find((item) => item.id === selected) ?? samples[0];
  const running = phase === "scanning" || phase === "reviewing";

  useEffect(() => {
    if (!running) return;
    const timer = window.setTimeout(() => setPhase(phase === "scanning" ? "reviewing" : "review"), phase === "scanning" ? 1600 : 600);
    return () => window.clearTimeout(timer);
  }, [phase, running]);

  function choose(id: SampleId, showReview = false) {
    setSelected(id);
    setPhase(showReview ? "review" : "ready");
    setQuestion(null);
    setNotice("");
    setView("scan");
  }

  function scan() {
    setQuestion(null);
    setNotice("");
    setPhase("scanning");
  }

  function save() {
    const next = saved.includes(selected) ? saved : [...saved, selected];
    setSaved(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      setNotice("Example saved on this browser.");
    } catch {
      setNotice("Saved for this visit. This browser is not allowing storage.");
    }
  }

  function reset() {
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* Session-only demo state still resets. */ }
    setSaved([]);
    choose("rotor");
    setNotice("Demo reset. Your account scans are untouched.");
  }

  const status = phase === "scanning" ? "Scanning sample…" : phase === "reviewing" ? "Preparing example review…" : phase === "review" ? "Example review ready" : "Ready when you are";

  return (
    <main className="ds-demo">
      <header className="demo-header">
        <Link to="/demo" aria-label="DeepSpec demo home" onClick={() => choose("rotor")}><BrandLockup size="md" /></Link>
        <span className="demo-mode"><span aria-hidden="true" />Demo · no account needed</span>
        <Link className="demo-signin" to="/auth">Sign in<Arrow /></Link>
      </header>

      <div className="demo-content">
        <div className="demo-intro">
          <div><p className="demo-eyebrow">YOUR SAMPLE WORKBENCH</p><h1>Take a closer look.</h1><p>Try a scan, explore an example review, and save it here.</p></div>
          <button type="button" className="demo-reset" onClick={reset}>Reset demo</button>
        </div>
        <div className="demo-toolbar">
          <nav aria-label="Demo views">
            <button type="button" aria-pressed={view === "scan"} onClick={() => setView("scan")}>Scanner</button>
            <button type="button" aria-pressed={view === "saved"} onClick={() => { setView("saved"); setPhase("ready"); }}>Saved examples <span>{saved.length}</span></button>
          </nav>
          <p>Sample images · predetermined answers</p>
        </div>

        {view === "saved" ? (
          <section className="demo-saved" aria-labelledby="demo-saved-title">
            <h2 id="demo-saved-title">Your saved examples</h2>
            <p>Stored only in this browser, separate from your account.</p>
            {saved.length ? <div className="demo-saved-grid">{samples.filter((item) => saved.includes(item.id)).map((item) => (
              <button className="demo-saved-card" type="button" key={item.id} aria-label={`Open ${item.name} example review`} onClick={() => choose(item.id, true)}><img src={item.image} alt="" /><span><small>EXAMPLE REVIEW</small><strong>{item.name}</strong><span>Open review <Arrow /></span></span></button>
            ))}</div> : <div className="demo-empty"><span aria-hidden="true">⌑</span><h3>A useful discovery starts here.</h3><p>Run a sample scan and save its review to try this view.</p><button type="button" className="demo-primary" onClick={() => setView("scan")}>Try a sample<Arrow /></button></div>}
          </section>
        ) : (
          <div className="demo-workbench">
            <section className="demo-scanner" aria-labelledby="demo-scanner-title">
              <div className="demo-panel-heading"><h2 id="demo-scanner-title">Choose a sample</h2><span>01 / SCAN</span></div>
              <div className="demo-samples" aria-label="Sample images">{samples.map((item) => <button type="button" key={item.id} aria-pressed={item.id === selected} disabled={running} onClick={() => choose(item.id)}><img src={item.image} alt="" /><span>{item.name}</span><span className="demo-selection" aria-hidden="true">{item.id === selected ? "✓" : ""}</span></button>)}</div>
              <div className={`demo-camera${running ? " is-running" : ""}${phase === "review" ? " is-reviewed" : ""}`}>
                <img className="demo-sample-photo" src={sample.image} alt={sample.alt} />
                <span className="demo-photo-label">SAMPLE IMAGE</span>
                <div className="demo-focus" aria-hidden="true"><i /><i /><i /><i /></div>
                <div className="demo-scan-range" aria-hidden="true"><div className="demo-scan-beam" /></div>
                <div className="demo-camera-caption"><span className="demo-status-dot" aria-hidden="true" />{phase === "review" ? "Sample captured" : sample.name}</div>
              </div>
              <div className="demo-scan-footer"><div className="demo-scan-message"><p role="status">{status}</p>{phase === "review" && <a className="demo-review-jump" href="#demo-result-title">View review below <span aria-hidden="true">↓</span></a>}</div><button type="button" className="demo-primary" disabled={running} onClick={scan}>{running ? "Scanning sample…" : phase === "review" ? "Scan again" : "Scan sample"}{!running && <Arrow />}</button></div>
            </section>

            <section className={`demo-result${phase === "review" ? " has-review" : ""}`} aria-labelledby="demo-result-title" aria-busy={running}>
              <div className="demo-panel-heading"><h2 id="demo-result-title">Your review</h2><span>02 / EXPLORE</span></div>
              {phase !== "review" ? <div className="demo-result-empty"><div className={`demo-result-symbol${running ? " is-working" : ""}`} aria-hidden="true"><BrandLockup variant="mark" /></div><h3>{running ? "Looking a little closer." : "From a photo to a starting point."}</h3><p>{running ? "The scan will reveal an authored example so you can explore the experience." : "Choose a sample and scan it to see the review, supporting details, and follow-up questions."}</p><span className="demo-example-note">This demo uses predetermined examples.</span></div> : <div className="demo-review-body" key={sample.id}>
                <p className="demo-example-label">EXAMPLE REVIEW · PREDETERMINED</p><h3>{sample.title}</h3><p className="demo-summary">{sample.summary}</p>
                <div className="demo-evidence"><h4>Details to look for</h4><ul>{sample.evidence.map((item) => <li key={item}><span aria-hidden="true">✓</span>{item}</li>)}</ul></div>
                <div className="demo-uncertainty"><h4>Still needs confirmation</h4><p>{sample.uncertainty}</p></div>
                <button type="button" className="demo-save" onClick={save} disabled={saved.includes(selected)}>{saved.includes(selected) ? "✓ Example saved" : "Save example"}<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M7 4h10v16l-5-3-5 3V4Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /></svg></button>
                <div className="demo-followup"><h4>Keep exploring</h4><div className="demo-questions">{questions.map((item, index) => <button type="button" key={item} aria-pressed={question === index} onClick={() => setQuestion(index)}>{item}<Arrow /></button>)}</div>{question !== null && <div className="demo-answer" key={question} role="status"><small>EXAMPLE ANSWER</small><p>{sample.answers[question]}</p></div>}</div>
              </div>}
            </section>
          </div>
        )}
        <p className="demo-notice" role="status">{notice}</p>
        <footer className="demo-footer"><p>Explore with sample images. Sign in to scan your own parts.</p><Link to="/auth">Open your workspace <Arrow /></Link></footer>
      </div>
    </main>
  );
}
