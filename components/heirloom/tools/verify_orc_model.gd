extends SceneTree


func _init() -> void:
	call_deferred("_verify")


func _verify() -> void:
	var packed := load("res://characters/orc_legionary/production/orc_legionary.glb") as PackedScene
	assert(packed != null, "production GLB did not import")
	var model := packed.instantiate()
	root.add_child(model)
	var skeletons := model.find_children("*", "Skeleton3D", true, false)
	var meshes := model.find_children("*", "MeshInstance3D", true, false)
	var players := model.find_children("*", "AnimationPlayer", true, false)
	assert(skeletons.size() == 1, "production model must have one skeleton")
	assert(meshes.size() >= 2, "production body and props are missing")
	assert(players.size() == 1, "production model must have one animation player")
	var animation_player := players[0] as AnimationPlayer
	var names: PackedStringArray = animation_player.get_animation_list()
	for required in ["Idle", "Walk", "Run", "AxeAttack", "ShieldBash", "Hit", "Death"]:
		assert(required in names, "missing animation: %s" % required)
		var animation := animation_player.get_animation(required)
		assert(animation.length > 0.0 and animation.get_track_count() > 0, "empty animation: %s" % required)
	animation_player.play("AxeAttack")
	await process_frame
	print("ORC_MODEL_GODOT_OK meshes=%d animations=%s" % [meshes.size(), names])
	quit()
