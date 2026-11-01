class_name HushpointUI
extends CanvasLayer

## Original, code-built interface for the HUSHPOINT vertical slice.
## The orchestrator owns game state; this layer only presents it and emits intent.

signal new_game_requested
signal continue_requested
signal quit_requested
signal intro_finished
signal resume_requested
signal restart_requested
signal menu_requested
signal overlay_closed
signal settings_changed(reduced_shake: bool, reduced_flashes: bool)

enum ScreenMode {
	TITLE,
	INTRO,
	GAMEPLAY,
	INVENTORY,
	LORE,
	PAUSE,
	DEATH,
	VICTORY,
}

const INK := Color("071015")
const DEEP_INK := Color("03080b")
const PANEL := Color("101a1f")
const PANEL_LIGHT := Color("17262c")
const PAPER := Color("d8ddd6")
const MUTED := Color("87969a")
const CYAN := Color("64d4d0")
const CYAN_DIM := Color("2d7777")
const AMBER := Color("dca85f")
const RED := Color("cc554b")
const GREEN := Color("75b78f")
const LINE := Color("34474c")

const SETTINGS_PATH := "user://hushpoint_settings.cfg"
const SETTINGS_SECTION := "accessibility"

const ITEM_NAMES := {
	"handgun_ammo": "9 mm cartridges",
	"healing_wrap": "Pressure wrap",
	"noise_decoy": "Resonance decoy",
	"fuse_15a": "15 A ceramic fuse",
	"fuse_20a": "20 A ceramic fuse",
	"fuse_30a": "30 A ceramic fuse",
	"spool_a": "Archive spool / A",
	"spool_b": "Archive spool / B",
	"spool_c": "Archive spool / C",
	"service_key": "Service key",
	"records_key": "Records annex key",
	"harmonic_key": "Harmonic key",
}

const ITEM_DESCRIPTIONS := {
	"handgun_ammo": "Limited issue. Every shot carries through the station.",
	"healing_wrap": "A sealed compression dressing for serious wounds.",
	"noise_decoy": "A wound transducer that draws anything listening nearby.",
	"fuse_15a": "Stamped 15 A. One of the emergency panel's paired ratings.",
	"fuse_20a": "Stamped 20 A. The contacts are clean, but the rating may be wrong.",
	"fuse_30a": "Stamped 30 A. One of the emergency panel's paired ratings.",
	"spool_a": "The opening of Mara Orr's damaged counterflow recording.",
	"spool_b": "A middle section, warped by prolonged water exposure.",
	"spool_c": "The final section of the recording. A voice sits beneath the static.",
	"service_key": "A brass key tagged SERVICE ACCESS.",
	"records_key": "A narrow key tagged RECORDS ANNEX.",
	"harmonic_key": "A vesperite key that trembles near the lower vault.",
}

const INTRO_PAGES: Array[Dictionary] = [
	{
		"index": "CALL-OUT 03-117 / 21:43",
		"title": "Twenty-three centimetres should be a boring problem.",
		"body": "A north-gate sensor at Hushpoint disagrees with the harbor tide staff. Field engineer Lena Orr is nearby and certified on its legacy relay. Compare the readings, reset R-4, file the paper sheet, and leave the gate controls untouched.",
		"note": "STORM-SURGE WATCH  /  NO PUBLIC HAZARD REPORTED",
	},
]

var mode: ScreenMode = ScreenMode.TITLE
var intro_page: int = 0
var current_inventory_tab: int = 0
var reduced_shake: bool = false
var reduced_flashes: bool = false

var title_screen: Control
var intro_screen: Control
var hud_screen: Control
var inventory_screen: Control
var lore_screen: Control
var pause_screen: Control
var death_screen: Control
var victory_screen: Control
var screens: Array[Control] = []

var start_button: Button
var continue_button: Button
var intro_index_label: Label
var intro_title_label: Label
var intro_body_label: Label
var intro_note_label: Label
var intro_back_button: Button
var intro_next_button: Button
var intro_progress: HBoxContainer

var objective_label: Label
var health_mark: PanelContainer
var health_label: Label
var ammo_label: Label
var reserve_label: Label
var ammo_panel: PanelContainer
var slots_label: Label
var prompt_panel: PanelContainer
var prompt_label: Label
var crosshair: Control
var crosshair_parts: Array[ColorRect] = []
var noise_meter: ProgressBar
var lamp_meter: ProgressBar

var inventory_content: VBoxContainer
var inventory_tab_buttons: Array[Button] = []
var cached_state: Variant
var cached_objective: String = ""
var cached_lore_entries: Array = []

var lore_title_label: Label
var lore_body_label: RichTextLabel
var pause_controls: VBoxContainer
var title_controls_card: PanelContainer
var title_shake_toggle: CheckButton
var title_flash_toggle: CheckButton
var shake_toggle: CheckButton
var flash_toggle: CheckButton
var victory_stats_label: Label
var victory_ending_label: Label

var vignette: ColorRect
var damage_overlay: ColorRect
var notice_panel: PanelContainer
var notice_label: Label
var notice_tween: Tween
var radio_panel: PanelContainer
var radio_speaker_label: Label
var radio_text_label: Label
var radio_tween: Tween


func _ready() -> void:
	layer = 30
	process_mode = Node.PROCESS_MODE_ALWAYS
	_build_interface()
	_load_settings()
	_sync_setting_controls()
	call_deferred("_emit_loaded_settings")
	show_title(false)


func _build_interface() -> void:
	var root := Control.new()
	root.name = "Interface"
	root.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	add_child(root)

	title_screen = _screen(root, "Title")
	intro_screen = _screen(root, "Intro")
	hud_screen = _screen(root, "HUD")
	inventory_screen = _screen(root, "Inventory")
	lore_screen = _screen(root, "Lore")
	pause_screen = _screen(root, "Pause")
	death_screen = _screen(root, "Death")
	victory_screen = _screen(root, "Victory")
	screens = [title_screen, intro_screen, hud_screen, inventory_screen, lore_screen, pause_screen, death_screen, victory_screen]

	_build_title()
	_build_intro()
	_build_hud()
	_build_inventory()
	_build_lore()
	_build_pause()
	_build_death()
	_build_victory()
	_build_global_effects(root)


func _screen(parent: Control, screen_name: String) -> Control:
	var screen := Control.new()
	screen.name = screen_name
	screen.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	screen.visible = false
	parent.add_child(screen)
	return screen


