import { getAccountScope, isAccountScopeCurrent, type AccountScope } from "../lib/accountScope";
import { identifyCapturedFrame } from "./aiService";
import { isOnDeviceFallbackEnabled } from "./onDeviceIdentify";
import { getLookups, updateLookupResult } from "./storage";
import type { Lookup } from "../types";

let activeUpgrade: { scope: AccountScope; promise: Promise<number> } | null = null;

// Saved scans that were identified by the on-device model while offline.
export function getOfflineEstimateLookups(): Lookup[] {
  return getLookups().filter((lookup) => lookup.result?.modelRun?.provider === "on-device");
}

// Re-run each offline estimate through the cloud chain (full quality) and replace it.
// A scan is only replaced when the cloud actually answers with a non-on-device result,
// so a still-offline retry never overwrites the estimate with another estimate.
export async function upgradeOfflineEstimates(): Promise<number> {
  const scope = getAccountScope();
  if (!isAccountScopeCurrent(scope)) return 0;
  if (activeUpgrade && isAccountScopeCurrent(activeUpgrade.scope)) return activeUpgrade.promise;

  const promise = runOfflineEstimateUpgrade(scope).finally(() => {
    if (activeUpgrade?.promise === promise) activeUpgrade = null;
  });
  activeUpgrade = { scope, promise };
  return promise;
}

async function runOfflineEstimateUpgrade(scope: AccountScope): Promise<number> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return 0;
  }

  let upgraded = 0;
  for (const lookup of getOfflineEstimateLookups()) {
    if (!isAccountScopeCurrent(scope)) break;
    try {
      const result = await identifyCapturedFrame(lookup.frame);
      if (!isAccountScopeCurrent(scope)) break;
      if (result.modelRun?.provider && result.modelRun.provider !== "on-device") {
        updateLookupResult(lookup.id, result, {
          analysisSource: "offline_upgrade",
          savedAt: new Date().toISOString(),
        });
        upgraded += 1;
      }
    } catch {
      // Leave the estimate in place and try again on the next reconnect.
    }
  }

  return upgraded;
}

// Watch for the device coming back online and upgrade any pending estimates.
// No-op unless the on-device fallback is enabled. Returns a cleanup function.
export function startOfflineUpgradeWatcher(): () => void {
  if (typeof window === "undefined" || !isOnDeviceFallbackEnabled()) {
    return () => {};
  }

  const scope = getAccountScope();
  const handler = () => {
    if (!isAccountScopeCurrent(scope)) return;
    void upgradeOfflineEstimates();
  };
  window.addEventListener("online", handler);

  if (navigator.onLine && isAccountScopeCurrent(scope)) {
    void upgradeOfflineEstimates();
  }

  return () => window.removeEventListener("online", handler);
}
