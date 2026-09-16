extends Node3D

## First reusable Ashen Legion body.
## Geometry is intentionally authored in Godot so the playable proof has no
## external modeling dependency. Limb nodes are already separated for animation.

var impact_root: Node3D
var model_root: Node3D
var torso_pivot: Node3D
var head_pivot: Node3D
var left_arm: Node3D
var right_arm: Node3D
var left_leg: Node3D
var right_leg: Node3D
var weapon_pivot: Node3D
var _clock := 0.0
var _moving := false
var _attacking := false
var _defeated := false
var _attack_tween: Tween
var _reaction_tween: Tween


func _ready() -> void:
	_build_model()


func _process(delta: float) -> void:
	_clock += delta
	if _defeated:
		return

	var stride_amount := 24.0 if _moving else 2.2
	var stride_speed := 7.2 if _moving else 1.8
	var stride := sin(_clock * stride_speed) * stride_amount
	left_leg.rotation_degrees.x = stride
	right_leg.rotation_degrees.x = -stride
	left_arm.rotation_degrees = Vector3(-stride * 0.34 - 4.0, 0.0, -7.0)
	if not _attacking:
		right_arm.rotation_degrees = Vector3(stride * 0.34 - 3.0, 0.0, 7.0)
	torso_pivot.rotation_degrees.z = sin(_clock * stride_speed) * (1.6 if _moving else 0.35)
	head_pivot.rotation_degrees.y = sin(_clock * 0.72) * 2.0
	model_root.position.y = absf(sin(_clock * stride_speed)) * (0.035 if _moving else 0.009)


func set_moving(value: bool) -> void:
	_moving = value and not _defeated


func play_attack() -> void:
	if _defeated:
		return
	if is_instance_valid(_attack_tween):
		_attack_tween.kill()
	_attacking = true
	right_arm.rotation_degrees = Vector3(-68.0, -12.0, 18.0)
	weapon_pivot.rotation_degrees.z = -12.0
	_attack_tween = create_tween()
	_attack_tween.set_trans(Tween.TRANS_QUAD)
	_attack_tween.set_ease(Tween.EASE_IN)
	_attack_tween.tween_property(right_arm, "rotation_degrees", Vector3(54.0, 8.0, -18.0), 0.19)
	_attack_tween.parallel().tween_property(weapon_pivot, "rotation_degrees:z", 22.0, 0.19)
	_attack_tween.set_ease(Tween.EASE_OUT)
	_attack_tween.tween_property(right_arm, "rotation_degrees", Vector3(-3.0, 0.0, 7.0), 0.28)
	_attack_tween.parallel().tween_property(weapon_pivot, "rotation_degrees:z", 0.0, 0.28)
	_attack_tween.finished.connect(func() -> void: _attacking = false)


func play_hit() -> void:
	if _defeated:
		return
	if is_instance_valid(_reaction_tween):
		_reaction_tween.kill()
	_reaction_tween = create_tween()
	_reaction_tween.set_trans(Tween.TRANS_BACK)
	impact_root.scale = Vector3(1.04, 0.96, 1.04)
	impact_root.rotation_degrees.z = -5.0
	_reaction_tween.tween_property(impact_root, "scale", Vector3.ONE, 0.18)
	_reaction_tween.parallel().tween_property(impact_root, "rotation_degrees:z", 0.0, 0.18)


func play_defeat() -> void:
	_defeated = true
	_moving = false
	_attacking = false
	if is_instance_valid(_attack_tween):
		_attack_tween.kill()
	if is_instance_valid(_reaction_tween):
		_reaction_tween.kill()
	_reaction_tween = create_tween()
	_reaction_tween.set_trans(Tween.TRANS_QUAD)
	_reaction_tween.set_ease(Tween.EASE_IN)
	_reaction_tween.tween_property(impact_root, "rotation_degrees", Vector3(-8.0, 0.0, 84.0), 0.48)
	_reaction_tween.parallel().tween_property(impact_root, "position:y", 0.08, 0.48)


func reset_pose() -> void:
	if is_instance_valid(_attack_tween):
		_attack_tween.kill()
	if is_instance_valid(_reaction_tween):
		_reaction_tween.kill()
	_defeated = false
	_moving = false
	_attacking = false
	impact_root.position = Vector3.ZERO
	impact_root.rotation_degrees = Vector3.ZERO
	impact_root.scale = Vector3.ONE
	model_root.position = Vector3.ZERO
	left_leg.rotation_degrees = Vector3.ZERO
	right_leg.rotation_degrees = Vector3.ZERO
	left_arm.rotation_degrees = Vector3(-4.0, 0.0, -7.0)
	right_arm.rotation_degrees = Vector3(-3.0, 0.0, 7.0)
	weapon_pivot.rotation_degrees = Vector3.ZERO


