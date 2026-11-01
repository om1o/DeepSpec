"""Prepare the Higgsfield floodlight as a static mesh for Unreal Engine.

The source GLB is treated as immutable.  The pipeline normalizes the generated
mesh to a deliberate real-world height, places a ground-contact pivot at the
world origin, preserves its PBR material and embedded texture, and emits GLB,
FBX, BLEND, preview, and JSON validation artifacts.

Run with Blender 4.5.10 LTS in background mode.  No randomness is used.
"""

from __future__ import annotations

import argparse
import datetime
import hashlib
import json
import math
import sys
import traceback
import types
from pathlib import Path
from typing import Any

import bmesh
import bpy
from mathutils import Matrix, Vector


PIPELINE_VERSION = "1.0.0"
TARGET_BLENDER_VERSION = (4, 5, 10)
DEFAULT_ASSET_NAME = "SM_Hushpoint_Floodlight"
DEFAULT_MATERIAL_NAME = "M_Hushpoint_Floodlight"


def parse_args() -> argparse.Namespace:
    try:
        separator = sys.argv.index("--")
        values = sys.argv[separator + 1 :]
    except ValueError:
        values = []

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, help="Immutable provider GLB.")
    parser.add_argument("--output-glb", required=True)
    parser.add_argument("--output-fbx", required=True)
    parser.add_argument("--output-blend", required=True)
    parser.add_argument("--preview", required=True)
    parser.add_argument("--report", required=True)
    parser.add_argument("--asset-name", default=DEFAULT_ASSET_NAME)
    parser.add_argument("--target-height-m", type=float, default=4.2)
    parser.add_argument("--triangle-budget", type=int, default=60_000)
    return parser.parse_args(values)


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def clean_scene() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.length_unit = "METERS"
    scene.unit_settings.scale_length = 1.0


def mesh_objects() -> list[bpy.types.Object]:
    return sorted(
        (obj for obj in bpy.context.scene.objects if obj.type == "MESH"),
        key=lambda item: item.name,
    )


def select_only(objects: list[bpy.types.Object], active: bpy.types.Object) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.hide_set(False)
        obj.hide_viewport = False
        obj.select_set(True)
    bpy.context.view_layer.objects.active = active


def object_bounds(objects: list[bpy.types.Object]) -> tuple[Vector, Vector]:
    minimum = Vector((math.inf, math.inf, math.inf))
    maximum = Vector((-math.inf, -math.inf, -math.inf))
    for obj in objects:
        # Read mesh coordinates directly.  Object.bound_box may remain cached
        # for one dependency-graph update after data.transform(), which makes
        # it unsafe for the pivot assertion immediately below that operation.
        for vertex in obj.data.vertices:
            point = obj.matrix_world @ vertex.co
            for axis in range(3):
                minimum[axis] = min(minimum[axis], point[axis])
                maximum[axis] = max(maximum[axis], point[axis])
    if not objects:
        return Vector((0.0, 0.0, 0.0)), Vector((0.0, 0.0, 0.0))
    return minimum, maximum


def topology_metrics(obj: bpy.types.Object) -> dict[str, int]:
    mesh = obj.data
    mesh.calc_loop_triangles()
    working = bmesh.new()
    try:
        working.from_mesh(mesh)
        boundary_edges = sum(1 for edge in working.edges if edge.is_boundary)
        non_manifold_edges = sum(1 for edge in working.edges if not edge.is_manifold)
        loose_edges = sum(1 for edge in working.edges if len(edge.link_faces) == 0)
        loose_vertices = sum(1 for vertex in working.verts if len(vertex.link_edges) == 0)
        degenerate_faces = sum(1 for face in working.faces if face.calc_area() <= 1.0e-12)
    finally:
        working.free()
    return {
        "boundary_edges": boundary_edges,
        "degenerate_faces": degenerate_faces,
        "edges": len(mesh.edges),
        "faces": len(mesh.polygons),
        "loose_edges": loose_edges,
        "loose_vertices": loose_vertices,
        "non_manifold_edges": non_manifold_edges,
        "triangles": len(mesh.loop_triangles),
        "vertices": len(mesh.vertices),
    }


