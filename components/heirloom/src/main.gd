extends Node3D

const PlayerController = preload("res://src/player.gd")
const OrcLegionaryScene = preload("res://characters/orc_legionary/production/orc_legionary.tscn")
const ConventionalOrcLegionaryScene = preload("res://characters/orc_legionary/production/orc_legionary_conventional.tscn")
const AXE_SWING_SFX = preload("res://audio/sfx/axe_swing.wav")
const ARMOR_HIT_SFX = preload("res://audio/sfx/armor_hit.wav")
const SHIELD_BASH_SFX = preload("res://audio/sfx/shield_bash.wav")
const ARMOR_DEATH_SFX = preload("res://audio/sfx/armor_death.wav")
const SWING_TIME := 2.4
const ENEMY_SWING_TIME := 3.1
const AXE_IMPACT_DELAY := 0.50
const SHIELD_IMPACT_DELAY := 0.43
const MELEE_RANGE := 2.75
const MELEE_FACING_HALF_ANGLE_DEGREES := 60.0
const ENEMY_FACING_HALF_ANGLE_DEGREES := 48.0
const ENEMY_MAX_HEALTH := 120
const PLAYER_MAX_HEALTH := 160

var player: CharacterBody3D
var enemy: Node3D
var enemy_visual: Node3D
var enemy_label: Label3D
var target_disc: MeshInstance3D
var enemy_health := ENEMY_MAX_HEALTH
var player_health := PLAYER_MAX_HEALTH
var auto_attacking := false
var swing_elapsed := 0.0
var enemy_swing_elapsed := 0.0
var enemy_attack_pending := false
var enemy_attack_generation := 0
var enemy_attack_count := 0
var enemy_alive := true
var message_time := 0.0
var rng := RandomNumberGenerator.new()
var torch_lights: Array[OmniLight3D] = []
var player_health_bar: ProgressBar
var target_health_bar: ProgressBar
var swing_bar: ProgressBar
var player_health_text: Label
var target_health_text: Label
var swing_text: Label
var state_text: Label
var range_text: Label


func _ready() -> void:
	rng.seed = 7301989
	_bind_inputs()
	_build_environment()
	_build_ground()
	_build_ruined_gate()
	_build_forest()
	_build_player()
	_build_enemy()
	_build_hud()
	_update_hud()
	if "--combat-capture" in OS.get_cmdline_user_args():
		_capture_combat_after_frames.call_deferred()
	elif "--motion-capture" in OS.get_cmdline_user_args():
		_capture_motion_after_frames.call_deferred()
	elif "--model-capture" in OS.get_cmdline_user_args():
		_capture_model_after_frames.call_deferred()
	elif "--capture" in OS.get_cmdline_user_args():
		_capture_after_frames.call_deferred()
	elif "--smoke-test" in OS.get_cmdline_user_args():
		_run_smoke_test.call_deferred()


func _process(delta: float) -> void:
	_animate_world()
	if message_time > 0.0:
		message_time -= delta
		if message_time <= 0.0:
			state_text.text = "SPACE  ENGAGE AUTO-ATTACK"

	if enemy_alive:
		_update_enemy(delta)
		_update_combat(delta)
	_update_hud()


func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed("target"):
		_show_message("TARGET LOCKED · ASHEN LEGIONARY", Color("#d9bc73"))
	elif event.is_action_pressed("auto_attack"):
		auto_attacking = not auto_attacking
		if auto_attacking:
			swing_elapsed = max(swing_elapsed, SWING_TIME - 0.35)
			_show_message("AUTO-ATTACK ENGAGED", Color("#bd82ff"))
		else:
			_show_message("AUTO-ATTACK HALTED", Color("#b9b1a2"))


func _bind_inputs() -> void:
	_bind_key("move_forward", KEY_W)
	_bind_key("move_backward", KEY_S)
	_bind_key("move_left", KEY_A)
	_bind_key("move_right", KEY_D)
	_bind_key("target", KEY_TAB)
	_bind_key("auto_attack", KEY_SPACE)
	_bind_key("release_mouse", KEY_ESCAPE)


func _bind_key(action: StringName, key: Key) -> void:
	if not InputMap.has_action(action):
		InputMap.add_action(action)
	if InputMap.action_get_events(action).is_empty():
		var event := InputEventKey.new()
		event.physical_keycode = key
		InputMap.action_add_event(action, event)


func _build_environment() -> void:
	var world_environment := WorldEnvironment.new()
	var environment := Environment.new()
	var sky := Sky.new()
	var sky_material := ProceduralSkyMaterial.new()
	sky_material.sky_top_color = Color("#10162b")
	sky_material.sky_horizon_color = Color("#826d6a")
	sky_material.ground_horizon_color = Color("#35443a")
	sky_material.ground_bottom_color = Color("#0b1210")
	sky_material.sun_angle_max = 7.0
	sky_material.sun_curve = 0.08
	sky.sky_material = sky_material
	environment.background_mode = Environment.BG_SKY
	environment.sky = sky
	environment.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
	environment.ambient_light_color = Color("#948b7b")
	environment.ambient_light_energy = 0.46
	environment.reflected_light_source = Environment.REFLECTION_SOURCE_SKY
	environment.tonemap_mode = Environment.TONE_MAPPER_FILMIC
	environment.glow_enabled = true
	environment.glow_intensity = 0.72
	environment.fog_enabled = true
	environment.fog_light_color = Color("#6e706b")
	environment.fog_light_energy = 0.22
	environment.fog_density = 0.006
	environment.fog_sky_affect = 0.28
	environment.fog_height = 1.2
	environment.fog_height_density = 0.075
	environment.adjustment_enabled = true
	environment.adjustment_brightness = 1.0
	environment.adjustment_contrast = 1.12
	environment.adjustment_saturation = 1.12
	world_environment.environment = environment
	add_child(world_environment)

	var moonlight := DirectionalLight3D.new()
	moonlight.rotation_degrees = Vector3(-48.0, -28.0, 0.0)
	moonlight.light_color = Color("#c5c9c7")
	moonlight.light_energy = 0.88
	moonlight.shadow_enabled = true
	moonlight.directional_shadow_max_distance = 48.0
	add_child(moonlight)
	var moon_material := _material(Color("#d7d2c2"), 0.0, 0.75, Color("#c5bdd8"), 2.4)
	_add_sphere(self, Vector3(9.5, 13.0, -28.0), 2.2, moon_material, Vector3(1.0, 1.0, 0.28))
	var distant_material := _material(Color("#172421"), 0.0, 1.0)
	_add_sphere(self, Vector3(-11.0, 1.0, -29.0), 6.5, distant_material, Vector3(1.5, 1.1, 0.7))
	_add_sphere(self, Vector3(2.0, 0.0, -32.0), 7.5, distant_material, Vector3(1.8, 1.0, 0.8))
	_add_sphere(self, Vector3(15.0, 0.5, -30.0), 6.0, distant_material, Vector3(1.4, 1.15, 0.7))


