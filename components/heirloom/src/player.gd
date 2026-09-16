extends CharacterBody3D

const SPEED := 5.2
const ACCELERATION := 18.0
const GRAVITY := 24.0
const TURN_SPEED := deg_to_rad(105.0)
const BACKPEDAL_MULTIPLIER := 0.58
const STRAFE_MULTIPLIER := 0.82
const MOUSE_SENSITIVITY := 0.0025

var camera: Camera3D
var camera_pivot: Node3D
var spring_arm: SpringArm3D
var visual: Node3D
var weapon_pivot: Node3D
var _pitch := deg_to_rad(-12.0)
var _attacking := false
var _left_mouse_held := false
var _right_mouse_held := false
var _hit_tween: Tween


func _ready() -> void:
	_build_body()
	_build_camera()
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE


func _physics_process(delta: float) -> void:
	if not is_on_floor():
		velocity.y -= GRAVITY * delta
	else:
		velocity.y = -0.5

	var forward_input := Input.get_action_strength("move_forward") - Input.get_action_strength("move_backward")
	if _left_mouse_held and _right_mouse_held:
		forward_input = 1.0
	var turn_input := Input.get_action_strength("move_right") - Input.get_action_strength("move_left")
	if not _right_mouse_held:
		rotation.y -= turn_input * TURN_SPEED * delta

	var forward := -global_basis.z
	var right := global_basis.x
	forward.y = 0.0
	right.y = 0.0
	forward = forward.normalized()
	right = right.normalized()
	var forward_weight := forward_input if forward_input >= 0.0 else forward_input * BACKPEDAL_MULTIPLIER
	var strafe_weight := turn_input * STRAFE_MULTIPLIER if _right_mouse_held else 0.0
	var direction := forward * forward_weight + right * strafe_weight
	if direction.length_squared() > 1.0:
		direction = direction.normalized()
	var desired := direction * SPEED
	velocity.x = move_toward(velocity.x, desired.x, ACCELERATION * delta)
	velocity.z = move_toward(velocity.z, desired.z, ACCELERATION * delta)
	move_and_slide()

	if direction.length_squared() > 0.01 and not _attacking:
		visual.position.y = sin(Time.get_ticks_msec() * 0.012) * 0.035
	else:
		visual.position.y = move_toward(visual.position.y, 0.0, delta * 0.3)


func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventMouseMotion:
		if _right_mouse_held:
			rotation.y -= event.relative.x * MOUSE_SENSITIVITY
			_pitch = clamp(_pitch - event.relative.y * 0.002, deg_to_rad(-50.0), deg_to_rad(18.0))
			camera_pivot.rotation.x = _pitch
		elif _left_mouse_held:
			camera_pivot.rotation.y -= event.relative.x * MOUSE_SENSITIVITY
			_pitch = clamp(_pitch - event.relative.y * 0.002, deg_to_rad(-50.0), deg_to_rad(18.0))
			camera_pivot.rotation.x = _pitch
	elif event is InputEventMouseButton:
		if event.button_index == MOUSE_BUTTON_WHEEL_UP and event.pressed:
			spring_arm.spring_length = max(3.2, spring_arm.spring_length - 0.45)
		elif event.button_index == MOUSE_BUTTON_WHEEL_DOWN and event.pressed:
			spring_arm.spring_length = min(8.0, spring_arm.spring_length + 0.45)
		elif event.button_index == MOUSE_BUTTON_RIGHT:
			if event.pressed and not _right_mouse_held:
				rotation.y += camera_pivot.rotation.y
				camera_pivot.rotation.y = 0.0
			_right_mouse_held = event.pressed
			_update_mouse_capture()
		elif event.button_index == MOUSE_BUTTON_LEFT:
			_left_mouse_held = event.pressed
			_update_mouse_capture()
	elif event.is_action_pressed("release_mouse"):
		_left_mouse_held = false
		_right_mouse_held = false
		_update_mouse_capture()


func _update_mouse_capture() -> void:
	Input.mouse_mode = Input.MOUSE_MODE_CAPTURED if _left_mouse_held or _right_mouse_held else Input.MOUSE_MODE_VISIBLE


func play_swing() -> void:
	_attacking = true
	weapon_pivot.rotation_degrees = Vector3(0.0, 0.0, -32.0)
	var tween := create_tween()
	tween.set_trans(Tween.TRANS_QUAD)
	tween.set_ease(Tween.EASE_OUT)
	tween.tween_property(weapon_pivot, "rotation_degrees", Vector3(0.0, 0.0, 78.0), 0.13)
	tween.set_ease(Tween.EASE_IN_OUT)
	tween.tween_property(weapon_pivot, "rotation_degrees", Vector3(0.0, 0.0, -32.0), 0.22)
	tween.finished.connect(func() -> void: _attacking = false)


func play_hit_feedback(strength := 1.0) -> void:
	if _hit_tween != null and _hit_tween.is_valid():
		_hit_tween.kill()
	var side := -1.0 if Time.get_ticks_msec() % 2 == 0 else 1.0
	camera.position = Vector3(0.075 * side * strength, -0.035 * strength, 0.0)
	camera.fov = 61.0 + 2.0 * strength
	visual.rotation_degrees.z = 2.8 * side * strength
	_hit_tween = create_tween().set_parallel(true)
	_hit_tween.set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_OUT)
	_hit_tween.tween_property(camera, "position", Vector3.ZERO, 0.18)
	_hit_tween.tween_property(camera, "fov", 61.0, 0.22)
	_hit_tween.tween_property(visual, "rotation_degrees:z", 0.0, 0.20)


