import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { useEffect, useState } from "react";
import { getAIErrorMessage, identifyCapturedFrame } from "../services/aiService";
import Button from "../components/ui/Button";
import { isTestMode } from "../lib/testMode";
import { readLatestCapturedFrame, readLatestScanState, saveLatestScanState } from "../lib/utils";
import { getCloudSyncStatus, syncLookupToCloud } from "../services/cloudSync";
import { buildScanReport, downloadTextFile, getMechanicSearchUrl, getScanReportFilename } from "../services/report";
import { deleteLookup, getLookup, scanStateFromLookup, updateLookup, updateLookupResult } from "../services/storage";
import type { CandidateMatch, CapturedFrame, Confidence, EvidenceRegion, IdentificationResult, Lookup, Rating, ScanAnalysisState, SourceLink } from "../types";

type DetectedTextFinding = {
  codes: string[];
  searchUrl: string;
  text: string;
};

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
  const datasetSourceUrls = scanState?.result ? getDatasetSourceUrls(scanState.result.evidence) : [];

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
      <div className="mx-auto grid min-h-dvh w-full max-w-6xl lg:grid-cols-[minmax(0,1fr)_430px] lg:p-4">
        <section className="relative min-h-[48dvh] overflow-hidden bg-[#020617] text-white lg:sticky lg:top-4 lg:min-h-[calc(100dvh-32px)] lg:rounded-[30px]">
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
          <FocusFrame isVisible={Boolean(frame?.imageBase64)} />
          <ImageEvidenceCallouts regions={scanState?.result?.evidenceRegions} />
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_bottom,rgba(2,6,23,0.68),rgba(2,6,23,0.04)_38%,rgba(2,6,23,0.82))]" />
          <header className="absolute left-0 right-0 top-0 z-10 flex items-center justify-between px-4 pt-[max(18px,env(safe-area-inset-top))]">
            <img src="/brand/deepspec-logo.png" alt="Deep Spec" className="h-11 w-32 rounded-xl bg-white object-contain p-1 shadow-sm ring-1 ring-white/30" />
            <Link to="/scan" className="rounded-full bg-white/90 px-4 py-2 text-sm font-bold text-slate-800 shadow-sm ring-1 ring-white/40 backdrop-blur-md">
              Back
            </Link>
          </header>
          <div className="absolute bottom-8 left-0 right-0 z-10 px-4">
            <p className="text-xs font-extrabold uppercase tracking-[0.16em] text-[var(--ds-accent)]">Scanned photo</p>
            <h1 className="mt-2 truncate text-3xl font-extrabold tracking-tight text-white">
              {scanState?.result ? scanState.result.partName : "Captured frame"}
            </h1>
            {scanState?.result ? (
              <p className="mt-2 text-sm font-semibold text-white/72">
                {scanState.result.confidence} confidence / {scanState.result.scanCategory}
              </p>
            ) : null}
          </div>
        </section>

        <div className="relative z-10 -mt-7 rounded-t-[30px] bg-[var(--ds-page)] px-4 pb-8 pt-4 shadow-[0_-18px_48px_rgba(2,6,23,0.18)] lg:my-8 lg:-ml-10 lg:max-h-[calc(100dvh-64px)] lg:overflow-y-auto lg:rounded-[30px] lg:border lg:border-white/60 lg:shadow-[0_24px_70px_rgba(2,6,23,0.28)]">
          <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-slate-300 lg:hidden" />
          <div className="space-y-3">
          {isQaTestRun ? <TestRunNotice label={scanState?.testVehicleLabel} /> : null}
          {!isQaTestRun && storageWarning ? <StorageWarning message={storageWarning} /> : null}
          {scanState?.result ? <AnalysisResult result={scanState.result} capturedAt={capturedAt} lookupId={lookup?.id ?? null} /> : null}
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
          {datasetSourceUrls.length > 0 ? <SourceFinePrint urls={datasetSourceUrls} /> : null}
        </div>

        <Button className="mt-6 w-full" onClick={() => window.location.assign("/")}>
          Try another scan
        </Button>
        </div>
      </div>
    </main>
  );
}

