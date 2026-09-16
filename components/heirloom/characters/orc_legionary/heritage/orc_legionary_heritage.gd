extends Node3D

const MODEL_YAW := 180.0

var skeleton: Skeleton3D
var model: Node3D
var _clock := 0.0
var _moving := false
var _defeated := false
var _attack_tween: Tween
var _reaction_tween: Tween


func _ready() -> void:
	model = get_node("Model") as Node3D
	model.rotation_degrees.y = MODEL_YAW
	var found := find_children("*", "Skeleton3D", true, false)
	if found.is_empty():
		push_error("Heritage legionary is missing its Skeleton3D")
		set_process(false)
		return
	skeleton = found[0] as Skeleton3D
	_lift_painted_materials()


func _process(delta: float) -> void:
	_clock += delta
	if _defeated or skeleton == null:
		return
	var speed := 7.0 if _moving else 1.7
	model.position.y = absf(sin(_clock * speed)) * (0.035 if _moving else 0.008)


func set_moving(value: bool) -> void:
	_moving = value and not _defeated


func play_attack() -> void:
	if _defeated:
		return
	if is_instance_valid(_attack_tween):
		_attack_tween.kill()
	_attack_tween = create_tween()
	_attack_tween.set_trans(Tween.TRANS_QUAD)
	_attack_tween.set_ease(Tween.EASE_IN)
	_attack_tween.tween_property(model, "rotation_degrees", Vector3(-12.0, MODEL_YAW, 0.0), 0.14)
	_attack_tween.parallel().tween_property(model, "position:z", -0.18, 0.14)
	_attack_tween.tween_property(model, "rotation_degrees", Vector3(14.0, MODEL_YAW, 0.0), 0.18)
	_attack_tween.set_ease(Tween.EASE_OUT)
	_attack_tween.tween_property(model, "rotation_degrees", Vector3(0.0, MODEL_YAW, 0.0), 0.27)
	_attack_tween.parallel().tween_property(model, "position:z", 0.0, 0.27)


func play_hit() -> void:
	if _defeated:
		return
	if is_instance_valid(_reaction_tween):
		_reaction_tween.kill()
	_reaction_tween = create_tween()
	model.scale = Vector3(1.035, 0.97, 1.035)
	model.rotation_degrees.z = -4.0
	_reaction_tween.set_trans(Tween.TRANS_BACK)
	_reaction_tween.tween_property(model, "scale", Vector3.ONE, 0.18)
	_reaction_tween.parallel().tween_property(model, "rotation_degrees:z", 0.0, 0.18)


func play_defeat() -> void:
	_defeated = true
	_moving = false
	if is_instance_valid(_attack_tween):
		_attack_tween.kill()
	if is_instance_valid(_reaction_tween):
		_reaction_tween.kill()
	_reaction_tween = create_tween()
	_reaction_tween.set_trans(Tween.TRANS_QUAD)
	_reaction_tween.set_ease(Tween.EASE_IN)
	_reaction_tween.tween_property(model, "rotation_degrees", Vector3(-8.0, MODEL_YAW, 84.0), 0.48)
	_reaction_tween.parallel().tween_property(model, "position:y", 0.08, 0.48)


func reset_pose() -> void:
	if is_instance_valid(_attack_tween):
		_attack_tween.kill()
	if is_instance_valid(_reaction_tween):
		_reaction_tween.kill()
	_defeated = false
	_moving = false
	model.position = Vector3.ZERO
	model.rotation_degrees = Vector3(0.0, MODEL_YAW, 0.0)
	model.scale = Vector3.ONE
	if skeleton != null:
		skeleton.reset_bone_poses()


func _lift_painted_materials() -> void:
	for node in find_children("*", "MeshInstance3D", true, false):
		var mesh_instance := node as MeshInstance3D
		for surface in range(mesh_instance.mesh.get_surface_count()):
			var source := mesh_instance.mesh.surface_get_material(surface) as StandardMaterial3D
			if source == null:
				continue
			var material := source.duplicate() as StandardMaterial3D
			material.emission_enabled = true
			material.emission = Color.WHITE
			material.emission_texture = material.albedo_texture
			material.emission_energy_multiplier = 0.8 if material.resource_name == "Eye" else 0.045
			mesh_instance.set_surface_override_material(surface, material)
