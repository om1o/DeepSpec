import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { useEffect, useState } from "react";
import { getAIErrorMessage, identifyCapturedFrame } from "../services/aiService";
import Button from "../components/ui/Button";
import { isTestMode } from "../lib/testMode";
import { readLatestCapturedFrame, readLatestScanState, saveLatestScanState } from "../lib/utils";
import { getCloudSyncStatus, syncLookupToCloud } from "../services/cloudSync";
import { buildScanReport, downloadTextFile, getMechanicSearchUrl, getScanReportFilename } from "../services/report";
import { deleteLookup, getLookup, scanStateFromLookup, updateLookup, updateLookupResult } from "../services/storage";
import type { CapturedFrame, Confidence, IdentificationResult, Lookup, Rating, ScanAnalysisState } from "../types";

export default function Result() {
  const location = useLocation();
  const navigate = useNavigate();
  const { id } = useParams();
  const [lookup, setLookup] = useState<Lookup | null>(() => (id ? getLookup(id) : null));
  const [liveScanState, setLiveScanState] = useState<ScanAnalysisState | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const scanState = lookup ? scanStateFromLookup(lookup) : liveScanState ?? getScanState(location.state);
  const frame = scanState?.frame ?? readLatestCapturedFrame();
  const capturedAt = frame?.capturedAt ? new Date(frame.capturedAt).toLocaleString() : null;
  const storageWarning = scanState?.storageWarning;
  const isQaTestRun = Boolean(scanState?.testRun);

  function handleRating(rating: Rating) {
    if (!lookup) {
      return;
    }

    const result = updateLookup(lookup.id, {
      rating,
      correction: rating === "down" ? lookup.correction : null,
    });
    handleLookupUpdate(result);
  }

  function handleCorrection(correction: string) {
    if (!lookup) {
      return;
    }

    handleLookupUpdate(updateLookup(lookup.id, { correction }));
  }

  function handleNotes(notes: string) {
    if (!lookup) {
      return;
    }

    handleLookupUpdate(updateLookup(lookup.id, { notes }));
  }

  function handleDelete() {
    if (!lookup) {
      return;
    }

    const result = deleteLookup(lookup.id);
    if (result.ok) {
      navigate("/history", { replace: true });
      return;
    }

    setSaveError(result.message);
  }

  function handleLookupUpdate(result: ReturnType<typeof updateLookup>) {
    if (result.ok) {
      setLookup(result.value);
      setSaveError(null);
      return;
    }

    setSaveError(result.message);
    if (result.value) {
      setLookup(result.value);
    }
  }

  return (
    <main className="min-h-dvh bg-[var(--ds-bg)] text-slate-950">
      <div className="mx-auto min-h-dvh w-full max-w-md bg-[var(--ds-page)]">
        <section className="relative min-h-[46dvh] overflow-hidden bg-[#020617] text-white">
          {frame?.imageBase64 ? (
            <img
              alt="Captured car part"
              className="absolute inset-0 h-full w-full object-contain"
              src={frame.imageBase64}
            />
          ) : (
            <div className="absolute inset-0 grid place-items-center bg-[#061522] px-8 text-center text-sm text-white/62">
              No captured frame yet.
            </div>
          )}
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_bottom,rgba(2,6,23,0.68),rgba(2,6,23,0.04)_38%,rgba(2,6,23,0.82))]" />
          <header className="absolute left-0 right-0 top-0 z-10 flex items-center justify-between px-4 pt-[max(18px,env(safe-area-inset-top))]">
            <img src="/brand/deepspec-logo.png" alt="Deep Spec" className="h-11 w-32 rounded-xl bg-white object-contain p-1 shadow-sm ring-1 ring-white/30" />
            <Link to="/scan" className="rounded-full bg-white/90 px-4 py-2 text-sm font-bold text-slate-800 shadow-sm ring-1 ring-white/40 backdrop-blur-md">
              Back
            </Link>
          </header>
          <div className="absolute bottom-8 left-0 right-0 z-10 px-4">
            <p className="text-xs font-extrabold uppercase tracking-[0.16em] text-[var(--ds-accent)]">Deep Spec result</p>
            <h1 className="mt-2 truncate text-3xl font-extrabold tracking-tight text-white">
              {scanState?.result ? scanState.result.partName : "Captured frame"}
            </h1>
            {scanState?.result ? (
              <p className="mt-2 text-sm font-semibold text-white/72">
                {scanState.result.confidence} confidence · {scanState.result.scanCategory}
              </p>
            ) : null}
          </div>
        </section>

        <div className="-mt-6 rounded-t-[32px] bg-[var(--ds-page)] px-4 pb-8 pt-5 shadow-[0_-18px_48px_rgba(2,6,23,0.18)]">
          <div className="space-y-4">
          {isQaTestRun ? <TestRunNotice label={scanState?.testVehicleLabel} /> : null}
          {!isQaTestRun && storageWarning ? <StorageWarning message={storageWarning} /> : null}
          {scanState?.result ? <AnalysisResult result={scanState.result} capturedAt={capturedAt} /> : null}
          {scanState?.errorMessage ? (
            <AnalysisError 
              message={scanState.errorMessage} 
              capturedAt={capturedAt} 
              frame={frame}
              lookup={lookup}
              onLookupRetrySuccess={setLookup}
              onScanRetrySuccess={(nextScanState) => {
                setLiveScanState(nextScanState);
                saveLatestScanState(nextScanState);
              }}
            />
          ) : null}
          {!scanState?.result && !scanState?.errorMessage ? <NotAnalyzed capturedAt={capturedAt} /> : null}
          {lookup ? (
            <SavedScanControls
              lookup={lookup}
              saveError={saveError}
              onCorrectionChange={handleCorrection}
              onDelete={handleDelete}
              onNotesChange={handleNotes}
              onRating={handleRating}
            />
          ) : null}
        </div>

        <Button className="mt-6 w-full" onClick={() => window.location.assign("/")}>
          Try another scan
        </Button>
        </div>
      </div>
    </main>
  );
}

