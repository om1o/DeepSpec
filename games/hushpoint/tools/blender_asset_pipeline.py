"""Deterministic static-asset cleanup and GLB validation for HUSHPOINT.

Run inside Blender:
    blender --background --factory-startup --python blender_asset_pipeline.py -- \
      --input source.glb --output optimized.glb --report report.json

The input is opened read-only and is never overwritten. The script exits non-zero
when the asset cannot be imported, exported, or re-imported cleanly.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
import traceback
from pathlib import Path
from typing import Any

import bpy
from mathutils import Vector


PIPELINE_VERSION = "1.0.0"
DEFAULT_MATERIAL_NAME = "Hushpoint_Default_PBR"


def parse_args() -> argparse.Namespace:
    try:
        separator = sys.argv.index("--")
        args = sys.argv[separator + 1 :]
    except ValueError:
        args = []

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, help="Source GLB. Never modified.")
    parser.add_argument("--output", required=True, help="Optimized GLB destination.")
    parser.add_argument("--report", required=True, help="JSON validation report.")
    parser.add_argument(
        "--decimate-threshold",
        type=int,
        default=50_000,
        help="Only decimate when the imported total exceeds this triangle count.",
    )
    parser.add_argument(
        "--target-triangles",
        type=int,
        default=30_000,
        help="Approximate total triangle target after decimation.",
    )
    parser.add_argument(
        "--asset-name",
        default="",
        help="Optional stable name written into the root object and report.",
    )
    return parser.parse_args(args)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def clean_scene() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)


def mesh_objects() -> list[bpy.types.Object]:
    return sorted(
        (obj for obj in bpy.context.scene.objects if obj.type == "MESH"),
        key=lambda obj: obj.name,
    )


def select_only(obj: bpy.types.Object) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    obj.hide_set(False)
    obj.hide_viewport = False
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def evaluated_triangle_count(obj: bpy.types.Object) -> int:
    dependency_graph = bpy.context.evaluated_depsgraph_get()
    evaluated = obj.evaluated_get(dependency_graph)
    temporary_mesh = evaluated.to_mesh()
    try:
        temporary_mesh.calc_loop_triangles()
        return len(temporary_mesh.loop_triangles)
    finally:
        evaluated.to_mesh_clear()


def scene_metrics(objects: list[bpy.types.Object]) -> dict[str, Any]:
    vertices = 0
    triangles = 0
    material_names: set[str] = set()
    minimum = [math.inf, math.inf, math.inf]
    maximum = [-math.inf, -math.inf, -math.inf]

    for obj in objects:
        vertices += len(obj.data.vertices)
        triangles += evaluated_triangle_count(obj)
        material_names.update(
            slot.material.name for slot in obj.material_slots if slot.material is not None
        )
        for corner in obj.bound_box:
            world_corner = obj.matrix_world @ Vector(corner)
            for axis in range(3):
                minimum[axis] = min(minimum[axis], world_corner[axis])
                maximum[axis] = max(maximum[axis], world_corner[axis])

    if not objects:
        minimum = [0.0, 0.0, 0.0]
        maximum = [0.0, 0.0, 0.0]

    dimensions = [maximum[index] - minimum[index] for index in range(3)]
    return {
        "mesh_objects": len(objects),
        "vertices": vertices,
        "triangles": triangles,
        "materials": sorted(material_names),
        "bounds_min_m": [round(value, 6) for value in minimum],
        "bounds_max_m": [round(value, 6) for value in maximum],
        "dimensions_m": [round(value, 6) for value in dimensions],
    }


def ensure_default_material() -> bpy.types.Material:
    material = bpy.data.materials.get(DEFAULT_MATERIAL_NAME)
    if material is None:
        material = bpy.data.materials.new(DEFAULT_MATERIAL_NAME)
    material.use_nodes = True
    nodes = material.node_tree.nodes
    shader = next((node for node in nodes if node.type == "BSDF_PRINCIPLED"), None)
    output = next((node for node in nodes if node.type == "OUTPUT_MATERIAL"), None)
    if shader is None:
        shader = nodes.new("ShaderNodeBsdfPrincipled")
    if output is None:
        output = nodes.new("ShaderNodeOutputMaterial")
    surface = output.inputs.get("Surface")
    if surface is not None and not surface.is_linked:
        material.node_tree.links.new(shader.outputs["BSDF"], surface)
    base_color = shader.inputs.get("Base Color")
    if base_color is not None and not base_color.is_linked:
        base_color.default_value = (0.18, 0.21, 0.22, 1.0)
    roughness = shader.inputs.get("Roughness")
    if roughness is not None and not roughness.is_linked:
        roughness.default_value = 0.72
    return material


def sanitize_material(material: bpy.types.Material, warnings: list[str]) -> None:
    material.use_nodes = True
    if material.node_tree is None:
        warnings.append(f"Material {material.name!r} has no node tree.")
        return
    nodes = material.node_tree.nodes
    shader = next((node for node in nodes if node.type == "BSDF_PRINCIPLED"), None)
    output = next((node for node in nodes if node.type == "OUTPUT_MATERIAL"), None)
    if shader is None:
        shader = nodes.new("ShaderNodeBsdfPrincipled")
        shader.name = "Principled BSDF"
        warnings.append(f"Added missing Principled BSDF to material {material.name!r}.")
    if output is None:
        output = nodes.new("ShaderNodeOutputMaterial")
        output.name = "Material Output"
        warnings.append(f"Added missing output node to material {material.name!r}.")
    surface = output.inputs.get("Surface")
    if surface is not None and not surface.is_linked:
        material.node_tree.links.new(shader.outputs["BSDF"], surface)
        warnings.append(f"Linked missing surface output for material {material.name!r}.")

    for input_name, low, high in (
        ("Metallic", 0.0, 1.0),
        ("Roughness", 0.04, 1.0),
        ("Alpha", 0.0, 1.0),
    ):
        socket = shader.inputs.get(input_name)
        if socket is not None and not socket.is_linked:
            socket.default_value = min(high, max(low, float(socket.default_value)))

    for node in nodes:
        if node.type == "TEX_IMAGE" and node.image is not None:
            image_path = bpy.path.abspath(node.image.filepath)
            if image_path and not Path(image_path).exists() and not node.image.packed_file:
                warnings.append(
                    f"Missing external texture for material {material.name!r}: "
                    f"{Path(image_path).name}"
                )


def apply_modifier(obj: bpy.types.Object, modifier: bpy.types.Modifier) -> None:
    select_only(obj)
    bpy.ops.object.modifier_apply(modifier=modifier.name)


def uses_image_textures(obj: bpy.types.Object) -> bool:
    if len(obj.data.uv_layers) == 0:
        return False
    for slot in obj.material_slots:
        material = slot.material
        if material is None or not material.use_nodes or material.node_tree is None:
            continue
        if any(node.type == "TEX_IMAGE" and node.image is not None for node in material.node_tree.nodes):
            return True
    return False


def clean_meshes(
    objects: list[bpy.types.Object],
    decimate_threshold: int,
    target_triangles: int,
    warnings: list[str],
) -> dict[str, Any]:
    default_material = ensure_default_material()

    for material in sorted(bpy.data.materials, key=lambda item: item.name):
        sanitize_material(material, warnings)

    for obj in objects:
        if len(obj.data.materials) == 0:
            obj.data.materials.append(default_material)
            warnings.append(f"Assigned default PBR material to {obj.name!r}.")
        select_only(obj)
        bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
        changed = obj.data.validate(verbose=False, clean_customdata=False)
        if changed:
            warnings.append(f"Blender repaired invalid mesh data on {obj.name!r}.")
        obj.data.update(calc_edges=True)

        triangulate = obj.modifiers.new(name="HUSHPOINT_Triangulate", type="TRIANGULATE")
        triangulate.keep_custom_normals = True
        apply_modifier(obj, triangulate)

    before_decimation = scene_metrics(objects)["triangles"]
    decimated = before_decimation > decimate_threshold
    requested_ratio = 1.0
    if decimated:
        requested_ratio = min(1.0, max(0.01, target_triangles / before_decimation))
        for obj in objects:
            object_triangles = evaluated_triangle_count(obj)
            if object_triangles < 24:
                continue
            modifier = obj.modifiers.new(name="HUSHPOINT_Decimate", type="DECIMATE")
            modifier.decimate_type = "COLLAPSE"
            modifier.ratio = requested_ratio
            modifier.use_collapse_triangulate = True
            apply_modifier(obj, modifier)

    weighted_normal_objects: list[str] = []
    preserved_textured_normals: list[str] = []
    for obj in objects:
        if len(obj.data.polygons) == 0:
            continue
        if uses_image_textures(obj):
            preserved_textured_normals.append(obj.name)
            continue
        try:
            modifier = obj.modifiers.new(name="HUSHPOINT_WeightedNormals", type="WEIGHTED_NORMAL")
            modifier.keep_sharp = True
            modifier.weight = 50
            apply_modifier(obj, modifier)
            weighted_normal_objects.append(obj.name)
        except (AttributeError, RuntimeError) as error:
            warnings.append(f"Weighted normals skipped for {obj.name!r}: {error}")
            stale = obj.modifiers.get("HUSHPOINT_WeightedNormals")
            if stale is not None:
                obj.modifiers.remove(stale)

    return {
        "decimation_applied": decimated,
        "decimate_threshold": decimate_threshold,
        "target_triangles": target_triangles,
        "requested_decimate_ratio": round(requested_ratio, 6),
        "weighted_normals_applied": weighted_normal_objects,
        "weighted_normals_skipped_textured": preserved_textured_normals,
    }


def normalize_names(objects: list[bpy.types.Object], asset_name: str) -> None:
    if not asset_name:
        return
    safe_name = "_".join(asset_name.strip().split())
    if len(objects) == 1:
        objects[0].name = safe_name
        objects[0].data.name = f"{safe_name}_Mesh"
        return
    for index, obj in enumerate(objects, start=1):
        obj.name = f"__HUSHPOINT_TMP_{index:04d}"
        obj.data.name = f"__HUSHPOINT_TMP_MESH_{index:04d}"
    for index, obj in enumerate(objects, start=1):
        obj.name = f"{safe_name}_{index:02d}"
        obj.data.name = f"{safe_name}_{index:02d}_Mesh"


def export_glb(output_path: Path, objects: list[bpy.types.Object]) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.hide_set(False)
        obj.hide_viewport = False
        obj.hide_render = False
        obj.select_set(True)
    if objects:
        bpy.context.view_layer.objects.active = objects[0]
    result = bpy.ops.export_scene.gltf(
        filepath=str(output_path),
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_normals=True,
        export_texcoords=True,
        export_materials="EXPORT",
        export_cameras=False,
        export_lights=False,
        export_animations=False,
        export_extras=True,
    )
    if "FINISHED" not in result:
        raise RuntimeError(f"GLB export did not finish: {result}")


def validate_reimport(output_path: Path) -> dict[str, Any]:
    clean_scene()
    result = bpy.ops.import_scene.gltf(filepath=str(output_path))
    if "FINISHED" not in result:
        raise RuntimeError(f"Optimized GLB re-import did not finish: {result}")
    objects = mesh_objects()
    if not objects:
        raise RuntimeError("Optimized GLB contains no mesh objects.")
    for obj in objects:
        for vertex in obj.data.vertices:
            if not all(math.isfinite(value) for value in vertex.co):
                raise RuntimeError(f"Optimized GLB has non-finite geometry in {obj.name!r}.")
    metrics = scene_metrics(objects)
    if metrics["triangles"] <= 0:
        raise RuntimeError("Optimized GLB contains no triangles.")
    if not all(math.isfinite(value) for value in metrics["dimensions_m"]):
        raise RuntimeError("Optimized GLB has invalid dimensions.")
    return {"status": "pass", **metrics}


def write_report(path: Path, report: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def main() -> int:
    args = parse_args()
    input_path = Path(args.input).expanduser().resolve()
    output_path = Path(args.output).expanduser().resolve()
    report_path = Path(args.report).expanduser().resolve()

    if input_path == output_path:
        raise ValueError("Input and output must be different so the source remains preserved.")
    if not input_path.is_file():
        raise FileNotFoundError(f"Input GLB does not exist: {input_path}")
    if input_path.suffix.lower() not in {".glb", ".gltf"}:
        raise ValueError("Input must be a .glb or .gltf file.")
    if output_path.suffix.lower() != ".glb":
        raise ValueError("Output must use the .glb extension.")
    if args.decimate_threshold < 1 or args.target_triangles < 1:
        raise ValueError("Triangle thresholds must be positive integers.")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    warnings: list[str] = []
    report: dict[str, Any] = {
        "asset_name": args.asset_name or input_path.stem,
        "blender_version": bpy.app.version_string,
        "input_file": input_path.name,
        "input_sha256": sha256(input_path),
        "output_file": output_path.name,
        "pipeline_version": PIPELINE_VERSION,
        "status": "running",
    }

    try:
        clean_scene()
        imported = bpy.ops.import_scene.gltf(filepath=str(input_path))
        if "FINISHED" not in imported:
            raise RuntimeError(f"GLB import did not finish: {imported}")
        objects = mesh_objects()
        if not objects:
            raise RuntimeError("Input contains no mesh objects.")
        report["before"] = scene_metrics(objects)
        normalize_names(objects, args.asset_name)
        report["operations"] = clean_meshes(
            objects,
            args.decimate_threshold,
            args.target_triangles,
            warnings,
        )
        objects = mesh_objects()
        report["after_cleanup"] = scene_metrics(objects)
        export_glb(output_path, objects)
        report["output_sha256"] = sha256(output_path)
        report["reimport_validation"] = validate_reimport(output_path)
        report["warnings"] = sorted(set(warnings))
        report["status"] = "pass"
        write_report(report_path, report)
        print(f"HUSHPOINT_PIPELINE_PASS: {output_path}")
        print(f"HUSHPOINT_PIPELINE_REPORT: {report_path}")
        return 0
    except Exception as error:
        report["status"] = "fail"
        report["error"] = f"{type(error).__name__}: {error}"
        report["warnings"] = sorted(set(warnings))
        write_report(report_path, report)
        traceback.print_exc()
        print(f"HUSHPOINT_PIPELINE_FAIL: {report_path}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