func _build_title() -> void:
	_add_atmospheric_backdrop(title_screen, CYAN_DIM)

	var top_rule := ColorRect.new()
	top_rule.color = CYAN
	top_rule.set_anchors_preset(Control.PRESET_TOP_WIDE)
	top_rule.offset_bottom = 3.0
	title_screen.add_child(top_rule)

	var margin := MarginContainer.new()
	margin.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_set_margins(margin, 68, 48, 68, 48)
	title_screen.add_child(margin)

	var columns := HBoxContainer.new()
	columns.add_theme_constant_override("separation", 70)
	margin.add_child(columns)

	var identity := VBoxContainer.new()
	identity.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	identity.size_flags_vertical = Control.SIZE_EXPAND_FILL
	identity.alignment = BoxContainer.ALIGNMENT_CENTER
	identity.add_theme_constant_override("separation", 10)
	columns.add_child(identity)

	var facility := _label("HPT / TIDAL CONTROL FACILITY 03", 14, CYAN)
	facility.add_theme_constant_override("letter_spacing", 3)
	identity.add_child(facility)

	var title := _label("HUSHPOINT", 70, PAPER)
	title.add_theme_constant_override("letter_spacing", 8)
	identity.add_child(title)

	var subtitle := _label("KINMOUTH COASTAL BARRIER / CALL-OUT 03-117", 14, MUTED)
	subtitle.add_theme_constant_override("letter_spacing", 2)
	identity.add_child(subtitle)

	var divider := ColorRect.new()
	divider.color = LINE
	divider.custom_minimum_size = Vector2(420, 1)
	identity.add_child(divider)

	var premise := _label(
		"A routine sensor discrepancy. A paper gauge that refuses to lie.\n"
		+ "Clock in, verify the reading, and go home.",
		17,
		Color(PAPER, 0.78)
	)
	premise.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	premise.custom_minimum_size = Vector2(460, 70)
	identity.add_child(premise)

	var status := HBoxContainer.new()
	status.add_theme_constant_override("separation", 10)
	identity.add_child(status)
	var status_dot := PanelContainer.new()
	status_dot.custom_minimum_size = Vector2(10, 10)
	status_dot.add_theme_stylebox_override("panel", _panel_style(AMBER, AMBER, 0, 5))
	status.add_child(status_dot)
	status.add_child(_label("REMOTE CARRIER DETECTED  /  21:43", 13, AMBER))

	var menu_column := VBoxContainer.new()
	menu_column.custom_minimum_size = Vector2(320, 0)
	menu_column.size_flags_vertical = Control.SIZE_EXPAND_FILL
	menu_column.alignment = BoxContainer.ALIGNMENT_CENTER
	menu_column.add_theme_constant_override("separation", 12)
	columns.add_child(menu_column)

	var menu_header := _label("STATION ACCESS", 12, MUTED)
	menu_header.add_theme_constant_override("letter_spacing", 3)
	menu_column.add_child(menu_header)

	start_button = _button("BEGIN SERVICE CALL", _on_new_game, true)
	menu_column.add_child(start_button)
	continue_button = _button("CONTINUE FROM SAFE ROOM", _on_continue)
	menu_column.add_child(continue_button)
	menu_column.add_child(_button("CONTROLS + ACCESSIBILITY", _toggle_title_controls))
	menu_column.add_child(_button("LEAVE HUSHPOINT", _on_quit))

	title_controls_card = PanelContainer.new()
	title_controls_card.name = "ControlsCard"
	title_controls_card.visible = false
	title_controls_card.add_theme_stylebox_override("panel", _panel_style(Color("d90b1216"), LINE, 1, 3))
	menu_column.add_child(title_controls_card)
	var controls_margin := MarginContainer.new()
	_set_margins(controls_margin, 14, 12, 14, 12)
	title_controls_card.add_child(controls_margin)
	var controls_stack := VBoxContainer.new()
	controls_stack.add_theme_constant_override("separation", 6)
	controls_margin.add_child(controls_stack)
	var control_text := _label(
		"WASD  MOVE     SHIFT  SPRINT\n"
		+ "CTRL  CROUCH  RMB  AIM\n"
		+ "LMB  FIRE      E  INTERACT\n"
		+ "TAB  CASE      ESC  PAUSE\n"
		+ "F  LAMP        Q  QUICK TURN",
		13,
		Color(PAPER, 0.78)
	)
	control_text.custom_minimum_size = Vector2(280, 106)
	control_text.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	control_text.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	controls_stack.add_child(control_text)
	var accessibility_header := _label("ACCESSIBILITY", 11, CYAN)
	accessibility_header.add_theme_constant_override("letter_spacing", 2)
	controls_stack.add_child(accessibility_header)
	title_shake_toggle = _check_button("REDUCE CAMERA SHAKE")
	title_shake_toggle.toggled.connect(_on_shake_toggled)
	controls_stack.add_child(title_shake_toggle)
	title_flash_toggle = _check_button("REDUCE HARD FLASHES")
	title_flash_toggle.toggled.connect(_on_flash_toggled)
	controls_stack.add_child(title_flash_toggle)
	var accessibility_note := _label("Saved automatically. Subtitles and visual interaction cues stay enabled.", 11, MUTED)
	accessibility_note.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	controls_stack.add_child(accessibility_note)

	var version := _label("ORIGINAL VERTICAL SLICE  /  GODOT DESKTOP BUILD", 11, Color(MUTED, 0.65))
	version.set_anchors_preset(Control.PRESET_BOTTOM_LEFT)
	version.position = Vector2(24, -30)
	title_screen.add_child(version)


func _build_intro() -> void:
	_add_atmospheric_backdrop(intro_screen, AMBER)
	var margin := MarginContainer.new()
	margin.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_set_margins(margin, 110, 72, 110, 66)
	intro_screen.add_child(margin)

	var card := PanelContainer.new()
	card.add_theme_stylebox_override("panel", _panel_style(Color("ec0b1115"), Color(CYAN, 0.45), 1, 2))
	margin.add_child(card)

	var content_margin := MarginContainer.new()
	_set_margins(content_margin, 54, 42, 54, 36)
	card.add_child(content_margin)
	var stack := VBoxContainer.new()
	stack.add_theme_constant_override("separation", 18)
	content_margin.add_child(stack)

	var header := HBoxContainer.new()
	stack.add_child(header)
	intro_index_label = _label("", 13, CYAN)
	intro_index_label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	header.add_child(intro_index_label)
	header.add_child(_label("LENA ORR  /  PERSONAL RECORDER", 12, MUTED))

	var rule := ColorRect.new()
	rule.color = LINE
	rule.custom_minimum_size.y = 1
	stack.add_child(rule)

	intro_title_label = _label("", 38, PAPER)
	intro_title_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	intro_title_label.custom_minimum_size.y = 58
	stack.add_child(intro_title_label)

	intro_body_label = _label("", 20, Color(PAPER, 0.86))
	intro_body_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	intro_body_label.size_flags_vertical = Control.SIZE_EXPAND_FILL
	intro_body_label.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	stack.add_child(intro_body_label)

	intro_note_label = _label("", 13, AMBER)
	intro_note_label.add_theme_constant_override("letter_spacing", 2)
	stack.add_child(intro_note_label)

	intro_progress = HBoxContainer.new()
	intro_progress.add_theme_constant_override("separation", 8)
	stack.add_child(intro_progress)
	for page_index in INTRO_PAGES.size():
		var marker := ColorRect.new()
		marker.custom_minimum_size = Vector2(42, 3)
		marker.color = LINE
		intro_progress.add_child(marker)

	var actions := HBoxContainer.new()
	actions.add_theme_constant_override("separation", 12)
	stack.add_child(actions)
	intro_back_button = _button("BACK", _intro_back)
	actions.add_child(intro_back_button)
	var spacer := Control.new()
	spacer.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	actions.add_child(spacer)
	actions.add_child(_button("SKIP BRIEFING", _finish_intro))
	intro_next_button = _button("CONTINUE", _intro_next, true)
	intro_next_button.custom_minimum_size.x = 190
	actions.add_child(intro_next_button)


