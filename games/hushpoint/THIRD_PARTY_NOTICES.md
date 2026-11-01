# Third-party notices

## Godot Engine 4.7.2

HUSHPOINT is built and exported with Godot Engine 4.7.2, distributed under the MIT License.

- Project: https://godotengine.org/
- Source and release: https://github.com/godotengine/godot/releases/tag/4.7.2-stable
- License: https://godotengine.org/license/

The Windows release includes `COPYRIGHT.txt` alongside the executable with Godot's copyright and MIT license statement. This project documentation also links the official license page and comprehensive third-party component notice.

## Blender 4.5.10 LTS

Blender was used as an offline content-processing tool to clean, triangulate, validate, and re-export the tide-gauge GLB, and to generate the project's original harbor service truck from a deterministic Python source file. Blender is distributed under the GNU General Public License; Blender is not embedded in or redistributed with the game.

- Release: https://www.blender.org/download/lts/4-5/
- License: https://www.blender.org/about/license/
- glTF exporter documentation: https://docs.blender.org/manual/en/4.5/addons/import_export/scene_gltf2.html

The portable archive was checked against Blender's published SHA-256 manifest before use. Exact version, hashes, geometry counts, and re-import results are recorded in `assets/reports/hushpoint_tide_gauge_pipeline.json` and `assets/reports/hushpoint_service_truck_generation.json`. The service truck contains no third-party geometry or textures; its Higgsfield concept reference was used for broad material language only.

## Higgsfield-generated tide gauge

One original concept image and one textured source mesh were generated through the user's connected Higgsfield account specifically for HUSHPOINT. The source files are preserved for provenance; only the Blender-cleaned GLB under `assets/models/` is loaded by the game.

- Concept model: Z Image
- Concept job: `4ff7cf22-39f3-40ab-853e-99e5d0c5e903` (0.15 credit)
- Mesh model: SAM 3D / `sam_3_3d`
- Mesh job: `c7b785d4-fa62-4e8a-b570-c8459f1e15fd` (1 credit)
- Generation date: 2026-11-01
- Exact prompts, seed, detection threshold, and source hashes: `assets/reports/higgsfield_tide_gauge_lineage.json`
- Optimized output hash and geometry validation: `assets/reports/hushpoint_tide_gauge_pipeline.json`

Commercial-use status is intentionally conservative. Higgsfield's official ownership help page says outputs may be used commercially on all plans, while its official pricing table marks commercial use as unavailable on the Free plan. Because the connected workspace reported the Free plan, this generated asset is approved here for prototype/evaluation use only. Before a commercial release, obtain written clarification from Higgsfield or regenerate and revalidate the asset under a plan that explicitly includes commercial use.

- Ownership help: https://higgsfield.ai/creator-hub/help-center/account/who-owns-my-generations-and-can-i-use-them-commercially
- Pricing table: https://higgsfield.ai/pricing

## Reference games and public engineering sources

Resident Evil 2, Alien: Isolation, and Dead Space informed abstract design lessons only. No code, art, animation, model, texture, sound, UI, character, story, or puzzle solution was copied. NOAA, U.S. Army Corps of Engineers, National Weather Service, and Rijkswaterstaat material was used only to ground broad civic-infrastructure concepts; no source asset is redistributed.

All other shipped geometry, materials, shaders, procedural audio, writing, code, and UI were authored for HUSHPOINT.
