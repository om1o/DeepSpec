extends Node3D

const GameStateClass = preload("res://scripts/game_state.gd")
const WorldBuilder = preload("res://scripts/world_builder.gd")
const OutdoorBuilder = preload("res://scripts/outdoor_builder.gd")
const AudioFactoryClass = preload("res://scripts/audio_factory.gd")
const PlayerClass = preload("res://scripts/player.gd")
const EnemyClass = preload("res://scripts/enemy.gd")
const UiClass = preload("res://scripts/ui.gd")

const SAVE_PATH := "user://hushpoint_save.json"
const SAVE_TEMP_PATH := "user://hushpoint_save.tmp"
const SAVE_BACKUP_PATH := "user://hushpoint_save.bak"

const MODE_TITLE := "title"
const MODE_INTRO := "intro"
const MODE_PLAYING := "playing"
const MODE_OVERLAY := "overlay"
const MODE_PAUSED := "paused"
const MODE_DEAD := "dead"
const MODE_VICTORY := "victory"
const EXTERIOR_OFFSET := Vector3(0, 0, 160)

const LORE: Dictionary = {
	"surface_work_order": {
		"id": "dock_manifest",
		"title": "CALL-OUT 03-117 / PAPER COPY",
		"body": "North telemetry is reading 23 cm high. Compare it with the physical staff, reset relay R-4, file the sheet, and leave. Gate controls stay untouched without a verified Control challenge."
	},
	"lore_quiet_night": {
		"id": "quiet_night_calls",
		"title": "QUIET NIGHT / CALL TRANSCRIPT",
		"body": "23:41 — Calls overlap across seven dead lines. Each caller repeats the next caller's final word before it is spoken. Diver Gideon Rusk orders the lower archive isolated, then manually grounds its carrier through his regulator. The public report later names Rusk as the cause. The dive log says he was the lock."
	},
	"lore_vesperite": {
		"id": "palinode_log",
		"title": "PALINODE TEST 12",
		"body": "Vesperite does not store sound. PALINODE models the next emergency call, then uses powered doors, pumps, speakers, and frightened operators to reduce the difference between prediction and reality. It is not remembering us. It is forcing the rehearsal to come true."
	},
	"lore_mara": {
		"id": "mara_last_message",
		"title": "MARA ORR / LAST SHIFT",
		"body": "Lena, I made this before you came. PALINODE does not remember us; it rehearses us, then hurts people until the rehearsal is true. It brought you because my lock needs an Orr voice. Rusk did not cause Quiet Night. Break the crystals driving his regulator, couple him to the purge, and trust ink, brass, and nothing that answers."
	},
}

var state = GameStateClass.new()
var mode: String = MODE_TITLE
var world_root: Node3D
var interior_root: Node3D
var exterior_root: Node3D
var effects_root: Node3D
var player
var ui
var enemies: Array = []
var bellman
var world_data: Dictionary = {}
var outdoor_data: Dictionary = {}
var consumed: Dictionary = {}
var checkpoint_position := Vector3.ZERO
var flicker_time := 0.0
var ambient: AudioStreamPlayer
var bell_audio: AudioStreamPlayer3D
var environment_settings: Environment
var fill_light: DirectionalLight3D
var reduced_flashes: bool = false
var lightning_delay: float = 8.0
var lightning_flash_time: float = 0.0


func _ready() -> void:
	_register_inputs()
	_build_environment()
	_build_world()
	_build_audio()
	_build_ui()
	_build_player_and_enemies()
	checkpoint_position = _surface_global(outdoor_data["spawn_player"])
	if get_tree().has_meta("hushpoint_autoload"):
		get_tree().remove_meta("hushpoint_autoload")
		if _load_game():
			_enter_gameplay()
			return
	show_title()


func _exit_tree() -> void:
	if is_instance_valid(ambient):
		ambient.stop()
		ambient.stream = null
	if is_instance_valid(bell_audio):
		bell_audio.stop()
		bell_audio.stream = null


func _process(delta: float) -> void:
	flicker_time += delta
	for index in range(world_data.get("lights", []).size()):
		var light: OmniLight3D = world_data["lights"][index]
		if not bool(light.get_meta("flicker", false)):
			continue
		var base_energy: float = float(light.get_meta("base_energy", 1.0))
		if reduced_flashes:
			light.light_energy = base_energy * 0.92
			continue
		var pulse := sin(flicker_time * (7.1 + index)) * 0.08
		var dropout := 0.28 if fmod(flicker_time * (0.73 + index * 0.09), 8.0) < 0.055 else 0.0
		light.light_energy = base_energy * (0.92 + pulse - dropout)
	if is_instance_valid(player) and mode == MODE_PLAYING and player.global_position.y < -6.0:
		player.global_position = checkpoint_position
		player.velocity = Vector3.ZERO
		ui.show_notice("SAFETY LINE RECOVERED — WATCH YOUR FOOTING")
	if state.exterior_returned and mode == MODE_PLAYING:
		lightning_delay -= delta
		if lightning_delay <= 0.0:
			lightning_delay = 9.0 + fmod(flicker_time * 1.73, 6.0)
			lightning_flash_time = 0.08 if not reduced_flashes else 0.0
	if lightning_flash_time > 0.0:
		lightning_flash_time -= delta
		fill_light.light_energy = 1.8
	elif is_instance_valid(fill_light):
		fill_light.light_energy = 0.46 if state.exterior_returned else (0.55 if not state.station_entered else 0.32)


