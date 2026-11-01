extends SceneTree

const MAIN_SCENE := preload("res://main.tscn")
const GAME_STATE := preload("res://scripts/game_state.gd")
const SAVE_PATHS := [
	"user://hushpoint_save.json",
	"user://hushpoint_save.tmp",
	"user://hushpoint_save.bak",
]
const SURFACE_SEQUENCE := [
	{
		"id": "surface_work_order",
		"step": "read_work_order",
		"field": "work_order_reviewed",
		"objective": "review_work_order",
	},
	{
		"id": "surface_equipment",
		"step": "check_equipment",
		"field": "equipment_checked",
		"objective": "check_equipment",
	},
	{
		"id": "surface_tide_staff",
		"step": "read_physical_gauge",
		"field": "physical_gauge_read",
		"objective": "read_physical_gauge",
	},
	{
		"id": "surface_telemetry",
		"step": "check_telemetry",
		"field": "telemetry_checked",
		"objective": "check_telemetry",
	},
	{
		"id": "surface_relay",
		"step": "restore_relay",
		"field": "relay_restored",
		"objective": "restore_relay",
	},
	{
		"id": "surface_report",
		"step": "log_report",
		"field": "report_logged",
		"objective": "log_report",
	},
	{
		"id": "surface_entry_reader",
		"step": "unlock_station_entry",
		"field": "station_entry_unlocked",
		"objective": "unlock_station_entry",
	},
	{
		"id": "surface_station_entry",
		"step": "enter_station",
		"field": "station_entered",
		"objective": "enter_station",
	},
]

var assertions: int = 0
var failures: int = 0
var game: Node
var preserved_saves: Dictionary = {}


func _initialize() -> void:
	call_deferred("_run")


func _run() -> void:
	_preserve_and_clear_saves()

	var packed: PackedScene = MAIN_SCENE
	game = packed.instantiate()
	root.add_child(game)
	await process_frame
	await process_frame

	_test_boot_graph()
	_test_accessibility_settings()
	_test_new_game_intro_and_surface_spawn()
	_test_ordered_surface_sequence()
	_test_staged_handgun_pickup()
	_test_fuses_and_power()
	_test_spool_assembly()
	_test_tide_bellman_and_key_reveal()
	_test_steam_and_banishment()
	_test_vault_and_purge_escape_unlock()
	_test_surface_return_and_break_ending()
	_test_answer_ending_on_fresh_state()
	_test_save_roundtrip_through_orchestrator()

	if is_instance_valid(game):
		game.queue_free()
		await process_frame
	_restore_preserved_saves()

	if failures == 0:
		print("HUSHPOINT INTEGRATION: PASS (%d assertions)" % assertions)
		quit(0)
	else:
		printerr("HUSHPOINT INTEGRATION: FAIL (%d failures, %d assertions)" % [failures, assertions])
		quit(1)


