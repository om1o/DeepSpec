class_name HushPlayer
extends CharacterBody3D

## Third-person survival-horror controller. The actor owns immediate feel
## (movement, recoil, lamp heat) while durable resources remain in GameState.

signal shot_fired(origin: Vector3, hit_position: Vector3)
signal damaged(amount: int)
signal died
signal interaction_changed(prompt: String)

const ACTION_FORWARD := &"hp_forward"
const ACTION_BACK := &"hp_back"
const ACTION_LEFT := &"hp_left"
const ACTION_RIGHT := &"hp_right"
const ACTION_SPRINT := &"hp_sprint"
const ACTION_CROUCH := &"hp_crouch"
const ACTION_AIM := &"hp_aim"
const ACTION_FIRE := &"hp_fire"
const ACTION_INTERACT := &"hp_interact"
const ACTION_RELOAD := &"hp_reload"
const ACTION_QUICK_TURN := &"hp_quick_turn"
const ACTION_DECOY := &"hp_decoy"
const ACTION_HEAL := &"hp_heal"
const ACTION_LAMP := &"hp_lamp"

const WALK_SPEED := 3.65
const SPRINT_SPEED := 5.9
const CROUCH_SPEED := 1.9
const AIM_SPEED := 2.45
const ACCELERATION := 16.0
const GRAVITY := 22.0

var state: RefCounted
var game: Node
var camera: Camera3D
var lamp: SpotLight3D

var control_enabled: bool = false
var stamina: float = 1.0
var lamp_heat: float = 0.0
var lamp_on: bool = true
var aiming: bool = false
var crouching: bool = false
var reduced_camera_motion: bool = false
var reduced_flashes: bool = false

var _camera_rig: Node3D
var _pitch_pivot: Node3D
var _spring_arm: SpringArm3D
var _visual_root: Node3D
var _handgun_visual: MeshInstance3D
var _lamp_visual: MeshInstance3D
var _collision: CollisionShape3D
var _muzzle: Marker3D
var _interactable: CollisionObject3D
var _current_prompt: String = ""
var _yaw_angle: float = 0.0
var _pitch_angle: float = deg_to_rad(-8.0)
var _recoil: float = 0.0
var _step_distance: float = 0.0
var _motion_time: float = 0.0
var _lamp_lock_time: float = 0.0
var _dead_reported: bool = false
var _fallback_health: int = 100
var _fallback_magazine: int = 6
var _fallback_ammo: int = 12
var _built: bool = false


func configure(game_state: RefCounted, game_controller: Node) -> HushPlayer:
	state = game_state
	game = game_controller
	if _built:
		_sync_equipment_visibility()
	return self


func set_reduced_camera_motion(enabled: bool) -> void:
	reduced_camera_motion = enabled
	if reduced_camera_motion:
		_recoil = 0.0


func set_reduced_flashes(enabled: bool) -> void:
	reduced_flashes = enabled
	if reduced_flashes and is_instance_valid(lamp):
		lamp.light_energy = 3.2


func _ready() -> void:
	collision_layer = 2
	collision_mask = 1 | 4
	_build_actor()
	_build_camera()
	_built = true
	set_control_enabled(control_enabled)