func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventKey and event.pressed and not event.echo:
		if event.keycode == KEY_F11:
			var next_mode := DisplayServer.WINDOW_MODE_WINDOWED
			if DisplayServer.window_get_mode() == DisplayServer.WINDOW_MODE_WINDOWED:
				next_mode = DisplayServer.WINDOW_MODE_FULLSCREEN
			DisplayServer.window_set_mode(next_mode)
			get_viewport().set_input_as_handled()
			return
		if event.keycode == KEY_TAB and mode == MODE_PLAYING:
			_open_inventory()
			get_viewport().set_input_as_handled()
			return
		if event.keycode == KEY_ESCAPE:
			if mode == MODE_PLAYING:
				_pause_game()
			elif mode == MODE_PAUSED or mode == MODE_OVERLAY:
				_resume_game()
			get_viewport().set_input_as_handled()


func _build_environment() -> void:
	var world_environment := WorldEnvironment.new()
	var environment := Environment.new()
	environment.background_mode = Environment.BG_COLOR
	environment.background_color = Color("020609")
	environment.background_energy_multiplier = 0.32
	environment.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	environment.ambient_light_color = Color("19313a")
	environment.ambient_light_energy = 0.58
	environment.tonemap_mode = Environment.TONE_MAPPER_FILMIC
	environment.fog_enabled = true
	environment.fog_light_color = Color("183238")
	environment.fog_light_energy = 0.42
	environment.fog_density = 0.0065
	environment.fog_height = 0.0
	environment.fog_height_density = 0.06
	world_environment.environment = environment
	environment_settings = environment
	world_environment.name = "TidalStationEnvironment"
	add_child(world_environment)
	fill_light = DirectionalLight3D.new()
	fill_light.name = "ColdEmergencyFill"
	fill_light.rotation_degrees = Vector3(-68, -22, 0)
	fill_light.light_color = Color("284b55")
	fill_light.light_energy = 0.32
	fill_light.shadow_enabled = false
	add_child(fill_light)


func _build_world() -> void:
	world_root = Node3D.new()
	world_root.name = "HushpointWorld"
	add_child(world_root)
	interior_root = Node3D.new()
	interior_root.name = "LowerStation"
	world_root.add_child(interior_root)
	exterior_root = Node3D.new()
	exterior_root.name = "SurfaceCompound"
	exterior_root.position = EXTERIOR_OFFSET
	world_root.add_child(exterior_root)
	effects_root = Node3D.new()
	effects_root.name = "TransientEffects"
	add_child(effects_root)
	world_data = WorldBuilder.build(interior_root)
	outdoor_data = OutdoorBuilder.build(exterior_root)
	world_data["lights"].append_array(outdoor_data.get("lights", []))


func _build_audio() -> void:
	ambient = AudioStreamPlayer.new()
	ambient.name = "IndustrialDrone"
	ambient.stream = AudioFactoryClass.industrial_drone()
	ambient.volume_db = -18.0
	add_child(ambient)
	# Godot's headless audio driver retains looped WAV playback until process exit.
	# Runtime builds still receive the full procedural drone.
	if DisplayServer.get_name() != "headless":
		ambient.play()
	bell_audio = AudioStreamPlayer3D.new()
	bell_audio.name = "BellmanBell"
	bell_audio.stream = AudioFactoryClass.bell()
	bell_audio.max_distance = 70.0
	bell_audio.volume_db = -4.0
	add_child(bell_audio)


func _build_ui() -> void:
	ui = UiClass.new()
	ui.name = "HushpointUI"
	ui.process_mode = Node.PROCESS_MODE_ALWAYS
	add_child(ui)
	ui.new_game_requested.connect(_new_game)
	ui.continue_requested.connect(_continue_game)
	ui.quit_requested.connect(_quit_game)
	ui.intro_finished.connect(_enter_gameplay)
	ui.resume_requested.connect(_resume_game)
	ui.restart_requested.connect(_restart_from_checkpoint)
	ui.settings_changed.connect(_on_settings_changed)
	if ui.has_signal("overlay_closed"):
		ui.overlay_closed.connect(_resume_game)
	if ui.has_signal("menu_requested"):
		ui.menu_requested.connect(show_title)


func _build_player_and_enemies() -> void:
	player = PlayerClass.new()
	player.name = "LenaOrr"
	add_child(player)
	player.global_position = _surface_global(outdoor_data["spawn_player"])
	player.configure(state, self)
	player.set_control_enabled(false)
	for spawn_data in world_data["enemy_spawns"]:
		var enemy = EnemyClass.new()
		enemy.name = "Enemy_%s" % spawn_data["kind"]
		add_child(enemy)
		enemy.global_position = spawn_data["position"]
		enemy.set_meta("spawn_position", spawn_data["position"])
		enemy.set_meta("spawn_kind", spawn_data["kind"])
		enemy.set_meta("spawn_index", enemies.size())
		enemy.configure(spawn_data["kind"], player, self)
		enemy.set_active(false)
		enemies.append(enemy)
	bellman = EnemyClass.new()
	bellman.name = "TheBellman"
	add_child(bellman)
	bellman.global_position = world_data["bellman_spawn"]
	bellman.set_meta("spawn_position", world_data["bellman_spawn"])
	bellman.set_meta("spawn_kind", "bellman")
	bellman.configure("bellman", player, self)
	bellman.set_active(false)
	enemies.append(bellman)


func show_title() -> void:
	mode = MODE_TITLE
	_set_actor_activity(false)
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	ui.show_title(FileAccess.file_exists(SAVE_PATH))


func _new_game() -> void:
	state = GameStateClass.new()
	consumed.clear()
	checkpoint_position = _surface_global(outdoor_data["spawn_player"])
	player.configure(state, self)
	player.global_position = checkpoint_position
	_reset_enemies()
	_reset_world_visuals()
	_sync_phase_visuals()
	_set_surface_mood(false)
	mode = MODE_INTRO
	_set_actor_activity(false)
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	ui.show_intro()


