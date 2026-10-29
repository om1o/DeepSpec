import { createAnalysisAttemptId } from "../lib/analysisAttempt";
import { prepareRetryFrame } from "../lib/retryFrame";
import { applyShopFitmentContext } from "../lib/shopFitmentContext";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { isGuestPreview } from "../lib/guestPreview";
import { BrandLockup } from "../components/BrandLockup";
import { useEffect, useRef, useState } from "react";
import { AIServiceError, getAIErrorDetails, getAIErrorMessage, identifyCapturedFrame } from "../services/aiService";
import { syncAnalysisFailuresToCloud } from "../services/cloudSync";
import Button from "../components/ui/Button";
import { IsolatedPartView } from "../components/result/IsolatedPartView";
import { ScanSources } from "../components/result/ScanSources";
import { PartInspectionForm } from "../components/result/PartInspectionForm";
import { TrainingConsentPanel } from "../components/result/TrainingConsentPanel";
import { IntakeDraft } from "../components/result/IntakeDraft";
import { ScanDebugOverlay } from "../components/result/ScanDebugOverlay";
import { IssueLine, ResultDetailSections, SceneCategoryList } from "../components/result/PositiveAnswerCard";
import { getSimpleResultSummary } from "../lib/simpleResultSummary";
import { withLatestInspection } from "../lib/partInspection";
import { mergeCloudLookup } from "../lib/lookupMerge";
import { getAccountScope, isAccountScopeCurrent, isCurrentAccountRouteState } from "../lib/accountScope";
import { deriveIssue, getAnswerBody, getSceneChips } from "../lib/resultFacts";
import { readLatestCapturedFrame, readLatestScanState, saveLatestScanState } from "../lib/utils";
import { buildScanReport, downloadTextFile, getScanReportFilename } from "../services/report";
import { recordManualCorrection } from "../services/scanQualityMetrics";
import { getShopJob } from "../services/shop";
import { createLookup, getLookup, normalizeLookup, recordLookupAnalysisFailure, saveExistingLookup, scanStateFromLookup, updateLookup, updateLookupResult, withRetriedLookupResult } from "../services/storage";
import type { CapturedFrame, IdentificationResult, Lookup, Rating, ScanAnalysisState, ShopJob as ShopJobRecord } from "../types";