func _build_model() -> void:
	impact_root = Node3D.new()
	impact_root.name = "ImpactRoot"
	add_child(impact_root)
	model_root = Node3D.new()
	model_root.name = "ArticulatedModel"
	impact_root.add_child(model_root)

	var skin := _material(Color("#68695b"), 0.0, 0.91)
	var skin_shadow := _material(Color("#4f5147"), 0.0, 0.96)
	var skin_highlight := _material(Color("#7a7967"), 0.0, 0.88)
	var iron := _material(Color("#202224"), 0.48, 0.73)
	var iron_edge := _material(Color("#444445"), 0.62, 0.61)
	var oxblood := _material(Color("#5a2024"), 0.0, 0.94)
	var oxblood_dark := _material(Color("#321619"), 0.0, 0.98)
	var wool := _material(Color("#242421"), 0.0, 1.0)
	var leather := _material(Color("#3b281f"), 0.0, 0.93)
	var leather_light := _material(Color("#624333"), 0.0, 0.9)
	var brass := _material(Color("#9a793e"), 0.66, 0.54)
	var hair := _material(Color("#151616"), 0.0, 0.97)
	var eye := _material(Color("#d99132"), 0.0, 0.3, Color("#c26d20"), 1.8)
	var mouth := _material(Color("#241a17"), 0.0, 1.0)

	_build_legs(wool, iron, iron_edge, leather, skin_shadow)
	_build_torso(wool, iron, iron_edge, oxblood, oxblood_dark, leather, leather_light, brass)
	_build_arms(skin, skin_shadow, iron, iron_edge, leather, leather_light, oxblood, brass)
	_build_head(skin, skin_shadow, skin_highlight, hair, eye, mouth, iron, oxblood, brass)


func _build_legs(wool: Material, iron: Material, iron_edge: Material, leather: Material, leather_light: Material) -> void:
	left_leg = Node3D.new()
	left_leg.name = "LeftLegPivot"
	left_leg.position = Vector3(-0.20, 1.02, 0.0)
	model_root.add_child(left_leg)
	right_leg = Node3D.new()
	right_leg.name = "RightLegPivot"
	right_leg.position = Vector3(0.20, 1.02, 0.0)
	model_root.add_child(right_leg)

	for leg in [left_leg, right_leg]:
		_add_tapered(leg, Vector3(0.0, -0.25, 0.0), 0.145, 0.175, 0.52, wool)
		_add_sphere(leg, Vector3(0.0, -0.54, -0.015), 0.15, iron_edge, Vector3(1.0, 0.8, 0.9))
		_add_tapered(leg, Vector3(0.0, -0.76, 0.015), 0.12, 0.16, 0.42, leather)
		_add_box(leg, Vector3(0.0, -0.74, -0.135), Vector3(0.25, 0.34, 0.065), iron)
		_add_box(leg, Vector3(0.0, -0.63, -0.175), Vector3(0.27, 0.055, 0.08), iron_edge)
		_add_box(leg, Vector3(0.0, -0.76, -0.178), Vector3(0.27, 0.045, 0.08), iron_edge)
		_add_box(leg, Vector3(0.0, -0.89, -0.17), Vector3(0.27, 0.045, 0.08), iron_edge)
		_add_box(leg, Vector3(0.0, -0.985, -0.12), Vector3(0.28, 0.14, 0.42), leather_light)
		_add_box(leg, Vector3(0.0, -1.015, -0.25), Vector3(0.30, 0.08, 0.34), iron)