func _test_boot_graph() -> void:
	var before := failures
	_check(is_instance_valid(game), "main.tscn must instantiate")
	if not is_instance_valid(game):
		_phase_result("boot graph", before)
		return

	var ui: Variant = game.get("ui")
	var world: Variant = game.get("world_root")
	var interior: Variant = game.get("interior_root")
	var exterior: Variant = game.get("exterior_root")
	var player: Variant = game.get("player")
	var enemies: Variant = game.get("enemies")
	var bellman: Variant = game.get("bellman")
	var outdoor_data: Variant = game.get("outdoor_data")
	_check(str(game.get("mode")) == "title", "boot must land on the title screen")
	_check(is_instance_valid(ui), "UI must instantiate")
	_check(is_instance_valid(world), "3D world root must instantiate")
	_check(is_instance_valid(interior), "lower-station root must instantiate")
	_check(is_instance_valid(exterior), "surface-compound root must instantiate")
	_check(interior != exterior, "interior and exterior must be distinct scene roots")
	if is_instance_valid(world) and is_instance_valid(interior) and is_instance_valid(exterior):
		_check(interior.get_parent() == world, "lower station must be parented under the world root")
		_check(exterior.get_parent() == world, "surface compound must be parented under the world root")
		_check(
			(interior as Node3D).global_position.distance_to((exterior as Node3D).global_position) >= 100.0,
			"interior and exterior must be spatially separated",
		)
	_check(is_instance_valid(player), "Lena actor must instantiate")
	_check(typeof(enemies) == TYPE_ARRAY and enemies.size() == 5, "four threats plus the Bellman must instantiate")
	_check(is_instance_valid(bellman) and str(bellman.get("kind")) == "bellman", "Bellman actor must be configured")
	_check(typeof(outdoor_data) == TYPE_DICTIONARY, "surface builder must return its generated scene data")
	if typeof(outdoor_data) == TYPE_DICTIONARY:
		var records: Variant = outdoor_data.get("tutorial_interactions", [])
		var final_choices: Variant = outdoor_data.get("final_radio_choices", [])
		_check(typeof(records) == TYPE_ARRAY and records.size() == 8, "surface builder must generate exactly eight tutorial interactions")
		_check(typeof(final_choices) == TYPE_ARRAY and final_choices.size() == 2, "surface builder must generate both final radio choices")
		if typeof(records) == TYPE_ARRAY and records.size() == SURFACE_SEQUENCE.size():
			for index in range(SURFACE_SEQUENCE.size()):
				var record: Variant = records[index]
				_check(typeof(record) == TYPE_DICTIONARY, "surface tutorial record %d must be structured" % (index + 1))
				if typeof(record) != TYPE_DICTIONARY:
					continue
				_check(str(record.get("id", "")) == SURFACE_SEQUENCE[index]["id"], "surface tutorial record %d must keep authored ID order" % (index + 1))
				_check(str(record.get("step", "")) == SURFACE_SEQUENCE[index]["step"], "surface tutorial record %d must keep procedural step order" % (index + 1))
				_check(_is_below(exterior, record.get("node")), "surface tutorial record %d must point into the exterior root" % (index + 1))
	_check(_interaction_nodes_in(exterior, "tutorial").size() == 8, "exterior scene graph must contain the eight generated tutorial bodies")
	_check(_interaction_nodes_in(exterior, "final_radio").size() == 2, "exterior scene graph must contain the two radio-ending bodies")
	_check(_interaction_nodes_in(interior, "tutorial").is_empty(), "interior root must not duplicate exterior tutorial bodies")
	_check(_interaction_nodes_in(interior, "final_radio").is_empty(), "interior root must not duplicate final radio bodies")
	_check(_interaction_nodes().size() >= 35, "combined surface and station must contain the full physical interaction slice")
	if is_instance_valid(ui):
		var title_screen: Variant = ui.get("title_screen")
		_check(is_instance_valid(title_screen) and title_screen.visible, "title UI must be visible at boot")
	_phase_result("boot graph", before)


func _test_accessibility_settings() -> void:
	var before := failures
	var ui: Variant = game.get("ui")
	var player: Variant = game.get("player")
	_check(is_instance_valid(ui) and is_instance_valid(player), "accessibility settings require the live UI and player")
	if not is_instance_valid(ui) or not is_instance_valid(player):
		_phase_result("accessibility settings", before)
		return
	ui.set("reduced_shake", true)
	ui.set("reduced_flashes", true)
	ui.emit_signal("settings_changed", true, true)
	_check(bool(player.reduced_camera_motion), "reduce-camera-shake must reach the player controller")
	_check(bool(player.reduced_flashes), "reduce-hard-flashes must reach the player lamp controller")
	_check(bool(game.get("reduced_flashes")), "reduce-hard-flashes must reach the game effects controller")
	var flicker_light: OmniLight3D = null
	for candidate in game.get("world_data").get("lights", []):
		if is_instance_valid(candidate) and bool(candidate.get_meta("flicker", false)):
			flicker_light = candidate
			break
	_check(is_instance_valid(flicker_light), "accessibility test requires an authored flicker light")
	if is_instance_valid(flicker_light):
		game.call("_process", 0.1)
		var steady_energy := float(flicker_light.get_meta("base_energy", 1.0)) * 0.92
		_check(is_equal_approx(flicker_light.light_energy, steady_energy), "reduced flashes must hold authored flicker lights steady")
	player.lamp.light_energy = 0.4
	player.call("set_reduced_flashes", true)
	_check(is_equal_approx(player.lamp.light_energy, 3.2), "reduced flashes must hold the inspection lamp at steady energy")
	ui.call("flash_damage")
	var damage_overlay: Variant = ui.get("damage_overlay")
	_check(is_instance_valid(damage_overlay) and is_zero_approx(float(damage_overlay.color.a)), "reduced flashes must suppress the damage overlay")
	var effects_root: Variant = game.get("effects_root")
	var effect_count: int = effects_root.get_child_count() if is_instance_valid(effects_root) else -1
	game.call("_spawn_impact", Vector3.ZERO, Color.ORANGE)
	_check(is_instance_valid(effects_root) and effects_root.get_child_count() == effect_count, "reduced flashes must suppress bright impact particles")
	player.set("_recoil", deg_to_rad(-5.0))
	player.call("_update_camera", 0.016)
	_check(is_zero_approx(float(player.get("_recoil"))), "reduced camera motion must suppress active recoil")
	ui.set("reduced_shake", false)
	ui.set("reduced_flashes", false)
	ui.emit_signal("settings_changed", false, false)
	_check(not bool(player.reduced_camera_motion), "camera motion must restore when the setting is disabled")
	_check(not bool(player.reduced_flashes), "lamp pulse permission must restore when the setting is disabled")
	_check(not bool(game.get("reduced_flashes")), "hard flashes must restore when the setting is disabled")
	_phase_result("accessibility settings", before)