func _continue_game() -> void:
	if _load_game():
		_enter_gameplay()
	else:
		ui.show_notice("SAVE UNREADABLE — START A NEW DESCENT")
		ui.show_title(false)


func _enter_gameplay() -> void:
	if not state.final_radio_choice.is_empty():
		_show_ending(state.final_radio_choice)
		return
	if state.health <= 0:
		state.health = state.MAX_HEALTH
	mode = MODE_PLAYING
	ui.show_gameplay()
	_set_actor_activity(true)
	Input.mouse_mode = Input.MOUSE_MODE_CAPTURED
	update_hud()
	if not FileAccess.file_exists(SAVE_PATH):
		_write_save()


func _pause_game() -> void:
	mode = MODE_PAUSED
	_set_actor_activity(false)
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	ui.show_pause()


func _open_inventory() -> void:
	mode = MODE_OVERLAY
	_set_actor_activity(false)
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	ui.show_inventory(state, current_objective(), _discovered_lore())


func _resume_game() -> void:
	if mode == MODE_DEAD or mode == MODE_VICTORY or mode == MODE_TITLE or mode == MODE_INTRO:
		return
	_enter_gameplay()


func _quit_game() -> void:
	get_tree().quit()


func _restart_from_checkpoint() -> void:
	get_tree().set_meta("hushpoint_autoload", true)
	get_tree().reload_current_scene()


func _set_actor_activity(active: bool) -> void:
	if is_instance_valid(player):
		player.set_control_enabled(active)
	for enemy in enemies:
		if not is_instance_valid(enemy):
			continue
		enemy.set_physics_process(false)
		if not active:
			continue
		if not state.station_entered or state.exterior_returned:
			enemy.set_active(false)
			continue
		if enemy == bellman:
			if state.bellman_state != "dormant" and state.bellman_state != "banished" and not enemy.active:
				enemy.set_active(true)
				enemy.set_physics_process(enemy.active)
			continue
		var spawn_index := int(enemy.get_meta("spawn_index", 0))
		var allowed := spawn_index == 0
		if spawn_index == 1:
			allowed = state.handgun_acquired
		elif spawn_index == 2:
			allowed = state.power_online
		elif spawn_index >= 3:
			allowed = state.spool_assembled
		if allowed and enemy.ai_state == enemy.STATE_DORMANT:
			enemy.set_active(true)
		enemy.set_physics_process(allowed and enemy.active)


func set_interaction_prompt(text: String) -> void:
	if mode == MODE_PLAYING:
		ui.set_prompt(text)


func handle_interaction(body: Node) -> void:
	if mode != MODE_PLAYING or not is_instance_valid(body) or not body.has_meta("interaction_kind"):
		return
	var kind := str(body.get_meta("interaction_kind"))
	var interaction_id := str(body.get_meta("interaction_id"))
	var payload: Variant = body.get_meta("payload") if body.has_meta("payload") else null
	match kind:
		"tutorial":
			_handle_surface_tutorial(body)
		"pickup":
			_handle_pickup(body, interaction_id, str(payload))
		"fuse_panel":
			_handle_fuse_panel()
		"spool_bench":
			_handle_spool_bench()
		"tide_valve":
			_handle_tide_valve(int(payload))
		"valve_reset":
			state.reset_tide_valves()
			ui.show_notice("TIDE MANIFOLD RESET")
		"door":
			_handle_door(body, interaction_id, str(payload))
		"purge_breaker":
			_handle_purge_breaker(body, int(payload))
		"recorder":
			checkpoint_position = player.global_position
			_write_save()
			ui.show_notice("VOICE CHECKPOINT RECORDED")
		"storage":
			_open_inventory()
		"lore":
			_handle_lore(interaction_id)
		"steam_valve":
			_handle_steam_valve(body)
		"surface_exit":
			_handle_surface_exit(body)
		"final_radio":
			_handle_final_radio(body, str(payload.get("choice", "") if payload is Dictionary else payload))
	update_hud()


func _handle_surface_tutorial(body: Node) -> void:
	var step := str(body.get_meta("tutorial_step", ""))
	var accepted := false
	match step:
		"read_work_order":
			accepted = state.review_work_order()
			if accepted:
				state.discover_lore("dock_manifest")
		"check_equipment":
			accepted = state.check_equipment()
		"read_physical_gauge":
			accepted = state.read_physical_gauge()
		"check_telemetry":
			accepted = state.check_telemetry()
		"restore_relay":
			accepted = state.restore_relay()
		"log_report":
			accepted = state.log_report()
		"unlock_station_entry":
			accepted = state.unlock_station_entry()
		"enter_station":
			accepted = state.enter_station()
	if not accepted:
		ui.show_notice("PROCEDURE OUT OF ORDER — FOLLOW THE VERIFIED WORK ORDER")
		return

	var interaction_id := str(body.get_meta("interaction_id", ""))
	if step == "enter_station":
		_open_door(body)
		consumed[interaction_id] = true
		player.global_position = world_data["spawn_player"]
		player.velocity = Vector3.ZERO
		checkpoint_position = player.global_position
		_sync_phase_visuals()
		_set_surface_mood(false)
		ui.show_notice("JUNE / VERIFIED: UPPER CONTROL ONLY. DO NOT MOVE THE GATES.")
		_write_save()
		_set_actor_activity(true)
		return

	_consume_interaction(body, interaction_id)
	var payload: Variant = body.get_meta("payload", {})
	if step == "check_equipment":
		ui.show_notice("FIELD KIT CHECKED — F TO TOGGLE THE INSPECTION LAMP")
	elif step == "log_report":
		ui.show_notice("UNPOWERED PA / UNKNOWN: GAUGE. RELAY. SHEET. HOME.")
	elif payload is Dictionary and payload.has("title"):
		mode = MODE_OVERLAY
		_set_actor_activity(false)
		Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
		ui.show_lore(str(payload.get("title", "FIELD NOTE")), str(payload.get("text", "")))
	_write_save()


