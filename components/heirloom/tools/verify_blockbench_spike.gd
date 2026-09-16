extends SceneTree


const MODEL_PATH := "res://characters/orc_legionary/studies/blockbench/heirloom_blockbench_spike.glb"


func _init() -> void:
	call_deferred("_verify")


func _verify() -> void:
	var packed := load(MODEL_PATH) as PackedScene
	if not _require(packed != null, "Blockbench GLB did not import"):
		return
	var model := packed.instantiate()
	root.add_child(model)

	var skeletons := model.find_children("*", "Skeleton3D", true, false)
	var meshes := model.find_children("*", "MeshInstance3D", true, false)
	var players := model.find_children("*", "AnimationPlayer", true, false)
	if not _require(skeletons.size() == 1, "expected one Blockbench skeleton"):
		return
	if not _require(meshes.size() == 1, "expected one skinned mesh"):
		return
	if not _require(players.size() == 1, "expected one animation player"):
		return

	var skeleton := skeletons[0] as Skeleton3D
	if not _require(skeleton.get_bone_count() == 3, "expected three Blockbench bones"):
		return
	if not _require(skeleton.get_bone_name(0).begins_with("torso"), "missing torso root bone"):
		return
	for bone_name in [&"head", &"arm_r"]:
		if not _require(skeleton.find_bone(bone_name) >= 0, "missing bone: %s" % bone_name):
			return

	var animation_player := players[0] as AnimationPlayer
	if not _require(&"arm_swing" in animation_player.get_animation_list(), "missing arm_swing"):
		return
	var arm_swing := animation_player.get_animation(&"arm_swing")
	if not _require(arm_swing != null and arm_swing.length == 2.0, "arm_swing length changed"):
		return
	if not _require(arm_swing.get_track_count() > 0, "arm_swing has no tracks"):
		return

	var mesh_instance := meshes[0] as MeshInstance3D
	var array_mesh := mesh_instance.mesh
	if not _require(array_mesh != null and array_mesh.get_surface_count() == 1, "invalid spike mesh"):
		return
	var arrays := array_mesh.surface_get_arrays(0)
	var indices: PackedInt32Array = arrays[Mesh.ARRAY_INDEX]
	if not _require(indices.size() / 3 == 72, "unexpected triangle count"):
		return
	var material := array_mesh.surface_get_material(0) as StandardMaterial3D
	if not _require(material != null and material.albedo_texture != null, "missing embedded atlas"):
		return
	if not _require(material.albedo_texture.get_width() == 16 and material.albedo_texture.get_height() == 16, "atlas is not 16x16"):
		return

	animation_player.play(&"arm_swing")
	animation_player.seek(1.0, true)
	await process_frame
	print("BLOCKBENCH_SPIKE_GODOT_OK bones=%d triangles=%d animation=arm_swing atlas=16x16" % [skeleton.get_bone_count(), indices.size() / 3])
	quit()


func _require(condition: bool, message: String) -> bool:
	if condition:
		return true
	push_error(message)
	quit(1)
	return false