func _test_new_game_intro_and_surface_spawn() -> void:
	var before := failures
	var ui: Variant = game.get("ui")
	_check(is_instance_valid(ui), "new-game flow requires the live UI")
	if not is_instance_valid(ui):
		_phase_result("new game, intro, and surface spawn", before)
		return

	ui.emit_signal("new_game_requested")
	var state: Variant = game.get("state")
	var player: Variant = game.get("player")
	var exterior: Variant = game.get("exterior_root")
	var interior: Variant = game.get("interior_root")
	var outdoor_data: Dictionary = game.get("outdoor_data")
	_check(str(game.get("mode")) == "intro", "new-game signal must enter the story intro")
	_check(not bool(state.handgun_acquired), "normal exterior opening must begin without a handgun")
	_check(not bool(state.fire_handgun()), "normal exterior opening must not allow handgun fire")
	_check(int(state.magazine) == state.MAGAZINE_CAPACITY, "blocked exterior shot must not consume the staged magazine")
	_check(not bool(player.get("control_enabled")), "intro must hold player control")
	_check(is_instance_valid(exterior) and exterior.visible, "new game must stage the visible exterior compound")
	_check(is_instance_valid(interior) and not interior.visible, "new game must keep the lower station hidden")
	var expected_spawn: Vector3 = exterior.to_global(outdoor_data["spawn_player"])
	_check(player.global_position.is_equal_approx(expected_spawn), "Lena must spawn at the generated exterior arrival point")
	_check(_active_enemy_count() == 0, "no enemy may be active during the ordinary arrival")
	var intro_screen: Variant = ui.get("intro_screen")
	_check(is_instance_valid(intro_screen) and intro_screen.visible, "story intro UI must be visible")

	ui.emit_signal("intro_finished")
	_check(str(game.get("mode")) == "playing", "intro completion must enter gameplay")
	_check(bool(player.get("control_enabled")), "gameplay must enable player control")
	_check(player.global_position.is_equal_approx(expected_spawn), "intro completion must retain the exterior spawn")
	_check(_active_enemy_count() == 0, "surface gameplay must keep every station threat inactive")
	var hud_screen: Variant = ui.get("hud_screen")
	_check(is_instance_valid(hud_screen) and hud_screen.visible, "gameplay HUD must be visible")
	_check(FileAccess.file_exists(SAVE_PATHS[0]), "entering a new game must create its initial save")
	_phase_result("new game, intro, and surface spawn", before)