func _build_torso(wool: Material, iron: Material, iron_edge: Material, oxblood: Material, oxblood_dark: Material, leather: Material, leather_light: Material, brass: Material) -> void:
	torso_pivot = Node3D.new()
	torso_pivot.name = "TorsoPivot"
	torso_pivot.position = Vector3(0.0, 1.42, 0.0)
	model_root.add_child(torso_pivot)
	_add_frustum(torso_pivot, Vector3(0.0, 0.0, 0.0), Vector2(0.82, 0.42), Vector2(0.58, 0.34), 0.82, wool)

	# Broad lamellar rows: readable material blocks instead of tiny costume noise.
	for row in range(4):
		var width := 0.75 - row * 0.035
		var y := 0.25 - row * 0.17
		_add_box(torso_pivot, Vector3(0.0, y, -0.225), Vector3(width, 0.145, 0.075), iron if row % 2 == 0 else iron_edge)
	_add_box(torso_pivot, Vector3(0.0, 0.02, 0.205), Vector3(0.70, 0.68, 0.07), iron)
	_add_box(torso_pivot, Vector3(-0.36, 0.02, 0.0), Vector3(0.08, 0.65, 0.33), iron_edge)
	_add_box(torso_pivot, Vector3(0.36, 0.02, 0.0), Vector3(0.08, 0.65, 0.33), iron_edge)

	# Oxblood mantle and vertical votive strip.
	_add_box(torso_pivot, Vector3(-0.23, 0.37, -0.255), Vector3(0.42, 0.16, 0.055), oxblood, Vector3(0.0, 0.0, -10.0))
	_add_box(torso_pivot, Vector3(0.23, 0.37, -0.255), Vector3(0.42, 0.16, 0.055), oxblood, Vector3(0.0, 0.0, 10.0))
	_add_box(torso_pivot, Vector3(0.0, -0.02, -0.274), Vector3(0.19, 0.68, 0.045), oxblood)
	_add_box(torso_pivot, Vector3(0.0, 0.01, -0.302), Vector3(0.045, 0.48, 0.018), oxblood_dark)

	# Belt, skirt plates, and the long tabard.
	_add_box(model_root, Vector3(0.0, 0.98, 0.0), Vector3(0.74, 0.16, 0.40), leather)
	_add_box(model_root, Vector3(0.0, 0.98, -0.245), Vector3(0.78, 0.10, 0.06), iron_edge)
	for side in [-1.0, -0.5, 0.5, 1.0]:
		_add_box(model_root, Vector3(side * 0.26, 0.72, 0.0), Vector3(0.17, 0.48, 0.34), iron, Vector3(0.0, 0.0, side * 3.0))
	_add_box(model_root, Vector3(0.0, 0.55, -0.23), Vector3(0.33, 0.78, 0.055), oxblood)
	_add_box(model_root, Vector3(0.0, 0.18, -0.235), Vector3(0.24, 0.10, 0.06), oxblood_dark, Vector3(0.0, 0.0, 8.0))

	# Cloven-moon badge: a restrained, geometric state sigil.
	_add_sphere(torso_pivot, Vector3(0.0, 0.17, -0.332), 0.07, brass, Vector3(1.0, 1.0, 0.28))
	_add_box(torso_pivot, Vector3(-0.065, 0.24, -0.335), Vector3(0.035, 0.18, 0.025), brass, Vector3(0.0, 0.0, -28.0))
	_add_box(torso_pivot, Vector3(0.065, 0.24, -0.335), Vector3(0.035, 0.18, 0.025), brass, Vector3(0.0, 0.0, 28.0))
	_add_box(torso_pivot, Vector3(0.0, 0.09, -0.335), Vector3(0.035, 0.15, 0.025), brass)
	_add_sphere(model_root, Vector3(0.0, 0.98, -0.30), 0.075, brass, Vector3(1.0, 1.0, 0.35))


func _build_arms(skin: Material, skin_shadow: Material, iron: Material, iron_edge: Material, leather: Material, leather_light: Material, oxblood: Material, brass: Material) -> void:
	left_arm = Node3D.new()
	left_arm.name = "ShieldArmPivot"
	left_arm.position = Vector3(-0.50, 1.72, 0.0)
	left_arm.rotation_degrees = Vector3(-4.0, 0.0, -7.0)
	model_root.add_child(left_arm)
	right_arm = Node3D.new()
	right_arm.name = "WeaponArmPivot"
	right_arm.position = Vector3(0.50, 1.72, 0.0)
	right_arm.rotation_degrees = Vector3(-3.0, 0.0, 7.0)
	model_root.add_child(right_arm)

	for arm in [left_arm, right_arm]:
		_add_frustum(arm, Vector3(0.0, -0.04, 0.0), Vector2(0.34, 0.42), Vector2(0.27, 0.34), 0.25, iron_edge)
		_add_box(arm, Vector3(0.0, -0.12, -0.18), Vector3(0.30, 0.12, 0.08), iron)
		_add_tapered(arm, Vector3(0.0, -0.34, 0.0), 0.105, 0.135, 0.43, skin)
		_add_box(arm, Vector3(0.0, -0.49, -0.115), Vector3(0.21, 0.22, 0.06), oxblood)
		_add_tapered(arm, Vector3(0.0, -0.67, 0.0), 0.09, 0.12, 0.34, leather)
		_add_box(arm, Vector3(0.0, -0.64, -0.105), Vector3(0.22, 0.24, 0.07), iron)
		_add_box(arm, Vector3(0.0, -0.56, -0.145), Vector3(0.24, 0.045, 0.075), iron_edge)
		_add_box(arm, Vector3(0.0, -0.69, -0.145), Vector3(0.24, 0.045, 0.075), iron_edge)
		_add_sphere(arm, Vector3(0.0, -0.89, -0.015), 0.12, skin_shadow, Vector3(0.85, 1.15, 0.78))

	_build_shield(left_arm, iron, iron_edge, leather_light, oxblood, brass)
	_build_axe(right_arm, iron, iron_edge, leather, brass)