func _build_actor() -> void:
	_collision = CollisionShape3D.new()
	_collision.name = "PlayerCollision"
	var capsule := CapsuleShape3D.new()
	capsule.radius = 0.34
	capsule.height = 1.72
	_collision.shape = capsule
	_collision.position.y = 0.86
	add_child(_collision)

	_visual_root = Node3D.new()
	_visual_root.name = "LenaOrr"
	add_child(_visual_root)
	var coat := _material(Color("263d42"), 0.78, 0.06)
	var coat_dark := _material(Color("101b20"), 0.88, 0.03)
	var skin := _material(Color("9b6c54"), 0.72, 0.0)
	var hair := _material(Color("171315"), 0.9, 0.0)
	var metal := _material(Color("283034"), 0.28, 0.72)
	var cyan := _material(Color("64b7b5"), 0.35, 0.25, Color("176d73"), 1.6)

	_add_capsule(_visual_root, Vector3(0, 1.0, 0), 0.3, 1.25, coat, "OilskinCoat")
	_add_sphere(_visual_root, Vector3(0, 1.72, 0), 0.25, skin, "Head")
	_add_box(_visual_root, Vector3(0, 1.91, 0.03), Vector3(0.43, 0.12, 0.43), hair, "Hair")
	_add_cylinder(_visual_root, Vector3(-0.34, 1.08, -0.04), 0.085, 0.7, coat_dark, Vector3(0, 0, -0.15), "LeftArm")
	_add_cylinder(_visual_root, Vector3(0.34, 1.08, -0.04), 0.085, 0.7, coat_dark, Vector3(0, 0, 0.15), "RightArm")
	_add_cylinder(_visual_root, Vector3(-0.16, 0.4, 0), 0.1, 0.7, coat_dark, Vector3.ZERO, "LeftLeg")
	_add_cylinder(_visual_root, Vector3(0.16, 0.4, 0), 0.1, 0.7, coat_dark, Vector3.ZERO, "RightLeg")
	_handgun_visual = _add_box(_visual_root, Vector3(0.25, 1.22, -0.37), Vector3(0.13, 0.13, 0.48), metal, "Handgun")
	_lamp_visual = _add_box(_visual_root, Vector3(-0.28, 1.28, -0.28), Vector3(0.16, 0.16, 0.34), cyan, "InspectionLamp")
	_muzzle = Marker3D.new()
	_muzzle.name = "Muzzle"
	_muzzle.position = Vector3(0.25, 1.23, -0.64)
	_visual_root.add_child(_muzzle)


func _build_camera() -> void:
	_camera_rig = Node3D.new()
	_camera_rig.name = "ShoulderCameraRig"
	add_child(_camera_rig)
	_camera_rig.top_level = true
	_camera_rig.global_position = global_position + Vector3.UP * 1.48
	_yaw_angle = rotation.y
	_camera_rig.rotation.y = _yaw_angle

	_pitch_pivot = Node3D.new()
	_pitch_pivot.name = "Pitch"
	_pitch_pivot.rotation.x = _pitch_angle
	_camera_rig.add_child(_pitch_pivot)

	_spring_arm = SpringArm3D.new()
	_spring_arm.name = "CameraCollision"
	_spring_arm.spring_length = 3.35
	_spring_arm.margin = 0.12
	_spring_arm.collision_mask = 1
	_pitch_pivot.add_child(_spring_arm)

	camera = Camera3D.new()
	camera.name = "PlayerCamera"
	camera.current = true
	camera.fov = 68.0
	camera.near = 0.08
	camera.position.x = 0.62
	_spring_arm.add_child(camera)

	lamp = SpotLight3D.new()
	lamp.name = "InspectionBeam"
	lamp.position = Vector3(0.16, -0.12, -0.22)
	lamp.spot_range = 16.0
	lamp.spot_angle = 24.0
	lamp.light_color = Color("86e3dc")
	lamp.light_energy = 3.2
	lamp.shadow_enabled = true
	lamp.distance_fade_enabled = true
	lamp.distance_fade_begin = 13.0
	lamp.distance_fade_length = 5.0
	camera.add_child(lamp)


func _unhandled_input(event: InputEvent) -> void:
	if not control_enabled:
		return
	if event is InputEventMouseMotion and Input.mouse_mode == Input.MOUSE_MODE_CAPTURED:
		var motion := event as InputEventMouseMotion
		_yaw_angle -= motion.relative.x * 0.0022
		_pitch_angle = clampf(_pitch_angle - motion.relative.y * 0.0019, deg_to_rad(-48.0), deg_to_rad(42.0))
		get_viewport().set_input_as_handled()


func _physics_process(delta: float) -> void:
	if not _built:
		return
	_sync_equipment_visibility()
	_update_camera(delta)
	_update_lamp(delta)
	if not control_enabled or _is_dead():
		velocity.x = move_toward(velocity.x, 0.0, ACCELERATION * delta)
		velocity.z = move_toward(velocity.z, 0.0, ACCELERATION * delta)
		_apply_gravity(delta)
		move_and_slide()
		_update_interaction(false)
		return

	_handle_action_inputs()
	_update_movement(delta)
	_update_interaction(true)
	_update_weak_point_reveal()
	_call_game("update_hud")