def material_metrics(objects: list[bpy.types.Object]) -> dict[str, Any]:
    materials: dict[str, dict[str, Any]] = {}
    for obj in objects:
        for slot in obj.material_slots:
            material = slot.material
            if material is None or material.name in materials:
                continue
            images: list[dict[str, Any]] = []
            if material.use_nodes and material.node_tree is not None:
                for node in material.node_tree.nodes:
                    if node.type != "TEX_IMAGE" or node.image is None:
                        continue
                    image = node.image
                    images.append(
                        {
                            "name": image.name,
                            "packed": image.packed_file is not None,
                            "size_px": [int(image.size[0]), int(image.size[1])],
                        }
                    )
            materials[material.name] = {
                "image_textures": sorted(images, key=lambda item: item["name"]),
                "uses_nodes": bool(material.use_nodes),
            }
    return {
        "count": len(materials),
        "materials": [
            {"name": name, **materials[name]} for name in sorted(materials)
        ],
        "uv_layers": {
            obj.name: sorted(layer.name for layer in obj.data.uv_layers) for obj in objects
        },
    }


def scene_metrics(objects: list[bpy.types.Object]) -> dict[str, Any]:
    minimum, maximum = object_bounds(objects)
    dimensions = maximum - minimum
    topology = [
        {"object": obj.name, **topology_metrics(obj)} for obj in sorted(objects, key=lambda item: item.name)
    ]
    return {
        "bounds_max_m": [round(float(value), 6) for value in maximum],
        "bounds_min_m": [round(float(value), 6) for value in minimum],
        "dimensions_cm": [round(float(value) * 100.0, 3) for value in dimensions],
        "dimensions_m": [round(float(value), 6) for value in dimensions],
        "materials": material_metrics(objects),
        "mesh_objects": len(objects),
        "topology": topology,
        "totals": {
            key: sum(item[key] for item in topology)
            for key in (
                "boundary_edges",
                "degenerate_faces",
                "edges",
                "faces",
                "loose_edges",
                "loose_vertices",
                "non_manifold_edges",
                "triangles",
                "vertices",
            )
        },
    }


def assert_finite_geometry(objects: list[bpy.types.Object]) -> None:
    if not objects:
        raise RuntimeError("The scene contains no mesh objects.")
    for obj in objects:
        for vertex in obj.data.vertices:
            if not all(math.isfinite(component) for component in vertex.co):
                raise RuntimeError(f"Non-finite vertex found in {obj.name!r}.")


def import_glb(path: Path) -> list[bpy.types.Object]:
    result = bpy.ops.import_scene.gltf(filepath=str(path))
    if "FINISHED" not in result:
        raise RuntimeError(f"glTF import failed: {result}")
    objects = mesh_objects()
    assert_finite_geometry(objects)
    return objects


def join_meshes(objects: list[bpy.types.Object]) -> bpy.types.Object:
    if len(objects) == 1:
        return objects[0]
    select_only(objects, objects[0])
    result = bpy.ops.object.join()
    if "FINISHED" not in result:
        raise RuntimeError(f"Mesh join failed: {result}")
    joined = bpy.context.view_layer.objects.active
    if joined is None or joined.type != "MESH":
        raise RuntimeError("Mesh join did not produce an active mesh object.")
    return joined


def ensure_material(obj: bpy.types.Object, warnings: list[str]) -> None:
    if len(obj.data.materials) == 0:
        material = bpy.data.materials.new(DEFAULT_MATERIAL_NAME)
        material.use_nodes = True
        shader = material.node_tree.nodes.get("Principled BSDF")
        if shader is not None:
            shader.inputs["Base Color"].default_value = (0.16, 0.18, 0.19, 1.0)
            shader.inputs["Metallic"].default_value = 0.72
            shader.inputs["Roughness"].default_value = 0.48
        obj.data.materials.append(material)
        warnings.append("Source had no material; a neutral metal PBR material was added.")
        return

    for index, material in enumerate(obj.data.materials, start=1):
        if material is None:
            continue
        material.name = DEFAULT_MATERIAL_NAME if index == 1 else f"{DEFAULT_MATERIAL_NAME}_{index:02d}"
        material.use_nodes = True
        if material.node_tree is None:
            warnings.append(f"Material {material.name!r} has no node tree.")
            continue
        shader = next(
            (node for node in material.node_tree.nodes if node.type == "BSDF_PRINCIPLED"),
            None,
        )
        output = next(
            (node for node in material.node_tree.nodes if node.type == "OUTPUT_MATERIAL"),
            None,
        )
        if shader is None or output is None:
            warnings.append(
                f"Material {material.name!r} lacks a complete Principled output chain; source nodes were preserved."
            )


