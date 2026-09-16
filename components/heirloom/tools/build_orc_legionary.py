"""Build the first heritage low-poly Ashen Legionary in Blender 4.5 LTS."""

from __future__ import annotations

import math
import random
import struct
import zlib
from pathlib import Path

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[1]
ASSET_DIR = ROOT / "characters" / "orc_legionary" / "heritage"
ARTIFACT_DIR = ROOT / "artifacts"
ATLAS_PATH = ASSET_DIR / "orc_legionary_atlas.png"
BLEND_PATH = ASSET_DIR / "source" / "orc_legionary.blend"
GLB_PATH = ASSET_DIR / "orc_legionary.glb"
PREVIEW_PATH = ARTIFACT_DIR / "orc_legionary_blender_proof.png"

ATLAS_SIZE = 512
GRID = 4
CELL_SIZE = ATLAS_SIZE // GRID

SWATCHES = {
    "skin": (0, (0.54, 0.56, 0.46)),
    "skin_shadow": (1, (0.38, 0.40, 0.32)),
    "iron": (2, (0.18, 0.19, 0.20)),
    "iron_edge": (3, (0.36, 0.37, 0.38)),
    "oxblood": (4, (0.43, 0.085, 0.105)),
    "oxblood_dark": (5, (0.22, 0.04, 0.05)),
    "leather": (6, (0.28, 0.17, 0.10)),
    "leather_light": (7, (0.44, 0.29, 0.18)),
    "brass": (8, (0.68, 0.46, 0.15)),
    "wool": (9, (0.16, 0.16, 0.145)),
    "hair": (10, (0.045, 0.05, 0.047)),
    "eye": (11, (0.93, 0.43, 0.055)),
    "mouth": (12, (0.08, 0.025, 0.022)),
    "tooth": (13, (0.72, 0.66, 0.48)),
}

parts: list[bpy.types.Object] = []
materials: dict[str, bpy.types.Material] = {}


def reset_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for datablocks in (bpy.data.meshes, bpy.data.curves, bpy.data.armatures, bpy.data.materials, bpy.data.cameras, bpy.data.lights):
        for datablock in list(datablocks):
            if datablock.users == 0:
                datablocks.remove(datablock)


def create_atlas() -> bpy.types.Image:
    ASSET_DIR.mkdir(parents=True, exist_ok=True)
    pixels = bytearray(ATLAS_SIZE * ATLAS_SIZE * 4)
    rng = random.Random(7301989)
    noise = [rng.uniform(-1.0, 1.0) for _ in range(ATLAS_SIZE * ATLAS_SIZE)]
    by_index = {value[0]: (name, value[1]) for name, value in SWATCHES.items()}

    for y in range(ATLAS_SIZE):
        for x in range(ATLAS_SIZE):
            cell_x = x // CELL_SIZE
            cell_y = y // CELL_SIZE
            cell_index = cell_y * GRID + cell_x
            name, base = by_index.get(cell_index, ("unused", (0.15, 0.15, 0.15)))
            local_x = x % CELL_SIZE
            local_y = y % CELL_SIZE
            broad = math.sin(local_x * 0.105 + local_y * 0.037) * 0.025
            grain = noise[y * ATLAS_SIZE + x] * 0.018
            variation = broad + grain
            if name.startswith("skin"):
                variation += math.sin(local_x * 0.19) * math.sin(local_y * 0.13) * 0.035
            elif name.startswith("iron"):
                variation += (0.045 if (local_x * 3 + local_y * 5) % 71 == 0 else 0.0)
            elif name.startswith("oxblood") or name == "wool":
                variation += math.sin(local_y * 0.52) * 0.012
            elif name.startswith("leather"):
                variation += math.sin((local_x + local_y) * 0.22) * 0.022
            elif name == "brass":
                variation += math.sin(local_x * 0.15) * 0.035
            edge = min(local_x, local_y, CELL_SIZE - 1 - local_x, CELL_SIZE - 1 - local_y)
            if edge < 4:
                variation -= (4 - edge) * 0.018
            offset = (y * ATLAS_SIZE + x) * 4
            pixels[offset] = round(max(0.0, min(1.0, base[0] + variation)) * 255)
            pixels[offset + 1] = round(max(0.0, min(1.0, base[1] + variation)) * 255)
            pixels[offset + 2] = round(max(0.0, min(1.0, base[2] + variation)) * 255)
            pixels[offset + 3] = 255

    assert max(pixels[0:3]) > 25, "atlas RGB buffer is blank"

    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    # PNG rows are top-down; the generated swatch coordinates are UV-style bottom-up.
    stride = ATLAS_SIZE * 4
    raw = b"".join(b"\x00" + pixels[y * stride : (y + 1) * stride] for y in reversed(range(ATLAS_SIZE)))
    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", ATLAS_SIZE, ATLAS_SIZE, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(raw, 9))
    png += chunk(b"IEND", b"")
    ATLAS_PATH.write_bytes(png)

    image = bpy.data.images.load(str(ATLAS_PATH), check_existing=False)
    image.name = "OrcLegionaryAtlas"
    image.colorspace_settings.name = "sRGB"
    return image


