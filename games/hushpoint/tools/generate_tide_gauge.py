"""Generate HUSHPOINT's original low-poly coastal tide gauge fallback asset."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector


ASSET_VERSION = "1.0.0"


def parse_args() -> argparse.Namespace:
    try:
        separator = sys.argv.index("--")
        values = sys.argv[separator + 1 :]
    except ValueError:
        values = []
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, help="Original generated GLB destination.")
    parser.add_argument("--report", required=True, help="Generation JSON report destination.")
    return parser.parse_args(values)


def material(
    name: str,
    color: tuple[float, float, float, float],
    metallic: float,
    roughness: float,
    emission: tuple[float, float, float, float] | None = None,
) -> bpy.types.Material:
    result = bpy.data.materials.new(name)
    result.use_nodes = True
    shader = result.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = color
    shader.inputs["Metallic"].default_value = metallic
    shader.inputs["Roughness"].default_value = roughness
    if emission is not None:
        emission_socket = shader.inputs.get("Emission Color") or shader.inputs.get("Emission")
        strength_socket = shader.inputs.get("Emission Strength")
        if emission_socket is not None:
            emission_socket.default_value = emission
        if strength_socket is not None:
            strength_socket.default_value = 1.7
    return result


def finish_object(obj: bpy.types.Object, name: str, mat: bpy.types.Material) -> bpy.types.Object:
    obj.name = name
    obj.data.name = f"{name}_Mesh"
    obj.data.materials.append(mat)
    obj["hushpoint_asset"] = "Port Mercy Coastal Tide Gauge"
    obj["hushpoint_source"] = "Original procedural Blender geometry"
    return obj


def add_box(
    name: str,
    location: tuple[float, float, float],
    scale: tuple[float, float, float],
    mat: bpy.types.Material,
    bevel: float = 0.0,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=location)
    obj = finish_object(bpy.context.object, name, mat)
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel > 0.0:
        modifier = obj.modifiers.new("Manufactured edge", "BEVEL")
        modifier.width = bevel
        modifier.segments = 1
    return obj


def add_cylinder(
    name: str,
    location: tuple[float, float, float],
    radius: float,
    depth: float,
    mat: bpy.types.Material,
    vertices: int = 12,
    rotation: tuple[float, float, float] = (0.0, 0.0, 0.0),
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=vertices,
        radius=radius,
        depth=depth,
        end_fill_type="NGON",
        location=location,
        rotation=rotation,
    )
    return finish_object(bpy.context.object, name, mat)


def add_torus(
    name: str,
    location: tuple[float, float, float],
    major_radius: float,
    minor_radius: float,
    mat: bpy.types.Material,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_torus_add(
        align="WORLD",
        major_segments=16,
        minor_segments=6,
        location=location,
        major_radius=major_radius,
        minor_radius=minor_radius,
    )
    return finish_object(bpy.context.object, name, mat)


def add_staff_markers(
    white: bpy.types.Material,
    black: bpy.types.Material,
    red: bpy.types.Material,
) -> None:
    add_box("TideStaff", (0.0, -0.185, 1.38), (0.20, 0.035, 1.22), white, 0.012)
    for index in range(11):
        height = 0.31 + index * 0.21
        marker_material = red if index in {0, 5, 10} else black
        marker_width = 0.18 if index % 5 == 0 else (0.13 if index % 2 == 0 else 0.09)
        add_box(
            f"StaffMarker_{index:02d}",
            (-0.195 + marker_width / 2.0, -0.225, height),
            (marker_width, 0.012, 0.017),
            marker_material,
        )


def add_solar_panel(frame: bpy.types.Material, cells: bpy.types.Material) -> None:
    panel_rotation = (math.radians(18), 0.0, 0.0)
    add_box("SolarFrame", (0.0, 0.02, 3.03), (0.82, 0.055, 0.46), frame, 0.015).rotation_euler = panel_rotation
    add_box("SolarCells", (0.0, -0.041, 3.03), (0.75, 0.018, 0.39), cells, 0.006).rotation_euler = panel_rotation
    for column in range(1, 4):
        x = -0.75 + column * 0.375
        add_box(f"SolarGridV_{column}", (x, -0.064, 3.03), (0.006, 0.006, 0.39), frame).rotation_euler = panel_rotation
    for row in range(1, 3):
        z = 2.64 + row * 0.26
        add_box(f"SolarGridH_{row}", (0.0, -0.064, z), (0.75, 0.006, 0.006), frame).rotation_euler = panel_rotation


def add_sensor_cage(
    metal: bpy.types.Material,
    yellow: bpy.types.Material,
    dark: bpy.types.Material,
) -> None:
    add_cylinder("SensorBody", (0.0, 0.0, 0.39), 0.14, 0.42, dark, 12)
    add_cylinder("SensorCap", (0.0, 0.0, 0.62), 0.19, 0.08, yellow, 12)
    for index in range(6):
        angle = math.tau * index / 6.0
        add_cylinder(
            f"CageBar_{index:02d}",
            (0.29 * math.cos(angle), 0.29 * math.sin(angle), 0.46),
            0.018,
            0.66,
            metal,
            8,
        )
    add_torus("CageRingLow", (0.0, 0.0, 0.17), 0.31, 0.025, metal)
    add_torus("CageRingHigh", (0.0, 0.0, 0.75), 0.31, 0.025, metal)


def add_antenna(metal: bpy.types.Material, red: bpy.types.Material) -> None:
    add_cylinder("Antenna", (0.58, 0.0, 3.28), 0.018, 0.86, metal, 8)
    add_cylinder("AntennaTip", (0.58, 0.0, 3.73), 0.035, 0.07, red, 8)
    for index, height in enumerate((3.12, 3.31, 3.50)):
        add_cylinder(
            f"AntennaRadial_{index:02d}",
            (0.58, 0.0, height),
            0.012,
            0.34,
            metal,
            8,
            rotation=(0.0, math.radians(90), 0.0),
        )


def generate() -> list[bpy.types.Object]:
    bpy.ops.wm.read_factory_settings(use_empty=True)

    galvanized = material("Galvanized_Metal", (0.22, 0.26, 0.27, 1), 0.72, 0.34)
    safety_yellow = material("Safety_Yellow", (0.72, 0.42, 0.035, 1), 0.45, 0.46)
    enamel_white = material("Gauge_White", (0.76, 0.78, 0.72, 1), 0.25, 0.56)
    marker_black = material("Gauge_Black", (0.018, 0.023, 0.025, 1), 0.2, 0.68)
    signal_red = material("Signal_Red", (0.48, 0.025, 0.018, 1), 0.2, 0.48)
    marine_blue = material("Marine_Civic_Blue", (0.025, 0.12, 0.19, 1), 0.48, 0.35)
    solar_cells = material("Solar_Cells", (0.008, 0.026, 0.055, 1), 0.62, 0.22)
    glass = material("Status_Lens", (0.025, 0.62, 0.39, 1), 0.2, 0.18, (0.02, 0.9, 0.42, 1))

    add_cylinder("MountingBase", (0.0, 0.0, 0.055), 0.48, 0.11, galvanized, 16)
    for index in range(8):
        angle = math.tau * index / 8.0
        add_cylinder(
            f"AnchorBolt_{index:02d}",
            (0.37 * math.cos(angle), 0.37 * math.sin(angle), 0.13),
            0.025,
            0.11,
            marker_black,
            8,
        )
    add_sensor_cage(galvanized, safety_yellow, marker_black)
    add_cylinder("MainMast", (0.0, 0.0, 1.78), 0.12, 2.45, safety_yellow, 12)
    add_cylinder("LowerCollar", (0.0, 0.0, 0.79), 0.18, 0.10, galvanized, 12)
    add_cylinder("UpperCollar", (0.0, 0.0, 2.69), 0.18, 0.10, galvanized, 12)

    add_box("TelemetryCabinet", (0.36, 0.0, 2.05), (0.46, 0.31, 0.58), marine_blue, 0.045)
    add_box("CabinetDoor", (0.36, -0.321, 2.05), (0.40, 0.018, 0.51), galvanized, 0.02)
    add_box("CabinetHandle", (0.64, -0.355, 2.02), (0.025, 0.025, 0.13), marker_black, 0.01)
    add_cylinder(
        "StatusLamp",
        (0.14, -0.36, 2.39),
        0.065,
        0.055,
        glass,
        12,
        rotation=(math.radians(90), 0.0, 0.0),
    )
    add_box("CivicPlate", (0.36, -0.348, 1.78), (0.28, 0.012, 0.08), safety_yellow, 0.008)

    add_staff_markers(enamel_white, marker_black, signal_red)
    add_solar_panel(galvanized, solar_cells)
    add_antenna(galvanized, signal_red)

    add_cylinder("CableConduit", (-0.31, 0.12, 1.18), 0.027, 1.42, galvanized, 8)
    add_box("JunctionBox", (-0.31, 0.12, 1.83), (0.15, 0.11, 0.19), galvanized, 0.025)
    return sorted((obj for obj in bpy.context.scene.objects if obj.type == "MESH"), key=lambda item: item.name)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def evaluated_metrics(objects: list[bpy.types.Object]) -> dict[str, object]:
    dependency_graph = bpy.context.evaluated_depsgraph_get()
    vertices = 0
    triangles = 0
    minimum = [math.inf, math.inf, math.inf]
    maximum = [-math.inf, -math.inf, -math.inf]
    for obj in objects:
        evaluated = obj.evaluated_get(dependency_graph)
        mesh = evaluated.to_mesh()
        try:
            mesh.calc_loop_triangles()
            vertices += len(mesh.vertices)
            triangles += len(mesh.loop_triangles)
            for vertex in mesh.vertices:
                world = obj.matrix_world @ Vector(vertex.co)
                for axis in range(3):
                    minimum[axis] = min(minimum[axis], world[axis])
                    maximum[axis] = max(maximum[axis], world[axis])
        finally:
            evaluated.to_mesh_clear()
    return {
        "dimensions_m": [round(maximum[i] - minimum[i], 6) for i in range(3)],
        "triangles": triangles,
        "vertices": vertices,
    }


def main() -> int:
    args = parse_args()
    output = Path(args.output).expanduser().resolve()
    report_path = Path(args.report).expanduser().resolve()
    if output.suffix.lower() != ".glb":
        raise ValueError("Output must use the .glb extension.")
    output.parent.mkdir(parents=True, exist_ok=True)
    report_path.parent.mkdir(parents=True, exist_ok=True)

    objects = generate()
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    result = bpy.ops.export_scene.gltf(
        filepath=str(output),
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
        raise RuntimeError(f"GLB export did not finish: {result}")

    metrics = evaluated_metrics(objects)
    report = {
        "asset": "Port Mercy Coastal Tide Gauge",
        "asset_version": ASSET_VERSION,
        "authoring": "Original procedural geometry generated by HUSHPOINT's Blender script",
        "blender_version": bpy.app.version_string,
        "dimensions_m": metrics["dimensions_m"],
        "license": "Project-original; no third-party source asset",
        "materials": sorted(material.name for material in bpy.data.materials),
        "mesh_objects": len(objects),
        "output_file": output.name,
        "output_sha256": sha256(output),
        "status": "pass",
        "triangles": metrics["triangles"],
        "vertices": metrics["vertices"],
    }
    report_path.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(f"HUSHPOINT_GENERATOR_PASS: {output}")
    print(f"HUSHPOINT_GENERATOR_REPORT: {report_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
