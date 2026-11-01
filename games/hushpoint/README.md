# HUSHPOINT

HUSHPOINT is an original native 3D survival-horror game built with Godot 4.7.2. Flood-control engineer Lena Orr begins with an ordinary service call outside a functioning coastal barrier: verify a tide gauge, reset a relay, file the sheet, go home. The powered reading lies. The paper record does not.

This focused vertical slice targets a 25–42 minute first playthrough; that pacing target still requires blind human playtesting. The playable arc moves from a calm outdoor maintenance tutorial into an interconnected station, delayed weapon acquisition, limited inventory, sound-reactive pursuit, physical machinery puzzles, a recontextualized Bellman encounter, an escape back through the storm, and a two-choice ending at Lena's truck.

## Controls

| Input | Action |
| --- | --- |
| `WASD` | Move |
| Mouse | Look / aim |
| `Shift` | Sprint (loud) |
| `Ctrl` | Crouch (quiet) |
| Right mouse | Aim lamp / handgun |
| Left mouse | Fire while aiming |
| `E` | Interact / inspect |
| `R` | Reload |
| `Q` | Quick turn |
| `G` | Throw noise decoy |
| `H` | Use healing wrap |
| `Tab` | Inventory, files, objectives |
| `F` | Toggle inspection lamp |
| `Esc` | Pause |
| `F11` | Fullscreen |

## Run

```powershell
godot --path .
```

The run and test commands assume the Godot 4.7.2 executable is available as `godot` on `PATH`.

## Test

```powershell
powershell -ExecutionPolicy Bypass -File .\test.ps1
```

The wrapper gives all save-mutating runners a temporary `user://` profile, then removes that exact profile after the run. Those runners refuse to start outside the isolated profile so development tests cannot overwrite a player's save or accessibility settings.

## Build

```powershell
powershell -ExecutionPolicy Bypass -File .\build.ps1
```

The Windows build is written to `build/Hushpoint.exe`.

## Reference boundary

The design uses only abstract lessons from Resident Evil 2's resource pressure and revisitable exploration, Alien: Isolation's sound-reactive pursuit, and Dead Space's readable weak points and intensity valleys. HUSHPOINT copies no story, character, location, code, model, texture, UI, sound, or puzzle solution.

The surface setting is grounded in public coastal-engineering information from NOAA and the U.S. Army Corps of Engineers. One original tide-gauge concept and source GLB were generated through Higgsfield, then processed through a deterministic Blender pipeline before Godot import. The harbor service truck is original deterministic Blender geometry and uses that concept only for broad material direction. Full model IDs, job IDs, hashes, prompts, licensing caveats, and source links are recorded in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and `assets/README.md`.

See [GAME_DESIGN.md](GAME_DESIGN.md) for the plot, lore, mechanics, level flow, and provenance notes.
