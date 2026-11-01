class_name HushpointGameState
extends RefCounted

## Deterministic, renderer-independent state for the HUSHPOINT vertical slice.
## Every mutating method rejects invalid input without partially changing state.

const SAVE_VERSION: int = 2
const LEGACY_SAVE_VERSION: int = 1
const INVENTORY_SIZE: int = 6
const MAX_HEALTH: int = 100
const MAGAZINE_CAPACITY: int = 6
const HEALING_WRAP_AMOUNT: int = 35

const EXTERIOR_SAVE_FIELDS: PackedStringArray = [
	"work_order_reviewed",
	"equipment_checked",
	"physical_gauge_read",
	"telemetry_checked",
	"relay_restored",
	"report_logged",
	"station_entry_unlocked",
	"station_entered",
	"handgun_acquired",
	"exterior_escape_unlocked",
	"exterior_returned",
]
const EXTERIOR_OPENING_FIELDS: PackedStringArray = [
	"work_order_reviewed",
	"equipment_checked",
	"physical_gauge_read",
	"telemetry_checked",
	"relay_restored",
	"report_logged",
	"station_entry_unlocked",
	"station_entered",
	"handgun_acquired",
]
const FINAL_RADIO_CHOICES: PackedStringArray = ["break", "answer"]

const ITEM_RULES: Dictionary = {
	"handgun_ammo": {"max_stack": 18},
	"healing_wrap": {"max_stack": 2},
	"noise_decoy": {"max_stack": 2},
	"fuse_15a": {"max_stack": 1},
	"fuse_20a": {"max_stack": 1},
	"fuse_30a": {"max_stack": 1},
	"spool_a": {"max_stack": 1},
	"spool_b": {"max_stack": 1},
	"spool_c": {"max_stack": 1},
	"service_key": {"max_stack": 1},
	"records_key": {"max_stack": 1},
	"harmonic_key": {"max_stack": 1},
}

const REQUIRED_FUSES: PackedStringArray = ["fuse_15a", "fuse_30a"]
const FUSE_ITEMS: PackedStringArray = ["fuse_15a", "fuse_20a", "fuse_30a"]
const SPOOL_FRAGMENTS: PackedStringArray = ["spool_a", "spool_b", "spool_c"]
const TIDE_VALVE_ORDER: PackedStringArray = ["intake", "balance", "outflow"]
const TIDE_VALVES: PackedStringArray = ["intake", "balance", "outflow"]
const PURGE_BREAKERS: PackedStringArray = ["north", "east", "west"]
const BELLMAN_STATES: PackedStringArray = [
	"dormant", "searching", "hunting", "staggered", "banished"
]
const LORE_IDS: PackedStringArray = [
	"dock_manifest",
	"mara_note_1",
	"palinode_log",
	"quiet_night_calls",
	"mara_last_message",
]
const DOOR_KEYS: Dictionary = {
	"service_door": "service_key",
	"records_annex": "records_key",
	"purge_vault": "harmonic_key",
}
const NON_DISCARDABLE_ITEMS: PackedStringArray = [
	"fuse_15a",
	"fuse_30a",
	"spool_a",
	"spool_b",
	"spool_c",
	"service_key",
	"records_key",
	"harmonic_key",
]
const BELLMAN_TRANSITIONS: Dictionary = {
	"dormant": ["searching"],
	"searching": ["hunting", "staggered"],
	"hunting": ["searching", "staggered"],
	"staggered": ["hunting", "banished"],
	"banished": [],
}

var inventory: Array[Dictionary] = []
var health: int = MAX_HEALTH
var magazine: int = MAGAZINE_CAPACITY
var installed_fuses: Dictionary = {}
var power_online: bool = false
var spool_fragments_found: Dictionary = {}
var spool_assembled: bool = false
var tide_valve_progress: Array[String] = []
var tide_balanced: bool = false
var tide_reset_count: int = 0
var doors_unlocked: Dictionary = {}
var purge_breakers_active: Dictionary = {}
var bellman_state: String = "dormant"
var lore_flags: Dictionary = {}
var victory: bool = false
var work_order_reviewed: bool = false
var equipment_checked: bool = false
var physical_gauge_read: bool = false
var telemetry_checked: bool = false
var relay_restored: bool = false
var report_logged: bool = false
var station_entry_unlocked: bool = false
var station_entered: bool = false
var handgun_acquired: bool = false
var exterior_escape_unlocked: bool = false
var exterior_returned: bool = false
var final_radio_choice: String = ""