func _handle_action_inputs() -> void:
	aiming = _pressed(ACTION_AIM) and _has_state_flag("handgun_acquired")
	crouching = _pressed(ACTION_CROUCH)
	if _just_pressed(ACTION_FIRE):
		_fire_handgun()
	if _just_pressed(ACTION_RELOAD):
		_reload_handgun()
	if _just_pressed(ACTION_INTERACT) and is_instance_valid(_interactable):
		_call_game("handle_interaction", [_interactable])
	if _just_pressed(ACTION_QUICK_TURN):
		_quick_turn()
	if _just_pressed(ACTION_DECOY):
		_use_decoy()
	if _just_pressed(ACTION_HEAL):
		_use_heal()
	if _just_pressed(ACTION_LAMP):
		_toggle_lamp()


func _update_movement(delta: float) -> void:
	var input_vector := Vector2(
		_action_strength(ACTION_RIGHT) - _action_strength(ACTION_LEFT),
		_action_strength(ACTION_BACK) - _action_strength(ACTION_FORWARD)
	)
	if input_vector.length_squared() > 1.0:
		input_vector = input_vector.normalized()
	var camera_forward := -_camera_rig.global_basis.z
	camera_forward.y = 0.0
	camera_forward = camera_forward.normalized()
	var camera_right := _camera_rig.global_basis.x
	camera_right.y = 0.0
	camera_right = camera_right.normalized()
	var direction := camera_right * input_vector.x + camera_forward * -input_vector.y

	var wants_sprint := _pressed(ACTION_SPRINT) and not aiming and not crouching and input_vector.y < -0.1
	var sprinting := wants_sprint and stamina > 0.04
	if sprinting:
		stamina = maxf(0.0, stamina - delta * 0.23)
	else:
		stamina = minf(1.0, stamina + delta * (0.1 if wants_sprint else 0.17))
	var speed := WALK_SPEED
	if sprinting:
		speed = SPRINT_SPEED
	elif crouching:
		speed = CROUCH_SPEED
	elif aiming:
		speed = AIM_SPEED

	if direction.length_squared() > 0.001:
		direction = direction.normalized()
		velocity.x = move_toward(velocity.x, direction.x * speed, ACCELERATION * get_physics_process_delta_time())
		velocity.z = move_toward(velocity.z, direction.z * speed, ACCELERATION * get_physics_process_delta_time())
		var facing := camera_forward if aiming else direction
		rotation.y = lerp_angle(rotation.y, atan2(-facing.x, -facing.z), minf(1.0, delta * (11.0 if aiming else 8.0)))
	else:
		velocity.x = move_toward(velocity.x, 0.0, ACCELERATION * delta)
		velocity.z = move_toward(velocity.z, 0.0, ACCELERATION * delta)
		if aiming:
			rotation.y = lerp_angle(rotation.y, _yaw_angle, minf(1.0, delta * 11.0))

	_apply_gravity(delta)
	move_and_slide()
	_update_stance(delta)
	_update_footsteps(delta, sprinting)


func _apply_gravity(delta: float) -> void:
	if not is_on_floor():
		velocity.y -= GRAVITY * delta
	else:
		velocity.y = -0.6


func _update_stance(delta: float) -> void:
	var capsule := _collision.shape as CapsuleShape3D
	var target_height := 1.16 if crouching else 1.72
	var target_center := target_height * 0.5
	capsule.height = lerpf(capsule.height, target_height, minf(1.0, delta * 10.0))
	_collision.position.y = lerpf(_collision.position.y, target_center, minf(1.0, delta * 10.0))
	var visual_scale_y := 0.75 if crouching else 1.0
	_visual_root.scale.y = lerpf(_visual_root.scale.y, visual_scale_y, minf(1.0, delta * 9.0))