export default function Result() {
  const [mountedScope] = useState(getAccountScope);
  const location = useLocation();
  const routeState = isCurrentAccountRouteState(location.state) ? location.state : null;
  const navigate = useNavigate();
  const { id } = useParams();
  const historyLookup = normalizeLookup(routeState?.savedLookup);
  const [lookup, setLookup] = useState<Lookup | null>(() => {
    if (!id) return null;
    const local = getLookup(id);
    const fromHistory = normalizeLookup(routeState?.savedLookup);
    if (local && fromHistory?.id === id) return withLatestInspection(local, fromHistory);
    return local;
  });
  const [liveScanState, setLiveScanState] = useState<ScanAnalysisState | null>(null);
  const inspectionBase = historyLookup && historyLookup.id === id
    ? (lookup ? mergeCloudLookup(lookup, historyLookup) : historyLookup)
    : lookup;
  const inspectionLookup = inspectionBase ? withRetriedLookupResult(inspectionBase, liveScanState) : null;
  const [hasPendingRetryResult, setHasPendingRetryResult] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [retrySaveLabel, setRetrySaveLabel] = useState("Retry saving feedback");
  const scanState = lookup ? scanStateFromLookup(inspectionBase ?? lookup) : liveScanState ?? getScanState(routeState);
  const frame = scanState?.frame ?? readLatestCapturedFrame();
  const capturedAt = frame?.capturedAt ? new Date(frame.capturedAt).toLocaleString() : null;
  const storageWarning = scanState?.storageWarning;
  const shopJob = scanState?.jobId ? getShopJob(scanState.jobId) : null;
  const canSaveForChat = Boolean(scanState?.frame && scanState.result);
  const datasetSourceUrls = scanState?.result ? getDatasetSourceUrls(scanState.result.evidence) : [];
  const simpleSummary = scanState?.result ? getSimpleResultSummary(scanState.result) : null;
  const manualCorrectionTrackedRef = useRef(false);
  const pendingRatingRef = useRef<Rating | undefined>(undefined);
  const pendingCorrectionRef = useRef<string | null | undefined>(undefined);
  const pendingRetryLookupRef = useRef<Lookup | null>(null);

  function trackManualCorrectionOnce() {
    if (manualCorrectionTrackedRef.current) {
      return;
    }

    manualCorrectionTrackedRef.current = true;
    recordManualCorrection();
  }

  function handleRating(rating: Rating) {
    if (!isAccountScopeCurrent(mountedScope)) return;
    if (!lookup) {
      return;
    }

    if (rating === "down") {
      trackManualCorrectionOnce();
    }

    if (pendingRetryLookupRef.current) {
      const correction = rating === "down" ? lookup.correction : null;
      pendingRatingRef.current = rating;
      pendingCorrectionRef.current = correction;
      pendingRetryLookupRef.current = { ...pendingRetryLookupRef.current, rating, correction };
      setLookup({ ...lookup, rating, correction });
      return;
    }

    const result = updateLookup(lookup.id, {
      rating,
      correction: rating === "down" ? lookup.correction : null,
    });
    pendingRatingRef.current = result.ok ? undefined : rating;
    handleLookupUpdate(result);
  }

  function handleCorrection(correction: string) {
    if (!isAccountScopeCurrent(mountedScope)) return;
    if (!lookup) {
      return;
    }

    if (correction.trim()) {
      trackManualCorrectionOnce();
    }

    if (pendingRetryLookupRef.current) {
      pendingCorrectionRef.current = correction;
      pendingRetryLookupRef.current = { ...pendingRetryLookupRef.current, correction };
      setLookup({ ...lookup, correction });
      return;
    }

    handleLookupUpdate(updateLookup(lookup.id, {
      ...(pendingRatingRef.current !== undefined ? { rating: pendingRatingRef.current } : {}),
      correction,
    }));
  }

  function retryFeedbackSave() {
    if (!lookup || !isAccountScopeCurrent(mountedScope)) return;
    const pendingRetry = pendingRetryLookupRef.current;
    if (pendingRetry?.result) {
      const resultWrite = updateLookupResult(
        pendingRetry.id,
        pendingRetry.result,
        pendingRetry.provenance,
        pendingRetry.frame,
      );
      if (!resultWrite.ok) {
        const retryLookup = {
          ...(resultWrite.value ?? pendingRetry),
          ...(pendingRatingRef.current !== undefined ? { rating: pendingRatingRef.current } : {}),
          ...(pendingCorrectionRef.current !== undefined ? { correction: pendingCorrectionRef.current } : {}),
        };
        pendingRetryLookupRef.current = retryLookup;
        handleLookupUpdate({ ...resultWrite, value: retryLookup }, "result");
        return;
      }

      pendingRetryLookupRef.current = null;
      setHasPendingRetryResult(false);
      if (pendingRatingRef.current !== undefined || pendingCorrectionRef.current !== undefined) {
        handleLookupUpdate(updateLookup(pendingRetry.id, {
          ...(pendingRatingRef.current !== undefined ? { rating: pendingRatingRef.current } : {}),
          ...(pendingCorrectionRef.current !== undefined ? { correction: pendingCorrectionRef.current } : {}),
        }));
      } else {
        handleLookupUpdate(resultWrite);
      }
      return;
    }
    handleLookupUpdate(updateLookup(lookup.id, {
      ...(pendingRatingRef.current !== undefined ? { rating: pendingRatingRef.current } : {}),
      correction: lookup.correction,
    }));
  }


  function saveCurrentScan() {
    if (!isAccountScopeCurrent(mountedScope)) return null;
    if (!scanState?.frame || !scanState.result) {
      return null;
    }

    const saved = inspectionLookup ? saveExistingLookup(inspectionLookup, liveScanState) : createLookup({
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
    if (!isAccountScopeCurrent(mountedScope) || pendingRetryLookupRef.current) return;
    const saved = lookup ?? saveCurrentScan();
    if (!saved) {
      return;
    }

    const query = question ? `?q=${encodeURIComponent(question)}` : "";
    navigate(`/result/${saved.id}/chat${query}`);
  }

  function handleLookupUpdate(result: ReturnType<typeof updateLookup>, failureKind: "feedback" | "result" = "feedback") {
    if (result.ok) {
      pendingRatingRef.current = undefined;
      pendingCorrectionRef.current = undefined;
      setLookup(result.value);
      setSaveError(null);
      setRetrySaveLabel("Retry saving feedback");
      return;
    }

    setSaveError(result.message);
    setRetrySaveLabel(failureKind === "result" ? "Retry saving scan result" : "Retry saving feedback");
    if (result.value) {
      pendingCorrectionRef.current = result.value.correction;
      setLookup(result.value);
    }
  }

  return (
    <main className="ds-result-page ds-workbench min-h-dvh bg-[var(--ds-bg)] text-[var(--ds-fg-1)]">
      <div className="mx-auto grid min-h-dvh w-full max-w-[1600px] lg:grid-cols-[minmax(0,1fr)_430px] lg:gap-5 lg:p-5">
        <section aria-label="Scan photo" data-testid="result-photo-panel" className="relative flex h-[48dvh] min-h-[320px] flex-col overflow-hidden bg-[#020617] text-white lg:sticky lg:top-5 lg:h-[calc(100dvh-40px)] lg:min-h-0 lg:rounded-[24px]">
          <header className="relative z-10 flex shrink-0 items-center justify-between gap-3 border-b border-white/10 px-4 pb-4 pt-[max(18px,env(safe-area-inset-top))]">
            <BrandLockup size="sm" />
            <h1 className="sr-only">{simpleSummary?.title ?? "Captured frame"}</h1>
            <nav className="flex gap-2" aria-label="Scan navigation">
              <Link to="/history" aria-label="Open saved scan history" className="ds-workbench-back">Saved scans</Link>
              <Link to="/scan" className="ds-workbench-back">Back</Link>
            </nav>
          </header>
          <div data-testid="result-photo-canvas" className="relative min-h-0 flex-1">
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
            ) : <div className="absolute inset-0 grid place-items-center bg-[#061522] px-8 text-center text-sm text-white/62">No frame captured.</div>}
          </div>
        </section>

        <div data-testid="result-overview-panel" className="ds-result-sheet relative min-w-0 rounded-t-[24px] border-t border-[var(--ds-border)] bg-[var(--ds-page)] px-4 pb-8 pt-4 lg:rounded-[24px] lg:border lg:max-h-[calc(100dvh-40px)] lg:overflow-y-auto">
          <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-slate-300 lg:hidden" />
          <div className="space-y-3">
          {storageWarning ? <StorageWarning message={storageWarning} /> : null}
          {saveError ? <StorageWarning message={saveError} /> : null}
          {shopJob ? <ShopJobBanner job={shopJob} /> : null}
          {scanState?.result ? (
            <AnalysisResult
              result={scanState.result}
              capturedAt={capturedAt}
              canSaveForChat={canSaveForChat}
              askDisabled={hasPendingRetryResult}
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
              vehicleContext={lookup?.vehicleContext ?? scanState.vehicleContext}
              onLookupRetrySuccess={(updatedLookup, warning) => {
                pendingRetryLookupRef.current = warning ? updatedLookup : null;
                setHasPendingRetryResult(Boolean(warning));
                setLookup(updatedLookup);
                setSaveError(warning ?? null);
                setRetrySaveLabel(warning ? "Retry saving scan result" : "Retry saving feedback");
              }}
              onScanRetrySuccess={(nextScanState) => {
                setLiveScanState(nextScanState);
                saveLatestScanState(nextScanState);
              }}
            />
          ) : null}
          {!scanState?.result && !scanState?.errorMessage ? <NotAnalyzed capturedAt={capturedAt} /> : null}
          {inspectionLookup ? <IntakeDraft lookup={inspectionLookup} /> : null}
          {lookup ? (
            <TrustControl
              lookup={lookup}
              onCorrectionChange={handleCorrection}
              onRating={handleRating}
              saveFailed={Boolean(saveError)}
              retrySaveLabel={retrySaveLabel}
              onRetrySave={retryFeedbackSave}
            />
          ) : null}
          {inspectionLookup ? <PartInspectionForm key={inspectionLookup.id} lookup={inspectionLookup} onSaved={(saved) => setLookup({
            ...saved,
            ...(pendingRatingRef.current !== undefined ? { rating: pendingRatingRef.current } : {}),
            ...(pendingCorrectionRef.current !== undefined ? { correction: pendingCorrectionRef.current } : {}),
          })} /> : null}
          {inspectionLookup ? <ReportActions lookup={inspectionLookup} /> : null}
          {inspectionLookup && !isGuestPreview() ? <TrainingConsentPanel key={`consent:${inspectionLookup.id}`} scanId={inspectionLookup.id} /> : null}
          {datasetSourceUrls.length > 0 ? <SourceFinePrint urls={datasetSourceUrls} /> : null}
          <Link
            className="block rounded-xl border border-[var(--ds-border)] p-4 text-center text-sm font-bold text-[var(--ds-fg-1)]"
            to={`/early-access${lookup ? `?scan=${encodeURIComponent(lookup.id)}` : ""}#feedback`}
          >
            Report a result or AR problem
          </Link>
        </div>

        <Button className="mt-6 w-full" onClick={() => navigate("/scan")}>
          Try another scan
        </Button>
        </div>
      </div>
      <ScanDebugOverlay info={scanState?.debug} />
    </main>
  );
}

