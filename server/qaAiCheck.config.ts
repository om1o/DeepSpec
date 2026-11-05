// Temporary server-only check. The random bearer is held outside the repository.
export const QA_AI_CHECK_BRANCH = "codex/pilot-assembled-20261103";
export const QA_AI_CHECK_EXPIRES_AT = "2026-11-05T04:00:00.000Z";
export const QA_AI_CHECK_TOKEN_SHA256 = "395df9b5b793673d724776b15e58c9b13f0c76cee25d9461f5cb775b47a5e102";
export const QA_AI_CHECK_FIXTURES = [
  {
    "id": "commons-engine-bay",
    "bytes": 359688,
    "sha256": "1dc22ccfa8700c0a0d1af7c8ef3b81e9655a0cca7356c334d3f99fad46d05294",
    "question": "What visible evidence supports this identification, and what cannot this photo establish?"
  },
  {
    "id": "commons-disc-brake",
    "bytes": 259037,
    "sha256": "7655f44117bbd48384ebc347e4d43237d181ff2c88908139a2fa7565f9e91026",
    "question": "What does this assembly do, and can its operating condition be confirmed from this image?"
  }
] as const;
