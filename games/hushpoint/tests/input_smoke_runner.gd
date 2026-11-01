extends SceneTree

## Input-level smoke coverage for the two controller paths that the broader
## integration runner cannot prove by calling game.handle_interaction directly:
##
## 1. The live shoulder camera ray acquires a physical world interaction and a
##    mapped E key event reaches HushPlayer._handle_action_inputs.
## 2. Mapped aim/fire mouse events drive HushPlayer._fire_handgun and its real
##    physics ray into the Bellman actor at the exposed regulator region.

const MAIN_SCENE := preload("res://main.tscn")
const TEST_PROFILE_ENV := "HUSHPOINT_TEST_PROFILE"
const USER_PATHS := [
	"user://hushpoint_save.json",
	"user://hushpoint_save.tmp",
	"user://hushpoint_save.bak",
	"user://hushpoint_settings.cfg",
]

var assertions: int = 0
var failures: int = 0
var game: Node
var preserved_files: Dictionary = {}
var shot_count: int = 0
var last_shot_hit := Vector3.ZERO


func _initialize() -> void:
	if not _using_isolated_test_profile():
		printerr("HUSHPOINT INPUT SMOKE: REFUSED (run through test.ps1 so user:// is isolated)")
		quit(2)
		return
	call_deferred("_run")


func _using_isolated_test_profile() -> bool:
	var profile_root := OS.get_environment(TEST_PROFILE_ENV).replace("\\", "/").trim_suffix("/").to_lower()
	if profile_root.is_empty():
		return false
	var user_root := ProjectSettings.globalize_path("user://").replace("\\", "/").to_lower()
	return user_root == profile_root or user_root.begins_with(profile_root + "/")


func _run() -> void:
	_preserve_and_clear_user_files()

	var packed: PackedScene = MAIN_SCENE
	game = packed.instantiate()
	root.add_child(game)
	await _wait_physics_ticks(3)

	if is_instance_valid(game):
		await _test_camera_interaction_input()
		await _test_weapon_raycast_input()
	else:
		_check(false, "main.tscn must instantiate for input smoke coverage")

	_release_all_test_inputs()
	if is_instance_valid(game):
		game.queue_free()
		await process_frame
		await process_frame
	_restore_user_files()

	if failures == 0:
		print("HUSHPOINT INPUT SMOKE: PASS (%d assertions)" % assertions)
		quit(0)
	else:
		printerr("HUSHPOINT INPUT SMOKE: FAIL (%d failures, %d assertions)" % [failures, assertions])
		quit(1)


func _test_camera_interaction_input() -> void:
	game.call("_new_game")
	game.call("_enter_gameplay")
	await _wait_physics_ticks(2)

	var player: Node3D = game.get("player")
	var state: Variant = game.get("state")
	var work_order := _find_interaction("surface_work_order")
	_check(is_instance_valid(player), "live HushPlayer must exist")
	_check(state != null, "live GameState must exist")
	_check(is_instance_valid(work_order), "physical surface work-order interaction must exist")
	_check(InputMap.has_action("hp_interact"), "game must register the hp_interact action")
	if not is_instance_valid(player) or state == null or not is_instance_valid(work_order):
		return

	# The interaction ray starts at the third-person camera, 3.35 m behind Lena.
	# Staging Lena just in front of the document keeps the real ray within its
	# authored 3.8 m reach without replacing or bypassing any collision geometry.
	var target_position: Vector3 = work_order.global_position
	var exterior: Node3D = game.get("exterior_root")
	player.global_position = Vector3(
		target_position.x,
		exterior.global_position.y + 0.05,
		target_position.z + 0.05,
	)
	player.velocity = Vector3.ZERO
	await _aim_live_camera_at(target_position)
	await _wait_physics_ticks(2)

	var selected: Variant = player.get("_interactable")
	if not is_instance_valid(selected) or selected != work_order:
		var camera: Camera3D = player.get("camera")
		var ray_origin := camera.global_position
		var ray_end := ray_origin - camera.global_basis.z * 3.8
		var ray_query := PhysicsRayQueryParameters3D.create(ray_origin, ray_end, 1)
		ray_query.exclude = [player.get_rid()]
		var ray_hit := player.get_world_3d().direct_space_state.intersect_ray(ray_query)
		printerr(
			"  INTERACTION RAY DEBUG camera=%s forward=%s target=%s hit=%s collider=%s" % [
				ray_origin,
				-camera.global_basis.z,
				target_position,
				ray_hit.get("position", Vector3.ZERO),
				ray_hit.get("collider"),
			]
		)
	_check(
		is_instance_valid(selected) and selected == work_order,
		"live camera interaction ray must select the physical work order",
	)
	_check(
		str(player.call("current_prompt")) == str(work_order.get_meta("interaction_prompt", "")),
		"camera selection must publish the authored interaction prompt",
	)
	_check(not bool(state.get("work_order_reviewed")), "work order must be unread before mapped input")

	var press := _key_event(KEY_E, true)
	_check(InputMap.event_is_action(press, "hp_interact"), "physical E event must map to hp_interact")
	Input.parse_input_event(press)
	await _wait_physics_ticks(1)
	Input.parse_input_event(_key_event(KEY_E, false))
	await _wait_physics_ticks(1)

	_check(bool(state.get("work_order_reviewed")), "mapped E input must activate the selected world interaction")
	_check(
		bool(game.get("consumed").has("surface_work_order")),
		"controller-triggered interaction must consume the physical work-order node",
	)
	_check(str(game.get("mode")) == "overlay", "work-order input must reach the real lore-overlay result")