function FocusFrame({ isVisible }: { isVisible: boolean }) {
  if (!isVisible) {
    return null;
  }

  return (
    <div className="pointer-events-none absolute left-1/2 top-1/2 z-10 aspect-[4/3] w-[min(74vw,420px)] -translate-x-1/2 -translate-y-1/2 rounded-[24px] border border-white/32 shadow-[0_0_0_999px_rgba(2,6,23,0.08),0_0_34px_rgba(11,116,255,0.24)]">
      <div className="absolute -left-1 -top-1 size-8 rounded-tl-[24px] border-l-4 border-t-4 border-[var(--ds-accent)]" />
      <div className="absolute -right-1 -top-1 size-8 rounded-tr-[24px] border-r-4 border-t-4 border-[var(--ds-accent)]" />
      <div className="absolute -bottom-1 -left-1 size-8 rounded-bl-[24px] border-b-4 border-l-4 border-[var(--ds-accent)]" />
      <div className="absolute -bottom-1 -right-1 size-8 rounded-br-[24px] border-b-4 border-r-4 border-[var(--ds-accent)]" />
      <span className="absolute left-1/2 top-[calc(100%+12px)] -translate-x-1/2 rounded-full bg-black/56 px-3 py-1 text-[11px] font-extrabold uppercase tracking-[0.16em] text-white/88 ring-1 ring-white/12 backdrop-blur-md">
        Scanned area
      </span>
    </div>
  );
}

function ImageEvidenceCallouts({ regions }: { regions: EvidenceRegion[] | undefined }) {
  const callouts = regions?.slice(0, 3) ?? [];
  if (!callouts.length) {
    return null;
  }

  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      {callouts.map((region) => (
        <div
          key={`${region.regionLabel}-${region.label}`}
          className={`absolute max-w-[190px] rounded-2xl border border-white/30 bg-slate-950/72 px-3 py-2 text-white shadow-[0_14px_34px_rgba(0,0,0,0.28)] backdrop-blur-md ${getEvidenceCalloutPosition(region.regionLabel)}`}
        >
          <p className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-white/62">{region.regionLabel}</p>
          <p className="mt-1 truncate text-xs font-extrabold">{region.label}</p>
        </div>
      ))}
    </div>
  );
}

