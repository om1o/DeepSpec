# HUSHPOINT Godot-to-Unreal migration contract

## Boundary

This is a reimplementation, not a file-format conversion. The existing Godot project is the authoritative playable behavior and story reference until Unreal independently meets the release gate. GDScript, `.tscn` scenes, procedural builders, Godot resources, input maps, and JSON save orchestration are not copied into Unreal and must not be deleted during the migration.

The behavioral source of truth is the existing HUSHPOINT design and its tested state order:

1. Eight ordered, threat-free exterior service interactions.
2. Delayed handgun acquisition after station entry.
3. Emergency power from the correctly rated 15A and 30A fuses.
4. Three spool fragments assembled into Mara's real message.
5. Tide valves in `intake -> balance -> outflow` order, with an explicit reset path.
6. Bellman release only after the spool and tide prerequisites, using steam exposure and three regulator hits.
7. Three purge breakers that unlock escape without ending the game.
8. Exterior return and a physical `break` or `answer` final-radio choice.

Invalid actions must fail atomically: no item loss, door unlock, hidden boss progress, objective advance, or partial save mutation.

## Smallest architecture

Keep the first implementation Blueprint-only and small:

- `BP_HushpointGameInstance`: durable run state, objective order, settings, and save orchestration.
- `SG_Hushpoint`: versioned save payload. Write a temporary save, preserve a last-known-good backup, validate before applying, and fail closed on corrupt data.
- `BP_HushpointGameMode`: spawn and checkpoint policy, with no durable state.
- `BP_LenaCharacter` and `BP_HushpointPlayerController`: movement, shoulder camera, aim, interaction trace, weapon/lamp actions, and accessibility settings.
- One Blueprint interaction interface with focused implementations for pickups, panels, doors, valves, breakers, lore, and the final radio.
- One enemy base Blueprint with Listener, Wader, Chorus, and Bellman children; use explicit states rather than a sprawling general AI framework.
- UMG screens for HUD, inventory/files/objectives, pause/settings, title, death, and both endings.

Do not introduce C++, Gameplay Ability System, World Partition, procedural generation, multiplayer, or a custom plugin unless a measured Blueprint limitation requires it.

## Milestones and acceptance tests

### M0 — Toolchain gate

Deliverable: the project opens without upgrade errors in one recorded UE5 version.

- Unreal Editor, Windows packaging support, Automation Tool, and engine-bundled .NET are present. Add a supported MSVC/Windows SDK toolchain only if C++ is introduced or a reproducible packaging error requires it.
- `validate_scaffold.ps1` passes.
- A blank development Windows package launches and exits cleanly on the target PC.
- The engine version, GPU driver, package command, and output hash are recorded.

Stop if this gate fails. Text files are not evidence that Unreal works.

### M1 — Player, camera, input, and lighting test cell

Deliverable: a 1280x720 third-person test room with one exterior lighting composition.

- One `IA_Move` Axis2D action and one `IMC_Player` context drive both WASD and arrows.
- Enhanced Input arrow modifiers are exact: Up = swizzle `YXZ`; Down = negate then swizzle `YXZ`; Right = positive X; Left = negate X.
- Up/Down move forward/back relative to camera; Left/Right strafe; opposite keys cancel; diagonals are normalized; each physical key is processed once.
- The shoulder camera follows Lena, rotates with mouse input, collides with walls, keeps the fixed HUD/reticle in screen space, and supports quick turn. Character and camera motion must remain controllable at frame-rate changes.
- The project starts windowed at 1280x720. UI anchors remain correct at 1600x900 and 1920x1080.
- A live render proves deferred DX12/SM6, software Lumen GI/reflections, and mesh distance fields are active. Hardware RT remains off.
- Capture `stat unit`, `stat gpu`, and a representative exterior/interior frame. Thirty fps at 1280x720 is a target, not a pass until measured on Iris Xe. If software Lumen is unsupported, unstable, or below budget, report that failure plainly; no fallback may be described as equivalent Lumen.

### M2 — Deterministic run state, inventory, and saves

Deliverable: state-only test map plus automated functional tests.

- Six inventory slots; documented stack caps; non-discardable keys, required fuses, and spool fragments.
- Stable/Wounded/Critical/Dead health states, six-round magazine, limited reserve ammo, healing wraps, and noise decoys.
- Objective progression enforces the full ordered story chain and rejects out-of-order actions without mutation.
- Save data is versioned and validated before application; primary corruption recovers from backup; incompatible data fails without overwriting a valid save.
- New Game clears runtime AI, checkpoint, interaction, weak-point, and ending state.
- Functional tests cover valid and invalid paths, save roundtrip, corruption recovery, and legacy migration if legacy saves are supported.