func _test_ordered_surface_sequence() -> void:
	var before := failures
	var state: Variant = game.get("state")
	var records: Variant = game.get("outdoor_data").get("tutorial_interactions", [])
	_check(typeof(records) == TYPE_ARRAY and records.size() == SURFACE_SEQUENCE.size(), "strict surface flow requires all eight generated records")
	if typeof(records) != TYPE_ARRAY or records.size() != SURFACE_SEQUENCE.size():
		_phase_result("ordered surface sequence", before)
		return

	for index in range(SURFACE_SEQUENCE.size()):
		var expected: Dictionary = SURFACE_SEQUENCE[index]
		var record: Dictionary = records[index]
		var body: Node = record.get("node")
		_check(str(state.current_objective()) == expected["objective"], "surface step %d must be the current objective before interaction" % (index + 1))
		_check(is_instance_valid(body), "surface step %d physical interaction must exist" % (index + 1))

		# Every step after the first is attempted once before its prerequisite. This
		# verifies rejection through game.gd, not just through isolated state methods.
		if index < SURFACE_SEQUENCE.size() - 1:
			var early_record: Dictionary = records[index + 1]
			var early_body: Node = early_record.get("node")
			var before_state: Dictionary = state.to_save_dict()
			_interact(early_body)
			_check(state.to_save_dict() == before_state, "surface step %d must reject an out-of-order physical interaction atomically" % (index + 2))
			_check(not bool(game.get("consumed").has(str(early_record.get("id", "")))), "rejected surface step %d must remain available" % (index + 2))

		_interact(body)
		_check(bool(state.get(expected["field"])), "surface step %d must set %s" % [index + 1, expected["field"]])
		_check(bool(game.get("consumed").has(expected["id"])), "accepted surface step %d must be consumed exactly once" % (index + 1))
		_close_overlay_if_open()

	var interior: Variant = game.get("interior_root")
	var exterior: Variant = game.get("exterior_root")
	var player: Variant = game.get("player")
	var world_data: Dictionary = game.get("world_data")
	_check(bool(state.station_entered), "eighth surface interaction must enter Hushpoint")
	_check(str(state.current_objective()) == "acquire_handgun", "station entry must stage the handgun as the next objective")
	_check(is_instance_valid(exterior) and not exterior.visible, "station entry must hide the separated exterior root")
	_check(is_instance_valid(interior) and interior.visible, "station entry must reveal the separated interior root")
	_check(player.global_position.is_equal_approx(world_data["spawn_player"]), "station entry must move Lena to the authored lower-station spawn")
	_phase_result("ordered surface sequence", before)


func _test_staged_handgun_pickup() -> void:
	var before := failures
	var state: Variant = game.get("state")
	var interior: Variant = game.get("interior_root")
	var handgun := _interaction("response_handgun")
	_check(not bool(state.handgun_acquired), "station must still begin without the response handgun")
	_check(not bool(state.fire_handgun()), "handgun must remain unusable before its physical pickup")
	_check(is_instance_valid(handgun), "physical response-handgun pickup must exist")
	_check(_is_below(interior, handgun), "response handgun must be staged inside the lower station")
	_interact(handgun)
	_check(bool(state.handgun_acquired), "physical response-handgun pickup must arm Lena")
	_check(bool(game.get("consumed").has("response_handgun")), "handgun pickup must be consumed after collection")
	_check(str(state.current_objective()) == "restore_emergency_power", "emergency power must follow weapon acquisition")
	_phase_result("staged handgun pickup", before)


func _test_fuses_and_power() -> void:
	var before := failures
	var state: Variant = game.get("state")
	var fuse_15 := _interaction("fuse_15a")
	var fuse_30 := _interaction("fuse_30a")
	var panel := _interaction("emergency_power")
	_check(is_instance_valid(fuse_15) and is_instance_valid(fuse_30), "both physical fuse pickups must exist")
	_check(is_instance_valid(panel), "physical emergency-power panel must exist")
	_interact(fuse_15)
	_interact(fuse_30)
	_check(state.item_count("fuse_15a") == 1 and state.item_count("fuse_30a") == 1, "both fuse pickups must enter the case")
	_interact(panel)
	_check(bool(state.power_online), "installing both rated fuses must restore emergency power")
	_check(bool(state.installed_fuses.get("fuse_15a", false)), "15A fuse must be installed")
	_check(bool(state.installed_fuses.get("fuse_30a", false)), "30A fuse must be installed")
	_check(state.item_count("fuse_15a") == 0 and state.item_count("fuse_30a") == 0, "installed fuses must leave inventory")
	_phase_result("fuses and power", before)


