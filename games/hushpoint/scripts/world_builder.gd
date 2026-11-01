class_name HushWorldBuilder
extends RefCounted

static var _surface_textures: Dictionary = {}


static func _surface_texture(color: Color) -> ImageTexture:
	var key := color.to_html(false)
	if _surface_textures.has(key):
		return _surface_textures[key]
	var image := Image.create(96, 96, true, Image.FORMAT_RGBA8)
	var seed := int(color.to_abgr32() % 997)
	for y in range(96):
		for x in range(96):
			var sample := float((x * 37 + y * 57 + (x * y) % 23 + seed) % 97) / 96.0
			var value := 0.76 + sample * 0.24
			if (y + seed) % 31 == 0:
				value *= 0.7
			if (x * 3 + y * 5 + seed) % 71 == 0:
				value *= 0.5
			image.set_pixel(x, y, Color(value, value * 0.985, value * 0.95, 1.0))
	image.generate_mipmaps()
	var texture := ImageTexture.create_from_image(image)
	_surface_textures[key] = texture
	return texture


static func material(
	color: Color,
	roughness: float = 0.82,
	metallic: float = 0.0,
	emission: Color = Color(0, 0, 0, 0)
) -> StandardMaterial3D:
	var result := StandardMaterial3D.new()
	result.albedo_color = color
	result.albedo_texture = _surface_texture(color)
	result.uv1_scale = Vector3(3.0, 3.0, 3.0)
	result.roughness = roughness
	result.metallic = metallic
	if emission.a > 0.0:
		result.emission_enabled = true
		result.emission = emission
		result.emission_energy_multiplier = 2.8
	return result


static func add_sign(
	parent: Node3D,
	position: Vector3,
	text_value: String,
	color: Color,
	rotation: Vector3 = Vector3.ZERO,
	font_size: int = 48
) -> Label3D:
	var label := Label3D.new()
	label.text = text_value
	label.position = position
	label.rotation = rotation
	label.font_size = font_size
	label.pixel_size = 0.006
	label.modulate = color
	label.outline_modulate = Color(0.01, 0.02, 0.025, 0.95)
	label.outline_size = 12
	label.no_depth_test = false
	parent.add_child(label)
	return label


static func box(
	parent: Node3D,
	position: Vector3,
	size: Vector3,
	box_material: Material,
	label: String,
	collision: bool = true
) -> Node3D:
	var root: Node3D
	if collision:
		root = StaticBody3D.new()
		var shape := CollisionShape3D.new()
		var box_shape := BoxShape3D.new()
		box_shape.size = size
		shape.shape = box_shape
		root.add_child(shape)
	else:
		root = Node3D.new()
	root.name = label
	root.position = position
	var mesh_instance := MeshInstance3D.new()
	var mesh := BoxMesh.new()
	mesh.size = size
	mesh_instance.mesh = mesh
	mesh_instance.material_override = box_material
	mesh_instance.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON
	root.add_child(mesh_instance)
	parent.add_child(root)
	return root


static func cylinder(
	parent: Node3D,
	position: Vector3,
	radius: float,
	height: float,
	cylinder_material: Material,
	rotation: Vector3 = Vector3.ZERO,
	label: String = "Pipe"
) -> MeshInstance3D:
	var instance := MeshInstance3D.new()
	var mesh := CylinderMesh.new()
	mesh.top_radius = radius
	mesh.bottom_radius = radius
	mesh.height = height
	mesh.radial_segments = 12
	instance.mesh = mesh
	instance.material_override = cylinder_material
	instance.position = position
	instance.rotation = rotation
	instance.name = label
	parent.add_child(instance)
	return instance


static func interactive_box(
	parent: Node3D,
	position: Vector3,
	size: Vector3,
	kind: String,
	id: String,
	prompt: String,
	color: Color,
	payload: Variant = null
) -> StaticBody3D:
	var glow := Color(color.r, color.g, color.b, 1.0)
	var body := box(parent, position, size, material(color, 0.36, 0.45, glow), id, true) as StaticBody3D
	body.set_meta("interaction_kind", kind)
	body.set_meta("interaction_id", id)
	body.set_meta("interaction_prompt", prompt)
	body.set_meta("payload", payload)
	return body


static func add_light(
	parent: Node3D,
	position: Vector3,
	color: Color,
	energy: float,
	range_value: float,
	flicker: bool = false
) -> OmniLight3D:
	var light := OmniLight3D.new()
	light.position = position
	light.light_color = color
	light.light_energy = energy
	light.omni_range = range_value
	light.shadow_enabled = false
	light.distance_fade_enabled = true
	light.distance_fade_begin = range_value * 1.5
	light.distance_fade_length = range_value
	light.set_meta("base_energy", energy)
	light.set_meta("flicker", flicker)
	parent.add_child(light)
	return light


