class_name HushEnemy
extends CharacterBody3D

## Compact, deterministic enemy actor used by the HUSHPOINT vertical slice.
## Navigation is intentionally direct: the authored station has broad lanes and
## collision is allowed to stop a pursuit instead of letting enemies teleport.

signal state_changed(enemy: HushEnemy, new_state: String)
signal attack_started(enemy: HushEnemy)
signal attack_landed(enemy: HushEnemy, damage: int)
signal defeated(enemy: HushEnemy, permanent: bool)

const STATE_DORMANT := "dormant"
const STATE_IDLE := "idle"
const STATE_INVESTIGATE := "investigate"
const STATE_CHASE := "chase"
const STATE_TELEGRAPH := "telegraph"
const STATE_STAGGER := "stagger"
const STATE_DOWNED := "downed"
const STATE_DEAD := "dead"

var kind: String = "listener"
var target: Node3D
var game: Node
var active: bool = true

var ai_state: String = STATE_IDLE
var health: float = 3.0
var max_health: float = 3.0
var walk_speed: float = 1.45
var chase_speed: float = 2.65
var sight_range: float = 12.0
var hearing_range: float = 18.0
var attack_range: float = 1.65
var attack_damage: int = 18

var _visual_root: Node3D
var _weak_node: MeshInstance3D
var _weak_material: StandardMaterial3D
var _body_material: StandardMaterial3D
var _investigation_point := Vector3.ZERO
var _investigation_time: float = 0.0
var _attack_cooldown: float = 0.0
var _state_time: float = 0.0
var _weak_reveal_time: float = 0.0
var _regulator_exposed_time: float = 0.0
var _bellman_weak_hits: int = 0
var _downed_recovery_time: float = 0.0
var _emerged: bool = true
var _configured: bool = false
var _built: bool = false
var _base_visual_height: float = 0.0
var _state_before_deactivation: String = STATE_IDLE


func configure(
	new_kind: String,
	new_target: Node3D,
	game_controller: Node = null
) -> HushEnemy:
	kind = new_kind.to_lower()
	if kind not in ["listener", "wader", "chorus", "bellman"]:
		kind = "listener"
	target = new_target
	game = game_controller
	_configured = true
	_apply_kind_tuning()
	if is_inside_tree():
		_rebuild_actor()
	return self


func _ready() -> void:
	collision_layer = 4
	collision_mask = 1 | 2
	if not _configured:
		_apply_kind_tuning()
	_rebuild_actor()
	_set_state(STATE_IDLE if active else STATE_DORMANT)


func _apply_kind_tuning() -> void:
	match kind:
		"wader":
			max_health = 2.0
			walk_speed = 1.7
			chase_speed = 3.25
			sight_range = 8.5
			hearing_range = 13.0
			attack_range = 1.9
			attack_damage = 24
			_emerged = false
		"chorus":
			max_health = 2.0
			walk_speed = 0.0
			chase_speed = 0.0
			sight_range = 10.0
			hearing_range = 22.0
			attack_range = 8.5
			attack_damage = 10
			_emerged = true
		"bellman":
			max_health = 999.0
			walk_speed = 1.55
			chase_speed = 2.8
			sight_range = 7.0
			hearing_range = 34.0
			attack_range = 2.25
			attack_damage = 32
			_emerged = true
		_:
			max_health = 3.0
			walk_speed = 1.45
			chase_speed = 2.65
			sight_range = 12.0
			hearing_range = 18.0
			attack_range = 1.65
			attack_damage = 18
			_emerged = true
	health = max_health


func _rebuild_actor() -> void:
	if _built and is_instance_valid(_visual_root):
		_visual_root.queue_free()
		var old_shape := get_node_or_null("BodyCollision")
		if old_shape != null:
			old_shape.queue_free()
	_visual_root = Node3D.new()
	_visual_root.name = "ProceduralVisual"
	add_child(_visual_root)
	_build_collision()
	_build_visual()
	_built = true