function ShopJobBanner({ job }: { job: ShopJobRecord }) {
  return (
    <section className="rounded-[8px] border border-[var(--ds-accent-line)] bg-[var(--ds-elevated)] p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-extrabold uppercase tracking-[0.16em] text-[#a7cbd4]">Saved to shop job</p>
          <h2 className="mt-1 truncate text-lg font-black tracking-tight">{job.title}</h2>
          <p className="mt-1 text-sm font-semibold text-[var(--ds-fg-3)]">
            {job.year} {job.make} {job.model} / {job.technicianName}
          </p>
        </div>
        <Link to={`/shop/jobs/${encodeURIComponent(job.id)}`} className="rounded-full border border-[var(--ds-border)] bg-[var(--ds-elevated)] px-4 py-2 text-sm font-bold text-[var(--ds-fg-1)]">
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
      <p className="mt-2 text-sm leading-6 text-[var(--ds-fg-2)]">{message}</p>
    </section>
  );
}

function TrustControl({
  lookup,
  onCorrectionChange,
  onRating,
  saveFailed,
  retrySaveLabel,
  onRetrySave,
}: {
  lookup: Lookup;
  onCorrectionChange: (correction: string) => void;
  onRating: (rating: Rating) => void;
  saveFailed: boolean;
  retrySaveLabel: string;
  onRetrySave: () => void;
}) {
  const [showWhy, setShowWhy] = useState(false);
  const trusted = lookup.rating === "up";
  const flagged = lookup.rating === "down";

  return (
    <section className="rounded-[22px] border border-[var(--ds-border)] bg-[var(--ds-elevated)] p-4 shadow-sm" data-testid="trust-control">
      <p className="text-sm font-extrabold text-[var(--ds-fg-1)]">Do you trust this scan?</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          className={`rounded-full px-4 py-2 text-sm font-extrabold ${trusted ? "bg-[var(--ds-ok)] text-white" : "bg-[var(--ds-surface)] text-[var(--ds-fg-1)]"}`}
          onClick={() => { onRating("up"); setShowWhy(false); }}
        >
          Yes
        </button>
        <button
          type="button"
          className={`rounded-full px-4 py-2 text-sm font-extrabold ${flagged || showWhy ? "bg-[var(--ds-danger)] text-white" : "bg-[var(--ds-surface)] text-[var(--ds-fg-1)]"}`}
          onClick={() => { onRating("down"); setShowWhy(true); }}
        >
          Why or why not
        </button>
      </div>
      {showWhy || flagged ? (
        <label className="mt-3 block">
          <span className="text-xs font-extrabold uppercase tracking-[0.14em] text-[var(--ds-fg-3)]">Tell us what&apos;s off (or right)</span>
          <textarea
            aria-label="Why or why not"
            className="mt-2 min-h-20 w-full resize-none rounded-2xl border border-[var(--ds-border)] bg-[var(--ds-elevated)] p-3 text-sm leading-6 text-[var(--ds-fg-1)] outline-none placeholder:text-[var(--ds-fg-3)] focus:border-[var(--ds-accent)]"
            maxLength={240}
            onChange={(event) => onCorrectionChange(event.target.value)}
            placeholder="Example: it's actually a coolant cap, not a brake fluid cap"
            value={lookup.correction ?? ""}
          />
        </label>
      ) : null}
      <p className="mt-3 text-xs font-semibold leading-5 text-[var(--ds-fg-3)]">
        {saveFailed ? "Feedback is not saved. Keep this page open or copy your text before leaving." : "Feedback is saved with this scan."} Using it for model training requires separate permission.
      </p>
      {saveFailed ? <button type="button" onClick={onRetrySave} className="mt-3 rounded-full border border-[var(--ds-border)] px-4 py-2 text-sm font-bold">{retrySaveLabel}</button> : null}
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
    } catch (error) {
      // Dismissing the native share sheet rejects with AbortError; that's a choice, not a failure.
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }
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
        <Button className="!bg-[var(--ds-surface)] !text-[var(--ds-fg-1)] shadow-none" onClick={handleShare}>
          Share
        </Button>
        <Button className="!bg-[var(--ds-surface)] !text-[var(--ds-fg-1)] shadow-none" onClick={handleDownload}>
          Export
        </Button>
      </div>
      {status ? <p className="mt-2 text-xs font-semibold text-[#a7cbd4]">{status}</p> : null}
    </section>
  );
}

