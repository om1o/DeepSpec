# HUSHPOINT Asset Provenance

This directory contains game-ready 3D assets and the immutable source files used to build them.

## Directory contract

- `source/`: preserved source GLBs. The Blender pipeline never overwrites these files; `.gdignore` prevents Godot from importing duplicate source geometry.
- `models/`: Blender-cleaned, validated GLBs imported by Godot.
- `reports/`: deterministic generation, optimization, and re-import validation reports. These records are excluded from the game import database.

## Port Mercy coastal tide gauge

- Higgsfield concept image: `concepts/higgsfield_tide_gauge_z_image.png`
- Higgsfield raw mesh: `source/higgsfield_sam3d_c7b785d4-fa62-4e8a-b570-c8459f1e15fd_raw.glb`
- Intended game-ready model: `models/hushpoint_tide_gauge_optimized.glb`
- Full machine-readable lineage: `reports/higgsfield_tide_gauge_lineage.json`
- Optimizer: `tools/blender_asset_pipeline.py`
- Usage: generated through the user's connected Higgsfield account and subject to Higgsfield's applicable service terms.

The Higgsfield concept and mesh were generated on 2026-11-01. The concept image job was `4ff7cf22-39f3-40ab-853e-99e5d0c5e903` at 0.15 credit. The textured SAM 3D job was `c7b785d4-fa62-4e8a-b570-c8459f1e15fd` using `sam_3_3d`, seed `11989`, detection threshold `0.25`, at 1 credit. Both downloaded files are preserved byte-for-byte; their SHA-256 hashes are recorded in the lineage report.

The concept prompt deliberately requests original, logo-free public-infrastructure engineering with no copyrighted characters. The mesh prompt lifts the complete freestanding gauge and cabinet as one object while ignoring its neutral studio background.

The production mesh was processed with Blender 4.5.10 LTS from the Blender release mirror archive at `https://ftp.nluug.nl/pub/graphics/blender/release/Blender4.5/blender-4.5.10-windows-x64.zip`. Its archive hash was verified against `https://ftp.nluug.nl/pub/graphics/blender/release/Blender4.5/blender-4.5.10.sha256` before execution. The exact hash, Blender build identity, deterministic command, geometry counts, output hashes, and Godot 4.7.2 import result are recorded in `reports/higgsfield_tide_gauge_lineage.json`.

Visual QA is preserved at `reports/hushpoint_tide_gauge_preview.png`. The provider mesh remained at 7,735 triangles because it was already below the 50,000-triangle decimation threshold. Its textured source normals were preserved rather than replaced with weighted normals.

Environment limitation: no system-wide Blender installation is claimed. On this managed Windows machine, the verified portable runtime executed from `%TEMP%\hushpoint-blender-4.5.10\runtime`; moving the identical runtime into `AppData\Local\HushpointTools` triggered a Windows side-by-side configuration error, and moving it back restored execution. The wrapper detects the working temporary path automatically for this session, or accepts an explicit `-BlenderPath` on another machine.

## Original Blender fallback

- Source: `source/port_mercy_tide_gauge_original.glb`
- Game-ready model: `models/port_mercy_tide_gauge.glb`
- Generator: `tools/generate_tide_gauge.py`
- Provenance: original procedural geometry authored for HUSHPOINT; no third-party mesh, texture, or copied game asset.
- License: project-original artwork under the same terms as HUSHPOINT.

The fallback remains available if a provider source cannot be processed. It represents a compact municipal tide station: galvanized mounting hardware, a safety-yellow sensor mast, a marked staff gauge, telemetry cabinet, solar panel, antenna, and protected pressure sensor. Dimensions are authored in meters for Godot's 3D coordinate scale.

## Rebuild the fallback

From the HUSHPOINT project directory:

```powershell
powershell -ExecutionPolicy Bypass -File tools/run_blender_pipeline.ps1 -GenerateFallback
```

This creates the immutable original GLB, cleans and validates a separate optimized GLB, then records SHA-256 hashes and geometry metrics in `assets/reports/`.

## Process a Higgsfield or other generated GLB

Place the unmodified provider output under `assets/source/`, then run:

```powershell
powershell -ExecutionPolicy Bypass -File tools/run_blender_pipeline.ps1 `
  -InputGlb assets/source/provider_asset.glb `
  -OutputGlb assets/models/provider_asset.glb `
  -ReportPath assets/reports/provider_asset_pipeline.json `
  -AssetName Provider_Asset `
  -DecimateThreshold 50000 `
  -TargetTriangles 30000
```

For provider-generated assets, append the provider, model name, job ID, generation date, prompt summary, and provider usage terms to this file. Do not remove or replace the preserved source GLB.

## Validation guarantees

The pipeline:

1. imports a copy of the source without writing to it;
2. applies rotation and scale transforms while retaining object placement;
3. repairs invalid mesh data, triangulates geometry, and applies weighted normals when Blender supports them;
4. decimates only when the configurable scene triangle threshold is exceeded;
5. repairs missing PBR material nodes and reports missing external textures;
6. exports a new binary GLB;
7. clears Blender, re-imports the exported GLB, rejects empty or non-finite geometry, and emits a JSON report.

The scripts are deterministic for the same Blender version, source file, and command-line options. Reports intentionally omit timestamps and machine-specific absolute paths.