func _test_spool_assembly() -> void:
	var before := failures
	var state: Variant = game.get("state")
	for fragment_id in ["spool_a", "spool_b", "spool_c"]:
		var fragment := _interaction(fragment_id)
		_check(is_instance_valid(fragment), "%s pickup must exist" % fragment_id)
		_interact(fragment)
	_check(state.item_count("spool_a") == 1, "spool fragment 01 must be collected")
	_check(state.item_count("spool_b") == 1, "spool fragment 02 must be collected")
	_check(state.item_count("spool_c") == 1, "spool fragment 03 must be collected")

	var bench := _interaction("archive_splicer")
	_check(is_instance_valid(bench), "archive splicer interaction must exist")
	_interact(bench)
	_check(bool(state.spool_assembled), "three real pickups used at the splicer must assemble Mara's spool")
	_check(str(game.get("mode")) == "overlay", "reconstruction must present Mara's lore overlay")
	var ui: Variant = game.get("ui")
	var lore_screen: Variant = ui.get("lore_screen")
	_check(is_instance_valid(lore_screen) and lore_screen.visible, "reconstructed message must be visible")
	ui.emit_signal("overlay_closed")
	_check(str(game.get("mode")) == "playing", "closing Mara's message must resume gameplay")
	_phase_result("spool assembly", before)


func _test_tide_bellman_and_key_reveal() -> void:
	var before := failures
	var state: Variant = game.get("state")
	var valve_1 := _interaction("tide_valve_1")
	var valve_2 := _interaction("tide_valve_2")
	var valve_3 := _interaction("tide_valve_3")
	_check(is_instance_valid(valve_1) and is_instance_valid(valve_2) and is_instance_valid(valve_3), "all three physical tide valves must exist")

	_interact(valve_1)
	_check(state.tide_valve_progress == ["intake"], "intake must begin the physical sequence")
	_interact(valve_3)
	_check(state.tide_valve_progress.is_empty(), "wrong valve order must reset progress")
	_check(int(state.tide_reset_count) == 1, "wrong physical order must increment the reset counter")

	_interact(valve_1)
	_interact(valve_2)
	_interact(valve_3)
	_check(bool(state.tide_balanced), "intake, balance, outflow must solve the tide manifold")
	_check(str(state.bellman_state) == "hunting", "solved counterflow must awaken the Bellman into hunting")
	var bellman: Variant = game.get("bellman")
	_check(is_instance_valid(bellman) and bool(bellman.get("active")), "awakened Bellman actor must be active")
	var key := _interaction("harmonic_key")
	_check(is_instance_valid(key) and key.visible, "solved spool and tide puzzles must reveal the harmonic key")
	_check(is_instance_valid(key) and key.collision_layer == 1, "revealed harmonic key must become interactable")
	_phase_result("tide, Bellman, and key reveal", before)


func _test_steam_and_banishment() -> void:
	var before := failures
	var state: Variant = game.get("state")
	var bellman: Variant = game.get("bellman")
	var steam_valves := _interactions_of_kind("steam_valve")
	_check(not steam_valves.is_empty(), "at least one physical steam valve must exist")
	if steam_valves.is_empty() or not is_instance_valid(bellman):
		_phase_result("steam and banishment", before)
		return

	var steam: Node3D = steam_valves[0]
	bellman.global_position = steam.global_position
	_interact(steam)
	_check(float(bellman.get("_regulator_exposed_time")) > 0.0, "venting steam beside the Bellman must expose his regulator")
	_check(str(bellman.get("ai_state")) == "stagger", "steam exposure must stagger the Bellman actor")

	# The headless runner has no aiming device. Simulate the successful three-node-shot
	# callback while retaining the real exposed actor and orchestrator transition.
	game.call("on_bellman_banished", bellman)
	_check(str(state.bellman_state) == "banished", "simulated regulator destruction must banish the Bellman")
	_check(not bool(bellman.get("active")), "banished Bellman actor must deactivate")
	_phase_result("steam and banishment", before)