func _init() -> void:
	_reset_state()


func _reset_state() -> void:
	inventory.clear()
	for _slot_index in range(INVENTORY_SIZE):
		inventory.append({})
	health = MAX_HEALTH
	magazine = MAGAZINE_CAPACITY
	installed_fuses = _false_map(REQUIRED_FUSES)
	power_online = false
	spool_fragments_found = _false_map(SPOOL_FRAGMENTS)
	spool_assembled = false
	tide_valve_progress.clear()
	tide_balanced = false
	tide_reset_count = 0
	doors_unlocked = _false_map(DOOR_KEYS.keys())
	purge_breakers_active = _false_map(PURGE_BREAKERS)
	bellman_state = "dormant"
	lore_flags.clear()
	victory = false
	work_order_reviewed = false
	equipment_checked = false
	physical_gauge_read = false
	telemetry_checked = false
	relay_restored = false
	report_logged = false
	station_entry_unlocked = false
	station_entered = false
	handgun_acquired = false
	exterior_escape_unlocked = false
	exterior_returned = false
	final_radio_choice = ""


func review_work_order() -> bool:
	if work_order_reviewed:
		return false
	work_order_reviewed = true
	return true


func check_equipment() -> bool:
	if equipment_checked or not work_order_reviewed:
		return false
	equipment_checked = true
	return true


func read_physical_gauge() -> bool:
	if physical_gauge_read or not equipment_checked:
		return false
	physical_gauge_read = true
	return true


func check_telemetry() -> bool:
	if telemetry_checked or not physical_gauge_read:
		return false
	telemetry_checked = true
	return true


func restore_relay() -> bool:
	if relay_restored or not telemetry_checked:
		return false
	relay_restored = true
	return true


func log_report() -> bool:
	if report_logged or not relay_restored:
		return false
	report_logged = true
	return true


func unlock_station_entry() -> bool:
	if station_entry_unlocked or not report_logged:
		return false
	station_entry_unlocked = true
	return true


func enter_station() -> bool:
	if station_entered or not station_entry_unlocked:
		return false
	station_entered = true
	return true


func acquire_handgun() -> bool:
	if handgun_acquired or not station_entered:
		return false
	handgun_acquired = true
	return true


func unlock_exterior_escape() -> bool:
	if exterior_escape_unlocked or not victory:
		return false
	exterior_escape_unlocked = true
	return true


func return_to_exterior() -> bool:
	if exterior_returned or not exterior_escape_unlocked:
		return false
	exterior_returned = true
	return true


func choose_final_radio(choice: String) -> bool:
	if (
		not exterior_returned
		or not final_radio_choice.is_empty()
		or not FINAL_RADIO_CHOICES.has(choice)
	):
		return false
	final_radio_choice = choice
	return true


func current_objective() -> String:
	if not work_order_reviewed:
		return "review_work_order"
	if not equipment_checked:
		return "check_equipment"
	if not physical_gauge_read:
		return "read_physical_gauge"
	if not telemetry_checked:
		return "check_telemetry"
	if not relay_restored:
		return "restore_relay"
	if not report_logged:
		return "log_report"
	if not station_entry_unlocked:
		return "unlock_station_entry"
	if not station_entered:
		return "enter_station"
	if not handgun_acquired:
		return "acquire_handgun"
	if not power_online:
		return "restore_emergency_power"
	if not spool_assembled:
		return "assemble_counter_signal"
	if not tide_balanced:
		return "balance_tide"
	if bellman_state != "banished":
		return "banish_bellman"
	if not victory:
		return "activate_purge_breakers"
	if not exterior_escape_unlocked:
		return "unlock_exterior_escape"
	if not exterior_returned:
		return "return_to_exterior"
	if final_radio_choice.is_empty():
		return "choose_final_radio"
	return "complete"