func _build_hud() -> void:
	hud_screen.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var safe_margin := MarginContainer.new()
	safe_margin.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_set_margins(safe_margin, 28, 24, 28, 28)
	safe_margin.mouse_filter = Control.MOUSE_FILTER_IGNORE
	hud_screen.add_child(safe_margin)
	# Anchors are only meaningful under a plain Control. A MarginContainer
	# otherwise stretches every HUD group over the same rectangle.
	var safe := Control.new()
	safe.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	safe.mouse_filter = Control.MOUSE_FILTER_IGNORE
	safe_margin.add_child(safe)

	var objective_panel := PanelContainer.new()
	objective_panel.set_anchors_preset(Control.PRESET_TOP_LEFT)
	objective_panel.custom_minimum_size = Vector2(430, 70)
	objective_panel.add_theme_stylebox_override("panel", _panel_style(Color("c90a1115"), Color(CYAN, 0.35), 1, 2))
	safe.add_child(objective_panel)
	var objective_margin := MarginContainer.new()
	_set_margins(objective_margin, 16, 10, 16, 9)
	objective_panel.add_child(objective_margin)
	var objective_stack := VBoxContainer.new()
	objective_stack.add_theme_constant_override("separation", 2)
	objective_margin.add_child(objective_stack)
	objective_stack.add_child(_label("CURRENT TASK", 10, CYAN))
	objective_label = _label("ENTER HUSHPOINT", 16, PAPER)
	objective_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	objective_stack.add_child(objective_label)

	var system_panel := PanelContainer.new()
	system_panel.set_anchors_preset(Control.PRESET_TOP_RIGHT)
	system_panel.grow_horizontal = Control.GROW_DIRECTION_BEGIN
	system_panel.custom_minimum_size = Vector2(250, 86)
	system_panel.add_theme_stylebox_override("panel", _panel_style(Color("c90a1115"), LINE, 1, 2))
	safe.add_child(system_panel)
	var system_margin := MarginContainer.new()
	_set_margins(system_margin, 14, 10, 14, 10)
	system_panel.add_child(system_margin)
	var systems := VBoxContainer.new()
	systems.add_theme_constant_override("separation", 5)
	system_margin.add_child(systems)
	var noise_line := HBoxContainer.new()
	noise_line.add_child(_small_status_label("NOISE"))
	noise_meter = _meter(CYAN)
	noise_line.add_child(noise_meter)
	systems.add_child(noise_line)
	var lamp_line := HBoxContainer.new()
	lamp_line.add_child(_small_status_label("LAMP"))
	lamp_meter = _meter(AMBER)
	lamp_line.add_child(lamp_meter)
	systems.add_child(lamp_line)
	slots_label = _label("CASE  0 / 6", 11, MUTED)
	slots_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	systems.add_child(slots_label)

	var health_group := HBoxContainer.new()
	health_group.set_anchors_preset(Control.PRESET_BOTTOM_LEFT)
	health_group.grow_vertical = Control.GROW_DIRECTION_BEGIN
	health_group.add_theme_constant_override("separation", 10)
	safe.add_child(health_group)
	health_mark = PanelContainer.new()
	health_mark.custom_minimum_size = Vector2(12, 44)
	health_mark.add_theme_stylebox_override("panel", _panel_style(GREEN, GREEN, 0, 1))
	health_group.add_child(health_mark)
	var health_stack := VBoxContainer.new()
	health_stack.add_theme_constant_override("separation", 0)
	health_group.add_child(health_stack)
	health_stack.add_child(_label("CONDITION", 10, MUTED))
	health_label = _label("STABLE", 18, GREEN)
	health_stack.add_child(health_label)

	ammo_panel = PanelContainer.new()
	ammo_panel.set_anchors_preset(Control.PRESET_BOTTOM_RIGHT)
	ammo_panel.grow_horizontal = Control.GROW_DIRECTION_BEGIN
	ammo_panel.grow_vertical = Control.GROW_DIRECTION_BEGIN
	ammo_panel.custom_minimum_size = Vector2(180, 76)
	ammo_panel.add_theme_stylebox_override("panel", _panel_style(Color("c90a1115"), LINE, 1, 2))
	safe.add_child(ammo_panel)
	var ammo_margin := MarginContainer.new()
	_set_margins(ammo_margin, 15, 9, 15, 9)
	ammo_panel.add_child(ammo_margin)
	var ammo_row := HBoxContainer.new()
	ammo_row.alignment = BoxContainer.ALIGNMENT_END
	ammo_row.add_theme_constant_override("separation", 9)
	ammo_margin.add_child(ammo_row)
	var ammo_stack := VBoxContainer.new()
	ammo_stack.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	ammo_row.add_child(ammo_stack)
	ammo_stack.add_child(_label("SIDEARM", 10, MUTED))
	reserve_label = _label("RESERVE  0", 11, Color(PAPER, 0.7))
	ammo_stack.add_child(reserve_label)
	ammo_label = _label("06", 36, PAPER)
	ammo_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	ammo_row.add_child(ammo_label)

	prompt_panel = PanelContainer.new()
	prompt_panel.set_anchors_preset(Control.PRESET_BOTTOM_WIDE)
	prompt_panel.grow_vertical = Control.GROW_DIRECTION_BEGIN
	prompt_panel.offset_left = 380
	prompt_panel.offset_right = -380
	prompt_panel.offset_bottom = -8
	prompt_panel.custom_minimum_size.y = 44
	prompt_panel.add_theme_stylebox_override("panel", _panel_style(Color("df071015"), Color(CYAN, 0.45), 1, 2))
	prompt_panel.visible = false
	safe.add_child(prompt_panel)
	prompt_label = _label("", 14, PAPER)
	prompt_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	prompt_label.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	prompt_panel.add_child(prompt_label)

	crosshair = Control.new()
	crosshair.name = "Crosshair"
	crosshair.set_anchors_preset(Control.PRESET_CENTER)
	crosshair.position = Vector2(-1, -1)
	crosshair.visible = false
	crosshair.mouse_filter = Control.MOUSE_FILTER_IGNORE
	hud_screen.add_child(crosshair)
	_add_crosshair_line(Vector2(-17, -1), Vector2(8, 2))
	_add_crosshair_line(Vector2(9, -1), Vector2(8, 2))
	_add_crosshair_line(Vector2(-1, -17), Vector2(2, 8))
	_add_crosshair_line(Vector2(-1, 9), Vector2(2, 8))


func _build_inventory() -> void:
	_add_dim(inventory_screen, 0.86)
	var margin := MarginContainer.new()
	margin.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_set_margins(margin, 72, 48, 72, 48)
	inventory_screen.add_child(margin)

	var frame := PanelContainer.new()
	frame.add_theme_stylebox_override("panel", _panel_style(Color("fa0a1115"), Color(CYAN, 0.42), 1, 2))
	margin.add_child(frame)
	var frame_margin := MarginContainer.new()
	_set_margins(frame_margin, 28, 22, 28, 20)
	frame.add_child(frame_margin)
	var layout := VBoxContainer.new()
	layout.add_theme_constant_override("separation", 14)
	frame_margin.add_child(layout)

	var header := HBoxContainer.new()
	layout.add_child(header)
	var title_stack := VBoxContainer.new()
	title_stack.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	header.add_child(title_stack)
	title_stack.add_child(_label("FIELD CASE", 28, PAPER))
	title_stack.add_child(_label("LENA ORR  /  HUSHPOINT ACCESS LOG", 11, MUTED))
	var close_button := _button("CLOSE  [TAB]", _close_overlay)
	close_button.custom_minimum_size.x = 150
	header.add_child(close_button)

	var tabs := HBoxContainer.new()
	tabs.add_theme_constant_override("separation", 8)
	layout.add_child(tabs)
	for tab_data in [["INVENTORY", 0], ["FILES", 1], ["OBJECTIVES", 2]]:
		var tab := _button(tab_data[0], _select_inventory_tab.bind(tab_data[1]))
		tab.toggle_mode = true
		tab.custom_minimum_size.x = 150
		tabs.add_child(tab)
		inventory_tab_buttons.append(tab)

	var rule := ColorRect.new()
	rule.color = LINE
	rule.custom_minimum_size.y = 1
	layout.add_child(rule)

	var scroll := ScrollContainer.new()
	scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	layout.add_child(scroll)
	inventory_content = VBoxContainer.new()
	inventory_content.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	inventory_content.add_theme_constant_override("separation", 10)
	scroll.add_child(inventory_content)

	var footer := HBoxContainer.new()
	layout.add_child(footer)
	footer.add_child(_label("E / SELECT      Q / QUICK TURN      H / USE WRAP", 11, MUTED))
	var footer_spacer := Control.new()
	footer_spacer.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	footer.add_child(footer_spacer)
	footer.add_child(_label("THE CASE HOLDS SIX STACKS", 11, CYAN))


