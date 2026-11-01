extends SceneTree

const UI := preload("res://scripts/ui.gd")
const SETTINGS_PATH := "user://hushpoint_settings.cfg"
const TEST_PROFILE_ENV := "HUSHPOINT_TEST_PROFILE"

var assertions: int = 0
var failures: int = 0
var preserved_settings := PackedByteArray()
var had_settings: bool = false


func _initialize() -> void:
	if not _using_isolated_test_profile():
		printerr("HUSHPOINT SETTINGS TESTS: REFUSED (run through test.ps1 so user:// is isolated)")
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
	_preserve_and_clear_settings()

	var first = await _new_ui()
	first.call("_toggle_title_controls")
	_check(first.title_controls_card.visible, "title must expose accessibility controls before play")
	first.title_shake_toggle.button_pressed = true
	first.title_flash_toggle.button_pressed = true
	_check(FileAccess.file_exists(SETTINGS_PATH), "title toggles must persist settings immediately")
	first.queue_free()
	await process_frame

	var second = await _new_ui()
	_check(bool(second.reduced_shake), "reduced camera shake must survive UI recreation")
	_check(bool(second.reduced_flashes), "reduced hard flashes must survive UI recreation")
	_check(second.title_shake_toggle.button_pressed, "title camera toggle must reflect the persisted value")
	_check(second.title_flash_toggle.button_pressed, "title flash toggle must reflect the persisted value")
	_check(second.shake_toggle.button_pressed, "pause camera toggle must stay synchronized")
	_check(second.flash_toggle.button_pressed, "pause flash toggle must stay synchronized")
	second.title_shake_toggle.button_pressed = false
	second.title_flash_toggle.button_pressed = false
	second.queue_free()
	await process_frame

	var third = await _new_ui()
	_check(not bool(third.reduced_shake), "disabled camera setting must persist")
	_check(not bool(third.reduced_flashes), "disabled flash setting must persist")
	third.queue_free()
	await process_frame

	_restore_settings()
	if failures == 0:
		print("HUSHPOINT SETTINGS TESTS: PASS (%d assertions)" % assertions)
		quit(0)
	else:
		printerr("HUSHPOINT SETTINGS TESTS: FAIL (%d failures, %d assertions)" % [failures, assertions])
		quit(1)


func _new_ui():
	var instance = UI.new()
	root.add_child(instance)
	await process_frame
	await process_frame
	return instance


func _check(condition: bool, message: String) -> void:
	assertions += 1
	if condition:
		return
	failures += 1
	printerr("  FAIL  %s" % message)


func _preserve_and_clear_settings() -> void:
	if FileAccess.file_exists(SETTINGS_PATH):
		had_settings = true
		var file := FileAccess.open(SETTINGS_PATH, FileAccess.READ)
		if file != null:
			preserved_settings = file.get_buffer(file.get_length())
			file.close()
	_remove_settings()


func _restore_settings() -> void:
	_remove_settings()
	if not had_settings:
		return
	var file := FileAccess.open(SETTINGS_PATH, FileAccess.WRITE)
	if file == null:
		failures += 1
		printerr("  FAIL  could not restore prior accessibility settings")
		return
	file.store_buffer(preserved_settings)
	file.close()


func _remove_settings() -> void:
	if not FileAccess.file_exists(SETTINGS_PATH):
		return
	var error := DirAccess.remove_absolute(ProjectSettings.globalize_path(SETTINGS_PATH))
	if error != OK:
		failures += 1
		printerr("  FAIL  could not remove test settings (error %d)" % error)