func inventory_snapshot() -> Array[Dictionary]:
	return inventory.duplicate(true)


func add_item(item_id: String, quantity: int = 1) -> bool:
	if FUSE_ITEMS.has(item_id) or SPOOL_FRAGMENTS.has(item_id) or DOOR_KEYS.values().has(item_id):
		return false
	return _add_item_internal(item_id, quantity)


func _add_item_internal(item_id: String, quantity: int = 1) -> bool:
	if not ITEM_RULES.has(item_id) or quantity <= 0:
		return false
	var max_stack: int = int(ITEM_RULES[item_id]["max_stack"])
	var capacity: int = 0
	for slot in inventory:
		if slot.is_empty():
			capacity += max_stack
		elif slot.get("id", "") == item_id:
			capacity += max_stack - int(slot.get("count", 0))
	if capacity < quantity:
		return false

	var remaining: int = quantity
	for slot_index in range(INVENTORY_SIZE):
		var slot: Dictionary = inventory[slot_index]
		if slot.get("id", "") != item_id:
			continue
		var add_count: int = mini(remaining, max_stack - int(slot["count"]))
		slot["count"] = int(slot["count"]) + add_count
		remaining -= add_count
		if remaining == 0:
			return true
	for slot_index in range(INVENTORY_SIZE):
		if not inventory[slot_index].is_empty():
			continue
		var add_count: int = mini(remaining, max_stack)
		inventory[slot_index] = {"id": item_id, "count": add_count}
		remaining -= add_count
		if remaining == 0:
			return true
	return false


func remove_item(item_id: String, quantity: int = 1) -> bool:
	if NON_DISCARDABLE_ITEMS.has(item_id):
		return false
	return _remove_item_internal(item_id, quantity)


func _remove_item_internal(item_id: String, quantity: int = 1) -> bool:
	if not ITEM_RULES.has(item_id) or quantity <= 0 or item_count(item_id) < quantity:
		return false
	var remaining: int = quantity
	for slot_index in range(INVENTORY_SIZE - 1, -1, -1):
		var slot: Dictionary = inventory[slot_index]
		if slot.get("id", "") != item_id:
			continue
		var remove_count: int = mini(remaining, int(slot["count"]))
		var new_count: int = int(slot["count"]) - remove_count
		remaining -= remove_count
		if new_count == 0:
			inventory[slot_index] = {}
		else:
			slot["count"] = new_count
		if remaining == 0:
			return true
	return false


func item_count(item_id: String) -> int:
	var total: int = 0
	for slot in inventory:
		if slot.get("id", "") == item_id:
			total += int(slot.get("count", 0))
	return total


func occupied_inventory_slots() -> int:
	var occupied: int = 0
	for slot in inventory:
		if not slot.is_empty():
			occupied += 1
	return occupied


func fire_handgun() -> bool:
	if not handgun_acquired or magazine <= 0 or health <= 0:
		return false
	magazine -= 1
	return true


func reload_handgun() -> int:
	if not handgun_acquired or health <= 0 or magazine >= MAGAZINE_CAPACITY:
		return 0
	var rounds_to_load: int = mini(MAGAZINE_CAPACITY - magazine, item_count("handgun_ammo"))
	if rounds_to_load <= 0:
		return 0
	if not remove_item("handgun_ammo", rounds_to_load):
		return 0
	magazine += rounds_to_load
	return rounds_to_load


func health_state() -> String:
	if health <= 0:
		return "dead"
	if health <= 30:
		return "critical"
	if health <= 70:
		return "wounded"
	return "stable"


func apply_damage(amount: int) -> bool:
	if amount <= 0 or health <= 0:
		return false
	health = maxi(0, health - amount)
	return true


