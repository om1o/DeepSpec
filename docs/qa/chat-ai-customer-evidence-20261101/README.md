# DeepSpec chat workspace visual evidence

Implementation revision: `da95dc70`

These screenshots render the real `Chat` screen and its production CSS with a synthetic, fixture-backed saved scan. They verify layout and interaction presentation only; they do not bypass DeepSpec Auth and are not evidence of a hosted provider call or cloud persistence.

| Viewport | Evidence |
| --- | --- |
| Desktop `1440x900` | [chat-desktop-1440x900.png](chat-desktop-1440x900.png) |
| iPad-sized browser emulation `1024x1366` | [chat-tablet-1024x1366.png](chat-tablet-1024x1366.png) |
| Phone browser emulation `390x844` | [chat-phone-390x844.png](chat-phone-390x844.png) |

The saved focus box is aligned to the alternator in `public/test-fixtures/engine-scan-test.jpg`. The UI does not turn free-text evidence regions into spatial boxes. The phone view keeps the full photo visible and exposes the first divided evidence control without overlapping the conversation or composer.

The public [ChatGPT](https://chatgpt.com/) and [Gemini](https://gemini.google.com/app) surfaces were used as idea-only references for a conversation-first layout. No third-party code or visual asset was copied. Higgsfield was consulted read-only for model recommendations; no asset was generated and no credit was spent.

## Verification boundary

- Actual component render: passed at all three viewports.
- Markdown emphasis and lists: visibly rendered without raw markers.
- Real Auth, provider, upload, cloud save and session restore on this revision: not exercised by these screenshots.
- Physical iPhone/iPad Safari: not exercised; the tablet result is browser emulation.