func _handle_surface_exit(body: Node) -> void:
	if not state.return_to_exterior():
		ui.show_notice("SURFACE ROUTE LOCKED — COMPLETE THE COUNTERFLOW PURGE")
		return
	_consume_interaction(body, str(body.get_meta("interaction_id", "interior_surface_exit")))
	player.global_position = _surface_global(outdoor_data["station_entry_position"] + Vector3(0, 0, 2.2))
	player.velocity = Vector3.ZERO
	checkpoint_position = player.global_position
	_sync_phase_visuals()
	_set_surface_mood(true)
	_set_actor_activity(true)
	ui.show_notice("JUNE / VERIFIED: HUSHPOINT NEVER SENT A GATE COMMAND. RETURN TO TRUCK SEVEN.")
	_write_save()


func _handle_final_radio(body: Node, choice: String) -> void:
	if not state.choose_final_radio(choice):
		ui.show_notice("THE RADIO HAS ALREADY GONE QUIET")
		return
	for radio_choice in outdoor_data.get("final_radio_choices", []):
		if is_instance_valid(radio_choice):
			_consume_interaction(radio_choice, str(radio_choice.get_meta("interaction_id", "final_radio")))
	_write_save()
	_show_ending(choice)


func _show_ending(choice: String) -> void:
	mode = MODE_VICTORY
	_set_actor_activity(false)
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	if choice == "break":
		ui.show_victory("REHEARSAL BROKEN — THE HARBOR LIGHTS HOLD")
	else:
		ui.show_victory("REHEARSAL COMPLETE — THE HARBOR SPEAKS IN LENA'S VOICE")


func _handle_pickup(body: Node, interaction_id: String, payload: String) -> void:
	var accepted := false
	var notice := "INVENTORY FULL"
	match payload:
		"fuse_15a", "fuse_30a":
			accepted = state.collect_fuse(payload)
			notice = "RATED CERAMIC FUSE ACQUIRED"
		"spool_a", "spool_b", "spool_c":
			accepted = state.collect_spool_fragment(payload)
			notice = "RED ARCHIVE SPOOL FRAGMENT ACQUIRED"
		"ammo":
			accepted = state.add_item("handgun_ammo", 6)
			notice = "6 HANDGUN ROUNDS ACQUIRED"
		"heal":
			accepted = state.add_item("healing_wrap", 1)
			notice = "COAGULANT WRAP ACQUIRED"
		"flare":
			accepted = state.add_item("noise_decoy", 1)
			notice = "SIGNAL DECOY ACQUIRED"
		"harmonic_key":
			accepted = state.collect_key("harmonic_key")
			notice = "HARMONIC SERVICE KEY ACQUIRED"
		"handgun":
			accepted = state.acquire_handgun()
			notice = "RESPONSE HANDGUN ACQUIRED — SIX ROUNDS LOADED"
	if accepted:
		_consume_interaction(body, interaction_id)
		ui.show_notice(notice)
		_play_one_shot(body.global_position, AudioFactoryClass.tone(680.0, 0.12, 0.22, 12.0), -9.0)
	else:
		ui.show_notice("INVENTORY FULL OR ITEM ALREADY TAKEN")


func _handle_fuse_panel() -> void:
	var installed_any := false
	for fuse_id in state.REQUIRED_FUSES:
		if state.install_fuse(fuse_id):
			installed_any = true
	if state.power_online:
		ui.show_notice("EMERGENCY POWER ONLINE — RECORDS BULKHEAD RELEASED")
		checkpoint_position = player.global_position
		_write_save()
		emit_noise(player.global_position, 0.72)
	elif installed_any:
		ui.show_notice("ONE MATCHED FUSE INSTALLED — SECOND SOCKET EMPTY")
	else:
		ui.show_notice("TWO RATED FUSES REQUIRED: 15A + 30A")


func _handle_spool_bench() -> void:
	if state.assemble_spool():
		state.discover_lore("mara_last_message")
		ui.show_lore(
			"MARA'S RECONSTRUCTED MESSAGE",
			"Lena, I finished this before you came. PALINODE predicts our calls, then forces people to perform them. It falsified the sensor because my lock needs an Orr voice. Rusk is the grounding circuit, not the cause. Balance INTAKE → BALANCE → OUTFLOW, vent his regulator, and break the three crystals driving it. Trust ink. Trust brass. Trust nothing that answers."
		)
		mode = MODE_OVERLAY
		_set_actor_activity(false)
		Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
		_reveal_harmonic_key_if_ready()
		_write_save()
	else:
		ui.show_notice("THREE RED SPOOL FRAGMENTS REQUIRED")


func _handle_tide_valve(number: int) -> void:
	var valve_ids := ["intake", "balance", "outflow"]
	if number < 1 or number > valve_ids.size():
		return
	var accepted: bool = state.turn_tide_valve(valve_ids[number - 1])
	if accepted and state.tide_balanced:
		ui.show_notice("COUNTERFLOW BALANCED — SOMETHING ANSWERS BELOW")
		state.transition_bellman("searching")
		state.transition_bellman("hunting")
		bellman.global_position = world_data["bellman_spawn"]
		bellman.set_active(true)
		bell_audio.global_position = bellman.global_position
		bell_audio.play()
		emit_noise(player.global_position, 1.0)
		_reveal_harmonic_key_if_ready()
		_write_save()
	elif accepted:
		ui.show_notice("VALVE %d LOCKED — %d / 3" % [number, state.tide_valve_progress.size()])
	else:
		ui.show_notice("PRESSURE SURGE — SEQUENCE RESET")
		emit_noise(player.global_position, 0.58)


