extends SceneTree

const GameState = preload("res://scripts/game_state.gd")

var failures: int = 0
var assertions: int = 0


func _initialize() -> void:
	_run_test("initial state", _test_initial_state)
	_run_test("ordered exterior work sequence", _test_exterior_work_sequence)
	_run_test("exterior return and final radio choice", _test_exterior_return_and_radio)
	_run_test("six-slot inventory and stacks", _test_inventory)
	_run_test("handgun magazine and reload", _test_ammo)
	_run_test("health states and healing", _test_health)
	_run_test("fuse ratings and emergency power", _test_fuses)
	_run_test("spool fragments and assembly", _test_spool)
	_run_test("tide order and anti-softlock reset", _test_tide_valves)
	_run_test("keys and doors", _test_keys_and_doors)
	_run_test("Bellman transition validation", _test_bellman_transitions)
	_run_test("purge breakers and victory gating", _test_purge_and_victory)
	_run_test("lore flags", _test_lore)
	_run_test("save dictionary roundtrip", _test_save_roundtrip)
	_run_test("legacy save migration", _test_legacy_save_migration)
	_run_test("invalid save is atomic", _test_invalid_save_is_atomic)

	if failures == 0:
		print("HUSHPOINT STATE TESTS: PASS (%d assertions)" % assertions)
		quit(0)
	else:
		printerr("HUSHPOINT STATE TESTS: FAIL (%d failures, %d assertions)" % [failures, assertions])
		quit(1)


func _run_test(test_name: String, test_method: Callable) -> void:
	var failures_before: int = failures
	var assertions_before: int = assertions
	test_method.call()
	if assertions == assertions_before:
		failures += 1
		printerr("        test completed without assertions")
	if failures == failures_before:
		print("  PASS  %s" % test_name)
	else:
		printerr("  FAIL  %s" % test_name)


func _check(condition: bool, message: String) -> void:
	assertions += 1
	if condition:
		return
	failures += 1
	printerr("        %s" % message)


func _test_initial_state() -> void:
	var state = GameState.new()
	_check(state.inventory.size() == 6, "inventory must have exactly six slots")
	_check(state.occupied_inventory_slots() == 0, "inventory must begin empty")
	_check(state.health == 100 and state.health_state() == "stable", "health must begin stable")
	_check(state.magazine == 6, "handgun must begin with one magazine")
	_check(not state.handgun_acquired, "handgun must not be available during the normal exterior opening")
	_check(not state.fire_handgun(), "unacquired handgun must not fire")
	_check(state.magazine == 6, "blocked shot must not consume a round")
	_check(state.current_objective() == "review_work_order", "opening objective must begin with the work order")
	_check(not state.power_online, "power must begin offline")
	_check(state.bellman_state == "dormant", "Bellman must begin dormant")
	_check(not state.victory, "victory must begin false")


func _test_exterior_work_sequence() -> void:
	var state = GameState.new()
	_check(not state.check_equipment(), "equipment cannot be checked before the work order")
	_check(state.review_work_order(), "work order should start the exterior assignment")
	_check(not state.review_work_order(), "work order cannot be completed twice")
	_check(state.current_objective() == "check_equipment", "equipment should follow the work order")
	_check(not state.read_physical_gauge(), "gauge reading requires checked equipment")
	_check(state.check_equipment(), "lamp and equipment check should complete")
	_check(state.current_objective() == "read_physical_gauge", "physical gauge should be next")
	_check(not state.check_telemetry(), "telemetry comparison requires a physical reading")
	_check(state.read_physical_gauge(), "physical tide gauge should be readable")
	_check(state.current_objective() == "check_telemetry", "telemetry should follow physical inspection")
	_check(not state.restore_relay(), "relay cannot be restored before telemetry diagnosis")
	_check(state.check_telemetry(), "remote telemetry should be checked")
	_check(state.current_objective() == "restore_relay", "relay repair should follow diagnosis")
	_check(not state.log_report(), "report cannot be logged before relay repair")
	_check(state.restore_relay(), "weather relay should be restored")
	_check(state.current_objective() == "log_report", "signed report should follow relay repair")
	_check(not state.unlock_station_entry(), "station entry requires a logged report")
	_check(state.log_report(), "work report should be signed and logged")
	_check(state.current_objective() == "unlock_station_entry", "station access should follow the report")
	_check(not state.enter_station(), "locked station cannot be entered")
	_check(state.unlock_station_entry(), "completed exterior assignment should unlock station access")
	_check(state.current_objective() == "enter_station", "entry should be the final exterior opening step")
	_check(state.enter_station(), "unlocked station should be enterable")
	_check(state.current_objective() == "acquire_handgun", "weapon acquisition should happen only inside")
	_check(state.acquire_handgun(), "station handgun should be collectable")
	_check(not state.acquire_handgun(), "handgun cannot be collected twice")
	_check(state.current_objective() == "restore_emergency_power", "interior objective should follow acquisition")


