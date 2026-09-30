export function assertPrivateStorageDenied(result) {
  if (!result.error) throw new Error("Storage isolation failed: another account could download the private image.");
  const status = Number(result.error.statusCode ?? result.error.status);
  if (![400, 403, 404].includes(status) || !/not found|not authorized|permission|access denied|forbidden|row.level security/i.test(result.error.message ?? "")) {
    throw new Error("Storage isolation inconclusive: the request failed without an explicit object-access denial. Check auth and service health before claiming isolation passed.");
  }
}