func use_healing_wrap() -> bool:
	if health <= 0 or health >= MAX_HEALTH or item_count("healing_wrap") <= 0:
		return false
	if not remove_item("healing_wrap", 1):
		return false
	health = mini(MAX_HEALTH, health + HEALING_WRAP_AMOUNT)
	return true


func install_fuse(fuse_id: String) -> bool:
	if not REQUIRED_FUSES.has(fuse_id):
		return false
	if bool(installed_fuses.get(fuse_id, false)) or item_count(fuse_id) <= 0:
		return false
	if not _remove_item_internal(fuse_id, 1):
		return false
	installed_fuses[fuse_id] = true
	power_online = _all_true(installed_fuses)
	return true


func collect_fuse(fuse_id: String) -> bool:
	if not FUSE_ITEMS.has(fuse_id):
		return false
	if item_count(fuse_id) > 0 or bool(installed_fuses.get(fuse_id, false)):
		return false
	return _add_item_internal(fuse_id, 1)


func collect_spool_fragment(fragment_id: String) -> bool:
	if not SPOOL_FRAGMENTS.has(fragment_id):
		return false
	if bool(spool_fragments_found.get(fragment_id, false)):
		return false
	if not _add_item_internal(fragment_id, 1):
		return false
	spool_fragments_found[fragment_id] = true
	return true


func assemble_spool() -> bool:
	if spool_assembled or not _all_true(spool_fragments_found):
		return false
	for fragment_id in SPOOL_FRAGMENTS:
		if item_count(fragment_id) <= 0:
			return false
	for fragment_id in SPOOL_FRAGMENTS:
		_remove_item_internal(fragment_id, 1)
	spool_assembled = true
	return true


func turn_tide_valve(valve_id: String) -> bool:
	if not power_online or tide_balanced or not TIDE_VALVES.has(valve_id):
		return false
	var expected_valve: String = TIDE_VALVE_ORDER[tide_valve_progress.size()]
	if valve_id != expected_valve:
		_reset_tide_sequence(true)
		return false
	tide_valve_progress.append(valve_id)
	if tide_valve_progress.size() == TIDE_VALVE_ORDER.size():
		tide_balanced = true
	return true


func reset_tide_valves() -> bool:
	if tide_balanced:
		return false
	_reset_tide_sequence(true)
	return true


func _reset_tide_sequence(count_reset: bool) -> void:
	tide_valve_progress.clear()
	tide_balanced = false
	if count_reset:
		tide_reset_count += 1


func collect_key(key_id: String) -> bool:
	if not DOOR_KEYS.values().has(key_id):
		return false
	if item_count(key_id) > 0:
		return false
	return _add_item_internal(key_id, 1)


func unlock_door(door_id: String) -> bool:
	if not DOOR_KEYS.has(door_id) or bool(doors_unlocked.get(door_id, false)):
		return false
	var key_id: String = str(DOOR_KEYS[door_id])
	if item_count(key_id) <= 0:
		return false
	doors_unlocked[door_id] = true
	return true


func transition_bellman(next_state: String) -> bool:
	if not BELLMAN_STATES.has(next_state) or next_state == bellman_state:
		return false
	var allowed: Array = BELLMAN_TRANSITIONS[bellman_state]
	if not allowed.has(next_state):
		return false
	if bellman_state == "dormant" and next_state == "searching" and not tide_balanced:
		return false
	if next_state == "banished" and (not tide_balanced or not spool_assembled):
		return false
	bellman_state = next_state
	return true


func activate_purge_breaker(breaker_id: String) -> bool:
	if not PURGE_BREAKERS.has(breaker_id):
		return false
	if bool(purge_breakers_active.get(breaker_id, false)):
		return false
	if (
		not power_online
		or not spool_assembled
		or not tide_balanced
		or not bool(doors_unlocked.get("purge_vault", false))
		or bellman_state != "banished"
	):
		return false
	purge_breakers_active[breaker_id] = true
	victory = _all_true(purge_breakers_active)
	return true