func _build_lore() -> void:
	_add_dim(lore_screen, 0.91)
	var margin := MarginContainer.new()
	margin.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_set_margins(margin, 180, 66, 180, 66)
	lore_screen.add_child(margin)
	var page := PanelContainer.new()
	page.add_theme_stylebox_override("panel", _panel_style(Color("f7d5d8d1"), Color("718085"), 1, 1))
	margin.add_child(page)
	var page_margin := MarginContainer.new()
	_set_margins(page_margin, 50, 40, 50, 32)
	page.add_child(page_margin)
	var stack := VBoxContainer.new()
	stack.add_theme_constant_override("separation", 14)
	page_margin.add_child(stack)
	var document_type := _label("RECOVERED STATION RECORD", 11, Color("394b4e"))
	document_type.add_theme_constant_override("letter_spacing", 3)
	stack.add_child(document_type)
	lore_title_label = _label("", 32, Color("111a1c"))
	lore_title_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	stack.add_child(lore_title_label)
	var paper_rule := ColorRect.new()
	paper_rule.color = Color("788588")
	paper_rule.custom_minimum_size.y = 1
	stack.add_child(paper_rule)
	lore_body_label = RichTextLabel.new()
	lore_body_label.bbcode_enabled = true
	lore_body_label.fit_content = false
	lore_body_label.scroll_active = true
	lore_body_label.size_flags_vertical = Control.SIZE_EXPAND_FILL
	lore_body_label.add_theme_font_size_override("normal_font_size", 18)
	lore_body_label.add_theme_color_override("default_color", Color("1c292b"))
	lore_body_label.add_theme_constant_override("line_separation", 7)
	stack.add_child(lore_body_label)
	var paper_footer := HBoxContainer.new()
	stack.add_child(paper_footer)
	paper_footer.add_child(_label("ARCHIVED BY PROJECT PALINODE", 10, Color("566568")))
	var footer_spacer := Control.new()
	footer_spacer.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	paper_footer.add_child(footer_spacer)
	var close := _button("CLOSE RECORD  [E]", _close_overlay, true)
	close.custom_minimum_size.x = 190
	paper_footer.add_child(close)


func _build_pause() -> void:
	_add_dim(pause_screen, 0.75)
	var card := PanelContainer.new()
	card.set_anchors_preset(Control.PRESET_CENTER)
	card.position = Vector2(-260, -270)
	card.custom_minimum_size = Vector2(520, 540)
	card.add_theme_stylebox_override("panel", _panel_style(Color("fa0a1115"), Color(CYAN, 0.45), 1, 2))
	pause_screen.add_child(card)
	var margin := MarginContainer.new()
	_set_margins(margin, 34, 28, 34, 28)
	card.add_child(margin)
	pause_controls = VBoxContainer.new()
	pause_controls.add_theme_constant_override("separation", 12)
	margin.add_child(pause_controls)
	pause_controls.add_child(_label("SYSTEM PAUSED", 28, PAPER))
	pause_controls.add_child(_label("HUSHPOINT TIDAL FACILITY  /  LOWER WORKS", 11, MUTED))
	var line := ColorRect.new()
	line.color = LINE
	line.custom_minimum_size.y = 1
	pause_controls.add_child(line)
	pause_controls.add_child(_button("RETURN TO STATION", _on_resume, true))

	var settings_header := _label("ACCESSIBILITY", 11, CYAN)
	settings_header.add_theme_constant_override("letter_spacing", 2)
	pause_controls.add_child(settings_header)
	shake_toggle = _check_button("REDUCE CAMERA SHAKE")
	shake_toggle.toggled.connect(_on_shake_toggled)
	pause_controls.add_child(shake_toggle)
	flash_toggle = _check_button("REDUCE HARD FLASHES")
	flash_toggle.toggled.connect(_on_flash_toggled)
	pause_controls.add_child(flash_toggle)
	pause_controls.add_child(_label("Both settings can be changed at any time.\nSubtitles and visual interaction cues remain enabled.", 12, MUTED))

	var controls_header := _label("CONTROLS", 11, CYAN)
	controls_header.add_theme_constant_override("letter_spacing", 2)
	pause_controls.add_child(controls_header)
	var controls := _label("WASD MOVE   SHIFT SPRINT   CTRL CROUCH   RMB AIM\nLMB FIRE   E INTERACT   R RELOAD   TAB CASE   F LAMP", 12, Color(PAPER, 0.72))
	pause_controls.add_child(controls)
	var pause_spacer := Control.new()
	pause_spacer.size_flags_vertical = Control.SIZE_EXPAND_FILL
	pause_controls.add_child(pause_spacer)
	pause_controls.add_child(_button("RETURN TO TITLE", _on_menu))


func _build_death() -> void:
	_add_dim(death_screen, 0.88, Color("240807"))
	var stack := VBoxContainer.new()
	stack.set_anchors_preset(Control.PRESET_CENTER)
	stack.position = Vector2(-280, -160)
	stack.custom_minimum_size = Vector2(560, 320)
	stack.alignment = BoxContainer.ALIGNMENT_CENTER
	stack.add_theme_constant_override("separation", 16)
	death_screen.add_child(stack)
	var marker := _label("SIGNAL LOST", 12, RED)
	marker.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	marker.add_theme_constant_override("letter_spacing", 4)
	stack.add_child(marker)
	var title := _label("THE STATION KEPT YOUR VOICE", 32, PAPER)
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	stack.add_child(title)
	var copy := _label("Lena's recorder is still running somewhere below the tide line.", 15, MUTED)
	copy.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	stack.add_child(copy)
	var actions := HBoxContainer.new()
	actions.alignment = BoxContainer.ALIGNMENT_CENTER
	actions.add_theme_constant_override("separation", 12)
	stack.add_child(actions)
	actions.add_child(_button("RETRY CHECKPOINT", _on_restart, true))
	actions.add_child(_button("RETURN TO TITLE", _on_menu))


