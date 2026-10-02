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
4. Set the environment variables below.
5. Run `npm run dev` for the DeepSpec API and `npm run plugin:dev` for the MCP server.
6. Expose port 8787 through an HTTPS tunnel and add `https://<tunnel>/mcp` in ChatGPT developer mode.

```text
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
DEEPSPEC_API_BASE_URL=http://localhost:5174
DEEPSPEC_PLUGIN_PUBLIC_URL=https://<public-plugin-origin>
DEEPSPEC_WEB_URL=https://deepspec.app
PORT=8787
```

The provider keys used by `/api/identify` remain on the DeepSpec API host. Do not place a Supabase secret/service-role key in this plugin or the browser widget.

## Validation

```bash
npm run plugin:test
npm run lint
npm run build
```

For an end-to-end check, connect MCP Inspector to `http://localhost:8787/mcp`, confirm the three tools and resource, then test ChatGPT developer mode through HTTPS. A real save requires the Supabase OAuth Server dashboard settings and a signed-in DeepSpec account.

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
