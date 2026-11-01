class_name HushOutdoorBuilder
extends RefCounted

## Builds the ordinary surface approach to Hushpoint. This scene intentionally
## contains no supernatural escalation: game.gd owns the transition into horror.
## Geometry is primitive and deliberately low-count so the exterior remains
## practical on integrated GPUs.

const WorldBuilder = preload("res://scripts/world_builder.gd")
const TIDE_GAUGE_SCENE: PackedScene = preload("res://assets/models/hushpoint_tide_gauge_optimized.glb")


static func _add_higgsfield_tide_gauge(parent: Node3D, position: Vector3) -> Node3D:
	var gauge := TIDE_GAUGE_SCENE.instantiate() as Node3D
	gauge.name = "HiggsfieldBlenderTideGauge"
	gauge.position = position
	gauge.rotation_degrees.y = -90.0
	gauge.scale = Vector3.ONE * 2.35
	parent.add_child(gauge)
	return gauge


static func _interaction(
	parent: Node3D,
	position: Vector3,
	size: Vector3,
	interaction_id: String,
	prompt: String,
	interaction_material: Material,
	step: String,
	payload: Dictionary
) -> StaticBody3D:
	var body := WorldBuilder.box(
		parent,
		position,
		size,
		interaction_material,
		interaction_id,
		true
	) as StaticBody3D
	body.set_meta("interaction_kind", "tutorial")
	body.set_meta("interaction_id", interaction_id)
	body.set_meta("interaction_prompt", prompt)
	body.set_meta("tutorial_step", step)
	body.set_meta("payload", payload)
	return body


static func _tutorial_record(node: StaticBody3D, step: String, message: String) -> Dictionary:
	return {
		"node": node,
		"id": str(node.get_meta("interaction_id")),
		"step": step,
		"message": message,
		"position": node.position,
	}


static func _add_rain(parent: Node3D) -> GPUParticles3D:
	var particles := GPUParticles3D.new()
	particles.name = "CoastalDrizzle"
	particles.position = Vector3(-4, 11, 20)
	particles.amount = 260
	particles.lifetime = 1.75
	particles.randomness = 0.38
	particles.fixed_fps = 24
	particles.visibility_aabb = AABB(Vector3(-44, -13, -66), Vector3(88, 28, 132))
	var process := ParticleProcessMaterial.new()
	process.emission_shape = ParticleProcessMaterial.EMISSION_SHAPE_BOX
	process.emission_box_extents = Vector3(39, 1.0, 57)
	process.direction = Vector3(-0.18, -1.0, 0.08)
	process.spread = 7.0
	process.initial_velocity_min = 9.0
	process.initial_velocity_max = 13.0
	process.gravity = Vector3(-0.8, -2.4, 0.35)
	particles.process_material = process
	var streak := QuadMesh.new()
	streak.size = Vector2(0.018, 0.42)
	var rain_material := StandardMaterial3D.new()
	rain_material.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	rain_material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	rain_material.billboard_mode = BaseMaterial3D.BILLBOARD_ENABLED
	rain_material.albedo_color = Color(0.64, 0.77, 0.80, 0.32)
	streak.material = rain_material
	particles.draw_pass_1 = streak
	parent.add_child(particles)
	return particles


static func _add_wind_mist(parent: Node3D) -> GPUParticles3D:
	var particles := GPUParticles3D.new()
	particles.name = "HarborWindMist"
	particles.position = Vector3(30, 1.1, 16)
	particles.amount = 52
	particles.lifetime = 4.2
	particles.randomness = 0.86
	particles.fixed_fps = 18
	particles.visibility_aabb = AABB(Vector3(-18, -3, -54), Vector3(76, 11, 108))
	var process := ParticleProcessMaterial.new()
	process.emission_shape = ParticleProcessMaterial.EMISSION_SHAPE_BOX
	process.emission_box_extents = Vector3(11, 0.8, 45)
	process.direction = Vector3(-1.0, 0.10, 0.15)
	process.spread = 16.0
	process.initial_velocity_min = 1.1
	process.initial_velocity_max = 2.8
	process.gravity = Vector3(-0.08, 0.025, 0)
	process.scale_min = 0.5
	process.scale_max = 1.6
	particles.process_material = process
	var wisp := QuadMesh.new()
	wisp.size = Vector2(1.8, 0.14)
	var mist_material := StandardMaterial3D.new()
	mist_material.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	mist_material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	mist_material.billboard_mode = BaseMaterial3D.BILLBOARD_ENABLED
	mist_material.albedo_color = Color(0.58, 0.70, 0.72, 0.075)
	wisp.material = mist_material
	particles.draw_pass_1 = wisp
	parent.add_child(particles)
	return particles