func _test_weapon_raycast_input() -> void:
	var player: Node3D = game.get("player")
	var state: Variant = game.get("state")
	var bellman: CharacterBody3D = game.get("bellman")
	_check(is_instance_valid(player) and state != null, "weapon smoke requires the live player and state")
	_check(is_instance_valid(bellman), "weapon smoke requires the physical Bellman actor")
	_check(InputMap.has_action("hp_aim") and InputMap.has_action("hp_fire"), "game must register aim and fire actions")
	if not is_instance_valid(player) or state == null or not is_instance_valid(bellman):
		return

	# Resume after the work-order overlay, then reach encounter prerequisites via
	# GameState's public progression API. Direct positioning only removes a long
	# traversal from this focused controller/raycast smoke test.
	game.call("_resume_game")
	_check(bool(state.call("check_equipment")), "combat setup must check equipment")
	_check(bool(state.call("read_physical_gauge")), "combat setup must read the physical gauge")
	_check(bool(state.call("check_telemetry")), "combat setup must check telemetry")
	_check(bool(state.call("restore_relay")), "combat setup must restore the relay")
	_check(bool(state.call("log_report")), "combat setup must log the report")
	_check(bool(state.call("unlock_station_entry")), "combat setup must unlock station entry")
	_check(bool(state.call("enter_station")), "combat setup must enter the station")
	_check(bool(state.call("acquire_handgun")), "combat setup must acquire the handgun")
	_check(bool(state.call("collect_fuse", "fuse_15a")), "combat setup must collect the 15A fuse")
	_check(bool(state.call("collect_fuse", "fuse_30a")), "combat setup must collect the 30A fuse")
	_check(bool(state.call("install_fuse", "fuse_15a")), "combat setup must install the 15A fuse")
	_check(bool(state.call("install_fuse", "fuse_30a")), "combat setup must install the 30A fuse")
	for fragment_id in ["spool_a", "spool_b", "spool_c"]:
		_check(bool(state.call("collect_spool_fragment", fragment_id)), "combat setup must collect %s" % fragment_id)
	_check(bool(state.call("assemble_spool")), "combat setup must reconstruct the counter-signal")
	for valve_id in ["intake", "balance", "outflow"]:
		_check(bool(state.call("turn_tide_valve", valve_id)), "combat setup must turn %s in order" % valve_id)
	_check(bool(state.call("transition_bellman", "searching")), "combat setup must wake the Bellman")
	_check(bool(state.call("transition_bellman", "hunting")), "combat setup must put the Bellman in hunting state")

	# Isolate the ray path high above authored geometry. The real CharacterBody3D
	# collider remains active, while Bellman AI physics is paused so aim is stable.
	var arena_origin := Vector3(500.0, 100.0, 500.0)
	_add_test_floor(arena_origin)
	bellman.global_position = arena_origin
	bellman.set_active(true)
	bellman.set_physics_process(false)
	_check(bool(bellman.call("expose_regulator", 7.0)), "Bellman regulator must be exposed through its real actor API")
	var weak_node: Node3D = bellman.get("_weak_node")
	_check(is_instance_valid(weak_node), "Bellman must retain its authored regulator target")
	if not is_instance_valid(weak_node):
		return

	player.global_position = arena_origin + Vector3(0.0, 0.0, 4.0)
	player.velocity = Vector3.ZERO
	player.call("set_reduced_camera_motion", true)
	game.set("reduced_flashes", true)
	player.call("set_control_enabled", true)
	await _aim_live_camera_at(weak_node.global_position)
	await _wait_physics_ticks(2)

	shot_count = 0
	last_shot_hit = Vector3.ZERO
	if not player.shot_fired.is_connected(_on_shot_fired):
		player.shot_fired.connect(_on_shot_fired)
	var magazine_before := int(state.get("magazine"))
	var weak_hits_before := int(bellman.get("_bellman_weak_hits"))

	var aim_press := _mouse_event(MOUSE_BUTTON_RIGHT, true)
	var fire_press := _mouse_event(MOUSE_BUTTON_LEFT, true)
	_check(InputMap.event_is_action(aim_press, "hp_aim"), "physical right mouse event must map to hp_aim")
	_check(InputMap.event_is_action(fire_press, "hp_fire"), "physical left mouse event must map to hp_fire")
	Input.parse_input_event(aim_press)
	await _wait_physics_ticks(1)
	_check(bool(player.get("aiming")), "mapped right mouse input must put the live controller into aim")
	Input.parse_input_event(fire_press)
	await _wait_physics_ticks(1)
	Input.parse_input_event(_mouse_event(MOUSE_BUTTON_LEFT, false))
	Input.parse_input_event(_mouse_event(MOUSE_BUTTON_RIGHT, false))
	await _wait_physics_ticks(1)

	_check(shot_count == 1, "mapped fire input must emit exactly one real shot")
	_check(int(state.get("magazine")) == magazine_before - 1, "real controller fire must consume one magazine round")
	if int(bellman.get("_bellman_weak_hits")) != weak_hits_before + 1:
		var camera: Camera3D = player.get("camera")
		printerr(
			"  RAY DEBUG camera=%s forward=%s target=%s hit=%s distance=%.3f" % [
				camera.global_position,
				-camera.global_basis.z,
				weak_node.global_position,
				last_shot_hit,
				last_shot_hit.distance_to(weak_node.global_position),
			]
		)
	_check(
		int(bellman.get("_bellman_weak_hits")) == weak_hits_before + 1,
		"weapon physics ray must register one exposed-regulator hit on Bellman",
	)
	_check(
		last_shot_hit.distance_to(weak_node.global_position) <= 0.42,
		"weapon ray hit must land within Bellman's authored regulator radius",
	)


