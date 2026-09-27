import { getAccountScope, isAccountScopeCurrent, type AccountScope } from "../lib/accountScope";
import { identifyCapturedFrame } from "./aiService";
import { applyShopFitmentContext } from "../lib/shopFitmentContext";
import { getLookups, updateLookupResult } from "./storage";
import type { Lookup } from "../types";

let activeUpgrade: { scope: AccountScope; promise: Promise<number> } | null = null;

// Saved scans that were identified by the on-device model while offline.
export function getOfflineEstimateLookups(): Lookup[] {
  return getLookups().filter((lookup) => lookup.result?.modelRun?.provider === "on-device");
}

// Only call from an explicit user action: cloud requests may consume credits.
// Re-run each offline estimate through the cloud chain and replace it.
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
      const result = applyShopFitmentContext(await identifyCapturedFrame(lookup.frame, undefined, undefined, {
        vehicleContext: lookup.vehicleContext,
      }), lookup.vehicleContext);
      if (!isAccountScopeCurrent(scope)) break;
      if (result.modelRun?.provider && result.modelRun.provider !== "on-device") {
        const saved = updateLookupResult(lookup.id, result, {
          analysisSource: "offline_upgrade",
          savedAt: new Date().toISOString(),
        });
        if (saved.ok && saved.value) upgraded += 1;
      }
    } catch {
      // Leave the estimate in place; another attempt requires an explicit action.
    }
  }

  return upgraded;
}