func _test_vault_and_purge_escape_unlock() -> void:
	var before := failures
	var state: Variant = game.get("state")
	var key := _interaction("harmonic_key")
	_interact(key)
	_check(state.item_count("harmonic_key") == 1, "revealed harmonic key must be collectible")

	var vault := _interaction("vault_door")
	_check(is_instance_valid(vault), "physical purge-vault door must exist")
	_interact(vault)
	_check(bool(state.doors_unlocked.get("purge_vault", false)), "harmonic key must unlock the purge vault")
	_check(bool(vault.get_meta("opened", false)), "vault interaction must open its world collision")

	var victory_screen: Variant = game.get("ui").get("victory_screen")
	for index in range(1, 4):
		var breaker := _interaction("purge_%d" % index)
		_check(is_instance_valid(breaker), "purge breaker %d must exist" % index)
		_interact(breaker)
		_check(bool(state.purge_breakers_active.get(["north", "east", "west"][index - 1], false)), "purge breaker %d must engage" % index)
		if index < 3:
			_check(not bool(state.victory), "purge breaker %d must not complete counterflow early" % index)

	var surface_exit: Variant = game.get("world_data").get("surface_exit")
	_check(bool(state.victory), "three physical purge breakers must mark counterflow complete in deterministic state")
	_check(bool(state.exterior_escape_unlocked), "third purge breaker must unlock the interior surface exit")
	_check(str(game.get("mode")) == "playing", "third purge breaker must not show an ending before the surface radio choice")
	_check(is_instance_valid(victory_screen) and not victory_screen.visible, "third purge breaker must keep the victory screen hidden")
	_check(is_instance_valid(surface_exit) and surface_exit.visible, "unlocked interior surface exit must become visible")
	_check(is_instance_valid(surface_exit) and surface_exit.collision_layer == 1, "unlocked interior surface exit must become interactable")
	_check(is_instance_valid(surface_exit) and surface_exit.process_mode != Node.PROCESS_MODE_DISABLED, "unlocked interior surface exit must be processing")

	var expected_after_purge: Dictionary = state.to_save_dict()
	_check(bool(game.call("_load_game")), "save written by the third breaker must reload immediately")
	state = game.get("state")
	surface_exit = game.get("world_data").get("surface_exit")
	_check(state.to_save_dict() == expected_after_purge, "third-breaker reload must preserve the complete counterflow state")
	_check(bool(state.exterior_escape_unlocked), "third-breaker reload must preserve the unlocked surface route")
	_check(is_instance_valid(surface_exit) and surface_exit.visible, "third-breaker reload must keep the surface exit visible")
	_check(is_instance_valid(surface_exit) and surface_exit.collision_layer == 1, "third-breaker reload must keep the surface exit interactable")
	_check(is_instance_valid(surface_exit) and surface_exit.process_mode != Node.PROCESS_MODE_DISABLED, "third-breaker reload must keep the surface exit processing")
	_phase_result("vault purge and escape unlock", before)


func _test_surface_return_and_break_ending() -> void:
	var before := failures
	var state: Variant = game.get("state")
	var surface_exit := _interaction("interior_surface_exit")
	_check(is_instance_valid(surface_exit), "physical interior surface exit must exist")
	_interact(surface_exit)
	_check(bool(state.exterior_returned), "surface-exit interaction must return Lena outside")
	_check(str(game.get("mode")) == "playing", "returning outside must defer the ending until a radio choice")
	_check(game.get("exterior_root").visible, "surface return must reveal the exterior root")
	_check(not game.get("interior_root").visible, "surface return must hide the interior root")
	_check(_active_enemy_count() == 0, "surface return must deactivate every station threat")

	var outdoor_data: Dictionary = game.get("outdoor_data")
	var expected_return: Vector3 = game.get("exterior_root").to_global(outdoor_data["station_entry_position"] + Vector3(0, 0, 2.2))
	_check(game.get("player").global_position.is_equal_approx(expected_return), "surface exit must place Lena at the exterior station door")
	for choice in outdoor_data.get("final_radio_choices", []):
		_check(is_instance_valid(choice) and choice.visible, "both final radio choices must appear after the physical return")
		_check(is_instance_valid(choice) and choice.collision_layer == 1, "both final radio choices must be interactable")

	var break_radio := _interaction("final_radio_break")
	_check(is_instance_valid(break_radio), "break-the-radio physical choice must exist")
	_interact(break_radio)
	_check(str(state.final_radio_choice) == "break", "full physical run must record the break ending")
	_check(str(state.current_objective()) == "complete", "break ending must complete the objective chain")
	_check(str(game.get("mode")) == "victory", "break choice must enter the ending screen")
	var victory_screen: Variant = game.get("ui").get("victory_screen")
	_check(is_instance_valid(victory_screen) and victory_screen.visible, "break choice must show the ending screen")
	for choice in outdoor_data.get("final_radio_choices", []):
		_check(is_instance_valid(choice) and not choice.visible, "terminal radio choice must hide both alternatives")
		_check(is_instance_valid(choice) and choice.collision_layer == 0, "terminal radio choice must disable both alternatives")
	_phase_result("surface return and break ending", before)