func _handle_door(body: Node, interaction_id: String, requirement: String) -> void:
	if bool(body.get_meta("opened", false)):
		return
	if interaction_id == "records_door":
		if not state.power_online:
			ui.show_notice("BULKHEAD HAS NO POWER")
			return
		_open_door(body)
		consumed[interaction_id] = true
		ui.show_notice("RECORDS BULKHEAD OPEN")
	elif interaction_id == "vault_door":
		if not state.unlock_door("purge_vault"):
			ui.show_notice("HARMONIC SERVICE KEY REQUIRED")
			return
		_open_door(body)
		consumed[interaction_id] = true
		ui.show_notice("PURGE VAULT OPEN — THE BELL CANNOT FOLLOW FOREVER")
		_write_save()


func _handle_purge_breaker(body: Node, number: int) -> void:
	var breaker_ids := ["north", "east", "west"]
	if number < 1 or number > breaker_ids.size():
		return
	if state.activate_purge_breaker(breaker_ids[number - 1]):
		_consume_interaction(body, "purge_%d" % number)
		emit_noise(body.global_position, 1.0)
		ui.show_notice("PURGE BREAKER %d ENGAGED" % number)
		if state.victory:
			state.unlock_exterior_escape()
			_sync_phase_visuals()
			ui.show_notice("COUNTERFLOW COMPLETE — SURFACE BULKHEAD RELEASED")
		_write_save()
	else:
		ui.show_notice("COUNTERFLOW INTERLOCK DENIED — RUSK'S REGULATOR IS STILL SINGING")


func _handle_lore(interaction_id: String) -> void:
	if not LORE.has(interaction_id):
		return
	var entry: Dictionary = LORE[interaction_id]
	state.discover_lore(entry["id"])
	mode = MODE_OVERLAY
	_set_actor_activity(false)
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	ui.show_lore(entry["title"], entry["body"])


func _handle_steam_valve(body: Node) -> void:
	emit_noise(body.global_position, 1.0)
	_play_one_shot(body.global_position, AudioFactoryClass.tone(86.0, 0.8, 0.46, 2.8, 0.76, 81), -4.0)
	if is_instance_valid(bellman) and bellman.active and bellman.global_position.distance_to(body.global_position) <= 11.0:
		if state.bellman_state == "searching":
			state.transition_bellman("hunting")
		state.transition_bellman("staggered")
		bellman.expose_regulator(7.0)
		if state.spool_assembled:
			ui.show_notice("REGULATOR EXPOSED — AIM THE LAMP AND LAND 3 NODE SHOTS")
		else:
			ui.show_notice("REGULATOR EXPOSED — THE RECONSTRUCTED SIGNAL IS MISSING")
	else:
		ui.show_notice("PRESSURE VENTED — THE STATION HEARS IT")


func _reveal_harmonic_key_if_ready() -> void:
	if not state.spool_assembled or not state.tide_balanced:
		return
	var key: StaticBody3D = world_data["harmonic_key"]
	if consumed.has("harmonic_key"):
		return
	key.visible = true
	key.process_mode = Node.PROCESS_MODE_INHERIT
	key.collision_layer = 1
	ui.show_notice("MANIFOLD OVERRIDE: HARMONIC KEY RELEASED")


func _consume_interaction(body: Node, interaction_id: String) -> void:
	consumed[interaction_id] = true
	if body is CollisionObject3D:
		body.collision_layer = 0
		body.collision_mask = 0
	if body is Node3D:
		body.visible = false
	body.process_mode = Node.PROCESS_MODE_DISABLED


func _open_door(body: Node) -> void:
	body.set_meta("opened", true)
	if body is CollisionObject3D:
		body.collision_layer = 0
	var closed_position: Vector3 = body.get_meta("closed_position", body.position)
	var tween := create_tween().set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_IN_OUT)
	tween.tween_property(body, "position", closed_position + Vector3.UP * 4.4, 1.15)
	_play_one_shot(body.global_position, AudioFactoryClass.tone(54.0, 1.1, 0.42, 2.0, 0.26, 15), -5.0)
	emit_noise(body.global_position, 0.78)