func _build_ground() -> void:
	var ground_material := ShaderMaterial.new()
	ground_material.shader = load("res://src/ground.gdshader")
	var ground_mesh := PlaneMesh.new()
	ground_mesh.size = Vector2(64.0, 64.0)
	ground_mesh.subdivide_width = 16
	ground_mesh.subdivide_depth = 16
	var ground := MeshInstance3D.new()
	ground.mesh = ground_mesh
	ground.material_override = ground_material
	add_child(ground)

	var floor_body := StaticBody3D.new()
	var floor_shape := CollisionShape3D.new()
	var box := BoxShape3D.new()
	box.size = Vector3(64.0, 0.4, 64.0)
	floor_shape.shape = box
	floor_shape.position.y = -0.22
	floor_body.add_child(floor_shape)
	add_child(floor_body)

	var path_material := _material(Color("#30271f"), 0.0, 1.0)
	for index in range(11):
		var stone := BoxMesh.new()
		stone.size = Vector3(rng.randf_range(0.65, 1.4), 0.08, rng.randf_range(0.5, 0.9))
		var step := MeshInstance3D.new()
		step.mesh = stone
		step.material_override = path_material
		step.position = Vector3(rng.randf_range(-0.7, 0.7), 0.025, 8.0 - index * 1.75)
		step.rotation_degrees.y = rng.randf_range(-18.0, 18.0)
		add_child(step)

	_build_pond()


func _build_pond() -> void:
	var pond_mesh := CylinderMesh.new()
	pond_mesh.top_radius = 4.8
	pond_mesh.bottom_radius = 4.5
	pond_mesh.height = 0.08
	pond_mesh.radial_segments = 14
	var water := StandardMaterial3D.new()
	water.albedo_color = Color(0.04, 0.18, 0.19, 0.72)
	water.metallic = 0.2
	water.roughness = 0.25
	water.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	water.emission_enabled = true
	water.emission = Color("#0c3438")
	water.emission_energy_multiplier = 0.35
	var pond := MeshInstance3D.new()
	pond.mesh = pond_mesh
	pond.material_override = water
	pond.position = Vector3(-8.2, -0.02, -1.5)
	pond.scale = Vector3(1.0, 1.0, 0.62)
	add_child(pond)


func _build_ruined_gate() -> void:
	var stone_dark := _material(Color("#343633"), 0.0, 0.98)
	var stone_light := _material(Color("#68675a"), 0.0, 0.94)
	var wood := _material(Color("#4b2d1e"), 0.0, 1.0)
	var banner := _material(Color("#68204f"), 0.0, 0.92)
	for side in [-1.0, 1.0]:
		for level in range(4):
			_add_box(self, Vector3(side * 3.65 + rng.randf_range(-0.12, 0.12), 0.72 + level * 1.35, -13.0), Vector3(1.65, 1.28, 1.45), stone_light if level % 2 == 0 else stone_dark, Vector3(rng.randf_range(-2.0, 2.0), rng.randf_range(-5.0, 5.0), rng.randf_range(-1.5, 1.5)))
	_add_box(self, Vector3(0.0, 5.65, -13.0), Vector3(8.8, 1.15, 1.55), stone_dark, Vector3(0.0, 0.0, -1.5))
	_add_box(self, Vector3(-2.3, 4.25, -12.15), Vector3(0.92, 1.85, 0.08), banner)
	_add_box(self, Vector3(2.3, 4.25, -12.15), Vector3(0.92, 1.85, 0.08), banner)

	for side in [-1.0, 1.0]:
		for index in range(8):
			var x: float = float(side) * (5.0 + index * 1.05)
			_add_cylinder(self, Vector3(x, 1.7 + rng.randf_range(-0.2, 0.25), -13.2 + rng.randf_range(-0.2, 0.2)), 0.25, rng.randf_range(3.4, 4.6), wood)
	_build_torch(Vector3(-2.35, 3.1, -11.9))
	_build_torch(Vector3(2.35, 3.1, -11.9))


func _build_torch(position_value: Vector3) -> void:
	var iron := _material(Color("#252320"), 0.45, 0.75)
	var flame := _material(Color("#ff9a36"), 0.0, 0.5, Color("#ff5a20"), 4.5)
	_add_cylinder(self, position_value + Vector3(0.0, -0.55, 0.0), 0.055, 1.2, iron)
	_add_sphere(self, position_value, 0.18, flame, Vector3(0.7, 1.6, 0.7))
	var light := OmniLight3D.new()
	light.position = position_value
	light.light_color = Color("#ff8b47")
	light.light_energy = 10.0
	light.omni_range = 10.5
	light.shadow_enabled = true
	add_child(light)
	torch_lights.append(light)