func _build_collision() -> void:
	var collision := CollisionShape3D.new()
	collision.name = "BodyCollision"
	var capsule := CapsuleShape3D.new()
	match kind:
		"wader":
			capsule.radius = 0.48
			capsule.height = 1.15
			collision.position.y = 0.58
		"chorus":
			capsule.radius = 0.62
			capsule.height = 1.75
			collision.position.y = 0.88
		"bellman":
			capsule.radius = 0.68
			capsule.height = 2.5
			collision.position.y = 1.25
		_:
			capsule.radius = 0.42
			capsule.height = 1.85
			collision.position.y = 0.93
	collision.shape = capsule
	add_child(collision)


func _build_visual() -> void:
	var dark_flesh := _material(Color("273035"), 0.78, 0.05)
	var wet_flesh := _material(Color("394a4d"), 0.42, 0.08)
	var brass := _material(Color("71532c"), 0.31, 0.84)
	var oxidized := _material(Color("263f3c"), 0.56, 0.56)
	var black_metal := _material(Color("111719"), 0.25, 0.74)
	_body_material = dark_flesh
	_weak_material = _material(Color("45b9bd"), 0.24, 0.2, Color("0b5860"), 0.75)

	match kind:
		"wader":
			_body_material = wet_flesh
			_add_capsule(Vector3(0, 0.58, 0), 0.48, 1.15, wet_flesh, "WaterloggedBody")
			_add_sphere(Vector3(0, 1.12, -0.16), 0.32, wet_flesh, "Head")
			_add_limb(Vector3(-0.42, 0.47, -0.12), Vector3(0.12, 0.55, 0.12), -0.65, wet_flesh, "LeftArm")
			_add_limb(Vector3(0.42, 0.47, -0.12), Vector3(0.12, 0.55, 0.12), 0.65, wet_flesh, "RightArm")
			_weak_node = _add_sphere(Vector3(0, 0.72, 0.43), 0.18, _weak_material, "VesperNode")
			_base_visual_height = -0.48
			_visual_root.position.y = _base_visual_height
		"chorus":
			_body_material = wet_flesh
			_add_box(Vector3(0, 0.9, 0), Vector3(1.05, 1.75, 0.48), wet_flesh, "WallColony")
			for offset in [Vector3(-0.32, 1.25, -0.27), Vector3(0.31, 0.75, -0.29), Vector3(0.06, 1.62, -0.25)]:
				_add_sphere(offset, 0.25, dark_flesh, "EchoMouth")
			_weak_node = _add_sphere(Vector3(-0.2, 1.03, -0.43), 0.2, _weak_material, "VesperNode")
			_base_visual_height = 0.0
		"bellman":
			_body_material = brass
			_add_capsule(Vector3(0, 1.25, 0), 0.66, 2.45, oxidized, "PressureSuit")
			_add_sphere(Vector3(0, 2.22, 0), 0.52, brass, "BrassHelmet")
			_add_cylinder(Vector3(0, 2.22, -0.48), 0.28, 0.18, black_metal, Vector3(PI / 2.0, 0, 0), "FacePort")
			_add_limb(Vector3(-0.72, 1.2, 0), Vector3(0.2, 0.88, 0.2), -0.2, brass, "LeftGauntlet")
			_add_limb(Vector3(0.72, 1.2, 0), Vector3(0.2, 0.88, 0.2), 0.2, brass, "RightGauntlet")
			_add_cylinder(Vector3(0.64, 0.55, 0.16), 0.27, 0.38, brass, Vector3.ZERO, "Bell")
			_weak_node = _add_cylinder(Vector3(0, 1.22, 0.63), 0.25, 0.16, _weak_material, Vector3(PI / 2.0, 0, 0), "Regulator")
			_base_visual_height = 0.0
		_:
			_add_capsule(Vector3(0, 0.93, 0), 0.4, 1.82, dark_flesh, "ListenerBody")
			_add_sphere(Vector3(0, 1.73, -0.05), 0.32, dark_flesh, "Head")
			_add_limb(Vector3(-0.46, 0.92, 0), Vector3(0.11, 0.88, 0.11), -0.2, dark_flesh, "LeftArm")
			_add_limb(Vector3(0.46, 0.92, 0), Vector3(0.11, 0.88, 0.11), 0.2, dark_flesh, "RightArm")
			_weak_node = _add_sphere(Vector3(0, 1.15, 0.39), 0.18, _weak_material, "VesperNode")
			_base_visual_height = 0.0