def prepare_asset(
    objects: list[bpy.types.Object],
    asset_name: str,
    target_height_m: float,
    triangle_budget: int,
    warnings: list[str],
) -> tuple[bpy.types.Object, dict[str, Any]]:
    for obj in objects:
        select_only([obj], obj)
        bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
        repaired = obj.data.validate(verbose=False, clean_customdata=False)
        if repaired:
            warnings.append(f"Blender repaired invalid mesh data in {obj.name!r}.")
        obj.data.update(calc_edges=True)

    joined = join_meshes(objects)
    joined.name = asset_name
    joined.data.name = f"{asset_name}_Mesh"
    ensure_material(joined, warnings)

    select_only([joined], joined)
    triangulate = joined.modifiers.new(name="Hushpoint_Triangulate", type="TRIANGULATE")
    triangulate.keep_custom_normals = True
    bpy.ops.object.modifier_apply(modifier=triangulate.name)

    minimum, maximum = object_bounds([joined])
    source_height = maximum.z - minimum.z
    if source_height <= 1.0e-6:
        raise RuntimeError("Source mesh has no measurable height.")
    scale_factor = target_height_m / source_height
    joined.data.transform(Matrix.Scale(scale_factor, 4))
    joined.data.update(calc_edges=True)

    minimum, maximum = object_bounds([joined])
    pivot = Vector(
        (
            (minimum.x + maximum.x) * 0.5,
            (minimum.y + maximum.y) * 0.5,
            minimum.z,
        )
    )
    joined.data.transform(Matrix.Translation(-pivot))
    joined.data.update(calc_edges=True)
    joined.location = (0.0, 0.0, 0.0)
    joined.rotation_euler = (0.0, 0.0, 0.0)
    joined.scale = (1.0, 1.0, 1.0)

    joined["asset_type"] = "static_mesh"
    joined["source_provider"] = "Higgsfield SAM 3D"
    joined["source_job_id"] = "99aec965-11b1-4c20-af4d-ca064aac2d77"
    joined["target_height_m"] = target_height_m
    joined["ue_units"] = "centimeters"

    final_topology = topology_metrics(joined)
    if final_topology["triangles"] > triangle_budget:
        warnings.append(
            f"Triangle count {final_topology['triangles']} exceeds the {triangle_budget} static-prop budget; no destructive decimation was applied."
        )
    if final_topology["degenerate_faces"]:
        warnings.append(
            f"Mesh retains {final_topology['degenerate_faces']} zero-area faces after validation."
        )
    if final_topology["non_manifold_edges"]:
        warnings.append(
            f"Mesh has {final_topology['non_manifold_edges']} non-manifold edges; acceptable for rendering only after visual review, not fabrication or collision generation."
        )
    if len(joined.data.uv_layers) == 0:
        warnings.append("Mesh has no UV layer; the provider texture cannot map reliably.")

    minimum, maximum = object_bounds([joined])
    pivot_error = {
        "bottom_z_m": round(float(minimum.z), 9),
        "center_x_m": round(float((minimum.x + maximum.x) * 0.5), 9),
        "center_y_m": round(float((minimum.y + maximum.y) * 0.5), 9),
    }
    if max(abs(value) for value in pivot_error.values()) > 1.0e-5:
        raise RuntimeError(f"Ground-center pivot normalization failed: {pivot_error}")

    return joined, {
        "joined_meshes": len(objects),
        "pivot": "ground_center_at_world_origin",
        "pivot_error": pivot_error,
        "source_height_m": round(float(source_height), 6),
        "target_height_m": round(float(target_height_m), 6),
        "uniform_scale_factor": round(float(scale_factor), 9),
        "unreal_expected_height_cm": round(float(target_height_m) * 100.0, 3),
        "unreal_import_uniform_scale": 1.0,
    }


def pack_images() -> None:
    for image in sorted(bpy.data.images, key=lambda item: item.name):
        if image.source == "VIEWER" or image.packed_file is not None:
            continue
        try:
            image.pack()
        except RuntimeError:
            pass