func _aim_live_camera_at(target_position: Vector3) -> void:
	var player: Node3D = game.get("player")
	var camera: Camera3D = player.get("camera")
	if not is_instance_valid(camera):
		_check(false, "player camera must exist before aiming")
		return
	# Recompute after each live controller update because the spring arm changes
	# camera position when pitch changes. This converges without bypassing the
	# controller's authored shoulder-camera transform.
	for _iteration in range(14):
		var direction := target_position - camera.global_position
		if direction.length_squared() <= 0.0001:
			break
		direction = direction.normalized()
		var desired_yaw := atan2(-direction.x, -direction.z)
		var desired_pitch := asin(clampf(direction.y, -0.99, 0.99))
		player.set(
			"_yaw_angle",
			lerp_angle(float(player.get("_yaw_angle")), desired_yaw, 0.35),
		)
		player.set(
			"_pitch_angle",
			lerpf(float(player.get("_pitch_angle")), desired_pitch, 0.35),
		)
		await _wait_physics_ticks(1)


func _find_interaction(interaction_id: String) -> StaticBody3D:
	var world_root: Node = game.get("world_root")
	if not is_instance_valid(world_root):
		return null
	for child in world_root.find_children("*", "StaticBody3D", true, false):
		if str(child.get_meta("interaction_id", "")) == interaction_id:
			return child as StaticBody3D
	return null


func _add_test_floor(arena_origin: Vector3) -> void:
	var floor := StaticBody3D.new()
	floor.name = "InputSmokeFloor"
	floor.collision_layer = 1
	floor.collision_mask = 0
	var collision := CollisionShape3D.new()
	var shape := BoxShape3D.new()
	shape.size = Vector3(20.0, 0.1, 20.0)
	collision.shape = shape
	floor.add_child(collision)
	game.add_child(floor)
	floor.global_position = arena_origin + Vector3(0.0, -0.05, 0.0)


func _on_shot_fired(_origin: Vector3, hit_position: Vector3) -> void:
	shot_count += 1
	last_shot_hit = hit_position


func _wait_physics_ticks(count: int) -> void:
	for _index in range(count):
		await physics_frame
		await process_frame


func _key_event(keycode: Key, pressed: bool) -> InputEventKey:
	var event := InputEventKey.new()
	event.physical_keycode = keycode
	event.keycode = keycode
	event.pressed = pressed
	return event


func _mouse_event(button: MouseButton, pressed: bool) -> InputEventMouseButton:
	var event := InputEventMouseButton.new()
	event.button_index = button
	event.position = Vector2(640.0, 360.0)
	event.pressed = pressed
	return event


func _release_all_test_inputs() -> void:
	for action in ["hp_interact", "hp_aim", "hp_fire"]:
		if InputMap.has_action(action):
			Input.action_release(action)


func _check(condition: bool, message: String) -> void:
	assertions += 1
	if condition:
		return
	failures += 1
	printerr("  FAIL  %s" % message)


func _preserve_and_clear_user_files() -> void:
	for path in USER_PATHS:
		if FileAccess.file_exists(path):
			var file := FileAccess.open(path, FileAccess.READ)
			if file == null:
				failures += 1
				printerr("  FAIL  could not preserve %s" % path)
				continue
			preserved_files[path] = file.get_buffer(file.get_length())
			file.close()
		_remove_user_file(path)


func _restore_user_files() -> void:
	for path in USER_PATHS:
		_remove_user_file(path)
	for path in preserved_files:
		var file := FileAccess.open(path, FileAccess.WRITE)
		if file == null:
			failures += 1
			printerr("  FAIL  could not restore %s" % path)
			continue
		file.store_buffer(preserved_files[path])
		file.close()


func _remove_user_file(path: String) -> void:
	if not FileAccess.file_exists(path):
		return
	var error := DirAccess.remove_absolute(ProjectSettings.globalize_path(path))
	if error != OK:
		failures += 1
		printerr("  FAIL  could not remove test file %s (error %d)" % [path, error])
