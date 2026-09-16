extends SceneTree


const MODEL_PATH := "res://characters/orc_legionary/production/orc_legionary_conventional.glb"
const REQUIRED_ANIMATIONS := [&"Idle", &"Walk", &"Run", &"AxeAttack", &"ShieldBash", &"Hit", &"Death"]


func _init() -> void:
	call_deferred("_verify")


func _verify() -> void:
	var packed := load(MODEL_PATH) as PackedScene
	assert(packed != null, "conventional GLB did not import")
	var model := packed.instantiate()
	root.add_child(model)
	var skeletons := model.find_children("*", "Skeleton3D", true, false)
	var meshes := model.find_children("*", "MeshInstance3D", true, false)
	var players := model.find_children("*", "AnimationPlayer", true, false)
	assert(skeletons.size() == 1, "conventional model must have one skeleton")
	assert(meshes.size() == 3, "expected body, shield, and axe meshes")
	assert(players.size() == 1, "conventional model must have one animation player")

	var skeleton := skeletons[0] as Skeleton3D
	assert(skeleton.find_bone("weapon.R") >= 0, "missing right-hand equipment bone")
	assert(skeleton.find_bone("shield.L") >= 0, "missing left-hand equipment bone")
	var animation_player := players[0] as AnimationPlayer
	var names := animation_player.get_animation_list()
	for required in REQUIRED_ANIMATIONS:
		assert(required in names, "missing animation: %s" % required)
		var animation := animation_player.get_animation(required)
		assert(animation.length > 0.0 and animation.get_track_count() > 0, "empty animation: %s" % required)

	var triangles := 0
	for mesh_instance in meshes:
		var array_mesh := (mesh_instance as MeshInstance3D).mesh
		assert(array_mesh != null, "empty mesh instance")
		for surface in array_mesh.get_surface_count():
			var arrays := array_mesh.surface_get_arrays(surface)
			var indices: PackedInt32Array = arrays[Mesh.ARRAY_INDEX]
			triangles += indices.size() / 3
	assert(triangles > 3000 and triangles < 8000, "unexpected triangle budget: %d" % triangles)

	animation_player.play(&"AxeAttack")
	await process_frame
	print("CONVENTIONAL_ORC_GODOT_OK meshes=%d triangles=%d animations=%s" % [meshes.size(), triangles, names])
	quit()