func _build_forest() -> void:
	var trunk := _material(Color("#402d22"), 0.0, 1.0)
	var canopy_colors := [Color("#17382d"), Color("#28503a"), Color("#3d5834")]
	var canopy_materials: Array[StandardMaterial3D] = []
	for color in canopy_colors:
		canopy_materials.append(_material(color, 0.0, 0.98))
	for index in range(30):
		var angle := index / 30.0 * TAU + rng.randf_range(-0.12, 0.12)
		var radius := rng.randf_range(15.0, 27.0)
		var position_value := Vector3(cos(angle) * radius, 0.0, sin(angle) * radius)
		if position_value.z < -9.0 and abs(position_value.x) < 10.0:
			position_value.x += 12.0 * sign(position_value.x if position_value.x != 0.0 else 1.0)
		var height := rng.randf_range(4.5, 7.8)
		_add_cylinder(self, position_value + Vector3(0.0, height * 0.5, 0.0), rng.randf_range(0.28, 0.5), height, trunk)
		_add_sphere(self, position_value + Vector3(0.0, height + 0.7, 0.0), 1.7, canopy_materials[index % canopy_materials.size()], Vector3(rng.randf_range(0.8, 1.25), rng.randf_range(1.1, 1.65), rng.randf_range(0.8, 1.25)))
		if index % 2 == 0:
			_add_sphere(self, position_value + Vector3(rng.randf_range(-1.1, 1.1), height + 0.15, rng.randf_range(-0.8, 0.8)), 1.25, canopy_materials[(index + 1) % canopy_materials.size()], Vector3(1.0, 0.9, 1.0))

	var rock := _material(Color("#465149"), 0.0, 1.0)
	for index in range(18):
		var angle := rng.randf_range(0.0, TAU)
		var radius := rng.randf_range(9.0, 22.0)
		_add_sphere(self, Vector3(cos(angle) * radius, rng.randf_range(0.25, 0.65), sin(angle) * radius), 0.8, rock, Vector3(rng.randf_range(0.8, 2.1), rng.randf_range(0.45, 1.2), rng.randf_range(0.8, 1.8)))

	var brush := _material(Color("#35513a"), 0.0, 1.0)
	for index in range(24):
		var angle := rng.randf_range(0.0, TAU)
		var radius := rng.randf_range(6.0, 15.0)
		var brush_position := Vector3(cos(angle) * radius, 0.32, sin(angle) * radius)
		if abs(brush_position.x) < 1.8:
			brush_position.x += 2.4 * sign(brush_position.x if brush_position.x != 0.0 else 1.0)
		_add_sphere(self, brush_position, 0.48, brush, Vector3(rng.randf_range(0.7, 1.5), rng.randf_range(0.55, 1.0), rng.randf_range(0.7, 1.5)))

	var firefly := _material(Color("#ead37c"), 0.0, 0.4, Color("#d3a94a"), 3.0)
	for index in range(14):
		var firefly_position := Vector3(rng.randf_range(-11.0, 11.0), rng.randf_range(0.7, 2.6), rng.randf_range(-10.0, 7.0))
		_add_sphere(self, firefly_position, 0.035, firefly)


func _build_player() -> void:
	player = PlayerController.new()
	player.name = "Player"
	player.position = Vector3(0.0, 0.15, 8.0)
	add_child(player)


func _build_enemy() -> void:
	enemy = Node3D.new()
	enemy.name = "AshenLegionary"
	enemy.position = Vector3(0.0, 0.0, 0.8)
	add_child(enemy)
	var enemy_scene: PackedScene = ConventionalOrcLegionaryScene if "--conventional-model" in OS.get_cmdline_user_args() else OrcLegionaryScene
	enemy_visual = enemy_scene.instantiate() as Node3D
	enemy.add_child(enemy_visual)

	enemy_label = Label3D.new()
	enemy_label.text = "ASHEN LEGIONARY  ·  LEVEL 3"
	enemy_label.position = Vector3(0.0, 2.90, 0.0)
	enemy_label.font_size = 42
	enemy_label.outline_size = 8
	enemy_label.modulate = Color("#d7c9a5")
	enemy_label.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	enemy.add_child(enemy_label)
	var target_material := _material(Color(0.45, 0.18, 0.65, 0.32), 0.0, 0.6, Color("#6d3297"), 1.2)
	target_material.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	var target_mesh := CylinderMesh.new()
	target_mesh.top_radius = 0.78
	target_mesh.bottom_radius = 0.78
	target_mesh.height = 0.025
	target_mesh.radial_segments = 20
	target_disc = MeshInstance3D.new()
	target_disc.mesh = target_mesh
	target_disc.material_override = target_material
	target_disc.position.y = 0.025
	enemy.add_child(target_disc)


func _update_enemy(delta: float) -> void:
	var offset := player.global_position - enemy.global_position
	offset.y = 0.0
	var distance := offset.length()
	var pursuing := false
	if auto_attacking or distance < 5.5:
		if not enemy_attack_pending:
			var facing_target := player.global_position
			facing_target.y = enemy_visual.global_position.y
			enemy_visual.look_at(facing_target, Vector3.UP)
		if distance > 2.25 and not enemy_attack_pending:
			enemy.position += offset.normalized() * delta * 1.35
			pursuing = true
	enemy_visual.call("set_moving", pursuing)
	if distance <= MELEE_RANGE:
		enemy_swing_elapsed += delta
		if enemy_swing_elapsed >= ENEMY_SWING_TIME and not enemy_attack_pending:
			enemy_swing_elapsed = 0.0
			_begin_enemy_attack()
	else:
		enemy_swing_elapsed = min(enemy_swing_elapsed, ENEMY_SWING_TIME * 0.7)