function TestRunNotice({ label }: { label?: string }) {
  return (
    <section className="rounded-[24px] border border-[var(--ds-accent-line)] bg-[var(--ds-accent-soft)] p-5">
      <p className="text-sm font-bold text-[var(--ds-accent)]">QA test result</p>
      <p className="mt-2 text-sm leading-6 text-neutral-700">
        This scan used {label ?? "a generated test photo"} and was not saved to history, cloud sync, or training review.
      </p>
    </section>
  );
}

function StorageWarning({ message }: { message: string }) {
  return (
    <section className="rounded-[24px] border border-[var(--ds-warn-line)] bg-[var(--ds-warn-soft)] p-5">
      <p className="text-sm font-bold text-[var(--ds-warn-ink)]">Not saved locally</p>
      <p className="mt-2 text-sm leading-6 text-neutral-700">{message}</p>
    </section>
  );
}

function SavedScanControls({
  lookup,
  onCorrectionChange,
  onDelete,
  onNotesChange,
  onRating,
  saveError,
}: {
  lookup: Lookup;
  onCorrectionChange: (correction: string) => void;
  onDelete: () => void;
  onNotesChange: (notes: string) => void;
  onRating: (rating: Rating) => void;
  saveError: string | null;
}) {
  const [reportStatus, setReportStatus] = useState<string | null>(null);
  const [cloudStatusMessage, setCloudStatusMessage] = useState<string | null>(null);
  const [isSyncingCloud, setIsSyncingCloud] = useState(false);
  const cloudSync = getCloudSyncStatus();
  const needsProfessional = lookup.result?.isSafetyCritical || lookup.result?.safetyTriage === "needs_professional";

  async function handleShareReport() {
    const report = buildScanReport(lookup);
    try {
      if (navigator.share) {
        await navigator.share({
          title: `Deep Spec: ${lookup.trainingLabel}`,
          text: report,
        });
        setReportStatus("Report shared.");
        return;
      }

      await navigator.clipboard.writeText(report);
      setReportStatus("Report copied to clipboard.");
    } catch {
      setReportStatus("Could not share this report from this browser.");
    }
  }

  function handleDownloadReport() {
    downloadTextFile(getScanReportFilename(lookup), buildScanReport(lookup));
    setReportStatus("Report downloaded.");
  }

  async function handleCloudSync() {
    setIsSyncingCloud(true);
    setCloudStatusMessage("Syncing scan...");

    const result = await syncLookupToCloud(lookup);
    setCloudStatusMessage(result.message);
    setIsSyncingCloud(false);
  }

  return (
    <section className="rounded-[24px] border border-neutral-200 bg-white p-5">
      <p className="text-sm font-extrabold text-neutral-900">Saved scan</p>
      <p className="mt-2 text-sm leading-6 text-neutral-500">
        Your rating and correction stay on this device. This is the data moat for improving Deep Spec later.
      </p>
      <div className="mt-4 grid grid-cols-1 gap-3">
        <TrustRow label="Dataset category" value={lookup.scanCategory} />
        <TrustRow label="Training label" value={lookup.trainingLabel} />
        <TrustRow label="Review status" value={lookup.trainingStatus.replaceAll("_", " ")} />
      </div>

      {lookup.result ? (
        <div className="mt-4 grid grid-cols-1 gap-3">
          <Link
            className="block rounded-full bg-[var(--ds-accent)] px-5 py-3 text-center text-sm font-bold text-white shadow-sm"
            to={`/result/${lookup.id}/chat`}
          >
            Tell me more
          </Link>
          {needsProfessional ? (
            <a
              className="block rounded-full border border-[var(--ds-warn-line)] bg-[var(--ds-warn-soft)] px-5 py-3 text-center text-sm font-bold text-[var(--ds-warn-ink)]"
              href={getMechanicSearchUrl(lookup)}
              rel="noreferrer"
              target="_blank"
            >
              Find nearby options
            </a>
          ) : null}
        </div>
      ) : null}

      <div className="mt-4 grid grid-cols-2 gap-3">
        <Button
          className={lookup.rating === "up" ? "!bg-[var(--ds-ok)] !text-white shadow-none" : "!bg-neutral-100 !text-neutral-900 shadow-none"}
          onClick={() => onRating("up")}
        >
          Helpful
        </Button>
        <Button
          className={lookup.rating === "down" ? "!bg-[var(--ds-danger)] !text-white shadow-none" : "!bg-neutral-100 !text-neutral-900 shadow-none"}
          onClick={() => onRating("down")}
        >
          Wrong
        </Button>
      </div>

      {lookup.rating === "down" ? (
        <label className="mt-4 block">
          <span className="text-xs font-extrabold uppercase tracking-[0.14em] text-neutral-400">What was it actually?</span>
          <textarea
            className="mt-2 min-h-24 w-full resize-none rounded-2xl border border-neutral-200 bg-white p-3 text-sm leading-6 text-neutral-900 outline-none placeholder:text-neutral-400 focus:border-[var(--ds-accent)]"
            maxLength={240}
            onChange={(event) => onCorrectionChange(event.target.value)}
            placeholder="Example: coolant reservoir cap, not brake fluid cap"
            value={lookup.correction ?? ""}
          />
        </label>
      ) : null}

      <label className="mt-4 block">
        <span className="text-xs font-extrabold uppercase tracking-[0.14em] text-neutral-400">Private notes</span>
        <textarea
          className="mt-2 min-h-24 w-full resize-none rounded-2xl border border-neutral-200 bg-white p-3 text-sm leading-6 text-neutral-900 outline-none placeholder:text-neutral-400 focus:border-[var(--ds-accent)]"
          maxLength={500}
          onChange={(event) => onNotesChange(event.target.value)}
          placeholder="Optional: where the part was, symptoms, what you checked next"
          value={lookup.notes}
        />
      </label>

      {saveError ? <p className="mt-3 text-sm font-semibold text-[var(--ds-danger-ink)]">{saveError}</p> : null}

      <div className="mt-4 rounded-[20px] border border-neutral-200 bg-neutral-50 p-4">
        <p className="text-sm font-extrabold text-neutral-900">Cloud dataset sync</p>
        <p className="mt-2 text-sm leading-6 text-neutral-500">{cloudSync.message}</p>
        <Button
          className="mt-3 w-full !bg-neutral-100 !text-neutral-900 shadow-none"
          disabled={!cloudSync.configured || isSyncingCloud}
          onClick={handleCloudSync}
        >
          {isSyncingCloud ? "Syncing..." : "Sync this scan"}
        </Button>
        {cloudStatusMessage ? <p className="mt-3 text-sm font-semibold text-[var(--ds-accent)]">{cloudStatusMessage}</p> : null}
      </div>

      <div className="mt-4 rounded-[20px] border border-neutral-200 bg-neutral-50 p-4">
        <p className="text-sm font-extrabold text-neutral-900">Scan report</p>
        <p className="mt-2 text-sm leading-6 text-neutral-500">
          Export a plain-text summary for a mechanic, buyer, or your own records. This does not create a public link.
        </p>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <Button className="!bg-neutral-100 !text-neutral-900 shadow-none" onClick={handleShareReport}>
            Share
          </Button>
          <Button className="!bg-neutral-100 !text-neutral-900 shadow-none" onClick={handleDownloadReport}>
            Export
          </Button>
        </div>
        {reportStatus ? <p className="mt-3 text-sm font-semibold text-[var(--ds-accent)]">{reportStatus}</p> : null}
      </div>

      <Button className="mt-4 w-full border border-[var(--ds-danger-line)] !bg-[var(--ds-danger-soft)] !text-[var(--ds-danger)] shadow-none" onClick={onDelete}>
        Delete saved scan
      </Button>
    </section>
  );
}