func _test_exterior_return_and_radio() -> void:
	var state = GameState.new()
	_check(not state.unlock_exterior_escape(), "escape cannot unlock before the station purge")
	_check(not state.return_to_exterior(), "player cannot return through a locked escape")
	_check(not state.choose_final_radio("break"), "radio choice is unavailable before returning outside")
	_complete_exterior(state)
	_win_game(state)
	_check(state.unlock_exterior_escape(), "station purge should unlock the exterior escape")
	_check(not state.choose_final_radio("answer"), "radio choice still requires physically returning outside")
	_check(state.return_to_exterior(), "unlocked route should return the player to the exterior")
	_check(not state.choose_final_radio("invalid"), "unknown final radio choice must be rejected")
	_check(state.choose_final_radio("break"), "player should be able to break the final transmission")
	_check(state.final_radio_choice == "break", "chosen radio ending must be recorded")
	_check(not state.choose_final_radio("answer"), "final choice must be terminal")
	_check(state.current_objective() == "complete", "terminal choice should complete the objective chain")


func _test_inventory() -> void:
	var state = GameState.new()
	_check(not state.add_item("unknown", 1), "unknown items must be rejected")
	_check(not state.add_item("handgun_ammo", 0), "zero quantity must be rejected")
	_check(state.add_item("handgun_ammo", 20), "ammo should split across stacks")
	_check(state.item_count("handgun_ammo") == 20, "all rounds must be counted")
	_check(state.occupied_inventory_slots() == 2, "20 rounds must occupy two 18-round stacks")
	_check(state.add_item("handgun_ammo", 16), "partial ammo stack should fill first")
	_check(state.occupied_inventory_slots() == 2, "36 rounds should still occupy two slots")
	_check(state.add_item("noise_decoy", 2), "decoy stack should fit")
	_check(state.add_item("healing_wrap", 2), "healing stack should fit")
	_check(state.collect_fuse("fuse_15a"), "key item should fit")
	_check(state.collect_fuse("fuse_30a"), "sixth slot should fit")
	var before: Array[Dictionary] = state.inventory_snapshot()
	_check(not state.add_item("service_key", 1), "full inventory must reject another item")
	_check(state.inventory_snapshot() == before, "failed pickup must not partially mutate inventory")
	_check(not state.remove_item("handgun_ammo", 37), "over-removal must fail")
	_check(state.item_count("handgun_ammo") == 36, "failed removal must be atomic")
	_check(state.remove_item("handgun_ammo", 19), "valid removal must work across stacks")
	_check(state.item_count("handgun_ammo") == 17, "remaining ammunition must be exact")


func _test_ammo() -> void:
	var state = GameState.new()
	_complete_exterior(state)
	for _shot in range(6):
		_check(state.fire_handgun(), "loaded handgun should fire")
	_check(state.magazine == 0, "six shots must empty the magazine")
	_check(not state.fire_handgun(), "empty handgun must dry fire without underflow")
	_check(state.reload_handgun() == 0, "reload without reserve ammunition must fail")
	_check(state.add_item("handgun_ammo", 9), "reserve ammunition should be accepted")
	_check(state.reload_handgun() == 6, "reload should fill the magazine")
	_check(state.magazine == 6 and state.item_count("handgun_ammo") == 3, "reload accounting must be exact")
	_check(state.reload_handgun() == 0, "full magazine reload must do nothing")
	_check(state.fire_handgun(), "handgun should fire after reload")
	_check(state.reload_handgun() == 1, "partial reload should consume only missing rounds")