func _build_shield(parent: Node3D, iron: Material, iron_edge: Material, hide: Material, oxblood: Material, brass: Material) -> void:
	var shield := Node3D.new()
	shield.name = "ClovenMoonShield"
	shield.position = Vector3(-0.05, -0.62, -0.24)
	shield.rotation_degrees = Vector3(-4.0, -10.0, -2.0)
	parent.add_child(shield)
	var outline := PackedVector2Array([
		Vector2(-0.29, 0.65), Vector2(0.29, 0.65), Vector2(0.37, 0.50),
		Vector2(0.37, -0.38), Vector2(0.0, -0.68), Vector2(-0.37, -0.38), Vector2(-0.37, 0.50)
	])
	var face := PackedVector2Array([
		Vector2(-0.25, 0.58), Vector2(0.25, 0.58), Vector2(0.31, 0.45),
		Vector2(0.31, -0.34), Vector2(0.0, -0.59), Vector2(-0.31, -0.34), Vector2(-0.31, 0.45)
	])
	_add_polygon_prism(shield, Vector3.ZERO, outline, 0.13, iron_edge)
	_add_polygon_prism(shield, Vector3(0.0, 0.0, -0.076), face, 0.035, hide)
	_add_box(shield, Vector3(0.0, 0.0, -0.105), Vector3(0.15, 1.04, 0.025), oxblood)
	_add_sphere(shield, Vector3(0.0, 0.04, -0.135), 0.065, brass, Vector3(1.0, 1.0, 0.28))
	_add_box(shield, Vector3(-0.07, 0.15, -0.137), Vector3(0.035, 0.24, 0.025), brass, Vector3(0.0, 0.0, -28.0))
	_add_box(shield, Vector3(0.07, 0.15, -0.137), Vector3(0.035, 0.24, 0.025), brass, Vector3(0.0, 0.0, 28.0))
	_add_box(shield, Vector3(0.0, -0.07, -0.137), Vector3(0.035, 0.19, 0.025), brass)
	for y in [-0.42, 0.0, 0.42]:
		_add_sphere(shield, Vector3(-0.31, y, -0.12), 0.035, brass)
		_add_sphere(shield, Vector3(0.31, y, -0.12), 0.035, brass)


func _build_axe(parent: Node3D, iron: Material, iron_edge: Material, leather: Material, brass: Material) -> void:
	weapon_pivot = Node3D.new()
	weapon_pivot.name = "VotiveAxePivot"
	weapon_pivot.position = Vector3(0.0, -0.86, 0.0)
	parent.add_child(weapon_pivot)
	_add_tapered(weapon_pivot, Vector3(0.0, -0.38, 0.0), 0.045, 0.055, 0.92, leather)
	_add_box(weapon_pivot, Vector3(0.0, -0.24, -0.055), Vector3(0.10, 0.42, 0.035), iron_edge)
	var blade := PackedVector2Array([
		Vector2(-0.06, 0.18), Vector2(0.34, 0.24), Vector2(0.43, 0.08),
		Vector2(0.24, -0.19), Vector2(-0.06, -0.10)
	])
	_add_polygon_prism(weapon_pivot, Vector3(0.0, -0.80, 0.0), blade, 0.12, iron_edge)
	_add_polygon_prism(weapon_pivot, Vector3(0.0, -0.80, -0.065), blade, 0.035, iron)
	_add_sphere(weapon_pivot, Vector3(0.0, -0.80, 0.0), 0.075, brass)
	_add_sphere(weapon_pivot, Vector3(0.0, 0.08, 0.0), 0.06, brass)


