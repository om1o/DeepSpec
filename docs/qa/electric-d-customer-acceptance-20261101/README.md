# Electric D hosted customer acceptance evidence

Date: 2026-11-01 (America/New_York)

Application commit: `891d066365dd7a259395917d8f7bcccb7d75fc6e`

Vercel Preview: `dpl_6GHLG7XykGioqYLpHvwpMXo57AmF`

Immutable URL: `https://deepspec-nytdrlzgq-deep-spec-team.vercel.app`

Branch alias: `https://deepspec-git-codex-hosted-v1-repair-20261031-deep-spec-team.vercel.app`

## Hosted screenshots

- [Auth, desktop 1440x900](auth-desktop-1440x900.png)
- [Auth, phone emulation 390x844](auth-mobile-390x844.png)
- [Intro, desktop 1440x900](intro-desktop-1440x900.png)
- [Intro, phone emulation 390x844](intro-mobile-390x844.png)

The hosted browser exposed the electric D on the intro and Auth screens, retained the original Account and Email link controls, exposed the Auth tabs and tabpanel to the accessibility tree, and showed no visible clipping or overlapping controls at the captured sizes. The browser was signed out and no form was submitted during this branding pass.

These screenshots are browser emulation, not physical iPhone or iPad evidence. The real authenticated scan, cloud save, history reopen and photo-backed chat observations are documented in the repository-level QA report and are tied to the earlier application ancestor `9be45ac2`. The identity commit changes presentation and assets, not Auth, provider, storage or routing behavior.