function getEvidenceCalloutPosition(regionLabel: string) {
  const label = regionLabel.toLowerCase();
  if (/upper|top/.test(label) && /left/.test(label)) return "left-[8%] top-[22%]";
  if (/upper|top/.test(label) && /right/.test(label)) return "right-[8%] top-[22%]";
  if (/lower|bottom/.test(label) && /left/.test(label)) return "bottom-[24%] left-[8%]";
  if (/lower|bottom/.test(label) && /right/.test(label)) return "bottom-[24%] right-[8%]";
  if (/left/.test(label)) return "left-[8%] top-1/2 -translate-y-1/2";
  if (/right/.test(label)) return "right-[8%] top-1/2 -translate-y-1/2";
  if (/lower|bottom/.test(label)) return "bottom-[24%] left-1/2 -translate-x-1/2";
  if (/upper|top/.test(label)) return "left-1/2 top-[22%] -translate-x-1/2";
  return "left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2";
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
    <section className="rounded-[22px] border border-neutral-200 bg-white p-4">
      <p className="text-sm font-extrabold text-neutral-900">Saved scan</p>
      <p className="mt-2 text-sm leading-6 text-neutral-500">
        Your rating, correction, and notes stay on this device and help improve future results.
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

function AnalysisResult({
  capturedAt,
  lookupId,
  result,
}: {
  capturedAt: string | null;
  lookupId: string | null;
  result: IdentificationResult;
}) {
  const showSafetyWarning = result.isSafetyCritical || result.safetyTriage === "needs_professional";
  const trustReview = getTrustReview(result);
  const needsBetterPhoto = result.needsBetterPhoto || result.safetyTriage === "needs_better_photo";

  return (
    <>
      <section className="rounded-[24px] border border-neutral-200 bg-white p-4 shadow-[0_12px_34px_rgba(15,23,42,0.08)]">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-extrabold uppercase tracking-[0.16em] text-[var(--ds-accent)]">Best match</p>
            <h2 className="mt-1 truncate text-2xl font-extrabold tracking-tight">{result.partName}</h2>
          </div>
          <ConfidenceBadge confidence={result.confidence} />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <MiniPill label={result.scanCategory} />
          <MiniPill label={trustReview.status} />
        </div>
        <p className="mt-3 text-sm leading-6 text-neutral-600">{trustReview.description}</p>
        {capturedAt ? <p className="mt-3 text-xs font-semibold text-neutral-400">Captured {capturedAt}</p> : null}
        <QuickActions lookupId={lookupId} result={result} />
      </section>

      {showSafetyWarning ? (
        <section className="rounded-[22px] border border-[var(--ds-warn-line)] bg-[var(--ds-warn-soft)] p-4">
          <p className="text-sm font-extrabold text-[var(--ds-warn-ink)]">Professional check needed</p>
          <p className="mt-2 text-sm leading-6 text-neutral-700">
            Verify this before driving or attempting repair. The scan can explain visible clues, but this category can affect safety.
          </p>
        </section>
      ) : null}

      {needsBetterPhoto ? (
        <section className="rounded-[22px] border border-neutral-200 bg-neutral-50 p-4">
          <p className="text-sm font-extrabold text-neutral-900">Better photo needed</p>
          <p className="mt-2 text-sm leading-6 text-neutral-500">
            Move closer, add light, and center any label, connector, hose, or damaged area in the lens frame.
          </p>
        </section>
      ) : null}

      <CandidateMatchesSection candidates={result.candidateMatches ?? []} />
      <DetectedTextSection findings={getDetectedTextFindings(result)} />
      <ResultSection title="Match" items={[result.whatItDoes]} />
      <EvidenceRegionsSection regions={result.evidenceRegions ?? []} />
      <EvidenceSection items={result.evidence} />
      <ResultSection title="Concerns" items={result.concerns} emptyText="Nothing concerning visible." />
      <ResultSection title="Next action" items={[result.nextAction]} />
      <FollowUpSuggestions lookupId={lookupId} result={result} />
      <ReferenceLinksSection links={getReferenceLinks(result)} />
    </>
  );
}

function CandidateMatchesSection({ candidates }: { candidates: CandidateMatch[] }) {
  if (!candidates.length) {
    return null;
  }

  return (
    <section className="rounded-[22px] border border-neutral-200 bg-white p-4">
      <h2 className="text-sm font-extrabold uppercase tracking-[0.14em] text-neutral-500">Other possible matches</h2>
      <div className="mt-3 grid grid-cols-1 gap-2">
        {candidates.map((candidate) => (
          <div key={`${candidate.partName}-${candidate.reason}`} className="rounded-2xl border border-neutral-200 bg-neutral-50 px-3 py-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-extrabold text-neutral-900">{candidate.partName}</p>
              <span className="shrink-0 rounded-full bg-white px-2 py-1 text-[11px] font-extrabold capitalize text-neutral-500 ring-1 ring-neutral-200">
                {candidate.confidence}
              </span>
            </div>
            <p className="mt-1 text-xs font-semibold capitalize text-neutral-400">{candidate.scanCategory}</p>
            <p className="mt-2 text-sm leading-5 text-neutral-600">{candidate.reason}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

type TrustReview = {
  description: string;
  status: string;
};

function MiniPill({ label }: { label: string }) {
  return (
    <span className="rounded-full border border-neutral-200 bg-neutral-50 px-3 py-1 text-xs font-extrabold capitalize text-neutral-600">
      {label.replaceAll("_", " ")}
    </span>
  );
}

function QuickActions({ lookupId, result }: { lookupId: string | null; result: IdentificationResult }) {
  const nearbyUrl = getMapsSearchUrl(result);

  return (
    <div className="mt-4 grid grid-cols-3 gap-2">
      <Link className="rounded-full bg-neutral-100 px-3 py-2 text-center text-xs font-extrabold text-neutral-900" to="/scan">
        Refine
      </Link>
      {lookupId ? (
        <Link className="rounded-full bg-[var(--ds-accent)] px-3 py-2 text-center text-xs font-extrabold text-white" to={`/result/${lookupId}/chat`}>
          Ask
        </Link>
      ) : (
        <Link className="rounded-full bg-[var(--ds-accent)] px-3 py-2 text-center text-xs font-extrabold text-white" to="/history">
          History
        </Link>
      )}
      <a
        className="rounded-full bg-neutral-100 px-3 py-2 text-center text-xs font-extrabold text-neutral-900"
        href={nearbyUrl}
        rel="noreferrer"
        target="_blank"
      >
        Nearby
      </a>
    </div>
  );
}

function DetectedTextSection({ findings }: { findings: DetectedTextFinding[] }) {
  if (!findings.length) {
    return null;
  }

  return (
    <section aria-labelledby="detected-text-heading" className="rounded-[22px] border border-[var(--ds-evidence-line)] bg-[var(--ds-evidence-soft)] p-4">
      <h2 id="detected-text-heading" className="text-sm font-extrabold uppercase tracking-[0.14em] text-[var(--ds-evidence-ink)]">Text found</h2>
      <div className="mt-3 grid grid-cols-1 gap-3">
        {findings.map((finding) => (
          <article key={finding.text} className="rounded-2xl border border-[var(--ds-evidence-line)] bg-white px-3 py-3">
            <p className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-neutral-400">Visible label</p>
            <p className="mt-2 break-words font-mono text-base font-extrabold leading-6 text-neutral-950">{finding.text}</p>
            {finding.codes.length ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {finding.codes.map((code) => (
                  <span key={code} className="rounded-full border border-neutral-200 bg-neutral-50 px-3 py-1 text-xs font-extrabold text-neutral-700">
                    {code}
                  </span>
                ))}
              </div>
            ) : null}
            <a
              className="mt-3 inline-flex rounded-full bg-[var(--ds-accent)] px-4 py-2 text-xs font-extrabold text-white"
              href={finding.searchUrl}
              rel="noreferrer"
              target="_blank"
            >
              Search text
            </a>
          </article>
        ))}
      </div>
    </section>
  );
}

function FollowUpSuggestions({ lookupId, result }: { lookupId: string | null; result: IdentificationResult }) {
  const prompts = getFollowUpPrompts(result);

  return (
    <section className="rounded-[22px] border border-neutral-200 bg-white p-4">
      <h2 className="text-sm font-extrabold uppercase tracking-[0.14em] text-neutral-500">Ask next</h2>
      <div className="mt-3 grid grid-cols-1 gap-2">
        {prompts.map((prompt) => (
          lookupId ? (
            <Link
              key={prompt.question}
              className="rounded-2xl border border-neutral-200 bg-neutral-50 px-3 py-3 text-sm font-bold leading-5 text-[var(--ds-evidence-ink)]"
              to={`/result/${lookupId}/chat?q=${encodeURIComponent(prompt.question)}`}
            >
              {prompt.label}
            </Link>
          ) : (
            <span
              key={prompt.question}
              className="rounded-2xl border border-neutral-200 bg-neutral-50 px-3 py-3 text-sm font-bold leading-5 text-neutral-400"
            >
              {prompt.label}
            </span>
          )
        ))}
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
  const visibleItems = items.map(formatEvidenceItem).filter(Boolean);

  return (
    <section className="rounded-[22px] border border-neutral-200 bg-white p-4">
      <h2 className="text-sm font-extrabold uppercase tracking-[0.14em] text-neutral-500">Visual clues</h2>
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

function EvidenceRegionsSection({ regions }: { regions: EvidenceRegion[] }) {
  if (!regions.length) {
    return null;
  }

  return (
    <section className="rounded-[22px] border border-neutral-200 bg-white p-4">
      <h2 className="text-sm font-extrabold uppercase tracking-[0.14em] text-neutral-500">Image evidence</h2>
      <div className="mt-3 grid grid-cols-1 gap-2">
        {regions.map((region) => (
          <div key={`${region.label}-${region.observation}`} className="rounded-2xl border border-[var(--ds-evidence-line)] bg-[var(--ds-evidence-soft)] px-3 py-3">
            <p className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-[var(--ds-evidence-ink)]">{region.regionLabel}</p>
            <p className="mt-1 text-sm font-extrabold text-neutral-900">{region.label}</p>
            <p className="mt-1 text-sm leading-5 text-neutral-700">{region.observation}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function formatEvidenceItem(item: string) {
  const cleaned = item.trim();
  if (!cleaned || /^Dataset source:|^OCR label text:/i.test(cleaned)) {
    return "";
  }

  return cleaned
    .replace(/^Local dataset match:\s*/i, "Similar dataset sample: ");
}

type ReferenceLink = Pick<SourceLink, "label" | "sourceType" | "url">;

function ReferenceLinksSection({ links }: { links: ReferenceLink[] }) {
  return (
    <section className="rounded-[22px] border border-neutral-200 bg-white p-4">
      <h2 className="text-sm font-extrabold uppercase tracking-[0.14em] text-neutral-500">Ranked sources</h2>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {links.map((link) => (
          <a
            key={link.url}
            className="rounded-2xl border border-neutral-200 bg-neutral-50 px-3 py-3 text-sm font-bold leading-5 text-[var(--ds-evidence-ink)]"
            href={link.url}
            rel="noreferrer"
            target="_blank"
          >
            {link.label}
            <span aria-hidden="true" className="mt-1 block text-[11px] font-extrabold uppercase tracking-[0.12em] text-neutral-400">
              {link.sourceType}
            </span>
          </a>
        ))}
      </div>
    </section>
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
    <section className="rounded-[22px] border border-neutral-200 bg-white p-4">
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
    <section className="rounded-[22px] border border-neutral-200 bg-white p-4">
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
  const sourceLinks = (result.sourceLinks ?? []).filter((link) => /^https:\/\//.test(link.url));
  const defaults: ReferenceLink[] = [
    {
      label: "Nearby help",
      sourceType: "search",
      url: getMapsSearchUrl(result),
    },
    {
      label: "Report safety issue",
      sourceType: "safety",
      url: "https://www.nhtsa.gov/report-a-safety-problem",
    },
  ];

  return uniqueReferenceLinks([...sourceLinks, ...defaults]).slice(0, 6);
}

function uniqueReferenceLinks(links: ReferenceLink[]) {
  const seen = new Set<string>();
  const unique: ReferenceLink[] = [];

  for (const link of links) {
    const key = link.url.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(link);
  }

  return unique;
}

function getFollowUpPrompts(result: IdentificationResult) {
  const partName = result.partName;
  const prompts = [
    {
      label: "What should I check next?",
      question: `What should I check next for this ${partName}?`,
    },
    {
      label: "How serious is this?",
      question: `How serious is this ${partName} result based only on the photo?`,
    },
  ];

  prompts.push(
    result.needsBetterPhoto || result.safetyTriage === "needs_better_photo"
      ? {
          label: "What photo angle would help?",
          question: `What photo angle would help identify this ${partName} better?`,
        }
      : {
          label: "What symptoms match this part?",
          question: `What common symptoms connect to this ${partName}?`,
        },
  );

  return prompts;
}

function getMapsSearchUrl(result: IdentificationResult) {
  const query = encodeURIComponent(`${result.scanCategory} ${result.partName} auto repair near me`);
  return `https://www.google.com/maps/search/?api=1&query=${query}`;
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

function getDetectedTextFindings(result: IdentificationResult): DetectedTextFinding[] {
  const seen = new Set<string>();
  const findings: DetectedTextFinding[] = [];

  for (const item of result.evidence) {
    const text = getOcrEvidenceText(item);
    if (!text) continue;

    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    findings.push({
      codes: getLikelyCodeTokens(text),
      searchUrl: getTextSearchUrl(text, result.partName),
      text,
    });
  }

  return findings.slice(0, 3);
}

function getOcrEvidenceText(item: string) {
  const match = item.match(/^OCR label text:\s*(.+)$/i);
  const text = match?.[1]?.replace(/\s+/g, " ").trim();
  return text || null;
}

function getLikelyCodeTokens(text: string) {
  const tokens = text.match(/\b[A-Z0-9][A-Z0-9./#:-]{3,}[A-Z0-9]\b/gi) ?? [];
  const seen = new Set<string>();
  const codes: string[] = [];

  for (const token of tokens) {
    const normalized = token.toUpperCase();
    if (seen.has(normalized)) continue;
    if (!/\d/.test(normalized) || !/[A-Z./#:-]/.test(normalized)) continue;
    seen.add(normalized);
    codes.push(normalized);
  }

  return codes.slice(0, 4);
}

function getTextSearchUrl(text: string, partName: string) {
  const query = encodeURIComponent(`${text} ${partName} car part`);
  return `https://www.google.com/search?q=${query}`;
}

function getTrustReview(result: IdentificationResult): TrustReview {
  if (result.safetyTriage === "needs_professional" || result.isSafetyCritical) {
    return {
      description:
        "Deep Spec can explain the visible clues, but this category can affect driving safety. Do not treat this as repair approval.",
      status: "Professional verification needed",
    };
  }

  if (result.safetyTriage === "needs_better_photo" || result.needsBetterPhoto) {
    return {
      description: "The image does not give Deep Spec enough reliable detail. A better photo matters more than another guess.",
      status: "Incomplete data",
    };
  }

  if (result.confidence === "low") {
    return {
      description: "The app found some clues, but not enough to make a strong identification.",
      status: "Low-confidence result",
    };
  }

  if (result.confidence === "medium") {
    return {
      description: "This is useful for understanding the part, but one more angle would make the result stronger.",
      status: "Check another angle",
    };
  }

  return {
    description: "The image has enough visual evidence for a useful consumer-level explanation.",
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
