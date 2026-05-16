import { Link, useLocation } from "react-router-dom";
import Button from "../components/ui/Button";
import { readLatestCapturedFrame, readLatestScanState } from "../lib/utils";
import type { CapturedFrame, Confidence, IdentificationResult, ScanAnalysisState } from "../types";

export default function Result() {
  const location = useLocation();
  const scanState = getScanState(location.state);
  const frame = scanState?.frame ?? readLatestCapturedFrame();
  const capturedAt = frame?.capturedAt ? new Date(frame.capturedAt).toLocaleString() : null;

  return (
    <main className="min-h-dvh bg-[#0A0A0A] px-4 pb-8 pt-[max(18px,env(safe-area-inset-top))] text-white">
      <div className="mx-auto flex min-h-[calc(100dvh-48px)] w-full max-w-md flex-col">
        <header className="mb-5 flex items-center justify-between">
          <div>
            <p className="text-[13px] font-extrabold uppercase tracking-[0.18em] text-white/70">Deep Spec</p>
            <h1 className="mt-2 text-2xl font-extrabold tracking-tight">
              {scanState?.result ? scanState.result.partName : "Captured frame"}
            </h1>
          </div>
          <Link to="/" className="rounded-full bg-white/10 px-4 py-2 text-sm font-bold text-white">
            Back
          </Link>
        </header>

        {frame?.imageBase64 ? (
          <img
            alt="Captured car part"
            className="aspect-[3/4] w-full rounded-[24px] border border-white/10 bg-black object-contain shadow-2xl"
            src={frame.imageBase64}
          />
        ) : (
          <div className="grid aspect-[3/4] w-full place-items-center rounded-[24px] border border-dashed border-white/15 bg-[#171717] px-8 text-center text-sm text-[#A1A1AA]">
            No captured frame yet.
          </div>
        )}

        <div className="mt-5 space-y-4">
          {scanState?.result ? <AnalysisResult result={scanState.result} capturedAt={capturedAt} /> : null}
          {scanState?.errorMessage ? <AnalysisError message={scanState.errorMessage} capturedAt={capturedAt} /> : null}
          {!scanState?.result && !scanState?.errorMessage ? <NotAnalyzed capturedAt={capturedAt} /> : null}
        </div>

        <Button className="mt-6 w-full" onClick={() => window.location.assign("/")}>
          Try another scan
        </Button>
      </div>
    </main>
  );
}

function AnalysisResult({ capturedAt, result }: { capturedAt: string | null; result: IdentificationResult }) {
  const showSafetyWarning = result.isSafetyCritical || result.safetyTriage === "needs_professional";

  return (
    <>
      <section className="rounded-[24px] border border-white/10 bg-[#171717] p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-bold text-[#FACC15]">AI identification</p>
            <h2 className="mt-2 text-xl font-extrabold tracking-tight">{result.partName}</h2>
          </div>
          <ConfidenceBadge confidence={result.confidence} />
        </div>
        {capturedAt ? <p className="mt-3 text-xs font-semibold text-white/42">Captured {capturedAt}</p> : null}
      </section>

      {showSafetyWarning ? (
        <section className="rounded-[24px] border border-[#F59E0B]/30 bg-[#F59E0B]/10 p-5">
          <p className="text-sm font-extrabold text-[#FACC15]">Safety-critical</p>
          <p className="mt-2 text-sm leading-6 text-white/82">
            Verify this with a mechanic before driving or attempting repair. Deep Spec can explain what is visible, but this category needs professional confirmation.
          </p>
        </section>
      ) : null}

      {result.needsBetterPhoto || result.safetyTriage === "needs_better_photo" ? (
        <section className="rounded-[24px] border border-white/10 bg-white/[0.06] p-5">
          <p className="text-sm font-extrabold text-white">Better photo needed</p>
          <p className="mt-2 text-sm leading-6 text-[#A1A1AA]">
            Move closer, add light, and center any label, connector, hose, or damaged area in the yellow reticle.
          </p>
        </section>
      ) : null}

      <ResultSection title="What it does" items={[result.whatItDoes]} />
      <ResultSection title="What I see" items={result.visibleObservations} emptyText="No clear visual clues were returned." />
      <ResultSection title="Concerns" items={result.concerns} emptyText="Nothing concerning visible." />
      <ResultSection title="Why Deep Spec thinks this" items={result.evidence} emptyText="No evidence returned." />
      <ResultSection title="Next action" items={[result.nextAction]} />
    </>
  );
}