func discover_lore(lore_id: String) -> bool:
	if not LORE_IDS.has(lore_id) or bool(lore_flags.get(lore_id, false)):
		return false
	lore_flags[lore_id] = true
	return true


func has_lore(lore_id: String) -> bool:
	return bool(lore_flags.get(lore_id, false))


func to_save_dict() -> Dictionary:
	var discovered_lore: Array[String] = []
	for lore_id in LORE_IDS:
		if bool(lore_flags.get(lore_id, false)):
			discovered_lore.append(lore_id)
	return {
		"version": SAVE_VERSION,
		"inventory": inventory.duplicate(true),
		"health": health,
		"magazine": magazine,
		"installed_fuses": installed_fuses.duplicate(true),
		"power_online": power_online,
		"spool_fragments_found": spool_fragments_found.duplicate(true),
		"spool_assembled": spool_assembled,
		"tide_valve_progress": tide_valve_progress.duplicate(),
		"tide_balanced": tide_balanced,
		"tide_reset_count": tide_reset_count,
		"doors_unlocked": doors_unlocked.duplicate(true),
		"purge_breakers_active": purge_breakers_active.duplicate(true),
		"bellman_state": bellman_state,
		"lore_flags": discovered_lore,
		"victory": victory,
		"work_order_reviewed": work_order_reviewed,
		"equipment_checked": equipment_checked,
		"physical_gauge_read": physical_gauge_read,
		"telemetry_checked": telemetry_checked,
		"relay_restored": relay_restored,
		"report_logged": report_logged,
		"station_entry_unlocked": station_entry_unlocked,
		"station_entered": station_entered,
		"handgun_acquired": handgun_acquired,
		"exterior_escape_unlocked": exterior_escape_unlocked,
		"exterior_returned": exterior_returned,
		"final_radio_choice": final_radio_choice,
	}