func _build_head(skin: Material, skin_shadow: Material, skin_highlight: Material, hair: Material, eye: Material, mouth: Material, iron: Material, oxblood: Material, brass: Material) -> void:
	head_pivot = Node3D.new()
	head_pivot.name = "StoneMaskHeadPivot"
	head_pivot.position = Vector3(0.0, 2.13, -0.01)
	model_root.add_child(head_pivot)
	_add_sphere(head_pivot, Vector3(0.0, 0.08, 0.0), 0.31, skin, Vector3(0.92, 1.06, 0.82))
	_add_frustum(head_pivot, Vector3(0.0, -0.18, -0.035), Vector2(0.36, 0.31), Vector2(0.27, 0.25), 0.31, skin_shadow)

	# Continuous brow/nasal stone-mask plane and its shallow cleft.
	_add_box(head_pivot, Vector3(0.0, 0.06, -0.245), Vector3(0.34, 0.11, 0.09), skin_highlight, Vector3(-8.0, 0.0, 0.0))
	_add_frustum(head_pivot, Vector3(0.0, -0.075, -0.285), Vector2(0.18, 0.15), Vector2(0.12, 0.11), 0.27, skin_highlight, Vector3(-8.0, 0.0, 0.0))
	_add_box(head_pivot, Vector3(0.0, -0.06, -0.37), Vector3(0.018, 0.20, 0.018), skin_shadow)

	# Deep-set amber eyes.
	_add_sphere(head_pivot, Vector3(-0.105, 0.025, -0.302), 0.037, eye, Vector3(1.35, 0.58, 0.42))
	_add_sphere(head_pivot, Vector3(0.105, 0.025, -0.302), 0.037, eye, Vector3(1.35, 0.58, 0.42))

	# Down-swept ears, narrow mouth, and deliberately restrained canines.
	_add_tapered(head_pivot, Vector3(-0.31, -0.03, 0.015), 0.025, 0.11, 0.35, skin_shadow, Vector3(0.0, 0.0, -76.0))
	_add_tapered(head_pivot, Vector3(0.31, -0.03, 0.015), 0.025, 0.11, 0.35, skin_shadow, Vector3(0.0, 0.0, 76.0))
	_add_box(head_pivot, Vector3(0.0, -0.255, -0.242), Vector3(0.25, 0.025, 0.04), mouth)
	_add_tapered(head_pivot, Vector3(-0.078, -0.275, -0.285), 0.012, 0.028, 0.075, skin_highlight)
	_add_tapered(head_pivot, Vector3(0.078, -0.275, -0.285), 0.012, 0.028, 0.075, skin_highlight)

	# One continuous crown-to-nape mane rather than human hair or dreadlocks.
	for index in range(7):
		var y := 0.34 - index * 0.105
		var z := 0.06 + index * 0.055
		var scale_value := 0.11 + index * 0.012
		_add_frustum(head_pivot, Vector3(0.0, y, z), Vector2(scale_value, 0.11), Vector2(scale_value * 0.55, 0.07), 0.20 + index * 0.015, hair, Vector3(18.0, 0.0, 0.0))

	# Armored collar keeps the face readable while tying it back to the legion kit.
	_add_box(model_root, Vector3(0.0, 1.89, 0.06), Vector3(0.46, 0.18, 0.38), oxblood)
	_add_box(model_root, Vector3(0.0, 1.90, -0.18), Vector3(0.42, 0.13, 0.07), iron)
	_add_sphere(model_root, Vector3(0.0, 1.90, -0.235), 0.055, brass, Vector3(1.0, 1.0, 0.3))


func _material(color: Color, metallic: float, roughness: float, emission := Color.BLACK, emission_energy := 0.0) -> StandardMaterial3D:
	var material := StandardMaterial3D.new()
	material.albedo_color = color
	material.metallic = metallic
	material.roughness = roughness
	if emission_energy > 0.0:
		material.emission_enabled = true
		material.emission = emission
		material.emission_energy_multiplier = emission_energy
	return material


func _add_box(parent: Node3D, position_value: Vector3, size: Vector3, material: Material, rotation_value := Vector3.ZERO) -> MeshInstance3D:
	var mesh := BoxMesh.new()
	mesh.size = size
	return _add_mesh(parent, position_value, mesh, material, rotation_value)