func _update_footsteps(delta: float, sprinting: bool) -> void:
	var planar_speed := Vector2(velocity.x, velocity.z).length()
	_motion_time += delta * planar_speed
	if planar_speed < 0.25 or not is_on_floor():
		_step_distance = 0.0
		return
	_step_distance += planar_speed * delta
	var stride := 1.4 if sprinting else (2.0 if crouching else 1.7)
	if _step_distance < stride:
		return
	_step_distance = 0.0
	var radius := 3.5 if crouching else (11.0 if sprinting else 6.0)
	_call_game("emit_noise", [global_position, radius])
	_call_game("play_footstep", [global_position, sprinting, crouching])


func _update_camera(delta: float) -> void:
	if not is_instance_valid(_camera_rig):
		return
	_recoil = 0.0 if reduced_camera_motion else move_toward(_recoil, 0.0, delta * 0.12)
	_camera_rig.rotation.y = _yaw_angle
	_pitch_pivot.rotation.x = _pitch_angle + _recoil
	var planar_speed := Vector2(velocity.x, velocity.z).length()
	var bob := 0.0
	if not reduced_camera_motion and control_enabled and is_on_floor() and planar_speed > 0.4:
		bob = sin(_motion_time * 5.4) * minf(planar_speed * 0.0045, 0.025)
	var height := 1.18 if crouching else 1.5
	_camera_rig.global_position = global_position + Vector3.UP * (height + bob)
	var target_fov := 58.0 if aiming else (71.5 if _pressed(ACTION_SPRINT) else 68.0)
	camera.fov = lerpf(camera.fov, target_fov, minf(1.0, delta * 8.5))
	_spring_arm.spring_length = lerpf(_spring_arm.spring_length, 2.65 if aiming else 3.35, minf(1.0, delta * 10.0))
	camera.position.x = lerpf(camera.position.x, 0.72 if aiming else 0.62, minf(1.0, delta * 10.0))


func _update_lamp(delta: float) -> void:
	_lamp_lock_time = maxf(0.0, _lamp_lock_time - delta)
	if not _has_state_flag("equipment_checked"):
		lamp_heat = maxf(0.0, lamp_heat - delta * 0.16)
		lamp.visible = false
		return
	if not control_enabled:
		lamp_heat = maxf(0.0, lamp_heat - delta * 0.16)
		lamp.visible = false
		return
	if lamp_on and _lamp_lock_time <= 0.0:
		lamp_heat = minf(1.0, lamp_heat + delta * 0.047)
		if lamp_heat >= 1.0:
			lamp_on = false
			_lamp_lock_time = 2.8
			_call_game("notify_player", ["INSPECTION LAMP OVERHEATED"])
	else:
		lamp_heat = maxf(0.0, lamp_heat - delta * 0.16)
	lamp.visible = lamp_on and _lamp_lock_time <= 0.0
	if lamp.visible:
		var warning_pulse := 1.0
		if lamp_heat > 0.82 and not reduced_flashes:
			warning_pulse = 0.68 + sin(Time.get_ticks_msec() * 0.026) * 0.28
		lamp.light_energy = 3.2 * warning_pulse


func _toggle_lamp() -> void:
	if not _has_state_flag("equipment_checked"):
		_call_game("notify_player", ["INSPECTION LAMP IS STILL IN TRUCK SEVEN"])
		return
	if _lamp_lock_time > 0.0:
		return
	lamp_on = not lamp_on
	_call_game("update_hud")