func _test_health() -> void:
	var state = GameState.new()
	_complete_exterior(state)
	_check(not state.apply_damage(0), "zero damage must be rejected")
	_check(state.apply_damage(31), "damage should apply")
	_check(state.health == 69 and state.health_state() == "wounded", "69 health must be wounded")
	_check(state.apply_damage(40), "more damage should apply")
	_check(state.health == 29 and state.health_state() == "critical", "29 health must be critical")
	_check(not state.use_healing_wrap(), "healing without an item must fail")
	_check(state.add_item("healing_wrap", 2), "healing wraps should be added")
	_check(state.use_healing_wrap(), "healing wrap should restore health")
	_check(state.health == 64 and state.health_state() == "wounded", "healing must update health state")
	_check(state.use_healing_wrap(), "second wrap should restore again")
	_check(state.health == 99, "healing amount must be deterministic")
	_check(state.apply_damage(500), "lethal damage should clamp")
	_check(state.health == 0 and state.health_state() == "dead", "lethal damage must produce dead state")
	_check(not state.use_healing_wrap(), "healing cannot revive the dead")
	_check(not state.fire_handgun(), "dead player cannot fire")


func _test_fuses() -> void:
	var state = GameState.new()
	_check(not state.add_item("fuse_15a", 1), "progression fuses require the collection API")
	_check(not state.install_fuse("fuse_15a"), "unowned fuse cannot be installed")
	_check(state.collect_fuse("fuse_20a"), "decoy fuse should be collectable")
	_check(not state.collect_fuse("fuse_20a"), "same fuse cannot be collected twice")
	_check(not state.install_fuse("fuse_20a"), "wrong fuse rating must be rejected")
	_check(state.item_count("fuse_20a") == 1, "rejected fuse must remain in inventory")
	_check(state.collect_fuse("fuse_15a") and state.collect_fuse("fuse_30a"), "required fuses should fit")
	_check(state.install_fuse("fuse_15a"), "first correct fuse should install")
	_check(not state.power_online, "one fuse must not energize the station")
	_check(not state.install_fuse("fuse_15a"), "installed fuse cannot be installed twice")
	_check(state.install_fuse("fuse_30a"), "second correct fuse should install")
	_check(state.power_online, "both correct fuse ratings must energize the station")


func _test_spool() -> void:
	var state = GameState.new()
	_check(not state.add_item("spool_a", 1), "spool pieces require the collection API")
	_check(not state.collect_spool_fragment("spool_x"), "unknown fragment must be rejected")
	_check(not state.assemble_spool(), "incomplete spool cannot assemble")
	for fragment_id in GameState.SPOOL_FRAGMENTS:
		_check(state.collect_spool_fragment(fragment_id), "%s should be collected" % fragment_id)
	_check(not state.remove_item("spool_a", 1), "spool pieces cannot be discarded into a softlock")
	_check(not state.collect_spool_fragment("spool_a"), "fragment cannot be collected twice")
	_check(state.assemble_spool(), "three fragments should assemble")
	_check(state.spool_assembled, "assembled flag must be set")
	for fragment_id in GameState.SPOOL_FRAGMENTS:
		_check(state.item_count(fragment_id) == 0, "assembled fragment should leave inventory")
	_check(not state.assemble_spool(), "spool cannot assemble twice")


func _test_tide_valves() -> void:
	var state = GameState.new()
	_check(not state.turn_tide_valve("intake"), "valves require emergency power")
	_power_station(state)
	_check(not state.turn_tide_valve("unknown"), "unknown valve must be rejected")
	_check(state.tide_reset_count == 0, "unknown input must not disturb the physical puzzle")
	_check(state.turn_tide_valve("intake"), "first correct valve should turn")
	_check(not state.turn_tide_valve("outflow"), "wrong known valve must reset the sequence")
	_check(state.tide_valve_progress.is_empty(), "wrong order must clear progress")
	_check(state.tide_reset_count == 1, "automatic reset must be recorded")
	_check(state.turn_tide_valve("intake"), "puzzle must be retryable after failure")
	_check(state.reset_tide_valves(), "manual reset control must always be available")
	_check(state.tide_valve_progress.is_empty(), "manual reset must clear progress")
	for valve_id in GameState.TIDE_VALVE_ORDER:
		_check(state.turn_tide_valve(valve_id), "%s should be accepted in order" % valve_id)
	_check(state.tide_balanced, "valid sequence must balance the tide")
	_check(not state.turn_tide_valve("intake"), "completed puzzle must reject extra turns")
	_check(not state.reset_tide_valves(), "completed puzzle must not be rolled back")
	_check(state.tide_balanced, "rejected reset must preserve solved tide state")


