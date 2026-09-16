"""Build the production-candidate Ashen Legionary in Blender 4.5 LTS.

This is deliberately separate from the heritage proxy builder.  Organic forms
are authored from shaped surface loops; boxes are reserved for rigid plates.
"""

from __future__ import annotations

import math
import struct
import zlib
from pathlib import Path

import bpy
from mathutils import Euler, Matrix, Vector


ROOT = Path(__file__).resolve().parents[1]
ASSET_DIR = ROOT / "characters" / "orc_legionary" / "production"
ARTIFACT_DIR = ROOT / "artifacts"
ATLAS_PATH = ASSET_DIR / "orc_legionary_diffuse.png"
PROJECTION_PATH = ASSET_DIR / "orc_legionary_body_paint.png"
BLEND_PATH = ASSET_DIR / "source" / "orc_legionary_production.blend"
GLB_PATH = ASSET_DIR / "orc_legionary_production.glb"
PREVIEW_PATH = ARTIFACT_DIR / "orc_legionary_production_blender.png"
CONCEPT_PATH = ROOT / "art" / "concepts" / "orc-legionary-flat-color-v05.png"

ATLAS_SIZE = 1024
GRID = 4
CELL_SIZE = ATLAS_SIZE // GRID

TILES = {
    "skin": (0, (0.285, 0.315, 0.245)),
    "skin_dark": (1, (0.175, 0.205, 0.155)),
    "iron": (2, (0.075, 0.078, 0.074)),
    "iron_edge": (3, (0.17, 0.165, 0.15)),
    "oxblood": (4, (0.255, 0.040, 0.050)),
    "oxblood_dark": (5, (0.14, 0.025, 0.03)),
    "leather": (6, (0.20, 0.115, 0.065)),
    "leather_light": (7, (0.34, 0.22, 0.13)),
    "brass": (8, (0.49, 0.32, 0.105)),
    "wool": (9, (0.105, 0.105, 0.095)),
    "hair": (10, (0.026, 0.029, 0.027)),
    "face": (11, (0.285, 0.315, 0.245)),
    "armor_front": (12, (0.075, 0.078, 0.074)),
    "bone": (13, (0.46, 0.41, 0.30)),
    "hide": (14, (0.18, 0.135, 0.085)),
}

parts: list[bpy.types.Object] = []
materials: dict[str, bpy.types.Material] = {}


def reset_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for datablocks in (
        bpy.data.meshes,
        bpy.data.curves,
        bpy.data.armatures,
        bpy.data.materials,
        bpy.data.cameras,
        bpy.data.lights,
        bpy.data.actions,
    ):
        for datablock in list(datablocks):
            if datablock.users == 0:
                datablocks.remove(datablock)
    # Animation keys and gameplay impact delays are authored against 30 fps.
    # Blender defaults to 24 fps, which previously stretched every clip by 25%.
    bpy.context.scene.render.fps = 30
    bpy.context.scene.render.fps_base = 1.0


def hash_noise(x: int, y: int, seed: int) -> float:
    value = (x * 374761393 + y * 668265263 + seed * 69069) & 0xFFFFFFFF
    value = ((value ^ (value >> 13)) * 1274126177) & 0xFFFFFFFF
    value ^= value >> 16
    return (value & 0xFFFF) / 32767.5 - 1.0


