# HUSHPOINT Unreal source assets

This directory preserves the exact Higgsfield inputs and the Blender-processed floodlight interchange files for the Unreal migration. The provider files under `concepts/` and `raw/` are immutable. Rebuild only the outputs under `processed/` and `reports/`.

## Floodlight outputs

- `processed/SM_Hushpoint_Floodlight.fbx`: Unreal-targeted static mesh with embedded material data and three `UCX_` collision proxies.
- `processed/SM_Hushpoint_Floodlight.glb`: rendered mesh only, with no collision helpers.
- `processed/SM_Hushpoint_Floodlight.blend`: editable production scene with packed source texture and a separate `Collision_Proxies` collection.
- `reports/SM_Hushpoint_Floodlight_preview.png`: deterministic-camera neutral studio QA view; collision proxies are excluded.
- `reports/floodlight_pipeline_report.json`: machine-readable dimensions, topology, materials, hashes, collision, and GLB/FBX re-import checks.
- `reports/higgsfield_floodlight_lineage.json`: provider jobs, exact prompts/settings, source URLs, hashes, credit spend, and usage caveat.

The mesh is normalized to 4.2 meters (420 Unreal centimeters), Z-up, with its ground-contact center at `(0, 0, 0)`. Import the FBX at uniform scale `1.0`. The embedded 1024 x 1024 texture, one material, and one UV set are preserved.

## Collision and Lumen limitations

The source is a 7,088-triangle image-to-3D reconstruction. Blender validation found 4,318 non-manifold boundary edges. That is not a fabrication-ready or watertight mesh. Do not enable **Use Complex Collision As Simple**, do not auto-convex the rendered mesh, and do not assume clean mesh-distance-field behavior.

The FBX contains three low-poly convex helpers named:

- `UCX_SM_Hushpoint_Floodlight_00` — base volume
- `UCX_SM_Hushpoint_Floodlight_01` — octagonal mast volume
- `UCX_SM_Hushpoint_Floodlight_02` — lamp-head volume

Together they are 52 triangles. Blender FBX re-import proves the names and geometry survive interchange; Unreal collision binding remains pending until the editor is installed. In Unreal, disable automatic collision generation, use Project Default/Simple collision, and inspect all three hulls in the Static Mesh Editor.

Software Lumen on the target Intel Iris Xe setup requires an in-editor visual check. If this open render mesh produces mesh-distance-field artifacts, turn off **Affect Distance Field Lighting** for this asset and let the authored light components plus nearby closed architecture provide the lighting response. Nanite should remain off initially; LOD0 is only 7,088 triangles. No extra LODs or baked-lightmap UV were invented without Unreal profiling.

Visual QA also shows that the SAM 3D reconstruction has coarse, asymmetric reflector geometry, especially in the right lamp housing. The silhouette and material read correctly at mid/background distance, but this is a prototype prop—not a final close-up hero asset.

## Rebuild

From `games/hushpoint-unreal`:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\run_floodlight_pipeline.ps1
```

The wrapper requires Blender 4.5.10 LTS. The verified session runtime was `%TEMP%\hushpoint-blender-4.5.10\runtime\blender-4.5.10-windows-x64\blender.exe`; a different machine can pass `-BlenderPath` explicitly.

The pipeline uses no random operations and emits deterministic geometry. Two clean rebuilds produced the same GLB SHA-256. Blender's FBX/BLEND serialization and EEVEE PNG output include session-dependent binary/render data, so those formats are validated semantically by re-import and metrics rather than falsely claimed byte-identical.

## Local adaptation provenance

The pipeline structurally adapts the repository's original `games/hushpoint/tools/blender_asset_pipeline.py` pattern (immutable input, transform cleanup, triangulation, GLB re-import, JSON report). The Unreal version adds meter-to-centimeter reporting, ground-center pivot normalization, FBX export/re-import, UCX collision helpers, packed BLEND output, and a neutral preview. No third-party geometry or code was copied into the asset beyond the explicitly recorded Higgsfield-generated source.