function AnalysisResult({ capturedAt, result }: { capturedAt: string | null; result: IdentificationResult }) {
  const showSafetyWarning = result.isSafetyCritical || result.safetyTriage === "needs_professional";
  const trustReview = getTrustReview(result);

  return (
    <>
      <section className="rounded-[24px] border border-neutral-200 bg-white p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-bold text-[var(--ds-accent)]">AI identification</p>
            <h2 className="mt-2 text-xl font-extrabold tracking-tight">{result.partName}</h2>
          </div>
          <ConfidenceBadge confidence={result.confidence} />
        </div>
        {capturedAt ? <p className="mt-3 text-xs font-semibold text-neutral-400">Captured {capturedAt}</p> : null}
        <p className="mt-2 text-xs font-extrabold uppercase tracking-[0.14em] text-neutral-400">Dataset bucket: {result.scanCategory}</p>
      </section>

      <TrustReviewCard review={trustReview} />

      {showSafetyWarning ? (
        <section className="rounded-[24px] border border-[var(--ds-warn-line)] bg-[var(--ds-warn-soft)] p-5">
          <p className="text-sm font-extrabold text-[var(--ds-warn-ink)]">Safety-critical</p>
          <p className="mt-2 text-sm leading-6 text-neutral-700">
            Verify this with a mechanic before driving or attempting repair. Deep Spec can explain what is visible, but this category needs professional confirmation.
          </p>
        </section>
      ) : null}

      {result.needsBetterPhoto || result.safetyTriage === "needs_better_photo" ? (
        <section className="rounded-[24px] border border-neutral-200 bg-neutral-50 p-5">
          <p className="text-sm font-extrabold text-neutral-900">Better photo needed</p>
          <p className="mt-2 text-sm leading-6 text-neutral-500">
            Move closer, add light, and center any label, connector, hose, or damaged area in the lens frame.
          </p>
        </section>
      ) : null}

      <ResultSection title="What it does" items={[result.whatItDoes]} />
      <ResultSection title="What I see" items={result.visibleObservations} emptyText="No clear visual clues were returned." />
      <ResultSection title="Concerns" items={result.concerns} emptyText="Nothing concerning visible." />
      <EvidenceSection items={result.evidence} />
      <ResultSection title="Next action" items={[result.nextAction]} />
      <ReferenceLinksSection links={getReferenceLinks(result)} />
    </>
  );
}