static func _add_utility_truck(
	parent: Node3D,
	position: Vector3,
	paint: Material,
	dark_metal: Material,
	glass: Material,
	rubber: Material
) -> Node3D:
	var truck := Node3D.new()
	truck.name = "LenaUtilityTruck"
	truck.position = position
	parent.add_child(truck)
	WorldBuilder.box(truck, Vector3(0, 0.82, 0.3), Vector3(2.15, 0.72, 4.5), paint, "TruckBody")
	WorldBuilder.box(truck, Vector3(0, 1.55, -1.05), Vector3(2.05, 0.82, 1.65), paint, "TruckCab")
	WorldBuilder.box(truck, Vector3(0, 1.64, -1.91), Vector3(1.72, 0.48, 0.08), glass, "Windshield", false)
	WorldBuilder.box(truck, Vector3(0, 1.28, 1.35), Vector3(1.76, 0.62, 1.65), dark_metal, "EquipmentBed", false)
	WorldBuilder.box(truck, Vector3(0, 1.75, 1.35), Vector3(1.45, 0.34, 1.0), paint, "ToolChest", false)
	for wheel_position in [
		Vector3(-1.04, 0.55, -1.2),
		Vector3(1.04, 0.55, -1.2),
		Vector3(-1.04, 0.55, 1.25),
		Vector3(1.04, 0.55, 1.25),
	]:
		WorldBuilder.cylinder(truck, wheel_position, 0.43, 0.24, rubber, Vector3(0, 0, PI / 2.0), "TruckWheel")
	WorldBuilder.box(truck, Vector3(-0.64, 1.0, -2.0), Vector3(0.38, 0.18, 0.08), glass, "HeadlampL", false)
	WorldBuilder.box(truck, Vector3(0.64, 1.0, -2.0), Vector3(0.38, 0.18, 0.08), glass, "HeadlampR", false)
	return truck


static func _add_harbor_office(
	parent: Node3D,
	weatherboard: Material,
	dark_metal: Material,
	glass: Material,
	roof: Material
) -> void:
	WorldBuilder.box(parent, Vector3(13, 1.65, 39), Vector3(9.5, 3.3, 7.0), weatherboard, "HarborOffice")
	WorldBuilder.box(parent, Vector3(13, 3.42, 39), Vector3(10.2, 0.32, 7.7), roof, "OfficeRoof")
	WorldBuilder.box(parent, Vector3(13, 1.15, 35.47), Vector3(1.15, 2.3, 0.18), dark_metal, "OfficeDoor", false)
	for window_x in [10.15, 15.85]:
		WorldBuilder.box(parent, Vector3(window_x, 1.75, 35.44), Vector3(2.2, 1.15, 0.12), glass, "OfficeWindow", false)
	WorldBuilder.add_sign(
		parent,
		Vector3(13, 2.82, 35.34),
		"KINMOUTH HARBOR AUTHORITY  /  FIELD OFFICE",
		Color("e5d6b0"),
		Vector3.ZERO,
		31
	)
	WorldBuilder.add_sign(
		parent,
		Vector3(13, 1.05, 35.30),
		"OFFICE HOURS  06:00—18:00",
		Color("72908d"),
		Vector3.ZERO,
		20
	)