func _build_victory() -> void:
	_add_atmospheric_backdrop(victory_screen, CYAN)
	var margin := MarginContainer.new()
	margin.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_set_margins(margin, 135, 70, 135, 60)
	victory_screen.add_child(margin)
	var card := PanelContainer.new()
	card.add_theme_stylebox_override("panel", _panel_style(Color("ee091216"), Color(CYAN, 0.5), 1, 2))
	margin.add_child(card)
	var card_margin := MarginContainer.new()
	_set_margins(card_margin, 50, 38, 50, 34)
	card.add_child(card_margin)
	var stack := VBoxContainer.new()
	stack.alignment = BoxContainer.ALIGNMENT_CENTER
	stack.add_theme_constant_override("separation", 15)
	card_margin.add_child(stack)
	var eyebrow := _label("COUNTERFLOW COMPLETE", 12, CYAN)
	eyebrow.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	eyebrow.add_theme_constant_override("letter_spacing", 4)
	stack.add_child(eyebrow)
	var title := _label("THE WATER REMEMBERED", 38, PAPER)
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	stack.add_child(title)
	victory_ending_label = _label(
		"Lena reaches Truck Seven with the harbor still lit. The last decision is physical,\n"
		+ "not a voice in a speaker.",
		17,
		Color(PAPER, 0.82)
	)
	victory_ending_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	victory_ending_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	stack.add_child(victory_ending_label)
	var line := ColorRect.new()
	line.color = LINE
	line.custom_minimum_size = Vector2(600, 1)
	stack.add_child(line)
	victory_stats_label = _label("HUSHPOINT SEALED", 13, AMBER)
	victory_stats_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	stack.add_child(victory_stats_label)
	var victory_spacer := Control.new()
	victory_spacer.size_flags_vertical = Control.SIZE_EXPAND_FILL
	stack.add_child(victory_spacer)
	stack.add_child(_button("RETURN TO TITLE", _on_menu, true))


func _build_global_effects(root: Control) -> void:
	vignette = ColorRect.new()
	vignette.name = "Vignette"
	vignette.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	vignette.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var vignette_shader := Shader.new()
	vignette_shader.code = """
		shader_type canvas_item;
		uniform float strength = 0.72;
		void fragment() {
			vec2 p = SCREEN_UV * 2.0 - 1.0;
			float edge = smoothstep(0.32, 1.15, length(p * vec2(0.78, 1.0)));
			float scan = sin(SCREEN_UV.y * 920.0) * 0.007;
			COLOR = vec4(0.0, 0.02, 0.025, clamp(edge * strength + scan, 0.0, 0.82));
		}
	"""
	var vignette_material := ShaderMaterial.new()
	vignette_material.shader = vignette_shader
	vignette.material = vignette_material
	root.add_child(vignette)

	damage_overlay = ColorRect.new()
	damage_overlay.name = "Damage"
	damage_overlay.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	damage_overlay.color = Color(RED, 0.0)
	damage_overlay.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.add_child(damage_overlay)

	notice_panel = PanelContainer.new()
	notice_panel.name = "Notice"
	notice_panel.set_anchors_preset(Control.PRESET_TOP_WIDE)
	notice_panel.offset_left = 410
	notice_panel.offset_right = -410
	notice_panel.offset_top = 106
	notice_panel.custom_minimum_size.y = 42
	notice_panel.add_theme_stylebox_override("panel", _panel_style(Color("ec0a1115"), Color(AMBER, 0.55), 1, 2))
	notice_panel.modulate.a = 0.0
	notice_panel.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.add_child(notice_panel)
	notice_label = _label("", 13, PAPER)
	notice_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	notice_label.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	notice_panel.add_child(notice_label)

	radio_panel = PanelContainer.new()
	radio_panel.name = "RadioDialogue"
	radio_panel.set_anchors_preset(Control.PRESET_BOTTOM_WIDE)
	radio_panel.grow_vertical = Control.GROW_DIRECTION_BEGIN
	radio_panel.offset_left = 290
	radio_panel.offset_right = -290
	radio_panel.offset_bottom = -52
	radio_panel.custom_minimum_size.y = 92
	radio_panel.add_theme_stylebox_override("panel", _panel_style(Color("f20a1115"), Color(CYAN, 0.7), 1, 3))
	radio_panel.modulate.a = 0.0
	radio_panel.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.add_child(radio_panel)
	var radio_margin := MarginContainer.new()
	_set_margins(radio_margin, 18, 12, 18, 12)
	radio_panel.add_child(radio_margin)
	var radio_stack := VBoxContainer.new()
	radio_stack.add_theme_constant_override("separation", 5)
	radio_margin.add_child(radio_stack)
	radio_speaker_label = _label("", 11, CYAN)
	radio_speaker_label.add_theme_constant_override("letter_spacing", 2)
	radio_stack.add_child(radio_speaker_label)
	radio_text_label = _label("", 15, PAPER)
	radio_text_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	radio_stack.add_child(radio_text_label)


## Public API -----------------------------------------------------------------

func show_title(has_save: bool = false) -> void:
	mode = ScreenMode.TITLE
	_show_only(title_screen)
	_sync_setting_controls()
	continue_button.visible = has_save
	vignette.visible = true
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	if has_save:
		continue_button.call_deferred("grab_focus")
	else:
		start_button.call_deferred("grab_focus")


func show_intro() -> void:
	mode = ScreenMode.INTRO
	intro_page = 0
	_show_only(intro_screen)
	vignette.visible = true
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	_refresh_intro()
	intro_next_button.call_deferred("grab_focus")


func show_gameplay() -> void:
	mode = ScreenMode.GAMEPLAY
	_show_only(hud_screen)
	vignette.visible = true
	Input.mouse_mode = Input.MOUSE_MODE_CAPTURED


func update_hud(state: Variant, objective: String) -> void:
	if state == null:
		return
	objective_label.text = objective.to_upper()
	var health_value := _state_int(state, "health", 100)
	var condition := "STABLE"
	var health_color := GREEN
	if health_value <= 0:
		condition = "NO SIGNAL"
		health_color = RED
	elif health_value <= 30:
		condition = "CRITICAL"
		health_color = RED
	elif health_value <= 70:
		condition = "WOUNDED"
		health_color = AMBER
	health_label.text = condition
	health_label.add_theme_color_override("font_color", health_color)
	health_mark.add_theme_stylebox_override("panel", _panel_style(health_color, health_color, 0, 1))

	var magazine := _state_int(state, "magazine", 0)
	var has_handgun := _state_bool(state, "handgun_acquired", false)
	ammo_panel.visible = has_handgun
	ammo_label.text = "%02d" % magazine
	reserve_label.text = "RESERVE  %02d" % _item_count(state, "handgun_ammo")
	var occupied := _occupied_slots(state)
	slots_label.text = "CASE  %d / 6" % occupied


func set_prompt(text: String) -> void:
	var clean_text := text.strip_edges()
	prompt_panel.visible = not clean_text.is_empty()
	prompt_label.text = clean_text


func set_crosshair(visible_now: bool, confirmed_target: bool = false) -> void:
	crosshair.visible = visible_now
	var tint := AMBER if confirmed_target else PAPER
	for part in crosshair_parts:
		part.color = tint


func set_noise_level(value: float) -> void:
	noise_meter.value = clampf(value, 0.0, 100.0)


func set_lamp_heat(value: float) -> void:
	lamp_meter.value = clampf(value, 0.0, 100.0)
	if value >= 85.0:
		lamp_meter.add_theme_stylebox_override("fill", _panel_style(RED, RED, 0, 1))
	else:
		lamp_meter.add_theme_stylebox_override("fill", _panel_style(AMBER, AMBER, 0, 1))


func show_inventory(state: Variant, objective: String, lore_entries: Array) -> void:
	mode = ScreenMode.INVENTORY
	cached_state = state
	cached_objective = objective
	cached_lore_entries = lore_entries
	_show_only(inventory_screen)
	vignette.visible = true
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	_select_inventory_tab(0)
	inventory_tab_buttons[0].call_deferred("grab_focus")