### M3 — A Normal Call exterior slice

Deliverable: the complete calm opening with no weapon or enemy.

- Interactions exist physically and work only in order: work order, equipment, physical gauge, powered telemetry, relay R-4, paper report, station access, station entry.
- The 23 cm contradiction is communicated through readable brass/ink evidence and audio, not a floating quest-only shortcut.
- The surface cannot aim, fire, reload, or display ammunition.
- The Higgsfield/Blender floodlight imports as an original staged prop with documented lineage, correct metric scale, collision, pivots, materials, and no dependency on its source GLB at runtime.
- Blind playtest confirms the opening teaches inspection and objective provenance without a threat.

### M4 — Station loop and resource pressure

Deliverable: interconnected station, safe room, weapon pickup, three core puzzles, and one of each normal enemy.

- Handgun is acquired only after entering; aim/fire/reload, lamp heat, sprint/crouch/quick turn, healing, decoy, and interaction all work with keyboard/mouse.
- Fuse panel accepts only the 15A and 30A pair. Spool requires all three physical fragments. Tide sequence resets on wrong order and has a manual reset control.
- Inventory, Files, and Objectives pause threats and resume them exactly once. Objective copy retains source labels: work order, verified Control, Mara, or PALINODE.
- Listener follows sight/noise, Wader telegraphs emergence and rush, Chorus alerts nearby threats. Body shots stagger; exposed-node shots permanently neutralize; a downed enemy can recover while its node survives.
- Safe room blocks pursuit. Manual save and milestone checkpoint restore produce the same world state.

### M5 — Bellman and Mara reveal

Deliverable: full stalker arc and a mechanically truthful release encounter.

- Bellman has poor sight, strong hearing, readable bell/state audio, never teleports into the current camera view, and cannot enter the safe room.
- Solving tide alone awakens pursuit but does not reveal the harmonic key or allow permanent defeat.
- Before Mara's spool is assembled, steam cannot expose the regulator and weak shots cannot accumulate hidden completion progress.
- With spool and tide complete, steam exposes the regulator for a timed window; three confirmed regulator hits release Gideon, deactivate the stalker, play his release line, and reveal the route key.
- Pause, inventory, death/restart, save/load, and New Game preserve or reset Bellman state exactly as specified.

### M6 — Counterflow, surface return, and endings

Deliverable: complete start-to-finish story route.

- The harmonic key opens the purge vault only after prerequisites.
- Three physical, noisy breakers activate individually. The third sets Counterflow complete and exposes the surface route, but does not show an ending.
- Save/load after breaker three preserves the interactable escape route.
- Surface return changes world presentation, deactivates station threats, and places Lena at the authored exterior door.
- Both `break` and `answer` radio choices work on independent fresh runs, are saved, and show distinct endings only after the physical choice.
- A clean package can complete both endings without editor-only commands.

### M7 — Accessibility, performance, packaging, and blind QA

Deliverable: verifiable Windows vertical slice, not an editor demo.

- Reduce hard flashes suppresses lightning, muzzle, impact, and damage flashes. Reduced camera motion independently suppresses recoil/shake without disabling necessary camera follow.
- Settings persist across restart. Full keyboard traversal, readable focus, subtitles, text scaling, and remappable movement/action controls are tested.
- No fatal log errors, missing cooked assets, runtime shader compilation stalls, or source-asset dependencies occur in a clean package.
- Measure exterior, flooded interior, multiple enemies, Bellman chase, steam, and purge effects on target hardware. Record worst-case frame time and memory rather than averaging away spikes.
- Complete at least one blind start-to-finish playtest. Report observed duration against the 25–42 minute target; automated tests cannot certify fear, pacing, fun, or accessibility usability.

## Retirement gate for Godot

The Godot build may be retired only after all of the following are true:

- Unreal passes M0–M7 with evidence from a packaged Windows build.
- Both endings, corrupt-save recovery, all four enemy types, every puzzle, arrow keys, shoulder-camera movement, and accessibility toggles pass independently.
- The packaged build boots on a clean machine without the editor.
- Asset lineage and third-party notices cover every imported model, texture, sound, font, and generated output.
- A tagged Git commit, package hash, test report, screenshots, and known-issues list are preserved.

Until then, Unreal is a migration lane and the Godot project remains the only verified engine build.