func _update_combat(delta: float) -> void:
	if not auto_attacking:
		return
	swing_elapsed += delta
	if swing_elapsed < SWING_TIME:
		return
	swing_elapsed -= SWING_TIME
	_attempt_player_attack()


func _attempt_player_attack() -> bool:
	if not enemy_alive:
		return false
	if player.global_position.distance_to(enemy.global_position) > MELEE_RANGE:
		_show_message("OUT OF RANGE", Color("#d8896d"))
		return false
	if not _player_is_facing_target():
		_show_message("YOU ARE NOT FACING YOUR TARGET", Color("#d8896d"))
		return false
	_resolve_player_attack()
	return true


func _player_is_facing_target() -> bool:
	var player_visual := player.get_node_or_null("LowPolyKnight") as Node3D
	if player_visual == null:
		return false
	var to_target := enemy.global_position - player.global_position
	to_target.y = 0.0
	if to_target.length_squared() < 0.0001:
		return true
	var forward := -player_visual.global_basis.z
	forward.y = 0.0
	var minimum_dot := cos(deg_to_rad(MELEE_FACING_HALF_ANGLE_DEGREES))
	return forward.normalized().dot(to_target.normalized()) >= minimum_dot


func _resolve_player_attack() -> void:
	var roll := rng.randi_range(1, 20)
	var hit := roll == 20 or roll + 6 >= 14
	player.call("play_swing")
	if hit:
		var damage := rng.randi_range(5, 10) + 3
		enemy_health = max(0, enemy_health - damage)
		enemy_visual.call("play_hit")
		_spawn_impact_fx(enemy.global_position + Vector3(0.0, 1.45, 0.0), Color("#f1c46d"), 7)
		_play_sfx_at(ARMOR_HIT_SFX, enemy.global_position + Vector3(0.0, 1.3, 0.0), -5.0, rng.randf_range(0.94, 1.06))
		_float_combat_text("%d  ·  %d" % [roll, damage], Color("#f3d37a"))
		_show_message("d20 %d + 6  ·  HIT FOR %d" % [roll, damage], Color("#f3d37a"))
		if enemy_health <= 0:
			_defeat_enemy()
	else:
		_float_combat_text("%d  ·  MISS" % roll, Color("#a9b0b4"))
		_show_message("d20 %d + 6  ·  MISS" % roll, Color("#a9b0b4"))


func _begin_enemy_attack() -> void:
	enemy_attack_pending = true
	enemy_attack_count += 1
	enemy_attack_generation += 1
	var generation := enemy_attack_generation
	var shield_bash := enemy_attack_count % 3 == 0
	var animation_name := &"ShieldBash" if shield_bash else &"AxeAttack"
	var impact_delay := SHIELD_IMPACT_DELAY if shield_bash else AXE_IMPACT_DELAY
	enemy_visual.call("play_attack", animation_name)
	_play_sfx_at(AXE_SWING_SFX, enemy.global_position + Vector3(0.0, 1.3, 0.0), -8.0, 0.78 if shield_bash else 1.0)
	_telegraph_enemy_attack(impact_delay, shield_bash)
	await get_tree().create_timer(impact_delay).timeout
	if generation != enemy_attack_generation or not enemy_alive:
		return
	_resolve_enemy_attack(shield_bash)
	await get_tree().create_timer(0.42).timeout
	if generation == enemy_attack_generation:
		enemy_attack_pending = false


func _resolve_enemy_attack(shield_bash: bool) -> void:
	var attack_name := "SHIELD BASH" if shield_bash else "AXE"
	if not _enemy_attack_can_connect():
		_float_world_combat_text(player.global_position + Vector3(0.0, 2.1, 0.0), "%s  ·  EVADED" % attack_name, Color("#a9b0b4"))
		_show_message("LEGIONARY %s EVADED" % attack_name, Color("#9fc58d"))
		return
	var roll := rng.randi_range(1, 20)
	var attack_bonus := 5 if shield_bash else 4
	var hit := roll == 20 or roll + attack_bonus >= 15
	if not hit:
		_float_world_combat_text(player.global_position + Vector3(0.0, 2.1, 0.0), "%d  ·  MISS" % roll, Color("#a9b0b4"))
		return
	var damage := rng.randi_range(2, 5) if shield_bash else rng.randi_range(3, 7)
	player_health = max(0, player_health - damage)
	player.call("play_hit_feedback", 1.2 if shield_bash else 1.0)
	_spawn_impact_fx(player.global_position + Vector3(0.0, 1.25, 0.0), Color("#d96f55") if shield_bash else Color("#e7a45f"), 8)
	_play_sfx_at(SHIELD_BASH_SFX if shield_bash else ARMOR_HIT_SFX, player.global_position + Vector3(0.0, 1.2, 0.0), -4.0, rng.randf_range(0.96, 1.04))
	_float_world_combat_text(player.global_position + Vector3(0.0, 2.1, 0.0), "%s  ·  %d" % [attack_name, damage], Color("#e28b6e"))
	_show_message("LEGIONARY %s HITS FOR %d" % [attack_name, damage], Color("#d8896d"))
	if player_health == 0:
		player_health = PLAYER_MAX_HEALTH
		player.position = Vector3(0.0, 0.15, 8.0)
		auto_attacking = false
		enemy_attack_generation += 1
		enemy_attack_pending = false
		enemy_swing_elapsed = 0.0
		_show_message("COMBAT STUDY RESET", Color("#d8896d"))


func _enemy_attack_can_connect() -> bool:
	var to_player := player.global_position - enemy_visual.global_position
	to_player.y = 0.0
	if to_player.length() > MELEE_RANGE + 0.25:
		return false
	if to_player.length_squared() < 0.0001:
		return true
	var forward := -enemy_visual.global_basis.z
	forward.y = 0.0
	var minimum_dot := cos(deg_to_rad(ENEMY_FACING_HALF_ANGLE_DEGREES))
	return forward.normalized().dot(to_player.normalized()) >= minimum_dot