func _fire_handgun() -> void:
	if not _has_state_flag("handgun_acquired"):
		_call_game("notify_player", ["NO SIDEARM — THIS WAS A ROUTINE CALL-OUT"])
		return
	if not aiming:
		_call_game("notify_player", ["HOLD AIM BEFORE FIRING"])
		return
	var fired := false
	if state != null and state.has_method("fire_handgun"):
		fired = bool(state.call("fire_handgun"))
	elif _fallback_magazine > 0 and _fallback_health > 0:
		_fallback_magazine -= 1
		fired = true
	if not fired:
		_call_game("play_dry_fire")
		_call_game("notify_player", ["HANDGUN EMPTY"])
		return

	var origin := camera.global_position
	var end := origin - camera.global_basis.z * 48.0
	var query := PhysicsRayQueryParameters3D.create(origin, end, 1 | 4)
	query.exclude = [get_rid()]
	var hit := get_world_3d().direct_space_state.intersect_ray(query)
	var hit_position := end
	if not hit.is_empty():
		hit_position = hit.get("position", end)
		var collider: Object = hit.get("collider")
		if collider != null and collider.has_method("receive_shot"):
			collider.call("receive_shot", hit_position, 1.0, is_lamp_revealing())

	if not reduced_camera_motion:
		_recoil = maxf(_recoil - deg_to_rad(1.7), deg_to_rad(-6.0))
	_call_game("emit_noise", [global_position, 30.0])
	_call_game("play_player_shot", [_muzzle.global_position, hit_position])
	shot_fired.emit(_muzzle.global_position, hit_position)
	_call_game("update_hud")


func _reload_handgun() -> void:
	if not _has_state_flag("handgun_acquired"):
		_call_game("notify_player", ["NO SIDEARM TO RELOAD"])
		return
	var loaded := 0
	if state != null and state.has_method("reload_handgun"):
		loaded = int(state.call("reload_handgun"))
	else:
		loaded = mini(6 - _fallback_magazine, _fallback_ammo)
		_fallback_magazine += loaded
		_fallback_ammo -= loaded
	if loaded > 0:
		_call_game("emit_noise", [global_position, 2.5])
		_call_game("notify_player", ["LOADED %d ROUND%s" % [loaded, "" if loaded == 1 else "S"]])
	else:
		_call_game("notify_player", ["NO ROUNDS TO LOAD"])
	_call_game("update_hud")


func _use_decoy() -> void:
	if state == null or not state.has_method("remove_item"):
		_call_game("notify_player", ["NO NOISE DECOY"])
		return
	if not bool(state.call("remove_item", "noise_decoy", 1)):
		_call_game("notify_player", ["NO NOISE DECOY"])
		return
	var forward := -camera.global_basis.z
	var landing := global_position + Vector3(forward.x, 0.0, forward.z).normalized() * 6.0
	_call_game("register_decoy", [landing])
	_call_game("emit_noise", [landing, 22.0])
	_call_game("update_hud")


func _use_heal() -> void:
	var healed := false
	if state != null and state.has_method("use_healing_wrap"):
		healed = bool(state.call("use_healing_wrap"))
	elif _fallback_health < 100:
		_fallback_health = mini(100, _fallback_health + 35)
		healed = true
	_call_game("notify_player", ["WOUND STABILIZED" if healed else "CANNOT USE COAGULANT WRAP"])
	_call_game("update_hud")


func _quick_turn() -> void:
	_yaw_angle = wrapf(_yaw_angle + PI, -PI, PI)
	rotation.y = _yaw_angle
	_call_game("emit_noise", [global_position, 2.2])


func _update_interaction(allow_interaction: bool) -> void:
	var next_interactable: CollisionObject3D
	var next_prompt := ""
	if allow_interaction and is_instance_valid(camera):
		var origin := camera.global_position
		var end := origin - camera.global_basis.z * 3.8
		var query := PhysicsRayQueryParameters3D.create(origin, end, 1)
		query.exclude = [get_rid()]
		var hit := get_world_3d().direct_space_state.intersect_ray(query)
		if not hit.is_empty():
			var collider: Object = hit.get("collider")
			if collider is CollisionObject3D and collider.has_meta("interaction_kind"):
				next_interactable = collider as CollisionObject3D
				next_prompt = str(collider.get_meta("interaction_prompt", "E  INTERACT"))
	_interactable = next_interactable
	if next_prompt == _current_prompt:
		return
	_current_prompt = next_prompt
	interaction_changed.emit(_current_prompt)
	_call_game("set_interaction_prompt", [_current_prompt])


