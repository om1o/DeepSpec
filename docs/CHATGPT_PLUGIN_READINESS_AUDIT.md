# ChatGPT Plugin Readiness Audit

Date: 2026-10-04

## Executive Summary

Deep Spec does not currently include a ChatGPT plugin, ChatGPT app, or MCP server integration. The repository is a Vite/React PWA with serverless API routes for identification and chat, but there is no MCP endpoint, no Apps SDK dependency, no plugin package metadata, no tool schema, and no widget resource wiring.

Because no integration exists, there is nothing safe to "fix" in place. The V1 launch gate for "ChatGPT plugin/app works" is blocked until a scoped MCP integration is intentionally designed and implemented.

## Evidence Checked

- `package.json`: no `@modelcontextprotocol/sdk`, `@modelcontextprotocol/ext-apps`, `@openai/apps-sdk-ui`, MCP server script, or plugin packaging script.
- Repository file list: no `server.ts` or `server.js` MCP entry point, no `.app.json`, no `ai-plugin.json`, no OpenAPI plugin manifest, and no `/mcp` route.
- Repo search for `McpServer`, `/mcp`, `registerTool`, `registerResource`, `registerAppTool`, `RESOURCE_MIME_TYPE`, `ai-plugin`, `openapi`, `ChatGPT`, and `plugin`: only generic Vite/PWA plugin references plus `ChatGPT-User` in `public/robots.txt`.
- Existing public product docs (`README.md`, `public/llms.txt`) describe the PWA scanner, saved scans, Supabase sync, and article pages, but not a ChatGPT app.

## Official Requirements Used For This Audit

OpenAI's current plugin/app docs say a plugin with live capabilities should expose an MCP server and a stable `/mcp` endpoint, with tools, schemas, annotations, authorization boundaries, and validation through MCP Inspector and ChatGPT developer mode:

- MCP server and production endpoint: https://developers.openai.com/plugins/build/mcp-server
- Tool planning: https://developers.openai.com/plugins/plan/tools
- Optional UI resources and MCP Apps bridge: https://developers.openai.com/plugins/build/chatgpt-ui
- Metadata, tool annotations, widget CSP, and UI resource fields: https://developers.openai.com/plugins/reference
- Submission flow and review prerequisites: https://developers.openai.com/plugins/deploy/submission
- Directory quality and reliability guidelines: https://developers.openai.com/plugins/plugin-guidelines

Relevant gates from those docs:

- A working integration needs a reachable MCP server, typically ending in `/mcp`.
- Each exposed tool needs a stable name, description, input/output schema, side-effect model, and accurate annotations.
- If UI is included, the server must return an MCP Apps UI resource such as `text/html;profile=mcp-app`, link it with `_meta.ui.resourceUri`, and define exact CSP metadata.
- Production/public submission needs a stable public HTTPS endpoint, not localhost or a temporary tunnel.
- Secrets must live in the host secret-management system and must not be returned in tool metadata, logs, or results.
- Submission requires verified ownership and review; no public launch should happen before those gates are satisfied.

## Current Integration State

Archetype classification: none yet. If Deep Spec starts with a minimal launchable integration, the smallest likely archetype is `tool-only`, not widget-first.

Why `tool-only` first:

- Deep Spec's core product value is scan interpretation and saved scan context. The repo already has UI as a PWA.
- A ChatGPT integration can first expose bounded, read-only helpers for product information or scan-result explanation without creating new write paths.
- A widget should wait until there is a specific in-ChatGPT workflow that needs visual inspection, comparison, confirmation, or navigation.

## Launch Blockers

1. No MCP server or `/mcp` route exists.
2. No ChatGPT tool surface is defined.
3. No auth model exists for exposing private saved scans to ChatGPT.
4. No Apps UI resource, widget CSP, or `_meta.ui.domain` exists.
5. No local MCP Inspector validation has been run because there is no endpoint to inspect.
6. No ChatGPT developer-mode connection has been tested because there is no MCP URL.
7. No production deployment readiness exists for a stable public MCP endpoint.
8. No plugin submission package, verified developer identity check, privacy/support artifacts, screenshots, or review prompts exist.

## Smallest Viable Next Action

Create a first-pass, private developer-mode MCP server before any public launch work.

Recommended first scope:

- Add a small MCP server entry point in a dedicated folder such as `mcp/`.
- Expose a read-only `get_deepspec_capabilities` tool that explains what Deep Spec can and cannot do.
- Optionally add read-only `search` and `fetch` tools over the existing public article pages if the goal is ChatGPT discovery and knowledge retrieval.
- Do not expose saved scans, Supabase user data, camera photos, or write actions in V1 of the plugin.
- Run MCP Inspector locally against `http://localhost:<port>/mcp`.
- Connect the tunneled HTTPS `/mcp` URL in ChatGPT developer mode and test representative prompts.
- Only after local validation, decide whether to add a widget or production hosting.

## Non-Goals For This Audit

- No new integration was invented or scaffolded.
- No paid service, deployment, purchase, domain, or public submission was started.
- No credentials were read, printed, or changed.
- No database or Supabase data was modified.
