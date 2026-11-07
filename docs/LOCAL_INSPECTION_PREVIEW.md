# Preview with inspection cloud sync disabled

Set the non-secret build variable `VITE_ENABLE_CLOUD_SYNC=false` on the intended Preview branch before building. This keeps new inspection records in the browser and disables inspection cloud sync/history independently of Supabase sign-in. Leaving the variable unset or true preserves the existing configured cloud behavior.

Use this mode when validating online photo identification and follow-up chat before the inspection database migrations are ready. Keep the normal public Supabase URL/publishable key and server-side Gemini/Supabase credentials in their established scopes. Do not put a server secret in a `VITE_` variable or remove authentication configuration to disable sync.

This is not offline AI or a security boundary. Images, prompts and context still reach the configured AI provider through the normal authenticated API. Sign-in, ordinary scan-credit and rate-limit records, and service metadata logs remain active. Previously cached remote image references may still be rendered by the browser. No new inspection cloud save, cloud restore or cross-device persistence is established by a local save.

The interface must show device-only saving and unavailable cloud controls, without reporting a failed cloud retry as the required next step. Keep originals and local edits on the same origin; another deployment URL, clearing browser data or changing device does not restore them. Use an explicit report/export when a portable copy is needed.

Validation must prove normal authentication remains configured, disabled inspection services make no upload/record/health-check calls, local scan/chat persistence works, and cloud controls do not claim an acknowledgement. Live acceptance still requires the exact approved Preview, an authorized signed-in account, provider/model evidence and the agreed photo/chat request limits. This mode does not authorize credentials, deployment, migrations, purchases or bypasses.

The flag is replaced at build time; changing it requires a new build. See [Vite environment documentation](https://vite.dev/guide/env-and-mode). It contains no secret and is visible in the client bundle. Full cloud release requires the separate database/recovery review and hosted cloud acceptance.