func load_save_dict(data: Dictionary) -> bool:
	var stored_version: int = _whole_number(data.get("version", -1))
	if stored_version != SAVE_VERSION and stored_version != LEGACY_SAVE_VERSION:
		return false
	var save_data: Dictionary = data.duplicate(true)
	if stored_version == LEGACY_SAVE_VERSION:
		save_data["version"] = SAVE_VERSION
		for field_name in EXTERIOR_OPENING_FIELDS:
			save_data[field_name] = true
		save_data["exterior_escape_unlocked"] = false
		save_data["exterior_returned"] = false
		save_data["final_radio_choice"] = ""

	var next_inventory: Variant = _validated_inventory(save_data.get("inventory"))
	if next_inventory == null:
		return false
	var next_health: int = _whole_number(save_data.get("health", -1))
	var next_magazine: int = _whole_number(save_data.get("magazine", -1))
	var next_reset_count: int = _whole_number(save_data.get("tide_reset_count", -1))
	if (
		next_health < 0
		or next_health > MAX_HEALTH
		or next_magazine < 0
		or next_magazine > MAGAZINE_CAPACITY
		or next_reset_count < 0
	):
		return false

	var next_fuses: Variant = _validated_bool_map(
		save_data.get("installed_fuses"), REQUIRED_FUSES
	)
	var next_fragments: Variant = _validated_bool_map(
		save_data.get("spool_fragments_found"), SPOOL_FRAGMENTS
	)
	var next_doors: Variant = _validated_bool_map(
		save_data.get("doors_unlocked"), DOOR_KEYS.keys()
	)
	var next_breakers: Variant = _validated_bool_map(
		save_data.get("purge_breakers_active"), PURGE_BREAKERS
	)
	if next_fuses == null or next_fragments == null or next_doors == null or next_breakers == null:
		return false

	var next_power: Variant = save_data.get("power_online")
	var next_spool_assembled: Variant = save_data.get("spool_assembled")
	var next_tide_balanced: Variant = save_data.get("tide_balanced")
	var next_victory: Variant = save_data.get("victory")
	if (
		typeof(next_power) != TYPE_BOOL
		or typeof(next_spool_assembled) != TYPE_BOOL
		or typeof(next_tide_balanced) != TYPE_BOOL
		or typeof(next_victory) != TYPE_BOOL
	):
		return false
	if bool(next_power) != _all_true(next_fuses):
		return false
	if bool(next_spool_assembled) and not _all_true(next_fragments):
		return false
	for fuse_id in REQUIRED_FUSES:
		if bool(next_fuses[fuse_id]) and _count_in_inventory(next_inventory, fuse_id) != 0:
			return false
	for fuse_id in FUSE_ITEMS:
		if _count_in_inventory(next_inventory, fuse_id) > 1:
			return false
	for fragment_id in SPOOL_FRAGMENTS:
		var stored_fragment_count: int = _count_in_inventory(next_inventory, fragment_id)
		if bool(next_spool_assembled):
			if stored_fragment_count != 0:
				return false
		elif bool(next_fragments[fragment_id]) != (stored_fragment_count == 1):
			return false

	var next_tide_progress: Variant = _validated_tide_progress(
		save_data.get("tide_valve_progress")
	)
	if next_tide_progress == null:
		return false
	if bool(next_tide_balanced) != (next_tide_progress.size() == TIDE_VALVE_ORDER.size()):
		return false
	if not next_tide_progress.is_empty() and not bool(next_power):
		return false

	var next_bellman: Variant = save_data.get("bellman_state")
	if typeof(next_bellman) != TYPE_STRING or not BELLMAN_STATES.has(next_bellman):
		return false
	if str(next_bellman) != "dormant" and not bool(next_tide_balanced):
		return false
	if str(next_bellman) == "banished" and not bool(next_spool_assembled):
		return false
	for door_id in DOOR_KEYS:
		if _count_in_inventory(next_inventory, str(DOOR_KEYS[door_id])) > 1:
			return false
		if (
			bool(next_doors[door_id])
			and _count_in_inventory(next_inventory, str(DOOR_KEYS[door_id])) != 1
		):
			return false
	var purge_prerequisites_met: bool = (
		bool(next_power)
		and bool(next_spool_assembled)
		and bool(next_tide_balanced)
		and bool(next_doors["purge_vault"])
		and str(next_bellman) == "banished"
	)
	if _any_true(next_breakers) and not purge_prerequisites_met:
		return false
	if bool(next_victory) != _all_true(next_breakers):
		return false
	if bool(next_victory) and str(next_bellman) != "banished":
		return false

	var next_lore: Variant = _validated_lore(save_data.get("lore_flags"))
	if next_lore == null:
		return false
	var next_exterior: Dictionary = {}
	for field_name in EXTERIOR_SAVE_FIELDS:
		var raw_value: Variant = save_data.get(field_name)
		if typeof(raw_value) != TYPE_BOOL:
			return false
		next_exterior[field_name] = bool(raw_value)
	for field_index in range(1, EXTERIOR_OPENING_FIELDS.size()):
		var field_name: String = EXTERIOR_OPENING_FIELDS[field_index]
		var prerequisite_name: String = EXTERIOR_OPENING_FIELDS[field_index - 1]
		if bool(next_exterior[field_name]) and not bool(next_exterior[prerequisite_name]):
			return false
	if bool(next_exterior["exterior_escape_unlocked"]) and not bool(next_victory):
		return false
	if (
		bool(next_exterior["exterior_returned"])
		and not bool(next_exterior["exterior_escape_unlocked"])
	):
		return false
	var next_final_radio: Variant = save_data.get("final_radio_choice")
	if typeof(next_final_radio) != TYPE_STRING:
		return false
	if not str(next_final_radio).is_empty():
		if (
			not FINAL_RADIO_CHOICES.has(next_final_radio)
			or not bool(next_exterior["exterior_returned"])
		):
			return false

	# All validation is complete. Commit the candidate atomically from this point.
	inventory.clear()
	for slot in next_inventory:
		inventory.append(slot.duplicate(true))
	health = next_health
	magazine = next_magazine
	installed_fuses = next_fuses.duplicate(true)
	power_online = bool(next_power)
	spool_fragments_found = next_fragments.duplicate(true)
	spool_assembled = bool(next_spool_assembled)
	tide_valve_progress.clear()
	for valve_id in next_tide_progress:
		tide_valve_progress.append(str(valve_id))
	tide_balanced = bool(next_tide_balanced)
	tide_reset_count = next_reset_count
	doors_unlocked = next_doors.duplicate(true)
	purge_breakers_active = next_breakers.duplicate(true)
	bellman_state = str(next_bellman)
	lore_flags.clear()
	for lore_id in next_lore:
		lore_flags[str(lore_id)] = true
	victory = bool(next_victory)
	for field_name in EXTERIOR_SAVE_FIELDS:
		set(field_name, bool(next_exterior[field_name]))
	final_radio_choice = str(next_final_radio)
	return true