def make_material(name: str, image: bpy.types.Image, metallic: float, roughness: float, emission: float = 0.0) -> bpy.types.Material:
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    bsdf = nodes.get("Principled BSDF")
    texture = nodes.new("ShaderNodeTexImage")
    texture.image = image
    texture.interpolation = "Closest"
    links.new(texture.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    if emission > 0.0:
        if "Emission Color" in bsdf.inputs:
            links.new(texture.outputs["Color"], bsdf.inputs["Emission Color"])
            bsdf.inputs["Emission Strength"].default_value = emission
        elif "Emission" in bsdf.inputs:
            links.new(texture.outputs["Color"], bsdf.inputs["Emission"])
    return material


def create_materials(image: bpy.types.Image) -> None:
    specs = {
        "skin": (0.0, 0.88, 0.0),
        "skin_shadow": (0.0, 0.94, 0.0),
        "iron": (0.42, 0.58, 0.0),
        "iron_edge": (0.55, 0.46, 0.0),
        "oxblood": (0.0, 0.91, 0.0),
        "oxblood_dark": (0.0, 0.96, 0.0),
        "leather": (0.0, 0.86, 0.0),
        "leather_light": (0.0, 0.82, 0.0),
        "brass": (0.60, 0.42, 0.0),
        "wool": (0.0, 1.0, 0.0),
        "hair": (0.0, 0.96, 0.0),
        "eye": (0.05, 0.28, 2.0),
        "mouth": (0.0, 1.0, 0.0),
        "tooth": (0.0, 0.78, 0.0),
    }
    for name, (metallic, roughness, emission) in specs.items():
        materials[name] = make_material(name.title().replace("_", ""), image, metallic, roughness, emission)


def remap_uv_to_cell(obj: bpy.types.Object, swatch: str) -> None:
    mesh = obj.data
    uv_layer = mesh.uv_layers.active or mesh.uv_layers.new(name="UVMap")
    coords = [vertex.co for vertex in mesh.vertices]
    mins = [min(co[index] for co in coords) for index in range(3)]
    maxs = [max(co[index] for co in coords) for index in range(3)]
    extents = [maxs[index] - mins[index] for index in range(3)]
    axes = sorted(range(3), key=lambda index: extents[index], reverse=True)[:2]
    cell = SWATCHES[swatch][0]
    cell_x = cell % GRID
    cell_y = cell // GRID
    margin = 0.08
    usable = 1.0 - margin * 2.0
    for loop in mesh.loops:
        co = mesh.vertices[loop.vertex_index].co
        normalized = []
        for axis in axes:
            extent = extents[axis] or 1.0
            normalized.append((co[axis] - mins[axis]) / extent)
        u = (cell_x + margin + normalized[0] * usable) / GRID
        v = (cell_y + margin + normalized[1] * usable) / GRID
        uv_layer.data[loop.index].uv = (u, v)


def finish_part(obj: bpy.types.Object, bone: str, swatch: str, material_name: str | None = None) -> bpy.types.Object:
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    for polygon in obj.data.polygons:
        polygon.use_smooth = False
    obj.data.materials.append(materials[material_name or swatch])
    remap_uv_to_cell(obj, swatch)
    group = obj.vertex_groups.new(name=bone)
    group.add(range(len(obj.data.vertices)), 1.0, "REPLACE")
    parts.append(obj)
    return obj


def add_cube(name: str, dimensions: tuple[float, float, float], location: tuple[float, float, float], bone: str, swatch: str, rotation=(0.0, 0.0, 0.0)) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = dimensions
    return finish_part(obj, bone, swatch)


def add_cone(name: str, radius_bottom: float, radius_top: float, depth: float, location: tuple[float, float, float], bone: str, swatch: str, vertices=8, rotation=(0.0, 0.0, 0.0), scale=(1.0, 1.0, 1.0)) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cone_add(vertices=vertices, radius1=radius_bottom, radius2=radius_top, depth=depth, end_fill_type="NGON", location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    return finish_part(obj, bone, swatch)


def add_ico(name: str, radius: float, location: tuple[float, float, float], bone: str, swatch: str, scale=(1.0, 1.0, 1.0), subdivisions=1) -> bpy.types.Object:
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=subdivisions, radius=radius, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    return finish_part(obj, bone, swatch)


def add_prism(name: str, points: list[tuple[float, float]], depth: float, location: tuple[float, float, float], bone: str, swatch: str) -> bpy.types.Object:
    # Polygon lives in X/Z, with depth along Y; the character faces -Y.
    vertices = [(x, -depth * 0.5, z) for x, z in points] + [(x, depth * 0.5, z) for x, z in points]
    count = len(points)
    faces = []
    faces.append(tuple(range(count)))
    faces.append(tuple(range(count, count * 2))[::-1])
    for index in range(count):
        next_index = (index + 1) % count
        faces.append((index, next_index, count + next_index, count + index))
    mesh = bpy.data.meshes.new(f"{name}Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.location = location
    return finish_part(obj, bone, swatch)


def add_ear(name: str, side: float) -> None:
    center_x = 0.28 * side
    tip_x = 0.56 * side
    vertices = [
        (center_x, -0.03, 2.30),
        (center_x, 0.08, 2.17),
        (center_x, -0.12, 2.15),
        (tip_x, 0.03, 2.13),
    ]
    faces = [(0, 1, 3), (1, 2, 3), (2, 0, 3), (0, 2, 1)]
    mesh = bpy.data.meshes.new(f"{name}Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    finish_part(obj, "head", "skin_shadow")


def build_character() -> tuple[bpy.types.Object, bpy.types.Object]:
    # Feet and rigid vintage-weighted legs.
    for side, label in ((-1.0, "L"), (1.0, "R")):
        x = side * 0.19
        add_prism(f"Foot.{label}", [(-0.14, 0.10), (0.14, 0.10), (0.16, -0.02), (0.12, -0.18), (-0.14, -0.18)], 0.46, (x, -0.12, 0.16), f"foot.{label}", "leather_light")
        add_cone(f"Shin.{label}", 0.12, 0.145, 0.45, (x, 0.0, 0.45), f"shin.{label}", "leather", scale=(1.0, 0.88, 1.0))
        add_cube(f"Greave.{label}", (0.25, 0.075, 0.34), (x, -0.14, 0.48), f"shin.{label}", "iron")
        for z in (0.36, 0.49, 0.62):
            add_cube(f"GreaveBand.{label}.{z}", (0.27, 0.095, 0.045), (x, -0.15, z), f"shin.{label}", "iron_edge")
        add_ico(f"Knee.{label}", 0.15, (x, -0.025, 0.72), f"shin.{label}", "iron_edge", scale=(1.0, 0.8, 0.8))
        add_cone(f"Thigh.{label}", 0.14, 0.18, 0.50, (x, 0.0, 0.94), f"thigh.{label}", "wool", scale=(1.0, 0.88, 1.0))

    # Pelvis, skirt plates, and long front tabard.
    add_cone("Pelvis", 0.34, 0.31, 0.30, (0.0, 0.0, 1.10), "pelvis", "wool", scale=(1.0, 0.78, 1.0))
    add_cone("Belt", 0.38, 0.38, 0.13, (0.0, 0.0, 1.20), "pelvis", "leather", scale=(1.0, 0.76, 1.0))
    add_cube("BeltFace", (0.76, 0.07, 0.08), (0.0, -0.29, 1.20), "pelvis", "iron_edge")
    add_ico("BeltBoss", 0.075, (0.0, -0.34, 1.20), "pelvis", "brass", scale=(1.0, 0.38, 1.0))
    for index, x in enumerate((-0.30, -0.15, 0.15, 0.30)):
        add_prism(f"SkirtPlate.{index}", [(-0.075, 0.24), (0.075, 0.24), (0.065, -0.24), (-0.065, -0.24)], 0.29, (x, 0.0, 0.93), "pelvis", "iron")
    add_prism("FrontTabard", [(-0.17, 0.35), (0.17, 0.35), (0.13, -0.36), (0.0, -0.44), (-0.13, -0.36)], 0.045, (0.0, -0.31, 0.88), "pelvis", "oxblood")

    # Tapered torso and readable lamellar rows.
    add_cone("TorsoUnderlayer", 0.33, 0.47, 0.76, (0.0, 0.0, 1.55), "spine", "wool", scale=(1.0, 0.72, 1.0))
    for row, z in enumerate((1.36, 1.51, 1.66, 1.81)):
        radius_bottom = 0.35 + row * 0.025
        add_cone(f"LamellarRow.{row}", radius_bottom, radius_bottom + 0.018, 0.135, (0.0, 0.0, z), "spine", "iron" if row % 2 == 0 else "iron_edge", scale=(1.0, 0.72, 1.0))
    add_cube("ChestVotiveStrip", (0.18, 0.055, 0.66), (0.0, -0.35, 1.58), "spine", "oxblood")
    add_cube("ChestCleft", (0.035, 0.02, 0.46), (0.0, -0.385, 1.58), "spine", "oxblood_dark")
    add_cube("Mantle.L", (0.43, 0.06, 0.15), (-0.22, -0.34, 1.84), "spine", "oxblood", rotation=(0.0, math.radians(-8.0), math.radians(-8.0)))
    add_cube("Mantle.R", (0.43, 0.06, 0.15), (0.22, -0.34, 1.84), "spine", "oxblood", rotation=(0.0, math.radians(8.0), math.radians(8.0)))
    add_ico("ChestBoss", 0.075, (0.0, -0.395, 1.68), "spine", "brass", scale=(1.0, 0.32, 1.0))
    add_cube("SigilStem", (0.035, 0.025, 0.17), (0.0, -0.425, 1.58), "spine", "brass")
    add_cube("SigilFork.L", (0.035, 0.025, 0.19), (-0.055, -0.425, 1.76), "spine", "brass", rotation=(0.0, math.radians(-24.0), math.radians(-25.0)))
    add_cube("SigilFork.R", (0.035, 0.025, 0.19), (0.055, -0.425, 1.76), "spine", "brass", rotation=(0.0, math.radians(24.0), math.radians(25.0)))

    # Arms: broad shoulder plates, long forearms, rigidly weighted by segment.
    for side, label in ((-1.0, "L"), (1.0, "R")):
        x = side * 0.51
        add_cone(f"Shoulder.{label}", 0.20, 0.24, 0.25, (x, 0.0, 1.76), f"upper_arm.{label}", "iron_edge", scale=(1.15, 0.85, 1.0))
        add_cube(f"ShoulderFace.{label}", (0.28, 0.08, 0.15), (x, -0.19, 1.73), f"upper_arm.{label}", "iron")
        add_cone(f"UpperArm.{label}", 0.105, 0.135, 0.44, (x, 0.0, 1.47), f"upper_arm.{label}", "skin", scale=(1.0, 0.88, 1.0), rotation=(0.0, side * math.radians(4.0), 0.0))
        add_cube(f"ArmVotiveBand.{label}", (0.22, 0.19, 0.18), (x, -0.07, 1.31), f"upper_arm.{label}", "oxblood")
        add_cone(f"Forearm.{label}", 0.09, 0.125, 0.38, (x + side * 0.015, 0.0, 1.09), f"forearm.{label}", "leather", scale=(1.0, 0.88, 1.0))
        add_cube(f"Bracer.{label}", (0.22, 0.08, 0.27), (x + side * 0.015, -0.11, 1.10), f"forearm.{label}", "iron")
        for z in (1.00, 1.15, 1.25):
            add_cube(f"BracerBand.{label}.{z}", (0.24, 0.10, 0.04), (x + side * 0.015, -0.13, z), f"forearm.{label}", "iron_edge")
        add_ico(f"Hand.{label}", 0.12, (x + side * 0.02, -0.015, 0.84), f"hand.{label}", "skin_shadow", scale=(0.84, 0.78, 1.10))

    # Shield: standardized state equipment with the cloven-moon geometry.
    shield_outline = [(-0.32, 0.62), (0.32, 0.62), (0.39, 0.48), (0.39, -0.38), (0.0, -0.67), (-0.39, -0.38), (-0.39, 0.48)]
    shield_face = [(-0.27, 0.55), (0.27, 0.55), (0.32, 0.43), (0.32, -0.33), (0.0, -0.58), (-0.32, -0.33), (-0.32, 0.43)]
    add_prism("ShieldRim", shield_outline, 0.14, (-0.66, -0.20, 1.18), "hand.L", "iron_edge")
    add_prism("ShieldFace", shield_face, 0.035, (-0.66, -0.285, 1.18), "hand.L", "leather_light")
    add_cube("ShieldOxblood", (0.16, 0.025, 1.00), (-0.66, -0.315, 1.21), "hand.L", "oxblood")
    add_ico("ShieldBoss", 0.07, (-0.66, -0.35, 1.22), "hand.L", "brass", scale=(1.0, 0.34, 1.0))
    add_cube("ShieldStem", (0.035, 0.025, 0.22), (-0.66, -0.375, 1.10), "hand.L", "brass")
    add_cube("ShieldFork.L", (0.035, 0.025, 0.25), (-0.73, -0.375, 1.35), "hand.L", "brass", rotation=(0.0, math.radians(-22.0), math.radians(-28.0)))
    add_cube("ShieldFork.R", (0.035, 0.025, 0.25), (-0.59, -0.375, 1.35), "hand.L", "brass", rotation=(0.0, math.radians(22.0), math.radians(28.0)))

    # Compact military axe hangs from the right hand in the rest pose.
    add_cone("AxeHandle", 0.045, 0.055, 0.94, (0.54, 0.0, 0.40), "hand.R", "leather", vertices=7)
    axe_blade = [(-0.05, 0.18), (0.33, 0.23), (0.43, 0.08), (0.23, -0.20), (-0.05, -0.10)]
    add_prism("AxeBlade", axe_blade, 0.12, (0.54, 0.0, -0.02), "hand.R", "iron_edge")
    add_ico("AxeBoss", 0.07, (0.54, 0.0, -0.02), "hand.R", "brass")

    # Collar and proprietary stone-mask head.
    add_cone("Collar", 0.24, 0.20, 0.18, (0.0, 0.0, 1.98), "spine", "oxblood", scale=(1.0, 0.80, 1.0))
    add_ico("Cranium", 0.34, (0.0, 0.0, 2.27), "head", "skin", scale=(0.88, 0.76, 1.06), subdivisions=2)
    add_cone("Jaw", 0.18, 0.24, 0.31, (0.0, -0.02, 2.08), "head", "skin_shadow", vertices=7, scale=(1.0, 0.82, 1.0))
    add_cube("BrowPlane", (0.33, 0.095, 0.10), (0.0, -0.265, 2.31), "head", "skin_shadow", rotation=(math.radians(-5.0), 0.0, 0.0))
    add_prism("NasalPlate", [(-0.10, 0.14), (0.10, 0.14), (0.065, -0.14), (-0.065, -0.14)], 0.13, (0.0, -0.31, 2.19), "head", "skin")
    add_cube("NasalCleft", (0.018, 0.025, 0.23), (0.0, -0.385, 2.20), "head", "skin_shadow")
    add_ico("Eye.L", 0.035, (-0.105, -0.315, 2.30), "head", "eye", scale=(1.35, 0.55, 0.58))
    add_ico("Eye.R", 0.035, (0.105, -0.315, 2.30), "head", "eye", scale=(1.35, 0.55, 0.58))
    add_cube("Mouth", (0.24, 0.025, 0.026), (0.0, -0.245, 2.02), "head", "mouth")
    add_cone("Canine.L", 0.025, 0.008, 0.075, (-0.078, -0.27, 2.01), "head", "tooth", vertices=6)
    add_cone("Canine.R", 0.025, 0.008, 0.075, (0.078, -0.27, 2.01), "head", "tooth", vertices=6)
    add_ear("Ear.L", -1.0)
    add_ear("Ear.R", 1.0)

    # Crown-to-nape mane as one readable jagged ridge.
    crest_sections = [
        (0.0, 0.05, 2.62, 0.10, 0.18),
        (0.0, 0.12, 2.53, 0.12, 0.22),
        (0.0, 0.20, 2.42, 0.13, 0.25),
        (0.0, 0.25, 2.29, 0.13, 0.26),
        (0.0, 0.27, 2.15, 0.12, 0.25),
    ]
    for index, (x, y, z, width, height) in enumerate(crest_sections):
        add_prism(f"Mane.{index}", [(-width, height * 0.5), (0.0, height), (width, height * 0.5), (width * 0.72, -height * 0.5), (-width * 0.72, -height * 0.5)], 0.09, (x, y, z), "head", "hair")

    armature = create_armature()
    body = join_parts(armature)
    return body, armature


def create_armature() -> bpy.types.Object:
    armature_data = bpy.data.armatures.new("OrcLegionaryRig")
    armature = bpy.data.objects.new("OrcLegionaryRig", armature_data)
    bpy.context.collection.objects.link(armature)
    armature.show_in_front = True
    bpy.context.view_layer.objects.active = armature
    armature.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")

    definitions = {
        "root": ((0.0, 0.0, 0.0), (0.0, 0.0, 0.25), None),
        "pelvis": ((0.0, 0.0, 0.76), (0.0, 0.0, 1.18), "root"),
        "spine": ((0.0, 0.0, 1.18), (0.0, 0.0, 1.93), "pelvis"),
        "head": ((0.0, 0.0, 1.93), (0.0, 0.0, 2.55), "spine"),
        "upper_arm.L": ((-0.43, 0.0, 1.78), (-0.51, 0.0, 1.31), "spine"),
        "forearm.L": ((-0.51, 0.0, 1.31), (-0.53, 0.0, 0.94), "upper_arm.L"),
        "hand.L": ((-0.53, 0.0, 0.94), (-0.54, 0.0, 0.72), "forearm.L"),
        "upper_arm.R": ((0.43, 0.0, 1.78), (0.51, 0.0, 1.31), "spine"),
        "forearm.R": ((0.51, 0.0, 1.31), (0.53, 0.0, 0.94), "upper_arm.R"),
        "hand.R": ((0.53, 0.0, 0.94), (0.54, 0.0, 0.72), "forearm.R"),
        "thigh.L": ((-0.19, 0.0, 1.04), (-0.19, 0.0, 0.71), "pelvis"),
        "shin.L": ((-0.19, 0.0, 0.71), (-0.19, 0.0, 0.23), "thigh.L"),
        "foot.L": ((-0.19, 0.0, 0.23), (-0.19, -0.30, 0.12), "shin.L"),
        "thigh.R": ((0.19, 0.0, 1.04), (0.19, 0.0, 0.71), "pelvis"),
        "shin.R": ((0.19, 0.0, 0.71), (0.19, 0.0, 0.23), "thigh.R"),
        "foot.R": ((0.19, 0.0, 0.23), (0.19, -0.30, 0.12), "shin.R"),
    }
    created = {}
    for name, (head, tail, parent_name) in definitions.items():
        bone = armature.data.edit_bones.new(name)
        bone.head = head
        bone.tail = tail
        if parent_name:
            bone.parent = created[parent_name]
        created[name] = bone
    bpy.ops.object.mode_set(mode="OBJECT")
    return armature


def join_parts(armature: bpy.types.Object) -> bpy.types.Object:
    bpy.ops.object.select_all(action="DESELECT")
    for part in parts:
        part.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    body = bpy.context.object
    body.name = "OrcLegionaryMesh"
    bpy.ops.object.material_slot_remove_unused()
    modifier = body.modifiers.new("OrcLegionaryRig", "ARMATURE")
    modifier.object = armature
    body.parent = armature
    for polygon in body.data.polygons:
        polygon.use_smooth = False
    return body


def add_preview_scene(body: bpy.types.Object, armature: bpy.types.Object) -> None:
    # Ground and a restrained studio setup are saved in the source .blend only.
    bpy.ops.mesh.primitive_plane_add(size=14.0, location=(0.0, 0.0, -0.02))
    ground = bpy.context.object
    ground.name = "PreviewGround"
    ground_material = bpy.data.materials.new("PreviewGroundMaterial")
    ground_material.diffuse_color = (0.055, 0.06, 0.055, 1.0)
    ground.data.materials.append(ground_material)

    world = bpy.context.scene.world or bpy.data.worlds.new("World")
    bpy.context.scene.world = world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.025, 0.03, 0.035, 1.0)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.32

    def light(name: str, kind: str, location, energy: float, color, size=3.0) -> None:
        data = bpy.data.lights.new(name, kind)
        data.energy = energy
        data.color = color
        if kind == "AREA":
            data.shape = "DISK"
            data.size = size
        obj = bpy.data.objects.new(name, data)
        bpy.context.collection.objects.link(obj)
        obj.location = location
        direction = Vector((0.0, 0.0, 1.25)) - obj.location
        obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()

    light("WarmKey", "AREA", (-3.8, -4.8, 5.2), 1500.0, (1.0, 0.62, 0.38), 3.5)
    light("CoolFill", "AREA", (3.5, -2.0, 3.2), 1100.0, (0.48, 0.64, 1.0), 3.0)
    light("Rim", "AREA", (0.0, 3.6, 4.4), 1250.0, (0.65, 0.30, 0.90), 2.5)

    camera_data = bpy.data.cameras.new("PreviewCamera")
    camera = bpy.data.objects.new("PreviewCamera", camera_data)
    bpy.context.collection.objects.link(camera)
    camera.location = (3.15, -6.7, 2.75)
    camera.rotation_euler = (Vector((0.0, 0.0, 1.28)) - camera.location).to_track_quat("-Z", "Y").to_euler()
    camera_data.lens = 58.0
    bpy.context.scene.camera = camera

    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.render.resolution_x = 720
    scene.render.resolution_y = 720
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = str(PREVIEW_PATH)
    scene.render.film_transparent = False
    scene.render.image_settings.color_mode = "RGBA"
    scene.view_settings.look = "AgX - Medium High Contrast"

    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND_PATH))
    bpy.ops.render.render(write_still=True)

    bpy.ops.object.select_all(action="DESELECT")
    body.select_set(True)
    armature.select_set(True)
    bpy.context.view_layer.objects.active = armature
    bpy.ops.export_scene.gltf(
        filepath=str(GLB_PATH),
        export_format="GLB",
        use_selection=True,
        export_animations=False,
        export_yup=True,
        export_apply=False,
    )


def main() -> None:
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    BLEND_PATH.parent.mkdir(parents=True, exist_ok=True)
    reset_scene()
    atlas = create_atlas()
    create_materials(atlas)
    body, armature = build_character()
    add_preview_scene(body, armature)
    triangles = sum(len(polygon.vertices) - 2 for polygon in body.data.polygons)
    print(f"HERITAGE_MODEL_OK triangles={triangles} vertices={len(body.data.vertices)} glb={GLB_PATH}")


if __name__ == "__main__":
    main()
