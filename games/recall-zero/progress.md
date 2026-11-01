Original prompt: "ok i want you to bulid the funest most stsfiing game you are going againist clade first no engine then engine thses can be any size need to have lore plan every thing based off 3 other games as refrence". The user clarified: "no web destop".

## Scope

- Round one only: a complete Windows desktop game with no game engine.
- Use pygame-ce only as the low-level SDL window, input, audio, font, and rendering library.
- Keep the game isolated from the DeepSpec product under `games/recall-zero/`.
- Build a Windows one-folder executable after source and gameplay tests pass.

## Acceptance checks

- Complete title -> tutorial -> three memory waves -> boss -> victory/defeat -> replay flow.
- Throw, anchor, reposition, recall, marked-enemy detonation, dash, and Perfect Recall work.
- Three normal enemy behaviors plus the Curator boss are readable and fair.
- Three lore fragments and a complete ending are playable.
- Nine upgrades are implemented; upgrade choice safely pauses combat.
- Pause, mute, reduced motion, high contrast, focus mode, fullscreen, resize, and focus-loss pause work.
- Unit tests, headless smoke test, performance simulation, package build, and visual desktop QA pass; a current packaged executable launch must pass or have any host policy blocker recorded explicitly.
- Existing DeepSpec lint, tests, and build still pass.

## Progress

- 2026-11-01: User clarified desktop rather than web; browser implementation abandoned before files were created.
- 2026-11-01: Selected RECALL//ZERO concept and pygame-ce 2.5.8 / Python 3.12 toolchain.
- 2026-11-01: Selected one-folder PyInstaller packaging for reliability and LGPL replaceability.
- 2026-11-01: Added isolated project docs, pinned dependencies, fail-closed save persistence, procedural audio, and bounded visual-effects primitives.
- 2026-11-01: Completed the deterministic 120 Hz model, recall-blade combat, three waves, nine upgrades, Curator boss, three lore fragments, ending, replay flow, native UI, input, procedural audio, persistence, and accessibility settings.
- 2026-11-01: Independent QA found and verified fixes for same-tick defeat precedence, Echo Dash damaging during normal movement, a flaky benchmark, and PowerShell native-command failures not stopping the build.
- 2026-11-01: Python unit suite passed (16/16), compileall passed, headless gameplay smoke passed, 20-seed randomized model smoke passed, and the synthetic 100-enemy simulation/36-enemy render gate passed repeatedly.
- 2026-11-01: Visually reviewed title, story, gameplay, lore, upgrade, boss, and victory screens; corrected the only observed text overflow.
- 2026-11-01: Built the one-folder Windows release and verified exact pygame-ce source/LGPL notices, Python and PyInstaller licenses, and externally replaceable pygame files.
- 2026-11-01: Before the follow-camera change, launched the archived packaged executable in the real Windows desktop and verified title-to-live-game rendering at a resizable 1280x720 logical layout. This is historical evidence, not a launch test of the current package.
- 2026-11-01: Restored the source-only desktop project from the ignored archive so current work can be versioned without copying its virtual environment or old binaries.
- 2026-11-01: Added a clamped 1024x576 follow-camera over the 1280x720 simulation arena, keeping HUD and choice UI screen-fixed while mouse aiming remains world-correct.
- 2026-11-01: Current camera-enabled validation passed: 22/22 unit tests, compileall, deterministic headless gameplay smoke, seven-screen visual capture review, and the best-of-three crowded render gate (2.3906 seconds against a 2.5-second limit during the release build).
- 2026-11-01: Built the current one-folder release at `dist/RecallZero/RecallZero.exe` (SHA-256 `43A2ED70B284E65825F5AC030A896E6823DA13609786BA9FA9F7A20B4E8DF22C`; 42,858,756 bytes including the folder contents) with complete pygame-ce/Python/PyInstaller notices and relinking material.
- 2026-11-01: Windows Application Control blocked this newly generated unsigned executable before process start, so the current package is built and inspected but not runtime-accepted on this host. Source execution is verified; this policy result is not evidence of a game crash.
- 2026-11-01: DeepSpec regression checks passed for 292/292 Vitest tests, production build, and tracked-source ESLint (0 errors). The broad `npm run lint` command remains polluted by generated `.vercel/output` and the ignored game virtual environment, producing 3,647 unrelated generated-file errors.

## Final release tasks

- Commit the game atomically and push it to GitHub.
- Runtime-accept the current packaged executable on a Windows host that permits the unsigned local PyInstaller build, or sign it with a trusted publisher certificate and retest on this host.
- Treat feel/balance as first-release tuning: automation proves correctness, not that the five-to-eight-minute target is perfectly tuned for every player.
- Keep the no-engine release independent from the Unreal migration; do not delete the working Godot build until Unreal is packaged and accepted.