func show_lore(title: String, body: String) -> void:
	mode = ScreenMode.LORE
	_show_only(lore_screen)
	vignette.visible = true
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	lore_title_label.text = title
	lore_body_label.text = _escape_bbcode(body)


func show_pause() -> void:
	mode = ScreenMode.PAUSE
	_show_only(pause_screen)
	vignette.visible = true
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	_sync_setting_controls()
	pause_controls.get_child(3).call_deferred("grab_focus")


func show_death() -> void:
	mode = ScreenMode.DEATH
	_show_only(death_screen)
	vignette.visible = true
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE


func show_victory(summary: String = "HUSHPOINT SEALED") -> void:
	mode = ScreenMode.VICTORY
	_show_only(victory_screen)
	victory_stats_label.text = summary.to_upper()
	if summary.begins_with("REHEARSAL BROKEN"):
		victory_ending_label.text = "Lena drives the radio through the truck-step and severs the predicted call.\nThe harbor lights hold. For the first time, PALINODE has no next line."
	elif summary.begins_with("REHEARSAL COMPLETE"):
		victory_ending_label.text = "Lena answers. Her own voice thanks her from seventeen minutes ahead.\nAcross Kinmouth, evacuation speakers wake and begin speaking as Lena Orr."
	vignette.visible = true
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE


func flash_damage() -> void:
	if reduced_flashes:
		damage_overlay.color.a = 0.0
		return
	damage_overlay.color = Color(RED, 0.34)
	var tween := create_tween()
	tween.set_pause_mode(Tween.TWEEN_PAUSE_PROCESS)
	tween.tween_property(damage_overlay, "color:a", 0.0, 0.46).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_OUT)


func show_notice(text: String) -> void:
	if notice_tween != null and notice_tween.is_valid():
		notice_tween.kill()
	notice_label.text = text.to_upper()
	notice_panel.modulate.a = 0.0
	notice_tween = create_tween()
	notice_tween.set_pause_mode(Tween.TWEEN_PAUSE_PROCESS)
	notice_tween.tween_property(notice_panel, "modulate:a", 1.0, 0.16)
	notice_tween.tween_interval(2.2)
	notice_tween.tween_property(notice_panel, "modulate:a", 0.0, 0.5)


func show_radio_line(speaker: String, text: String) -> void:
	if radio_tween != null and radio_tween.is_valid():
		radio_tween.kill()
	radio_speaker_label.text = speaker.to_upper()
	radio_text_label.text = text
	radio_panel.modulate.a = 0.0
	radio_tween = create_tween()
	radio_tween.set_pause_mode(Tween.TWEEN_PAUSE_PROCESS)
	radio_tween.tween_property(radio_panel, "modulate:a", 1.0, 0.18)
	radio_tween.tween_interval(3.8)
	radio_tween.tween_property(radio_panel, "modulate:a", 0.0, 0.5)


## Inventory rendering --------------------------------------------------------

func _select_inventory_tab(tab_index: int) -> void:
	current_inventory_tab = tab_index
	for index in inventory_tab_buttons.size():
		inventory_tab_buttons[index].button_pressed = index == tab_index
	_clear_children(inventory_content)
	match tab_index:
		0:
			_render_inventory()
		1:
			_render_files()
		2:
			_render_objectives()


func _render_inventory() -> void:
	var inventory := _inventory_snapshot(cached_state)
	var grid := GridContainer.new()
	grid.columns = 3
	grid.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	grid.add_theme_constant_override("h_separation", 10)
	grid.add_theme_constant_override("v_separation", 10)
	inventory_content.add_child(grid)

	for slot_index in 6:
		var slot: Dictionary = inventory[slot_index] if slot_index < inventory.size() else {}
		var slot_panel := PanelContainer.new()
		slot_panel.custom_minimum_size = Vector2(0, 150)
		var occupied := not slot.is_empty()
		slot_panel.add_theme_stylebox_override(
			"panel",
			_panel_style(Color("d9121d22") if occupied else Color("7d0d1519"), Color(CYAN, 0.34) if occupied else LINE, 1, 2)
		)
		grid.add_child(slot_panel)
		var margin := MarginContainer.new()
		_set_margins(margin, 14, 12, 14, 12)
		slot_panel.add_child(margin)
		var stack := VBoxContainer.new()
		stack.add_theme_constant_override("separation", 6)
		margin.add_child(stack)
		if occupied:
			var item_id := str(slot.get("id", ""))
			var top := HBoxContainer.new()
			stack.add_child(top)
			var name_label := _label(str(ITEM_NAMES.get(item_id, item_id.capitalize())), 15, PAPER)
			name_label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
			name_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
			top.add_child(name_label)
			top.add_child(_label("×%d" % int(slot.get("count", 1)), 17, CYAN))
			var slot_rule := ColorRect.new()
			slot_rule.color = LINE
			slot_rule.custom_minimum_size.y = 1
			stack.add_child(slot_rule)
			var description := _label(str(ITEM_DESCRIPTIONS.get(item_id, "Recovered field equipment.")), 11, MUTED)
			description.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
			description.size_flags_vertical = Control.SIZE_EXPAND_FILL
			stack.add_child(description)
		else:
			var empty := _label("EMPTY SLOT  %02d" % (slot_index + 1), 12, Color(MUTED, 0.5))
			empty.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
			empty.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
			empty.size_flags_vertical = Control.SIZE_EXPAND_FILL
			stack.add_child(empty)


func _render_files() -> void:
	if cached_lore_entries.is_empty():
		inventory_content.add_child(_empty_state("NO RECOVERED RECORDS", "Files discovered in Hushpoint will be logged here."))
		return
	for entry_value in cached_lore_entries:
		var entry: Dictionary = entry_value if entry_value is Dictionary else {"title": str(entry_value)}
		var row := PanelContainer.new()
		row.custom_minimum_size.y = 70
		row.add_theme_stylebox_override("panel", _panel_style(Color("ad10191e"), LINE, 1, 2))
		inventory_content.add_child(row)
		var row_margin := MarginContainer.new()
		_set_margins(row_margin, 18, 10, 18, 10)
		row.add_child(row_margin)
		var row_stack := VBoxContainer.new()
		row_margin.add_child(row_stack)
		row_stack.add_child(_label(str(entry.get("title", "UNTITLED RECORD")), 15, PAPER))
		row_stack.add_child(_label(str(entry.get("source", entry.get("id", "PALINODE ARCHIVE"))).to_upper(), 10, CYAN))


func _render_objectives() -> void:
	var active_card := PanelContainer.new()
	active_card.add_theme_stylebox_override("panel", _panel_style(Color("c9142024"), Color(CYAN, 0.55), 1, 2))
	inventory_content.add_child(active_card)
	var active_margin := MarginContainer.new()
	_set_margins(active_margin, 20, 16, 20, 16)
	active_card.add_child(active_margin)
	var active_stack := VBoxContainer.new()
	active_margin.add_child(active_stack)
	active_stack.add_child(_label("ACTIVE", 10, CYAN))
	var active_text := _label(cached_objective.to_upper(), 19, PAPER)
	active_text.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	active_stack.add_child(active_text)

	var completed: Array[String] = []
	if _state_bool(cached_state, "power_online", false):
		completed.append("Emergency power restored")
	if _state_bool(cached_state, "spool_assembled", false):
		completed.append("Mara's archive spool reconstructed")
	if _state_bool(cached_state, "tide_balanced", false):
		completed.append("Tide pressure balanced")
	var breaker_count := _true_count(_state_dictionary(cached_state, "purge_breakers_active"))
	if breaker_count > 0:
		completed.append("Purge breakers active: %d / 3" % breaker_count)

	var history := PanelContainer.new()
	history.add_theme_stylebox_override("panel", _panel_style(Color("8f0d1519"), LINE, 1, 2))
	inventory_content.add_child(history)
	var history_margin := MarginContainer.new()
	_set_margins(history_margin, 20, 15, 20, 15)
	history.add_child(history_margin)
	var history_stack := VBoxContainer.new()
	history_stack.add_theme_constant_override("separation", 8)
	history_margin.add_child(history_stack)
	history_stack.add_child(_label("STATION LOG", 10, MUTED))
	if completed.is_empty():
		history_stack.add_child(_label("No station systems have been secured.", 14, Color(MUTED, 0.72)))
	else:
		for item in completed:
			history_stack.add_child(_label("◆  " + item, 14, GREEN))


