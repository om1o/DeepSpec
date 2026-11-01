Original request: build the most fun and satisfying desktop game, first without an engine and then with an engine, with lore and three reference games. After reviewing the arcade prototype, the user rejected it and asked for a fully redesigned 3D Resident Evil-like experience.

## Accepted interpretation

- Build an original native 3D survival-horror vertical slice, not an infringing Resident Evil clone.
- Use Godot 4.7.2 + GDScript + Mobile renderer for the Iris Xe development machine.
- Target a polished 25–42 minute vertical slice rather than falsely claiming AAA scale or a complete commercial game.
- Preserve the rejected 2D prototype only under ignored QA artifacts.

## Acceptance checks

- Native Windows executable, no browser or embedded web UI.
- Fully 3D third-person movement, camera, aiming, shooting, flashlight, interaction, sprint, crouch, reload, healing, decoys, pause, fullscreen.
- Interconnected station with safe room, locks, shortcuts, files, inventory, power/spool/tide/purge puzzles, ending and restart.
- Listener, Wader, Chorus, and sound-reactive Bellman behaviors.
- Lighting, fog, water, steam, sparks, muzzle/impact effects, post-processing, spatial/procedural audio.
- Automated state tests, headless import/run, real executable export, real-window control test, screenshot QA, performance check, repository regression check.
- Independent QA review before commit and isolated GitHub push.

## Progress

- 2026-11-01: Rejected arcade direction archived; no rejected source will be committed.
- 2026-11-01: HUSHPOINT design and IP boundary completed from three official reference sources.
- 2026-11-01: Godot 4.7.2 installed from the verified WinGet package; Mobile renderer selected for Intel Iris Xe.
- 2026-11-01: Rebuilt the opening as an eight-step, threat-free coastal service call with a physical-versus-digital tide contradiction and delayed handgun acquisition.
- 2026-11-01: Rewrote the plot around PALINODE, Mara's cancellation lock, Gideon as the archive's grounding circuit, a post-purge surface escape, and two final radio choices.
- 2026-11-01: Generated an original tide-gauge concept and SAM 3D source mesh through Higgsfield for 1.15 credits total; preserved prompts, hashes, IDs, and source files.
- 2026-11-01: Processed and re-import-validated the source mesh using verified Blender 4.5.10 LTS; output is 7,735 triangles with one material and no pipeline warnings.
- 2026-11-01: Deterministic state tests pass 340 assertions and end-to-end integration tests pass 281 assertions, including post-purge save recovery and accessibility-effect coverage.
- 2026-11-01: Native Godot visual QA passed for the title, routine briefing, outdoor spawn, objective provenance, delayed weapon HUD, and Higgsfield/Blender prop preview.
- 2026-11-01: Windows release export passed at 105.3 MiB with source assets, reports, tests, tools, and the unused fallback excluded; the package includes the required Godot copyright notice.
- 2026-11-01: DeepSpec repository regression passed: ESLint, 37 Vitest files / 303 tests, TypeScript, and Vite production build. Final independent review passed; isolated clean-branch delivery remains the final acceptance gate.
