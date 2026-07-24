import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import { getAIErrorDetails, getAIErrorMessage, identifyCapturedFrame } from "../services/aiService";
import Button from "../components/ui/Button";
import HistoryDockButton from "../components/ui/HistoryDockButton";
import { IsolatedPartView } from "../components/result/IsolatedPartView";
import { ScanDebugOverlay } from "../components/result/ScanDebugOverlay";
import { IssueLine, ResultDetailSections, SceneCategoryList } from "../components/result/PositiveAnswerCard";
import { getSimpleResultSummary } from "../lib/simpleResultSummary";
import { deriveIssue, getAnswerBody, getSceneChips } from "../lib/resultFacts";
import { readLatestCapturedFrame, readLatestScanState, saveLatestScanState } from "../lib/utils";
import { buildScanReport, downloadTextFile, getScanReportFilename } from "../services/report";
import { recordManualCorrection } from "../services/scanQualityMetrics";
import { getShopJob } from "../services/shop";
import { createLookup, getLookup, scanStateFromLookup, updateLookup, updateLookupResult } from "../services/storage";
import type { CapturedFrame, IdentificationResult, Lookup, Rating, ScanAnalysisState, ShopJob as ShopJobRecord } from "../types";

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
  const shopJob = scanState?.jobId ? getShopJob(scanState.jobId) : null;
  const canSaveForChat = Boolean(scanState?.frame && scanState.result);
  const datasetSourceUrls = scanState?.result ? getDatasetSourceUrls(scanState.result.evidence) : [];
  const simpleSummary = scanState?.result ? getSimpleResultSummary(scanState.result) : null;
  const manualCorrectionTrackedRef = useRef(false);

  function trackManualCorrectionOnce() {
    if (manualCorrectionTrackedRef.current) {
      return;
    }

    manualCorrectionTrackedRef.current = true;
    recordManualCorrection();
  }

  function handleRating(rating: Rating) {
    if (!lookup) {
      return;
    }

    if (rating === "down") {
      trackManualCorrectionOnce();
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

    if (correction.trim()) {
      trackManualCorrectionOnce();
    }

    handleLookupUpdate(updateLookup(lookup.id, { correction }));
  }


  function saveCurrentScan() {
    if (!scanState?.frame || !scanState.result) {
      return null;
    }

    const saved = createLookup({
      frame: scanState.frame,
      focusBox: scanState.focusBox,
      focusMode: scanState.focusMode,
      isolatedImageBase64: scanState.isolatedImageBase64,
      result: scanState.result,
      analyzedAt: scanState.analyzedAt ?? new Date().toISOString(),
      scanQuality: scanState.scanQuality,
      provenance: scanState.provenance,
      customerVisibleReport: scanState.customerVisibleReport,
      jobId: scanState.jobId,
      orgId: scanState.orgId,
      reviewStatus: scanState.reviewStatus,
      technicianUserId: scanState.technicianUserId,
      vehicleContext: scanState.vehicleContext,
    });

    if (!saved.ok) {
      setSaveError(saved.message);
      return null;
    }

    setLookup(saved.value);
    setSaveError(null);
    return saved.value;
  }

  function handleSaveOnly() {
    saveCurrentScan();
  }

  function handleSaveAndAsk(question?: string) {
    const saved = lookup ?? saveCurrentScan();
    if (!saved) {
      return;
    }

    const query = question ? `?q=${encodeURIComponent(question)}` : "";
    navigate(`/result/${saved.id}/chat${query}`);
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
      <div className="mx-auto grid min-h-dvh w-full max-w-6xl lg:grid-cols-[minmax(0,1fr)_430px] lg:p-4">
        <section className="relative min-h-[48dvh] overflow-hidden bg-[#020617] text-white lg:sticky lg:top-4 lg:min-h-[calc(100dvh-32px)] lg:rounded-[30px]">
          {frame?.imageBase64 ? (
            <IsolatedPartView
              frameBase64={frame.imageBase64}
              isolatedImageBase64={scanState?.isolatedImageBase64}
              focusBox={scanState?.focusBox}
              focusMode={scanState?.focusMode ?? "full_frame"}
              label={simpleSummary?.title ?? "Captured frame"}
              issue={scanState?.result ? deriveIssue(scanState.result) : null}
              sceneChips={scanState?.result ? getSceneChips(scanState.result) : undefined}
              objects={scanState?.isolatedObjects}
              variant="result"
            />
          ) : (
            <div className="absolute inset-0 grid place-items-center bg-[#061522] px-8 text-center text-sm text-white/62">
              No frame captured.
            </div>
          )}
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_bottom,rgba(2,6,23,0.58),rgba(2,6,23,0.02)_38%,rgba(2,6,23,0.76))]" />
          <header className="absolute left-0 right-0 top-0 z-10 flex items-center justify-between px-4 pt-[max(18px,env(safe-area-inset-top))]">
            <img src="/brand/deepspec-logo.webp" alt="Deep Spec" className="h-11 w-32 rounded-xl bg-white object-contain p-1 shadow-sm ring-1 ring-white/30" />
            <Link to="/scan" className="rounded-full bg-white/90 px-4 py-2 text-sm font-bold text-slate-800 shadow-sm ring-1 ring-white/40 backdrop-blur-md">
              Back
            </Link>
          </header>
          <div className="absolute bottom-8 left-0 right-0 z-10 px-4">
            <p className="text-xs font-extrabold uppercase tracking-[0.16em] text-[var(--ds-accent)]">Scanned photo</p>
            <h1 className="mt-2 truncate text-3xl font-extrabold tracking-tight text-white">
              {simpleSummary?.title ?? "Captured frame"}
            </h1>
            {simpleSummary ? (
              <p className="mt-2 max-w-xl text-sm font-semibold leading-6 text-white/76">
                {simpleSummary.body}
              </p>
            ) : null}
          </div>
        </section>

        <div className="relative z-10 -mt-7 rounded-t-[30px] bg-[var(--ds-page)] px-4 pb-8 pt-4 shadow-[0_-18px_48px_rgba(2,6,23,0.18)] lg:my-8 lg:-ml-10 lg:max-h-[calc(100dvh-64px)] lg:overflow-y-auto lg:rounded-[30px] lg:border lg:border-white/60 lg:shadow-[0_24px_70px_rgba(2,6,23,0.28)]">
          <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-slate-300 lg:hidden" />
          <div className="space-y-3">
          {storageWarning ? <StorageWarning message={storageWarning} /> : null}
          {!lookup && saveError ? <StorageWarning message={saveError} /> : null}
          {shopJob ? <ShopJobBanner job={shopJob} /> : null}
          {scanState?.result ? (
            <AnalysisResult
              result={scanState.result}
              capturedAt={capturedAt}
              canSaveForChat={canSaveForChat}
              lookupId={lookup?.id ?? null}
              onSaveAndAsk={handleSaveAndAsk}
              onSaveOnly={handleSaveOnly}
            />
          ) : null}
          {scanState?.errorMessage ? (
            <AnalysisError 
              code={scanState.errorCode}
              captureMode={scanState.provenance?.captureMode ?? lookup?.provenance.captureMode ?? "camera"}
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
            <TrustControl
              lookup={lookup}
              onCorrectionChange={handleCorrection}
              onRating={handleRating}
            />
          ) : null}
          {lookup ? <ReportActions lookup={lookup} /> : null}
          {datasetSourceUrls.length > 0 ? <SourceFinePrint urls={datasetSourceUrls} /> : null}
        </div>

        <Button className="mt-6 w-full" onClick={() => window.location.assign("/")}>
          Try another scan
        </Button>
        </div>
      </div>
      <ScanDebugOverlay info={scanState?.debug} />
      <HistoryDockButton />
    </main>
  );
}