func _build_body() -> void:
	var collision := CollisionShape3D.new()
	var shape := CapsuleShape3D.new()
	shape.radius = 0.42
	shape.height = 1.9
	collision.shape = shape
	collision.position.y = 0.95
	add_child(collision)

	visual = Node3D.new()
	visual.name = "LowPolyKnight"
	add_child(visual)

	var iron := _material(Color("#24282b"), 0.34, 0.92)
	var iron_light := _material(Color("#555b5b"), 0.58, 0.86)
	var cloth := _material(Color("#34192e"), 0.0, 0.96)
	var leather := _material(Color("#4b3122"), 0.0, 1.0)
	var skin := _material(Color("#89644a"), 0.0, 0.92)
	var amethyst := _material(Color("#8f55d4"), 0.18, 0.55, Color("#5f2f9d"), 1.8)

	_add_capsule(visual, Vector3(0.0, 1.25, 0.0), 0.43, 1.18, iron)
	_add_sphere(visual, Vector3(0.0, 2.05, -0.01), 0.31, iron_light, Vector3(1.0, 1.08, 0.95))
	_add_box(visual, Vector3(0.0, 1.1, 0.31), Vector3(0.78, 0.95, 0.08), cloth)
	_add_box(visual, Vector3(0.0, 0.7, 0.0), Vector3(0.86, 0.24, 0.48), leather)
	_add_box(visual, Vector3(-0.47, 1.42, 0.0), Vector3(0.24, 0.30, 0.48), iron_light)
	_add_box(visual, Vector3(0.47, 1.42, 0.0), Vector3(0.24, 0.30, 0.48), iron_light)
	_add_capsule(visual, Vector3(-0.52, 0.98, 0.0), 0.12, 0.82, skin, Vector3(0.0, 0.0, -8.0))
	_add_capsule(visual, Vector3(0.52, 0.98, 0.0), 0.12, 0.82, skin, Vector3(0.0, 0.0, 8.0))
	_add_capsule(visual, Vector3(-0.2, 0.28, 0.0), 0.14, 0.65, leather)
	_add_capsule(visual, Vector3(0.2, 0.28, 0.0), 0.14, 0.65, leather)
	_add_sphere(visual, Vector3(0.0, 1.52, 0.42), 0.09, amethyst)

	weapon_pivot = Node3D.new()
	weapon_pivot.name = "AxePivot"
	weapon_pivot.position = Vector3(0.58, 1.45, -0.03)
	weapon_pivot.rotation_degrees.z = -32.0
	visual.add_child(weapon_pivot)
	_add_cylinder(weapon_pivot, Vector3(0.0, -0.48, 0.0), 0.045, 1.25, leather)
	_add_box(weapon_pivot, Vector3(0.12, -1.03, 0.0), Vector3(0.42, 0.25, 0.10), iron_light, Vector3(0.0, 0.0, -14.0))
	_add_sphere(weapon_pivot, Vector3(0.0, 0.16, 0.0), 0.075, amethyst)


func _build_camera() -> void:
	camera_pivot = Node3D.new()
	camera_pivot.name = "CameraPivot"
	camera_pivot.position = Vector3(0.0, 1.65, 0.0)
	camera_pivot.rotation.x = _pitch
	add_child(camera_pivot)

	spring_arm = SpringArm3D.new()
	spring_arm.spring_length = 5.4
	spring_arm.margin = 0.18
	camera_pivot.add_child(spring_arm)

	camera = Camera3D.new()
	camera.current = true
	camera.fov = 61.0
	camera.near = 0.08
	spring_arm.add_child(camera)

	var readability_fill := SpotLight3D.new()
	readability_fill.position = Vector3(-0.9, 0.35, 0.15)
	readability_fill.light_color = Color("#ffd0a3")
	readability_fill.light_energy = 2.2
	readability_fill.spot_range = 10.0
	readability_fill.spot_angle = 42.0
	readability_fill.shadow_enabled = false
	camera.add_child(readability_fill)


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


func _add_box(parent: Node3D, position_value: Vector3, size: Vector3, material: Material, rotation_degrees_value := Vector3.ZERO) -> MeshInstance3D:
	var mesh := BoxMesh.new()
	mesh.size = size
	var node := MeshInstance3D.new()
	node.mesh = mesh
	node.material_override = material
	node.position = position_value
	node.rotation_degrees = rotation_degrees_value
	parent.add_child(node)
	return node


func _add_sphere(parent: Node3D, position_value: Vector3, radius: float, material: Material, scale_value := Vector3.ONE) -> MeshInstance3D:
	var mesh := SphereMesh.new()
	mesh.radius = radius
	mesh.height = radius * 2.0
	mesh.radial_segments = 8
	mesh.rings = 4
	var node := MeshInstance3D.new()
	node.mesh = mesh
	node.material_override = material
	node.position = position_value
	node.scale = scale_value
	parent.add_child(node)
	return node


func _add_capsule(parent: Node3D, position_value: Vector3, radius: float, height: float, material: Material, rotation_degrees_value := Vector3.ZERO) -> MeshInstance3D:
	var mesh := CapsuleMesh.new()
	mesh.radius = radius
	mesh.height = height
	mesh.radial_segments = 8
	mesh.rings = 2
	var node := MeshInstance3D.new()
	node.mesh = mesh
	node.material_override = material
	node.position = position_value
	node.rotation_degrees = rotation_degrees_value
	parent.add_child(node)
	return node


func _add_cylinder(parent: Node3D, position_value: Vector3, radius: float, height: float, material: Material) -> MeshInstance3D:
	var mesh := CylinderMesh.new()
	mesh.top_radius = radius
	mesh.bottom_radius = radius * 1.08
	mesh.height = height
	mesh.radial_segments = 7
	var node := MeshInstance3D.new()
	node.mesh = mesh
	node.material_override = material
	node.position = position_value
	parent.add_child(node)
	return node
