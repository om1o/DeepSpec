# DeepSpec ChatGPT plugin

This is a React-widget MCP plugin for ChatGPT. It reuses DeepSpec's existing `/api/identify` engine and Supabase account/storage model instead of creating a second vision prompt or anonymous image database.

## Tools

- `get_deepspec_profile`: confirms the connected account.
- `analyze_vehicle_image`: reads one ChatGPT-provided JPEG, PNG, or WebP image and returns a structured DeepSpec result with sources. It does not save the image.
- `save_deepspec_scan`: writes the image and result to the user's private DeepSpec history only after explicit confirmation. The row remains `raw_unreviewed`; saving is not training consent.

The plugin cannot appear automatically in every ChatGPT conversation about a car part. The user must connect DeepSpec and select or invoke it. Public distribution also requires a deployed HTTPS `/mcp` endpoint and OpenAI review.

## Local setup

1. Upgrade the Supabase project's JWT signing key to RS256 or ES256 if it still uses HS256.
2. In Supabase Authentication > OAuth Server, enable OAuth 2.1 and dynamic client registration.
3. Set the authorization path to `/oauth/consent` and the Auth Site URL to the DeepSpec web origin.
4. Configure the Supabase custom access-token hook so OAuth access tokens include the exact `DEEPSPEC_PLUGIN_PUBLIC_URL` in `aud` and include `openid email profile` in `scope`. DeepSpec rejects tokens that do not prove this audience and these scopes.
5. Set the environment variables below.
6. Run `npm run dev` for the DeepSpec API and `npm run plugin:dev` for the MCP server.
7. Expose port 8787 through an HTTPS tunnel and add `https://<tunnel>/mcp` in ChatGPT developer mode.

```text
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
DEEPSPEC_API_BASE_URL=http://localhost:5174
DEEPSPEC_PLUGIN_PUBLIC_URL=https://<public-plugin-origin>
DEEPSPEC_WEB_URL=https://<deepspec-web-origin>
# Optional comma-separated browser origins. MCP requests without Origin are allowed.
DEEPSPEC_PLUGIN_ALLOWED_ORIGINS=https://chatgpt.com
PORT=8787
```

On Vercel, `/mcp` and both protected-resource metadata paths are routed to serverless functions. `VERCEL_PROJECT_PRODUCTION_URL` supplies the stable production origin automatically, so the web app and plugin can share one free `vercel.app` domain. Explicit `DEEPSPEC_*_URL` values take precedence.

The provider keys used by `/api/identify` remain on the DeepSpec API host. Do not place a Supabase secret/service-role key in this plugin or the browser widget.

## Validation

```bash
npm run plugin:test
npm run lint
npm run build
```

For an end-to-end check, connect MCP Inspector to `http://localhost:8787/mcp`, confirm the three tools and resource, then test ChatGPT developer mode through HTTPS. A real save requires the Supabase OAuth Server dashboard settings and a signed-in DeepSpec account.

Before promotion, prove all of the following in ChatGPT developer mode:

1. The protected-resource metadata reports the exact HTTPS plugin origin.
2. Connecting creates a Supabase OAuth client and completes PKCE authorization.
3. A token with a missing or different audience is rejected.
4. Analyze returns a result without saving the image.
5. Save requires explicit confirmation and the record appears only in that user's DeepSpec history.
6. Source links display their evidence role; an AI-generated URL never appears.

## Provenance

Source:
- Repo: https://github.com/openai/openai-apps-sdk-examples
- Path: `mcp_app_basics_node/src/server.ts`
- License: MIT

Reuse type:
- Structural adaptation of the stateless Streamable HTTP server and `registerAppTool` / `registerAppResource` pattern.

Changes made:
- Replaced all demo tools and UI with DeepSpec image analysis, OAuth challenges, private persistence, source links, bounded file download, and explicit save consent.

Validation performed:
- MCP initialization/tool-list integration test, file security tests, OAuth metadata test, TypeScript build, lint, and the repository's focused tests.

Risks remaining:
- Supabase OAuth Server settings and the public HTTPS endpoint must be configured and tested in ChatGPT before submission.