func _defeat_enemy() -> void:
	enemy_alive = false
	auto_attacking = false
	enemy_attack_generation += 1
	enemy_attack_pending = false
	enemy_label.text = "ASHEN LEGIONARY  ·  DEFEATED"
	_show_message("ASHEN LEGIONARY DEFEATED", Color("#bd82ff"))
	_spawn_impact_fx(enemy.global_position + Vector3(0.0, 0.35, 0.0), Color("#7a7166"), 10)
	_play_sfx_at(ARMOR_DEATH_SFX, enemy.global_position + Vector3(0.0, 0.5, 0.0), -3.0)
	enemy_visual.call("play_defeat")
	var tween := create_tween()
	tween.tween_interval(2.0)
	tween.tween_callback(_respawn_enemy)


func _respawn_enemy() -> void:
	enemy.position = Vector3(0.0, 0.0, 0.8)
	enemy_visual.call("reset_pose")
	enemy_health = ENEMY_MAX_HEALTH
	enemy_alive = true
	enemy_swing_elapsed = 0.0
	enemy_label.text = "ASHEN LEGIONARY  ·  LEVEL 3"


func _float_combat_text(text_value: String, color: Color) -> void:
	_float_world_combat_text(enemy.global_position + Vector3(rng.randf_range(-0.25, 0.25), 2.35, 0.0), text_value, color)


func _float_world_combat_text(world_position: Vector3, text_value: String, color: Color) -> void:
	var label := Label3D.new()
	label.text = text_value
	label.font_size = 34
	label.outline_size = 7
	label.modulate = color
	label.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	add_child(label)
	label.global_position = world_position
	var tween := create_tween()
	tween.set_parallel(true)
	tween.tween_property(label, "global_position:y", world_position.y + 0.9, 0.8).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_OUT)
	tween.tween_property(label, "modulate:a", 0.0, 0.8)
	tween.set_parallel(false)
	tween.tween_callback(label.queue_free)


func _telegraph_enemy_attack(impact_delay: float, shield_bash: bool) -> void:
	if target_disc == null:
		return
	target_disc.scale = Vector3.ONE
	var tell_scale := 1.34 if shield_bash else 1.22
	var tween := create_tween()
	tween.set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_OUT)
	tween.tween_property(target_disc, "scale", Vector3(tell_scale, 1.0, tell_scale), impact_delay * 0.72)
	tween.set_ease(Tween.EASE_IN)
	tween.tween_property(target_disc, "scale", Vector3(0.88, 1.0, 0.88), impact_delay * 0.28)
	tween.set_ease(Tween.EASE_OUT)
	tween.tween_property(target_disc, "scale", Vector3.ONE, 0.18)


func _spawn_impact_fx(world_position: Vector3, color: Color, shard_count: int) -> void:
	var burst := Node3D.new()
	add_child(burst)
	burst.global_position = world_position
	var material := _material(color, 0.15, 0.45, color, 1.45)
	var tween := create_tween().set_parallel(true)
	for index in range(shard_count):
		var mesh := BoxMesh.new()
		mesh.size = Vector3(0.014, 0.014, rng.randf_range(0.045, 0.095))
		var shard := MeshInstance3D.new()
		shard.mesh = mesh
		shard.material_override = material
		shard.rotation = Vector3(rng.randf_range(-PI, PI), rng.randf_range(-PI, PI), rng.randf_range(-PI, PI))
		burst.add_child(shard)
		var angle := TAU * index / float(shard_count) + rng.randf_range(-0.20, 0.20)
		var destination := Vector3(cos(angle) * rng.randf_range(0.18, 0.42), rng.randf_range(0.10, 0.34), sin(angle) * rng.randf_range(0.18, 0.42))
		tween.tween_property(shard, "position", destination, 0.30).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_OUT)
		tween.tween_property(shard, "scale", Vector3.ZERO, 0.30).set_delay(0.08)
	var flash := OmniLight3D.new()
	flash.light_color = color
	flash.light_energy = 2.2
	flash.omni_range = 1.8
	flash.shadow_enabled = false
	burst.add_child(flash)
	tween.tween_property(flash, "light_energy", 0.0, 0.18)
	tween.set_parallel(false)
	tween.tween_callback(burst.queue_free)


func _play_sfx_at(stream: AudioStream, world_position: Vector3, volume_db: float, pitch_scale: float = 1.0) -> void:
	var sound := AudioStreamPlayer3D.new()
	sound.stream = stream
	sound.volume_db = volume_db
	sound.pitch_scale = pitch_scale
	sound.max_distance = 22.0
	add_child(sound)
	sound.global_position = world_position
	sound.finished.connect(sound.queue_free)
	sound.play()


func _animate_world() -> void:
	var now := Time.get_ticks_msec() * 0.001
	for index in range(torch_lights.size()):
		torch_lights[index].light_energy = 9.4 + sin(now * 7.0 + index * 1.7) * 1.0 + sin(now * 13.0) * 0.45


