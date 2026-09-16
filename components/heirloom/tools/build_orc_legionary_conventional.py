"""Build the Ashen Legionary as a conventional low-poly game character.

The deliverable is ordinary Blender geometry: deliberate topology, a UV atlas,
rigid low-poly weights, dedicated equipment bones, and named action clips.  It
does not use reconstructed geometry or projected concept art.
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_orc_legionary_production as mesh


ROOT = Path(__file__).resolve().parents[1]
PRODUCTION = ROOT / "characters" / "orc_legionary" / "production"
ATLAS = PRODUCTION / "orc_legionary_conventional_atlas.png"
GLB = PRODUCTION / "orc_legionary_conventional.glb"
BLEND = PRODUCTION / "source" / "orc_legionary_conventional.blend"
RENDER = ROOT / "artifacts" / "orc_legionary_conventional.png"
RENDER_HEAD = ROOT / "artifacts" / "orc_legionary_conventional_head.png"
PAINTOVER = ROOT / "art" / "concepts" / "orc-legionary-conventional-paintover-v06.png"


def configure_palette() -> None:
    mesh.ATLAS_PATH = ATLAS
    mesh.TILES.update({
        "skin": (0, (0.30, 0.34, 0.20)),
        "skin_dark": (1, (0.18, 0.22, 0.12)),
        "iron": (2, (0.055, 0.060, 0.065)),
        "iron_edge": (3, (0.14, 0.13, 0.11)),
        "oxblood": (4, (0.31, 0.045, 0.040)),
        "oxblood_dark": (5, (0.16, 0.025, 0.025)),
        "leather": (6, (0.19, 0.10, 0.045)),
        "leather_light": (7, (0.33, 0.20, 0.09)),
        "brass": (8, (0.50, 0.31, 0.075)),
        "wool": (9, (0.075, 0.070, 0.065)),
        "hair": (10, (0.018, 0.020, 0.018)),
        "face": (11, (0.30, 0.34, 0.20)),
        "armor_front": (12, (0.055, 0.060, 0.065)),
        "bone": (13, (0.55, 0.48, 0.32)),
        "hide": (14, (0.16, 0.095, 0.045)),
        "eye": (15, (0.72, 0.16, 0.025)),
    })


def paint_material_tiles(atlas: bpy.types.Image) -> None:
    """Replace procedural swatches with the approved hand-painted surface reference."""
    assert PAINTOVER.exists(), f"missing paint reference: {PAINTOVER}"
    reference = bpy.data.images.load(str(PAINTOVER), check_existing=False)
    source_width, source_height = reference.size
    source_pixels = reference.pixels[:]
    pixels = list(atlas.pixels[:])

    # Source rectangles use ordinary top-left image coordinates.  The six
    # unlabelled swatches are deliberately neutral, so they remain useful in
    # Godot lighting instead of baking the studio render into the character.
    crops = {
        "green": (860, 684, 1010, 803),
        "red": (1054, 684, 1205, 803),
        "iron": (1254, 684, 1405, 803),
        "brown": (860, 829, 1010, 975),
        "bone": (1054, 829, 1205, 975),
        "brass": (1254, 829, 1405, 975),
    }
    assignments = {
        "skin": ("green", (1.00, 0.96, 0.88)),
        "skin_dark": ("green", (0.62, 0.67, 0.57)),
        "iron": ("iron", (0.72, 0.74, 0.78)),
        "iron_edge": ("iron", (1.12, 1.10, 1.06)),
        "armor_front": ("iron", (0.87, 0.88, 0.90)),
        "oxblood": ("red", (1.00, 0.84, 0.78)),
        "oxblood_dark": ("red", (0.58, 0.55, 0.52)),
        "leather": ("brown", (0.88, 0.76, 0.64)),
        "leather_light": ("brown", (1.25, 1.04, 0.82)),
        "hide": ("brown", (0.72, 0.66, 0.58)),
        "bone": ("bone", (0.96, 0.91, 0.78)),
        "brass": ("brass", (0.95, 0.87, 0.68)),
        "wool": ("iron", (0.46, 0.49, 0.52)),
        "hair": ("iron", (0.24, 0.25, 0.27)),
    }

    for tile_name, (crop_name, gain) in assignments.items():
        x0, y0, x1, y1 = crops[crop_name]
        tile_index = mesh.TILES[tile_name][0]
        target_x0 = (tile_index % mesh.GRID) * mesh.CELL_SIZE
        target_y0 = (tile_index // mesh.GRID) * mesh.CELL_SIZE
        for local_y in range(mesh.CELL_SIZE):
            image_y = y0 + int((local_y + 0.5) / mesh.CELL_SIZE * (y1 - y0))
            source_y = source_height - 1 - min(source_height - 1, image_y)
            for local_x in range(mesh.CELL_SIZE):
                source_x = min(source_width - 1, x0 + int((local_x + 0.5) / mesh.CELL_SIZE * (x1 - x0)))
                source_offset = (source_y * source_width + source_x) * 4
                target_offset = ((target_y0 + local_y) * mesh.ATLAS_SIZE + target_x0 + local_x) * 4
                for channel in range(3):
                    value = source_pixels[source_offset + channel] * gain[channel]
                    pixels[target_offset + channel] = round(max(0.0, min(1.0, value)) * 63.0) / 63.0
                pixels[target_offset + 3] = 1.0

    atlas.pixels[:] = pixels
    atlas.filepath_raw = str(ATLAS)
    atlas.file_format = "PNG"
    atlas.save()


def paint_face_tile(atlas: bpy.types.Image) -> None:
    """Paint facial landmarks over an exact copy of the skin swatch.

    Matching the surrounding skin tile removes the mask-like value seam while
    retaining the character-specific information expected from a classic
    diffuse texture.
    """
    pixels = list(atlas.pixels[:])
    skin_index = mesh.TILES["skin"][0]
    face_index = mesh.TILES["face"][0]
    skin_x0 = (skin_index % mesh.GRID) * mesh.CELL_SIZE
    skin_y0 = (skin_index // mesh.GRID) * mesh.CELL_SIZE
    face_x0 = (face_index % mesh.GRID) * mesh.CELL_SIZE
    face_y0 = (face_index // mesh.GRID) * mesh.CELL_SIZE

    for local_y in range(mesh.CELL_SIZE):
        v = local_y / max(1, mesh.CELL_SIZE - 1)
        for local_x in range(mesh.CELL_SIZE):
            u = local_x / max(1, mesh.CELL_SIZE - 1)
            source_offset = ((skin_y0 + local_y) * mesh.ATLAS_SIZE + skin_x0 + local_x) * 4
            target_offset = ((face_y0 + local_y) * mesh.ATLAS_SIZE + face_x0 + local_x) * 4
            color = [pixels[source_offset + channel] for channel in range(3)]

            # Broad planes, not scene lighting: temples and jaw are naturally
            # darker; brow, nose and cheek ridges retain the base value.
            edge = max(0.0, (abs(u - 0.5) - 0.31) / 0.19)
            jaw = max(0.0, (0.27 - v) / 0.27)
            plane_shade = edge * 0.10 + jaw * 0.045
            color = [value - plane_shade for value in color]

            left_socket = ((u - 0.26) / 0.130) ** 2 + ((v - 0.645) / 0.085) ** 2
            right_socket = ((u - 0.74) / 0.130) ** 2 + ((v - 0.645) / 0.085) ** 2
            socket = min(left_socket, right_socket)
            if socket < 1.0:
                depth = (1.0 - socket) ** 0.55
                color = [color[0] - 0.105 * depth, color[1] - 0.120 * depth, color[2] - 0.070 * depth]

            left_brow = abs(v - (0.715 - (u - 0.26) * 0.16))
            right_brow = abs(v - (0.715 + (u - 0.74) * 0.16))
            if (0.10 < u < 0.47 and left_brow < 0.020) or (0.53 < u < 0.90 and right_brow < 0.020):
                color = [value - 0.075 for value in color]

            if 0.43 < v < 0.66:
                nose_side = min(abs(u - 0.43), abs(u - 0.57))
                if nose_side < 0.025:
                    color = [color[0] - 0.050, color[1] - 0.060, color[2] - 0.035]
            if ((u - 0.50) / 0.13) ** 2 + ((v - 0.43) / 0.055) ** 2 < 1.0:
                color = [color[0] - 0.050, color[1] - 0.060, color[2] - 0.034]

            mouth_curve = 0.315 + abs(u - 0.5) * 0.035
            if 0.27 < u < 0.73 and abs(v - mouth_curve) < 0.012:
                color = [0.030, 0.012, 0.010]
            if 0.33 < u < 0.67 and 0.205 < v < 0.245:
                color = [value - 0.042 for value in color]

            # One readable old scar and scattered pigment breakup keep the face
            # character-specific without encoding directional illumination.
            scar_u = 0.755 + (v - 0.48) * 0.09
            if 0.39 < v < 0.66 and abs(u - scar_u) < 0.008:
                color = [color[0] + 0.080, color[1] + 0.035, color[2] + 0.020]
            if mesh.hash_noise(local_x // 11, local_y // 9, 307) > 0.76:
                color = [color[0] - 0.022, color[1] - 0.015, color[2] - 0.008]
            if abs(u - 0.50) < 0.018 and 0.73 < v < 0.90:
                color = [color[0] + 0.035, color[1] + 0.018, color[2] - 0.004]

            for channel in range(3):
                pixels[target_offset + channel] = max(0.0, min(1.0, color[channel]))
            pixels[target_offset + 3] = 1.0

    atlas.pixels[:] = pixels
    atlas.filepath_raw = str(ATLAS)
    atlas.file_format = "PNG"
    atlas.save()


def map_face_uv(head: bpy.types.Object) -> None:
    tile = mesh.TILES["face"][0]
    cell_x = tile % mesh.GRID
    cell_y = tile // mesh.GRID
    margin = 0.06
    scale = (1.0 - margin * 2.0) / mesh.GRID
    for polygon in head.data.polygons:
        if polygon.normal.y > -0.18 or polygon.center.z < 2.02 or polygon.center.z > 2.49:
            continue
        for loop_index in polygon.loop_indices:
            vertex = head.data.vertices[head.data.loops[loop_index].vertex_index].co
            u = max(0.0, min(1.0, (vertex.x + 0.235) / 0.47))
            v = max(0.0, min(1.0, (vertex.z - 2.02) / 0.47))
            head.data.uv_layers.active.data[loop_index].uv = (
                (cell_x + margin) / mesh.GRID + u * scale,
                (cell_y + margin) / mesh.GRID + v * scale,
            )


def add_foot(side: float, label: str) -> None:
    x = side * 0.21
    inner = 0.105
    outer = 0.135
    x0 = x - (outer if side < 0.0 else inner)
    x1 = x + (inner if side < 0.0 else outer)
    vertices = [
        (x0, -0.31, 0.00), (x1, -0.31, 0.00),
        (x0, 0.08, 0.00), (x1, 0.08, 0.00),
        (x0 * 0.98, -0.27, 0.15), (x1 * 0.98, -0.27, 0.15),
        (x0 * 0.98, 0.06, 0.21), (x1 * 0.98, 0.06, 0.21),
    ]
    faces = [
        (0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1),
        (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3),
    ]
    mesh.finish_part(
        mesh.object_from_mesh(f"Boot.{label}", vertices, faces),
        f"foot.{label}", "leather", bevel=0.018,
    )
    toe = [(-0.12, 0.07), (0.12, 0.07), (0.14, 0.0), (0.09, -0.08), (-0.09, -0.08), (-0.14, 0.0)]
    mesh.create_prism_xz(
        f"ToeCap.{label}", toe, 0.15, (x, -0.25, 0.08),
        f"foot.{label}", "iron", bevel=0.010, curve=0.010,
    )


def add_grip_hand(side: float, label: str) -> None:
    x = side * 0.55
    center = (x, -0.025, 0.92)
    mesh.create_box(
        f"Fist.{label}", (0.17, 0.15, 0.20), center,
        (0.0, 0.0, 0.0), f"hand.{label}", "skin", bevel=0.030,
    )
    for index in range(4):
        mesh.create_box(
            f"FingerCrease.{label}.{index}", (0.145, 0.012, 0.012),
            (x, -0.105, 0.855 + index * 0.038), (0.0, 0.0, 0.0),
            f"hand.{label}", "skin_dark", bevel=0.003,
        )
    mesh.create_box(
        f"Thumb.{label}", (0.055, 0.035, 0.145),
        (x - side * 0.055, -0.102, 0.93),
        (0.0, side * math.radians(18.0), side * math.radians(28.0)),
        f"hand.{label}", "skin_dark", bevel=0.012,
    )


def add_hair_blade(name: str, root_y: float, root_z: float, tip_y: float, tip_z: float, width: float, depth: float) -> None:
    """Add one swept, closed low-poly lock along the sagittal crest."""
    vertices = [
        (-width, root_y - depth * 0.5, root_z), (width, root_y - depth * 0.5, root_z),
        (-width, root_y + depth * 0.5, root_z), (width, root_y + depth * 0.5, root_z),
        (-width * 0.28, tip_y, tip_z), (width * 0.28, tip_y, tip_z),
    ]
    faces = [
        (0, 1, 5, 4), (2, 4, 5, 3), (0, 4, 2),
        (1, 3, 5), (0, 2, 3, 1),
    ]
    mesh.finish_part(mesh.object_from_mesh(name, vertices, faces), "head", "hair", smooth=False, bevel=0.003)


def add_head_legacy() -> None:
    # Hand-authored head loops: a square jaw and cranium with a shallow back,
    # rather than an ellipsoid with facial props attached to it.
    ring_specs = [
        # z, half width, front depth, back depth, y offset
        (2.00, 0.145, 0.145, 0.125, 0.018),
        (2.055, 0.175, 0.185, 0.145, 0.014),
        (2.120, 0.202, 0.220, 0.155, 0.008),
        (2.205, 0.224, 0.232, 0.166, 0.004),
        (2.285, 0.232, 0.224, 0.178, 0.008),
        (2.365, 0.222, 0.208, 0.188, 0.016),
        (2.435, 0.202, 0.165, 0.190, 0.026),
        (2.490, 0.162, 0.105, 0.170, 0.036),
    ]
    segments = 12
    vertices: list[tuple[float, float, float]] = []
    for z, rx, front, back, center_y in ring_specs:
        loop = [
            (0.00, -front),
            (0.46 * rx, -0.98 * front),
            (0.82 * rx, -0.72 * front),
            (rx, -0.18 * front),
            (0.90 * rx, 0.55 * back),
            (0.45 * rx, back),
            (0.00, back),
            (-0.45 * rx, back),
            (-0.90 * rx, 0.55 * back),
            (-rx, -0.18 * front),
            (-0.82 * rx, -0.72 * front),
            (-0.46 * rx, -0.98 * front),
        ]
        vertices.extend((x, center_y + y, z) for x, y in loop)
    faces: list[tuple[int, ...]] = []
    for ring in range(len(ring_specs) - 1):
        start = ring * segments
        following = start + segments
        for segment in range(segments):
            nxt = (segment + 1) % segments
            faces.append((start + segment, start + nxt, following + nxt, following + segment))
    faces.append(tuple(reversed(range(segments))))
    top = (len(ring_specs) - 1) * segments
    faces.append(tuple(top + segment for segment in range(segments)))
    head = mesh.finish_part(mesh.object_from_mesh("Head", vertices, faces), "head", "skin", smooth=False)
    map_face_uv(head)

    for side, label in ((-1.0, "L"), (1.0, "R")):
        ear_vertices = [
            (side * 0.19, -0.02, 2.37), (side * 0.205, 0.055, 2.25), (side * 0.365, 0.055, 2.30),
            (side * 0.19, 0.025, 2.37), (side * 0.205, 0.100, 2.25), (side * 0.365, 0.100, 2.30),
        ]
        ear_faces = [(0, 2, 1), (3, 4, 5), (0, 3, 5, 2), (2, 5, 4, 1), (1, 4, 3, 0)]
        ear = mesh.finish_part(mesh.object_from_mesh(f"Ear.{label}", ear_vertices, ear_faces), "head", "skin", smooth=False)
        map_face_uv(ear)

        cheek = [(-0.072, 0.050), (0.064, 0.066), (0.080, -0.026), (0.015, -0.074), (-0.060, -0.052)]
        cheek_obj = mesh.create_prism_xz(f"Cheek.{label}", cheek, 0.034, (side * 0.118, -0.226, 2.258), "head", "skin", bevel=0.004)
        map_face_uv(cheek_obj)

        brow = [(-0.080, 0.024), (0.078, 0.012), (0.060, -0.026), (-0.055, -0.020)]
        socket = [(-0.056, 0.018), (0.056, 0.012), (0.046, -0.022), (-0.046, -0.024)]
        brow_obj = mesh.create_prism_xz(f"Brow.{label}", brow, 0.040, (side * 0.100, -0.228, 2.357), "head", "skin", bevel=0.004)
        map_face_uv(brow_obj)
        mesh.create_prism_xz(f"EyeSocket.{label}", socket, 0.018, (side * 0.096, -0.253, 2.323), "head", "hair", bevel=0.002)
        mesh.create_prism_xz(f"Eye.{label}", [(-0.016, 0.009), (0.016, 0.007), (0.013, -0.009), (-0.013, -0.009)], 0.010, (side * 0.096, -0.271, 2.323), "head", "eye", bevel=0.002)

    nose_vertices = [
        (-0.052, -0.232, 2.348), (0.052, -0.232, 2.348),
        (-0.073, -0.245, 2.252), (0.073, -0.245, 2.252),
        (0.0, -0.304, 2.282), (0.0, -0.280, 2.225),
    ]
    nose_faces = [(0, 1, 4), (0, 4, 2), (1, 3, 4), (2, 4, 5), (4, 3, 5), (0, 2, 3, 1)]
    nose = mesh.finish_part(mesh.object_from_mesh("Nose", nose_vertices, nose_faces), "head", "skin", smooth=False)
    map_face_uv(nose)
    for side, label in ((-1.0, "L"), (1.0, "R")):
        mesh.create_prism_xz(
            f"Nostril.{label}", [(-0.012, 0.008), (0.012, 0.008), (0.010, -0.008), (-0.010, -0.008)],
            0.008, (side * 0.035, -0.302, 2.252), "head", "hair", bevel=0.002,
        )

    muzzle_outline = [(-0.132, 0.054), (0.132, 0.054), (0.125, -0.040), (0.080, -0.092), (-0.080, -0.092), (-0.125, -0.040)]
    muzzle = mesh.create_prism_xz("Muzzle", muzzle_outline, 0.050, (0.0, -0.246, 2.186), "head", "skin", bevel=0.007, curve=0.010)
    map_face_uv(muzzle)
    mouth = [(-0.110, 0.010), (0.110, 0.010), (0.088, -0.014), (-0.088, -0.014)]
    mesh.create_prism_xz("Mouth", mouth, 0.012, (0.0, -0.284, 2.167), "head", "oxblood_dark", bevel=0.002)
    lip = mesh.create_box("LowerLip", (0.17, 0.024, 0.028), (0.0, -0.278, 2.145), (0.0, 0.0, 0.0), "head", "skin", bevel=0.005)
    map_face_uv(lip)
    for side, label in ((-1.0, "L"), (1.0, "R")):
        bpy.ops.mesh.primitive_cone_add(vertices=6, radius1=0.018, radius2=0.002, depth=0.070, location=(side * 0.074, -0.298, 2.188))
        tusk = bpy.context.object
        tusk.name = f"Tusk.{label}"
        mesh.finish_part(tusk, "head", "bone", smooth=False)

    crest = [(-0.115, -0.055), (-0.105, 0.100), (-0.067, 0.190), (-0.028, 0.125),
             (0.008, 0.230), (0.045, 0.125), (0.092, 0.175), (0.120, -0.055)]
    mesh.create_prism_xz("Mane.Crest", crest, 0.160, (0.0, 0.105, 2.475), "head", "hair", bevel=0.004)
    for index, (center_y, center_z, width, height) in enumerate([
        (0.205, 2.400, 0.105, 0.190), (0.230, 2.295, 0.115, 0.205),
        (0.245, 2.185, 0.110, 0.200), (0.235, 2.080, 0.095, 0.170),
    ]):
        outline = [(-width, height * 0.40), (0.0, height * 0.66), (width, height * 0.38),
                   (width * 0.62, -height * 0.48), (0.0, -height * 0.64), (-width * 0.62, -height * 0.48)]
        mesh.create_prism_xz(f"Mane.Back.{index}", outline, 0.075, (0.0, center_y, center_z), "head", "hair", bevel=0.003)


def add_head() -> None:
    """Build one continuous low-poly facial surface and cranium."""
    # Rows run chin-to-crown.  Seven front landmarks carry the facial planes;
    # three rear landmarks close the skull without duplicating a second face.
    row_specs = [
        # z, half width, back depth, nine front y positions (left to right)
        (2.030, 0.158, 0.125, (-0.025, -0.060, -0.095, -0.130, -0.150, -0.130, -0.095, -0.060, -0.025)),
        (2.090, 0.202, 0.150, (-0.060, -0.110, -0.155, -0.190, -0.210, -0.190, -0.155, -0.110, -0.060)),
        (2.150, 0.220, 0.165, (-0.085, -0.135, -0.195, -0.238, -0.258, -0.238, -0.195, -0.135, -0.085)),
        (2.205, 0.228, 0.175, (-0.095, -0.145, -0.205, -0.262, -0.285, -0.262, -0.205, -0.145, -0.095)),
        (2.265, 0.232, 0.182, (-0.100, -0.155, -0.225, -0.305, -0.340, -0.305, -0.225, -0.155, -0.100)),
        (2.325, 0.232, 0.188, (-0.110, -0.165, -0.180, -0.238, -0.265, -0.238, -0.180, -0.165, -0.110)),
        (2.380, 0.228, 0.190, (-0.095, -0.155, -0.282, -0.276, -0.238, -0.276, -0.282, -0.155, -0.095)),
        (2.440, 0.208, 0.188, (-0.055, -0.100, -0.135, -0.158, -0.170, -0.158, -0.135, -0.100, -0.055)),
        (2.495, 0.172, 0.168, (-0.018, -0.050, -0.078, -0.100, -0.110, -0.100, -0.078, -0.050, -0.018)),
    ]
    columns = (-1.0, -0.75, -0.50, -0.24, 0.0, 0.24, 0.50, 0.75, 1.0)
    stride = 12
    vertices: list[tuple[float, float, float]] = []
    for z, width, back, front_depths in row_specs:
        vertices.extend((column * width, front_depths[index], z) for index, column in enumerate(columns))
        vertices.extend(((-0.76 * width, back, z), (0.0, back, z), (0.76 * width, back, z)))

    faces: list[tuple[int, ...]] = []
    for row in range(len(row_specs) - 1):
        lower = row * stride
        upper = lower + stride
        for column in range(8):
            a, b = lower + column, lower + column + 1
            c, d = upper + column + 1, upper + column
            if (row + column) % 2:
                faces.extend(((a, b, d), (b, c, d)))
            else:
                faces.extend(((a, b, c), (a, c, d)))
        faces.extend([
            (lower + 0, upper + 0, upper + 9, lower + 9),
            (lower + 9, upper + 9, upper + 10, lower + 10),
            (lower + 10, upper + 10, upper + 11, lower + 11),
            (lower + 11, upper + 11, upper + 8, lower + 8),
        ])
    ring = list(range(9)) + [11, 10, 9]
    faces.append(tuple(reversed(ring)))
    top_start = (len(row_specs) - 1) * stride
    faces.append(tuple(top_start + index for index in ring))

    head = mesh.finish_part(mesh.object_from_mesh("Head", vertices, faces), "head", "skin", smooth=False)
    map_face_uv(head)

    for side, label in ((-1.0, "L"), (1.0, "R")):
        ear_vertices = [
            (side * 0.205, -0.015, 2.375), (side * 0.218, 0.055, 2.260), (side * 0.370, 0.060, 2.305),
            (side * 0.205, 0.035, 2.375), (side * 0.218, 0.105, 2.260), (side * 0.370, 0.110, 2.305),
        ]
        ear_faces = [(0, 2, 1), (3, 4, 5), (0, 3, 5, 2), (2, 5, 4, 1), (1, 4, 3, 0)]
        ear = mesh.finish_part(mesh.object_from_mesh(f"Ear.{label}", ear_vertices, ear_faces), "head", "skin", smooth=False)
        map_face_uv(ear)

        socket = [(-0.034, 0.010), (0.034, 0.007), (0.028, -0.012), (-0.028, -0.013)]
        mesh.create_prism_xz(f"EyeSocket.{label}", socket, 0.010, (side * 0.112, -0.210, 2.326), "head", "hair", bevel=0.001)
        mesh.create_prism_xz(
            f"Eye.{label}", [(-0.012, 0.005), (0.012, 0.004), (0.009, -0.005), (-0.009, -0.006)],
            0.008, (side * 0.112, -0.218, 2.326), "head", "eye", bevel=0.001,
        )
        mesh.create_prism_xz(
            f"Nostril.{label}", [(-0.011, 0.007), (0.011, 0.007), (0.009, -0.007), (-0.009, -0.007)],
            0.007, (side * 0.050, -0.322, 2.263), "head", "hair", bevel=0.001,
        )

    mouth = [(-0.108, 0.009), (0.108, 0.009), (0.086, -0.012), (-0.086, -0.012)]
    mesh.create_prism_xz("Mouth", mouth, 0.010, (0.0, -0.273, 2.153), "head", "oxblood_dark", bevel=0.001)
    for side, label in ((-1.0, "L"), (1.0, "R")):
        tusk_outline = [(-0.016, -0.026), (0.016, -0.026), (0.0, 0.035)]
        mesh.create_prism_xz(
            f"Tusk.{label}", tusk_outline, 0.024,
            (side * (0.090 + (0.004 if side > 0.0 else 0.0)), -0.282, 2.188 - (0.003 if side > 0.0 else 0.0)),
            "head", "bone", bevel=0.002,
        )

    for index, values in enumerate([
        (-0.060, 2.455, 0.020, 2.605, 0.055, 0.075),
        (0.015, 2.475, 0.135, 2.655, 0.064, 0.082),
        (0.095, 2.465, 0.240, 2.610, 0.070, 0.086),
        (0.165, 2.425, 0.315, 2.535, 0.076, 0.086),
        (0.205, 2.370, 0.340, 2.405, 0.076, 0.082),
        (0.225, 2.290, 0.350, 2.270, 0.070, 0.076),
        (0.230, 2.205, 0.340, 2.145, 0.064, 0.070),
        (0.220, 2.120, 0.315, 2.035, 0.055, 0.060),
    ]):
        add_hair_blade(f"Mane.{index}", *values)


def add_body() -> None:
    for side, label in ((-1.0, "L"), (1.0, "R")):
        add_foot(side, label)
        x = side * 0.21
        mesh.create_tube(f"Shin.{label}", [
            ((x, 0.0, 0.22), 0.105, 0.115), ((x, 0.0, 0.46), 0.120, 0.130), ((x, 0.0, 0.69), 0.140, 0.145),
        ], 8, f"shin.{label}", "wool", smooth=False)
        mesh.create_tube(f"Thigh.{label}", [
            ((x, 0.0, 0.67), 0.140, 0.145), ((side * 0.205, 0.0, 0.90), 0.165, 0.175), ((side * 0.20, 0.0, 1.11), 0.175, 0.185),
        ], 8, f"thigh.{label}", "wool", smooth=False)
        mesh.create_tube(f"Greave.{label}", [
            ((x, -0.006, 0.27), 0.120, 0.132), ((x, -0.006, 0.47), 0.135, 0.145), ((x, -0.006, 0.64), 0.150, 0.155),
        ], 8, f"shin.{label}", "iron", smooth=False)
        for z, radius in ((0.31, 0.130), (0.48, 0.144), (0.63, 0.158)):
            mesh.create_tube(f"GreaveBand.{label}.{z}", [
                ((x, -0.008, z - 0.018), radius, radius * 0.96),
                ((x, -0.008, z + 0.018), radius, radius * 0.96),
            ], 8, f"shin.{label}", "iron_edge", smooth=False)
        mesh.create_ellipsoid(f"Knee.{label}", (x, -0.135, 0.71), (0.135, 0.050, 0.120), f"shin.{label}", "iron_edge", segments=8, rings=4)

    mesh.create_tube("Pelvis", [
        ((0.0, 0.0, 0.98), 0.29, 0.19), ((0.0, 0.0, 1.13), 0.34, 0.215), ((0.0, 0.0, 1.28), 0.32, 0.20),
    ], 10, "pelvis", "wool", smooth=False)
    mesh.create_tube("Belt", [((0.0, 0.0, 1.18), 0.35, 0.225), ((0.0, 0.0, 1.27), 0.35, 0.225)], 10, "pelvis", "leather", smooth=False)
    mesh.create_box("BeltBuckle", (0.13, 0.045, 0.11), (0.0, -0.235, 1.225), (0.0, 0.0, 0.0), "pelvis", "brass", bevel=0.010)

    mesh.create_tube("Torso", [
        ((0.0, 0.0, 1.20), 0.31, 0.20), ((0.0, 0.0, 1.42), 0.37, 0.225),
        ((0.0, 0.0, 1.68), 0.45, 0.25), ((0.0, 0.0, 1.86), 0.47, 0.26), ((0.0, 0.0, 1.97), 0.28, 0.19),
    ], 10, "spine", "wool", smooth=False)
    cuirass = mesh.create_tube("Cuirass", [
        ((0.0, 0.0, 1.27), 0.34, 0.205), ((0.0, 0.0, 1.48), 0.39, 0.230),
        ((0.0, 0.0, 1.72), 0.45, 0.260), ((0.0, 0.0, 1.91), 0.46, 0.267),
    ], 12, "chest", "iron", smooth=False)
    mesh.project_front_to_tile(cuirass, "armor_front", (-0.47, 0.47), (1.25, 1.93))
    for index, (z, half_width) in enumerate(((1.36, 0.35), (1.50, 0.39), (1.64, 0.425), (1.78, 0.45))):
        plate = [
            (-half_width, 0.066), (half_width, 0.066),
            (half_width - 0.028, -0.066), (-half_width + 0.028, -0.066),
        ]
        mesh.create_prism_xz(
            f"LamellarFront.{index}", plate, 0.026, (0.0, -0.275, z),
            "chest", "iron_edge" if index in (0, 3) else "iron", bevel=0.006, curve=0.012,
        )
        for side, label in ((-1.0, "L"), (1.0, "R")):
            mesh.create_ellipsoid(
                f"LamellarRivet.{index}.{label}", (side * (half_width - 0.038), -0.305, z + 0.032),
                (0.012, 0.006, 0.012), "chest", "brass", segments=6, rings=3,
            )
    chest_tabard = [(-0.10, 0.33), (0.10, 0.33), (0.09, -0.30), (0.0, -0.36), (-0.09, -0.30)]
    mesh.create_prism_xz("ChestTabard", chest_tabard, 0.022, (0.0, -0.285, 1.58), "chest", "oxblood", bevel=0.005, curve=0.012)
    mesh.add_cloven_moon("ChestBadge", (0.0, -0.312, 1.68), 0.27, "chest", "brass")

    for index, (x, y, angle) in enumerate([(-0.27, -0.06, -6.0), (-0.09, -0.18, -2.0), (0.09, -0.18, 2.0), (0.27, -0.06, 6.0)]):
        plate = [(-0.075, 0.20), (0.075, 0.20), (0.065, -0.22), (0.0, -0.27), (-0.065, -0.22)]
        obj = mesh.create_prism_xz(f"SkirtPlate.{index}", plate, 0.055, (x, y, 1.00), "pelvis", "iron", bevel=0.008)
        obj.rotation_euler.y = math.radians(angle)
    front_tabard = [(-0.15, 0.34), (0.15, 0.34), (0.14, -0.29), (0.07, -0.38), (0.0, -0.34), (-0.07, -0.39), (-0.14, -0.30)]
    mesh.create_prism_xz("FrontTabard", front_tabard, 0.024, (0.0, -0.25, 0.93), "pelvis", "oxblood", bevel=0.004, curve=0.014)
    mesh.add_cloven_moon("TabardMark", (0.0, -0.279, 0.92), 0.33, "pelvis", "bone")

    for side, label in ((-1.0, "L"), (1.0, "R")):
        mesh.create_tube(f"UpperArm.{label}", [
            ((side * 0.43, 0.0, 1.82), 0.145, 0.140), ((side * 0.50, 0.0, 1.61), 0.135, 0.128), ((side * 0.56, 0.0, 1.40), 0.112, 0.106),
        ], 8, f"upper_arm.{label}", "skin", smooth=True)
        mesh.create_tube(f"Forearm.{label}", [
            ((side * 0.56, 0.0, 1.40), 0.112, 0.106), ((side * 0.57, 0.0, 1.20), 0.100, 0.094), ((side * 0.55, 0.0, 1.03), 0.082, 0.078),
        ], 8, f"forearm.{label}", "skin_dark", smooth=True)
        mesh.create_tube(f"Bracer.{label}", [
            ((side * 0.56, -0.004, 1.36), 0.123, 0.115), ((side * 0.57, -0.004, 1.19), 0.112, 0.104), ((side * 0.55, -0.004, 1.06), 0.092, 0.087),
        ], 8, f"forearm.{label}", "iron", smooth=False)
        add_grip_hand(side, label)
        for layer in range(3):
            x = side * (0.455 + layer * 0.050)
            z = 1.90 - layer * 0.064
            shoulder_plate = [(-0.145, 0.050), (0.145, 0.038), (0.122, -0.052), (-0.105, -0.068)]
            mesh.create_prism_xz(
                f"Shoulder.{label}.{layer}", shoulder_plate, 0.285, (x, 0.0, z),
                "chest", "iron_edge" if layer == 0 else "iron", bevel=0.010, curve=0.018,
            )
            for rivet_side in (-1.0, 1.0):
                mesh.create_ellipsoid(
                    f"ShoulderRivet.{label}.{layer}.{rivet_side}",
                    (x + rivet_side * 0.102, -0.166, z + 0.010), (0.011, 0.006, 0.011),
                    "chest", "brass", segments=6, rings=3,
                )

    mesh.create_tube("Collar", [((0.0, 0.0, 1.88), 0.28, 0.20), ((0.0, 0.0, 2.02), 0.205, 0.155)], 10, "chest", "oxblood", smooth=False)
    add_head()


def create_armature() -> bpy.types.Object:
    armature = mesh.create_armature()
    mesh.activate(armature)
    bpy.ops.object.mode_set(mode="EDIT")
    for name, head, tail, parent in (
        ("weapon.R", (0.55, -0.025, 0.98), (0.55, -0.025, 0.78), "hand.R"),
        ("shield.L", (-0.55, -0.025, 0.98), (-0.55, -0.025, 1.16), "hand.L"),
    ):
        bone = armature.data.edit_bones.new(name)
        bone.head = head
        bone.tail = tail
        bone.parent = armature.data.edit_bones[parent]
        bone.use_deform = True
    bpy.ops.object.mode_set(mode="OBJECT")
    return armature


def add_equipment() -> tuple[list[bpy.types.Object], list[bpy.types.Object]]:
    start = len(mesh.parts)
    shield_center = (-0.63, -0.13, 1.25)
    outline = [(-0.30, 0.53), (0.30, 0.53), (0.35, 0.40), (0.33, -0.35), (0.0, -0.60), (-0.33, -0.35), (-0.35, 0.40)]
    face = [(-0.26, 0.48), (0.26, 0.48), (0.30, 0.36), (0.29, -0.30), (0.0, -0.52), (-0.29, -0.30), (-0.30, 0.36)]
    mesh.create_prism_xz("ShieldRim", outline, 0.12, shield_center, "shield.L", "iron_edge", bevel=0.014, curve=0.045)
    mesh.create_prism_xz("ShieldFace", face, 0.024, (shield_center[0], shield_center[1] - 0.078, shield_center[2]), "shield.L", "hide", bevel=0.006, curve=0.035)
    mesh.create_ellipsoid("ShieldBoss", (shield_center[0], shield_center[1] - 0.132, shield_center[2] + 0.02), (0.095, 0.032, 0.095), "shield.L", "iron", segments=8, rings=4)
    mesh.add_cloven_moon("ShieldMark", (shield_center[0], shield_center[1] - 0.135, shield_center[2] + 0.02), 0.60, "shield.L", "bone")
    mesh.create_tube("ShieldGrip", [((-0.55, -0.035, 0.86), 0.025, 0.022), ((-0.55, -0.035, 1.15), 0.025, 0.022)], 6, "shield.L", "leather", smooth=False)
    shield_parts = mesh.parts[start:]

    start = len(mesh.parts)
    mesh.create_tube("AxeHandle", [
        ((0.55, -0.025, 1.10), 0.032, 0.030), ((0.55, -0.025, 0.62), 0.038, 0.035), ((0.55, -0.025, 0.28), 0.044, 0.040),
    ], 8, "weapon.R", "leather", smooth=False)
    blade = [
        (-0.035, 0.225), (0.155, 0.205), (0.325, 0.125), (0.415, 0.015),
        (0.360, -0.135), (0.190, -0.245), (-0.035, -0.220),
        (0.035, -0.095), (0.085, 0.000), (0.030, 0.110),
    ]
    mesh.create_prism_xz("AxeBlade", blade, 0.072, (0.55, -0.025, 0.27), "weapon.R", "iron_edge", bevel=0.008)
    rear_spike = [(-0.020, 0.085), (-0.150, 0.055), (-0.245, 0.000), (-0.145, -0.045), (-0.020, -0.070)]
    mesh.create_prism_xz("AxeRearSpike", rear_spike, 0.066, (0.55, -0.025, 0.29), "weapon.R", "iron", bevel=0.006)
    mesh.create_ellipsoid("AxeSocket", (0.55, -0.025, 0.28), (0.060, 0.055, 0.070), "weapon.R", "brass", segments=8, rings=4)
    axe_parts = mesh.parts[start:]
    return shield_parts, axe_parts


def replace_combat_actions(armature: bpy.types.Object) -> None:
    """Author planted, clearance-safe attacks for the rigid low-poly armor."""
    armature.animation_data_create()
    armature.animation_data.action = None
    for name in ("AxeAttack", "ShieldBash"):
        action = bpy.data.actions.get(name)
        if action is not None:
            bpy.data.actions.remove(action)

    guard = {
        "spine": ((2.0, 0.0, 0.0), (0.0, 0.0, 0.0)),
        "chest": ((-2.0, 0.0, 0.0), (0.0, -0.005, 0.0)),
        "head": ((1.0, 0.0, 0.0), (0.0, 0.0, 0.0)),
    }
    right_guard = ((0.54, -0.05, 1.03), (0.92, -0.18, 1.42), (18.0, 0.0, 0.0))
    left_guard = ((-0.54, -0.38, 1.38), (-1.08, -0.10, 1.48), (0.0, 0.0, 0.0))

    axe_windup = {**guard,
        "root": ((0.0, 0.0, 0.0), (0.0, 0.025, 0.0)),
        "pelvis": ((-2.0, 0.0, -5.0), (0.0, 0.0, 0.0)),
        "spine": ((-3.0, 0.0, -8.0), (0.0, 0.0, 0.0)),
        "chest": ((-5.0, 0.0, -13.0), (0.0, 0.0, 0.0)),
        "head": ((3.0, 0.0, 10.0), (0.0, 0.0, 0.0)),
    }
    axe_impact = {**guard,
        "root": ((0.0, 0.0, 0.0), (0.0, -0.085, 0.0)),
        "pelvis": ((4.0, 0.0, 3.0), (0.0, 0.0, 0.0)),
        "spine": ((7.0, 0.0, 5.0), (0.0, 0.0, 0.0)),
        "chest": ((11.0, 0.0, 8.0), (0.0, -0.010, 0.0)),
        "head": ((-5.0, 0.0, -6.0), (0.0, 0.0, 0.0)),
    }
    axe_follow = {**axe_impact,
        "root": ((0.0, 0.0, 0.0), (0.0, -0.045, 0.0)),
        "spine": ((5.0, 0.0, 4.0), (0.0, 0.0, 0.0)),
        "chest": ((8.0, 0.0, 6.0), (0.0, -0.006, 0.0)),
    }
    right_windup = ((0.70, 0.02, 2.12), (1.16, -0.22, 1.72), (162.0, -12.0, -8.0))
    right_impact = ((0.42, -0.54, 1.30), (1.02, -0.22, 1.42), (32.0, -8.0, -5.0))
    right_follow = ((0.38, -0.46, 1.08), (0.98, -0.22, 1.30), (18.0, -12.0, -8.0))
    mesh.key_ik_action(armature, "AxeAttack", 36, [
        (1, guard, right_guard, left_guard),
        (8, axe_windup, right_windup, left_guard),
        (13, axe_windup, right_windup, left_guard),
        (16, axe_impact, right_impact, left_guard),
        (21, axe_follow, right_follow, left_guard),
        (29, guard, right_guard, left_guard),
        (36, guard, right_guard, left_guard),
    ])

    shield_windup = {**guard,
        "root": ((0.0, 0.0, 0.0), (0.0, 0.020, 0.0)),
        "pelvis": ((-2.0, 0.0, 4.0), (0.0, 0.0, 0.0)),
        "spine": ((-2.0, 0.0, 7.0), (0.0, 0.0, 0.0)),
        "chest": ((-4.0, 0.0, 11.0), (0.0, 0.0, 0.0)),
        "head": ((2.0, 0.0, -8.0), (0.0, 0.0, 0.0)),
    }
    shield_impact = {**guard,
        "root": ((0.0, 0.0, 0.0), (0.0, -0.125, 0.0)),
        "pelvis": ((4.0, 0.0, -3.0), (0.0, 0.0, 0.0)),
        "spine": ((7.0, 0.0, -7.0), (0.0, 0.0, 0.0)),
        "chest": ((11.0, 0.0, -12.0), (0.0, -0.012, 0.0)),
        "head": ((-5.0, 0.0, 9.0), (0.0, 0.0, 0.0)),
    }
    shield_follow = {**shield_impact,
        "root": ((0.0, 0.0, 0.0), (0.0, -0.045, 0.0)),
        "spine": ((4.0, 0.0, -5.0), (0.0, 0.0, 0.0)),
        "chest": ((7.0, 0.0, -8.0), (0.0, -0.006, 0.0)),
    }
    left_windup = ((-0.66, 0.02, 1.30), (-1.06, -0.24, 1.48), (0.0, 0.0, -5.0))
    left_impact = ((-0.10, -0.58, 1.43), (-0.88, -0.24, 1.47), (0.0, 0.0, 6.0))
    left_follow = ((-0.20, -0.46, 1.36), (-0.92, -0.23, 1.42), (0.0, 0.0, 3.0))
    mesh.key_ik_action(armature, "ShieldBash", 30, [
        (1, guard, right_guard, left_guard),
        (8, shield_windup, right_guard, left_windup),
        (11, shield_windup, right_guard, left_windup),
        (14, shield_impact, right_guard, left_impact),
        (18, shield_follow, right_guard, left_follow),
        (25, guard, right_guard, left_guard),
        (30, guard, right_guard, left_guard),
    ])


def join_parts(objects: list[bpy.types.Object], name: str, armature: bpy.types.Object) -> bpy.types.Object:
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.join()
    joined = bpy.context.object
    joined.name = name
    unique = []
    old = [slot.material for slot in joined.material_slots]
    for material in old:
        if material not in unique:
            unique.append(material)
    remap = {index: unique.index(material) for index, material in enumerate(old)}
    for polygon in joined.data.polygons:
        polygon.material_index = remap[polygon.material_index]
    joined.data.materials.clear()
    for material in unique:
        joined.data.materials.append(material)
    modifier = joined.modifiers.new("OrcLegionaryRig", "ARMATURE")
    modifier.object = armature
    joined.parent = armature
    return joined


def export_assets(body: bpy.types.Object, shield: bpy.types.Object, axe: bpy.types.Object, armature: bpy.types.Object) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    for obj in (body, shield, axe, armature):
        obj.select_set(True)
    bpy.context.view_layer.objects.active = armature
    properties = bpy.ops.export_scene.gltf.get_rna_type().properties.keys()
    kwargs = {
        "filepath": str(GLB), "export_format": "GLB", "use_selection": True,
        "export_animations": True, "export_yup": True, "export_apply": False,
    }
    if "export_animation_mode" in properties:
        kwargs["export_animation_mode"] = "ACTIONS"
    bpy.ops.export_scene.gltf(**kwargs)


def add_studio(body: bpy.types.Object, armature: bpy.types.Object) -> None:
    bpy.ops.mesh.primitive_plane_add(size=12.0, location=(0.0, 0.0, -0.015))
    ground = bpy.context.object
    material = bpy.data.materials.new("StudioGround")
    material.diffuse_color = (0.045, 0.028, 0.020, 1.0)
    ground.data.materials.append(material)
    world = bpy.context.scene.world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.005, 0.006, 0.005, 1.0)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.16

    def light(name: str, location, energy: float, color, size: float) -> None:
        data = bpy.data.lights.new(name, "AREA")
        data.energy = energy
        data.color = color
        data.shape = "DISK"
        data.size = size
        obj = bpy.data.objects.new(name, data)
        bpy.context.collection.objects.link(obj)
        obj.location = location
        obj.rotation_euler = (Vector((0.0, 0.0, 1.30)) - obj.location).to_track_quat("-Z", "Y").to_euler()

    light("Key", (-3.0, -4.0, 4.7), 930.0, (1.0, 0.84, 0.69), 3.0)
    light("Fill", (3.2, -2.0, 3.3), 240.0, (0.70, 0.78, 0.90), 3.0)
    light("Rim", (0.0, 3.5, 4.1), 420.0, (0.88, 0.52, 0.32), 2.4)

    camera_data = bpy.data.cameras.new("StudioCamera")
    camera = bpy.data.objects.new("StudioCamera", camera_data)
    bpy.context.collection.objects.link(camera)
    full_location = Vector((3.1, -5.25, 2.30))
    full_target = Vector((0.0, 0.0, 1.30))
    camera.location = full_location
    camera.rotation_euler = (full_target - camera.location).to_track_quat("-Z", "Y").to_euler()
    camera_data.lens = 68.0
    scene = bpy.context.scene
    scene.camera = camera
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.render.resolution_x = 1024
    scene.render.resolution_y = 1024
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.view_settings.look = "AgX - Medium High Contrast"
    armature.animation_data.action = bpy.data.actions.get("Idle")
    scene.frame_set(1)
    scene.render.filepath = str(RENDER)
    bpy.ops.render.render(write_still=True)
    camera.location = (0.95, -2.05, 2.42)
    camera.rotation_euler = (Vector((0.0, -0.015, 2.28)) - camera.location).to_track_quat("-Z", "Y").to_euler()
    camera_data.lens = 78.0
    scene.render.filepath = str(RENDER_HEAD)
    bpy.ops.render.render(write_still=True)
    camera.location = full_location
    camera.rotation_euler = (full_target - camera.location).to_track_quat("-Z", "Y").to_euler()
    camera_data.lens = 68.0
    scene.render.filepath = str(RENDER)


def main() -> None:
    mesh.reset_scene()
    configure_palette()
    mesh.parts.clear()
    mesh.materials.clear()
    atlas = mesh.create_atlas()
    paint_material_tiles(atlas)
    paint_face_tile(atlas)
    mesh.create_materials(atlas, atlas)

    add_body()
    body_parts = list(mesh.parts)
    armature = create_armature()
    body = join_parts(body_parts, "OrcLegionaryBody", armature)

    mesh.parts.clear()
    shield_parts, axe_parts = add_equipment()
    shield = join_parts(shield_parts, "OrcLegionaryShield", armature)
    axe = join_parts(axe_parts, "OrcLegionaryAxe", armature)
    mesh.create_actions(armature)
    replace_combat_actions(armature)
    for action in bpy.data.actions:
        action.use_fake_user = True

    export_assets(body, shield, axe, armature)
    add_studio(body, armature)
    BLEND.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.file.pack_all()
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND))

    triangles = sum(len(polygon.vertices) - 2 for obj in (body, shield, axe) for polygon in obj.data.polygons)
    assert triangles <= 8_000, triangles
    assert {"weapon.R", "shield.L"}.issubset(armature.data.bones.keys())
    assert all(name in bpy.data.actions for name in ("Idle", "Walk", "Run", "AxeAttack", "ShieldBash", "Hit", "Death"))
    assert all(material.name != "BodyPaint" for obj in (body, shield, axe) for material in obj.data.materials)
    print(f"CONVENTIONAL_ORC_OK triangles={triangles} meshes=3 actions=7 glb={GLB} blend={BLEND} render={RENDER}")


if __name__ == "__main__":
    main()