function AnalysisResult({
  askDisabled,
  canSaveForChat,
  capturedAt,
  lookupId,
  onSaveAndAsk,
  onSaveOnly,
  result,
}: {
  askDisabled: boolean;
  canSaveForChat: boolean;
  capturedAt: string | null;
  lookupId: string | null;
  onSaveAndAsk: (question?: string) => void;
  onSaveOnly: () => void;
  result: IdentificationResult;
}) {
  const summary = getSimpleResultSummary(result);
  const [activePanel, setActivePanel] = useState<"overview" | "text" | "sources">("overview");
  const showSafetyWarning = result.isSafetyCritical || result.safetyTriage === "needs_professional";

  return (
    <>
      <section className="rounded-[24px] border border-[var(--ds-border)] bg-[var(--ds-elevated)] p-4 shadow-[0_12px_34px_rgba(15,23,42,0.08)]">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-extrabold uppercase tracking-[0.16em] text-[#a7cbd4]">AI overview</p>
            <h2 className="mt-1 text-2xl font-extrabold tracking-tight">
              {summary.title}
            </h2>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <MiniPill label={result.scanCategory} />
          <MiniPill label={`${result.confidence} confidence`} />
          {isOnDeviceResult(result) || shouldShowBackupModelNotice(result) ? <MiniPill label="Estimate" /> : null}
        </div>
        {isOnDeviceResult(result) ? (
          <p className="mt-3 rounded-2xl border border-[var(--ds-warn-line)] bg-[var(--ds-warn-soft)] px-3 py-2 text-xs font-semibold leading-5 text-[var(--ds-fg-2)]">
            Offline estimate from the on-device model. Reconnect for a full Deep Spec analysis.
          </p>
        ) : shouldShowBackupModelNotice(result) ? (
          <p className="mt-3 rounded-2xl border border-[var(--ds-warn-line)] bg-[var(--ds-warn-soft)] px-3 py-2 text-xs font-semibold leading-5 text-[var(--ds-fg-2)]">
            Ran on the backup model while the main one was busy. Double-check before relying on it.
          </p>
        ) : null}
        <IssueLine result={result} variant="result" />
        <p className="mt-3 text-sm leading-6 text-[var(--ds-fg-3)]">{getAnswerBody(result, summary)}</p>
        {capturedAt ? <p className="mt-3 text-xs font-semibold text-[var(--ds-fg-3)]">Captured {capturedAt}</p> : null}
        <QuickActions askDisabled={askDisabled} canSaveForChat={canSaveForChat} lookupId={lookupId} onSaveAndAsk={onSaveAndAsk} onSaveOnly={onSaveOnly} />
        <div className="mt-5 grid grid-cols-3 gap-1 rounded-2xl border border-[var(--ds-border)] bg-[var(--ds-surface)] p-1" role="tablist" aria-label="AI view sections">
          {(["overview", "text", "sources"] as const).map((panel) => (
            <button key={panel} id={`ai-tab-${panel}`} role="tab" type="button" aria-selected={activePanel === panel} aria-controls={`ai-panel-${panel}`} onClick={() => setActivePanel(panel)} className={`min-h-10 rounded-xl px-2 text-xs font-extrabold capitalize ${activePanel === panel ? "bg-white text-[#0b1520] shadow-sm" : "text-[var(--ds-fg-3)]"}`}>{panel === "text" ? "Text output" : panel === "sources" ? "Sources" : "Overview"}</button>
          ))}
        </div>
        <div role="tabpanel" id={`ai-panel-${activePanel}`} aria-labelledby={`ai-tab-${activePanel}`} className="mt-4">
          {activePanel === "overview" ? <>
            <SceneCategoryList result={result} variant="result" />
            <ResultDetailSections result={result} variant="result" />
            <CandidateMatches result={result} />
            <FollowUpPrompts lookupId={lookupId} disabled={askDisabled} onSaveAndAsk={onSaveAndAsk} result={result} />
          </> : activePanel === "text" ? <DetectedText result={result} /> : <ScanSources sources={result.sourceLinks} researchTerm={`${result.partName} car part`} />}
        </div>
      </section>

      {showSafetyWarning ? (
        <section className="rounded-[22px] border border-[var(--ds-warn-line)] bg-[var(--ds-warn-soft)] p-4">
          <p className="text-sm font-extrabold text-[var(--ds-warn-ink)]">Professional check needed</p>
          <p className="mt-2 text-sm leading-6 text-[var(--ds-fg-2)]">
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

function CandidateMatches({ result }: { result: IdentificationResult }) {
  if (!result.candidateMatches.length) return null;
  return (
    <section className="mt-4 border-t border-[var(--ds-border)] pt-4" aria-label="Other possible matches">
      <h3 className="text-xs font-extrabold uppercase tracking-[0.12em] text-[var(--ds-fg-3)]">Other possible matches</h3>
      {result.candidateMatches.map((candidate) => <article key={`${candidate.partName}:${candidate.reason}`} className="mt-2 rounded-2xl border border-[var(--ds-border)] bg-[var(--ds-surface)] p-3">
        <p className="text-sm font-extrabold">{candidate.partName} <span className="ml-1 text-xs font-semibold text-[var(--ds-fg-3)]">{candidate.confidence} confidence</span></p>
        <p className="mt-1 text-xs leading-5 text-[var(--ds-fg-3)]">{candidate.reason}</p>
      </article>)}
    </section>
  );
}

/** Restore the saved OCR evidence tools from the original DeepSpec result view. */
function DetectedText({ result }: { result: IdentificationResult }) {
  const [copyStatus, setCopyStatus] = useState("");
  const findings = [...new Set(result.evidence.map((item) => item.match(/^OCR label text:\s*(.+)$/i)?.[1]?.replace(/\s+/g, " ").trim()).filter((text): text is string => Boolean(text)))].slice(0, 3);
  async function copyText(text: string) {
    try { await navigator.clipboard.writeText(text); setCopyStatus("Copied"); }
    catch { setCopyStatus("Copy failed"); }
  }
  return (
    <section aria-label="Text output">
      <h3 className="text-xs font-extrabold uppercase tracking-[0.12em] text-[var(--ds-fg-3)]">Detected label text</h3>
      {findings.length ? findings.map((text) => {
        const codes = [...new Set((text.match(/\b[A-Z0-9][A-Z0-9./#:-]{3,}[A-Z0-9]\b/gi) ?? []).filter((token) => /\d/.test(token) && /[A-Z./#:-]/i.test(token)).map((token) => token.toUpperCase()))].slice(0, 4);
        return <article key={text} className="mt-3 rounded-2xl border border-[var(--ds-border)] bg-[var(--ds-surface)] p-3">
          <p className="break-words font-mono text-base font-bold leading-7">{text}</p>
          {codes.length ? <p className="mt-2 break-words text-xs leading-5 text-[var(--ds-fg-3)]">Candidate codes: <span className="font-mono text-[var(--ds-fg-1)]">{codes.join(" · ")}</span></p> : null}
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button type="button" onClick={() => void copyText(text)} className="min-h-10 rounded-full border border-[var(--ds-border)] px-3 text-xs font-bold">Copy text</button>
            <a href={`https://www.google.com/search?q=${encodeURIComponent(text)}`} target="_blank" rel="noopener noreferrer" className="grid min-h-10 place-items-center rounded-full border border-[var(--ds-border)] px-3 text-xs font-bold">Search exact</a>
            <a href={`https://www.google.com/search?q=${encodeURIComponent(`${text} ${result.partName} car part`)}`} target="_blank" rel="noopener noreferrer" className="col-span-2 grid min-h-10 place-items-center rounded-full bg-white px-3 text-xs font-bold text-[#0b1520]">Search with part</a>
          </div>
        </article>;
      }) : <p className="mt-3 text-sm leading-6 text-[var(--ds-fg-3)]">No readable label text was returned for this photo. A clear close-up of a marking can help.</p>}
      {copyStatus ? <p role="status" className="mt-2 text-xs text-[var(--ds-fg-3)]">{copyStatus}</p> : null}
    </section>
  );
}

function FollowUpPrompts({ lookupId, disabled, onSaveAndAsk, result }: { lookupId: string | null; disabled: boolean; onSaveAndAsk: (question?: string) => void; result: IdentificationResult }) {
  const prompts = ["What should I check next?", "How serious is this?", result.needsBetterPhoto ? "What photo angle would help?" : "What symptoms match this part?"];
  return <section className="mt-4 border-t border-[var(--ds-border)] pt-4" aria-label="Follow-up questions">
    <h3 className="text-xs font-extrabold uppercase tracking-[0.12em] text-[var(--ds-fg-3)]">Ask next</h3>
    <div className="mt-2 grid gap-2">{prompts.map((question) => lookupId && !disabled ? <Link key={question} to={`/result/${lookupId}/chat?q=${encodeURIComponent(question)}`} className="rounded-2xl border border-[var(--ds-border)] bg-[var(--ds-surface)] px-3 py-3 text-sm font-semibold">{question}</Link> : <button key={question} type="button" disabled={disabled} onClick={() => onSaveAndAsk(question)} className="rounded-2xl border border-[var(--ds-border)] bg-[var(--ds-surface)] px-3 py-3 text-left text-sm font-semibold disabled:opacity-45">{question}</button>)}</div>
  </section>;
}

function MiniPill({ label }: { label: string }) {
  return (
    <span className="rounded-full border border-[var(--ds-border)] bg-[var(--ds-surface)] px-3 py-1 text-xs font-extrabold capitalize text-[var(--ds-fg-3)]">
      {label.replaceAll("_", " ")}
    </span>
  );
}

function QuickActions({
  askDisabled,
  canSaveForChat,
  lookupId,
  onSaveAndAsk,
  onSaveOnly,
}: {
  askDisabled: boolean;
  canSaveForChat: boolean;
  lookupId: string | null;
  onSaveAndAsk: () => void;
  onSaveOnly: () => void;
}) {
  let askAction = null;
  if (askDisabled) {
    askAction = (
      <button className="rounded-full bg-[var(--ds-surface)] px-4 py-3 text-center text-sm font-extrabold text-[var(--ds-fg-3)]" type="button" disabled aria-describedby="ask-save-required">
        Ask DeepSpec
      </button>
    );
  } else if (lookupId) {
    askAction = (
      <Link className="rounded-full border border-white/70 bg-[linear-gradient(180deg,#fff,#dce4eb)] px-4 py-3 text-center text-sm font-extrabold text-[#0b1520] shadow-[inset_0_1px_0_#fff,0_6px_18px_rgba(0,0,0,.18)]" to={`/result/${lookupId}/chat`}>
        Ask DeepSpec
      </Link>
    );
  } else if (canSaveForChat) {
    askAction = (
      <button className="rounded-full border border-white/70 bg-[linear-gradient(180deg,#fff,#dce4eb)] px-4 py-3 text-center text-sm font-extrabold text-[#0b1520] shadow-[inset_0_1px_0_#fff,0_6px_18px_rgba(0,0,0,.18)]" type="button" onClick={onSaveAndAsk}>
        Ask DeepSpec
      </button>
    );
  }

  return (
    <div className="mt-4 grid grid-cols-2 gap-2">
      {askDisabled ? <p id="ask-save-required" className="col-span-2 text-xs font-semibold text-[var(--ds-fg-3)]">Retry saving the scan result to enable Ask.</p> : null}
      {askAction ?? <span aria-hidden className="rounded-full bg-[var(--ds-surface)] px-4 py-3" />}
      <button
        className="rounded-full bg-[var(--ds-surface)] px-4 py-3 text-center text-sm font-extrabold text-[var(--ds-fg-1)] disabled:text-[var(--ds-fg-3)]"
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
    <section className="px-1 py-2 text-[11px] leading-5 text-[var(--ds-fg-3)]">
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
  vehicleContext,
  onLookupRetrySuccess,
  onScanRetrySuccess,
}: {
  capturedAt: string | null;
  captureMode: "camera" | "upload";
  code?: string;
  frame: CapturedFrame | null | undefined;
  lookup: Lookup | null;
  vehicleContext?: Lookup["vehicleContext"];
  message: string;
  onLookupRetrySuccess: (updatedLookup: Lookup, warning?: string) => void;
  onScanRetrySuccess: (scanState: ScanAnalysisState) => void;
}) {
  const [isOnline, setIsOnline] = useState(() => typeof navigator !== "undefined" ? navigator.onLine : true);
  const [isRetrying, setIsRetrying] = useState(false);
  const [mountedScope] = useState(getAccountScope);
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
    const scope = mountedScope;
    const retryFrame = lookup?.frame ?? frame;
    if (!retryFrame || isRetrying || !isAccountScopeCurrent(scope)) return;
    setIsRetrying(true);
    setRetryError(null);
    const attemptId = createAnalysisAttemptId();

    try {
      const identificationFrame = await prepareRetryFrame(retryFrame);
      if (!isAccountScopeCurrent(scope)) return;
      const result = applyShopFitmentContext(await identifyCapturedFrame(identificationFrame, undefined, undefined, { vehicleContext }), vehicleContext);
      if (!isAccountScopeCurrent(scope)) return;
      if (lookup) {
        const updateResult = updateLookupResult(lookup.id, result, {
          analysisSource: "manual_retry",
          savedAt: new Date().toISOString(),
        }, identificationFrame);
        if (updateResult.value) {
          onLookupRetrySuccess(updateResult.value, updateResult.ok ? undefined : updateResult.message);
        } else {
          setRetryError(updateResult.ok ? "This saved scan was not found." : updateResult.message);
        }
      } else {
        onScanRetrySuccess({
          frame: identificationFrame,
          result,
          analysisAttemptId: attemptId,
          vehicleContext,
          analyzedAt: new Date().toISOString(),
          provenance: {
            analysisSource: "manual_retry",
            captureMode,
            savedAt: new Date().toISOString(),
          },
        });
      }
    } catch (err) {
      if (isAccountScopeCurrent(scope)) {
        const message = getAIErrorMessage(err);
        setRetryError(message);
        if (lookup) {
          const saved = recordLookupAnalysisFailure(lookup.id, { attemptId,
            errorCode: err instanceof AIServiceError ? err.code : "analysis_failed",
            errorMessage: message, attemptedAt: new Date().toISOString() }, lookup);
          if (!saved.ok) setRetryError(`${message} ${saved.message}`);
          else if (saved.value) void syncAnalysisFailuresToCloud(saved.value);
        }
      }
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
      <p className="mt-3 text-sm leading-6 text-[var(--ds-fg-2)]">{message}</p>
      <p className="mt-3 text-sm leading-6 text-[var(--ds-fg-2)]">{errorDetails.description}</p>
      {capturedAt ? <p className="mt-3 text-xs font-semibold text-[var(--ds-fg-3)]">Captured {capturedAt}</p> : null}

      {frame ? (
        <div className="mt-4 border-t border-[var(--ds-border)] pt-4">
          <p className="text-xs font-semibold text-[var(--ds-fg-3)]">
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
    <section className="rounded-[22px] border border-[var(--ds-border)] bg-[var(--ds-elevated)] p-4">
      <p className="text-sm font-bold text-[#a7cbd4]">Not analyzed yet</p>
      <h2 className="mt-2 text-xl font-extrabold tracking-tight">Scan again to identify this</h2>
      <p className="mt-3 text-sm leading-6 text-[var(--ds-fg-3)]">
        The frame is here, but no result is attached yet.
      </p>
      {capturedAt ? <p className="mt-3 text-xs font-semibold text-[var(--ds-fg-3)]">Captured {capturedAt}</p> : null}
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