func _build_hud() -> void:
	var layer := CanvasLayer.new()
	add_child(layer)
	var root := Control.new()
	root.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	layer.add_child(root)

	var title := Label.new()
	title.position = Vector2(34.0, 28.0)
	title.size = Vector2(480.0, 70.0)
	title.text = "THE ASHEN HOLLOW\nCOMBAT STUDY I"
	title.add_theme_font_size_override("font_size", 22)
	title.add_theme_color_override("font_color", Color("#d8c38b"))
	title.add_theme_color_override("font_shadow_color", Color(0.0, 0.0, 0.0, 0.8))
	title.add_theme_constant_override("shadow_offset_x", 2)
	title.add_theme_constant_override("shadow_offset_y", 2)
	root.add_child(title)

	var controls := Label.new()
	controls.position = Vector2(985.0, 30.0)
	controls.size = Vector2(275.0, 170.0)
	controls.text = "W / S  FORWARD / BACK\nA / D  TURN\nRIGHT-DRAG  STEER\nRIGHT + A / D  STRAFE\nLEFT-DRAG  ORBIT\nBOTH BUTTONS  RUN\nWHEEL  CAMERA\nSPACE  AUTO-ATTACK"
	controls.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	controls.add_theme_font_size_override("font_size", 14)
	controls.add_theme_color_override("font_color", Color("#b8b4a8"))
	root.add_child(controls)

	state_text = Label.new()
	state_text.position = Vector2(390.0, 455.0)
	state_text.size = Vector2(500.0, 40.0)
	state_text.text = "SPACE  ENGAGE AUTO-ATTACK"
	state_text.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	state_text.add_theme_font_size_override("font_size", 18)
	state_text.add_theme_color_override("font_color", Color("#d9bc73"))
	root.add_child(state_text)

	var panel := Panel.new()
	panel.position = Vector2(290.0, 530.0)
	panel.size = Vector2(700.0, 164.0)
	panel.add_theme_stylebox_override("panel", _panel_style())
	root.add_child(panel)

	var player_title := _label("HEIR  ·  LEVEL 1", Vector2(18.0, 12.0), Vector2(315.0, 24.0), 15, Color("#d8c38b"))
	panel.add_child(player_title)
	var target_title := _label("TARGET  ·  ASHEN LEGIONARY", Vector2(365.0, 12.0), Vector2(315.0, 24.0), 15, Color("#d8c38b"))
	panel.add_child(target_title)

	player_health_bar = _bar(Vector2(18.0, 40.0), Vector2(315.0, 25.0), Color("#8e2638"))
	panel.add_child(player_health_bar)
	player_health_text = _label("", Vector2(18.0, 42.0), Vector2(315.0, 22.0), 14, Color.WHITE)
	player_health_text.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	panel.add_child(player_health_text)

	var resolve_bar := _bar(Vector2(18.0, 71.0), Vector2(315.0, 18.0), Color("#365f78"))
	resolve_bar.value = 100.0
	panel.add_child(resolve_bar)
	var resolve_text := _label("RESOLVE  100 / 100", Vector2(18.0, 70.0), Vector2(315.0, 20.0), 12, Color("#d9e7ec"))
	resolve_text.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	panel.add_child(resolve_text)

	target_health_bar = _bar(Vector2(365.0, 40.0), Vector2(315.0, 25.0), Color("#6f2532"))
	panel.add_child(target_health_bar)
	target_health_text = _label("", Vector2(365.0, 42.0), Vector2(315.0, 22.0), 14, Color.WHITE)
	target_health_text.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	panel.add_child(target_health_text)
	range_text = _label("", Vector2(365.0, 70.0), Vector2(315.0, 20.0), 12, Color("#c9c0b0"))
	range_text.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	panel.add_child(range_text)

	swing_bar = _bar(Vector2(18.0, 112.0), Vector2(662.0, 30.0), Color("#7f3fc0"))
	panel.add_child(swing_bar)
	swing_text = _label("", Vector2(18.0, 115.0), Vector2(662.0, 24.0), 14, Color.WHITE)
	swing_text.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	panel.add_child(swing_text)

	var reticle := Label.new()
	reticle.position = Vector2(622.0, 342.0)
	reticle.size = Vector2(36.0, 36.0)
	reticle.text = "◆"
	reticle.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	reticle.add_theme_font_size_override("font_size", 22)
	reticle.add_theme_color_override("font_color", Color(0.63, 0.35, 0.85, 0.78))
	root.add_child(reticle)


func _panel_style() -> StyleBoxFlat:
	var style := StyleBoxFlat.new()
	style.bg_color = Color(0.018, 0.021, 0.022, 0.91)
	style.border_color = Color("#80633a")
	style.set_border_width_all(2)
	style.corner_radius_top_left = 5
	style.corner_radius_top_right = 5
	style.corner_radius_bottom_left = 5
	style.corner_radius_bottom_right = 5
	return style


func _bar(position_value: Vector2, size_value: Vector2, color: Color) -> ProgressBar:
	var bar := ProgressBar.new()
	bar.position = position_value
	bar.size = size_value
	bar.min_value = 0.0
	bar.max_value = 100.0
	bar.show_percentage = false
	var background := StyleBoxFlat.new()
	background.bg_color = Color("#161819")
	background.border_color = Color("#443d32")
	background.set_border_width_all(1)
	var fill := StyleBoxFlat.new()
	fill.bg_color = color
	fill.border_color = color.lightened(0.22)
	fill.set_border_width_all(1)
	bar.add_theme_stylebox_override("background", background)
	bar.add_theme_stylebox_override("fill", fill)
	return bar


func _label(text_value: String, position_value: Vector2, size_value: Vector2, font_size: int, color: Color) -> Label:
	var label := Label.new()
	label.text = text_value
	label.position = position_value
	label.size = size_value
	label.add_theme_font_size_override("font_size", font_size)
	label.add_theme_color_override("font_color", color)
	return label


