import { useState } from "react";
import Button from "./ui/Button";
import {
  getCloudHealthSnapshot,
  verifyCloudHealth,
  type CloudHealthCheck,
  type CloudHealthReport,
  type CloudHealthStepStatus,
} from "../services/cloudSync";

const CLOUD_HEALTH_STEPS = [
  "configured",
  "anonymousAuth",
  "storageUpload",
  "rowUpsert",
  "rlsIsolation",
] as const;

export default function CloudHealthCard({ className = "" }: { className?: string }) {
  const [report, setReport] = useState<CloudHealthReport>(() => getCloudHealthSnapshot());
  const [isChecking, setIsChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);

  async function handleCheckHealth() {
    setIsChecking(true);
    setCheckError(null);
    try {
      setReport(await verifyCloudHealth());
    } catch (error) {
      setCheckError(error instanceof Error ? error.message : "Cloud health check failed.");
    } finally {
      setIsChecking(false);
    }
  }

  return (
    <section className={`rounded-[20px] border border-neutral-200 bg-neutral-50 p-4 ${className}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-extrabold text-neutral-900">Cloud health</p>
          <p className="mt-2 text-sm leading-6 text-neutral-500">{report.message}</p>
        </div>
        <StatusPill status={report.overall === "ready" ? "pass" : report.overall === "unknown" ? "unknown" : "fail"} />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-2">
        {CLOUD_HEALTH_STEPS.map((step) => (
          <HealthRow key={step} check={report.checks[step]} />
        ))}
        <div className="rounded-2xl border border-neutral-200 bg-white px-3 py-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-extrabold uppercase tracking-[0.14em] text-neutral-400">Last verified</p>
            <StatusPill status={report.lastVerifiedAt ? "pass" : "unknown"} />
          </div>
          <p className="mt-1 text-sm leading-6 text-neutral-700">
            {report.lastVerifiedAt ? formatHealthTime(report.lastVerifiedAt) : "Never"}
          </p>
        </div>
      </div>

      <Button
        className="mt-4 w-full !bg-neutral-100 !text-neutral-900 shadow-none"
        disabled={!report.configured || isChecking}
        onClick={handleCheckHealth}
      >
        {isChecking ? "Checking..." : "Check cloud health"}
      </Button>
      {checkError ? <p className="mt-3 text-sm font-semibold text-[var(--ds-danger-ink)]">{checkError}</p> : null}
    </section>
  );
}

function HealthRow({ check }: { check: CloudHealthCheck }) {
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white px-3 py-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-extrabold uppercase tracking-[0.14em] text-neutral-400">{check.label}</p>
        <StatusPill status={check.status} />
      </div>
      <p className="mt-1 text-sm leading-6 text-neutral-700">{check.message}</p>
    </div>
  );
}

function StatusPill({ status }: { status: CloudHealthStepStatus }) {
  const label = status === "pass" ? "OK" : status === "fail" ? "Blocked" : "Unknown";
  const className =
    status === "pass"
      ? "border-[var(--ds-ok-line)] bg-[var(--ds-ok-soft)] text-[var(--ds-ok-ink)]"
      : status === "fail"
        ? "border-[var(--ds-danger-line)] bg-[var(--ds-danger-soft)] text-[var(--ds-danger-ink)]"
        : "border-neutral-200 bg-neutral-100 text-neutral-500";

  return (
    <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-[0.12em] ${className}`}>
      {label}
    </span>
  );
}

function formatHealthTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString();
}
