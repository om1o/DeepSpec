#!/usr/bin/env python3
"""Generate HUSHPOINT's deterministic low-poly harbor service truck.

Run through Blender so the checked-in script is the editable source of truth:

    blender --background --factory-startup --python tools/generate_service_truck.py -- \
        --output assets/models/hushpoint_service_truck.glb \
        --report assets/reports/hushpoint_service_truck_generation.json \
        --preview assets/reports/hushpoint_service_truck_preview.png \
        --reference assets/concepts/higgsfield_tide_gauge_z_image.png

The truck is original procedural geometry. The existing Higgsfield tide-gauge
concept is used only as an art-direction reference for the galvanized steel,
safety-yellow paint, amber beacon, and practical harbor-equipment language.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
from pathlib import Path
from typing import Any

import bpy
from mathutils import Vector


ASSET_VERSION = "1.0.0"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True)
    parser.add_argument("--report", required=True)
    parser.add_argument("--preview", required=True)
    parser.add_argument("--reference", required=True)
    return parser.parse_args(sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else [])


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def clean_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for datablocks in (bpy.data.meshes, bpy.data.curves, bpy.data.materials, bpy.data.cameras, bpy.data.lights):
        for datablock in list(datablocks):
            if datablock.users == 0:
                datablocks.remove(datablock)


def make_material(
    name: str,
    color: tuple[float, float, float, float],
    *,
    metallic: float,
    roughness: float,
    emission: tuple[float, float, float] | None = None,
    emission_strength: float = 0.0,
    transmission: float = 0.0,
) -> bpy.types.Material:
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    material.diffuse_color = color
    shader = material.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = color
    shader.inputs["Metallic"].default_value = metallic
    shader.inputs["Roughness"].default_value = roughness
    shader.inputs["Alpha"].default_value = color[3]
    transmission_input = shader.inputs.get("Transmission Weight") or shader.inputs.get("Transmission")
    if transmission_input is not None:
        transmission_input.default_value = transmission
    if emission is not None:
        emission_input = shader.inputs.get("Emission Color") or shader.inputs.get("Emission")
        if emission_input is not None:
            emission_input.default_value = (*emission, 1.0)
        strength_input = shader.inputs.get("Emission Strength")
        if strength_input is not None:
            strength_input.default_value = emission_strength
    if color[3] < 1.0:
        try:
            material.surface_render_method = "DITHERED"
        except (AttributeError, TypeError):
            pass
        material.use_transparency_overlap = False
    return material


def assign_material(obj: bpy.types.Object, material: bpy.types.Material) -> None:
    obj.data.materials.append(material)


def add_bevel(obj: bpy.types.Object, width: float, segments: int = 2) -> None:
    if width <= 0.0:
        return
    modifier = obj.modifiers.new(name="EdgeSoftening", type="BEVEL")
    modifier.width = width
    modifier.segments = segments
    modifier.limit_method = "ANGLE"


def add_box(
    parent: bpy.types.Object,
    name: str,
    location: tuple[float, float, float],
    dimensions: tuple[float, float, float],
    material: bpy.types.Material,
    *,
    rotation: tuple[float, float, float] = (0.0, 0.0, 0.0),
    bevel: float = 0.025,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cube_add(location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = dimensions
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    assign_material(obj, material)
    add_bevel(obj, bevel)
    obj.parent = parent
    return obj


def add_cylinder(
    parent: bpy.types.Object,
    name: str,
    location: tuple[float, float, float],
    radius: float,
    depth: float,
    material: bpy.types.Material,
    *,
    rotation: tuple[float, float, float] = (0.0, 0.0, 0.0),
    vertices: int = 12,
    bevel: float = 0.012,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=vertices,
        radius=radius,
        depth=depth,
        location=location,
        rotation=rotation,
    )
    obj = bpy.context.object
    obj.name = name
    assign_material(obj, material)
    add_bevel(obj, bevel, 1)
    obj.parent = parent
    return obj


def add_torus(
    parent: bpy.types.Object,
    name: str,
    location: tuple[float, float, float],
    outer_radius: float,
    tube_radius: float,
    material: bpy.types.Material,
    *,
    rotation: tuple[float, float, float] = (0.0, 0.0, 0.0),
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_torus_add(
        align="WORLD",
        major_segments=16,
        minor_segments=6,
        location=location,
        rotation=rotation,
        major_radius=outer_radius - tube_radius,
        minor_radius=tube_radius,
    )
    obj = bpy.context.object
    obj.name = name
    assign_material(obj, material)
    obj.parent = parent
    return obj


def add_wedge(
    parent: bpy.types.Object,
    name: str,
    *,
    half_width: float,
    rear_y: float,
    front_y: float,
    bottom_z: float,
    rear_top_z: float,
    front_top_z: float,
    material: bpy.types.Material,
    bevel: float = 0.025,
) -> bpy.types.Object:
    vertices = [
        (-half_width, rear_y, bottom_z),
        (half_width, rear_y, bottom_z),
        (half_width, front_y, bottom_z),
        (-half_width, front_y, bottom_z),
        (-half_width, rear_y, rear_top_z),
        (half_width, rear_y, rear_top_z),
        (half_width, front_y, front_top_z),
        (-half_width, front_y, front_top_z),
    ]
    faces = [
        (0, 3, 2, 1),
        (4, 5, 6, 7),
        (0, 1, 5, 4),
        (3, 7, 6, 2),
        (0, 4, 7, 3),
        (1, 2, 6, 5),
    ]
    mesh = bpy.data.meshes.new(f"{name}_Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.validate()
    mesh.update(calc_edges=True)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    assign_material(obj, material)
    add_bevel(obj, bevel)
    obj.parent = parent
    return obj


def add_wheel(
    parent: bpy.types.Object,
    prefix: str,
    x: float,
    y: float,
    materials: dict[str, bpy.types.Material],
) -> None:
    rotation = (0.0, math.radians(90.0), 0.0)
    add_torus(parent, f"{prefix}_Tire", (x, y, 0.48), 0.45, 0.14, materials["rubber"], rotation=rotation)
    add_cylinder(
        parent,
        f"{prefix}_Rim",
        (x, y, 0.48),
        0.245,
        0.29,
        materials["galvanized"],
        rotation=rotation,
        vertices=12,
        bevel=0.01,
    )
    add_cylinder(
        parent,
        f"{prefix}_Hub",
        (x, y, 0.48),
        0.105,
        0.31,
        materials["dark_metal"],
        rotation=rotation,
        vertices=12,
        bevel=0.008,
    )
    for angle_index in range(6):
        angle = angle_index * math.tau / 6.0
        add_cylinder(
            parent,
            f"{prefix}_Lug_{angle_index + 1:02d}",
            (x + (0.158 if x > 0 else -0.158), y + math.sin(angle) * 0.066, 0.48 + math.cos(angle) * 0.066),
            0.012,
            0.014,
            materials["dark_metal"],
            rotation=rotation,
            vertices=8,
            bevel=0.0,
        )


def add_door_hardware(
    parent: bpy.types.Object,
    side: float,
    materials: dict[str, bpy.types.Material],
) -> None:
    side_name = "L" if side < 0 else "R"
    add_box(
        parent,
        f"CabDoor_{side_name}",
        (side * 1.015, 0.44, 1.20),
        (0.045, 1.06, 0.88),
        materials["paint"],
        bevel=0.015,
    )
    add_box(
        parent,
        f"CabWindow_{side_name}",
        (side * 1.027, 0.47, 1.78),
        (0.036, 0.76, 0.46),
        materials["glass"],
        bevel=0.012,
    )
    add_box(
        parent,
        f"DoorHandle_{side_name}",
        (side * 1.055, 0.14, 1.38),
        (0.032, 0.19, 0.045),
        materials["dark_metal"],
        bevel=0.009,
    )
    add_box(
        parent,
        f"DoorBadgeTop_{side_name}",
        (side * 1.054, 0.64, 1.25),
        (0.035, 0.34, 0.055),
        materials["galvanized"],
        bevel=0.004,
    )
    add_box(
        parent,
        f"DoorBadgeBottom_{side_name}",
        (side * 1.054, 0.64, 1.15),
        (0.035, 0.23, 0.035),
        materials["dark_metal"],
        bevel=0.004,
    )
    add_box(
        parent,
        f"MirrorArm_{side_name}",
        (side * 1.14, 0.91, 1.83),
        (0.20, 0.035, 0.035),
        materials["dark_metal"],
        bevel=0.006,
    )
    add_box(
        parent,
        f"Mirror_{side_name}",
        (side * 1.26, 0.91, 1.83),
        (0.10, 0.17, 0.25),
        materials["dark_metal"],
        bevel=0.035,
    )


def add_service_cabinet(
    parent: bpy.types.Object,
    side: float,
    materials: dict[str, bpy.types.Material],
) -> None:
    side_name = "L" if side < 0 else "R"
    add_box(
        parent,
        f"ServiceCabinet_{side_name}",
        (side * 0.78, -1.16, 1.24),
        (0.55, 1.78, 0.86),
        materials["galvanized"],
        bevel=0.045,
    )
    for door_index, door_y in enumerate((-1.60, -0.72), start=1):
        add_box(
            parent,
            f"CabinetDoor_{side_name}_{door_index}",
            (side * 1.066, door_y, 1.25),
            (0.028, 0.74, 0.66),
            materials["steel_panel"],
            bevel=0.02,
        )
        add_box(
            parent,
            f"CabinetLatch_{side_name}_{door_index}",
            (side * 1.086, door_y + 0.23, 1.25),
            (0.025, 0.07, 0.15),
            materials["dark_metal"],
            bevel=0.008,
        )
        for bolt_z in (1.01, 1.49):
            add_cylinder(
                parent,
                f"CabinetBolt_{side_name}_{door_index}_{bolt_z}",
                (side * 1.087, door_y - 0.26, bolt_z),
                0.018,
                0.025,
                materials["dark_metal"],
                rotation=(0.0, math.radians(90.0), 0.0),
                vertices=8,
                bevel=0.0,
            )


def build_truck() -> tuple[bpy.types.Object, list[bpy.types.Object], dict[str, bpy.types.Material]]:
    materials = {
        "paint": make_material("PBR_SafetyYellowPaint", (0.57, 0.45, 0.10, 1.0), metallic=0.18, roughness=0.42),
        "galvanized": make_material("PBR_GalvanizedSteel", (0.34, 0.39, 0.40, 1.0), metallic=0.74, roughness=0.46),
        "steel_panel": make_material("PBR_BrushedSteelPanel", (0.24, 0.29, 0.30, 1.0), metallic=0.78, roughness=0.37),
        "dark_metal": make_material("PBR_DarkPowdercoat", (0.035, 0.050, 0.054, 1.0), metallic=0.69, roughness=0.33),
        "rubber": make_material("PBR_TireRubber", (0.012, 0.016, 0.017, 1.0), metallic=0.0, roughness=0.94),
        "glass": make_material("PBR_SmokedSafetyGlass", (0.065, 0.15, 0.17, 0.62), metallic=0.10, roughness=0.12, transmission=0.34),
        "headlamp": make_material(
            "PBR_HeadlampLens",
            (0.72, 0.85, 0.78, 1.0),
            metallic=0.12,
            roughness=0.20,
            emission=(0.86, 0.92, 0.75),
            emission_strength=2.2,
        ),
        "amber": make_material(
            "PBR_AmberSignalLens",
            (0.86, 0.31, 0.035, 0.92),
            metallic=0.08,
            roughness=0.18,
            emission=(1.0, 0.24, 0.015),
            emission_strength=1.4,
        ),
        "red": make_material(
            "PBR_RedSignalLens",
            (0.62, 0.025, 0.018, 1.0),
            metallic=0.06,
            roughness=0.22,
            emission=(0.8, 0.015, 0.01),
            emission_strength=1.15,
        ),
        "white": make_material("PBR_ReflectiveWhite", (0.74, 0.73, 0.64, 1.0), metallic=0.15, roughness=0.44),
    }

    root = bpy.data.objects.new("HUSHPOINT_ServiceTruck", None)
    root["asset_version"] = ASSET_VERSION
    root["source"] = "deterministic Blender-authored geometry"
    root["art_direction_reference"] = "Higgsfield tide-gauge concept; no geometry or texture copied"
    bpy.context.collection.objects.link(root)

    # Chassis and shaped cab establish a believable vehicle silhouette.
    add_box(root, "ChassisFrame", (0.0, -0.05, 0.58), (1.72, 4.18, 0.20), materials["dark_metal"], bevel=0.035)
    add_box(root, "LowerBody", (0.0, 0.10, 0.88), (2.04, 3.95, 0.56), materials["paint"], bevel=0.10)
    add_wedge(
        root,
        "SlopedHood",
        half_width=0.94,
        rear_y=0.92,
        front_y=2.18,
        bottom_z=0.96,
        rear_top_z=1.35,
        front_top_z=1.20,
        material=materials["paint"],
        bevel=0.045,
    )
    add_box(root, "CabShell", (0.0, 0.43, 1.48), (1.94, 1.23, 1.30), materials["paint"], bevel=0.10)
    add_box(root, "CabRoof", (0.0, 0.35, 2.18), (2.10, 1.50, 0.16), materials["white"], bevel=0.07)
    add_box(
        root,
        "Windshield",
        (0.0, 1.075, 1.75),
        (1.68, 0.045, 0.60),
        materials["glass"],
        rotation=(math.radians(12.0), 0.0, 0.0),
        bevel=0.018,
    )
    add_box(root, "RearCabWindow", (0.0, -0.205, 1.76), (1.42, 0.045, 0.45), materials["glass"], bevel=0.018)
    add_box(root, "FrontBumper", (0.0, 2.28, 0.69), (2.18, 0.22, 0.25), materials["galvanized"], bevel=0.055)
    add_box(root, "FrontGrille", (0.0, 2.225, 0.98), (1.05, 0.045, 0.34), materials["dark_metal"], bevel=0.015)
    for grille_index in range(5):
        add_box(
            root,
            f"GrilleBar_{grille_index + 1}",
            (-0.40 + grille_index * 0.20, 2.255, 0.98),
            (0.035, 0.030, 0.28),
            materials["galvanized"],
            bevel=0.004,
        )
    for side in (-1.0, 1.0):
        side_name = "L" if side < 0 else "R"
        add_box(root, f"Headlamp_{side_name}", (side * 0.68, 2.255, 1.04), (0.34, 0.055, 0.20), materials["headlamp"], bevel=0.045)
        add_box(root, f"TurnSignal_{side_name}", (side * 0.91, 2.252, 1.02), (0.11, 0.060, 0.17), materials["amber"], bevel=0.025)
        add_door_hardware(root, side, materials)

    # Detailed modular service body carries the same industrial language as TG-04.
    add_box(root, "ServiceBedDeck", (0.0, -1.18, 0.92), (1.92, 1.98, 0.22), materials["dark_metal"], bevel=0.045)
    add_service_cabinet(root, -1.0, materials)
    add_service_cabinet(root, 1.0, materials)
    add_box(root, "RearToolChest", (0.0, -1.87, 1.43), (1.34, 0.42, 0.60), materials["paint"], bevel=0.055)
    add_box(root, "ToolChestLid", (0.0, -1.86, 1.77), (1.42, 0.48, 0.10), materials["galvanized"], bevel=0.035)
    add_box(root, "RearStepBumper", (0.0, -2.22, 0.68), (2.16, 0.28, 0.24), materials["galvanized"], bevel=0.055)
    add_box(root, "RearSafetyPanel", (0.0, -2.375, 0.96), (1.68, 0.035, 0.31), materials["dark_metal"], bevel=0.008)
    for stripe_index in range(7):
        stripe_x = -0.69 + stripe_index * 0.23
        stripe_material = materials["paint"] if stripe_index % 2 == 0 else materials["white"]
        add_box(
            root,
            f"RearChevron_{stripe_index + 1}",
            (stripe_x, -2.397, 0.96),
            (0.16, 0.018, 0.23),
            stripe_material,
            rotation=(0.0, math.radians(-20.0 if stripe_index % 2 == 0 else 20.0), 0.0),
            bevel=0.006,
        )
    for side in (-1.0, 1.0):
        side_name = "L" if side < 0 else "R"
        add_box(root, f"TailLamp_{side_name}", (side * 0.78, -2.405, 1.17), (0.24, 0.04, 0.18), materials["red"], bevel=0.035)

    # Galvanized ladder rack, beacon, antenna, and tie-downs sell a working field vehicle.
    for x in (-0.89, 0.89):
        for y in (-1.82, -0.42):
            add_box(root, f"RackPost_{x}_{y}", (x, y, 1.93), (0.07, 0.07, 1.08), materials["galvanized"], bevel=0.012)
        add_box(root, f"RackRail_{x}", (x, -1.12, 2.42), (0.07, 1.62, 0.07), materials["galvanized"], bevel=0.012)
    for y in (-1.82, -1.12, -0.42):
        add_box(root, f"RackCrossbar_{y}", (0.0, y, 2.42), (1.94, 0.07, 0.07), materials["galvanized"], bevel=0.012)
    add_cylinder(root, "AmberBeaconBase", (-0.58, 0.36, 2.34), 0.16, 0.08, materials["dark_metal"], vertices=16, bevel=0.012)
    add_cylinder(root, "AmberBeaconLens", (-0.58, 0.36, 2.46), 0.13, 0.20, materials["amber"], vertices=16, bevel=0.025)
    add_cylinder(root, "RadioAntennaBase", (0.63, 0.30, 2.31), 0.055, 0.10, materials["dark_metal"], vertices=10, bevel=0.006)
    add_cylinder(root, "RadioAntenna", (0.63, 0.30, 2.75), 0.012, 0.82, materials["dark_metal"], vertices=8, bevel=0.0)
    for side in (-1.0, 1.0):
        side_name = "L" if side < 0 else "R"
        add_box(root, f"RunningBoard_{side_name}", (side * 1.08, 0.18, 0.62), (0.22, 1.52, 0.10), materials["galvanized"], bevel=0.025)
        add_box(root, f"FrontMudguard_{side_name}", (side * 1.03, 1.39, 0.80), (0.16, 0.78, 0.19), materials["paint"], bevel=0.055)
        add_box(root, f"RearMudguard_{side_name}", (side * 1.03, -1.35, 0.80), (0.16, 0.78, 0.19), materials["galvanized"], bevel=0.055)

    for prefix, x, y in (
        ("FrontLeft", -1.05, 1.40),
        ("FrontRight", 1.05, 1.40),
        ("RearLeft", -1.05, -1.35),
        ("RearRight", 1.05, -1.35),
    ):
        add_wheel(root, prefix, x, y, materials)

    # Small practical underbody details are visible from the low third-person camera.
    add_cylinder(
        root,
        "RearAxle",
        (0.0, -1.35, 0.48),
        0.065,
        2.02,
        materials["dark_metal"],
        rotation=(0.0, math.radians(90.0), 0.0),
        vertices=10,
        bevel=0.005,
    )
    add_cylinder(
        root,
        "FrontAxle",
        (0.0, 1.40, 0.48),
        0.065,
        2.02,
        materials["dark_metal"],
        rotation=(0.0, math.radians(90.0), 0.0),
        vertices=10,
        bevel=0.005,
    )
    add_box(root, "TowReceiver", (0.0, -2.40, 0.48), (0.22, 0.36, 0.16), materials["dark_metal"], bevel=0.02)
    add_cylinder(root, "TowBall", (0.0, -2.62, 0.52), 0.075, 0.16, materials["galvanized"], vertices=12, bevel=0.018)

    meshes = sorted((obj for obj in root.children if obj.type == "MESH"), key=lambda obj: obj.name)
    return root, meshes, materials


def bake_runtime_meshes(
    root: bpy.types.Object,
    authored_meshes: list[bpy.types.Object],
) -> list[bpy.types.Object]:
    """Apply edge work and group components by material for low draw-call cost."""
    for obj in authored_meshes:
        bpy.ops.object.select_all(action="DESELECT")
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        for modifier in list(obj.modifiers):
            bpy.ops.object.modifier_apply(modifier=modifier.name)

    material_groups: dict[str, list[bpy.types.Object]] = {}
    for obj in authored_meshes:
        material_name = obj.data.materials[0].name if obj.data.materials else "Unassigned"
        material_groups.setdefault(material_name, []).append(obj)

    runtime_meshes: list[bpy.types.Object] = []
    for material_name in sorted(material_groups):
        group = material_groups[material_name]
        bpy.ops.object.select_all(action="DESELECT")
        for obj in group:
            obj.select_set(True)
        bpy.context.view_layer.objects.active = group[0]
        bpy.ops.object.join()
        joined = bpy.context.object
        joined.name = f"ServiceTruck_{material_name.removeprefix('PBR_')}"
        joined.data.name = f"{joined.name}_Mesh"
        joined.parent = root
        runtime_meshes.append(joined)
    return sorted(runtime_meshes, key=lambda obj: obj.name)


def evaluated_triangle_count(obj: bpy.types.Object) -> int:
    depsgraph = bpy.context.evaluated_depsgraph_get()
    evaluated = obj.evaluated_get(depsgraph)
    mesh = evaluated.to_mesh()
    try:
        mesh.calc_loop_triangles()
        return len(mesh.loop_triangles)
    finally:
        evaluated.to_mesh_clear()


def asset_metrics(meshes: list[bpy.types.Object]) -> dict[str, Any]:
    min_corner = Vector((math.inf, math.inf, math.inf))
    max_corner = Vector((-math.inf, -math.inf, -math.inf))
    vertices = 0
    triangles = 0
    for obj in meshes:
        vertices += len(obj.data.vertices)
        triangles += evaluated_triangle_count(obj)
        for corner in obj.bound_box:
            world_corner = obj.matrix_world @ Vector(corner)
            min_corner.x = min(min_corner.x, world_corner.x)
            min_corner.y = min(min_corner.y, world_corner.y)
            min_corner.z = min(min_corner.z, world_corner.z)
            max_corner.x = max(max_corner.x, world_corner.x)
            max_corner.y = max(max_corner.y, world_corner.y)
            max_corner.z = max(max_corner.z, world_corner.z)
    dimensions = max_corner - min_corner
    return {
        "mesh_objects": len(meshes),
        "vertices": vertices,
        "triangles_evaluated": triangles,
        "bounds_min_m": [round(value, 4) for value in min_corner],
        "bounds_max_m": [round(value, 4) for value in max_corner],
        "dimensions_m": [round(value, 4) for value in dimensions],
    }


def export_glb(output_path: Path, root: bpy.types.Object) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    root.select_set(True)
    for child in root.children_recursive:
        child.select_set(True)
    bpy.context.view_layer.objects.active = root
    result = bpy.ops.export_scene.gltf(
        filepath=str(output_path),
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_normals=True,
        export_materials="EXPORT",
        export_cameras=False,
        export_lights=False,
        export_animations=False,
        export_extras=True,
    )
    if "FINISHED" not in result:
        raise RuntimeError(f"GLB export failed: {result}")


def look_at(obj: bpy.types.Object, target: tuple[float, float, float]) -> None:
    direction = Vector(target) - obj.location
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def render_preview(preview_path: Path, materials: dict[str, bpy.types.Material]) -> None:
    add_box(
        bpy.data.objects.new("PreviewRoot", None),
        "PreviewGround",
        (0.0, 0.0, -0.08),
        (14.0, 14.0, 0.12),
        materials["dark_metal"],
        bevel=0.0,
    )
    preview_root = bpy.data.objects.get("PreviewRoot")
    if preview_root is not None and preview_root.name not in bpy.context.collection.objects:
        bpy.context.collection.objects.link(preview_root)

    bpy.ops.object.light_add(type="AREA", location=(4.5, 4.5, 7.0))
    key = bpy.context.object
    key.name = "PreviewKey"
    key.data.energy = 1050.0
    key.data.shape = "DISK"
    key.data.size = 5.5
    key.data.color = (1.0, 0.78, 0.55)
    look_at(key, (0.0, 0.0, 1.0))

    bpy.ops.object.light_add(type="AREA", location=(-4.5, 1.0, 3.5))
    fill = bpy.context.object
    fill.name = "PreviewFill"
    fill.data.energy = 760.0
    fill.data.size = 4.0
    fill.data.color = (0.46, 0.65, 0.72)
    look_at(fill, (0.0, 0.0, 1.0))

    bpy.ops.object.light_add(type="AREA", location=(0.0, -5.0, 4.0))
    rim = bpy.context.object
    rim.name = "PreviewRim"
    rim.data.energy = 900.0
    rim.data.size = 3.0
    rim.data.color = (0.66, 0.82, 1.0)
    look_at(rim, (0.0, -0.5, 1.2))

    bpy.ops.object.camera_add(location=(6.6, 7.4, 4.4))
    camera = bpy.context.object
    camera.name = "PreviewCamera"
    camera.data.lens = 56.0
    look_at(camera, (0.0, -0.15, 1.15))
    bpy.context.scene.camera = camera

    world = bpy.context.scene.world or bpy.data.worlds.new("PreviewWorld")
    bpy.context.scene.world = world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.055, 0.070, 0.075, 1.0)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.34

    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.render.resolution_x = 960
    scene.render.resolution_y = 720
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    scene.render.filepath = str(preview_path)
    scene.render.image_settings.color_mode = "RGBA"
    scene.view_settings.look = "AgX - Medium High Contrast"
    bpy.ops.render.render(write_still=True)


def validate_reimport(output_path: Path) -> dict[str, Any]:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    imported = bpy.ops.import_scene.gltf(filepath=str(output_path))
    if "FINISHED" not in imported:
        raise RuntimeError(f"GLB re-import failed: {imported}")
    meshes = sorted((obj for obj in bpy.context.scene.objects if obj.type == "MESH"), key=lambda obj: obj.name)
    if not meshes:
        raise RuntimeError("Exported GLB re-imported without mesh geometry.")
    metrics = asset_metrics(meshes)
    if metrics["triangles_evaluated"] <= 0:
        raise RuntimeError("Exported GLB has no triangles.")
    return {"status": "pass", **metrics}


def main() -> int:
    args = parse_args()
    output_path = Path(args.output).expanduser().resolve()
    report_path = Path(args.report).expanduser().resolve()
    preview_path = Path(args.preview).expanduser().resolve()
    reference_path = Path(args.reference).expanduser().resolve()
    script_path = Path(__file__).resolve()
    if not reference_path.is_file():
        raise FileNotFoundError(f"Art-direction reference does not exist: {reference_path}")
    for path in (output_path, report_path, preview_path):
        path.parent.mkdir(parents=True, exist_ok=True)

    clean_scene()
    root, authored_meshes, materials = build_truck()
    authored_component_count = len(authored_meshes)
    runtime_meshes = bake_runtime_meshes(root, authored_meshes)
    metrics = asset_metrics(runtime_meshes)
    if metrics["triangles_evaluated"] > 20000:
        raise RuntimeError(f"Truck exceeded the 20,000-triangle budget: {metrics['triangles_evaluated']}")
    export_glb(output_path, root)
    render_preview(preview_path, materials)
    reimport = validate_reimport(output_path)

    report = {
        "asset": "HUSHPOINT Harbor Service Truck",
        "asset_version": ASSET_VERSION,
        "status": "pass",
        "blender_version": bpy.app.version_string,
        "source_type": "deterministic_blender_python",
        "source_script": script_path.name,
        "source_script_sha256": sha256(script_path),
        "art_direction_reference": reference_path.name,
        "art_direction_reference_sha256": sha256(reference_path),
        "reference_use": "Visual language only: galvanized steel, muted safety yellow, amber beacon, exposed practical hardware.",
        "third_party_geometry_or_textures": False,
        "external_generation_spend": False,
        "authored_component_count": authored_component_count,
        "runtime_mesh_strategy": "Applied modifiers, then joined by PBR material to limit draw calls.",
        "output_file": output_path.name,
        "output_sha256": sha256(output_path),
        "preview_file": preview_path.name,
        "preview_sha256": sha256(preview_path),
        "materials": sorted(material.name for material in materials.values()),
        "generation_metrics": metrics,
        "reimport_validation": reimport,
    }
    report_path.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(f"HUSHPOINT_SERVICE_TRUCK_PASS: {output_path}")
    print(f"HUSHPOINT_SERVICE_TRUCK_REPORT: {report_path}")
    print(f"HUSHPOINT_SERVICE_TRUCK_PREVIEW: {preview_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