func _physics_process(delta: float) -> void:
	if not _built:
		return
	_attack_cooldown = maxf(0.0, _attack_cooldown - delta)
	_weak_reveal_time = maxf(0.0, _weak_reveal_time - delta)
	_regulator_exposed_time = maxf(0.0, _regulator_exposed_time - delta)
	_update_weak_point()

	if not active or ai_state in [STATE_DORMANT, STATE_DEAD]:
		velocity = Vector3.ZERO
		return
	if target == null or not is_instance_valid(target):
		velocity = Vector3.ZERO
		return

	if not is_on_floor():
		velocity.y -= 20.0 * delta
	else:
		velocity.y = -0.5

	if ai_state == STATE_STAGGER:
		_state_time -= delta
		velocity.x = move_toward(velocity.x, 0.0, 10.0 * delta)
		velocity.z = move_toward(velocity.z, 0.0, 10.0 * delta)
		if _state_time <= 0.0:
			_set_state(STATE_CHASE)
		move_and_slide()
		return
	if ai_state == STATE_DOWNED:
		_update_downed(delta)
		move_and_slide()
		return
	if ai_state in [STATE_TELEGRAPH]:
		_update_telegraph(delta)
		move_and_slide()
		return

	var distance_to_target := global_position.distance_to(target.global_position)
	var safe_target := _target_is_safe()
	if safe_target:
		if ai_state == STATE_CHASE:
			_investigation_point = global_position
			_set_state(STATE_IDLE)
	elif _can_see_target(distance_to_target):
		if kind == "wader":
			_emerge()
		if kind == "chorus":
			_alert_from_chorus()
		elif distance_to_target <= attack_range and _attack_cooldown <= 0.0:
			_begin_attack()
		else:
			_set_state(STATE_CHASE)

	match ai_state:
		STATE_CHASE:
			_move_toward(target.global_position, chase_speed, delta)
		STATE_INVESTIGATE:
			_investigation_time -= delta
			_move_toward(_investigation_point, walk_speed, delta)
			if global_position.distance_to(_investigation_point) < 0.75 or _investigation_time <= 0.0:
				_set_state(STATE_IDLE)
		_:
			velocity.x = move_toward(velocity.x, 0.0, 8.0 * delta)
			velocity.z = move_toward(velocity.z, 0.0, 8.0 * delta)
	move_and_slide()
	_update_visual_motion(delta)


func hear_noise(source_position: Vector3, loudness: float) -> void:
	if not active or ai_state in [STATE_DEAD, STATE_DOWNED, STATE_STAGGER]:
		return
	var audible_radius := loudness if loudness > 2.0 else hearing_range * maxf(loudness, 0.05)
	if global_position.distance_to(source_position) > audible_radius:
		return
	_investigation_point = source_position
	_investigation_time = 5.0 if kind != "bellman" else 8.0
	if kind == "wader":
		_emerge()
	if kind == "chorus":
		_alert_from_chorus()
	else:
		_set_state(STATE_INVESTIGATE)