func current_objective() -> String:
	var objective_id := str(state.current_objective()) if state.has_method("current_objective") else ""
	match objective_id:
		"review_work_order":
			return "VERIFIED WORK ORDER — Read call-out 03-117 in Truck Seven."
		"check_equipment":
			return "VERIFIED WORK ORDER — Check the field kit in Truck Seven."
		"read_physical_gauge":
			return "VERIFIED WORK ORDER — Read the physical tide staff on the pier."
		"check_telemetry":
			return "LENA'S NOTE — Compare the powered display with the brass staff."
		"restore_relay":
			return "VERIFIED WORK ORDER — Reset telemetry relay R-4 by the field office."
		"log_report":
			return "LENA'S NOTE — Log the 23 cm contradiction on paper."
		"unlock_station_entry":
			return "JUNE / VERIFIED — Card into upper control. Gate movement prohibited."
		"enter_station":
			return "JUNE / VERIFIED — Enter Hushpoint and inspect the brake fault."
		"acquire_handgun":
			return "LENA'S NOTE — Reach the response locker without drawing attention."
	if not state.power_online:
		return "Restore emergency power: locate 15A and 30A ceramic fuses."
	if not state.spool_assembled:
		var found := 0
		for fragment_id in state.SPOOL_FRAGMENTS:
			if bool(state.spool_fragments_found.get(fragment_id, false)):
				found += 1
		return "Recover Mara's red spool fragments (%d / 3), then use the archive splicer." % found
	if not state.tide_balanced:
		return "Balance the tide manifold: INTAKE → BALANCE → OUTFLOW."
	if state.bellman_state != "banished":
		return "Lure the Bellman near a steam valve and vent his exposed regulator."
	if not bool(state.doors_unlocked.get("purge_vault", false)):
		return "Take the harmonic service key and open the purge vault."
	if not state.victory:
		var active_count := 0
		for value in state.purge_breakers_active.values():
			if bool(value):
				active_count += 1
		return "Engage all three purge breakers (%d / 3)." % active_count
	if not state.exterior_returned:
		return "LENA'S NOTE — Take the released surface bulkhead and escape."
	if state.final_radio_choice.is_empty():
		return "LENA'S NOTE — Return to Truck Seven. Break the radio or answer +00:17."
	return "THE REHEARSAL HAS ENDED."


func update_hud() -> void:
	if is_instance_valid(ui):
		ui.update_hud(state, current_objective())
		if is_instance_valid(player):
			ui.set_crosshair(player.aiming, false)
			ui.set_lamp_heat(player.lamp_heat * 100.0)
			var movement_noise := clampf(Vector2(player.velocity.x, player.velocity.z).length() / 5.9, 0.0, 1.0)
			ui.set_noise_level(movement_noise * 100.0)


func damage_player(amount: int) -> void:
	if mode != MODE_PLAYING or not state.apply_damage(amount):
		return
	ui.flash_damage()
	ui.show_notice("LENA INJURED — CREATE DISTANCE")
	update_hud()
	if state.health <= 0:
		on_player_dead()


func on_player_dead() -> void:
	if mode == MODE_DEAD:
		return
	mode = MODE_DEAD
	_set_actor_activity(false)
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	ui.show_death()


func use_heal() -> bool:
	var healed: bool = state.use_healing_wrap()
	ui.show_notice("COAGULANT APPLIED" if healed else "NO USABLE COAGULANT WRAP")
	update_hud()
	return healed


func emit_noise(position: Vector3, loudness: float) -> void:
	for enemy in enemies:
		if is_instance_valid(enemy) and enemy.active:
			enemy.hear_noise(position, loudness)


func play_player_shot(origin: Vector3, hit_position: Vector3) -> void:
	emit_noise(origin, 1.0)
	_play_one_shot(origin, AudioFactoryClass.impact(randi()), -2.5)
	_spawn_impact(hit_position, Color("ffb45c"))
	if reduced_flashes:
		return
	var flash := OmniLight3D.new()
	flash.light_color = Color("ffb14b")
	flash.light_energy = 5.5
	flash.omni_range = 4.2
	flash.shadow_enabled = false
	flash.global_position = origin
	effects_root.add_child(flash)
	get_tree().create_timer(0.055).timeout.connect(flash.queue_free)


func register_decoy(position: Vector3) -> void:
	emit_noise(position, 1.0)
	var marker := MeshInstance3D.new()
	var sphere := SphereMesh.new()
	sphere.radius = 0.16
	sphere.height = 0.32
	marker.mesh = sphere
	marker.material_override = WorldBuilder.material(Color("8d2a24"), 0.34, 0.55, Color(1.0, 0.08, 0.03, 1.0))
	marker.global_position = position
	effects_root.add_child(marker)
	for delay_index in range(1, 5):
		get_tree().create_timer(delay_index * 0.7).timeout.connect(
			func() -> void:
				if is_instance_valid(marker):
					emit_noise(marker.global_position, 0.92)
					_play_one_shot(marker.global_position, AudioFactoryClass.tone(910.0, 0.08, 0.24, 8.0), -8.0)
		)
	get_tree().create_timer(3.7).timeout.connect(marker.queue_free)


func on_enemy_defeated(_enemy: Node) -> void:
	ui.show_notice("RESONANCE NODE SILENCED")


func on_bellman_staggered() -> void:
	if state.bellman_state == "hunting":
		state.transition_bellman("staggered")
		ui.show_notice("BELLMAN STAGGERED — STEAM CAN EXPOSE THE REGULATOR")


func on_bellman_banished(_enemy: Node = null) -> void:
	if state.bellman_state == "searching":
		state.transition_bellman("hunting")
	if state.bellman_state == "hunting":
		state.transition_bellman("staggered")
	if state.transition_bellman("banished"):
		bellman.set_active(false)
		ui.show_notice("CONTROL CRYSTALS BROKEN — GIDEON RUSK: NOW MAKE IT QUIET")
		_write_save()
		update_hud()


func notify_player(message: String) -> void:
	ui.show_notice(message)


func show_damage(_amount: int = 0) -> void:
	ui.flash_damage()


func play_dry_fire() -> void:
	_play_one_shot(player.global_position, AudioFactoryClass.tone(170.0, 0.055, 0.14, 20.0), -11.0)


func play_footstep(position: Vector3, sprinting: bool, crouching: bool) -> void:
	var volume := -20.0 if crouching else (-10.5 if sprinting else -15.0)
	var frequency := 92.0 if sprinting else 74.0
	_play_one_shot(position, AudioFactoryClass.tone(frequency, 0.06, 0.10, 24.0, 0.35, randi()), volume)