static func add_steam(parent: Node3D, position: Vector3, color: Color) -> GPUParticles3D:
	var particles := GPUParticles3D.new()
	particles.name = "Steam"
	particles.position = position
	particles.amount = 34
	particles.lifetime = 2.4
	particles.randomness = 0.52
	particles.visibility_aabb = AABB(Vector3(-3, -1, -3), Vector3(6, 8, 6))
	var process := ParticleProcessMaterial.new()
	process.emission_shape = ParticleProcessMaterial.EMISSION_SHAPE_BOX
	process.emission_box_extents = Vector3(0.35, 0.1, 0.35)
	process.direction = Vector3(0, 1, 0)
	process.spread = 18.0
	process.initial_velocity_min = 1.2
	process.initial_velocity_max = 2.8
	process.gravity = Vector3(0, 0.22, 0)
	process.scale_min = 0.55
	process.scale_max = 1.5
	particles.process_material = process
	var quad := QuadMesh.new()
	quad.size = Vector2(1.15, 1.15)
	var steam_material := StandardMaterial3D.new()
	steam_material.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	steam_material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	steam_material.billboard_mode = BaseMaterial3D.BILLBOARD_ENABLED
	steam_material.albedo_color = color
	quad.material = steam_material
	particles.draw_pass_1 = quad
	parent.add_child(particles)
	return particles


static func add_dust(parent: Node3D) -> GPUParticles3D:
	var particles := GPUParticles3D.new()
	particles.name = "DustMotes"
	particles.position = Vector3(0, 2.0, 0)
	particles.amount = 120
	particles.lifetime = 8.0
	particles.randomness = 1.0
	particles.visibility_aabb = AABB(Vector3(-42, -2, -40), Vector3(84, 10, 80))
	var process := ParticleProcessMaterial.new()
	process.emission_shape = ParticleProcessMaterial.EMISSION_SHAPE_BOX
	process.emission_box_extents = Vector3(36, 3, 32)
	process.direction = Vector3(0.2, 0.35, 0.1)
	process.spread = 180.0
	process.initial_velocity_min = 0.02
	process.initial_velocity_max = 0.11
	process.gravity = Vector3(0, 0.012, 0)
	particles.process_material = process
	var quad := QuadMesh.new()
	quad.size = Vector2(0.028, 0.028)
	var dust_material := StandardMaterial3D.new()
	dust_material.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	dust_material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	dust_material.billboard_mode = BaseMaterial3D.BILLBOARD_ENABLED
	dust_material.albedo_color = Color(0.54, 0.74, 0.77, 0.33)
	quad.material = dust_material
	particles.draw_pass_1 = quad
	parent.add_child(particles)
	return particles