func _test_keys_and_doors() -> void:
	var state = GameState.new()
	_check(not state.add_item("service_key", 1), "keys require the collection API")
	_check(not state.collect_key("fake_key"), "unknown key must be rejected")
	_check(not state.unlock_door("service_door"), "door cannot open without its key")
	_check(state.collect_key("service_key"), "service key should be collectable")
	_check(not state.collect_key("service_key"), "same key cannot be collected twice")
	_check(not state.remove_item("service_key", 1), "door keys cannot be discarded into a softlock")
	_check(not state.unlock_door("records_annex"), "wrong key must not open a door")
	_check(state.unlock_door("service_door"), "matching key should unlock door")
	_check(state.item_count("service_key") == 1, "door key should not be consumed")
	_check(not state.unlock_door("service_door"), "already unlocked door should reject duplicate interaction")
	_check(not state.unlock_door("unknown_door"), "unknown door must be rejected")


func _test_bellman_transitions() -> void:
	var state = GameState.new()
	_check(not state.transition_bellman("hunting"), "Bellman cannot skip from dormant to hunting")
	_check(not state.transition_bellman("searching"), "Bellman cannot wake before tide balance")
	_prepare_tide_and_spool(state)
	_check(state.transition_bellman("searching"), "balanced tide should wake the Bellman")
	_check(not state.transition_bellman("searching"), "same-state transition must fail")
	_check(not state.transition_bellman("banished"), "Bellman cannot skip directly to banished")
	_check(state.transition_bellman("staggered"), "searching Bellman may be staggered")
	_check(state.transition_bellman("hunting"), "staggered Bellman may resume hunting")
	_check(state.transition_bellman("searching"), "hunting Bellman may fall back to searching")
	_check(state.transition_bellman("hunting"), "searching Bellman may begin hunting")
	_check(state.transition_bellman("staggered"), "hunting Bellman may be staggered")
	_check(state.transition_bellman("hunting"), "stagger is temporary")
	_check(state.transition_bellman("staggered"), "Bellman can be staggered again")
	_check(state.transition_bellman("banished"), "assembled counter-signal may banish staggered Bellman")
	_check(not state.transition_bellman("hunting"), "banished is a terminal state")
	_check(not state.transition_bellman("invalid"), "unknown state must be rejected")


func _test_purge_and_victory() -> void:
	var state = GameState.new()
	_check(not state.activate_purge_breaker("north"), "purge must reject skipped progression")
	_prepare_tide_and_spool(state)
	_banish_bellman(state)
	_check(not state.activate_purge_breaker("north"), "purge vault must be unlocked")
	_check(state.collect_key("harmonic_key"), "harmonic key should be collectable")
	_check(state.unlock_door("purge_vault"), "harmonic key should unlock purge vault")
	_check(not state.activate_purge_breaker("invalid"), "unknown breaker must be rejected")
	_check(state.activate_purge_breaker("north"), "north breaker should activate")
	_check(not state.victory, "one breaker is not victory")
	_check(not state.activate_purge_breaker("north"), "breaker cannot activate twice")
	_check(state.activate_purge_breaker("east"), "east breaker should activate")
	_check(not state.victory, "two breakers are not victory")
	_check(state.activate_purge_breaker("west"), "west breaker should activate")
	_check(state.victory, "all three breakers after full progression must win")


func _test_lore() -> void:
	var state = GameState.new()
	_check(not state.discover_lore("unknown"), "unknown lore must be rejected")
	_check(state.discover_lore("dock_manifest"), "known lore should be discovered")
	_check(state.has_lore("dock_manifest"), "lore flag should be queryable")
	_check(not state.discover_lore("dock_manifest"), "lore cannot be discovered twice")
	_check(not state.has_lore("mara_last_message"), "undiscovered lore must stay false")


