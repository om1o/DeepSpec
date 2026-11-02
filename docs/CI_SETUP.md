# Enable DeepSpec's cloud CI checks

No purchased domain is required. These checks connect to the existing Supabase project. The September 27 CI run passed code checks but failed before auth verification because public configuration was missing; cloud sync was skipped.

In [repository Actions variables](https://github.com/om1o/DeepSpec/settings/variables/actions), add:

| Name | Value source |
| --- | --- |
| `VITE_SUPABASE_URL` | The URL already used by the working local app in `.env.local`. |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | That project's public publishable/anon key from `.env.local` or Supabase API settings. Never a service-role/secret key. |

Existing repository secrets with those names are also supported and take precedence. This follows [GitHub's variables context](https://docs.github.com/en/actions/reference/workflows-and-actions/contexts#vars-context). Keep private auth test passwords in repository **secrets**, not variables.

For cloud isolation checks, configure these repository **secrets** for two distinct, pre-confirmed dedicated QA accounts: `DEEPSPEC_AUTH_TEST_EMAIL`, `DEEPSPEC_AUTH_TEST_PASSWORD`, `DEEPSPEC_AUTH_TEST_OTHER_EMAIL`, and `DEEPSPEC_AUTH_TEST_OTHER_PASSWORD`. Both accounts must belong to the configured Supabase project. The verifier signs in normally with the public key; it never creates anonymous users or uses an admin key for the RLS probes. It removes only its unique synthetic scan fixtures and signs out its own sessions.

After saving these values, open the newest [CI run](https://github.com/om1o/DeepSpec/actions/workflows/ci.yml) and rerun it. Confirm **both** auth-provider and cloud-sync steps run successfully; a successful lint/build step alone is insufficient. Main-bound pull requests continue to fail when the public settings or cloud-test credentials are absent. Do not weaken that gate to get a green badge.

Code quality, auth verification, cloud isolation and browser smoke are separate jobs, so one failure no longer prevents another check from reporting. Main-bound and production-readiness auth jobs use `--require-password`: missing QA credentials now fail rather than passing after a settings-only check. This mode does not claim to test email-code delivery or OAuth browser login; keep the interactive `--require-credentials` check for those received-code tests.

`npm run test:browser` builds an isolated guest-preview bundle under `artifacts/browser-smoke/dist`, launches Chromium at phone and desktop widths, and uses a synthetic saved record with the repository's image fixture. It checks upload fallback availability after camera denial, saved result reload and image identity, neutral and explicit feedback, result tabs, exact chat photo/context, missing-ID isolation and customer routes. External requests are blocked and API calls receive a synthetic unavailable response. The workflow uploads screenshots and `report.json` even on failure. Install the browser first with `npx playwright install chromium`. This test does **not** prove live AI, authentication, cloud storage, billing, actual upload processing, or a physical phone camera.

In the repository's main-branch ruleset, require pull requests plus `Quality gate`, `Auth verification`, `Cloud isolation verification` and `Browser smoke (synthetic data)` after these check names have appeared in a run. Workflow files cannot enforce repository rulesets themselves; an owner with administration access must save this setting. Do not count a preview branch's optional cloud checks as release acceptance.

`npm run verify:auth` without credentials checks provider configuration but does not prove email/password login, delivery or recovery. To test real password login, use a dedicated test account via `DEEPSPEC_AUTH_TEST_EMAIL` and `DEEPSPEC_AUTH_TEST_PASSWORD`, and run `npm run verify:auth -- --require-credentials` (this strict mode also requires a received email code). Do not commit these values. Verification-code sending is separately opt-in.

The connected GitHub tools in this session expose repository code/PR operations but no Actions-variable/secret setter. The desktop browser-control session also failed to initialize. Therefore these account settings remain an owner action; the workflow change does not claim to have saved them remotely.

A hosting preview URL can be tested before a custom domain is purchased. A local server is not a deployed app. Once hosting exists, verify its server environment, private storage access, auth redirects and cost controls separately, then set SEO canonical/sitemap/social URLs to the chosen public domain before public promotion.