## Input and intent -----------------------------------------------------------

func _unhandled_input(event: InputEvent) -> void:
	if not (event is InputEventKey) or not event.pressed or event.echo:
		return
	var consumed := true
	match mode:
		ScreenMode.INTRO:
			if event.keycode in [KEY_ENTER, KEY_SPACE, KEY_RIGHT, KEY_E]:
				_intro_next()
			elif event.keycode in [KEY_LEFT, KEY_BACKSPACE]:
				_intro_back()
			else:
				consumed = false
		ScreenMode.INVENTORY:
			if event.keycode in [KEY_ESCAPE, KEY_TAB]:
				_close_overlay()
			elif event.keycode == KEY_1:
				_select_inventory_tab(0)
			elif event.keycode == KEY_2:
				_select_inventory_tab(1)
			elif event.keycode == KEY_3:
				_select_inventory_tab(2)
			else:
				consumed = false
		ScreenMode.LORE:
			if event.keycode in [KEY_ESCAPE, KEY_E, KEY_TAB]:
				_close_overlay()
			else:
				consumed = false
		ScreenMode.PAUSE:
			if event.keycode == KEY_ESCAPE:
				_on_resume()
			else:
				consumed = false
		ScreenMode.DEATH:
			if event.keycode in [KEY_ENTER, KEY_SPACE]:
				_on_restart()
			else:
				consumed = false
		ScreenMode.VICTORY:
			if event.keycode in [KEY_ENTER, KEY_SPACE, KEY_ESCAPE]:
				_on_menu()
			else:
				consumed = false
		_:
			consumed = false
	if consumed:
		get_viewport().set_input_as_handled()


func _on_new_game() -> void:
	new_game_requested.emit()


func _on_continue() -> void:
	continue_requested.emit()


func _on_quit() -> void:
	quit_requested.emit()


func _on_resume() -> void:
	resume_requested.emit()


func _on_restart() -> void:
	restart_requested.emit()


func _on_menu() -> void:
	menu_requested.emit()


func _close_overlay() -> void:
	overlay_closed.emit()


func _finish_intro() -> void:
	intro_finished.emit()


func _intro_next() -> void:
	if intro_page >= INTRO_PAGES.size() - 1:
		_finish_intro()
		return
	intro_page += 1
	_refresh_intro()


func _intro_back() -> void:
	intro_page = maxi(0, intro_page - 1)
	_refresh_intro()


func _refresh_intro() -> void:
	var data: Dictionary = INTRO_PAGES[intro_page]
	intro_index_label.text = str(data["index"])
	intro_title_label.text = str(data["title"])
	intro_body_label.text = str(data["body"])
	intro_note_label.text = str(data["note"])
	intro_back_button.disabled = intro_page == 0
	intro_next_button.text = "BEGIN CALL-OUT" if intro_page == INTRO_PAGES.size() - 1 else "CONTINUE"
	for index in intro_progress.get_child_count():
		var marker := intro_progress.get_child(index) as ColorRect
		marker.color = CYAN if index <= intro_page else LINE


func _toggle_title_controls() -> void:
	if title_controls_card == null:
		return
	title_controls_card.visible = not title_controls_card.visible
	if title_controls_card.visible:
		_sync_setting_controls()
		title_shake_toggle.call_deferred("grab_focus")


func _on_shake_toggled(enabled: bool) -> void:
	reduced_shake = enabled
	_apply_setting_change()


func _on_flash_toggled(enabled: bool) -> void:
	reduced_flashes = enabled
	_apply_setting_change()


func _apply_setting_change() -> void:
	_sync_setting_controls()
	_save_settings()
	settings_changed.emit(reduced_shake, reduced_flashes)


func _sync_setting_controls() -> void:
	for toggle in [title_shake_toggle, shake_toggle]:
		if is_instance_valid(toggle):
			toggle.set_pressed_no_signal(reduced_shake)
	for toggle in [title_flash_toggle, flash_toggle]:
		if is_instance_valid(toggle):
			toggle.set_pressed_no_signal(reduced_flashes)


func _load_settings() -> void:
	var config := ConfigFile.new()
	var load_error := config.load(SETTINGS_PATH)
	if load_error == ERR_FILE_NOT_FOUND:
		return
	if load_error != OK:
		push_warning("HUSHPOINT accessibility settings could not be loaded (error %d)." % load_error)
		return
	reduced_shake = bool(config.get_value(SETTINGS_SECTION, "reduced_shake", false))
	reduced_flashes = bool(config.get_value(SETTINGS_SECTION, "reduced_flashes", false))


func _save_settings() -> void:
	var config := ConfigFile.new()
	var load_error := config.load(SETTINGS_PATH)
	if load_error != OK and load_error != ERR_FILE_NOT_FOUND:
		push_warning("HUSHPOINT accessibility settings will replace an unreadable file (error %d)." % load_error)
	config.set_value(SETTINGS_SECTION, "reduced_shake", reduced_shake)
	config.set_value(SETTINGS_SECTION, "reduced_flashes", reduced_flashes)
	var save_error := config.save(SETTINGS_PATH)
	if save_error != OK:
		push_warning("HUSHPOINT accessibility settings could not be saved (error %d)." % save_error)


func _emit_loaded_settings() -> void:
	settings_changed.emit(reduced_shake, reduced_flashes)


## Styling and state helpers --------------------------------------------------

func _show_only(target: Control) -> void:
	for screen in screens:
		screen.visible = screen == target
	if target != hud_screen and is_instance_valid(radio_panel):
		if radio_tween != null and radio_tween.is_valid():
			radio_tween.kill()
		radio_panel.modulate.a = 0.0


func _label(text_value: String, font_size: int, color: Color) -> Label:
	var label := Label.new()
	label.text = text_value
	label.add_theme_font_size_override("font_size", font_size)
	label.add_theme_color_override("font_color", color)
	label.add_theme_color_override("font_shadow_color", Color(0, 0, 0, 0.65))
	label.add_theme_constant_override("shadow_offset_x", 1)
	label.add_theme_constant_override("shadow_offset_y", 1)
	return label