type TrustReview = {
  borderClass: string;
  description: string;
  photoQuality: string;
  retakeGuidance: string;
  status: string;
};

function TrustReviewCard({ review }: { review: TrustReview }) {
  return (
    <section className={`rounded-[24px] border bg-white p-5 ${review.borderClass}`}>
      <p className="text-sm font-extrabold text-neutral-900">Trust check</p>
      <h2 className="mt-2 text-xl font-extrabold tracking-tight">{review.status}</h2>
      <p className="mt-3 text-sm leading-6 text-neutral-500">{review.description}</p>
      <div className="mt-4 grid grid-cols-1 gap-3">
        <TrustRow label="Photo quality" value={review.photoQuality} />
        <TrustRow label="Retake guidance" value={review.retakeGuidance} />
      </div>
    </section>
  );
}

function TrustRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-3">
      <p className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-neutral-400">{label}</p>
      <p className="mt-1 text-sm leading-6 text-neutral-700">{value}</p>
    </div>
  );
}

function EvidenceSection({ items }: { items: string[] }) {
  const visibleItems = items.filter(Boolean);

  return (
    <section className="rounded-[24px] border border-neutral-200 bg-white p-5">
      <h2 className="text-sm font-extrabold uppercase tracking-[0.14em] text-neutral-500">Why Deep Spec thinks this</h2>
      {visibleItems.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {visibleItems.map((item) => (
            <span key={item} className="rounded-full border border-[var(--ds-evidence-line)] bg-[var(--ds-evidence-soft)] px-3 py-2 text-xs font-semibold leading-5 text-[var(--ds-evidence-ink)]">
              {item}
            </span>
          ))}
        </div>
      ) : (
        <p className="mt-3 text-sm leading-6 text-neutral-500">No visual evidence returned. Treat this result as uncertain.</p>
      )}
    </section>
  );
}