function ShopJobBanner({ job }: { job: ShopJobRecord }) {
  return (
    <section className="rounded-[8px] border border-[var(--ds-accent-line)] bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-extrabold uppercase tracking-[0.16em] text-[var(--ds-accent)]">Saved to shop job</p>
          <h2 className="mt-1 truncate text-lg font-black tracking-tight">{job.title}</h2>
          <p className="mt-1 text-sm font-semibold text-slate-500">
            {job.year} {job.make} {job.model} / {job.technicianName}
          </p>
        </div>
        <Link to={`/shop/jobs/${encodeURIComponent(job.id)}`} className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-900">
          Open job
        </Link>
      </div>
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

function TrustControl({
  lookup,
  onCorrectionChange,
  onRating,
}: {
  lookup: Lookup;
  onCorrectionChange: (correction: string) => void;
  onRating: (rating: Rating) => void;
}) {
  const [showWhy, setShowWhy] = useState(false);
  const trusted = lookup.rating === "up";
  const flagged = lookup.rating === "down";

  return (
    <section className="rounded-[22px] border border-neutral-200 bg-white p-4 shadow-sm" data-testid="trust-control">
      <p className="text-sm font-extrabold text-neutral-900">Do you trust this scan?</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          className={`rounded-full px-4 py-2 text-sm font-extrabold ${trusted ? "bg-[var(--ds-ok)] text-white" : "bg-neutral-100 text-neutral-900"}`}
          onClick={() => { onRating("up"); setShowWhy(false); }}
        >
          Yes
        </button>
        <button
          type="button"
          className={`rounded-full px-4 py-2 text-sm font-extrabold ${flagged || showWhy ? "bg-[var(--ds-danger)] text-white" : "bg-neutral-100 text-neutral-900"}`}
          onClick={() => { onRating("down"); setShowWhy(true); }}
        >
          Why or why not
        </button>
      </div>
      {showWhy || flagged ? (
        <label className="mt-3 block">
          <span className="text-xs font-extrabold uppercase tracking-[0.14em] text-neutral-400">Tell us what&apos;s off (or right)</span>
          <textarea
            aria-label="Why or why not"
            className="mt-2 min-h-20 w-full resize-none rounded-2xl border border-neutral-200 bg-white p-3 text-sm leading-6 text-neutral-900 outline-none placeholder:text-neutral-400 focus:border-[var(--ds-accent)]"
            maxLength={240}
            onChange={(event) => onCorrectionChange(event.target.value)}
            placeholder="Example: it's actually a coolant cap, not a brake fluid cap"
            value={lookup.correction ?? ""}
          />
        </label>
      ) : null}
      <p className="mt-3 text-xs font-semibold leading-5 text-neutral-400">
        Stays private on this device. Good scans help train Deep Spec once we go live.
      </p>
    </section>
  );
}

function ReportActions({ lookup }: { lookup: Lookup }) {
  const [status, setStatus] = useState<string | null>(null);

  async function handleShare() {
    const report = buildScanReport(lookup);
    try {
      if (navigator.share) {
        await navigator.share({ title: `Deep Spec: ${lookup.trainingLabel}`, text: report });
        setStatus("Report shared.");
        return;
      }
      await navigator.clipboard.writeText(report);
      setStatus("Report copied to clipboard.");
    } catch {
      setStatus("This browser won't share. Export instead.");
    }
  }

  function handleDownload() {
    downloadTextFile(getScanReportFilename(lookup), buildScanReport(lookup));
    setStatus("Report downloaded.");
  }

  return (
    <section data-testid="report-actions">
      <div className="grid grid-cols-2 gap-2">
        <Button className="!bg-neutral-100 !text-neutral-900 shadow-none" onClick={handleShare}>
          Share
        </Button>
        <Button className="!bg-neutral-100 !text-neutral-900 shadow-none" onClick={handleDownload}>
          Export
        </Button>
      </div>
      {status ? <p className="mt-2 text-xs font-semibold text-[var(--ds-accent)]">{status}</p> : null}
    </section>
  );
}

function AnalysisResult({
  canSaveForChat,
  capturedAt,
  lookupId,
  onSaveAndAsk,
  onSaveOnly,
  result,
}: {
  canSaveForChat: boolean;
  capturedAt: string | null;
  lookupId: string | null;
  onSaveAndAsk: (question?: string) => void;
  onSaveOnly: () => void;
  result: IdentificationResult;
}) {
  const summary = getSimpleResultSummary(result);
  const showSafetyWarning = result.isSafetyCritical || result.safetyTriage === "needs_professional";

  return (
    <>
      <section className="sticky top-2 z-10 rounded-[24px] border border-neutral-200 bg-white p-4 shadow-[0_12px_34px_rgba(15,23,42,0.08)]">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-extrabold uppercase tracking-[0.16em] text-[var(--ds-accent)]">{summary.eyebrow}</p>
            <h2 className="mt-1 text-2xl font-extrabold tracking-tight">
              {summary.title}
            </h2>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <MiniPill label={result.scanCategory} />
          {isOnDeviceResult(result) || shouldShowBackupModelNotice(result) ? <MiniPill label="Estimate" /> : null}
        </div>
        {isOnDeviceResult(result) ? (
          <p className="mt-3 rounded-2xl border border-[var(--ds-warn-line)] bg-[var(--ds-warn-soft)] px-3 py-2 text-xs font-semibold leading-5 text-neutral-700">
            Offline estimate from the on-device model. Reconnect for a full Deep Spec analysis.
          </p>
        ) : shouldShowBackupModelNotice(result) ? (
          <p className="mt-3 rounded-2xl border border-[var(--ds-warn-line)] bg-[var(--ds-warn-soft)] px-3 py-2 text-xs font-semibold leading-5 text-neutral-700">
            Ran on the backup model while the main one was busy. Double-check before relying on it.
          </p>
        ) : null}
        <IssueLine result={result} variant="result" />
        <p className="mt-3 text-sm leading-6 text-neutral-600">{getAnswerBody(result, summary)}</p>
        {capturedAt ? <p className="mt-3 text-xs font-semibold text-neutral-400">Captured {capturedAt}</p> : null}
        <QuickActions canSaveForChat={canSaveForChat} lookupId={lookupId} onSaveAndAsk={onSaveAndAsk} onSaveOnly={onSaveOnly} />
        <SceneCategoryList result={result} variant="result" />
        <ResultDetailSections result={result} variant="result" />
      </section>

      {showSafetyWarning ? (
        <section className="rounded-[22px] border border-[var(--ds-warn-line)] bg-[var(--ds-warn-soft)] p-4">
          <p className="text-sm font-extrabold text-[var(--ds-warn-ink)]">Professional check needed</p>
          <p className="mt-2 text-sm leading-6 text-neutral-700">
            Verify before driving or repairing. The scan reads visible clues; this category affects safety.
          </p>
        </section>
      ) : null}
    </>
  );
}

function shouldShowBackupModelNotice(result: IdentificationResult) {
  const provider = result.modelRun?.provider;
  return provider === "huggingface" || provider === "groq" || provider === "ollama";
}

function isOnDeviceResult(result: IdentificationResult) {
  return result.modelRun?.provider === "on-device";
}

function MiniPill({ label }: { label: string }) {
  return (
    <span className="rounded-full border border-neutral-200 bg-neutral-50 px-3 py-1 text-xs font-extrabold capitalize text-neutral-600">
      {label.replaceAll("_", " ")}
    </span>
  );
}

function QuickActions({
  canSaveForChat,
  lookupId,
  onSaveAndAsk,
  onSaveOnly,
}: {
  canSaveForChat: boolean;
  lookupId: string | null;
  onSaveAndAsk: () => void;
  onSaveOnly: () => void;
}) {
  let askAction = null;
  if (lookupId) {
    askAction = (
      <Link className="rounded-full bg-[var(--ds-accent)] px-4 py-3 text-center text-sm font-extrabold text-white" to={`/result/${lookupId}/chat`}>
        Ask
      </Link>
    );
  } else if (canSaveForChat) {
    askAction = (
      <button className="rounded-full bg-[var(--ds-accent)] px-4 py-3 text-center text-sm font-extrabold text-white" type="button" onClick={onSaveAndAsk}>
        Ask
      </button>
    );
  }

  return (
    <div className="mt-4 grid grid-cols-2 gap-2">
      {askAction ?? <span aria-hidden className="rounded-full bg-neutral-100 px-4 py-3" />}
      <button
        className="rounded-full bg-neutral-100 px-4 py-3 text-center text-sm font-extrabold text-neutral-900 disabled:text-neutral-400"
        disabled={Boolean(lookupId) || !canSaveForChat}
        onClick={onSaveOnly}
        type="button"
      >
        {lookupId ? "Saved" : "Save"}
      </button>
    </div>
  );
}

function SourceFinePrint({ urls }: { urls: string[] }) {
  return (
    <section className="px-1 py-2 text-[11px] leading-5 text-neutral-400">
      <p className="font-extrabold uppercase tracking-[0.14em]">Dataset sources</p>
      <div className="mt-1 space-y-1">
        {urls.map((url, index) => (
          <a
            key={url}
            className="block truncate underline decoration-neutral-300 underline-offset-4"
            href={url}
            rel="noreferrer"
            target="_blank"
          >
            Hugging Face source {index + 1}
          </a>
        ))}
      </div>
    </section>
  );
}

function AnalysisError({
  capturedAt,
  captureMode,
  code,
  frame,
  lookup,
  message,
  onLookupRetrySuccess,
  onScanRetrySuccess,
}: {
  capturedAt: string | null;
  captureMode: "camera" | "upload";
  code?: string;
  frame: CapturedFrame | null | undefined;
  lookup: Lookup | null;
  message: string;
  onLookupRetrySuccess: (updatedLookup: Lookup) => void;
  onScanRetrySuccess: (scanState: ScanAnalysisState) => void;
}) {
  const [isOnline, setIsOnline] = useState(() => typeof navigator !== "undefined" ? navigator.onLine : true);
  const [isRetrying, setIsRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const errorDetails = getAIErrorDetails(code);

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
        const updateResult = updateLookupResult(lookup.id, result, {
          analysisSource: "manual_retry",
          savedAt: new Date().toISOString(),
        });
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
          provenance: {
            analysisSource: "manual_retry",
            captureMode,
            savedAt: new Date().toISOString(),
          },
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
      <p className="text-sm font-bold text-[var(--ds-danger-ink)]">
        {errorDetails.category === "provider_unavailable" ? "Provider unavailable" : "Identification needs another pass"}
      </p>
      <h2 className="mt-2 text-xl font-extrabold tracking-tight">{errorDetails.title}</h2>
      <p className="mt-3 text-sm leading-6 text-neutral-700">{message}</p>
      <p className="mt-3 text-sm leading-6 text-neutral-700">{errorDetails.description}</p>
      {capturedAt ? <p className="mt-3 text-xs font-semibold text-neutral-400">Captured {capturedAt}</p> : null}

      {frame ? (
        <div className="mt-4 border-t border-neutral-200 pt-4">
          <p className="text-xs font-semibold text-neutral-500">
            {isOnline ? "Connection is active." : "Offline. Reconnect to retry."}
          </p>
          <Button
            className="mt-3 w-full"
            disabled={!isOnline || isRetrying}
            onClick={handleRetry}
          >
            {isRetrying ? "Retrying..." : errorDetails.retryLabel}
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
    <section className="rounded-[22px] border border-neutral-200 bg-white p-4">
      <p className="text-sm font-bold text-[var(--ds-accent)]">Not analyzed yet</p>
      <h2 className="mt-2 text-xl font-extrabold tracking-tight">Scan again to identify this</h2>
      <p className="mt-3 text-sm leading-6 text-neutral-500">
        The frame is here, but no result is attached yet.
      </p>
      {capturedAt ? <p className="mt-3 text-xs font-semibold text-neutral-400">Captured {capturedAt}</p> : null}
    </section>
  );
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