func play_enemy_cue(enemy: Node3D, cue: String) -> void:
	if cue == "chorus":
		_play_one_shot(enemy.global_position, AudioFactoryClass.tone(412.0, 0.52, 0.28, 3.0, 0.36, 17), -5.0)
	elif cue == "wader_emerge":
		_play_one_shot(enemy.global_position, AudioFactoryClass.tone(58.0, 0.7, 0.48, 4.0, 0.68, 29), -4.0)
	elif enemy == bellman:
		bell_audio.global_position = enemy.global_position
		bell_audio.play()
	else:
		_play_one_shot(enemy.global_position, AudioFactoryClass.tone(103.0, 0.22, 0.32, 8.0, 0.52, 41), -7.0)


func is_in_safe_room(position: Vector3) -> bool:
	return position.x > 0.9 and position.x < 8.1 and position.z > 0.8 and position.z < 7.3


func _spawn_impact(position: Vector3, color: Color) -> void:
	if reduced_flashes:
		return
	var particles := GPUParticles3D.new()
	particles.one_shot = true
	particles.amount = 12
	particles.lifetime = 0.32
	particles.explosiveness = 0.92
	particles.global_position = position
	var process := ParticleProcessMaterial.new()
	process.direction = Vector3.UP
	process.spread = 115.0
	process.initial_velocity_min = 1.2
	process.initial_velocity_max = 3.8
	process.gravity = Vector3(0, -7.0, 0)
	particles.process_material = process
	var mesh := BoxMesh.new()
	mesh.size = Vector3(0.025, 0.025, 0.08)
	mesh.material = WorldBuilder.material(color, 0.4, 0.5, color)
	particles.draw_pass_1 = mesh
	effects_root.add_child(particles)
	particles.emitting = true
	get_tree().create_timer(0.75).timeout.connect(particles.queue_free)


func _play_one_shot(position: Vector3, stream: AudioStream, volume_db: float) -> void:
	var audio := AudioStreamPlayer3D.new()
	audio.stream = stream
	audio.volume_db = volume_db
	audio.max_distance = 48.0
	effects_root.add_child(audio)
	audio.global_position = position
	audio.finished.connect(audio.queue_free)
	audio.play()


func _write_save() -> bool:
	var save_data := {
		"state": state.to_save_dict(),
		"consumed": consumed.keys(),
		"checkpoint": [checkpoint_position.x, checkpoint_position.y, checkpoint_position.z],
	}
	var temp_file := FileAccess.open(SAVE_TEMP_PATH, FileAccess.WRITE)
	if temp_file == null:
		return false
	temp_file.store_string(JSON.stringify(save_data, "  "))
	temp_file.close()
	if FileAccess.file_exists(SAVE_PATH):
		if FileAccess.file_exists(SAVE_BACKUP_PATH):
			DirAccess.remove_absolute(SAVE_BACKUP_PATH)
		DirAccess.copy_absolute(SAVE_PATH, SAVE_BACKUP_PATH)
		DirAccess.remove_absolute(SAVE_PATH)
	var error := DirAccess.rename_absolute(SAVE_TEMP_PATH, SAVE_PATH)
	return error == OK


func _load_game() -> bool:
	var file := FileAccess.open(SAVE_PATH, FileAccess.READ)
	if file == null:
		return false
	var decoded: Variant = JSON.parse_string(file.get_as_text())
	file.close()
	if typeof(decoded) != TYPE_DICTIONARY or typeof(decoded.get("state")) != TYPE_DICTIONARY:
		return false
	var candidate = GameStateClass.new()
	if not candidate.load_save_dict(decoded["state"]):
		return false
	var position_data: Variant = decoded.get("checkpoint", [])
	if typeof(position_data) != TYPE_ARRAY or position_data.size() != 3:
		return false
	state = candidate
	consumed.clear()
	var consumed_data: Variant = decoded.get("consumed", [])
	if typeof(consumed_data) == TYPE_ARRAY:
		for interaction_id in consumed_data:
			if typeof(interaction_id) == TYPE_STRING:
				consumed[interaction_id] = true
	checkpoint_position = Vector3(float(position_data[0]), float(position_data[1]), float(position_data[2]))
	player.configure(state, self)
	player.global_position = checkpoint_position
	_reset_enemies()
	_apply_saved_world()
	_sync_phase_visuals()
	_set_surface_mood(state.exterior_returned)
	return true


func _reset_enemies() -> void:
	for enemy in enemies:
		if not is_instance_valid(enemy):
			continue
		var spawn_kind := str(enemy.get_meta("spawn_kind", "listener"))
		enemy.configure(spawn_kind, player, self)
		enemy.global_position = enemy.get_meta("spawn_position", Vector3.ZERO)
		enemy.set_active(false)
		enemy.set_physics_process(false)


func _apply_saved_world() -> void:
	_reset_world_visuals()
	for child in world_root.find_children("*", "StaticBody3D", true, false):
		if not child.has_meta("interaction_id"):
			continue
		var interaction_id := str(child.get_meta("interaction_id"))
		if consumed.has(interaction_id):
			if interaction_id.ends_with("_door"):
				_open_door_immediate(child)
			else:
				_consume_interaction(child, interaction_id)
	if state.power_online:
		var records := _find_interaction("records_door")
		if is_instance_valid(records) and consumed.has("records_door"):
			_open_door_immediate(records)
	if bool(state.doors_unlocked.get("purge_vault", false)):
		var vault := _find_interaction("vault_door")
		if is_instance_valid(vault):
			_open_door_immediate(vault)
	_reveal_harmonic_key_if_ready()
	if state.bellman_state != "dormant" and state.bellman_state != "banished":
		bellman.global_position = world_data["bellman_spawn"]
	_sync_phase_visuals()


