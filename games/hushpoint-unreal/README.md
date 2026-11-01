# HUSHPOINT — Unreal Engine 5 migration scaffold

This directory is the honest starting point for replacing the existing Godot build with a native Windows Unreal Engine 5 build. It is a **Blueprint-first scaffold, not a playable migration**: it contains a valid project descriptor, desktop rendering/input defaults, source-asset staging, a migration contract, and static validation. It intentionally contains no fabricated `.uasset` or `.umap` files.

The existing Godot game remains the behavioral reference and working fallback until an Unreal package passes the full acceptance gate in [MIGRATION_PLAN.md](MIGRATION_PLAN.md). Unreal cannot convert its GDScript, procedural scene construction, saves, tests, or gameplay logic; those systems must be re-authored and verified in Unreal.

The approved visual direction is [Pressure Gradient](ART_DIRECTION.md): 60% grounded Storm Authority, 30% claustrophobic Blackwater Pursuit, and 10% Counterflow Cathedral reserved for the Bellman/finale. Its three original reference boards are checked in with prompts and hashes; they are targets, not screenshots of an implemented build.

## What is configured

- Windows desktop, DirectX 12, Shader Model 6, deferred rendering.
- Software Lumen global illumination and reflections.
- Mesh distance fields enabled; hardware ray tracing disabled.
- Nanite and Virtual Shadow Maps disabled for the first performance-controlled slice.
- A 1280x720 windowed starting profile capped at 30 fps while the target hardware is profiled. The fidelity profile starts at Maximum so the Lumen test is not silently downgraded; that is a test condition, not a performance promise.
- Enhanced Input player classes and the standard Enhanced Input plugin.
- Readable WASD and arrow-key fallback axes. The eventual `IMC_Player` must mirror these bindings using one `IA_Move` Axis2D action.
- Engine Entry map only. No gameplay map is claimed to exist yet.

Software Lumen on this machine's Intel Iris Xe is experimental and unverified. Current Epic hardware guidance does not list Iris Xe among supported Lumen GPUs. Hardware ray tracing is not a viable fallback here, and no configuration file can prove image quality or frame rate. The first live-editor milestone must test the actual GPU before any lighting or performance promise is made.

## Current toolchain blocker (verified 2026-11-01)

The Epic Games Launcher is installed, but `C:\ProgramData\Epic\UnrealEngineLauncher\LauncherInstalled.dat` reports an empty `InstallationList`. No `UnrealEditor.exe`, Unreal Build Tool, or Automation Tool is currently discoverable. MSVC, MSBuild, the .NET CLI, and a Windows SDK are also absent, but those external tools become requirements only if a future C++ module/plugin or an observed packaging error needs them. Consequently:

- the project has not been opened or converted by Unreal;
- no Blueprint assets or playable map can be authored truthfully;
- Lumen, Enhanced Input, packaging, and performance have not been runtime-tested;
- only the static validator can run today.

## First live-editor steps

1. Install one current production UE5 release from Epic Games Launcher with Windows packaging support and record the exact engine version before associating this project. Keep the Blueprint-only lane first; install a supported Visual Studio/MSVC/Windows SDK toolchain only if C++ is introduced or the recorded packaging failure explicitly requires it.
2. Open `Hushpoint.uproject`. The descriptor deliberately omits `EngineAssociation` so it does not pretend an unavailable engine version was tested.
3. Create `/Game/Hushpoint/Maps/L_Hushpoint_Graybox`, then set it as the editor and game default map.
4. Create `IA_Move` (Axis2D) and `IMC_Player`. Bind:
   - `Up`: Swizzle Input Axis Values `YXZ`;
   - `Down`: Negate, then Swizzle Input Axis Values `YXZ`;
   - `Right`: direct positive X;
   - `Left`: Negate X.
   Mirror WASD, then add the mapping context once through the local player's Enhanced Input subsystem. Do not bind the same input twice in gameplay code.
5. Build the player, shoulder camera, and one lit exterior test room before importing the entire level. Use the processed Blender output from `SourceAssets`, retain raw sources and lineage reports, and verify scale, pivots, collisions, material slots, normals, and lightmap behavior.
6. Run the live gates in [VALIDATION.md](VALIDATION.md) before proceeding to the next milestone.

## Static validation

From this directory:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\validate_scaffold.ps1
```

The script validates the project JSON and the committed INI contract. A pass means only that the text scaffold is internally consistent; it is not an Unreal editor, play-in-editor, Lumen, or packaged-build test.

## Primary Epic references

- [Lumen technical details](https://dev.epicgames.com/documentation/en-us/unreal-engine/lumen-technical-details-in-unreal-engine)
- [Hardware and software specifications](https://dev.epicgames.com/documentation/en-us/unreal-engine/hardware-and-software-specifications-for-unreal-engine)
- [Enhanced Input](https://dev.epicgames.com/documentation/en-us/unreal-engine/enhanced-input-in-unreal-engine)
- [Packaging Unreal projects](https://dev.epicgames.com/documentation/en-us/unreal-engine/packaging-your-project)