func _update_hud() -> void:
	if not player_health_bar:
		return
	player_health_bar.value = player_health / float(PLAYER_MAX_HEALTH) * 100.0
	target_health_bar.value = enemy_health / float(ENEMY_MAX_HEALTH) * 100.0
	player_health_text.text = "HEALTH  %d / %d" % [player_health, PLAYER_MAX_HEALTH]
	target_health_text.text = "HEALTH  %d / %d" % [enemy_health, ENEMY_MAX_HEALTH]
	var distance := player.global_position.distance_to(enemy.global_position)
	var combat_position := "CLOSE TO ENGAGE"
	var position_color := Color("#c9c0b0")
	if distance <= MELEE_RANGE:
		if _player_is_facing_target():
			combat_position = "IN RANGE · FACING"
			position_color = Color("#9fc58d")
		else:
			combat_position = "TURN TO FACE"
			position_color = Color("#d8896d")
	range_text.text = "%.1f m  ·  %s" % [distance, combat_position]
	range_text.add_theme_color_override("font_color", position_color)
	swing_bar.value = swing_elapsed / SWING_TIME * 100.0 if auto_attacking else 0.0
	var remaining: float = maxf(0.0, SWING_TIME - swing_elapsed)
	swing_text.text = "AUTO-ATTACK  ·  %.1fs" % remaining if auto_attacking else "AUTO-ATTACK  ·  HALTED"


func _show_message(text_value: String, color: Color) -> void:
	state_text.text = text_value
	state_text.add_theme_color_override("font_color", color)
	message_time = 1.7


func _capture_after_frames() -> void:
	for frame in range(24):
		await get_tree().process_frame
	var artifact_dir := ProjectSettings.globalize_path("res://artifacts")
	DirAccess.make_dir_absolute(artifact_dir)
	var image := get_viewport().get_texture().get_image()
	var result := image.save_png(artifact_dir.path_join("look_proof.png"))
	if result != OK:
		push_error("Screenshot save failed: %s" % error_string(result))
	get_tree().quit()


func _capture_model_after_frames() -> void:
	player.global_position = enemy.global_position + Vector3(0.0, 0.15, 2.8)
	player.rotation.y = 0.0
	var player_visual := player.get_node_or_null("LowPolyKnight") as Node3D
	if player_visual != null:
		player_visual.visible = false
	var camera_value := player.get("camera") as Camera3D
	if camera_value != null:
		camera_value.fov = 42.0
	var spring_arm_value := player.get("spring_arm") as SpringArm3D
	if spring_arm_value != null:
		spring_arm_value.spring_length = 3.2
	for frame in range(24):
		await get_tree().process_frame
	var artifact_dir := ProjectSettings.globalize_path("res://artifacts")
	DirAccess.make_dir_absolute(artifact_dir)
	var image := get_viewport().get_texture().get_image()
	var result := image.save_png(artifact_dir.path_join("orc_legionary_proof.png"))
	if result != OK:
		push_error("Model screenshot save failed: %s" % error_string(result))
	get_tree().quit()


func _capture_combat_after_frames() -> void:
	player.global_position = enemy.global_position + Vector3(0.0, 0.15, 2.45)
	player.rotation.y = 0.0
	var player_visual := player.get_node_or_null("LowPolyKnight") as Node3D
	if player_visual != null:
		player_visual.visible = false
	var camera_value := player.get("camera") as Camera3D
	if camera_value != null:
		camera_value.fov = 46.0
	var spring_arm_value := player.get("spring_arm") as SpringArm3D
	if spring_arm_value != null:
		spring_arm_value.spring_length = 3.8
	for frame in range(12):
		await get_tree().process_frame
	enemy_attack_count = 2
	_begin_enemy_attack()
	await get_tree().create_timer(SHIELD_IMPACT_DELAY - 0.04).timeout
	enemy_attack_generation += 1
	var contact_point := enemy.global_position.lerp(player.global_position, 0.46) + Vector3(0.0, 1.20, 0.0)
	_spawn_impact_fx(contact_point, Color("#e28b5f"), 8)
	await get_tree().create_timer(0.08).timeout
	await get_tree().process_frame
	var artifact_dir := ProjectSettings.globalize_path("res://artifacts")
	DirAccess.make_dir_absolute(artifact_dir)
	var image := get_viewport().get_texture().get_image()
	var result := image.save_png(artifact_dir.path_join("orc_legionary_combat_proof.png"))
	if result != OK:
		push_error("Combat screenshot save failed: %s" % error_string(result))
	get_tree().quit()


func _capture_motion_after_frames() -> void:
	player.global_position = enemy.global_position + Vector3(0.0, 0.15, 2.45)
	player.rotation.y = 0.0
	var player_visual := player.get_node_or_null("LowPolyKnight") as Node3D
	if player_visual != null:
		player_visual.visible = false
	var camera_value := player.get("camera") as Camera3D
	if camera_value != null:
		camera_value.fov = 46.0
	var spring_arm_value := player.get("spring_arm") as SpringArm3D
	if spring_arm_value != null:
		spring_arm_value.spring_length = 3.8
	enemy_visual.look_at(player.global_position, Vector3.UP)
	enemy_alive = false
	enemy_visual.call("reset_pose")
	var enemy_animation_player := enemy_visual.get("animation_player") as AnimationPlayer
	if enemy_animation_player == null:
		push_error("Motion capture could not find the legionary AnimationPlayer")
		get_tree().quit(1)
		return
	for frame in range(12):
		await get_tree().process_frame
	enemy_visual.call("play_attack", &"AxeAttack")
	await enemy_animation_player.animation_finished
	for frame in range(4):
		await get_tree().process_frame
	enemy_visual.call("play_attack", &"ShieldBash")
	await enemy_animation_player.animation_finished
	for frame in range(4):
		await get_tree().process_frame
	enemy_visual.call("play_hit")
	await enemy_animation_player.animation_finished
	for frame in range(4):
		await get_tree().process_frame
	enemy_visual.call("set_moving", true)
	await get_tree().create_timer(1.0).timeout
	enemy_visual.call("set_moving", false)
	await get_tree().create_timer(0.35).timeout
	enemy_visual.call("play_defeat")
	await enemy_animation_player.animation_finished
	for frame in range(8):
		await get_tree().process_frame
	get_tree().quit()


