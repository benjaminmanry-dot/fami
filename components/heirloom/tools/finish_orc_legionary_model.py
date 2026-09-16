"""Turn the approved four-view reconstruction into a rigged Godot candidate."""

import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_orc_legionary_production as authored


ROOT = Path(__file__).resolve().parents[1]
PRODUCTION = ROOT / "characters" / "orc_legionary" / "production"
SOURCE = PRODUCTION / "source" / "orc_legionary_hunyuan_raw.glb"
BODY_PAINT = PRODUCTION / "orc_legionary_body_paint.png"
PROP_PAINT = PRODUCTION / "orc_legionary_diffuse.png"
GLB = PRODUCTION / "orc_legionary.glb"
BLEND = PRODUCTION / "source" / "orc_legionary.blend"
RENDER = ROOT / "artifacts" / "orc_legionary_model.png"
ACTION_FRAMES = {
    "Walk": 1,
    "Run": 1,
    "AxeAttack": 16,
    "ShieldBash": 14,
    "Hit": 6,
    "Death": 31,
}
EXTRA_POSE_FRAMES = {
    "axe_windup": ("AxeAttack", 13),
    "shield_windup": ("ShieldBash", 11),
}
TARGET_BODY_FACES = 12_000


def activate(obj: bpy.types.Object) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def look_at(obj: bpy.types.Object, target: Vector) -> None:
    obj.rotation_euler = (target - obj.location).to_track_quat("-Z", "Y").to_euler()


def load_body() -> bpy.types.Object:
    bpy.ops.import_scene.gltf(filepath=str(SOURCE))
    body = next(obj for obj in bpy.context.scene.objects if obj.type == "MESH")
    activate(body)
    body.rotation_euler.x = math.radians(90.0)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    coordinates = [body.matrix_world @ vertex.co for vertex in body.data.vertices]
    minimum = Vector((min(v.x for v in coordinates), min(v.y for v in coordinates), min(v.z for v in coordinates)))
    maximum = Vector((max(v.x for v in coordinates), max(v.y for v in coordinates), max(v.z for v in coordinates)))
    scale = 2.60 / (maximum.z - minimum.z)
    body.scale = (scale, scale, scale)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    coordinates = [body.matrix_world @ vertex.co for vertex in body.data.vertices]
    minimum = Vector((min(v.x for v in coordinates), min(v.y for v in coordinates), min(v.z for v in coordinates)))
    maximum = Vector((max(v.x for v in coordinates), max(v.y for v in coordinates), max(v.z for v in coordinates)))
    body.location = (-(minimum.x + maximum.x) * 0.5, -(minimum.y + maximum.y) * 0.5, -minimum.z)
    bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)

    face_count = len(body.data.polygons)
    modifier = body.modifiers.new("GameDensity", "DECIMATE")
    modifier.ratio = min(1.0, TARGET_BODY_FACES / face_count)
    modifier.use_collapse_triangulate = True
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    body.data.validate(verbose=True, clean_customdata=True)
    body.data.update()
    for polygon in body.data.polygons:
        polygon.use_smooth = True
    body.name = "OrcLegionaryBody"
    return body


def body_material() -> bpy.types.Material:
    image = bpy.data.images.load(str(BODY_PAINT), check_existing=True)
    material = bpy.data.materials.new("OrcLegionaryBodyPaint")
    material.use_nodes = True
    nodes = material.node_tree.nodes
    texture = nodes.new("ShaderNodeTexImage")
    texture.image = image
    texture.interpolation = "Linear"
    bsdf = nodes.get("Principled BSDF")
    material.node_tree.links.new(texture.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.84
    if "Specular IOR Level" in bsdf.inputs:
        bsdf.inputs["Specular IOR Level"].default_value = 0.28
    return material


def project_body(body: bpy.types.Object) -> None:
    body.data.materials.clear()
    body.data.materials.append(body_material())
    uv_layer = body.data.uv_layers.active or body.data.uv_layers.new(name="UVMap")
    coordinates = [vertex.co for vertex in body.data.vertices]
    x_min, x_max = min(v.x for v in coordinates), max(v.x for v in coordinates)
    y_min, y_max = min(v.y for v in coordinates), max(v.y for v in coordinates)
    z_min, z_max = min(v.z for v in coordinates), max(v.z for v in coordinates)
    margin = 0.018
    usable = 1.0 - margin * 2.0

    for polygon in body.data.polygons:
        normal = polygon.normal
        center = polygon.center
        use_side = abs(normal.x) > abs(normal.y)
        if abs(normal.z) > max(abs(normal.x), abs(normal.y)):
            use_side = abs(center.x) > abs(center.y)
        if use_side:
            right_profile = normal.x > 0.0 if abs(normal.x) > 0.01 else center.x > 0.0
            tile = 2 if right_profile else 3
            flip = not right_profile
            axis_min, axis_max = y_min, y_max
            axis = "y"
        else:
            front = normal.y < 0.0 if abs(normal.y) > 0.01 else center.y < 0.0
            tile = 0 if front else 1
            flip = not front
            axis_min, axis_max = x_min, x_max
            axis = "x"
        for loop_index in polygon.loop_indices:
            vertex = body.data.vertices[body.data.loops[loop_index].vertex_index].co
            value = vertex.y if axis == "y" else vertex.x
            u = (value - axis_min) / (axis_max - axis_min)
            if flip:
                u = 1.0 - u
            v = (vertex.z - z_min) / (z_max - z_min)
            uv_layer.data[loop_index].uv = (
                (tile + margin + max(0.0, min(1.0, u)) * usable) / 4.0,
                margin + max(0.0, min(1.0, v)) * usable,
            )


def add_authored_props() -> list[bpy.types.Object]:
    authored.parts.clear()
    authored.materials.clear()
    prop_image = bpy.data.images.load(str(PROP_PAINT), check_existing=True)
    body_image = bpy.data.images.load(str(BODY_PAINT), check_existing=True)
    authored.create_materials(prop_image, body_image)
    authored.add_shield()
    authored.add_axe()
    for prop in authored.parts:
        if prop.name.startswith("Axe"):
            prop.location.x -= 0.265
            prop.location.y -= 0.035
            prop.location.z += 0.08
    return list(authored.parts)


def rig(body: bpy.types.Object, props: list[bpy.types.Object]) -> bpy.types.Object:
    armature = authored.create_armature()
    bpy.ops.object.select_all(action="DESELECT")
    body.select_set(True)
    armature.select_set(True)
    bpy.context.view_layer.objects.active = armature
    bpy.ops.object.parent_set(type="ARMATURE_AUTO")
    activate(body)
    bpy.ops.object.vertex_group_limit_total(group_select_mode="ALL", limit=4)
    bpy.ops.object.vertex_group_normalize_all(group_select_mode="ALL", lock_active=False)
    for prop in props:
        prop.parent = armature
        modifier = prop.modifiers.new("OrcLegionaryRig", "ARMATURE")
        modifier.object = armature
    authored.create_actions(armature)
    for action in bpy.data.actions:
        action.use_fake_user = True
    armature.name = "OrcLegionaryRig"
    return armature


def export_model(body: bpy.types.Object, props: list[bpy.types.Object], armature: bpy.types.Object) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    for obj in [body, *props, armature]:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = armature
    properties = bpy.ops.export_scene.gltf.get_rna_type().properties.keys()
    kwargs = {
        "filepath": str(GLB),
        "export_format": "GLB",
        "use_selection": True,
        "export_animations": True,
        "export_yup": True,
        "export_apply": False,
    }
    if "export_animation_mode" in properties:
        kwargs["export_animation_mode"] = "ACTIONS"
    bpy.ops.export_scene.gltf(**kwargs)
    bpy.ops.file.pack_all()
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND))


