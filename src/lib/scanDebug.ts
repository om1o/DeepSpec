import type { ScanDebugInfo } from "../types";

// Collects isolation diagnostics for the latest scan so the UI can show them without a
// console. One scan runs at a time, so a module-level record is enough.
let current: ScanDebugInfo = {};

export function resetScanDebug(): void {
  current = {};
}

export function recordScanDebug(patch: Partial<ScanDebugInfo>): void {
  current = { ...current, ...patch };
}

export function getScanDebug(): ScanDebugInfo {
  return { ...current };
}

type ScanDebugEnv = { VITE_DEEPSPEC_DEBUG?: string };

export function isScanDebugEnabled(env: ScanDebugEnv = import.meta.env as ScanDebugEnv): boolean {
  const setting = env.VITE_DEEPSPEC_DEBUG?.trim().toLowerCase();
  return setting === "on" || setting === "true" || setting === "1";
}
