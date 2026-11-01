"""Render a neutral visual-QA preview of a GLB inside Blender."""

from __future__ import annotations

import argparse
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector


def arguments() -> argparse.Namespace:
    try:
        separator = sys.argv.index("--")
        values = sys.argv[separator + 1 :]
    except ValueError:
        values = []
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--size", type=int, default=640)
    return parser.parse_args(values)


def point_at(obj: bpy.types.Object, target: Vector) -> None:
    obj.rotation_euler = (target - obj.location).to_track_quat("-Z", "Y").to_euler()


def add_area(name: str, location: tuple[float, float, float], energy: float, size: float, target: Vector) -> None:
    bpy.ops.object.light_add(type="AREA", location=location)
    light = bpy.context.object
    light.name = name
    light.data.energy = energy
    light.data.shape = "DISK"
    light.data.size = size
    point_at(light, target)


def main() -> int:
    args = arguments()
    source = Path(args.input).expanduser().resolve()
    output = Path(args.output).expanduser().resolve()
    if not source.is_file():
        raise FileNotFoundError(source)
    output.parent.mkdir(parents=True, exist_ok=True)

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(source))
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    if not meshes:
        raise RuntimeError("GLB contains no renderable meshes.")

    minimum = Vector((math.inf, math.inf, math.inf))
    maximum = Vector((-math.inf, -math.inf, -math.inf))
    for obj in meshes:
        for corner in obj.bound_box:
            world_corner = obj.matrix_world @ Vector(corner)
            minimum.x = min(minimum.x, world_corner.x)
            minimum.y = min(minimum.y, world_corner.y)
            minimum.z = min(minimum.z, world_corner.z)
            maximum.x = max(maximum.x, world_corner.x)
            maximum.y = max(maximum.y, world_corner.y)
            maximum.z = max(maximum.z, world_corner.z)

    center = (minimum + maximum) * 0.5
    dimensions = maximum - minimum
    scale = max(dimensions.x, dimensions.y, dimensions.z, 0.25)

    bpy.ops.mesh.primitive_plane_add(size=scale * 8.0, location=(center.x, center.y, minimum.z - 0.003))
    floor = bpy.context.object
    floor.name = "Preview Ground"
    floor_material = bpy.data.materials.new("Preview Ground")
    floor_material.use_nodes = True
    floor_shader = floor_material.node_tree.nodes.get("Principled BSDF")
    floor_shader.inputs["Base Color"].default_value = (0.055, 0.065, 0.075, 1.0)
    floor_shader.inputs["Roughness"].default_value = 0.86
    floor.data.materials.append(floor_material)

    bpy.ops.object.camera_add(
        location=(center.x + scale * 1.45, center.y - scale * 2.15, center.z + scale * 0.72)
    )
    camera = bpy.context.object
    camera.data.lens = 58
    camera.data.sensor_width = 36
    point_at(camera, center + Vector((0.0, 0.0, scale * 0.04)))
    bpy.context.scene.camera = camera

    add_area(
        "Key",
        (center.x - scale * 1.7, center.y - scale * 1.5, center.z + scale * 2.6),
        950.0,
        scale * 2.2,
        center,
    )
    add_area(
        "Fill",
        (center.x + scale * 2.0, center.y - scale * 0.4, center.z + scale * 0.7),
        520.0,
        scale * 1.8,
        center,
    )
    add_area(
        "Rim",
        (center.x - scale * 0.4, center.y + scale * 2.0, center.z + scale * 1.5),
        760.0,
        scale * 1.6,
        center,
    )

    world = bpy.data.worlds.new("Preview World")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.015, 0.021, 0.03, 1.0)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.32
    bpy.context.scene.world = world

    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.render.resolution_x = args.size
    scene.render.resolution_y = args.size
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = str(output)
    scene.render.film_transparent = False
    scene.render.image_settings.color_mode = "RGBA"
    scene.view_settings.look = "AgX - Medium High Contrast"
    bpy.ops.render.render(write_still=True)
    print(f"HUSHPOINT_PREVIEW_PASS: {output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