func _run_smoke_test() -> void:
	for frame in range(3):
		await get_tree().physics_frame
	var movement_start := player.global_position
	Input.action_press("move_forward")
	for frame in range(24):
		await get_tree().physics_frame
	Input.action_release("move_forward")
	if player.global_position.distance_to(movement_start) < 0.25:
		push_error("SMOKE_TEST_FAIL: movement did not move the player")
		get_tree().quit(1)
		return
	player.velocity = Vector3.ZERO
	var turn_start := player.rotation.y
	var turn_position := player.global_position
	Input.action_press("move_right")
	for frame in range(12):
		await get_tree().physics_frame
	Input.action_release("move_right")
	if absf(angle_difference(turn_start, player.rotation.y)) < 0.08 or player.global_position.distance_to(turn_position) > 0.15:
		push_error("SMOKE_TEST_FAIL: A/D did not turn in place")
		get_tree().quit(1)
		return
	player.velocity = Vector3.ZERO
	_set_test_mouse_button(MOUSE_BUTTON_RIGHT, true)
	var strafe_start := player.global_position
	var strafe_heading := player.rotation.y
	Input.action_press("move_right")
	for frame in range(18):
		await get_tree().physics_frame
	Input.action_release("move_right")
	_set_test_mouse_button(MOUSE_BUTTON_RIGHT, false)
	if player.global_position.distance_to(strafe_start) < 0.25 or absf(angle_difference(strafe_heading, player.rotation.y)) > 0.03:
		push_error("SMOKE_TEST_FAIL: right-mouse A/D did not strafe")
		get_tree().quit(1)
		return
	player.velocity = Vector3.ZERO
	_set_test_mouse_button(MOUSE_BUTTON_RIGHT, true)
	_set_test_mouse_button(MOUSE_BUTTON_LEFT, true)
	var mouse_run_start := player.global_position
	for frame in range(18):
		await get_tree().physics_frame
	_set_test_mouse_button(MOUSE_BUTTON_LEFT, false)
	_set_test_mouse_button(MOUSE_BUTTON_RIGHT, false)
	if player.global_position.distance_to(mouse_run_start) < 0.25:
		push_error("SMOKE_TEST_FAIL: both mouse buttons did not run forward")
		get_tree().quit(1)
		return
	player.global_position = enemy.global_position + Vector3(0.0, 0.15, 2.2)
	player.velocity = Vector3.ZERO
	player.rotation.y = 0.0
	var player_visual := player.get_node("LowPolyKnight") as Node3D
	player_visual.rotation.y = PI
	var starting_health := enemy_health
	if _attempt_player_attack() or enemy_health != starting_health:
		push_error("SMOKE_TEST_FAIL: attack landed while facing away")
		get_tree().quit(1)
		return
	player_visual.rotation.y = 0.0
	for attempt in range(8):
		_attempt_player_attack()
		if enemy_health < starting_health:
			break
	if enemy_health >= starting_health:
		push_error("SMOKE_TEST_FAIL: combat did not damage the target")
		get_tree().quit(1)
		return
	var skeletons := enemy_visual.find_children("*", "Skeleton3D", true, false)
	var meshes := enemy_visual.find_children("*", "MeshInstance3D", true, false)
	if skeletons.is_empty() or meshes.is_empty():
		push_error("SMOKE_TEST_FAIL: production legionary mesh or rig is missing")
		get_tree().quit(1)
		return
	var legionary_skeleton := skeletons[0] as Skeleton3D
	for bone_name in ["head", "hand.L", "hand.R", "thigh.L", "thigh.R"]:
		if legionary_skeleton.find_bone(bone_name) < 0:
			push_error("SMOKE_TEST_FAIL: legionary rig bone missing: %s" % bone_name)
			get_tree().quit(1)
			return
	if not enemy.find_children("*", "CollisionObject3D", true, false).is_empty():
		push_error("SMOKE_TEST_FAIL: the enemy must remain pass-through")
		get_tree().quit(1)
		return
	var attack_player_health := player_health
	enemy_visual.call("reset_pose")
	enemy_attack_count = 2
	_begin_enemy_attack()
	for frame in range(3):
		await get_tree().process_frame
	var animation_players := enemy_visual.find_children("*", "AnimationPlayer", true, false)
	if animation_players.is_empty() or (animation_players[0] as AnimationPlayer).current_animation != "ShieldBash":
		push_error("SMOKE_TEST_FAIL: shield bash attack variant did not play")
		get_tree().quit(1)
		return
	if player_health != attack_player_health:
		push_error("SMOKE_TEST_FAIL: enemy damage landed before the visible impact")
		get_tree().quit(1)
		return
	enemy_attack_generation += 1
	enemy_attack_pending = false
	enemy_visual.call("reset_pose")
	player.global_position = enemy.global_position + Vector3(0.0, 0.15, MELEE_RANGE + 0.7)
	if _enemy_attack_can_connect():
		push_error("SMOKE_TEST_FAIL: leaving melee range did not evade the enemy impact")
		get_tree().quit(1)
		return
	player.global_position = enemy.global_position + Vector3(0.0, 0.15, -2.2)
	enemy_visual.look_at(enemy.global_position + Vector3(0.0, 0.0, 2.2), Vector3.UP)
	if _enemy_attack_can_connect():
		push_error("SMOKE_TEST_FAIL: flanking did not evade the facing-locked enemy impact")
		get_tree().quit(1)
		return
	await get_tree().create_timer(1.0).timeout
	print("SMOKE_TEST_PASS: EQ navigation, facing, d20 combat, timed axe/shield attacks, evasion, articulated legionary, and pass-through enemies are live")
	get_tree().quit()


func _set_test_mouse_button(button: MouseButton, pressed: bool) -> void:
	var event := InputEventMouseButton.new()
	event.button_index = button
	event.pressed = pressed
	player.call("_unhandled_input", event)


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