def create_collision_proxies(
    asset: bpy.types.Object,
    target_height_m: float,
) -> tuple[list[bpy.types.Object], dict[str, Any]]:
    """Create simple convex volumes using Unreal's UCX naming contract."""
    minimum, maximum = object_bounds([asset])
    dimensions = maximum - minimum
    base_height = target_height_m * 0.07
    head_height = target_height_m * 0.24
    head_bottom = target_height_m - head_height
    mast_depth = head_bottom - base_height

    collection = bpy.data.collections.new("Collision_Proxies")
    bpy.context.scene.collection.children.link(collection)
    proxies: list[bpy.types.Object] = []

    def move_to_collision_collection(obj: bpy.types.Object) -> None:
        select_only([obj], obj)
        triangulate = obj.modifiers.new(name="Hushpoint_Collision_Triangulate", type="TRIANGULATE")
        bpy.ops.object.modifier_apply(modifier=triangulate.name)
        for owner in list(obj.users_collection):
            owner.objects.unlink(obj)
        collection.objects.link(obj)
        obj.display_type = "WIRE"
        obj.hide_render = True
        obj["collision_role"] = "unreal_simple_collision"

    def add_box(name: str, size: tuple[float, float, float], z: float) -> None:
        bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0.0, 0.0, z))
        obj = bpy.context.object
        obj.name = name
        obj.data.name = f"{name}_Mesh"
        obj.dimensions = size
        select_only([obj], obj)
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        move_to_collision_collection(obj)
        proxies.append(obj)

    add_box(
        f"UCX_{asset.name}_00",
        (float(dimensions.x) * 0.96, float(dimensions.y) * 0.96, base_height),
        base_height * 0.5,
    )

    bpy.ops.mesh.primitive_cylinder_add(
        vertices=8,
        radius=float(min(dimensions.x, dimensions.y)) * 0.115,
        depth=mast_depth,
        end_fill_type="NGON",
        location=(0.0, 0.0, base_height + mast_depth * 0.5),
    )
    mast = bpy.context.object
    mast.name = f"UCX_{asset.name}_01"
    mast.data.name = f"{mast.name}_Mesh"
    select_only([mast], mast)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    move_to_collision_collection(mast)
    proxies.append(mast)

    add_box(
        f"UCX_{asset.name}_02",
        (float(dimensions.x) * 0.96, float(dimensions.y) * 0.82, head_height),
        head_bottom + head_height * 0.5,
    )

    metrics = [
        {
            "dimensions_cm": [round(float(value) * 100.0, 3) for value in obj.dimensions],
            "name": obj.name,
            "shape": "octagonal_prism" if index == 1 else "box",
            "triangles": topology_metrics(obj)["triangles"],
        }
        for index, obj in enumerate(proxies)
    ]
    return proxies, {
        "count": len(proxies),
        "objects": metrics,
        "total_triangles": sum(item["triangles"] for item in metrics),
        "usage": "Unreal simple collision only; excluded from rendered GLB and preview.",
    }