func _test_answer_ending_on_fresh_state() -> void:
	var before := failures
	var answer_state = GAME_STATE.new()
	_check(_prepare_fresh_state_for_radio(answer_state), "fresh deterministic state must reach the final radio without mutating the physical run")
	_check(answer_state.final_radio_choice.is_empty(), "fresh radio fixture must begin without a terminal choice")
	_check(answer_state.choose_final_radio("answer"), "fresh deterministic state must accept the answer ending")
	_check(str(answer_state.final_radio_choice) == "answer", "answer ending must be recorded independently")
	_check(str(answer_state.current_objective()) == "complete", "answer ending must complete its independent objective chain")
	_check(str(game.get("state").final_radio_choice) == "break", "answer fixture must not corrupt the full run's break ending")
	_phase_result("independent answer ending", before)


func _test_save_roundtrip_through_orchestrator() -> void:
	var before := failures
	_check(FileAccess.file_exists(SAVE_PATHS[0]), "completed slice must leave a save file")
	var file := FileAccess.open(SAVE_PATHS[0], FileAccess.READ)
	_check(file != null, "completed save must be readable")
	var decoded: Variant = null
	if file != null:
		decoded = JSON.parse_string(file.get_as_text())
		file.close()
	_check(typeof(decoded) == TYPE_DICTIONARY, "completed save must contain valid JSON")
	if typeof(decoded) == TYPE_DICTIONARY:
		_check(typeof(decoded.get("state")) == TYPE_DICTIONARY, "save JSON must contain state data")
		if typeof(decoded.get("state")) == TYPE_DICTIONARY:
			_check(bool(decoded["state"].get("victory", false)), "saved state must preserve victory")
			_check(bool(decoded["state"].get("exterior_escape_unlocked", false)), "saved state must preserve the unlocked surface route")
			_check(bool(decoded["state"].get("exterior_returned", false)), "saved state must preserve the physical return outside")
			_check(str(decoded["state"].get("final_radio_choice", "")) == "break", "saved state must preserve the break ending")

	var completed_state: Variant = game.get("state")
	var expected: Dictionary = completed_state.to_save_dict()
	var loaded_ok: bool = bool(game.call("_load_game"))
	var restored_state: Variant = game.get("state")
	_check(loaded_ok, "real game orchestrator must accept its completed save")
	_check(restored_state != completed_state, "load must replace runtime state with a validated candidate")
	_check(restored_state.to_save_dict() == expected, "loaded state must match the state written by the slice")
	_check(str(restored_state.current_objective()) == "complete", "loaded completed save must remain terminal")
	_check(str(restored_state.final_radio_choice) == "break", "loaded completed save must retain its selected ending")
	_check(game.get("exterior_root").visible and not game.get("interior_root").visible, "completed save load must restore the exterior world phase")
	_phase_result("save write and load", before)


func _prepare_fresh_state_for_radio(candidate) -> bool:
	var accepted := true
	accepted = candidate.review_work_order() and accepted
	accepted = candidate.check_equipment() and accepted
	accepted = candidate.read_physical_gauge() and accepted
	accepted = candidate.check_telemetry() and accepted
	accepted = candidate.restore_relay() and accepted
	accepted = candidate.log_report() and accepted
	accepted = candidate.unlock_station_entry() and accepted
	accepted = candidate.enter_station() and accepted
	accepted = candidate.acquire_handgun() and accepted
	accepted = candidate.collect_fuse("fuse_15a") and accepted
	accepted = candidate.collect_fuse("fuse_30a") and accepted
	accepted = candidate.install_fuse("fuse_15a") and accepted
	accepted = candidate.install_fuse("fuse_30a") and accepted
	for fragment_id in candidate.SPOOL_FRAGMENTS:
		accepted = candidate.collect_spool_fragment(fragment_id) and accepted
	accepted = candidate.assemble_spool() and accepted
	for valve_id in candidate.TIDE_VALVE_ORDER:
		accepted = candidate.turn_tide_valve(valve_id) and accepted
	accepted = candidate.transition_bellman("searching") and accepted
	accepted = candidate.transition_bellman("hunting") and accepted
	accepted = candidate.transition_bellman("staggered") and accepted
	accepted = candidate.transition_bellman("banished") and accepted
	accepted = candidate.collect_key("harmonic_key") and accepted
	accepted = candidate.unlock_door("purge_vault") and accepted
	for breaker_id in candidate.PURGE_BREAKERS:
		accepted = candidate.activate_purge_breaker(breaker_id) and accepted
	accepted = candidate.unlock_exterior_escape() and accepted
	accepted = candidate.return_to_exterior() and accepted
	return accepted


