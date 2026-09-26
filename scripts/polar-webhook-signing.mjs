// Polar's unprefixed secrets are raw signing keys; whsec_ secrets carry base64.
// Keep verifier signatures representative of the matching API verification path.
export function getPolarWebhookSigningKey(webhookSecret) {
  const secret = String(webhookSecret ?? "").trim();
  if (!secret) return null;
  const key = secret.startsWith("whsec_")
    ? Buffer.from(secret.slice("whsec_".length), "base64")
    : Buffer.from(secret, "utf8");
  return key.length > 0 ? key : null;
}