func _update_weak_point_reveal() -> void:
	if not is_lamp_revealing() or not aiming:
		return
	var origin := camera.global_position
	var end := origin - camera.global_basis.z * 17.0
	var query := PhysicsRayQueryParameters3D.create(origin, end, 4)
	query.exclude = [get_rid()]
	var hit := get_world_3d().direct_space_state.intersect_ray(query)
	if hit.is_empty():
		return
	var collider: Object = hit.get("collider")
	if collider != null and collider.has_method("reveal_weak_point"):
		collider.call("reveal_weak_point", 0.24)


func receive_damage(amount: int) -> bool:
	if amount <= 0 or _is_dead():
		return false
	var accepted := false
	if state != null and state.has_method("apply_damage"):
		accepted = bool(state.call("apply_damage", amount))
	else:
		_fallback_health = maxi(0, _fallback_health - amount)
		accepted = true
	if not accepted:
		return false
	damaged.emit(amount)
	_call_game("show_damage", [amount])
	_call_game("update_hud")
	if _is_dead() and not _dead_reported:
		_dead_reported = true
		control_enabled = false
		died.emit()
		_call_game("on_player_dead")
	return true


func set_control_enabled(value: bool) -> void:
	control_enabled = value
	if value:
		Input.mouse_mode = Input.MOUSE_MODE_CAPTURED
	else:
		Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
		aiming = false
		_update_interaction(false)


func set_controls_enabled(value: bool) -> void:
	set_control_enabled(value)


func is_lamp_revealing() -> bool:
	return lamp_on and _lamp_lock_time <= 0.0 and lamp_heat < 1.0


func health_state() -> String:
	if state != null and state.has_method("health_state"):
		return str(state.call("health_state"))
	if _fallback_health <= 0:
		return "dead"
	if _fallback_health <= 30:
		return "critical"
	if _fallback_health <= 70:
		return "wounded"
	return "stable"


func magazine_count() -> int:
	if state != null:
		return int(state.get("magazine"))
	return _fallback_magazine


func reserve_ammo_count() -> int:
	if state != null and state.has_method("item_count"):
		return int(state.call("item_count", "handgun_ammo"))
	return _fallback_ammo


func current_prompt() -> String:
	return _current_prompt


func _sync_equipment_visibility() -> void:
	if is_instance_valid(_handgun_visual):
		_handgun_visual.visible = _has_state_flag("handgun_acquired")
	if is_instance_valid(_lamp_visual):
		_lamp_visual.visible = _has_state_flag("equipment_checked")


func _has_state_flag(property_name: StringName) -> bool:
	if state == null:
		return false
	for property in state.get_property_list():
		if StringName(property.get("name", "")) == property_name:
			return bool(state.get(property_name))
	return false


func _is_dead() -> bool:
	return health_state() == "dead"


func _pressed(action: StringName) -> bool:
	return InputMap.has_action(action) and Input.is_action_pressed(action)


func _just_pressed(action: StringName) -> bool:
	return InputMap.has_action(action) and Input.is_action_just_pressed(action)


func _action_strength(action: StringName) -> float:
	return Input.get_action_strength(action) if InputMap.has_action(action) else 0.0


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
	parent: Node3D,
	part_position: Vector3,
	radius: float,
	height: float,
	part_material: Material,
	part_name: String
) -> MeshInstance3D:
	var mesh := CapsuleMesh.new()
	mesh.radius = radius
	mesh.height = height
	return _add_mesh(parent, mesh, part_position, Vector3.ZERO, part_material, part_name)


func _add_sphere(
	parent: Node3D,
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
	return _add_mesh(parent, mesh, part_position, Vector3.ZERO, part_material, part_name)


func _add_box(
	parent: Node3D,
	part_position: Vector3,
	size: Vector3,
	part_material: Material,
	part_name: String
) -> MeshInstance3D:
	var mesh := BoxMesh.new()
	mesh.size = size
	return _add_mesh(parent, mesh, part_position, Vector3.ZERO, part_material, part_name)


func _add_cylinder(
	parent: Node3D,
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
	mesh.radial_segments = 10
	return _add_mesh(parent, mesh, part_position, part_rotation, part_material, part_name)


func _add_mesh(
	parent: Node3D,
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
	parent.add_child(instance)
	return instance