func _test_save_roundtrip() -> void:
	var original = GameState.new()
	_complete_exterior(original)
	_check(original.add_item("handgun_ammo", 11), "roundtrip fixture ammo should fit")
	_check(original.add_item("healing_wrap", 1), "roundtrip fixture healing should fit")
	_check(original.apply_damage(46), "roundtrip fixture damage should apply")
	_check(original.fire_handgun(), "roundtrip fixture shot should fire")
	_prepare_tide_and_spool(original)
	_banish_bellman(original)
	_check(original.collect_key("harmonic_key"), "roundtrip fixture key should fit")
	_check(original.unlock_door("purge_vault"), "roundtrip fixture door should unlock")
	_check(original.activate_purge_breaker("east"), "roundtrip fixture breaker should activate")
	_check(original.activate_purge_breaker("north"), "roundtrip fixture north breaker should activate")
	_check(original.activate_purge_breaker("west"), "roundtrip fixture west breaker should activate")
	_check(original.unlock_exterior_escape(), "roundtrip fixture escape should unlock")
	_check(original.return_to_exterior(), "roundtrip fixture should return outside")
	_check(original.choose_final_radio("answer"), "roundtrip fixture should preserve final radio choice")
	_check(original.discover_lore("palinode_log"), "roundtrip fixture lore should register")
	_check(original.discover_lore("mara_last_message"), "second lore flag should register")

	var encoded: String = JSON.stringify(original.to_save_dict())
	var decoded: Variant = JSON.parse_string(encoded)
	_check(typeof(decoded) == TYPE_DICTIONARY, "save JSON must decode to a dictionary")
	var restored = GameState.new()
	_check(restored.load_save_dict(decoded), "JSON-decoded save should load")
	_check(restored.to_save_dict() == original.to_save_dict(), "save roundtrip must preserve every field")


func _test_legacy_save_migration() -> void:
	var legacy_source = GameState.new()
	var legacy: Dictionary = legacy_source.to_save_dict()
	legacy["version"] = 1
	for field_name in GameState.EXTERIOR_SAVE_FIELDS:
		legacy.erase(field_name)
	legacy.erase("final_radio_choice")
	var restored = GameState.new()
	_check(restored.load_save_dict(legacy), "version-one interior-start save should migrate")
	_check(restored.station_entered, "migrated save should preserve the legacy interior starting position")
	_check(restored.handgun_acquired, "migrated save should preserve the legacy available handgun")
	_check(not restored.exterior_escape_unlocked, "migration must not grant endgame escape progress")
	_check(restored.final_radio_choice.is_empty(), "migration must not invent a final choice")
	_check(restored.to_save_dict()["version"] == GameState.SAVE_VERSION, "migrated save should serialize at the current version")

	var completed_source = GameState.new()
	_complete_exterior(completed_source)
	_win_game(completed_source)
	var completed_legacy: Dictionary = completed_source.to_save_dict()
	completed_legacy["version"] = 1
	for field_name in GameState.EXTERIOR_SAVE_FIELDS:
		completed_legacy.erase(field_name)
	completed_legacy.erase("final_radio_choice")
	var completed_restored = GameState.new()
	_check(completed_restored.load_save_dict(completed_legacy), "completed version-one save should migrate")
	_check(completed_restored.victory, "completed legacy migration must preserve victory")
	_check(completed_restored.exterior_escape_unlocked, "completed legacy migration must keep a reachable surface route")
	_check(completed_restored.return_to_exterior(), "completed legacy migration must still allow the player to return outside")