def export_glb(path: Path, obj: bpy.types.Object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    select_only([obj], obj)
    result = bpy.ops.export_scene.gltf(
        filepath=str(path),
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_normals=True,
        export_tangents=True,
        export_texcoords=True,
        export_materials="EXPORT",
        export_image_format="AUTO",
        export_cameras=False,
        export_lights=False,
        export_animations=False,
        export_extras=True,
    )
    if "FINISHED" not in result:
        raise RuntimeError(f"GLB export failed: {result}")


def export_fbx(
    path: Path,
    obj: bpy.types.Object,
    collision_proxies: list[bpy.types.Object],
) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    select_only([obj, *collision_proxies], obj)

    # Blender's FBX writer otherwise embeds the current wall-clock time in the
    # header.  Supplying a fixed generation date makes the interchange file
    # byte-reproducible without modifying Blender's installed add-on.
    from io_scene_fbx import export_fbx_bin

    class FixedDateTime(datetime.datetime):
        @classmethod
        def now(cls, tz: datetime.tzinfo | None = None) -> "FixedDateTime":
            fixed = cls(2026, 11, 1, 0, 0, 0, 0)
            return fixed if tz is None else fixed.astimezone(tz)

    export_fbx_bin.datetime = types.SimpleNamespace(datetime=FixedDateTime)
    result = bpy.ops.export_scene.fbx(
        filepath=str(path),
        use_selection=True,
        object_types={"MESH"},
        global_scale=1.0,
        apply_unit_scale=True,
        apply_scale_options="FBX_SCALE_UNITS",
        use_space_transform=True,
        bake_space_transform=False,
        axis_forward="-Y",
        axis_up="Z",
        use_mesh_modifiers=True,
        mesh_smooth_type="FACE",
        use_tspace=True,
        use_custom_props=True,
        add_leaf_bones=False,
        bake_anim=False,
        path_mode="COPY",
        embed_textures=True,
    )
    if "FINISHED" not in result:
        raise RuntimeError(f"FBX export failed: {result}")


def save_blend(
    path: Path,
    obj: bpy.types.Object,
    collision_proxies: list[bpy.types.Object],
) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    select_only([obj, *collision_proxies], obj)
    pack_images()
    bpy.context.preferences.filepaths.save_version = 0
    result = bpy.ops.wm.save_as_mainfile(filepath=str(path), compress=True)
    if "FINISHED" not in result:
        raise RuntimeError(f"BLEND save failed: {result}")


def look_at(obj: bpy.types.Object, point: Vector) -> None:
    obj.rotation_euler = (point - obj.location).to_track_quat("-Z", "Y").to_euler()


def make_preview(path: Path, obj: bpy.types.Object, target_height_m: float) -> None:
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.render.resolution_x = 1024
    scene.render.resolution_y = 1024
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    scene.render.filepath = str(path)
    scene.render.image_settings.color_mode = "RGBA"
    scene.view_settings.look = "AgX - Medium High Contrast"

    world = bpy.data.worlds.new("Hushpoint_Preview_World")
    world.use_nodes = True
    background = world.node_tree.nodes.get("Background")
    background.inputs["Color"].default_value = (0.115, 0.125, 0.14, 1.0)
    background.inputs["Strength"].default_value = 0.42
    scene.world = world

    bpy.ops.mesh.primitive_plane_add(size=20.0, location=(0.0, 0.0, -0.012))
    floor = bpy.context.object
    floor.name = "Preview_Ground"
    floor_material = bpy.data.materials.new("Preview_Ground_Material")
    floor_material.use_nodes = True
    floor_shader = floor_material.node_tree.nodes.get("Principled BSDF")
    floor_shader.inputs["Base Color"].default_value = (0.16, 0.17, 0.19, 1.0)
    floor_shader.inputs["Metallic"].default_value = 0.0
    floor_shader.inputs["Roughness"].default_value = 0.68
    floor.data.materials.append(floor_material)

    target = Vector((0.0, 0.0, target_height_m * 0.5))
    camera_data = bpy.data.cameras.new("Preview_Camera")
    camera = bpy.data.objects.new("Preview_Camera", camera_data)
    scene.collection.objects.link(camera)
    camera.location = (target_height_m * 1.05, -target_height_m * 1.55, target_height_m * 0.72)
    camera_data.lens = 58.0
    look_at(camera, target)
    scene.camera = camera

    lights = (
        ("Preview_Key", (4.0, -4.5, 7.0), 1150.0, 5.0, (1.0, 0.96, 0.9)),
        ("Preview_Fill", (-4.5, -1.0, 4.0), 780.0, 4.0, (0.82, 0.9, 1.0)),
        ("Preview_Rim", (2.0, 4.0, 6.0), 900.0, 3.0, (1.0, 1.0, 1.0)),
    )
    for name, location, energy, size, color in lights:
        light_data = bpy.data.lights.new(name, type="AREA")
        light_data.energy = energy
        light_data.shape = "DISK"
        light_data.size = size
        light_data.color = color
        light = bpy.data.objects.new(name, light_data)
        scene.collection.objects.link(light)
        light.location = location
        look_at(light, target)

    path.parent.mkdir(parents=True, exist_ok=True)
    result = bpy.ops.render.render(write_still=True)
    if "FINISHED" not in result:
        raise RuntimeError(f"Preview render failed: {result}")


def reimport_glb(path: Path) -> dict[str, Any]:
    clean_scene()
    objects = import_glb(path)
    return validate_reimport("glb", objects)


def reimport_fbx(
    path: Path,
    asset_name: str,
    expected_collision_names: list[str],
) -> tuple[dict[str, Any], dict[str, Any]]:
    clean_scene()
    result = bpy.ops.import_scene.fbx(
        filepath=str(path),
        use_custom_normals=True,
        use_anim=False,
        automatic_bone_orientation=False,
    )
    if "FINISHED" not in result:
        raise RuntimeError(f"FBX re-import failed: {result}")
    objects = mesh_objects()
    assert_finite_geometry(objects)
    collision_objects = sorted(
        (obj for obj in objects if obj.name.startswith(f"UCX_{asset_name}_")),
        key=lambda item: item.name,
    )
    render_objects = [obj for obj in objects if obj not in collision_objects]
    if len(render_objects) != 1 or render_objects[0].name != asset_name:
        raise RuntimeError(
            f"FBX render-mesh identity changed on re-import: {[obj.name for obj in render_objects]}"
        )
    actual_collision_names = [obj.name for obj in collision_objects]
    collision_topology = [
        {"name": obj.name, **topology_metrics(obj)} for obj in collision_objects
    ]
    name_status = "pass" if actual_collision_names == expected_collision_names else "fail"
    collision_validation = {
        "blender_fbx_interchange_status": "pass" if name_status == "pass" else "fail",
        "count": len(collision_objects),
        "expected_names": expected_collision_names,
        "name_status": name_status,
        "objects": collision_topology,
        "total_triangles": sum(item["triangles"] for item in collision_topology),
        "unreal_collision_binding_status": "pending_editor_import",
    }
    if name_status != "pass":
        raise RuntimeError(
            f"FBX collision proxy names changed on re-import: {actual_collision_names}"
        )
    return validate_reimport("fbx", render_objects), collision_validation


def validate_reimport(format_name: str, objects: list[bpy.types.Object]) -> dict[str, Any]:
    metrics = scene_metrics(objects)
    if metrics["totals"]["triangles"] <= 0:
        raise RuntimeError(f"{format_name.upper()} contains no triangles after re-import.")
    height = metrics["dimensions_m"][2]
    minimum = metrics["bounds_min_m"]
    maximum = metrics["bounds_max_m"]
    center_x = (minimum[0] + maximum[0]) * 0.5
    center_y = (minimum[1] + maximum[1]) * 0.5
    pivot_error = max(abs(minimum[2]), abs(center_x), abs(center_y))
    return {
        "format": format_name,
        "geometry_status": "pass",
        "ground_center_pivot_status": "pass" if pivot_error <= 0.001 else "fail",
        "pivot_max_error_m": round(float(pivot_error), 9),
        "reported_height_m": height,
        **metrics,
    }


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def output_record(path: Path) -> dict[str, Any]:
    return {
        "bytes": path.stat().st_size,
        "file": path.name,
        "sha256": file_sha256(path),
    }


def main() -> int:
    args = parse_args()
    input_path = Path(args.input).expanduser().resolve()
    output_glb = Path(args.output_glb).expanduser().resolve()
    output_fbx = Path(args.output_fbx).expanduser().resolve()
    output_blend = Path(args.output_blend).expanduser().resolve()
    preview = Path(args.preview).expanduser().resolve()
    report_path = Path(args.report).expanduser().resolve()
    outputs = [output_glb, output_fbx, output_blend, preview, report_path]

    if not input_path.is_file() or input_path.suffix.lower() != ".glb":
        raise FileNotFoundError(f"Input GLB is missing or invalid: {input_path}")
    if len({path for path in outputs}) != len(outputs):
        raise ValueError("Every output path must be unique.")
    if input_path in outputs:
        raise ValueError("The immutable source cannot be used as an output path.")
    if args.target_height_m <= 0.0 or args.triangle_budget <= 0:
        raise ValueError("Target height and triangle budget must be positive.")

    warnings: list[str] = []
    report: dict[str, Any] = {
        "asset_name": args.asset_name,
        "blender": {
            "actual_version": bpy.app.version_string,
            "required_version": "4.5.10 LTS",
            "version_match": tuple(bpy.app.version) == TARGET_BLENDER_VERSION,
        },
        "coordinate_contract": {
            "blender_glb_units": "meters",
            "fbx_axis_forward": "-Y",
            "fbx_axis_up": "Z",
            "fbx_unit_metadata": "metric; Unreal importer target is centimeters",
            "pivot": "bottom-center at (0, 0, 0)",
            "unreal_expected_height_cm": round(args.target_height_m * 100.0, 3),
            "unreal_import_uniform_scale": 1.0,
        },
        "input": {
            "bytes": input_path.stat().st_size,
            "file": input_path.name,
            "sha256": file_sha256(input_path),
        },
        "pipeline_script_sha256": file_sha256(Path(__file__).resolve()),
        "pipeline_version": PIPELINE_VERSION,
        "status": "running",
    }

    try:
        if not report["blender"]["version_match"]:
            raise RuntimeError(
                f"This deterministic pipeline requires Blender 4.5.10, got {bpy.app.version_string}."
            )

        clean_scene()
        imported_objects = import_glb(input_path)
        report["source_metrics"] = scene_metrics(imported_objects)
        asset, operations = prepare_asset(
            imported_objects,
            args.asset_name,
            args.target_height_m,
            args.triangle_budget,
            warnings,
        )
        report["operations"] = operations
        report["processed_metrics"] = scene_metrics([asset])

        pack_images()
        export_glb(output_glb, asset)
        collision_proxies, collision_metrics = create_collision_proxies(
            asset,
            args.target_height_m,
        )
        report["collision_proxies"] = collision_metrics
        export_fbx(output_fbx, asset, collision_proxies)
        save_blend(output_blend, asset, collision_proxies)
        preview.unlink(missing_ok=True)
        try:
            make_preview(preview, asset, args.target_height_m)
            report["preview_status"] = "pass"
        except Exception as preview_error:
            report["preview_status"] = "fail_non_blocking"
            warnings.append(
                f"Neutral studio preview failed without blocking core interchange outputs: {type(preview_error).__name__}: {preview_error}"
            )

        glb_validation = reimport_glb(output_glb)
        expected_collision_names = [item["name"] for item in collision_metrics["objects"]]
        fbx_validation, fbx_collision_validation = reimport_fbx(
            output_fbx,
            args.asset_name,
            expected_collision_names,
        )
        for validation in (glb_validation, fbx_validation):
            height_error = abs(validation["reported_height_m"] - args.target_height_m)
            validation["height_error_m"] = round(float(height_error), 9)
            validation["height_status"] = "pass" if height_error <= 0.001 else "fail"
            if validation["ground_center_pivot_status"] != "pass" or validation["height_status"] != "pass":
                raise RuntimeError(f"{validation['format'].upper()} scale or pivot validation failed.")

        report["outputs"] = {
            "blend": output_record(output_blend),
            "fbx": output_record(output_fbx),
            "glb": output_record(output_glb),
        }
        if preview.is_file():
            report["outputs"]["preview"] = output_record(preview)
        report["reimport_validation"] = {
            "fbx": {
                "collision_proxies": fbx_collision_validation,
                "render_mesh": fbx_validation,
            },
            "glb": glb_validation,
        }
        report["triangle_budget"] = {
            "budget": args.triangle_budget,
            "count": report["processed_metrics"]["totals"]["triangles"],
            "status": (
                "pass"
                if report["processed_metrics"]["totals"]["triangles"] <= args.triangle_budget
                else "review_required"
            ),
        }
        report["unreal_editor_validation"] = {
            "status": "pending",
            "reason": "Unreal Engine is not installed in this environment; Blender re-import validates render geometry and UCX names but cannot prove Unreal collision binding or distance-field behavior.",
        }
        warnings.append(
            "The provider render mesh is non-manifold. Never use it as auto complex collision or Complex Collision As Simple; use the authored UCX proxies."
        )
        warnings.append(
            "Software Lumen mesh-distance-field behavior requires Unreal visual review. If this open render mesh creates distance-field artifacts, disable Affect Distance Field Lighting for the asset and rely on authored lights and surrounding closed geometry."
        )
        report["warnings"] = sorted(set(warnings))
        report["quality_status"] = "review_required" if warnings else "pass"
        report["status"] = "pass"
        write_json(report_path, report)
        print(f"HUSHPOINT_UE_ASSET_PIPELINE_PASS: {output_glb}")
        print(f"HUSHPOINT_UE_ASSET_REPORT: {report_path}")
        return 0
    except Exception as error:
        report["error"] = f"{type(error).__name__}: {error}"
        report["status"] = "fail"
        report["warnings"] = sorted(set(warnings))
        write_json(report_path, report)
        traceback.print_exc()
        print(f"HUSHPOINT_UE_ASSET_PIPELINE_FAIL: {report_path}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