func receive_shot(
	hit_position: Vector3,
	damage: float = 1.0,
	lamp_reveal: bool = false
) -> Dictionary:
	if not active or ai_state == STATE_DEAD:
		return {"accepted": false, "weak": false, "permanent": false}
	var weak_distance := INF
	if is_instance_valid(_weak_node):
		weak_distance = hit_position.distance_to(_weak_node.global_position)
	var weak_visible := lamp_reveal or _weak_reveal_time > 0.0
	var weak_hit := weak_distance <= (0.42 if kind == "bellman" else 0.36) and weak_visible

	if kind == "bellman":
		if weak_hit and _regulator_exposed_time > 0.0:
			_bellman_weak_hits += 1
			if _bellman_weak_hits >= 3:
				_permanent_defeat()
			else:
				_stagger(2.2)
			return {"accepted": true, "weak": true, "permanent": _bellman_weak_hits >= 3}
		_stagger(0.34)
		return {"accepted": true, "weak": false, "permanent": false}

	if weak_hit:
		_permanent_defeat()
		return {"accepted": true, "weak": true, "permanent": true}

	health -= maxf(damage, 0.1)
	if health <= 0.0:
		_down_enemy()
	else:
		_stagger(0.45 if kind == "wader" else 0.62)
	return {"accepted": true, "weak": false, "permanent": false}


func reveal_weak_point(duration: float = 0.25) -> void:
	_weak_reveal_time = maxf(_weak_reveal_time, duration)


func expose_regulator(duration: float = 7.0) -> bool:
	if kind != "bellman" or ai_state == STATE_DEAD:
		return false
	_regulator_exposed_time = maxf(_regulator_exposed_time, duration)
	_weak_reveal_time = maxf(_weak_reveal_time, duration)
	_stagger(1.15)
	return true


func set_active(value: bool) -> void:
	if not is_inside_tree():
		active = value
		return
	if ai_state == STATE_DEAD:
		active = false
		return
	if not value:
		if kind == "bellman" and _external_bellman_banished():
			_permanent_defeat()
			return
		if active:
			_state_before_deactivation = ai_state
		active = false
		_set_state(STATE_DORMANT)
		velocity = Vector3.ZERO
		return
	active = true
	var resume_state := _state_before_deactivation
	if resume_state in [STATE_DORMANT, STATE_DEAD]:
		resume_state = STATE_IDLE
	_set_state(resume_state)


func _can_see_target(distance_to_target: float) -> bool:
	if distance_to_target > sight_range or _target_is_safe():
		return false
	var to_target := target.global_position - global_position
	to_target.y = 0.0
	if to_target.length_squared() < 0.001:
		return true
	var facing := -global_basis.z
	facing.y = 0.0
	var minimum_dot := -0.25 if ai_state == STATE_CHASE else 0.18
	if facing.normalized().dot(to_target.normalized()) < minimum_dot:
		return false
	var from := global_position + Vector3.UP * (1.65 if kind == "bellman" else 1.25)
	var to := target.global_position + Vector3.UP * 1.0
	var query := PhysicsRayQueryParameters3D.create(from, to, 1 | 2)
	query.exclude = [get_rid()]
	var hit := get_world_3d().direct_space_state.intersect_ray(query)
	if hit.is_empty():
		return true
	var collider: Object = hit.get("collider")
	return collider == target or (collider is Node and target.is_ancestor_of(collider as Node))


func _move_toward(destination: Vector3, speed: float, delta: float) -> void:
	if speed <= 0.0:
		velocity.x = move_toward(velocity.x, 0.0, 8.0 * delta)
		velocity.z = move_toward(velocity.z, 0.0, 8.0 * delta)
		return
	var direction := destination - global_position
	direction.y = 0.0
	if direction.length_squared() < 0.01:
		return
	direction = direction.normalized()
	velocity.x = move_toward(velocity.x, direction.x * speed, 7.5 * delta)
	velocity.z = move_toward(velocity.z, direction.z * speed, 7.5 * delta)
	rotation.y = lerp_angle(rotation.y, atan2(-direction.x, -direction.z), minf(1.0, delta * 5.5))


func _begin_attack() -> void:
	if ai_state == STATE_TELEGRAPH:
		return
	_set_state(STATE_TELEGRAPH)
	_state_time = 0.82 if kind == "bellman" else (0.58 if kind == "wader" else 0.68)
	velocity.x = 0.0
	velocity.z = 0.0
	attack_started.emit(self)
	_call_game("play_enemy_cue", [self, "attack"])