func _reset_world_visuals() -> void:
	for child in world_root.find_children("*", "StaticBody3D", true, false):
		if not child.has_meta("interaction_id"):
			continue
		child.process_mode = Node.PROCESS_MODE_INHERIT
		child.collision_layer = 1
		child.visible = true
		child.set_meta("opened", false)
		if child.has_meta("closed_position"):
			child.position = child.get_meta("closed_position")
	var key: StaticBody3D = world_data["harmonic_key"]
	key.visible = false
	key.collision_layer = 0
	key.process_mode = Node.PROCESS_MODE_DISABLED
	_sync_phase_visuals()


func _sync_phase_visuals() -> void:
	if not is_instance_valid(interior_root) or not is_instance_valid(exterior_root):
		return
	var on_surface: bool = not bool(state.station_entered) or bool(state.exterior_returned)
	exterior_root.visible = on_surface
	interior_root.visible = not on_surface
	var rain: Variant = outdoor_data.get("rain_particles")
	var mist: Variant = outdoor_data.get("wind_particles")
	if is_instance_valid(rain):
		rain.emitting = on_surface
	if is_instance_valid(mist):
		mist.emitting = on_surface
	var surface_exit: Variant = world_data.get("surface_exit")
	var exit_ready: bool = bool(state.exterior_escape_unlocked) and not bool(state.exterior_returned)
	if is_instance_valid(surface_exit):
		surface_exit.visible = exit_ready
		surface_exit.collision_layer = 1 if exit_ready else 0
		surface_exit.process_mode = Node.PROCESS_MODE_INHERIT if exit_ready else Node.PROCESS_MODE_DISABLED
	var choice_ready: bool = bool(state.exterior_returned) and state.final_radio_choice.is_empty()
	for radio_choice in outdoor_data.get("final_radio_choices", []):
		if not is_instance_valid(radio_choice):
			continue
		radio_choice.visible = choice_ready
		radio_choice.collision_layer = 1 if choice_ready else 0
		radio_choice.process_mode = Node.PROCESS_MODE_INHERIT if choice_ready else Node.PROCESS_MODE_DISABLED


func _set_surface_mood(storm: bool) -> void:
	if not is_instance_valid(environment_settings):
		return
	if state.station_entered and not state.exterior_returned:
		environment_settings.background_color = Color("020609")
		environment_settings.ambient_light_color = Color("19313a")
		environment_settings.ambient_light_energy = 0.58
		environment_settings.fog_density = 0.0065
		if is_instance_valid(ambient):
			ambient.volume_db = -18.0
		return
	environment_settings.background_color = Color("13252c") if not storm else Color("050b10")
	environment_settings.ambient_light_color = Color("557079") if not storm else Color("263c46")
	environment_settings.ambient_light_energy = 0.92 if not storm else 0.62
	environment_settings.fog_density = 0.0028 if not storm else 0.008
	if is_instance_valid(ambient):
		ambient.volume_db = -31.0 if not storm else -24.0


func _surface_global(local_position: Vector3) -> Vector3:
	if is_instance_valid(exterior_root):
		return exterior_root.to_global(local_position)
	return EXTERIOR_OFFSET + local_position


func _on_settings_changed(reduced_shake: bool, reduce_flashes: bool) -> void:
	if is_instance_valid(player):
		player.set_reduced_camera_motion(reduced_shake)
		player.set_reduced_flashes(reduce_flashes)
	reduced_flashes = reduce_flashes
	if reduced_flashes:
		lightning_flash_time = 0.0


func _open_door_immediate(body: Node) -> void:
	body.set_meta("opened", true)
	if body is CollisionObject3D:
		body.collision_layer = 0
	body.position = body.get_meta("closed_position", body.position) + Vector3.UP * 4.4


func _find_interaction(interaction_id: String) -> Node:
	for child in world_root.find_children("*", "StaticBody3D", true, false):
		if str(child.get_meta("interaction_id", "")) == interaction_id:
			return child
	return null


func _discovered_lore() -> Array:
	var entries: Array = []
	for world_id in LORE:
		var entry: Dictionary = LORE[world_id]
		if state.has_lore(entry["id"]):
			entries.append({"title": entry["title"], "body": entry["body"]})
	return entries


func _register_inputs() -> void:
	_add_key_action("hp_forward", KEY_W)
	_add_key_action("hp_back", KEY_S)
	_add_key_action("hp_left", KEY_A)
	_add_key_action("hp_right", KEY_D)
	_add_key_action("hp_sprint", KEY_SHIFT)
	_add_key_action("hp_crouch", KEY_CTRL)
	_add_key_action("hp_interact", KEY_E)
	_add_key_action("hp_reload", KEY_R)
	_add_key_action("hp_quick_turn", KEY_Q)
	_add_key_action("hp_decoy", KEY_G)
	_add_key_action("hp_heal", KEY_H)
	_add_key_action("hp_lamp", KEY_F)
	_add_mouse_action("hp_aim", MOUSE_BUTTON_RIGHT)
	_add_mouse_action("hp_fire", MOUSE_BUTTON_LEFT)


func _add_key_action(action: StringName, keycode: Key) -> void:
	if not InputMap.has_action(action):
		InputMap.add_action(action)
	var key := InputEventKey.new()
	key.physical_keycode = keycode
	if not InputMap.action_has_event(action, key):
		InputMap.action_add_event(action, key)


func _add_mouse_action(action: StringName, button: MouseButton) -> void:
	if not InputMap.has_action(action):
		InputMap.add_action(action)
	var mouse := InputEventMouseButton.new()
	mouse.button_index = button
	if not InputMap.action_has_event(action, mouse):
		InputMap.action_add_event(action, mouse)