func _validated_inventory(raw_inventory: Variant) -> Variant:
	if typeof(raw_inventory) != TYPE_ARRAY or raw_inventory.size() != INVENTORY_SIZE:
		return null
	var result: Array[Dictionary] = []
	for raw_slot in raw_inventory:
		if typeof(raw_slot) != TYPE_DICTIONARY:
			return null
		if raw_slot.is_empty():
			result.append({})
			continue
		if raw_slot.size() != 2 or not raw_slot.has("id") or not raw_slot.has("count"):
			return null
		var item_id: Variant = raw_slot["id"]
		var count: int = _whole_number(raw_slot["count"])
		if typeof(item_id) != TYPE_STRING or not ITEM_RULES.has(item_id):
			return null
		var max_stack: int = int(ITEM_RULES[item_id]["max_stack"])
		if count <= 0 or count > max_stack:
			return null
		result.append({"id": str(item_id), "count": count})
	return result


func _count_in_inventory(candidate_inventory: Variant, item_id: String) -> int:
	var total: int = 0
	for slot in candidate_inventory:
		if slot.get("id", "") == item_id:
			total += int(slot.get("count", 0))
	return total


func _validated_bool_map(raw_map: Variant, expected_keys: Variant) -> Variant:
	if typeof(raw_map) != TYPE_DICTIONARY or raw_map.size() != expected_keys.size():
		return null
	var result: Dictionary = {}
	for key in expected_keys:
		if not raw_map.has(key) or typeof(raw_map[key]) != TYPE_BOOL:
			return null
		result[str(key)] = bool(raw_map[key])
	return result


func _validated_tide_progress(raw_progress: Variant) -> Variant:
	if typeof(raw_progress) != TYPE_ARRAY or raw_progress.size() > TIDE_VALVE_ORDER.size():
		return null
	var result: Array[String] = []
	for progress_index in range(raw_progress.size()):
		if (
			typeof(raw_progress[progress_index]) != TYPE_STRING
			or raw_progress[progress_index] != TIDE_VALVE_ORDER[progress_index]
		):
			return null
		result.append(str(raw_progress[progress_index]))
	return result


func _validated_lore(raw_lore: Variant) -> Variant:
	if typeof(raw_lore) != TYPE_ARRAY:
		return null
	var result: Array[String] = []
	for lore_id in raw_lore:
		if typeof(lore_id) != TYPE_STRING or not LORE_IDS.has(lore_id) or result.has(lore_id):
			return null
		result.append(str(lore_id))
	return result


func _whole_number(value: Variant) -> int:
	if typeof(value) == TYPE_INT:
		return int(value)
	if typeof(value) == TYPE_FLOAT and is_finite(float(value)) and float(value) == floor(float(value)):
		return int(value)
	return -1


func _all_true(values: Dictionary) -> bool:
	for value in values.values():
		if not bool(value):
			return false
	return not values.is_empty()


func _any_true(values: Dictionary) -> bool:
	for value in values.values():
		if bool(value):
			return true
	return false


func _false_map(keys: Variant) -> Dictionary:
	var result: Dictionary = {}
	for key in keys:
		result[str(key)] = false
	return result