func _button(text_value: String, callback: Callable, primary: bool = false) -> Button:
	var button := Button.new()
	button.text = text_value
	button.custom_minimum_size = Vector2(280, 46)
	button.focus_mode = Control.FOCUS_ALL
	button.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	button.add_theme_font_size_override("font_size", 13)
	button.add_theme_color_override("font_color", PAPER)
	button.add_theme_color_override("font_hover_color", DEEP_INK if primary else PAPER)
	button.add_theme_color_override("font_pressed_color", DEEP_INK)
	button.add_theme_color_override("font_focus_color", PAPER)
	var normal_color := Color("d5121c21") if not primary else Color("d7246667")
	button.add_theme_stylebox_override("normal", _panel_style(normal_color, CYAN_DIM if primary else LINE, 1, 2))
	button.add_theme_stylebox_override("hover", _panel_style(CYAN if primary else PANEL_LIGHT, CYAN, 1, 2))
	button.add_theme_stylebox_override("pressed", _panel_style(Color(CYAN, 0.78), CYAN, 1, 2))
	button.add_theme_stylebox_override("focus", _panel_style(Color(0, 0, 0, 0), AMBER, 2, 2))
	button.add_theme_stylebox_override("disabled", _panel_style(Color("6510181c"), Color(LINE, 0.4), 1, 2))
	button.pressed.connect(callback)
	return button


func _check_button(text_value: String) -> CheckButton:
	var toggle := CheckButton.new()
	toggle.text = text_value
	toggle.custom_minimum_size.y = 34
	toggle.add_theme_font_size_override("font_size", 13)
	toggle.add_theme_color_override("font_color", Color(PAPER, 0.82))
	toggle.add_theme_color_override("font_hover_color", CYAN)
	return toggle


func _panel_style(background: Color, border: Color, width: int, radius: int) -> StyleBoxFlat:
	var style := StyleBoxFlat.new()
	style.bg_color = background
	style.border_color = border
	style.border_width_left = width
	style.border_width_top = width
	style.border_width_right = width
	style.border_width_bottom = width
	style.corner_radius_top_left = radius
	style.corner_radius_top_right = radius
	style.corner_radius_bottom_left = radius
	style.corner_radius_bottom_right = radius
	return style


func _set_margins(container: MarginContainer, left: int, top: int, right: int, bottom: int) -> void:
	container.add_theme_constant_override("margin_left", left)
	container.add_theme_constant_override("margin_top", top)
	container.add_theme_constant_override("margin_right", right)
	container.add_theme_constant_override("margin_bottom", bottom)


func _add_dim(parent: Control, alpha: float, tint: Color = Color.BLACK) -> void:
	var dim := ColorRect.new()
	dim.color = Color(tint.r, tint.g, tint.b, alpha)
	dim.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	parent.add_child(dim)


func _add_atmospheric_backdrop(parent: Control, accent: Color) -> void:
	var backdrop := ColorRect.new()
	backdrop.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	var shader := Shader.new()
	shader.code = """
		shader_type canvas_item;
		uniform vec4 accent : source_color = vec4(0.2, 0.7, 0.7, 1.0);
		float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
		void fragment() {
			vec2 uv = SCREEN_UV;
			float beam = smoothstep(0.55, 0.0, abs(uv.x - 0.22 - uv.y * 0.08));
			float grid = step(0.985, fract(uv.x * 19.0)) * 0.08 + step(0.992, fract(uv.y * 12.0)) * 0.05;
			float grain = (hash(floor(uv * vec2(640.0, 360.0)) + floor(TIME * 8.0)) - 0.5) * 0.025;
			vec3 base = mix(vec3(0.008, 0.02, 0.025), vec3(0.025, 0.05, 0.055), uv.y);
			base += accent.rgb * (beam * 0.07 + grid);
			base += grain;
			COLOR = vec4(base, 1.0);
		}
	"""
	var material := ShaderMaterial.new()
	material.shader = shader
	material.set_shader_parameter("accent", accent)
	backdrop.material = material
	parent.add_child(backdrop)

	for line_index in 7:
		var pipe := ColorRect.new()
		pipe.color = Color(accent, 0.07 + float(line_index % 2) * 0.025)
		pipe.position = Vector2(70 + line_index * 178, 0)
		pipe.size = Vector2(1 if line_index % 3 else 3, 720)
		pipe.mouse_filter = Control.MOUSE_FILTER_IGNORE
		parent.add_child(pipe)


func _small_status_label(text_value: String) -> Label:
	var label := _label(text_value, 10, MUTED)
	label.custom_minimum_size.x = 52
	return label


func _meter(fill_color: Color) -> ProgressBar:
	var meter := ProgressBar.new()
	meter.min_value = 0
	meter.max_value = 100
	meter.value = 0
	meter.show_percentage = false
	meter.custom_minimum_size = Vector2(150, 9)
	meter.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	meter.add_theme_stylebox_override("background", _panel_style(Color("a1080d10"), LINE, 1, 1))
	meter.add_theme_stylebox_override("fill", _panel_style(fill_color, fill_color, 0, 1))
	return meter


func _add_crosshair_line(position_value: Vector2, size_value: Vector2) -> void:
	var line := ColorRect.new()
	line.position = position_value
	line.size = size_value
	line.color = PAPER
	line.mouse_filter = Control.MOUSE_FILTER_IGNORE
	crosshair.add_child(line)
	crosshair_parts.append(line)


func _empty_state(title_value: String, body: String) -> PanelContainer:
	var panel := PanelContainer.new()
	panel.custom_minimum_size.y = 190
	panel.add_theme_stylebox_override("panel", _panel_style(Color("750d1519"), LINE, 1, 2))
	var stack := VBoxContainer.new()
	stack.alignment = BoxContainer.ALIGNMENT_CENTER
	panel.add_child(stack)
	var title := _label(title_value, 16, MUTED)
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	stack.add_child(title)
	var detail := _label(body, 13, Color(MUTED, 0.68))
	detail.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	stack.add_child(detail)
	return panel


func _clear_children(parent: Node) -> void:
	for child in parent.get_children():
		parent.remove_child(child)
		child.queue_free()


func _escape_bbcode(value: String) -> String:
	return value.replace("[", "［").replace("]", "］")


func _state_value(state: Variant, property_name: StringName, fallback: Variant) -> Variant:
	if state == null:
		return fallback
	if state is Dictionary:
		return state.get(property_name, fallback)
	for property_data in state.get_property_list():
		if StringName(property_data.get("name", "")) == property_name:
			return state.get(property_name)
	return fallback


func _state_int(state: Variant, property_name: StringName, fallback: int) -> int:
	return int(_state_value(state, property_name, fallback))


func _state_bool(state: Variant, property_name: StringName, fallback: bool) -> bool:
	return bool(_state_value(state, property_name, fallback))


func _state_dictionary(state: Variant, property_name: StringName) -> Dictionary:
	var value: Variant = _state_value(state, property_name, {})
	return value if value is Dictionary else {}


func _item_count(state: Variant, item_id: String) -> int:
	if state != null and not (state is Dictionary) and state.has_method("item_count"):
		return int(state.item_count(item_id))
	var total := 0
	for slot in _inventory_snapshot(state):
		if slot.get("id", "") == item_id:
			total += int(slot.get("count", 0))
	return total


func _inventory_snapshot(state: Variant) -> Array:
	if state == null:
		return []
	if not (state is Dictionary) and state.has_method("inventory_snapshot"):
		return state.inventory_snapshot()
	var value: Variant = _state_value(state, "inventory", [])
	return value if value is Array else []


func _occupied_slots(state: Variant) -> int:
	if state != null and not (state is Dictionary) and state.has_method("occupied_inventory_slots"):
		return int(state.occupied_inventory_slots())
	var occupied := 0
	for slot in _inventory_snapshot(state):
		if not slot.is_empty():
			occupied += 1
	return occupied


func _true_count(values: Dictionary) -> int:
	var count := 0
	for value in values.values():
		if bool(value):
			count += 1
	return count