static func build(parent: Node3D) -> Dictionary:
	var concrete := material(Color("18242b"), 0.95)
	var dark_concrete := material(Color("091117"), 0.98)
	var wet_metal := material(Color("26363a"), 0.27, 0.76)
	var brass := material(Color("6e5330"), 0.32, 0.83)
	var rust := material(Color("482419"), 0.88, 0.24)
	var safe_material := material(Color("173b38"), 0.67, 0.35, Color(0.04, 0.52, 0.45, 1))
	var water := StandardMaterial3D.new()
	water.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	water.albedo_color = Color(0.015, 0.10, 0.12, 0.74)
	water.metallic = 0.42
	water.roughness = 0.12

	# Continuous lower station floor and outer pressure shell.
	box(parent, Vector3(0, -0.35, 0), Vector3(78, 0.7, 72), concrete, "WetConcreteFloor")
	box(parent, Vector3(0, 3.4, -36), Vector3(78, 7.5, 0.8), dark_concrete, "NorthShell")
	box(parent, Vector3(0, 3.4, 36), Vector3(78, 7.5, 0.8), dark_concrete, "SouthShell")
	box(parent, Vector3(-39, 3.4, 0), Vector3(0.8, 7.5, 72), dark_concrete, "WestShell")
	box(parent, Vector3(39, 3.4, 0), Vector3(0.8, 7.5, 72), dark_concrete, "EastShell")
	box(parent, Vector3(0, 7.0, 0), Vector3(78, 0.45, 72), dark_concrete, "Ceiling", false)

	# Hub partitions: wide openings preserve clean navigation while retaining room reveals.
	for segment in [
		[Vector3(-15, 2.1, -10), Vector3(12, 4.2, 0.6)],
		[Vector3(15, 2.1, -10), Vector3(12, 4.2, 0.6)],
		[Vector3(-15, 2.1, 11), Vector3(12, 4.2, 0.6)],
		[Vector3(15, 2.1, 11), Vector3(12, 4.2, 0.6)],
		[Vector3(-13, 2.1, 0), Vector3(0.6, 4.2, 14)],
		[Vector3(13, 2.1, 0), Vector3(0.6, 4.2, 14)],
	]:
		box(parent, segment[0], segment[1], dark_concrete, "Partition")

	# Structural ribs, pipes, pump housings, and readable industrial silhouettes.
	for x in [-32.0, -24.0, -16.0, 16.0, 24.0, 32.0]:
		box(parent, Vector3(x, 2.4, -34.7), Vector3(0.7, 4.8, 1.5), brass, "PressureRib")
		box(parent, Vector3(x, 2.4, 34.7), Vector3(0.7, 4.8, 1.5), brass, "PressureRib")
	for x in [-30.0, -23.0, 23.0, 30.0]:
		cylinder(parent, Vector3(x, 1.0, -5), 0.78, 12.0, wet_metal, Vector3(0, 0, PI / 2.0), "TidalPipe")
		cylinder(parent, Vector3(x, 1.0, 5), 0.46, 12.0, rust, Vector3(0, 0, PI / 2.0), "ReturnPipe")
	for z in [-28.0, -21.0, 20.0, 28.0]:
		box(parent, Vector3(-29, 1.2, z), Vector3(4.8, 2.4, 3.2), wet_metal, "PumpHousing")
		cylinder(parent, Vector3(-29, 3.0, z), 1.0, 0.5, brass, Vector3(PI / 2.0, 0, 0), "PumpWheel")

	# Surface language and navigation dressing: lane paint, rails, conduit, and
	# readable station markings give the procedural architecture a built history.
	for stripe_index in range(13):
		var stripe_color := brass if stripe_index % 2 == 0 else dark_concrete
		box(parent, Vector3(-6.0 + stripe_index, 0.015, 12.0), Vector3(0.55, 0.03, 4.0), stripe_color, "HazardStripe", false)
	for lane_z in [-18.0, 0.0, 18.0]:
		box(parent, Vector3(0, 0.018, lane_z), Vector3(48, 0.025, 0.09), safe_material, "GuideLine", false)
	for cable_x in [-18.0, -6.0, 6.0, 18.0]:
		cylinder(parent, Vector3(cable_x, 6.55, 0), 0.075, 62.0, rust, Vector3(PI / 2.0, 0, 0), "CeilingConduit")
	for rail_z in [-9.0, 9.0]:
		for rail_x in [-35.0, -31.0, -27.0, -23.0, -19.0]:
			cylinder(parent, Vector3(rail_x, 0.75, rail_z), 0.055, 1.5, brass, Vector3.ZERO, "GuardPost")
		cylinder(parent, Vector3(-27.0, 1.3, rail_z), 0.065, 16.0, brass, Vector3(0, 0, PI / 2.0), "GuardRail")

	add_sign(parent, Vector3(0, 4.7, 35.5), "HUSHPOINT  /  LOWER STATION 03", Color("87c9c6"), Vector3(0, PI, 0), 58)
	add_sign(parent, Vector3(-11.9, 3.1, 3.2), "PUMP HALL  ←", Color("c49a62"), Vector3(0, PI / 2.0, 0), 42)
	add_sign(parent, Vector3(11.9, 3.1, 3.2), "→  RECORDS ANNEX", Color("6fc9c6"), Vector3(0, -PI / 2.0, 0), 42)
	add_sign(parent, Vector3(0, 3.2, -9.55), "COUNTERFLOW VAULT  /  AUTHORIZED CREW", Color("b7574d"), Vector3.ZERO, 38)
	add_sign(parent, Vector3(4.5, 2.8, 7.3), "QUIET ROOM", Color("78d4c6"), Vector3.ZERO, 38)

	# Work tables, sealed cases, and repair clutter break up boxy sightlines.
	for prop_data in [
		[Vector3(-8, 0.55, 24), Vector3(2.8, 1.1, 1.1), rust],
		[Vector3(15, 0.45, 23), Vector3(1.4, 0.9, 1.2), wet_metal],
		[Vector3(18, 0.3, -18), Vector3(1.2, 0.6, 1.0), brass],
		[Vector3(-17, 0.4, -16), Vector3(1.5, 0.8, 1.1), rust],
	]:
		box(parent, prop_data[0], prop_data[1], prop_data[2], "StationProp")

	# Shallow water communicates the Wader threat without fluid simulation.
	box(parent, Vector3(-27, -0.02, 12), Vector3(22, 0.08, 44), water, "PumpWater", false)
	box(parent, Vector3(27, -0.02, -18), Vector3(20, 0.08, 30), water, "ArchiveRunoff", false)

	# Safe room: visually warm, open entry, physical storage and recorder.
	box(parent, Vector3(4.5, 1.8, 7.5), Vector3(8.0, 3.6, 0.35), safe_material, "SafeRoomBack")
	box(parent, Vector3(0.7, 1.8, 4.2), Vector3(0.35, 3.6, 6.8), safe_material, "SafeRoomLeft")
	box(parent, Vector3(8.3, 1.8, 4.2), Vector3(0.35, 3.6, 6.8), safe_material, "SafeRoomRight")
	interactive_box(parent, Vector3(3.0, 0.75, 6.9), Vector3(1.1, 1.5, 0.65), "recorder", "safe_recorder", "E  RECORD CHECKPOINT", Color("38a99e"))
	interactive_box(parent, Vector3(6.2, 0.8, 6.9), Vector3(1.5, 1.6, 0.75), "storage", "safe_storage", "E  OPEN STORAGE", Color("577d7a"))
	interactive_box(parent, Vector3(1.9, 0.42, 6.2), Vector3(0.52, 0.28, 0.82), "pickup", "response_handgun", "E  TAKE RESPONSE HANDGUN", Color("7a817d"), "handgun")

	# Progression objects and physical puzzle controls.
	interactive_box(parent, Vector3(-2.0, 0.38, 29.0), Vector3(0.5, 0.5, 0.5), "pickup", "fuse_15a", "E  TAKE 15A CERAMIC FUSE", Color("e1ac52"), "fuse_15a")
	interactive_box(parent, Vector3(-20.0, 0.38, 18.0), Vector3(0.5, 0.5, 0.5), "pickup", "fuse_30a", "E  TAKE 30A CERAMIC FUSE", Color("e1ac52"), "fuse_30a")
	interactive_box(parent, Vector3(-7.0, 1.0, 9.7), Vector3(1.2, 2.0, 0.45), "fuse_panel", "emergency_power", "E  INSTALL MATCHED FUSE", Color("a54736"))
	interactive_box(parent, Vector3(19.0, 0.38, 7.0), Vector3(0.6, 0.25, 0.45), "pickup", "spool_a", "E  TAKE RED SPOOL: 01", Color("b73b35"), "spool_a")
	interactive_box(parent, Vector3(31.0, 0.38, -5.0), Vector3(0.6, 0.25, 0.45), "pickup", "spool_b", "E  TAKE RED SPOOL: 02", Color("b73b35"), "spool_b")
	interactive_box(parent, Vector3(-29.0, 0.38, -22.0), Vector3(0.6, 0.25, 0.45), "pickup", "spool_c", "E  TAKE RED SPOOL: 03", Color("b73b35"), "spool_c")
	interactive_box(parent, Vector3(31.0, 1.0, 8.5), Vector3(2.4, 2.0, 0.75), "spool_bench", "archive_splicer", "E  RECONSTRUCT MARA'S MESSAGE", Color("446f75"))

	for index in 3:
		var valve_id := "tide_valve_%d" % (index + 1)
		var valve := interactive_box(
			parent,
			Vector3(-33.0 + index * 6.0, 1.0, -28.0),
			Vector3(1.35, 1.35, 0.45),
			"tide_valve",
			valve_id,
			"E  TURN TIDE VALVE %d" % (index + 1),
			Color("a36938"),
			index + 1
		)
		valve.rotation.x = PI / 2.0
	interactive_box(parent, Vector3(-16.0, 0.8, -28.0), Vector3(1.2, 1.6, 0.7), "valve_reset", "tide_reset", "E  RESET TIDE MANIFOLD", Color("794b34"))

	var records_door := interactive_box(parent, Vector3(13.0, 1.7, 4.5), Vector3(0.8, 3.4, 4.4), "door", "records_door", "E  OPEN RECORDS BULKHEAD", Color("354d54"), "power")
	records_door.set_meta("closed_position", records_door.position)
	var vault_door := interactive_box(parent, Vector3(0, 1.9, -10), Vector3(5.4, 3.8, 0.8), "door", "vault_door", "E  USE HARMONIC SERVICE KEY", Color("6a4831"), "harmonic_key")
	vault_door.set_meta("closed_position", vault_door.position)
	var harmonic_key := interactive_box(parent, Vector3(-20.0, 0.46, -31.0), Vector3(0.35, 0.8, 0.25), "pickup", "harmonic_key", "E  TAKE HARMONIC SERVICE KEY", Color("dfb35f"), "harmonic_key")
	harmonic_key.visible = false
	harmonic_key.process_mode = Node.PROCESS_MODE_DISABLED
	harmonic_key.set_meta("locked_reward", true)

	for index in 3:
		interactive_box(
			parent,
			Vector3(-7.5 + index * 7.5, 1.0, -31.5),
			Vector3(1.1, 2.0, 0.65),
			"purge_breaker",
			"purge_%d" % (index + 1),
			"E  ENGAGE PURGE BREAKER %d" % (index + 1),
			Color("a52f2f"),
			index + 1
		)
	var surface_exit := interactive_box(
		parent,
		Vector3(0, 1.5, 32.6),
		Vector3(3.0, 3.0, 0.45),
		"surface_exit",
		"interior_surface_exit",
		"E  RETURN TO THE SURFACE",
		Color("355f66")
	)
	surface_exit.visible = false
	surface_exit.collision_layer = 0
	surface_exit.process_mode = Node.PROCESS_MODE_DISABLED

	for terminal_data in [
		[Vector3(8, 0.8, 29), "lore_quiet_night", "E  READ: QUIET NIGHT INCIDENT"],
		[Vector3(34, 0.8, 14), "lore_vesperite", "E  READ: VESPERITE TEST 12"],
		[Vector3(-34, 0.8, 14), "lore_mara", "E  READ: MARA ORR — LAST SHIFT"],
	]:
		interactive_box(parent, terminal_data[0], Vector3(0.75, 1.6, 0.5), "lore", terminal_data[1], terminal_data[2], Color("2d8f9a"))

	for pickup_data in [
		[Vector3(10, 0.25, 18), "ammo_dock", "ammo", "E  TAKE HANDGUN ROUNDS"],
		[Vector3(27, 0.25, 16), "ammo_records", "ammo", "E  TAKE HANDGUN ROUNDS"],
		[Vector3(-20, 0.25, 22), "heal_pump", "heal", "E  TAKE COAGULANT WRAP"],
		[Vector3(7, 0.25, -24), "flare_vault", "flare", "E  TAKE SIGNAL FLARE"],
	]:
		interactive_box(parent, pickup_data[0], Vector3(0.45, 0.35, 0.45), "pickup", pickup_data[1], pickup_data[3], Color("d0b269"), pickup_data[2])

	for steam_position in [Vector3(-20, 0.2, -15), Vector3(20, 0.2, -16), Vector3(0, 0.2, -26)]:
		add_steam(parent, steam_position, Color(0.64, 0.78, 0.79, 0.18))
		interactive_box(parent, steam_position + Vector3(1.3, 0.8, 0), Vector3(0.55, 1.6, 0.55), "steam_valve", "steam_%d" % parent.get_child_count(), "E  VENT PRESSURE", Color("815c38"))

	# Lighting palette: few cheap non-shadowed fixtures plus the player's shadowed lamp.
	var lights: Array[OmniLight3D] = []
	for light_data in [
		[Vector3(0, 4.5, 20), Color("cf843d"), 2.1, 15.0, true],
		[Vector3(0, 4.5, 0), Color("4aa7ad"), 1.35, 17.0, false],
		[Vector3(27, 4.2, 2), Color("b74a3f"), 1.65, 16.0, true],
		[Vector3(-27, 4.2, 2), Color("447f82"), 1.4, 16.0, false],
		[Vector3(0, 4.3, -25), Color("992d32"), 2.0, 18.0, true],
		[Vector3(4.5, 3.0, 4.0), Color("43b8a6"), 2.3, 9.0, false],
	]:
		lights.append(add_light(parent, light_data[0], light_data[1], light_data[2], light_data[3], light_data[4]))

	add_dust(parent)

	return {
		"lights": lights,
		"harmonic_key": harmonic_key,
		"surface_exit": surface_exit,
		"spawn_player": Vector3(0, 0.05, 30),
		"enemy_spawns": [
			{"kind": "listener", "position": Vector3(2, 0.05, 17)},
			{"kind": "listener", "position": Vector3(24, 0.05, 3)},
			{"kind": "wader", "position": Vector3(-25, 0.05, 13)},
			{"kind": "chorus", "position": Vector3(33, 1.1, -18)},
		],
		"bellman_spawn": Vector3(-2, 0.05, -30),
	}
