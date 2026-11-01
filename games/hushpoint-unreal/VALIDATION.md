# Validation status and gates

## Evidence status

| Check | Status | What it proves |
| --- | --- | --- |
| Project JSON and INI static contract | Available | Project JSON parses, and active INI sections contain one non-conflicting value for each required Windows/DX12/SM6/software-Lumen/input setting. |
| Unreal Editor open/upgrade | Blocked | No Unreal Engine installation is registered on this machine. |
| Play In Editor | Blocked | No editor and no authored `.umap`/`.uasset` gameplay content exist. |
| Enhanced Input arrows | Blocked | The intended mapping is documented; runtime assets and behavior must be authored and tested in editor. |
| Lumen visual/performance test | Blocked | Iris Xe support and performance are unverified; hardware RT is disabled and unsupported for this target. |
| Windows package | Blocked | Unreal Engine and Automation Tool are absent, so the package command cannot run. |
| Full story acceptance | Blocked | Migration milestones M1–M7 are not implemented. |

`Blocked` is not a product pass and is not being reclassified as one.

## Static check

Run from `games/hushpoint-unreal`:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\validate_scaffold.ps1
```

Expected result:

```text
PASS: HUSHPOINT Unreal scaffold contract validated.
```

The static check verifies:

- valid `.uproject` JSON, Blueprint-first (no native modules), Windows target, and only the standard Enhanced Input plugin;
- DX12, SM6, deferred rendering, Software Lumen GI/reflections, mesh distance fields, and hardware RT off;
- 1280x720 initial window profile and a 30 fps target cap;
- Enhanced Input classes plus readable arrow/WASD fallback axes;
- exact arrow-modifier instructions exist in the migration contract;
- the migration contract explicitly distinguishes this text-only scaffold from later editor-authored assets and runtime verification.

## Required live commands after installation

Replace `<UE_ROOT>` with the recorded installed engine directory. Do not write an engine path into source control.

```powershell
& '<UE_ROOT>\Engine\Binaries\Win64\UnrealEditor.exe' '.\Hushpoint.uproject' -log
& '<UE_ROOT>\Engine\Build\BatchFiles\RunUAT.bat' BuildCookRun `
  -project="$PWD\Hushpoint.uproject" `
  -noP4 -platform=Win64 -clientconfig=Development `
  -build -cook -stage -pak -package -archive `
  -archivedirectory="$PWD\Saved\Packages"
```

These commands are future acceptance steps; they have not run on the current machine.

## Live evidence packet required per milestone

For every completed milestone preserve:

- exact Unreal version and project commit;
- test name, result, timestamp, and log path;
- screenshots or video for visible behavior;
- `stat unit`/`stat gpu` captures for representative Lumen scenes;
- packaged executable path, SHA-256, boot result, and clean-machine result when packaging begins;
- known failures and whether they are engine, content, input, performance, or environment defects.

The full acceptance matrix is in [MIGRATION_PLAN.md](MIGRATION_PLAN.md). Do not claim the engine migration is complete until the retirement gate passes.