static func _add_pier_and_tide_gauge(
	parent: Node3D,
	wood: Material,
	dark_metal: Material,
	safety: Material,
	glass: Material
) -> Dictionary:
	WorldBuilder.box(parent, Vector3(40.5, 0.05, 26), Vector3(25, 0.28, 3.4), wood, "GaugePier")
	WorldBuilder.box(parent, Vector3(28.25, -0.02, 26), Vector3(2.0, 0.18, 3.4), wood, "GaugePierRamp")
	for post_x in [29.0, 35.0, 41.0, 47.0, 52.0]:
		for post_z in [24.75, 27.25]:
			WorldBuilder.cylinder(parent, Vector3(post_x, -0.7, post_z), 0.15, 2.6, dark_metal, Vector3.ZERO, "PierPile")
	for rail_x in [33.0, 40.0, 47.0, 52.0]:
		for rail_z in [24.32, 27.68]:
			WorldBuilder.cylinder(parent, Vector3(rail_x, 0.72, rail_z), 0.045, 1.35, dark_metal, Vector3.ZERO, "PierRailPost")
	for rail_z in [24.32, 27.68]:
		WorldBuilder.box(parent, Vector3(42.5, 1.08, rail_z), Vector3(21.0, 0.07, 0.07), dark_metal, "PierHandrail", false)

	WorldBuilder.box(parent, Vector3(48.7, 1.45, 27.26), Vector3(0.18, 2.9, 0.12), safety, "PhysicalTideStaff", false)
	var physical_gauge := _interaction(
		parent,
		Vector3(48.7, 0.85, 26.98),
		Vector3(0.42, 0.35, 0.24),
		"surface_tide_staff",
		"E  READ PHYSICAL TIDE STAFF",
		safety,
		"read_physical_gauge",
		{
			"title": "PHYSICAL TIDE STAFF / VERIFIED",
			"text": "1.57 m and falling. The brass marks are wet only below the safe-service line. The harbor is calm enough for routine work.",
		}
	)
	_add_higgsfield_tide_gauge(parent, Vector3(52.3, 1.18, 26))
	WorldBuilder.add_sign(parent, Vector3(52.3, 2.62, 25.58), "TG—04", Color("f0c96c"), Vector3.ZERO, 22)
	var telemetry := _interaction(
		parent,
		Vector3(51.75, 0.75, 25.25),
		Vector3(0.42, 0.2, 0.42),
		"surface_telemetry",
		"E  COMPARE DIGITAL TELEMETRY",
		safety,
		"check_telemetry",
		{
			"title": "AUTOMATED TIDE GAUGE TG—04",
			"text": "1.80 m and rising: exactly 23 cm above the physical staff. The display calls for a lower-gate closure that Control has not authorized.",
		}
	)
	return {"physical": physical_gauge, "telemetry": telemetry}


static func _add_station_facade(
	parent: Node3D,
	concrete: Material,
	dark_concrete: Material,
	dark_metal: Material,
	glass: Material,
	safety: Material
) -> StaticBody3D:
	WorldBuilder.box(parent, Vector3(0, 4.5, -29), Vector3(44, 9, 7.0), concrete, "SurfaceStationFacade")
	WorldBuilder.box(parent, Vector3(0, 9.15, -29), Vector3(46, 0.45, 7.6), dark_concrete, "SurfaceStationRoof")
	for buttress_x in [-19.0, -12.5, 12.5, 19.0]:
		WorldBuilder.box(parent, Vector3(buttress_x, 4.1, -25.2), Vector3(1.0, 8.2, 1.2), dark_concrete, "FacadeButtress")
	for window_x in [-16.0, -9.5, 9.5, 16.0]:
		WorldBuilder.box(parent, Vector3(window_x, 5.8, -25.42), Vector3(3.3, 1.3, 0.12), glass, "StationWindow", false)
	WorldBuilder.box(parent, Vector3(0, 1.65, -25.25), Vector3(5.0, 3.3, 0.85), dark_concrete, "EntryRecess")
	var door := _interaction(
		parent,
		Vector3(0, 1.55, -24.76),
		Vector3(2.35, 3.1, 0.30),
		"surface_station_entry",
		"E  ENTER HUSHPOINT TIDAL CONTROL",
		dark_metal,
		"enter_station",
		{
			"destination": "lower_station",
			"normal_state": "Access card accepted. Surface telemetry reports no active emergency.",
		}
	)
	door.set_meta("closed_position", door.position)
	var reader := _interaction(
		parent,
		Vector3(1.55, 1.55, -24.54),
		Vector3(0.24, 0.40, 0.10),
		"surface_entry_reader",
		"E  VERIFY ACCESS CARD",
		safety,
		"unlock_station_entry",
		{
			"title": "LEGACY ACCESS CONTROL",
			"text": "L. ORR / FIELD ENGINEERING. Upper control inspection only. Gate movement remains prohibited without a verified Control challenge.",
		}
	)
	door.set_meta("entry_reader", reader)
	WorldBuilder.add_sign(
		parent,
		Vector3(0, 7.65, -25.36),
		"HUSHPOINT TIDAL CONTROL  /  STATION 03",
		Color("d8d8cb"),
		Vector3.ZERO,
		50
	)
	WorldBuilder.add_sign(
		parent,
		Vector3(0, 3.62, -25.34),
		"AUTHORIZED ENGINEERING ACCESS",
		Color("d4aa55"),
		Vector3.ZERO,
		27
	)
	return door