def create_atlas() -> bpy.types.Image:
    ASSET_DIR.mkdir(parents=True, exist_ok=True)
    pixels = bytearray(ATLAS_SIZE * ATLAS_SIZE * 4)
    by_index = {value[0]: (name, value[1]) for name, value in TILES.items()}

    for y in range(ATLAS_SIZE):
        for x in range(ATLAS_SIZE):
            cell_x = x // CELL_SIZE
            cell_y = y // CELL_SIZE
            index = cell_y * GRID + cell_x
            name, base = by_index.get(index, ("unused", (0.08, 0.08, 0.08)))
            local_x = x % CELL_SIZE
            local_y = y % CELL_SIZE
            u = local_x / max(1, CELL_SIZE - 1)
            v = local_y / max(1, CELL_SIZE - 1)

            grain = hash_noise(x, y, index + 17) * 0.025
            broad = math.sin(u * 11.0 + math.sin(v * 7.0)) * 0.022
            shade = (v - 0.5) * 0.055
            variation = grain + broad + shade
            tint = [0.0, 0.0, 0.0]

            if name.startswith("skin"):
                mottling = math.sin(u * 19.0 + math.sin(v * 13.0) * 2.0) * math.sin(v * 17.0)
                variation += mottling * 0.035
                if hash_noise(local_x // 7, local_y // 7, 31) > 0.74:
                    tint = [-0.035, 0.015, -0.025]
                if abs(u - 0.51) < 0.012 and 0.17 < v < 0.83:
                    variation -= 0.035
            elif name.startswith("iron"):
                variation += math.sin(v * 34.0) * 0.012
                seam = min(abs((u * 4.0) % 1.0), abs(1.0 - ((u * 4.0) % 1.0)))
                if seam < 0.025:
                    variation -= 0.055
                rivet_u = abs((u * 4.0) % 1.0 - 0.08)
                rivet_v = abs((v * 5.0) % 1.0 - 0.12)
                if rivet_u < 0.020 and rivet_v < 0.035:
                    variation += 0.12
                if (local_x * 7 + local_y * 13 + index) % 211 == 0:
                    variation += 0.15
                if hash_noise(local_x // 5, local_y // 5, 41) > 0.86:
                    tint = [0.035, -0.006, -0.025]
            elif name.startswith("oxblood"):
                weave = (math.sin(u * 135.0) + math.sin(v * 118.0)) * 0.008
                variation += weave - abs(u - 0.5) * 0.035
                if hash_noise(local_x // 9, local_y // 9, 53) > 0.88:
                    variation += 0.045
            elif name.startswith("leather") or name == "hide":
                variation += math.sin((u * 29.0 + v * 21.0) + math.sin(v * 8.0)) * 0.025
                if (local_x + local_y * 3) % 173 == 0:
                    variation -= 0.12
            elif name == "brass":
                variation += math.sin(u * 16.0) * 0.035
                if hash_noise(local_x // 6, local_y // 6, 67) > 0.80:
                    tint = [-0.07, 0.035, 0.015]
            elif name == "wool":
                variation += (math.sin(u * 120.0) + math.sin(v * 87.0)) * 0.007
            elif name == "hair":
                variation += math.sin((u + v * 0.18) * 82.0) * 0.018
            elif name == "eye":
                radius = math.hypot(u - 0.5, v - 0.5)
                variation += max(0.0, 0.28 - radius) * 0.8
            elif name == "bone":
                variation += math.sin(u * 17.0 + v * 9.0) * 0.025

            offset = (y * ATLAS_SIZE + x) * 4
            for channel in range(3):
                value = base[channel] + variation + tint[channel]
                pixels[offset + channel] = round(max(0.0, min(1.0, value)) * 255)
            pixels[offset + 3] = 255

    # The approved turnaround already contains authored facial and armor paint.
    # Downsample those exact project-owned views into atlas cells rather than
    # asking generic noise to impersonate a character artist.
    assert CONCEPT_PATH.exists(), f"missing approved concept sheet: {CONCEPT_PATH}"
    concept = bpy.data.images.load(str(CONCEPT_PATH), check_existing=False)
    source_width, source_height = concept.size
    source_pixels = concept.pixels[:]

    def paste_reference(tile: str, crop: tuple[int, int, int, int], color_scale: tuple[float, float, float]) -> None:
        tile_index = TILES[tile][0]
        cell_x = tile_index % GRID
        cell_y = tile_index // GRID
        x0, y0, x1, y1 = crop
        for local_y in range(CELL_SIZE):
            source_y = min(source_height - 1, y0 + int((local_y + 0.5) / CELL_SIZE * (y1 - y0)))
            for local_x in range(CELL_SIZE):
                source_x = min(source_width - 1, x0 + int((local_x + 0.5) / CELL_SIZE * (x1 - x0)))
                source_offset = (source_y * source_width + source_x) * 4
                target_x = cell_x * CELL_SIZE + local_x
                target_y = cell_y * CELL_SIZE + local_y
                target_offset = (target_y * ATLAS_SIZE + target_x) * 4
                source_rgb = [source_pixels[source_offset + channel] for channel in range(3)]
                if tile == "face" and max(source_rgb) - min(source_rgb) < 0.075 and sum(source_rgb) / 3.0 > 0.43:
                    source_rgb = [0.035, 0.040, 0.035] if local_y > CELL_SIZE * 0.70 else [0.19, 0.215, 0.165]
                for channel in range(3):
                    value = source_rgb[channel] * color_scale[channel]
                    value = round(max(0.0, min(1.0, value)) * 31.0) / 31.0
                    pixels[target_offset + channel] = round(value * 255)
                pixels[target_offset + 3] = 255

    # Blender image coordinates start at the lower-left corner.
    paste_reference("face", (100, 104, 350, 394), (1.0, 1.0, 1.0))

    def chunk(kind: bytes, data: bytes) -> bytes:
        crc = zlib.crc32(kind + data) & 0xFFFFFFFF
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", crc)

    stride = ATLAS_SIZE * 4
    raw = b"".join(b"\x00" + pixels[y * stride : (y + 1) * stride] for y in reversed(range(ATLAS_SIZE)))
    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", ATLAS_SIZE, ATLAS_SIZE, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(raw, 9))
    png += chunk(b"IEND", b"")
    ATLAS_PATH.write_bytes(png)

    image = bpy.data.images.load(str(ATLAS_PATH), check_existing=False)
    image.name = "OrcLegionaryDiffuse"
    image.colorspace_settings.name = "sRGB"
    return image


def create_body_paint() -> bpy.types.Image:
    """Build front/back/profile paint from the approved orthographic sheet."""
    width = 2048
    height = 1024
    tile_width = width // 4
    pixels = bytearray(width * height * 4)
    concept = bpy.data.images.load(str(CONCEPT_PATH), check_existing=True)
    source_width, source_height = concept.size
    source_pixels = concept.pixels[:]
    # Tight bounds around the four unlit views.  The old crops deliberately
    # carried generous backdrop margins; projective UVs then sampled that gray
    # backdrop onto the scalp, hands, and boots.
    crops = [
        (38, 414, 330, 1002),
        (637, 419, 920, 1002),
        (408, 415, 540, 1001),
        (1013, 414, 1144, 1002),
    ]

    for tile_index, (x0, y0, x1, y1) in enumerate(crops):
        for target_y in range(height):
            source_y = min(source_height - 1, y0 + int((target_y + 0.5) / height * (y1 - y0)))
            normalized_y = target_y / max(1, height - 1)
            for local_x in range(tile_width):
                source_x = min(source_width - 1, x0 + int((local_x + 0.5) / tile_width * (x1 - x0)))
                source_offset = (source_y * source_width + source_x) * 4
                rgb = [source_pixels[source_offset + channel] for channel in range(3)]
                if max(rgb) - min(rgb) < 0.085 and sum(rgb) / 3.0 > 0.43:
                    if normalized_y > 0.80:
                        rgb = [0.11, 0.13, 0.10]
                    elif normalized_y > 0.40:
                        rgb = [0.075, 0.075, 0.070]
                    elif normalized_y > 0.16:
                        rgb = [0.14, 0.055, 0.050]
                    else:
                        rgb = [0.11, 0.075, 0.045]
                target_x = tile_index * tile_width + local_x
                target_offset = (target_y * width + target_x) * 4
                for channel in range(3):
                    value = round(max(0.0, min(1.0, rgb[channel])) * 31.0) / 31.0
                    pixels[target_offset + channel] = round(value * 255)
                pixels[target_offset + 3] = 255

    def chunk(kind: bytes, data: bytes) -> bytes:
        crc = zlib.crc32(kind + data) & 0xFFFFFFFF
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", crc)

    stride = width * 4
    raw = b"".join(b"\x00" + pixels[y * stride : (y + 1) * stride] for y in reversed(range(height)))
    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(raw, 9))
    png += chunk(b"IEND", b"")
    PROJECTION_PATH.write_bytes(png)

    image = bpy.data.images.load(str(PROJECTION_PATH), check_existing=False)
    image.name = "OrcLegionaryBodyPaint"
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
    texture.interpolation = "Linear"
    links.new(texture.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    if "Specular IOR Level" in bsdf.inputs:
        bsdf.inputs["Specular IOR Level"].default_value = 0.28
    if emission > 0.0 and "Emission Color" in bsdf.inputs:
        links.new(texture.outputs["Color"], bsdf.inputs["Emission Color"])
        bsdf.inputs["Emission Strength"].default_value = emission
    return material


def create_materials(image: bpy.types.Image, body_paint: bpy.types.Image) -> None:
    specs = {
        "skin": (0.0, 0.91, 0.0),
        "skin_dark": (0.0, 0.95, 0.0),
        "iron": (0.16, 0.82, 0.0),
        "iron_edge": (0.22, 0.72, 0.0),
        "oxblood": (0.0, 0.96, 0.0),
        "oxblood_dark": (0.0, 0.98, 0.0),
        "leather": (0.0, 0.91, 0.0),
        "leather_light": (0.0, 0.86, 0.0),
        "brass": (0.24, 0.69, 0.0),
        "wool": (0.0, 1.0, 0.0),
        "hair": (0.0, 0.98, 0.0),
        "eye": (0.0, 0.68, 0.38),
        "mouth": (0.0, 1.0, 0.0),
        "bone": (0.0, 0.92, 0.0),
        "hide": (0.0, 0.93, 0.0),
    }
    for key, (metallic, roughness, emission) in specs.items():
        materials[key] = make_material(key.title().replace("_", ""), image, metallic, roughness, emission)
    materials["body_paint"] = make_material("BodyPaint", body_paint, 0.0, 0.94, 0.0)


def object_from_mesh(name: str, vertices: list[tuple[float, float, float]], faces: list[tuple[int, ...]]) -> bpy.types.Object:
    mesh = bpy.data.meshes.new(f"{name}Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    return obj


def activate(obj: bpy.types.Object) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def apply_bevel(obj: bpy.types.Object, width: float) -> None:
    if width <= 0.0:
        return
    activate(obj)
    modifier = obj.modifiers.new("EdgeSoftening", "BEVEL")
    modifier.width = width
    modifier.segments = 1
    modifier.limit_method = "ANGLE"
    bpy.ops.object.modifier_apply(modifier=modifier.name)


def smart_uv_to_tile(obj: bpy.types.Object, tile: str) -> None:
    activate(obj)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(66.0), island_margin=0.025)
    bpy.ops.object.mode_set(mode="OBJECT")
    uv_layer = obj.data.uv_layers.active
    index = TILES[tile][0]
    cell_x = index % GRID
    cell_y = index // GRID
    margin = 0.06
    scale = (1.0 - margin * 2.0) / GRID
    for loop in uv_layer.data:
        loop.uv.x = (cell_x + margin) / GRID + loop.uv.x * scale
        loop.uv.y = (cell_y + margin) / GRID + loop.uv.y * scale


def finish_part(
    obj: bpy.types.Object,
    bone: str,
    tile: str,
    *,
    smooth: bool = False,
    bevel: float = 0.0,
) -> bpy.types.Object:
    apply_bevel(obj, bevel)
    obj.data.materials.append(materials[tile])
    smart_uv_to_tile(obj, tile)
    for polygon in obj.data.polygons:
        polygon.use_smooth = smooth
    group = obj.vertex_groups.new(name=bone)
    group.add(range(len(obj.data.vertices)), 1.0, "REPLACE")
    parts.append(obj)
    return obj


def project_front_to_tile(
    obj: bpy.types.Object,
    tile: str,
    x_range: tuple[float, float],
    z_range: tuple[float, float],
    *,
    normal_threshold: float = -0.22,
) -> None:
    """Overwrite only front-facing UV loops with an orthographic art crop."""
    uv_layer = obj.data.uv_layers.active
    tile_index = TILES[tile][0]
    cell_x = tile_index % GRID
    cell_y = tile_index // GRID
    margin = 0.018
    scale = (1.0 - margin * 2.0) / GRID
    for polygon in obj.data.polygons:
        if polygon.normal.y >= normal_threshold:
            continue
        for loop_index in polygon.loop_indices:
            vertex = obj.data.vertices[obj.data.loops[loop_index].vertex_index]
            u = (vertex.co.x - x_range[0]) / (x_range[1] - x_range[0])
            v = (vertex.co.z - z_range[0]) / (z_range[1] - z_range[0])
            uv_layer.data[loop_index].uv = (
                (cell_x + margin) / GRID + max(0.0, min(1.0, u)) * scale,
                (cell_y + margin) / GRID + max(0.0, min(1.0, v)) * scale,
            )


def apply_body_projection() -> None:
    """Project the approved front/back/profile paint over every non-prop part."""
    margin = 0.018
    usable = 1.0 - margin * 2.0
    for obj in parts:
        if obj.name.startswith(("Shield", "Axe")):
            continue
        obj.data.materials.clear()
        obj.data.materials.append(materials["body_paint"])
        for polygon in obj.data.polygons:
            polygon.material_index = 0
        uv_layer = obj.data.uv_layers.active
        if uv_layer is None:
            uv_layer = obj.data.uv_layers.new(name="UVMap")
        world_matrix = obj.matrix_world
        normal_matrix = world_matrix.to_3x3()
        for polygon in obj.data.polygons:
            normal = (normal_matrix @ polygon.normal).normalized()
            if abs(normal.y) >= abs(normal.x):
                if normal.y < 0.0:
                    tile = 0  # front
                    flip_u = False
                else:
                    tile = 1  # back
                    flip_u = True
                axis_min, axis_max = -0.95, 0.95
                for loop_index in polygon.loop_indices:
                    vertex = obj.data.vertices[obj.data.loops[loop_index].vertex_index]
                    world = world_matrix @ vertex.co
                    u = (world.x - axis_min) / (axis_max - axis_min)
                    if flip_u:
                        u = 1.0 - u
                    v = world.z / 2.62
                    uv_layer.data[loop_index].uv = (
                        (tile + margin + max(0.0, min(1.0, u)) * usable) / 4.0,
                        margin + max(0.0, min(1.0, v)) * usable,
                    )
            else:
                tile = 2 if normal.x < 0.0 else 3
                flip_u = normal.x > 0.0
                axis_min, axis_max = -0.38, 0.38
                for loop_index in polygon.loop_indices:
                    vertex = obj.data.vertices[obj.data.loops[loop_index].vertex_index]
                    world = world_matrix @ vertex.co
                    u = (world.y - axis_min) / (axis_max - axis_min)
                    if flip_u:
                        u = 1.0 - u
                    v = world.z / 2.62
                    uv_layer.data[loop_index].uv = (
                        (tile + margin + max(0.0, min(1.0, u)) * usable) / 4.0,
                        margin + max(0.0, min(1.0, v)) * usable,
                    )


def create_tube(
    name: str,
    rings: list[tuple[tuple[float, float, float], float, float]],
    segments: int,
    bone: str,
    tile: str,
    *,
    smooth: bool = True,
    cap: bool = True,
) -> bpy.types.Object:
    vertices: list[tuple[float, float, float]] = []
    faces: list[tuple[int, ...]] = []
    centers = [Vector(ring[0]) for ring in rings]
    for ring_index, (_, radius_side, radius_depth) in enumerate(rings):
        center = centers[ring_index]
        if ring_index == 0:
            tangent = centers[1] - centers[0]
        elif ring_index == len(rings) - 1:
            tangent = centers[-1] - centers[-2]
        else:
            tangent = centers[ring_index + 1] - centers[ring_index - 1]
        tangent.normalize()
        depth_axis = Vector((0.0, 1.0, 0.0))
        side_axis = depth_axis.cross(tangent)
        if side_axis.length < 0.001:
            side_axis = Vector((1.0, 0.0, 0.0))
        side_axis.normalize()
        for segment in range(segments):
            angle = math.tau * segment / segments
            point = center + side_axis * math.cos(angle) * radius_side + depth_axis * math.sin(angle) * radius_depth
            vertices.append(tuple(point))

    for ring_index in range(len(rings) - 1):
        start = ring_index * segments
        next_start = (ring_index + 1) * segments
        for segment in range(segments):
            following = (segment + 1) % segments
            faces.append((start + segment, start + following, next_start + following, next_start + segment))
    if cap:
        faces.append(tuple(reversed(range(segments))))
        end = (len(rings) - 1) * segments
        faces.append(tuple(end + segment for segment in range(segments)))
    return finish_part(object_from_mesh(name, vertices, faces), bone, tile, smooth=smooth)


def create_ellipsoid(
    name: str,
    center: tuple[float, float, float],
    radii: tuple[float, float, float],
    bone: str,
    tile: str,
    *,
    segments: int = 12,
    rings: int = 6,
    smooth: bool = False,
    deform=None,
) -> bpy.types.Object:
    vertices: list[tuple[float, float, float]] = []
    faces: list[tuple[int, ...]] = []
    origin = Vector(center)
    vertices.append(tuple(origin + Vector((0.0, 0.0, -radii[2]))))
    for latitude in range(1, rings):
        phi = -math.pi * 0.5 + math.pi * latitude / rings
        for segment in range(segments):
            theta = math.tau * segment / segments
            local = Vector((
                math.cos(phi) * math.cos(theta) * radii[0],
                math.cos(phi) * math.sin(theta) * radii[1],
                math.sin(phi) * radii[2],
            ))
            if deform is not None:
                local = deform(local)
            vertices.append(tuple(origin + local))
    top_index = len(vertices)
    vertices.append(tuple(origin + Vector((0.0, 0.0, radii[2]))))

    for segment in range(segments):
        following = (segment + 1) % segments
        faces.append((0, 1 + following, 1 + segment))
    for latitude in range(rings - 2):
        start = 1 + latitude * segments
        next_start = start + segments
        for segment in range(segments):
            following = (segment + 1) % segments
            faces.append((start + segment, start + following, next_start + following, next_start + segment))
    last = 1 + (rings - 2) * segments
    for segment in range(segments):
        following = (segment + 1) % segments
        faces.append((last + segment, last + following, top_index))
    return finish_part(object_from_mesh(name, vertices, faces), bone, tile, smooth=smooth)


def create_prism_xz(
    name: str,
    outline: list[tuple[float, float]],
    depth: float,
    center: tuple[float, float, float],
    bone: str,
    tile: str,
    *,
    bevel: float = 0.0,
    curve: float = 0.0,
) -> bpy.types.Object:
    cx, cy, cz = center
    max_x = max(abs(point[0]) for point in outline) or 1.0
    front = []
    back = []
    for x, z in outline:
        bow = curve * (1.0 - (x / max_x) ** 2)
        front.append((cx + x, cy - depth * 0.5 - bow, cz + z))
        back.append((cx + x, cy + depth * 0.5, cz + z))
    vertices = front + back
    count = len(outline)
    faces: list[tuple[int, ...]] = [tuple(reversed(range(count))), tuple(range(count, count * 2))]
    for index in range(count):
        following = (index + 1) % count
        faces.append((index, following, count + following, count + index))
    return finish_part(object_from_mesh(name, vertices, faces), bone, tile, bevel=bevel)


def create_box(
    name: str,
    dimensions: tuple[float, float, float],
    location: tuple[float, float, float],
    rotation: tuple[float, float, float],
    bone: str,
    tile: str,
    *,
    bevel: float = 0.012,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = dimensions
    activate(obj)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    return finish_part(obj, bone, tile, bevel=bevel)


def create_ribbon(
    name: str,
    points: list[tuple[float, float]],
    width: float,
    depth: float,
    center: tuple[float, float, float],
    bone: str,
    tile: str,
) -> bpy.types.Object:
    vertices: list[tuple[float, float, float]] = []
    cx, cy, cz = center
    for index, point in enumerate(points):
        current = Vector(point)
        if index == 0:
            tangent = Vector(points[1]) - current
        elif index == len(points) - 1:
            tangent = current - Vector(points[index - 1])
        else:
            tangent = Vector(points[index + 1]) - Vector(points[index - 1])
        tangent.normalize()
        normal = Vector((-tangent.y, tangent.x)) * width * 0.5
        for side in (-1.0, 1.0):
            offset = current + normal * side
            vertices.append((cx + offset.x, cy - depth * 0.5, cz + offset.y))
            vertices.append((cx + offset.x, cy + depth * 0.5, cz + offset.y))
    faces: list[tuple[int, ...]] = []
    for index in range(len(points) - 1):
        start = index * 4
        following = start + 4
        faces.extend([
            (start, following, following + 2, start + 2),
            (start + 1, start + 3, following + 3, following + 1),
            (start, start + 1, following + 1, following),
            (start + 2, following + 2, following + 3, start + 3),
        ])
    faces.extend([(0, 2, 3, 1), (len(vertices) - 4, len(vertices) - 3, len(vertices) - 1, len(vertices) - 2)])
    return finish_part(object_from_mesh(name, vertices, faces), bone, tile)


def add_cloven_moon(prefix: str, center: tuple[float, float, float], scale: float, bone: str, tile: str) -> None:
    left = [(0.0, -0.20), (-0.12, -0.04), (-0.18, 0.15), (-0.12, 0.31), (-0.04, 0.40)]
    right = [(-x, z) for x, z in left]
    left = [(x * scale, z * scale) for x, z in left]
    right = [(x * scale, z * scale) for x, z in right]
    stem = [(0.0, -0.29 * scale), (0.0, -0.07 * scale), (0.0, 0.08 * scale)]
    create_ribbon(f"{prefix}.L", left, 0.055 * scale, 0.018, center, bone, tile)
    create_ribbon(f"{prefix}.R", right, 0.055 * scale, 0.018, center, bone, tile)
    create_ribbon(f"{prefix}.Stem", stem, 0.048 * scale, 0.018, center, bone, tile)


def add_foot(side: float, label: str) -> None:
    x = side * 0.22
    inner = 0.115
    outer = 0.155
    x_min = x - (outer if side < 0.0 else inner)
    x_max = x + (inner if side < 0.0 else outer)
    vertices = [
        (x_min, -0.38, 0.055), (x_max, -0.38, 0.055), (x_min, 0.10, 0.055), (x_max, 0.10, 0.055),
        (x_min, -0.34, 0.155), (x_max, -0.34, 0.155), (x_min, 0.08, 0.245), (x_max, 0.08, 0.245),
    ]
    faces = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
    finish_part(object_from_mesh(f"Foot.{label}", vertices, faces), f"foot.{label}", "leather", bevel=0.022)
    toe_outline = [(-0.13, 0.08), (0.13, 0.08), (0.15, -0.04), (0.10, -0.10), (-0.10, -0.10), (-0.15, -0.04)]
    create_prism_xz(f"ToeCap.{label}", toe_outline, 0.18, (x, -0.305, 0.15), f"foot.{label}", "iron", bevel=0.012, curve=0.012)


def add_hand(side: float, label: str, center: tuple[float, float, float]) -> None:
    def hand_deform(local: Vector) -> Vector:
        local.z *= 1.0 - max(0.0, -local.z) * 0.25
        if local.y < 0.0:
            local.y *= 0.86
        return local

    create_ellipsoid(
        f"Hand.{label}", center, (0.105, 0.085, 0.16), f"hand.{label}", "skin_dark",
        segments=8, rings=4, smooth=False, deform=hand_deform,
    )
    thumb_x = center[0] - side * 0.075
    create_tube(
        f"Thumb.{label}",
        [((thumb_x, center[1] - 0.01, center[2] + 0.03), 0.035, 0.032),
         ((thumb_x - side * 0.035, center[1] - 0.035, center[2] - 0.055), 0.026, 0.024)],
        6, f"hand.{label}", "skin_dark", smooth=False,
    )


def add_head() -> None:
    # Sixteen aligned surface loops form one face and cranium.  The front three
    # vertices of each loop are deliberately displaced to build the stone-mask
    # brow, cheek, and nasal plane into the topology instead of gluing on boxes.
    ring_specs = [
        (2.055, 0.105, 0.095, -0.035, 0.00),
        (2.105, 0.155, 0.135, -0.030, 0.01),
        (2.175, 0.205, 0.165, -0.018, 0.07),
        (2.245, 0.225, 0.182, -0.005, 0.11),
        (2.315, 0.225, 0.190, 0.000, 0.055),
        (2.385, 0.215, 0.190, 0.010, 0.02),
        (2.465, 0.195, 0.185, 0.025, 0.00),
        (2.535, 0.135, 0.145, 0.040, 0.00),
    ]
    segments = 16
    vertices: list[tuple[float, float, float]] = []
    for z, radius_x, radius_y, center_y, nose_push in ring_specs:
        for segment in range(segments):
            angle = math.tau * segment / segments
            x = math.cos(angle) * radius_x
            y = center_y + math.sin(angle) * radius_y
            front_distance = min((segment - 12) % segments, (12 - segment) % segments)
            if front_distance == 0:
                y -= nose_push
            elif front_distance == 1:
                y -= nose_push * 0.34
            if z == 2.315 and front_distance == 1:
                y -= 0.030
            if z == 2.245 and front_distance == 2:
                y -= 0.018
            vertices.append((x, y, z))
    faces: list[tuple[int, ...]] = []
    for ring in range(len(ring_specs) - 1):
        start = ring * segments
        following_ring = start + segments
        for segment in range(segments):
            following = (segment + 1) % segments
            faces.append((start + segment, start + following, following_ring + following, following_ring + segment))
    faces.append(tuple(reversed(range(segments))))
    top = (len(ring_specs) - 1) * segments
    faces.append(tuple(top + segment for segment in range(segments)))
    finish_part(object_from_mesh("Head", vertices, faces), "head", "skin", smooth=False)

    for side, label in ((-1.0, "L"), (1.0, "R")):
        ear_vertices = [
            (side * 0.19, -0.005, 2.35), (side * 0.20, 0.055, 2.22), (side * 0.46, 0.055, 2.245),
            (side * 0.19, 0.045, 2.35), (side * 0.20, 0.105, 2.22), (side * 0.46, 0.105, 2.245),
        ]
        ear_faces = [(0, 2, 1), (3, 4, 5), (0, 3, 5, 2), (2, 5, 4, 1), (1, 4, 3, 0)]
        finish_part(object_from_mesh(f"Ear.{label}", ear_vertices, ear_faces), "head", "skin", smooth=False)
        inner = [(0.0, 0.055), (side * 0.17, 0.0), (0.02 * side, -0.055)]
        create_prism_xz(f"InnerEar.{label}", inner, 0.010, (side * 0.255, -0.062, 2.275), "head", "skin_dark")

    mane_sections = [
        ((0.0, 0.08, 2.58), 0.09, 0.15), ((0.0, 0.13, 2.52), 0.105, 0.18),
        ((0.0, 0.18, 2.45), 0.12, 0.20), ((0.0, 0.22, 2.36), 0.13, 0.22),
        ((0.0, 0.25, 2.26), 0.125, 0.22), ((0.0, 0.26, 2.16), 0.11, 0.19),
        ((0.0, 0.24, 2.07), 0.09, 0.16),
    ]
    for index, (center, width, height) in enumerate(mane_sections):
        outline = [(-width, height * 0.35), (0.0, height * 0.60), (width, height * 0.35), (width * 0.70, -height * 0.45), (0.0, -height * 0.60), (-width * 0.70, -height * 0.45)]
        create_prism_xz(f"ManeLock.{index}", outline, 0.075, center, "head", "hair", bevel=0.004)


def add_shield() -> None:
    outline = [(-0.31, 0.54), (0.31, 0.54), (0.37, 0.42), (0.35, -0.36), (0.0, -0.62), (-0.35, -0.36), (-0.37, 0.42)]
    face = [(-0.265, 0.49), (0.265, 0.49), (0.315, 0.38), (0.305, -0.31), (0.0, -0.54), (-0.305, -0.31), (-0.315, 0.38)]
    center = (-0.77, -0.13, 1.20)
    create_prism_xz("ShieldRim", outline, 0.13, center, "hand.L", "iron_edge", bevel=0.018, curve=0.055)
    create_prism_xz("ShieldFace", face, 0.025, (center[0], center[1] - 0.085, center[2]), "hand.L", "hide", bevel=0.008, curve=0.045)
    create_ellipsoid("ShieldBoss", (center[0], center[1] - 0.145, center[2] + 0.02), (0.10, 0.035, 0.10), "hand.L", "iron", segments=10, rings=4)
    add_cloven_moon("ShieldMark", (center[0], center[1] - 0.145, center[2] + 0.02), 0.62, "hand.L", "bone")


def add_axe() -> None:
    create_tube(
        "AxeHandle",
        [((0.80, 0.0, 1.00), 0.038, 0.036), ((0.82, 0.0, 0.60), 0.043, 0.040), ((0.83, 0.0, 0.22), 0.050, 0.046)],
        8, "hand.R", "leather", smooth=False,
    )
    blade = [(-0.06, 0.18), (0.29, 0.23), (0.39, 0.10), (0.31, -0.07), (0.14, -0.22), (-0.055, -0.15)]
    create_prism_xz("AxeBlade", blade, 0.11, (0.83, 0.0, 0.20), "hand.R", "iron_edge", bevel=0.012)
    create_ellipsoid("AxeSocket", (0.83, 0.0, 0.20), (0.072, 0.068, 0.085), "hand.R", "brass", segments=8, rings=4)


def build_character() -> tuple[bpy.types.Object, bpy.types.Object]:
    # Organic lower body.
    for side, label in ((-1.0, "L"), (1.0, "R")):
        add_foot(side, label)
        x = side * 0.22
        create_tube(
            f"Shin.{label}",
            [((x, 0.0, 0.23), 0.105, 0.12), ((x, 0.0, 0.46), 0.12, 0.13), ((x, 0.0, 0.70), 0.145, 0.15)],
            9, f"shin.{label}", "skin_dark", smooth=True,
        )
        create_tube(
            f"Thigh.{label}",
            [((x, 0.0, 0.66), 0.145, 0.15), ((side * 0.21, 0.0, 0.88), 0.175, 0.18), ((side * 0.20, 0.0, 1.10), 0.18, 0.19)],
            9, f"thigh.{label}", "wool", smooth=True,
        )
        create_tube(
            f"Greave.{label}",
            [((x, -0.005, 0.28), 0.125, 0.142), ((x, -0.005, 0.48), 0.14, 0.155), ((x, -0.005, 0.64), 0.155, 0.165)],
            9, f"shin.{label}", "iron", smooth=False,
        )
        for z, radius in ((0.31, 0.136), (0.48, 0.150), (0.63, 0.166)):
            create_tube(f"GreaveBand.{label}.{z}", [((x, -0.008, z - 0.022), radius, radius * 0.98), ((x, -0.008, z + 0.022), radius, radius * 0.98)], 9, f"shin.{label}", "iron_edge", smooth=False)
        create_ellipsoid(f"Knee.{label}", (x, -0.145, 0.71), (0.145, 0.055, 0.135), f"shin.{label}", "iron_edge", segments=9, rings=4)

    create_tube("Pelvis", [((0.0, 0.0, 1.00), 0.31, 0.205), ((0.0, 0.0, 1.13), 0.36, 0.225), ((0.0, 0.0, 1.27), 0.33, 0.21)], 12, "pelvis", "wool", smooth=True)
    create_tube("Belt", [((0.0, 0.0, 1.18), 0.365, 0.235), ((0.0, 0.0, 1.27), 0.365, 0.235)], 12, "pelvis", "leather", smooth=False)
    create_box("BeltBuckle", (0.14, 0.045, 0.12), (0.0, -0.248, 1.225), (0.0, 0.0, 0.0), "pelvis", "brass", bevel=0.012)

    # Torso and armor shells.
    create_tube(
        "TorsoUnderlayer",
        [((0.0, 0.0, 1.19), 0.32, 0.205), ((0.0, 0.0, 1.39), 0.36, 0.225), ((0.0, 0.0, 1.65), 0.47, 0.255), ((0.0, 0.0, 1.86), 0.50, 0.275), ((0.0, 0.0, 1.96), 0.32, 0.205)],
        12, "spine", "wool", smooth=True,
    )
    band_specs = [
        (1.28, 1.43, 0.355, 0.215), (1.42, 1.58, 0.405, 0.235),
        (1.57, 1.73, 0.455, 0.258), (1.72, 1.88, 0.505, 0.282),
    ]
    for index, (bottom, top, radius, depth) in enumerate(band_specs):
        band = create_tube(
            f"LamellarBand.{index}",
            [((0.0, 0.0, bottom), radius * 0.96, depth * 0.97), ((0.0, 0.0, top), radius, depth)],
            12, "chest" if index > 1 else "spine", "iron" if index % 2 == 0 else "iron_edge", smooth=False,
        )
    create_prism_xz("ChestTabard", [(-0.105, 0.34), (0.105, 0.34), (0.095, -0.32), (0.0, -0.38), (-0.095, -0.32)], 0.025, (0.0, -0.295, 1.58), "chest", "oxblood", bevel=0.006, curve=0.018)
    add_cloven_moon("ChestBadge", (0.0, -0.327, 1.66), 0.28, "chest", "brass")

    # Skirt plates and long cloth are large, readable shapes.
    skirt_positions = [(-0.29, -0.08, -7.0), (-0.11, -0.20, -2.0), (0.11, -0.20, 2.0), (0.29, -0.08, 7.0)]
    for index, (x, y, angle) in enumerate(skirt_positions):
        outline = [(-0.085, 0.22), (0.085, 0.22), (0.072, -0.24), (0.0, -0.285), (-0.072, -0.24)]
        obj = create_prism_xz(f"SkirtPlate.{index}", outline, 0.065, (x, y, 1.00), "pelvis", "iron", bevel=0.009)
        obj.rotation_euler.y = math.radians(angle)
    front_tabard = [(-0.17, 0.36), (0.17, 0.36), (0.155, -0.29), (0.08, -0.38), (0.0, -0.34), (-0.075, -0.40), (-0.16, -0.31)]
    create_prism_xz("FrontTabard", front_tabard, 0.026, (0.0, -0.27, 0.93), "pelvis", "oxblood", bevel=0.005, curve=0.02)
    add_cloven_moon("TabardMark", (0.0, -0.307, 0.92), 0.34, "pelvis", "bone")
    create_prism_xz("BackTabard", [(-0.16, 0.32), (0.16, 0.32), (0.13, -0.34), (0.0, -0.40), (-0.13, -0.34)], 0.025, (0.0, 0.23, 0.96), "pelvis", "oxblood_dark", bevel=0.005)

    # Long arms with articulated overlaps rather than vertical cylinders.
    for side, label in ((-1.0, "L"), (1.0, "R")):
        upper_path = [((side * 0.49, 0.0, 1.79), 0.16, 0.15), ((side * 0.60, 0.0, 1.60), 0.145, 0.135), ((side * 0.69, 0.0, 1.39), 0.118, 0.112)]
        fore_path = [((side * 0.69, 0.0, 1.38), 0.12, 0.113), ((side * 0.74, 0.0, 1.20), 0.105, 0.10), ((side * 0.78, 0.0, 1.02), 0.085, 0.082)]
        create_tube(f"UpperArm.{label}", upper_path, 9, f"upper_arm.{label}", "skin", smooth=True)
        create_tube(f"Forearm.{label}", fore_path, 9, f"forearm.{label}", "skin_dark", smooth=True)
        create_tube(
            f"Bracer.{label}",
            [((side * 0.70, -0.004, 1.36), 0.132, 0.125), ((side * 0.74, -0.004, 1.20), 0.12, 0.113), ((side * 0.77, -0.004, 1.07), 0.098, 0.094)],
            9, f"forearm.{label}", "iron", smooth=False,
        )
        for fraction, center in enumerate(((side * 0.706, -0.006, 1.34), (side * 0.742, -0.006, 1.20), (side * 0.768, -0.006, 1.075))):
            radius = (0.142, 0.13, 0.107)[fraction]
            create_tube(f"BracerBand.{label}.{fraction}", [((center[0], center[1], center[2] - 0.018), radius, radius * 0.94), ((center[0], center[1], center[2] + 0.018), radius, radius * 0.94)], 9, f"forearm.{label}", "iron_edge", smooth=False)
        add_hand(side, label, (side * 0.80, -0.01, 0.90))

        # Three overlapping shoulder lames follow the arm angle.
        for layer in range(3):
            x = side * (0.50 + layer * 0.055)
            z = 1.86 - layer * 0.070
            rotation = (0.0, side * math.radians(-9.0), side * math.radians(-17.0))
            create_box(f"ShoulderLame.{label}.{layer}", (0.30, 0.40, 0.10), (x, 0.0, z), rotation, f"upper_arm.{label}", "iron_edge" if layer == 0 else "iron", bevel=0.022)
        create_box(f"ShoulderVotive.{label}", (0.19, 0.038, 0.10), (side * 0.57, -0.23, 1.80), (0.0, side * math.radians(-8.0), side * math.radians(-15.0)), f"upper_arm.{label}", "oxblood", bevel=0.008)

    create_tube("Collar", [((0.0, 0.0, 1.88), 0.30, 0.22), ((0.0, 0.0, 2.01), 0.225, 0.17)], 12, "chest", "oxblood", smooth=False)
    add_head()
    apply_body_projection()
    add_shield()
    add_axe()

    armature = create_armature()
    body = join_parts(armature)
    create_actions(armature)
    return body, armature


def create_armature() -> bpy.types.Object:
    data = bpy.data.armatures.new("OrcLegionaryRig")
    armature = bpy.data.objects.new("OrcLegionaryRig", data)
    bpy.context.collection.objects.link(armature)
    armature.show_in_front = True
    activate(armature)
    bpy.ops.object.mode_set(mode="EDIT")
    definitions = {
        "root": ((0.0, 0.0, 0.0), (0.0, 0.0, 0.25), None),
        "pelvis": ((0.0, 0.0, 0.94), (0.0, 0.0, 1.24), "root"),
        "spine": ((0.0, 0.0, 1.24), (0.0, 0.0, 1.60), "pelvis"),
        "chest": ((0.0, 0.0, 1.60), (0.0, 0.0, 1.92), "spine"),
        "neck": ((0.0, 0.0, 1.92), (0.0, 0.0, 2.08), "chest"),
        "head": ((0.0, 0.0, 2.08), (0.0, 0.0, 2.58), "neck"),
        # The reconstructed production body is narrower than the discarded
        # procedural proxy. These pivots follow its visible shoulder, elbow and
        # wrist centers; keeping the old 0.78 wrist made held props orbit a
        # point several inches outside the hand during attacks.
        "upper_arm.L": ((-0.43, 0.0, 1.82), (-0.56, 0.0, 1.40), "chest"),
        "forearm.L": ((-0.56, 0.0, 1.40), (-0.55, 0.0, 1.03), "upper_arm.L"),
        "hand.L": ((-0.55, 0.0, 1.03), (-0.53, 0.0, 0.82), "forearm.L"),
        "upper_arm.R": ((0.43, 0.0, 1.82), (0.56, 0.0, 1.40), "chest"),
        "forearm.R": ((0.56, 0.0, 1.40), (0.55, 0.0, 1.03), "upper_arm.R"),
        "hand.R": ((0.55, 0.0, 1.03), (0.53, 0.0, 0.82), "forearm.R"),
        "thigh.L": ((-0.20, 0.0, 1.09), (-0.22, 0.0, 0.69), "pelvis"),
        "shin.L": ((-0.22, 0.0, 0.69), (-0.22, 0.0, 0.22), "thigh.L"),
        "foot.L": ((-0.22, 0.0, 0.22), (-0.22, -0.30, 0.12), "shin.L"),
        "thigh.R": ((0.20, 0.0, 1.09), (0.22, 0.0, 0.69), "pelvis"),
        "shin.R": ((0.22, 0.0, 0.69), (0.22, 0.0, 0.22), "thigh.R"),
        "foot.R": ((0.22, 0.0, 0.22), (0.22, -0.30, 0.12), "shin.R"),
    }
    created: dict[str, bpy.types.EditBone] = {}
    for name, (head, tail, parent_name) in definitions.items():
        bone = data.edit_bones.new(name)
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
    body.name = "OrcLegionaryProductionMesh"

    old_materials = [slot.material for slot in body.material_slots]
    unique: list[bpy.types.Material] = []
    for material in old_materials:
        if material not in unique:
            unique.append(material)
    old_to_new = {index: unique.index(material) for index, material in enumerate(old_materials)}
    for polygon in body.data.polygons:
        polygon.material_index = old_to_new[polygon.material_index]
    body.data.materials.clear()
    for material in unique:
        body.data.materials.append(material)

    modifier = body.modifiers.new("OrcLegionaryRig", "ARMATURE")
    modifier.object = armature
    body.parent = armature
    return body


def key_action(
    armature: bpy.types.Object,
    name: str,
    end_frame: int,
    poses: list[tuple[int, dict[str, tuple[tuple[float, float, float], tuple[float, float, float]]]]],
) -> bpy.types.Action:
    action = bpy.data.actions.new(name)
    armature.animation_data_create()
    armature.animation_data.action = action
    for frame, values in poses:
        for pose_bone in armature.pose.bones:
            pose_bone.rotation_mode = "XYZ"
            pose_bone.rotation_euler = Euler((0.0, 0.0, 0.0))
            pose_bone.location = Vector((0.0, 0.0, 0.0))
        for bone_name, (rotation, location) in values.items():
            pose_bone = armature.pose.bones[bone_name]
            pose_bone.rotation_euler = Euler(tuple(math.radians(value) for value in rotation))
            pose_bone.location = Vector(location)
        for pose_bone in armature.pose.bones:
            pose_bone.keyframe_insert(data_path="rotation_euler", frame=frame, group=pose_bone.name)
            pose_bone.keyframe_insert(data_path="location", frame=frame, group=pose_bone.name)
    action.frame_start = 1
    action.frame_end = end_frame
    for curve in action.fcurves:
        for point in curve.keyframe_points:
            point.interpolation = "BEZIER"
            point.handle_left_type = "AUTO_CLAMPED"
            point.handle_right_type = "AUTO_CLAMPED"
    armature.animation_data.action = None
    return action


def _aim_bone(pose_bone: bpy.types.PoseBone, head: Vector, tail: Vector, pole: Vector) -> None:
    y_axis = (tail - head).normalized()
    pole_axis = pole - head
    pole_axis -= y_axis * pole_axis.dot(y_axis)
    if pole_axis.length < 0.0001:
        pole_axis = Vector((0.0, 0.0, 1.0))
        pole_axis -= y_axis * pole_axis.dot(y_axis)
    z_axis = pole_axis.normalized()
    x_axis = y_axis.cross(z_axis).normalized()
    z_axis = x_axis.cross(y_axis).normalized()
    matrix = Matrix((x_axis, y_axis, z_axis)).transposed().to_4x4()
    matrix.translation = head
    pose_bone.rotation_mode = "QUATERNION"
    pose_bone.matrix = matrix


def _solve_arm(
    armature: bpy.types.Object,
    side: str,
    wrist: tuple[float, float, float],
    pole: tuple[float, float, float],
    hand_rotation: tuple[float, float, float],
) -> None:
    upper = armature.pose.bones[f"upper_arm.{side}"]
    forearm = armature.pose.bones[f"forearm.{side}"]
    hand = armature.pose.bones[f"hand.{side}"]
    shoulder = upper.head.copy()
    target = Vector(wrist)
    pole_point = Vector(pole)
    direction = target - shoulder
    distance = max(0.0001, direction.length)
    direction.normalize()
    first = upper.length
    second = forearm.length
    reachable = min(distance, first + second - 0.001)
    target = shoulder + direction * reachable
    along = (first * first - second * second + reachable * reachable) / (2.0 * reachable)
    height = math.sqrt(max(0.0, first * first - along * along))
    bend = pole_point - shoulder
    bend -= direction * bend.dot(direction)
    if bend.length < 0.0001:
        bend = Vector((1.0 if side == "R" else -1.0, 0.0, 0.0))
    bend.normalize()
    elbow = shoulder + direction * along + bend * height
    _aim_bone(upper, shoulder, elbow, pole_point)
    bpy.context.view_layer.update()
    _aim_bone(forearm, forearm.head.copy(), target, pole_point)
    bpy.context.view_layer.update()
    rest_rotation = hand.bone.matrix_local.to_quaternion()
    offset = Euler(tuple(math.radians(value) for value in hand_rotation)).to_quaternion()
    hand_matrix = (offset @ rest_rotation).to_matrix().to_4x4()
    hand_matrix.translation = hand.head.copy()
    hand.rotation_mode = "QUATERNION"
    hand.matrix = hand_matrix


def key_ik_action(
    armature: bpy.types.Object,
    name: str,
    end_frame: int,
    poses: list[
        tuple[
            int,
            dict[str, tuple[tuple[float, float, float], tuple[float, float, float]]],
            tuple[tuple[float, float, float], tuple[float, float, float], tuple[float, float, float]],
            tuple[tuple[float, float, float], tuple[float, float, float], tuple[float, float, float]],
        ]
    ],
) -> bpy.types.Action:
    action = bpy.data.actions.new(name)
    armature.animation_data_create()
    armature.animation_data.action = None
    solved = {"upper_arm.L", "forearm.L", "hand.L", "upper_arm.R", "forearm.R", "hand.R"}
    arm_bones = set(solved)
    for frame, values, right_arm, left_arm in poses:
        armature.animation_data.action = None
        bpy.context.scene.frame_set(frame)
        for pose_bone in armature.pose.bones:
            pose_bone.rotation_mode = "XYZ"
            pose_bone.rotation_euler = Euler((0.0, 0.0, 0.0))
            pose_bone.location = Vector((0.0, 0.0, 0.0))
        for bone_name, (rotation, location) in values.items():
            if bone_name in arm_bones:
                continue
            pose_bone = armature.pose.bones[bone_name]
            pose_bone.rotation_euler = Euler(tuple(math.radians(value) for value in rotation))
            pose_bone.location = Vector(location)
        bpy.context.view_layer.update()
        _solve_arm(armature, "R", *right_arm)
        _solve_arm(armature, "L", *left_arm)
        bpy.context.view_layer.update()
        for bone_name in solved:
            pose_bone = armature.pose.bones[bone_name]
            solved_rotation = pose_bone.rotation_quaternion.copy()
            pose_bone.rotation_mode = "XYZ"
            pose_bone.rotation_euler = solved_rotation.to_euler("XYZ")
        captured = {}
        for pose_bone in armature.pose.bones:
            captured[pose_bone.name] = (
                pose_bone.rotation_euler.copy(),
                pose_bone.location.copy(),
            )
        armature.animation_data.action = action
        for pose_bone in armature.pose.bones:
            rotation, location = captured[pose_bone.name]
            pose_bone.rotation_mode = "XYZ"
            pose_bone.rotation_euler = rotation
            pose_bone.location = location
            pose_bone.keyframe_insert(data_path="rotation_euler", frame=frame, group=pose_bone.name)
            pose_bone.keyframe_insert(data_path="location", frame=frame, group=pose_bone.name)
    action.frame_start = 1
    action.frame_end = end_frame
    for curve in action.fcurves:
        for point in curve.keyframe_points:
            point.interpolation = "BEZIER"
            point.handle_left_type = "AUTO_CLAMPED"
            point.handle_right_type = "AUTO_CLAMPED"
    armature.animation_data.action = None
    return action


def create_actions_rejected(armature: bpy.types.Object) -> None:
    neutral: dict[str, tuple[tuple[float, float, float], tuple[float, float, float]]] = {}
    key_action(armature, "Idle", 48, [
        (1, neutral),
        (24, {"pelvis": ((0.0, 0.0, -0.8), (0.0, 0.0, -0.010)), "chest": ((1.8, 0.0, 1.2), (0.0, 0.0, 0.018)), "head": ((-1.0, 0.0, -2.5), (0.0, 0.0, 0.0))}),
        (48, neutral),
    ])
    walk_left = {
        "pelvis": ((0.0, -2.0, -3.0), (0.0, 0.0, 0.008)), "chest": ((2.0, 0.0, 4.0), (0.0, 0.0, 0.0)),
        "upper_arm.L": ((-12.0, 8.0, -10.0), (0.0, 0.0, 0.0)), "forearm.L": ((-20.0, 0.0, 0.0), (0.0, 0.0, 0.0)),
        "upper_arm.R": ((20.0, 0.0, 7.0), (0.0, 0.0, 0.0)), "forearm.R": ((-10.0, 0.0, 0.0), (0.0, 0.0, 0.0)),
        "thigh.L": ((28.0, 0.0, 0.0), (0.0, 0.0, 0.0)), "shin.L": ((-12.0, 0.0, 0.0), (0.0, 0.0, 0.0)), "foot.L": ((8.0, 0.0, 0.0), (0.0, 0.0, 0.0)),
        "thigh.R": ((-23.0, 0.0, 0.0), (0.0, 0.0, 0.0)), "shin.R": ((24.0, 0.0, 0.0), (0.0, 0.0, 0.0)),
    }
    walk_right = {
        "pelvis": ((0.0, 2.0, 3.0), (0.0, 0.0, 0.008)), "chest": ((2.0, 0.0, -4.0), (0.0, 0.0, 0.0)),
        "upper_arm.L": ((10.0, 8.0, -8.0), (0.0, 0.0, 0.0)), "forearm.L": ((-16.0, 0.0, 0.0), (0.0, 0.0, 0.0)),
        "upper_arm.R": ((-24.0, 0.0, -5.0), (0.0, 0.0, 0.0)), "forearm.R": ((-8.0, 0.0, 0.0), (0.0, 0.0, 0.0)),
        "thigh.L": ((-23.0, 0.0, 0.0), (0.0, 0.0, 0.0)), "shin.L": ((24.0, 0.0, 0.0), (0.0, 0.0, 0.0)),
        "thigh.R": ((28.0, 0.0, 0.0), (0.0, 0.0, 0.0)), "shin.R": ((-12.0, 0.0, 0.0), (0.0, 0.0, 0.0)), "foot.R": ((8.0, 0.0, 0.0), (0.0, 0.0, 0.0)),
    }
    key_action(armature, "Walk", 28, [
        (1, walk_left),
        (8, {"pelvis": ((0.0, 0.0, 0.0), (0.0, 0.0, -0.035)), "chest": ((3.0, 0.0, 0.0), (0.0, 0.0, 0.0)), "thigh.L": ((4.0, 0.0, 0.0), (0.0, 0.0, 0.0)), "shin.L": ((20.0, 0.0, 0.0), (0.0, 0.0, 0.0)), "thigh.R": ((-4.0, 0.0, 0.0), (0.0, 0.0, 0.0)), "shin.R": ((12.0, 0.0, 0.0), (0.0, 0.0, 0.0))}),
        (15, walk_right),
        (22, {"pelvis": ((0.0, 0.0, 0.0), (0.0, 0.0, -0.035)), "chest": ((3.0, 0.0, 0.0), (0.0, 0.0, 0.0)), "thigh.L": ((-4.0, 0.0, 0.0), (0.0, 0.0, 0.0)), "shin.L": ((12.0, 0.0, 0.0), (0.0, 0.0, 0.0)), "thigh.R": ((4.0, 0.0, 0.0), (0.0, 0.0, 0.0)), "shin.R": ((20.0, 0.0, 0.0), (0.0, 0.0, 0.0))}),
        (28, walk_left),
    ])
    run_left = {
        "pelvis": ((5.0, -3.0, -4.0), (0.0, 0.0, 0.035)), "chest": ((12.0, 0.0, 5.0), (0.0, -0.015, 0.0)),
        "upper_arm.L": ((-18.0, 12.0, -16.0), (0.0, 0.0, 0.0)), "forearm.L": ((-28.0, 0.0, 0.0), (0.0, 0.0, 0.0)),
        "upper_arm.R": ((34.0, 0.0, 10.0), (0.0, 0.0, 0.0)), "forearm.R": ((-22.0, 0.0, 0.0), (0.0, 0.0, 0.0)),
        "thigh.L": ((42.0, 0.0, 0.0), (0.0, 0.0, 0.0)), "shin.L": ((-18.0, 0.0, 0.0), (0.0, 0.0, 0.0)),
        "thigh.R": ((-36.0, 0.0, 0.0), (0.0, 0.0, 0.0)), "shin.R": ((38.0, 0.0, 0.0), (0.0, 0.0, 0.0)),
    }
    run_right = {
        "pelvis": ((5.0, 3.0, 4.0), (0.0, 0.0, 0.035)), "chest": ((12.0, 0.0, -5.0), (0.0, -0.015, 0.0)),
        "upper_arm.L": ((14.0, 12.0, -12.0), (0.0, 0.0, 0.0)), "forearm.L": ((-24.0, 0.0, 0.0), (0.0, 0.0, 0.0)),
        "upper_arm.R": ((-40.0, 0.0, -8.0), (0.0, 0.0, 0.0)), "forearm.R": ((-18.0, 0.0, 0.0), (0.0, 0.0, 0.0)),
        "thigh.L": ((-36.0, 0.0, 0.0), (0.0, 0.0, 0.0)), "shin.L": ((38.0, 0.0, 0.0), (0.0, 0.0, 0.0)),
        "thigh.R": ((42.0, 0.0, 0.0), (0.0, 0.0, 0.0)), "shin.R": ((-18.0, 0.0, 0.0), (0.0, 0.0, 0.0)),
    }
    key_action(armature, "Run", 20, [
        (1, run_left),
        (6, {"pelvis": ((7.0, 0.0, 0.0), (0.0, 0.0, -0.055)), "chest": ((13.0, 0.0, 0.0), (0.0, -0.020, 0.0)), "thigh.L": ((5.0, 0.0, 0.0), (0.0, 0.0, 0.0)), "shin.L": ((30.0, 0.0, 0.0), (0.0, 0.0, 0.0)), "thigh.R": ((-5.0, 0.0, 0.0), (0.0, 0.0, 0.0)), "shin.R": ((18.0, 0.0, 0.0), (0.0, 0.0, 0.0))}),
        (11, run_right),
        (16, {"pelvis": ((7.0, 0.0, 0.0), (0.0, 0.0, -0.055)), "chest": ((13.0, 0.0, 0.0), (0.0, -0.020, 0.0)), "thigh.L": ((-5.0, 0.0, 0.0), (0.0, 0.0, 0.0)), "shin.L": ((18.0, 0.0, 0.0), (0.0, 0.0, 0.0)), "thigh.R": ((5.0, 0.0, 0.0), (0.0, 0.0, 0.0)), "shin.R": ((30.0, 0.0, 0.0), (0.0, 0.0, 0.0))}),
        (20, run_left),
    ])
    key_action(armature, "AxeAttack", 32, [
        (1, neutral),
        (8, {"root": ((0.0, 0.0, 0.0), (0.0, 0.08, -0.070)), "pelvis": ((-4.0, 0.0, -10.0), (0.0, 0.0, 0.0)), "chest": ((-5.0, 0.0, -18.0), (0.0, 0.0, 0.0)), "head": ((2.0, 0.0, 10.0), (0.0, 0.0, 0.0)), "upper_arm.R": ((88.0, 18.0, 20.0), (0.0, 0.0, 0.0)), "forearm.R": ((-42.0, 0.0, 10.0), (0.0, 0.0, 0.0)), "hand.R": ((110.0, 0.0, 0.0), (0.0, 0.0, 0.0)), "upper_arm.L": ((-18.0, 14.0, -16.0), (0.0, 0.0, 0.0)), "forearm.L": ((-22.0, 0.0, 0.0), (0.0, 0.0, 0.0))}),
        (13, {"root": ((0.0, 0.0, 0.0), (0.0, 0.12, -0.090)), "pelvis": ((-6.0, 0.0, -14.0), (0.0, 0.0, 0.0)), "chest": ((-8.0, 0.0, -24.0), (0.0, 0.0, 0.0)), "head": ((3.0, 0.0, 14.0), (0.0, 0.0, 0.0)), "upper_arm.R": ((118.0, 20.0, 24.0), (0.0, 0.0, 0.0)), "forearm.R": ((-52.0, 0.0, 12.0), (0.0, 0.0, 0.0)), "hand.R": ((165.0, 0.0, 0.0), (0.0, 0.0, 0.0)), "upper_arm.L": ((-22.0, 16.0, -18.0), (0.0, 0.0, 0.0)), "forearm.L": ((-26.0, 0.0, 0.0), (0.0, 0.0, 0.0))}),
        (15, {"root": ((0.0, 0.0, 0.0), (0.0, -0.18, -0.035)), "pelvis": ((7.0, 0.0, 12.0), (0.0, 0.0, 0.0)), "chest": ((12.0, 0.0, 24.0), (0.0, -0.035, 0.0)), "head": ((-4.0, 0.0, -10.0), (0.0, 0.0, 0.0)), "upper_arm.R": ((-70.0, -15.0, -18.0), (0.0, 0.0, 0.0)), "forearm.R": ((26.0, 0.0, -10.0), (0.0, 0.0, 0.0)), "upper_arm.L": ((-12.0, 18.0, -12.0), (0.0, 0.0, 0.0)), "forearm.L": ((-18.0, 0.0, 0.0), (0.0, 0.0, 0.0)), "thigh.L": ((-6.0, 0.0, 0.0), (0.0, 0.0, 0.0)), "thigh.R": ((8.0, 0.0, 0.0), (0.0, 0.0, 0.0))}),
        (20, {"root": ((0.0, 0.0, 0.0), (0.0, -0.10, -0.010)), "pelvis": ((5.0, 0.0, 14.0), (0.0, 0.0, 0.0)), "chest": ((14.0, 0.0, 30.0), (0.0, -0.025, 0.0)), "upper_arm.R": ((-52.0, -12.0, -22.0), (0.0, 0.0, 0.0)), "forearm.R": ((30.0, 0.0, -14.0), (0.0, 0.0, 0.0)), "upper_arm.L": ((-8.0, 12.0, -8.0), (0.0, 0.0, 0.0))}),
        (26, {"root": ((0.0, 0.0, 0.0), (0.0, -0.025, 0.0)), "chest": ((5.0, 0.0, 8.0), (0.0, 0.0, 0.0)), "upper_arm.R": ((-12.0, -4.0, -8.0), (0.0, 0.0, 0.0)), "forearm.R": ((8.0, 0.0, -4.0), (0.0, 0.0, 0.0))}),
        (32, neutral),
    ])
    key_action(armature, "ShieldBash", 28, [
        (1, neutral),
        (7, {"root": ((0.0, 0.0, 0.0), (0.0, 0.07, -0.035)), "pelvis": ((-5.0, 0.0, 10.0), (0.0, 0.0, 0.0)), "chest": ((-5.0, 0.0, 14.0), (0.0, 0.0, 0.0)), "head": ((2.0, 0.0, -8.0), (0.0, 0.0, 0.0)), "upper_arm.L": ((12.0, 22.0, -20.0), (0.0, 0.0, 0.0)), "forearm.L": ((-18.0, 0.0, 0.0), (0.0, 0.0, 0.0)), "upper_arm.R": ((18.0, 0.0, 10.0), (0.0, 0.0, 0.0)), "forearm.R": ((-18.0, 0.0, 0.0), (0.0, 0.0, 0.0))}),
        (11, {"root": ((0.0, 0.0, 0.0), (0.0, 0.10, -0.085)), "pelvis": ((-7.0, 0.0, 14.0), (0.0, 0.0, 0.0)), "chest": ((-7.0, 0.0, 20.0), (0.0, 0.0, 0.0)), "upper_arm.L": ((18.0, 24.0, -24.0), (0.0, 0.0, 0.0)), "forearm.L": ((-22.0, 0.0, 0.0), (0.0, 0.0, 0.0)), "upper_arm.R": ((22.0, 0.0, 12.0), (0.0, 0.0, 0.0))}),
        (13, {"root": ((0.0, 0.0, 0.0), (0.0, -0.24, -0.035)), "pelvis": ((10.0, 0.0, -14.0), (0.0, 0.0, 0.0)), "chest": ((10.0, 0.0, -18.0), (0.0, -0.045, 0.0)), "head": ((-5.0, 0.0, 10.0), (0.0, 0.0, 0.0)), "upper_arm.L": ((-58.0, -18.0, 18.0), (0.0, 0.0, 0.0)), "forearm.L": ((18.0, 0.0, 0.0), (0.0, 0.0, 0.0)), "upper_arm.R": ((-24.0, 0.0, -14.0), (0.0, 0.0, 0.0)), "forearm.R": ((18.0, 0.0, 0.0), (0.0, 0.0, 0.0)), "thigh.L": ((-8.0, 0.0, 0.0), (0.0, 0.0, 0.0)), "thigh.R": ((10.0, 0.0, 0.0), (0.0, 0.0, 0.0))}),
        (18, {"root": ((0.0, 0.0, 0.0), (0.0, -0.12, -0.025)), "pelvis": ((6.0, 0.0, -10.0), (0.0, 0.0, 0.0)), "chest": ((8.0, 0.0, -14.0), (0.0, -0.025, 0.0)), "upper_arm.L": ((-36.0, -12.0, 14.0), (0.0, 0.0, 0.0)), "forearm.L": ((12.0, 0.0, 0.0), (0.0, 0.0, 0.0))}),
        (28, neutral),
    ])
    key_action(armature, "Hit", 18, [
        (1, neutral),
        (4, {"root": ((0.0, 0.0, 0.0), (0.0, 0.11, 0.010)), "pelvis": ((-8.0, 0.0, -10.0), (0.0, 0.0, 0.0)), "chest": ((-20.0, 0.0, -20.0), (0.0, 0.045, 0.0)), "head": ((16.0, 0.0, 14.0), (0.0, 0.0, 0.0)), "upper_arm.L": ((24.0, -12.0, 16.0), (0.0, 0.0, 0.0)), "forearm.L": ((12.0, 0.0, 0.0), (0.0, 0.0, 0.0)), "upper_arm.R": ((-30.0, 8.0, -18.0), (0.0, 0.0, 0.0)), "forearm.R": ((-16.0, 0.0, 0.0), (0.0, 0.0, 0.0)), "thigh.L": ((-12.0, 0.0, 0.0), (0.0, 0.0, 0.0)), "shin.R": ((18.0, 0.0, 0.0), (0.0, 0.0, 0.0))}),
        (7, {"root": ((0.0, 0.0, 0.0), (0.0, 0.17, -0.035)), "pelvis": ((-10.0, 0.0, -14.0), (0.0, 0.0, 0.0)), "chest": ((-26.0, 0.0, -24.0), (0.0, 0.060, 0.0)), "head": ((20.0, 0.0, 18.0), (0.0, 0.0, 0.0)), "upper_arm.L": ((30.0, -14.0, 20.0), (0.0, 0.0, 0.0)), "upper_arm.R": ((-36.0, 10.0, -22.0), (0.0, 0.0, 0.0)), "thigh.L": ((-16.0, 0.0, 0.0), (0.0, 0.0, 0.0)), "shin.R": ((24.0, 0.0, 0.0), (0.0, 0.0, 0.0))}),
        (12, {"root": ((0.0, 0.0, 0.0), (0.0, 0.06, -0.010)), "chest": ((-8.0, 0.0, -6.0), (0.0, 0.015, 0.0)), "head": ((6.0, 0.0, 4.0), (0.0, 0.0, 0.0))}),
        (18, neutral),
    ])
    key_action(armature, "Death", 44, [
        (1, neutral),
        (7, {"root": ((0.0, 0.0, 0.0), (0.0, 0.10, 0.0)), "chest": ((-24.0, 0.0, 12.0), (0.0, 0.0, 0.0)), "head": ((20.0, 0.0, -14.0), (0.0, 0.0, 0.0)), "upper_arm.L": ((18.0, 0.0, 12.0), (0.0, 0.0, 0.0)), "upper_arm.R": ((-22.0, 0.0, -14.0), (0.0, 0.0, 0.0))}),
        (15, {"root": ((10.0, 0.0, 0.0), (0.0, 0.20, -0.08)), "pelvis": ((-18.0, 0.0, 8.0), (0.0, 0.0, 0.0)), "chest": ((-32.0, 0.0, 16.0), (0.0, 0.0, 0.0)), "head": ((24.0, 0.0, -18.0), (0.0, 0.0, 0.0)), "thigh.L": ((-26.0, 0.0, 0.0), (0.0, 0.0, 0.0)), "shin.L": ((38.0, 0.0, 0.0), (0.0, 0.0, 0.0)), "thigh.R": ((-14.0, 0.0, 0.0), (0.0, 0.0, 0.0)), "shin.R": ((28.0, 0.0, 0.0), (0.0, 0.0, 0.0))}),
        (23, {"root": ((38.0, 0.0, 0.0), (0.0, 0.24, -0.18)), "pelvis": ((-20.0, 0.0, 8.0), (0.0, 0.0, 0.0)), "chest": ((-34.0, 0.0, 14.0), (0.0, 0.0, 0.0)), "head": ((28.0, 0.0, -16.0), (0.0, 0.0, 0.0)), "upper_arm.L": ((26.0, 0.0, 18.0), (0.0, 0.0, 0.0)), "upper_arm.R": ((-30.0, 0.0, -20.0), (0.0, 0.0, 0.0)), "thigh.L": ((-34.0, 0.0, 0.0), (0.0, 0.0, 0.0)), "shin.L": ((48.0, 0.0, 0.0), (0.0, 0.0, 0.0)), "thigh.R": ((-24.0, 0.0, 0.0), (0.0, 0.0, 0.0)), "shin.R": ((42.0, 0.0, 0.0), (0.0, 0.0, 0.0))}),
        (31, {"root": ((82.0, 0.0, 0.0), (0.0, 0.14, 0.06)), "chest": ((-18.0, 0.0, 10.0), (0.0, 0.0, 0.0)), "head": ((22.0, 0.0, -12.0), (0.0, 0.0, 0.0)), "upper_arm.L": ((30.0, 0.0, 20.0), (0.0, 0.0, 0.0)), "upper_arm.R": ((-34.0, 0.0, -24.0), (0.0, 0.0, 0.0))}),
        (44, {"root": ((88.0, 0.0, 0.0), (0.0, 0.10, 0.05)), "chest": ((-12.0, 0.0, 8.0), (0.0, 0.0, 0.0)), "head": ((18.0, 0.0, -10.0), (0.0, 0.0, 0.0)), "upper_arm.L": ((32.0, 0.0, 22.0), (0.0, 0.0, 0.0)), "upper_arm.R": ((-36.0, 0.0, -26.0), (0.0, 0.0, 0.0))}),
    ])


def create_actions(armature: bpy.types.Object) -> None:
    """Author compact, grounded combat motion around one persistent guard."""

    def pose(
        base: dict[str, tuple[tuple[float, float, float], tuple[float, float, float]]],
        **overrides: tuple[tuple[float, float, float], tuple[float, float, float]],
    ) -> dict[str, tuple[tuple[float, float, float], tuple[float, float, float]]]:
        return {**base, **overrides}

    guard = {
        "spine": ((2.0, 0.0, 0.0), (0.0, 0.0, 0.0)),
        "chest": ((-2.0, 0.0, 0.0), (0.0, -0.005, 0.0)),
        "head": ((1.0, 0.0, 0.0), (0.0, 0.0, 0.0)),
        "upper_arm.L": ((-40.0, -8.0, 10.0), (0.0, 0.0, 0.0)),
        "forearm.L": ((5.0, 0.0, 0.0), (0.0, 0.0, 0.0)),
        "upper_arm.R": ((10.0, -3.0, 6.0), (0.0, 0.0, 0.0)),
        "forearm.R": ((-16.0, 0.0, 0.0), (0.0, 0.0, 0.0)),
        "hand.R": ((18.0, 0.0, 0.0), (0.0, 0.0, 0.0)),
    }

    key_action(armature, "Idle", 60, [
        (1, guard),
        (30, pose(
            guard,
            pelvis=((0.0, 0.0, -0.7), (0.0, 0.0, -0.008)),
            chest=((-0.5, 0.0, 1.0), (0.0, -0.004, 0.008)),
            head=((0.0, 0.0, -1.5), (0.0, 0.0, 0.0)),
        )),
        (60, guard),
    ])

    # Blender bone names contain dots, so locomotion frames use dictionary
    # merges rather than keyword overrides.
    walk_left = {**guard,
        "pelvis": ((0.0, -1.0, -2.0), (0.0, 0.0, 0.005)),
        "chest": ((0.0, 0.0, 2.5), (0.0, -0.005, 0.0)),
        "thigh.L": ((24.0, 0.0, 0.0), (0.0, 0.0, 0.0)),
        "shin.L": ((-9.0, 0.0, 0.0), (0.0, 0.0, 0.0)),
        "foot.L": ((5.0, 0.0, 0.0), (0.0, 0.0, 0.0)),
        "thigh.R": ((-18.0, 0.0, 0.0), (0.0, 0.0, 0.0)),
        "shin.R": ((21.0, 0.0, 0.0), (0.0, 0.0, 0.0)),
        "foot.R": ((-5.0, 0.0, 0.0), (0.0, 0.0, 0.0)),
    }
    walk_right = {**guard,
        "pelvis": ((0.0, 1.0, 2.0), (0.0, 0.0, 0.005)),
        "chest": ((0.0, 0.0, -2.5), (0.0, -0.005, 0.0)),
        "thigh.L": ((-18.0, 0.0, 0.0), (0.0, 0.0, 0.0)),
        "shin.L": ((21.0, 0.0, 0.0), (0.0, 0.0, 0.0)),
        "foot.L": ((-5.0, 0.0, 0.0), (0.0, 0.0, 0.0)),
        "thigh.R": ((24.0, 0.0, 0.0), (0.0, 0.0, 0.0)),
        "shin.R": ((-9.0, 0.0, 0.0), (0.0, 0.0, 0.0)),
        "foot.R": ((5.0, 0.0, 0.0), (0.0, 0.0, 0.0)),
    }
    walk_pass_left = {**guard,
        "pelvis": ((0.0, 0.0, 0.0), (0.0, 0.0, -0.025)),
        "thigh.L": ((-3.0, 0.0, 0.0), (0.0, 0.0, 0.0)),
        "shin.L": ((24.0, 0.0, 0.0), (0.0, 0.0, 0.0)),
        "foot.L": ((-8.0, 0.0, 0.0), (0.0, 0.0, 0.0)),
        "thigh.R": ((5.0, 0.0, 0.0), (0.0, 0.0, 0.0)),
        "shin.R": ((8.0, 0.0, 0.0), (0.0, 0.0, 0.0)),
    }
    walk_pass_right = {**guard,
        "pelvis": ((0.0, 0.0, 0.0), (0.0, 0.0, -0.025)),
        "thigh.L": ((5.0, 0.0, 0.0), (0.0, 0.0, 0.0)),
        "shin.L": ((8.0, 0.0, 0.0), (0.0, 0.0, 0.0)),
        "thigh.R": ((-3.0, 0.0, 0.0), (0.0, 0.0, 0.0)),
        "shin.R": ((24.0, 0.0, 0.0), (0.0, 0.0, 0.0)),
        "foot.R": ((-8.0, 0.0, 0.0), (0.0, 0.0, 0.0)),
    }
    key_action(armature, "Walk", 32, [
        (1, walk_left), (9, walk_pass_left), (17, walk_right),
        (25, walk_pass_right), (32, walk_left),
    ])

    run_left = {**walk_left,
        "pelvis": ((4.0, -2.0, -3.0), (0.0, -0.010, 0.025)),
        "chest": ((8.0, 0.0, 3.0), (0.0, -0.015, 0.0)),
        "thigh.L": ((36.0, 0.0, 0.0), (0.0, 0.0, 0.0)),
        "shin.L": ((-12.0, 0.0, 0.0), (0.0, 0.0, 0.0)),
        "thigh.R": ((-29.0, 0.0, 0.0), (0.0, 0.0, 0.0)),
        "shin.R": ((34.0, 0.0, 0.0), (0.0, 0.0, 0.0)),
    }
    run_right = {**walk_right,
        "pelvis": ((4.0, 2.0, 3.0), (0.0, -0.010, 0.025)),
        "chest": ((8.0, 0.0, -3.0), (0.0, -0.015, 0.0)),
        "thigh.L": ((-29.0, 0.0, 0.0), (0.0, 0.0, 0.0)),
        "shin.L": ((34.0, 0.0, 0.0), (0.0, 0.0, 0.0)),
        "thigh.R": ((36.0, 0.0, 0.0), (0.0, 0.0, 0.0)),
        "shin.R": ((-12.0, 0.0, 0.0), (0.0, 0.0, 0.0)),
    }
    run_pass_left = {**walk_pass_left,
        "pelvis": ((7.0, 0.0, 0.0), (0.0, -0.018, -0.045)),
        "chest": ((9.0, 0.0, 0.0), (0.0, -0.018, 0.0)),
        "shin.L": ((32.0, 0.0, 0.0), (0.0, 0.0, 0.0)),
    }
    run_pass_right = {**walk_pass_right,
        "pelvis": ((7.0, 0.0, 0.0), (0.0, -0.018, -0.045)),
        "chest": ((9.0, 0.0, 0.0), (0.0, -0.018, 0.0)),
        "shin.R": ((32.0, 0.0, 0.0), (0.0, 0.0, 0.0)),
    }
    key_action(armature, "Run", 24, [
        (1, run_left), (7, run_pass_left), (13, run_right),
        (19, run_pass_right), (24, run_left),
    ])

    # Keep the torso nearly rigid. The old version tried to manufacture force
    # with opposing spine bends; in the game camera that read as a rubber doll.
    # The strike now gets its force from a high weapon load, a short step and a
    # clean diagonal hand path across the body.
    axe_windup = {**guard,
        "root": ((0.0, 0.0, 0.0), (0.0, 0.045, 0.0)),
        "pelvis": ((-2.0, 0.0, 0.0), (0.0, 0.0, -0.010)),
        "spine": ((-2.0, 0.0, 0.0), (0.0, 0.0, 0.0)),
        "chest": ((-4.0, 0.0, 0.0), (0.0, 0.0, 0.0)),
        "head": ((3.0, 0.0, 0.0), (0.0, 0.0, 0.0)),
        "thigh.L": ((5.0, 0.0, 0.0), (0.0, 0.0, 0.0)),
        "shin.L": ((-5.0, 0.0, 0.0), (0.0, 0.0, 0.0)),
        "thigh.R": ((-3.0, 0.0, 0.0), (0.0, 0.0, 0.0)),
        "shin.R": ((7.0, 0.0, 0.0), (0.0, 0.0, 0.0)),
    }
    axe_impact = {**guard,
        "root": ((0.0, 0.0, 0.0), (0.0, -0.19, 0.0)),
        "pelvis": ((5.0, 0.0, 0.0), (0.0, 0.0, -0.018)),
        "spine": ((7.0, 0.0, 0.0), (0.0, 0.0, 0.0)),
        "chest": ((11.0, 0.0, 0.0), (0.0, -0.020, 0.0)),
        "head": ((-5.0, 0.0, 0.0), (0.0, 0.0, 0.0)),
        "thigh.L": ((-4.0, 0.0, 0.0), (0.0, 0.0, 0.0)),
        "shin.L": ((8.0, 0.0, 0.0), (0.0, 0.0, 0.0)),
        "thigh.R": ((6.0, 0.0, 0.0), (0.0, 0.0, 0.0)),
        "shin.R": ((-4.0, 0.0, 0.0), (0.0, 0.0, 0.0)),
    }
    axe_follow = {**axe_impact,
        "root": ((0.0, 0.0, 0.0), (0.0, -0.11, 0.0)),
        "spine": ((5.0, 0.0, 0.0), (0.0, 0.0, 0.0)),
        "chest": ((7.0, 0.0, 0.0), (0.0, -0.010, 0.0)),
    }
    right_guard = ((0.54, -0.05, 1.03), (0.92, -0.18, 1.42), (18.0, 0.0, 0.0))
    left_guard = ((-0.54, -0.38, 1.38), (-1.08, -0.10, 1.48), (0.0, 0.0, 0.0))
    right_windup = ((0.68, 0.02, 2.10), (1.16, -0.22, 1.72), (162.0, 0.0, 0.0))
    right_impact = ((0.08, -0.58, 1.22), (0.98, -0.26, 1.40), (22.0, 0.0, 0.0))
    right_follow = ((-0.02, -0.46, 1.02), (0.92, -0.25, 1.28), (12.0, 0.0, 0.0))
    key_ik_action(armature, "AxeAttack", 36, [
        (1, guard, right_guard, left_guard),
        (8, axe_windup, right_windup, left_guard),
        (13, axe_windup, right_windup, left_guard),
        (16, axe_impact, right_impact, left_guard),
        (21, axe_follow, right_follow, left_guard),
        (29, guard, right_guard, left_guard),
        (36, guard, right_guard, left_guard),
    ])

    shield_windup = {**guard,
        "root": ((0.0, 0.0, 0.0), (0.0, 0.04, 0.0)),
        "pelvis": ((-2.0, 0.0, 0.0), (0.0, 0.0, -0.008)),
        "chest": ((-3.0, 0.0, 0.0), (0.0, 0.0, 0.0)),
        "thigh.L": ((4.0, 0.0, 0.0), (0.0, 0.0, 0.0)),
        "shin.L": ((-5.0, 0.0, 0.0), (0.0, 0.0, 0.0)),
        "thigh.R": ((-3.0, 0.0, 0.0), (0.0, 0.0, 0.0)),
        "shin.R": ((7.0, 0.0, 0.0), (0.0, 0.0, 0.0)),
    }
    shield_impact = {**guard,
        "root": ((0.0, 0.0, 0.0), (0.0, -0.21, 0.0)),
        "pelvis": ((5.0, 0.0, 0.0), (0.0, 0.0, -0.015)),
        "spine": ((6.0, 0.0, 0.0), (0.0, 0.0, 0.0)),
        "chest": ((9.0, 0.0, 0.0), (0.0, -0.018, 0.0)),
        "head": ((-4.0, 0.0, 0.0), (0.0, 0.0, 0.0)),
        "thigh.L": ((-4.0, 0.0, 0.0), (0.0, 0.0, 0.0)),
        "shin.L": ((8.0, 0.0, 0.0), (0.0, 0.0, 0.0)),
        "thigh.R": ((6.0, 0.0, 0.0), (0.0, 0.0, 0.0)),
        "shin.R": ((-5.0, 0.0, 0.0), (0.0, 0.0, 0.0)),
    }
    shield_follow = {**shield_impact,
        "root": ((0.0, 0.0, 0.0), (0.0, -0.11, 0.0)),
        "spine": ((4.0, 0.0, 0.0), (0.0, 0.0, 0.0)),
        "chest": ((6.0, 0.0, 0.0), (0.0, -0.010, 0.0)),
    }
    left_windup = ((-0.62, 0.04, 1.28), (-1.05, -0.24, 1.46), (0.0, 0.0, 0.0))
    left_impact = ((-0.16, -0.58, 1.42), (-0.94, -0.26, 1.40), (0.0, 0.0, 0.0))
    left_follow = ((-0.23, -0.44, 1.34), (-0.96, -0.25, 1.38), (0.0, 0.0, 0.0))
    key_ik_action(armature, "ShieldBash", 30, [
        (1, guard, right_guard, left_guard),
        (8, shield_windup, right_guard, left_windup),
        (11, shield_windup, right_guard, left_windup),
        (14, shield_impact, right_guard, left_impact),
        (18, shield_follow, right_guard, left_follow),
        (25, guard, right_guard, left_guard),
        (30, guard, right_guard, left_guard),
    ])

    hit = {**guard,
        "root": ((0.0, 0.0, 0.0), (0.0, 0.10, 0.0)),
        "pelvis": ((-3.0, 0.0, 0.0), (0.0, 0.0, -0.010)),
        "spine": ((-8.0, 0.0, 0.0), (0.0, 0.0, 0.0)),
        "chest": ((-16.0, 0.0, 0.0), (0.0, 0.025, 0.0)),
        "head": ((13.0, 0.0, 0.0), (0.0, 0.0, 0.0)),
        "upper_arm.L": ((-18.0, 0.0, -5.0), (0.0, 0.0, 0.0)),
        "upper_arm.R": ((-16.0, 0.0, -8.0), (0.0, 0.0, 0.0)),
    }
    key_action(armature, "Hit", 20, [
        (1, guard), (4, hit), (7, hit), (13, guard), (20, guard),
    ])

    collapse = {**guard,
        "root": ((8.0, 0.0, 0.0), (0.0, 0.07, -0.08)),
        "pelvis": ((-8.0, 0.0, 4.0), (0.0, 0.0, -0.10)),
        "chest": ((-18.0, 0.0, 10.0), (0.0, 0.0, 0.0)),
        "head": ((16.0, 0.0, -10.0), (0.0, 0.0, 0.0)),
        "thigh.L": ((-18.0, 0.0, 0.0), (0.0, 0.0, 0.0)),
        "shin.L": ((34.0, 0.0, 0.0), (0.0, 0.0, 0.0)),
        "thigh.R": ((-12.0, 0.0, 0.0), (0.0, 0.0, 0.0)),
        "shin.R": ((28.0, 0.0, 0.0), (0.0, 0.0, 0.0)),
    }
    fallen = {**collapse,
        "root": ((86.0, 0.0, 0.0), (0.0, 0.09, 0.04)),
        "pelvis": ((-12.0, 0.0, 4.0), (0.0, 0.0, -0.08)),
        "chest": ((-10.0, 0.0, 7.0), (0.0, 0.0, 0.0)),
        "head": ((14.0, 0.0, -8.0), (0.0, 0.0, 0.0)),
        "upper_arm.L": ((20.0, 0.0, 12.0), (0.0, 0.0, 0.0)),
        "upper_arm.R": ((-26.0, 0.0, -16.0), (0.0, 0.0, 0.0)),
    }
    key_action(armature, "Death", 48, [
        (1, guard), (8, pose(guard, chest=((-14.0, 0.0, 8.0), (0.0, 0.0, 0.0)), head=((12.0, 0.0, -8.0), (0.0, 0.0, 0.0)))),
        (18, collapse), (30, fallen), (48, fallen),
    ])


def add_preview_scene(body: bpy.types.Object, armature: bpy.types.Object) -> None:
    bpy.ops.mesh.primitive_plane_add(size=14.0, location=(0.0, 0.0, -0.025))
    ground = bpy.context.object
    ground.name = "PreviewGround"
    ground_material = bpy.data.materials.new("PreviewGroundMaterial")
    ground_material.diffuse_color = (0.052, 0.054, 0.05, 1.0)
    ground.data.materials.append(ground_material)

    world = bpy.context.scene.world or bpy.data.worlds.new("World")
    bpy.context.scene.world = world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.035, 0.038, 0.04, 1.0)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.24

    def light(name: str, location, energy: float, color, size: float) -> None:
        data = bpy.data.lights.new(name, "AREA")
        data.energy = energy
        data.color = color
        data.shape = "DISK"
        data.size = size
        obj = bpy.data.objects.new(name, data)
        bpy.context.collection.objects.link(obj)
        obj.location = location
        obj.rotation_euler = (Vector((0.0, 0.0, 1.35)) - obj.location).to_track_quat("-Z", "Y").to_euler()

    # Keep the proof render honest: a broad warm-neutral key establishes the
    # material colors, while the restrained cool fill only opens the shadows.
    # The previous blue fill was nearly as strong as the key and turned the
    # olive skin, oxblood cloth, and charcoal armor into the same pale gray.
    light("WarmKey", (-3.6, -4.5, 5.0), 920.0, (1.0, 0.82, 0.68), 3.8)
    light("CoolFill", (3.8, -2.4, 3.4), 260.0, (0.66, 0.74, 0.88), 3.4)
    light("Rim", (0.0, 3.8, 4.6), 520.0, (0.88, 0.52, 0.34), 2.8)

    camera_data = bpy.data.cameras.new("PreviewCamera")
    camera = bpy.data.objects.new("PreviewCamera", camera_data)
    bpy.context.collection.objects.link(camera)
    camera.location = (3.35, -6.8, 2.72)
    camera.rotation_euler = (Vector((0.0, 0.0, 1.34)) - camera.location).to_track_quat("-Z", "Y").to_euler()
    camera_data.lens = 62.0
    bpy.context.scene.camera = camera

    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.render.resolution_x = 1024
    scene.render.resolution_y = 1024
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = str(PREVIEW_PATH)
    scene.render.film_transparent = False
    scene.view_settings.look = "AgX - Medium High Contrast"
    scene.frame_set(1)

    BLEND_PATH.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND_PATH))
    bpy.ops.render.render(write_still=True)

    bpy.ops.object.select_all(action="DESELECT")
    body.select_set(True)
    armature.select_set(True)
    bpy.context.view_layer.objects.active = armature
    properties = bpy.ops.export_scene.gltf.get_rna_type().properties.keys()
    kwargs = {
        "filepath": str(GLB_PATH),
        "export_format": "GLB",
        "use_selection": True,
        "export_animations": True,
        "export_yup": True,
        "export_apply": False,
    }
    if "export_animation_mode" in properties:
        kwargs["export_animation_mode"] = "ACTIONS"
    bpy.ops.export_scene.gltf(**kwargs)


def main() -> None:
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    reset_scene()
    atlas = create_atlas()
    body_paint = create_body_paint()
    create_materials(atlas, body_paint)
    body, armature = build_character()
    add_preview_scene(body, armature)
    triangles = sum(len(polygon.vertices) - 2 for polygon in body.data.polygons)
    assert body.data.uv_layers.active is not None, "production mesh has no UV map"
    assert all(armature.data.bones.get(name) for name in ("head", "hand.L", "hand.R", "thigh.L", "thigh.R")), "required rig bone missing"
    assert len(bpy.data.actions) >= 7, "required animation actions missing"
    print(f"PRODUCTION_MODEL_OK triangles={triangles} vertices={len(body.data.vertices)} actions={len(bpy.data.actions)} glb={GLB_PATH}")


if __name__ == "__main__":
    main()