def render(body: bpy.types.Object, armature: bpy.types.Object) -> None:
    bpy.ops.mesh.primitive_plane_add(size=12.0, location=(0.0, 0.0, 0.0))
    ground = bpy.context.object
    material = bpy.data.materials.new("PreviewGround")
    material.diffuse_color = (0.055, 0.035, 0.025, 1.0)
    ground.data.materials.append(material)
    world = bpy.context.scene.world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.006, 0.008, 0.006, 1.0)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.14
    for location, energy, color, size in (
        ((-2.6, -3.4, 4.3), 980.0, (1.0, 0.84, 0.70), 2.8),
        ((2.8, 0.8, 3.2), 250.0, (0.68, 0.76, 0.90), 2.4),
    ):
        bpy.ops.object.light_add(type="AREA", location=location)
        light = bpy.context.object
        light.data.energy = energy
        light.data.color = color
        light.data.shape = "DISK"
        light.data.size = size
        look_at(light, Vector((0.0, 0.0, 1.30)))
    bpy.ops.object.camera_add(location=(3.15, -5.10, 2.20))
    camera = bpy.context.object
    camera.data.lens = 72
    look_at(camera, Vector((0.0, 0.0, 1.28)))
    scene = bpy.context.scene
    scene.camera = camera
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.render.resolution_x = 1024
    scene.render.resolution_y = 1024
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = str(RENDER)
    scene.view_settings.look = "AgX - Medium High Contrast"
    bpy.ops.render.render(write_still=True)
    for animation_name, frame in ACTION_FRAMES.items():
        armature.animation_data.action = bpy.data.actions.get(animation_name)
        scene.frame_set(frame)
        if animation_name == "Death":
            camera.data.lens = 48
            camera.location = (4.30, -7.10, 2.05)
            look_at(camera, Vector((0.0, 0.0, 0.58)))
        else:
            camera.data.lens = 72
            camera.location = (3.15, -5.10, 2.20)
            look_at(camera, Vector((0.0, 0.0, 1.28)))
        scene.render.filepath = str(ROOT / "artifacts" / f"orc_legionary_{animation_name.lower()}.png")
        bpy.ops.render.render(write_still=True)
    camera.data.lens = 72
    camera.location = (3.15, -5.10, 2.20)
    look_at(camera, Vector((0.0, 0.0, 1.28)))
    for proof_name, (animation_name, frame) in EXTRA_POSE_FRAMES.items():
        armature.animation_data.action = bpy.data.actions.get(animation_name)
        scene.frame_set(frame)
        scene.render.filepath = str(ROOT / "artifacts" / f"orc_legionary_{proof_name}.png")
        bpy.ops.render.render(write_still=True)
    armature.animation_data.action = None
    scene.frame_set(1)


def main() -> None:
    authored.reset_scene()
    authored.create_body_paint()
    body = load_body()
    project_body(body)
    props = add_authored_props()
    armature = rig(body, props)
    export_model(body, props, armature)
    render(body, armature)
    triangles = sum(len(polygon.vertices) - 2 for polygon in body.data.polygons)
    assert triangles <= TARGET_BODY_FACES + 100, triangles
    assert len(bpy.data.actions) >= 7
    print(
        f"ORC_MODEL_OK body_triangles={triangles} props={len(props)} "
        f"actions={len(bpy.data.actions)} glb={GLB} render={RENDER}"
    )


if __name__ == "__main__":
    main()