func _test_invalid_save_is_atomic() -> void:
	var state = GameState.new()
	_check(state.add_item("handgun_ammo", 8), "atomic fixture ammo should fit")
	_check(state.apply_damage(17), "atomic fixture damage should apply")
	var before: Dictionary = state.to_save_dict()
	var corrupted: Dictionary = before.duplicate(true)
	corrupted["magazine"] = 999
	_expect_rejected_save(state, before, corrupted, "out-of-range magazine")

	corrupted = before.duplicate(true)
	corrupted["tide_valve_progress"] = ["outflow"]
	_expect_rejected_save(state, before, corrupted, "invalid tide prefix")

	corrupted = before.duplicate(true)
	corrupted["inventory"][0] = {"id": "handgun_ammo", "count": 999}
	_expect_rejected_save(state, before, corrupted, "oversized inventory stack")

	corrupted = before.duplicate(true)
	corrupted["version"] = 999
	_expect_rejected_save(state, before, corrupted, "unsupported save version")

	corrupted = before.duplicate(true)
	corrupted["health"] = -1
	_expect_rejected_save(state, before, corrupted, "negative health")

	corrupted = before.duplicate(true)
	corrupted["power_online"] = true
	_expect_rejected_save(state, before, corrupted, "power without installed fuses")

	corrupted = before.duplicate(true)
	corrupted["spool_assembled"] = true
	_expect_rejected_save(state, before, corrupted, "assembly without spool fragments")

	corrupted = before.duplicate(true)
	corrupted["doors_unlocked"]["service_door"] = true
	_expect_rejected_save(state, before, corrupted, "unlocked door without its key")

	corrupted = before.duplicate(true)
	corrupted["purge_breakers_active"]["north"] = true
	_expect_rejected_save(state, before, corrupted, "purge breaker without prerequisites")

	corrupted = before.duplicate(true)
	corrupted["bellman_state"] = "banished"
	_expect_rejected_save(state, before, corrupted, "banished Bellman without progression")

	corrupted = before.duplicate(true)
	corrupted["lore_flags"] = ["unknown"]
	_expect_rejected_save(state, before, corrupted, "unknown lore flag")

	corrupted = before.duplicate(true)
	corrupted["victory"] = true
	_expect_rejected_save(state, before, corrupted, "victory without all breakers")

	corrupted = before.duplicate(true)
	corrupted["equipment_checked"] = true
	_expect_rejected_save(state, before, corrupted, "equipment completion without work order")

	corrupted = before.duplicate(true)
	corrupted["station_entered"] = true
	_expect_rejected_save(state, before, corrupted, "station entry without exterior sequence")

	corrupted = before.duplicate(true)
	corrupted["final_radio_choice"] = "answer"
	_expect_rejected_save(state, before, corrupted, "radio choice before exterior return")

	corrupted = before.duplicate(true)
	corrupted["final_radio_choice"] = "listen"
	_expect_rejected_save(state, before, corrupted, "unknown final radio choice")


func _expect_rejected_save(state, before: Dictionary, corrupted: Dictionary, reason: String) -> void:
	_check(not state.load_save_dict(corrupted), "%s save must fail" % reason)
	_check(state.to_save_dict() == before, "%s failure must be atomic" % reason)


func _power_station(state) -> void:
	_check(state.collect_fuse("fuse_15a"), "fixture fuse 15A should fit")
	_check(state.collect_fuse("fuse_30a"), "fixture fuse 30A should fit")
	_check(state.install_fuse("fuse_15a"), "fixture fuse 15A should install")
	_check(state.install_fuse("fuse_30a"), "fixture fuse 30A should install")


func _prepare_tide_and_spool(state) -> void:
	_power_station(state)
	for fragment_id in GameState.SPOOL_FRAGMENTS:
		_check(state.collect_spool_fragment(fragment_id), "fixture %s should be collected" % fragment_id)
	_check(state.assemble_spool(), "fixture spool should assemble")
	for valve_id in GameState.TIDE_VALVE_ORDER:
		_check(state.turn_tide_valve(valve_id), "fixture valve %s should turn" % valve_id)


func _banish_bellman(state) -> void:
	_check(state.transition_bellman("searching"), "fixture Bellman should wake")
	_check(state.transition_bellman("hunting"), "fixture Bellman should hunt")
	_check(state.transition_bellman("staggered"), "fixture Bellman should stagger")
	_check(state.transition_bellman("banished"), "fixture Bellman should be banished")


func _complete_exterior(state) -> void:
	_check(state.review_work_order(), "fixture work order should be reviewed")
	_check(state.check_equipment(), "fixture equipment should be checked")
	_check(state.read_physical_gauge(), "fixture physical gauge should be read")
	_check(state.check_telemetry(), "fixture telemetry should be checked")
	_check(state.restore_relay(), "fixture relay should be restored")
	_check(state.log_report(), "fixture report should be logged")
	_check(state.unlock_station_entry(), "fixture station entry should unlock")
	_check(state.enter_station(), "fixture station should be entered")
	_check(state.acquire_handgun(), "fixture handgun should be acquired")


func _win_game(state) -> void:
	_prepare_tide_and_spool(state)
	_banish_bellman(state)
	_check(state.collect_key("harmonic_key"), "fixture harmonic key should fit")
	_check(state.unlock_door("purge_vault"), "fixture purge vault should unlock")
	for breaker_id in GameState.PURGE_BREAKERS:
		_check(state.activate_purge_breaker(breaker_id), "fixture breaker %s should activate" % breaker_id)