function AnalysisError({ capturedAt, message }: { capturedAt: string | null; message: string }) {
  return (
    <section className="rounded-[24px] border border-[#EF4444]/30 bg-[#EF4444]/10 p-5">
      <p className="text-sm font-bold text-[#FCA5A5]">AI identification failed</p>
      <h2 className="mt-2 text-xl font-extrabold tracking-tight">Keep the photo and try again</h2>
      <p className="mt-3 text-sm leading-6 text-white/78">{message}</p>
      {capturedAt ? <p className="mt-3 text-xs font-semibold text-white/42">Captured {capturedAt}</p> : null}
    </section>
  );
}

function NotAnalyzed({ capturedAt }: { capturedAt: string | null }) {
  return (
    <section className="rounded-[24px] border border-white/10 bg-[#171717] p-5">
      <p className="text-sm font-bold text-[#FACC15]">Not analyzed yet</p>
      <h2 className="mt-2 text-xl font-extrabold tracking-tight">Scan again to identify this</h2>
      <p className="mt-3 text-sm leading-6 text-[#A1A1AA]">
        Deep Spec has the captured frame, but no AI result is attached to this screen.
      </p>
      {capturedAt ? <p className="mt-3 text-xs font-semibold text-white/42">Captured {capturedAt}</p> : null}
    </section>
  );
}

function ResultSection({
  emptyText,
  items,
  title,
}: {
  emptyText?: string;
  items: string[];
  title: string;
}) {
  const visibleItems = items.filter(Boolean);

  return (
    <section className="rounded-[24px] border border-white/10 bg-[#171717] p-5">
      <h2 className="text-sm font-extrabold uppercase tracking-[0.14em] text-white/62">{title}</h2>
      {visibleItems.length > 0 ? (
        <ul className="mt-3 space-y-2 text-sm leading-6 text-[#E5E7EB]">
          {visibleItems.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm leading-6 text-[#A1A1AA]">{emptyText}</p>
      )}
    </section>
  );
}

function ConfidenceBadge({ confidence }: { confidence: Confidence }) {
  const styles = {
    high: "bg-[#10B981]/15 text-[#6EE7B7] border-[#10B981]/30",
    medium: "bg-[#F59E0B]/15 text-[#FCD34D] border-[#F59E0B]/30",
    low: "bg-[#EF4444]/15 text-[#FCA5A5] border-[#EF4444]/30",
  };

  return (
    <span className={`shrink-0 rounded-full border px-3 py-1 text-xs font-extrabold capitalize ${styles[confidence]}`}>
      {confidence}
    </span>
  );
}

function getScanState(state: unknown): ScanAnalysisState | null {
  if (isScanAnalysisState(state)) {
    return state;
  }

  if (isCapturedFrame(state)) {
    return { frame: state };
  }

  return readLatestScanState();
}

function isScanAnalysisState(value: unknown): value is ScanAnalysisState {
  return (
    typeof value === "object" &&
    value !== null &&
    "frame" in value &&
    isCapturedFrame(value.frame)
  );
}

function isCapturedFrame(value: unknown): value is CapturedFrame {
  return (
    typeof value === "object" &&
    value !== null &&
    "imageBase64" in value &&
    "capturedAt" in value &&
    typeof value.imageBase64 === "string" &&
    typeof value.capturedAt === "string"
  );
}