func _update_telegraph(delta: float) -> void:
	_state_time -= delta
	velocity.x = move_toward(velocity.x, 0.0, 10.0 * delta)
	velocity.z = move_toward(velocity.z, 0.0, 10.0 * delta)
	if is_instance_valid(_visual_root):
		_visual_root.rotation.z = sin(Time.get_ticks_msec() * 0.025) * 0.045
	if _state_time > 0.0:
		return
	if is_instance_valid(_visual_root):
		_visual_root.rotation.z = 0.0
	var distance := global_position.distance_to(target.global_position)
	if distance <= attack_range + 0.65 and not _target_is_safe():
		if target.has_method("receive_damage"):
			target.call("receive_damage", attack_damage)
		else:
			_call_game("damage_player", [attack_damage])
		attack_landed.emit(self, attack_damage)
	_attack_cooldown = 1.45 if kind != "bellman" else 2.15
	_set_state(STATE_CHASE)


func _alert_from_chorus() -> void:
	if _attack_cooldown > 0.0:
		return
	_attack_cooldown = 4.0
	_call_game("emit_noise", [global_position, 26.0])
	_call_game("play_enemy_cue", [self, "chorus"])
	if global_position.distance_to(target.global_position) <= attack_range and not _target_is_safe():
		_begin_attack()


func _stagger(duration: float) -> void:
	if ai_state in [STATE_DEAD, STATE_DOWNED]:
		return
	_set_state(STATE_STAGGER)
	_state_time = maxf(duration, 0.1)
	velocity = -global_basis.z * -1.4


func _down_enemy() -> void:
	_set_state(STATE_DOWNED)
	_downed_recovery_time = 6.0 if kind == "listener" else 8.0
	health = 0.0
	velocity = Vector3.ZERO
	defeated.emit(self, false)


func _update_downed(delta: float) -> void:
	_downed_recovery_time -= delta
	velocity.x = 0.0
	velocity.z = 0.0
	if is_instance_valid(_visual_root):
		_visual_root.rotation.z = lerp_angle(_visual_root.rotation.z, 1.35, minf(1.0, delta * 6.0))
	if _downed_recovery_time <= 0.0:
		health = max_health * 0.5
		if is_instance_valid(_visual_root):
			_visual_root.rotation.z = 0.0
		_set_state(STATE_INVESTIGATE)
		_investigation_point = target.global_position
		_investigation_time = 3.0


func _permanent_defeat() -> void:
	if ai_state == STATE_DEAD:
		return
	_set_state(STATE_DEAD)
	active = false
	velocity = Vector3.ZERO
	if is_instance_valid(_visual_root):
		var tween := create_tween()
		tween.tween_property(_visual_root, "rotation:z", 1.45, 0.32)
		tween.parallel().tween_property(_visual_root, "position:y", _base_visual_height - 0.35, 0.32)
	defeated.emit(self, true)
	if kind == "bellman":
		_call_game("on_bellman_banished", [self])
	else:
		_call_game("on_enemy_defeated", [self])


func _emerge() -> void:
	if kind != "wader" or _emerged:
		return
	_emerged = true
	if is_instance_valid(_visual_root):
		var tween := create_tween()
		tween.set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_OUT)
		tween.tween_property(_visual_root, "position:y", 0.0, 0.58)
	_call_game("play_enemy_cue", [self, "wader_emerge"])


func _update_visual_motion(delta: float) -> void:
	if not is_instance_valid(_visual_root) or ai_state in [STATE_DOWNED, STATE_DEAD]:
		return
	var planar_speed := Vector2(velocity.x, velocity.z).length()
	var bob := sin(Time.get_ticks_msec() * 0.008 * maxf(planar_speed, 0.25)) * minf(planar_speed * 0.025, 0.08)
	var target_height := 0.0 if _emerged else _base_visual_height
	_visual_root.position.y = lerpf(_visual_root.position.y, target_height + bob, minf(1.0, delta * 7.0))