static func _add_lighthouse(
	parent: Node3D,
	position: Vector3,
	white_paint: Material,
	red_paint: Material,
	dark_metal: Material,
	glass: Material
) -> void:
	WorldBuilder.box(parent, position + Vector3(0, 0.25, 0), Vector3(5.6, 0.5, 5.6), dark_metal, "BeaconFoundation")
	WorldBuilder.cylinder(parent, position + Vector3(0, 4.2, 0), 2.0, 8.0, white_paint, Vector3.ZERO, "HarborBeaconTower")
	WorldBuilder.cylinder(parent, position + Vector3(0, 7.7, 0), 2.08, 1.0, red_paint, Vector3.ZERO, "BeaconBand")
	WorldBuilder.cylinder(parent, position + Vector3(0, 9.0, 0), 1.65, 1.75, glass, Vector3.ZERO, "BeaconLanternRoom")
	WorldBuilder.cylinder(parent, position + Vector3(0, 10.05, 0), 2.15, 0.30, red_paint, Vector3.ZERO, "BeaconCap")
	for angle_index in range(8):
		var angle := float(angle_index) * TAU / 8.0
		WorldBuilder.cylinder(
			parent,
			position + Vector3(cos(angle) * 2.2, 8.05, sin(angle) * 2.2),
			0.035,
			1.1,
			dark_metal,
			Vector3.ZERO,
			"BeaconRailPost"
		)