func _active_enemy_count() -> int:
	var count := 0
	if not is_instance_valid(game):
		return count
	var enemies: Variant = game.get("enemies")
	if typeof(enemies) != TYPE_ARRAY:
		return count
	for enemy in enemies:
		if is_instance_valid(enemy) and bool(enemy.get("active")):
			count += 1
	return count


func _close_overlay_if_open() -> void:
	if not is_instance_valid(game) or str(game.get("mode")) != "overlay":
		return
	var ui: Variant = game.get("ui")
	if is_instance_valid(ui):
		ui.emit_signal("overlay_closed")
	_check(str(game.get("mode")) == "playing", "closing a surface document must resume physical gameplay")


func _interaction(interaction_id: String) -> Node:
	if not is_instance_valid(game):
		return null
	var world: Variant = game.get("world_root")
	if not is_instance_valid(world):
		return null
	for child in world.find_children("*", "StaticBody3D", true, false):
		if str(child.get_meta("interaction_id", "")) == interaction_id:
			return child
	return null


func _interaction_nodes() -> Array[Node]:
	var result: Array[Node] = []
	if not is_instance_valid(game):
		return result
	var world: Variant = game.get("world_root")
	return _interaction_nodes_in(world)


func _interaction_nodes_in(container: Variant, kind: String = "") -> Array[Node]:
	var result: Array[Node] = []
	if not is_instance_valid(container):
		return result
	for child in container.find_children("*", "StaticBody3D", true, false):
		if not child.has_meta("interaction_id"):
			continue
		if not kind.is_empty() and str(child.get_meta("interaction_kind", "")) != kind:
			continue
		result.append(child)
	return result


func _is_below(container: Variant, candidate: Variant) -> bool:
	if not is_instance_valid(container) or not is_instance_valid(candidate):
		return false
	var current: Node = candidate
	while is_instance_valid(current):
		if current == container:
			return true
		current = current.get_parent()
	return false


func _interactions_of_kind(kind: String) -> Array[Node3D]:
	var result: Array[Node3D] = []
	for body in _interaction_nodes():
		if str(body.get_meta("interaction_kind", "")) == kind and body is Node3D:
			result.append(body)
	return result


func _interact(body: Node) -> void:
	_check(is_instance_valid(body), "attempted interaction node must exist")
	if is_instance_valid(body):
		game.call("handle_interaction", body)


func _check(condition: bool, message: String) -> void:
	assertions += 1
	if condition:
		return
	failures += 1
	printerr("  FAIL  %s" % message)


func _phase_result(label: String, failures_before: int) -> void:
	if failures == failures_before:
		print("  PASS  %s" % label)


func _preserve_and_clear_saves() -> void:
	for path in SAVE_PATHS:
		if FileAccess.file_exists(path):
			var file := FileAccess.open(path, FileAccess.READ)
			if file != null:
				preserved_saves[path] = file.get_buffer(file.get_length())
				file.close()
		_remove_file(path)


func _restore_preserved_saves() -> void:
	for path in SAVE_PATHS:
		_remove_file(path)
		if not preserved_saves.has(path):
			continue
		var file := FileAccess.open(path, FileAccess.WRITE)
		if file != null:
			file.store_buffer(preserved_saves[path])
			file.close()


func _remove_file(path: String) -> void:
	if not FileAccess.file_exists(path):
		return
	var absolute_path := ProjectSettings.globalize_path(path)
	var error := DirAccess.remove_absolute(absolute_path)
	if error != OK:
		failures += 1
		printerr("  FAIL  could not remove test save %s (error %d)" % [path, error])
