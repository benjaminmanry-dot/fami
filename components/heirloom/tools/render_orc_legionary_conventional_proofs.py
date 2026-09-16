"""Render the conventional Ashen Legionary's gameplay animation proofs."""

from pathlib import Path

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = ROOT / "artifacts"
PROOFS = {
    "idle": ("Idle", 30),
    "walk": ("Walk", 1),
    "run": ("Run", 1),
    "axe_windup": ("AxeAttack", 13),
    "axe_impact": ("AxeAttack", 16),
    "shield_windup": ("ShieldBash", 11),
    "shield_impact": ("ShieldBash", 14),
    "hit": ("Hit", 6),
    "death": ("Death", 30),
}
MOTION_PROOFS = {
    "axe_attack": ("AxeAttack", 36),
    "shield_bash": ("ShieldBash", 30),
}


def look_at(camera: bpy.types.Object, target: Vector) -> None:
    camera.rotation_euler = (target - camera.location).to_track_quat("-Z", "Y").to_euler()


def main() -> None:
    scene = bpy.context.scene
    armature = next(obj for obj in scene.objects if obj.type == "ARMATURE")
    camera = scene.camera
    assert camera is not None
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.render.resolution_x = 768
    scene.render.resolution_y = 768
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"

    for proof_name, (action_name, frame) in PROOFS.items():
        action = bpy.data.actions.get(action_name)
        assert action is not None, action_name
        armature.animation_data.action = action
        scene.frame_set(frame)
        if proof_name == "death":
            camera.location = (4.25, -7.0, 2.05)
            camera.data.lens = 50.0
            look_at(camera, Vector((0.0, 0.0, 0.65)))
        else:
            camera.location = (3.1, -5.25, 2.30)
            camera.data.lens = 68.0
            look_at(camera, Vector((0.0, 0.0, 1.30)))
        scene.render.filepath = str(ARTIFACTS / f"orc_legionary_conventional_{proof_name}.png")
        bpy.ops.render.render(write_still=True)

    camera.location = (3.1, -5.25, 2.30)
    camera.data.lens = 68.0
    look_at(camera, Vector((0.0, 0.0, 1.30)))
    scene.render.resolution_x = 512
    scene.render.resolution_y = 512
    scene.render.image_settings.file_format = "FFMPEG"
    scene.render.ffmpeg.format = "MPEG4"
    scene.render.ffmpeg.codec = "H264"
    scene.render.ffmpeg.constant_rate_factor = "MEDIUM"
    scene.render.fps = 30
    for proof_name, (action_name, end_frame) in MOTION_PROOFS.items():
        armature.animation_data.action = bpy.data.actions.get(action_name)
        scene.frame_start = 1
        scene.frame_end = end_frame
        scene.render.filepath = str(ARTIFACTS / f"orc_legionary_conventional_{proof_name}.mp4")
        bpy.ops.render.render(animation=True)

    armature.animation_data.action = bpy.data.actions.get("Idle")
    scene.frame_set(1)
    print(f"CONVENTIONAL_PROOFS_OK stills={len(PROOFS)} motion={len(MOTION_PROOFS)} artifacts={ARTIFACTS}")


if __name__ == "__main__":
    main()
