# QA Doctor

## Summary

- Overall: failed
- Primary classification: missing env
- Base URL: https://deepspec-git-codex-v1-preview-20261010-deep-spec-team.vercel.app
- Generated: 2026-10-11T20:50:26.776Z

## Failure Classifications

- real product bug
- test bug
- stale environment
- missing env
- auth/session issue
- browser/VNC/screenshot failure
- network/transient issue
- unknown

## Checks

| Check | Status | Classification | Details |
| --- | --- | --- | --- |
| local/staging URL is configured | passed | none | Using https://deepspec-git-codex-v1-preview-20261010-deep-spec-team.vercel.app. |
| app server reachable | passed | none | HTTP 200 from https://deepspec-git-codex-v1-preview-20261010-deep-spec-team.vercel.app. |
| required env vars exist | failed | missing env | Missing VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY. |
| database reachable | failed | missing env | Skipped because Supabase env vars are missing. |
| test account exists or is configured | failed | missing env | Set DEEPSPEC_AUTH_TEST_EMAIL and DEEPSPEC_AUTH_TEST_PASSWORD for the authorized QA account. |
| auth/session is valid | failed | missing env | Skipped because Supabase env vars are missing. |
| Playwright installed | passed | none | playwright is importable. |
| browser can launch | failed | browser/VNC/screenshot failure | Chromium launch failed: browserType.launch: Executable doesn't exist at /root/.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell<br><br> Looks like Playwright was just installed or updated. <br> Please run the following command to download new browsers: <br> <br> npx playwright install <br> <br> <3 Playwright Team. |
| page loads successfully | failed | browser/VNC/screenshot failure | Skipped because no browser page is available. |
| screenshot is not blank | failed | browser/VNC/screenshot failure | Skipped because no browser page is available. |
| console errors are captured | failed | browser/VNC/screenshot failure | Skipped because no browser page is available. |
| network errors are captured | failed | browser/VNC/screenshot failure | Skipped because no browser page is available. |
| selectors are not stale | failed | browser/VNC/screenshot failure | Skipped because no browser page is available. |

## Blocking Failures

- required env vars exist: missing env - Missing VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY.
- database reachable: missing env - Skipped because Supabase env vars are missing.
- test account exists or is configured: missing env - Set DEEPSPEC_AUTH_TEST_EMAIL and DEEPSPEC_AUTH_TEST_PASSWORD for the authorized QA account.
- auth/session is valid: missing env - Skipped because Supabase env vars are missing.
- browser can launch: browser/VNC/screenshot failure - Chromium launch failed: browserType.launch: Executable doesn't exist at /root/.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell

 Looks like Playwright was just installed or updated.
 Please run the following command to download new browsers:

 npx playwright install

 <3 Playwright Team.
- page loads successfully: browser/VNC/screenshot failure - Skipped because no browser page is available.
- screenshot is not blank: browser/VNC/screenshot failure - Skipped because no browser page is available.
- console errors are captured: browser/VNC/screenshot failure - Skipped because no browser page is available.
- network errors are captured: browser/VNC/screenshot failure - Skipped because no browser page is available.
- selectors are not stale: browser/VNC/screenshot failure - Skipped because no browser page is available.

## Rule

Before any user-impact QA runner claims "bug found," it must include this doctor result and use the doctor classification to separate product bugs from test, auth, browser, network, and stale-environment failures.
