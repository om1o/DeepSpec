// Read-only preflight using the browser's actual signed-in account. No admin key,
// credit reset, synthetic paid entitlement, or identification request is used.
export async function assertQaScanAccess(page) {
  const result = await page.evaluate(async () => {
    try {
      const sessions = Object.keys(localStorage)
        .filter((key) => /^sb-.+-auth-token$/.test(key))
        .map((key) => JSON.parse(localStorage.getItem(key)))
        .filter((session) => session?.access_token && session?.user?.id);
      if (sessions.length !== 1) return null;
      const session = sessions[0];
      const response = await fetch("/api/account-entitlement", {
        headers: { Authorization: `Bearer ${session.access_token}` },
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) return null;
      const { qaScanAccess } = await response.json();
      // Return only access evidence; never send session credentials to reports.
      return qaScanAccess?.userId === session.user.id ? qaScanAccess : null;
    } catch {
      return null;
    }
  });
  const remaining = Date.parse(result?.expiresAt) - Date.now();
  if (result?.mode !== "non-production" || !Number.isFinite(remaining) || remaining <= 0 || remaining > 86_400_000) {
    throw new Error("QA scan access is not active for this session. No test image was submitted. Configure the dedicated non-production account and expiring server authorization in docs/REPEATABLE_WEBSITE_QA.md.");
  }
  return result;
}