type ReferenceLink = {
  label: string;
  url: string;
};

function ReferenceLinksSection({ links }: { links: ReferenceLink[] }) {
  return (
    <section className="rounded-[24px] border border-neutral-200 bg-white p-5">
      <h2 className="text-sm font-extrabold uppercase tracking-[0.14em] text-neutral-500">Reference links</h2>
      <div className="mt-3 grid grid-cols-1 gap-2">
        {links.map((link) => (
          <a
            key={link.url}
            className="rounded-2xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm font-bold text-[var(--ds-evidence-ink)]"
            href={link.url}
            rel="noreferrer"
            target="_blank"
          >
            {link.label}
          </a>
        ))}
      </div>
    </section>
  );
}

function AnalysisError({
  capturedAt,
  frame,
  lookup,
  message,
  onLookupRetrySuccess,
  onScanRetrySuccess,
}: {
  capturedAt: string | null;
  frame: CapturedFrame | null | undefined;
  lookup: Lookup | null;
  message: string;
  onLookupRetrySuccess: (updatedLookup: Lookup) => void;
  onScanRetrySuccess: (scanState: ScanAnalysisState) => void;
}) {
  const [isOnline, setIsOnline] = useState(() => typeof navigator !== "undefined" ? navigator.onLine : true);
  const [isRetrying, setIsRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  async function handleRetry() {
    const retryFrame = lookup?.frame ?? frame;
    if (!retryFrame || isRetrying) return;
    setIsRetrying(true);
    setRetryError(null);

    try {
      const result = await identifyCapturedFrame(retryFrame);
      if (lookup) {
        const updateResult = updateLookupResult(lookup.id, result);
        if (updateResult.ok) {
          if (updateResult.value) {
            onLookupRetrySuccess(updateResult.value);
          } else {
            setRetryError("This saved scan was not found.");
          }
        } else {
          setRetryError(updateResult.message);
        }
      } else {
        onScanRetrySuccess({
          frame: retryFrame,
          result,
          analyzedAt: new Date().toISOString(),
        });
      }
    } catch (err) {
      setRetryError(getAIErrorMessage(err));
    } finally {
      setIsRetrying(false);
    }
  }

  return (
    <section className="scanner-error-flash rounded-[24px] border border-[var(--ds-danger-line)] bg-[var(--ds-danger-soft)] p-5">
      <p className="text-sm font-bold text-[var(--ds-danger-ink)]">AI identification failed</p>
      <h2 className="mt-2 text-xl font-extrabold tracking-tight">Keep the photo and try again</h2>
      <p className="mt-3 text-sm leading-6 text-neutral-700">{message}</p>
      {capturedAt ? <p className="mt-3 text-xs font-semibold text-neutral-400">Captured {capturedAt}</p> : null}

      {frame ? (
        <div className="mt-4 border-t border-neutral-200 pt-4">
          <p className="text-xs font-semibold text-neutral-500">
            {isOnline ? "Internet connection is active." : "Offline. Find an internet connection to retry identification."}
          </p>
          <Button
            className="mt-3 w-full"
            disabled={!isOnline || isRetrying}
            onClick={handleRetry}
          >
            {isRetrying ? "Retrying..." : "Try again"}
          </Button>
          {retryError ? (
            <p className="mt-3 text-sm font-semibold text-[var(--ds-danger-ink)]">{retryError}</p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function NotAnalyzed({ capturedAt }: { capturedAt: string | null }) {
  return (
    <section className="rounded-[24px] border border-neutral-200 bg-white p-5">
      <p className="text-sm font-bold text-[var(--ds-accent)]">Not analyzed yet</p>
      <h2 className="mt-2 text-xl font-extrabold tracking-tight">Scan again to identify this</h2>
      <p className="mt-3 text-sm leading-6 text-neutral-500">
        Deep Spec has the captured frame, but no AI result is attached to this screen.
      </p>
      {capturedAt ? <p className="mt-3 text-xs font-semibold text-neutral-400">Captured {capturedAt}</p> : null}
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
    <section className="rounded-[24px] border border-neutral-200 bg-white p-5">
      <h2 className="text-sm font-extrabold uppercase tracking-[0.14em] text-neutral-500">{title}</h2>
      {visibleItems.length > 0 ? (
        <ul className="mt-3 space-y-2 text-sm leading-6 text-neutral-800">
          {visibleItems.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm leading-6 text-neutral-500">{emptyText}</p>
      )}
    </section>
  );
}

function ConfidenceBadge({ confidence }: { confidence: Confidence }) {
  const styles = {
    high: "bg-[var(--ds-ok-soft)] text-[var(--ds-ok-ink)] border-[var(--ds-ok-line)]",
    medium: "bg-[var(--ds-warn-soft)] text-[var(--ds-warn-ink)] border-[var(--ds-warn-line)]",
    low: "bg-[var(--ds-danger-soft)] text-[var(--ds-danger-ink)] border-[var(--ds-danger-line)]",
  };

  return (
    <span className={`shrink-0 rounded-full border px-3 py-1 text-xs font-extrabold capitalize ${styles[confidence]}`}>
      {confidence}
    </span>
  );
}

function getReferenceLinks(result: IdentificationResult): ReferenceLink[] {
  const partQuery = encodeURIComponent(`${result.partName} car part`);
  const repairQuery = encodeURIComponent(`${result.scanCategory} auto repair near me`);
  const links: ReferenceLink[] = [
    {
      label: "Search this part",
      url: `https://www.google.com/search?q=${partQuery}`,
    },
    {
      label: "NHTSA recalls",
      url: "https://www.nhtsa.gov/recalls",
    },
  ];

  for (const url of getDatasetSourceUrls(result.evidence)) {
    links.push({
      label: "Dataset source",
      url,
    });
  }

  if (result.safetyTriage === "needs_professional" || result.isSafetyCritical) {
    links.push({
      label: "Nearby repair options",
      url: `https://www.google.com/maps/search/${repairQuery}`,
    });
  }

  links.push({
    label: "Report a vehicle safety issue",
    url: "https://www.nhtsa.gov/report-a-safety-problem",
  });

  return links;
}

function getDatasetSourceUrls(evidence: string[]) {
  const urls = new Set<string>();

  for (const item of evidence) {
    const matches = item.match(/https:\/\/[^\s)]+/g) ?? [];
    for (const match of matches) {
      if (match.includes("huggingface.co/datasets/")) {
        urls.add(match);
      }
    }
  }

  return [...urls].slice(0, 3);
}

function getTrustReview(result: IdentificationResult): TrustReview {
  if (result.safetyTriage === "needs_professional" || result.isSafetyCritical) {
    return {
      borderClass: "border-[var(--ds-warn-line)]",
      description:
        "Deep Spec can explain the visible clues, but this category can affect driving safety. Do not treat this as repair approval.",
      photoQuality: result.confidence === "low" ? "Risk flagged and identification uncertain" : "Risk flagged",
      retakeGuidance: "Take another photo for your records, then verify with a mechanic before driving or repairing.",
      status: "Professional verification needed",
    };
  }

  if (result.safetyTriage === "needs_better_photo" || result.needsBetterPhoto) {
    return {
      borderClass: "border-[var(--ds-warn-line)]",
      description: "The image does not give Deep Spec enough reliable detail. A better photo matters more than another guess.",
      photoQuality: "Poor",
      retakeGuidance: "Move closer, add light, and center any label, connector, leak, crack, or damaged area in the lens frame.",
      status: "Incomplete data",
    };
  }

  if (result.confidence === "low") {
    return {
      borderClass: "border-[var(--ds-danger-line)]",
      description: "The app found some clues, but not enough to make a strong identification.",
      photoQuality: "Usable but weak",
      retakeGuidance: "Retake from a wider angle and one close-up of any label or connector.",
      status: "Low-confidence result",
    };
  }

  if (result.confidence === "medium") {
    return {
      borderClass: "border-[var(--ds-warn-line)]",
      description: "This is useful for understanding the part, but one more angle would make the result stronger.",
      photoQuality: "Usable",
      retakeGuidance: "Optional: capture the label, connector, mounting point, or nearby part context.",
      status: "Check another angle",
    };
  }

  return {
    borderClass: "border-[var(--ds-ok-line)]",
    description: "The image has enough visual evidence for a useful consumer-level explanation.",
    photoQuality: "Good",
    retakeGuidance: "Optional: take a close-up label photo if you need more certainty later.",
    status: "Useful match",
  };
}

function getScanState(state: unknown): ScanAnalysisState | null {
  if (isScanAnalysisState(state)) {
    return state;
  }

  if (isCapturedFrame(state)) {
    return { frame: state };
  }

  if (isTestMode()) {
    return null;
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
