# Enable DeepSpec's cloud CI checks

No purchased domain is required. These checks connect to the existing Supabase project. The September 27 CI run passed code checks but failed before auth verification because public configuration was missing; cloud sync was skipped.

In [repository Actions variables](https://github.com/om1o/DeepSpec/settings/variables/actions), add:

| Name | Value source |
| --- | --- |
| `VITE_SUPABASE_URL` | The URL already used by the working local app in `.env.local`. |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | That project's public publishable/anon key from `.env.local` or Supabase API settings. Never a service-role/secret key. |

Existing repository secrets with those names are also supported and take precedence. This follows [GitHub's variables context](https://docs.github.com/en/actions/reference/workflows-and-actions/contexts#vars-context). Keep private auth test passwords in repository **secrets**, not variables.

After saving both values, open the newest [CI run](https://github.com/om1o/DeepSpec/actions/workflows/ci.yml) and rerun it. Confirm **both** auth-provider and cloud-sync steps run successfully; a successful lint/build step alone is insufficient. Main-bound pull requests continue to fail when the settings are absent. Do not weaken that gate to get a green badge.

`npm run verify:auth` without credentials checks provider configuration but does not prove email/password login, delivery or recovery. To test real password login, use a dedicated test account via `DEEPSPEC_AUTH_TEST_EMAIL` and `DEEPSPEC_AUTH_TEST_PASSWORD`, and run `npm run verify:auth -- --require-credentials`. Do not commit these values. Verification-code sending is separately opt-in.

The connected GitHub tools in this session expose repository code/PR operations but no Actions-variable/secret setter. The desktop browser-control session also failed to initialize. Therefore these account settings remain an owner action; the workflow change does not claim to have saved them remotely.

A hosting preview URL can be tested before a custom domain is purchased. A local server is not a deployed app. Once hosting exists, verify its server environment, private storage access, auth redirects and cost controls separately, then set SEO canonical/sitemap/social URLs to the chosen public domain before public promotion.