static func build(parent: Node3D) -> Dictionary:
	var asphalt := WorldBuilder.material(Color("252b2c"), 0.93)
	var concrete := WorldBuilder.material(Color("778082"), 0.92)
	var dark_concrete := WorldBuilder.material(Color("273033"), 0.95)
	var weatherboard := WorldBuilder.material(Color("c7c4af"), 0.88)
	var dark_metal := WorldBuilder.material(Color("29363a"), 0.35, 0.72)
	var galvanized := WorldBuilder.material(Color("667477"), 0.48, 0.66)
	var safety := WorldBuilder.material(Color("c99537"), 0.58, 0.28, Color("8c5d19"))
	var truck_paint := WorldBuilder.material(Color("d4c15c"), 0.54, 0.22)
	var rubber := WorldBuilder.material(Color("101314"), 0.99)
	var wood := WorldBuilder.material(Color("604b37"), 0.88)
	var rock := WorldBuilder.material(Color("465154"), 0.98)
	var grass := WorldBuilder.material(Color("455447"), 0.98)
	var white_paint := WorldBuilder.material(Color("d6d7cd"), 0.72, 0.18)
	var red_paint := WorldBuilder.material(Color("923e34"), 0.68, 0.24)
	var glass := WorldBuilder.material(Color("71969b"), 0.12, 0.28, Color("365d60"))
	var sea := StandardMaterial3D.new()
	sea.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	sea.albedo_color = Color(0.075, 0.19, 0.22, 0.88)
	sea.metallic = 0.36
	sea.roughness = 0.18

	# Broad, low-detail landforms establish an exposed but functioning civic site.
	WorldBuilder.box(parent, Vector3(-5, -0.52, 21), Vector3(72, 1.0, 118), grass, "CoastalGround")
	WorldBuilder.box(parent, Vector3(61, -1.05, 17), Vector3(60, 0.18, 126), sea, "HarborSea", false)
	WorldBuilder.box(parent, Vector3(-5.5, 0.015, 25), Vector3(10.5, 0.05, 98), asphalt, "ServiceRoad", false)
	WorldBuilder.box(parent, Vector3(8.5, 0.02, 42), Vector3(27, 0.06, 21), asphalt, "VisitorParking", false)
	for road_z in range(-13, 73, 9):
		WorldBuilder.box(parent, Vector3(-5.5, 0.055, road_z), Vector3(0.13, 0.025, 4.2), safety, "RoadCenterLine", false)
	for parking_x in [-1.0, 4.0, 9.0, 14.0, 19.0]:
		WorldBuilder.box(parent, Vector3(parking_x, 0.06, 44), Vector3(0.09, 0.025, 15.5), white_paint, "ParkingBayLine", false)

	# Wind-shaped cliff blocks frame the road without expensive terrain meshes.
	for cliff_data in [
		[Vector3(-34, 1.7, -8), Vector3(11, 4.2, 29), -5.0],
		[Vector3(-35, 1.2, 24), Vector3(9, 3.2, 28), 4.0],
		[Vector3(-32, 0.8, 51), Vector3(12, 2.4, 19), -7.0],
		[Vector3(30, -0.15, -10), Vector3(7, 1.1, 35), 2.0],
	]:
		var cliff := WorldBuilder.box(parent, cliff_data[0], cliff_data[1], rock, "CoastalCliff")
		cliff.rotation_degrees.y = float(cliff_data[2])

	# Coastal edge stones and a visible seawall make the shoreline legible.
	for seawall_z in range(-30, 70, 7):
		WorldBuilder.box(parent, Vector3(30.5, -0.15, seawall_z), Vector3(2.2, 1.2, 6.1), rock, "Seawall")
	for wave_z in range(-42, 75, 13):
		WorldBuilder.box(parent, Vector3(45, -0.90, wave_z), Vector3(20, 0.025, 0.12), glass, "WaveLine", false)

	_add_utility_truck(parent, Vector3(-13.2, 0, 50), truck_paint, dark_metal, glass, rubber)
	_add_harbor_office(parent, weatherboard, dark_metal, glass, galvanized)
	var tide_gauge: Dictionary = _add_pier_and_tide_gauge(parent, wood, dark_metal, safety, glass)
	_add_lighthouse(parent, Vector3(23, 0, -17), white_paint, red_paint, dark_metal, glass)
	var station_door := _add_station_facade(parent, concrete, dark_concrete, dark_metal, glass, safety)

	# Perimeter fence is intact, but its maintenance gate is already open.
	for fence_x in range(-30, 29, 4):
		if fence_x > -10 and fence_x < -1:
			continue
		WorldBuilder.cylinder(parent, Vector3(fence_x, 1.25, 10), 0.07, 2.5, galvanized, Vector3.ZERO, "FencePost")
		WorldBuilder.box(parent, Vector3(fence_x + 1.8, 1.0, 10), Vector3(3.6, 0.055, 0.055), galvanized, "FenceRail", false)
	WorldBuilder.add_sign(parent, Vector3(-5.5, 2.75, 9.78), "MAINTENANCE GATE  /  KEEP CLEAR", Color("ded3ad"), Vector3.ZERO, 25)
	WorldBuilder.add_sign(parent, Vector3(-17.5, 1.95, 9.75), "SPEED LIMIT 15", Color("e6d39a"), Vector3.ZERO, 24)

	# Ordinary arrival interactions teach inspection and establish Lena's job.
	var tutorial_interactions: Array[Dictionary] = []
	var work_order := _interaction(
		parent,
		Vector3(-13.2, 2.05, 51.3),
		Vector3(0.62, 0.06, 0.78),
		"surface_work_order",
		"E  READ MAINTENANCE WORK ORDER",
		white_paint,
		"read_work_order",
		{
			"title": "KINMOUTH HARBOR — CALL-OUT 03-117",
			"text": "Compare north telemetry against the physical tide staff, reset relay R-4, file the reading, and leave. Gate controls stay untouched. Storm-surge watch: possible conditions within 48 hours.",
		}
	)
	tutorial_interactions.append(_tutorial_record(work_order, "read_work_order", "Read the ordinary call-out that brought Lena to Hushpoint."))

	var equipment := _interaction(
		parent,
		Vector3(-13.2, 1.35, 52.34),
		Vector3(1.15, 0.42, 0.18),
		"surface_equipment",
		"E  CHECK FIELD EQUIPMENT",
		safety,
		"check_equipment",
		{
			"title": "FIELD KIT / TRUCK SEVEN",
			"text": "Inspection lamp, paper work order, radio challenge card, insulated gloves. No response weapon has been issued for this routine maintenance call.",
		}
	)
	tutorial_interactions.append(_tutorial_record(equipment, "check_equipment", "Collect the normal inspection tools from the service truck."))
	tutorial_interactions.append(_tutorial_record(tide_gauge["physical"], "read_physical_gauge", "Read the trustworthy physical tide staff."))
	tutorial_interactions.append(_tutorial_record(tide_gauge["telemetry"], "check_telemetry", "Compare the powered telemetry against the physical reading."))

	WorldBuilder.cylinder(parent, Vector3(18.2, 3.1, 34.9), 0.09, 6.2, galvanized, Vector3.ZERO, "TelemetryRelayMast")
	WorldBuilder.box(parent, Vector3(18.2, 5.9, 34.9), Vector3(1.35, 0.10, 0.10), galvanized, "RelayCrossbar", false)
	var relay := _interaction(
		parent,
		Vector3(18.2, 1.05, 35.15),
		Vector3(0.72, 1.25, 0.42),
		"surface_relay",
		"E  RESET TELEMETRY RELAY R-4",
		dark_metal,
		"restore_relay",
		{
			"title": "RELAY R-4 / PACKET RECOVERED",
			"text": "Upload succeeded. One buffered packet carries tomorrow's date and Lena's present call-sign. Control has not received it.",
		}
	)
	tutorial_interactions.append(_tutorial_record(relay, "restore_relay", "Reset the ordinary relay and reveal the first impossible timestamp."))

	var report := _interaction(
		parent,
		Vector3(13.0, 1.12, 35.22),
		Vector3(0.92, 0.70, 0.15),
		"surface_report",
		"E  LOG VERIFIED READING",
		white_paint,
		"log_report",
		{
			"title": "FIELD REPORT / HANDWRITTEN",
			"text": "Physical: 1.57 m falling. Digital: 1.80 m rising. Relay drift confirmed. Lena signs the paper copy because powered records cannot be trusted.",
		}
	)
	tutorial_interactions.append(_tutorial_record(report, "log_report", "Record the contradiction on paper."))
	var entry_reader: Node = station_door.get_meta("entry_reader")
	tutorial_interactions.append(_tutorial_record(entry_reader, "unlock_station_entry", "Verify the access card after the report is filed."))
	tutorial_interactions.append(_tutorial_record(station_door, "enter_station", "End the normal arrival and hand pacing to game.gd."))

	var break_radio := _interaction(
		parent,
		Vector3(-13.62, 1.42, 47.72),
		Vector3(0.32, 0.24, 0.18),
		"final_radio_break",
		"E  BREAK THE RADIO",
		dark_metal,
		"break",
		{"choice": "break"}
	)
	break_radio.set_meta("interaction_kind", "final_radio")
	var answer_radio := _interaction(
		parent,
		Vector3(-12.78, 1.42, 47.72),
		Vector3(0.32, 0.24, 0.18),
		"final_radio_answer",
		"E  ANSWER +00:17",
		safety,
		"answer",
		{"choice": "answer"}
	)
	answer_radio.set_meta("interaction_kind", "final_radio")
	for radio_choice in [break_radio, answer_radio]:
		radio_choice.visible = false
		radio_choice.collision_layer = 0
		radio_choice.process_mode = Node.PROCESS_MODE_DISABLED

	# Warm practical lighting signals that the site is maintained, not abandoned.
	var exterior_lights: Array[OmniLight3D] = []
	for light_data in [
		[Vector3(-13.2, 2.1, 47.8), Color("ffd394"), 1.05, 8.0],
		[Vector3(13, 3.2, 34.8), Color("ffd9a1"), 1.35, 11.0],
		[Vector3(-7.0, 3.1, 9.5), Color("f5c26f"), 1.15, 9.0],
		[Vector3(-1.8, 3.3, -23.6), Color("ffd096"), 1.45, 10.0],
		[Vector3(1.8, 3.3, -23.6), Color("ffd096"), 1.45, 10.0],
		[Vector3(23, 9.0, -17), Color("f4dfb8"), 1.25, 18.0],
	]:
		exterior_lights.append(WorldBuilder.add_light(parent, light_data[0], light_data[1], light_data[2], light_data[3], false))

	var rain := _add_rain(parent)
	var wind_mist := _add_wind_mist(parent)
	var spawn := Vector3(-7.0, 0.08, 63.0)
	var entry_position := Vector3(0, 0.08, -22.5)
	return {
		"spawn_player": spawn,
		"player_spawn": spawn,
		"station_entry_position": entry_position,
		"station_entry_door": station_door,
		"exterior_lights": exterior_lights,
		"lights": exterior_lights,
		"tutorial_interactions": tutorial_interactions,
		"final_radio_choices": [break_radio, answer_radio],
		"rain_particles": rain,
		"wind_particles": wind_mist,
		"bounds": AABB(Vector3(-42, -2, -36), Vector3(134, 16, 108)),
	}