func _update_weak_point() -> void:
	if not is_instance_valid(_weak_material):
		return
	var visible_strength := 0.18
	if _weak_reveal_time > 0.0:
		visible_strength = 3.8
	if kind == "bellman" and _regulator_exposed_time <= 0.0:
		visible_strength *= 0.2
	_weak_material.emission_energy_multiplier = visible_strength


func _target_is_safe() -> bool:
	if game != null and game.has_method("is_in_safe_room") and is_instance_valid(target):
		return bool(game.call("is_in_safe_room", target.global_position))
	return false


func _external_bellman_banished() -> bool:
	if game == null:
		return false
	var external_state: Variant = game.get("state")
	return external_state != null and str(external_state.get("bellman_state")) == "banished"


func _set_state(next_state: String) -> void:
	if ai_state == next_state:
		return
	ai_state = next_state
	state_changed.emit(self, next_state)


func _call_game(method: StringName, arguments: Array = []) -> Variant:
	if game != null and game.has_method(method):
		return game.callv(method, arguments)
	return null


func _material(
	color: Color,
	roughness: float,
	metallic: float,
	emission: Color = Color(0, 0, 0, 0),
	emission_energy: float = 1.0
) -> StandardMaterial3D:
	var result := StandardMaterial3D.new()
	result.albedo_color = color
	result.roughness = roughness
	result.metallic = metallic
	if emission.a > 0.0:
		result.emission_enabled = true
		result.emission = emission
		result.emission_energy_multiplier = emission_energy
	return result


func _add_capsule(
	part_position: Vector3,
	radius: float,
	height: float,
	part_material: Material,
	part_name: String
) -> MeshInstance3D:
	var mesh := CapsuleMesh.new()
	mesh.radius = radius
	mesh.height = height
	return _add_mesh(mesh, part_position, Vector3.ZERO, part_material, part_name)


func _add_sphere(
	part_position: Vector3,
	radius: float,
	part_material: Material,
	part_name: String
) -> MeshInstance3D:
	var mesh := SphereMesh.new()
	mesh.radius = radius
	mesh.height = radius * 2.0
	mesh.radial_segments = 12
	mesh.rings = 8
	return _add_mesh(mesh, part_position, Vector3.ZERO, part_material, part_name)


func _add_box(
	part_position: Vector3,
	size: Vector3,
	part_material: Material,
	part_name: String
) -> MeshInstance3D:
	var mesh := BoxMesh.new()
	mesh.size = size
	return _add_mesh(mesh, part_position, Vector3.ZERO, part_material, part_name)


func _add_cylinder(
	part_position: Vector3,
	radius: float,
	height: float,
	part_material: Material,
	part_rotation: Vector3,
	part_name: String
) -> MeshInstance3D:
	var mesh := CylinderMesh.new()
	mesh.top_radius = radius
	mesh.bottom_radius = radius
	mesh.height = height
	mesh.radial_segments = 12
	return _add_mesh(mesh, part_position, part_rotation, part_material, part_name)


func _add_limb(
	part_position: Vector3,
	size: Vector3,
	z_rotation: float,
	part_material: Material,
	part_name: String
) -> MeshInstance3D:
	var mesh := CylinderMesh.new()
	mesh.top_radius = size.x
	mesh.bottom_radius = size.z
	mesh.height = size.y
	mesh.radial_segments = 8
	return _add_mesh(mesh, part_position, Vector3(0, 0, z_rotation), part_material, part_name)


func _add_mesh(
	mesh: PrimitiveMesh,
	part_position: Vector3,
	part_rotation: Vector3,
	part_material: Material,
	part_name: String
) -> MeshInstance3D:
	var instance := MeshInstance3D.new()
	instance.name = part_name
	instance.mesh = mesh
	instance.position = part_position
	instance.rotation = part_rotation
	instance.material_override = part_material
	instance.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON
	_visual_root.add_child(instance)
	return instance