func _add_sphere(parent: Node3D, position_value: Vector3, radius: float, material: Material, scale_value := Vector3.ONE) -> MeshInstance3D:
	var mesh := SphereMesh.new()
	mesh.radius = radius
	mesh.height = radius * 2.0
	mesh.radial_segments = 8
	mesh.rings = 5
	var node := _add_mesh(parent, position_value, mesh, material)
	node.scale = scale_value
	return node


func _add_tapered(parent: Node3D, position_value: Vector3, top_radius: float, bottom_radius: float, height: float, material: Material, rotation_value := Vector3.ZERO) -> MeshInstance3D:
	var mesh := CylinderMesh.new()
	mesh.top_radius = top_radius
	mesh.bottom_radius = bottom_radius
	mesh.height = height
	mesh.radial_segments = 7
	return _add_mesh(parent, position_value, mesh, material, rotation_value)


func _add_frustum(parent: Node3D, position_value: Vector3, top_size: Vector2, bottom_size: Vector2, height: float, material: Material, rotation_value := Vector3.ZERO) -> MeshInstance3D:
	return _add_mesh(parent, position_value, _frustum_mesh(top_size, bottom_size, height), material, rotation_value)


func _add_polygon_prism(parent: Node3D, position_value: Vector3, points: PackedVector2Array, depth: float, material: Material, rotation_value := Vector3.ZERO) -> MeshInstance3D:
	return _add_mesh(parent, position_value, _polygon_prism_mesh(points, depth), material, rotation_value)


func _add_mesh(parent: Node3D, position_value: Vector3, mesh: Mesh, material: Material, rotation_value := Vector3.ZERO) -> MeshInstance3D:
	var node := MeshInstance3D.new()
	node.mesh = mesh
	node.material_override = material
	node.position = position_value
	node.rotation_degrees = rotation_value
	parent.add_child(node)
	return node


func _frustum_mesh(top_size: Vector2, bottom_size: Vector2, height: float) -> ArrayMesh:
	var top_y := height * 0.5
	var bottom_y := -top_y
	var vertices := PackedVector3Array([
		Vector3(-top_size.x * 0.5, top_y, -top_size.y * 0.5),
		Vector3(top_size.x * 0.5, top_y, -top_size.y * 0.5),
		Vector3(top_size.x * 0.5, top_y, top_size.y * 0.5),
		Vector3(-top_size.x * 0.5, top_y, top_size.y * 0.5),
		Vector3(-bottom_size.x * 0.5, bottom_y, -bottom_size.y * 0.5),
		Vector3(bottom_size.x * 0.5, bottom_y, -bottom_size.y * 0.5),
		Vector3(bottom_size.x * 0.5, bottom_y, bottom_size.y * 0.5),
		Vector3(-bottom_size.x * 0.5, bottom_y, bottom_size.y * 0.5),
	])
	var indices := PackedInt32Array([
		0, 3, 2, 0, 2, 1,
		4, 5, 6, 4, 6, 7,
		0, 1, 5, 0, 5, 4,
		1, 2, 6, 1, 6, 5,
		2, 3, 7, 2, 7, 6,
		3, 0, 4, 3, 4, 7,
	])
	return _mesh_from_triangles(vertices, indices)


func _polygon_prism_mesh(points: PackedVector2Array, depth: float) -> ArrayMesh:
	var vertices := PackedVector3Array()
	var indices := PackedInt32Array()
	var half_depth := depth * 0.5
	for point in points:
		vertices.append(Vector3(point.x, point.y, -half_depth))
	for point in points:
		vertices.append(Vector3(point.x, point.y, half_depth))
	var count := points.size()
	for index in range(1, count - 1):
		indices.append_array(PackedInt32Array([0, index, index + 1]))
		indices.append_array(PackedInt32Array([count, count + index + 1, count + index]))
	for index in range(count):
		var next := (index + 1) % count
		indices.append_array(PackedInt32Array([index, count + next, next]))
		indices.append_array(PackedInt32Array([index, count + index, count + next]))
	return _mesh_from_triangles(vertices, indices)


func _mesh_from_triangles(vertices: PackedVector3Array, indices: PackedInt32Array) -> ArrayMesh:
	var surface := SurfaceTool.new()
	surface.begin(Mesh.PRIMITIVE_TRIANGLES)
	for index in indices:
		surface.add_vertex(vertices[index])
	surface.generate_normals()
	return surface.commit()
