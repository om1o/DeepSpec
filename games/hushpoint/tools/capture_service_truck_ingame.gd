extends SceneTree

const MAIN_SCENE := preload("res://main.tscn")


func _initialize() -> void:
	call_deferred("_capture")


func _capture() -> void:
	var output_path := "res://assets/reports/hushpoint_service_truck_ingame.png"
	var arguments := OS.get_cmdline_user_args()
	if arguments.size() == 1:
		output_path = arguments[0]
	elif not arguments.is_empty():
		push_error("Usage: --script tools/capture_service_truck_ingame.gd -- [res://output.png]")
		quit(1)
		return

	DisplayServer.window_set_size(Vector2i(1280, 720))
	var game := MAIN_SCENE.instantiate()
	root.add_child(game)
	await process_frame
	await process_frame
	# The boot graph already contains a fresh surface state. Expose it directly so
	# this visual QA tool never creates, replaces, or reads the player's save file.
	game.mode = "playing"
	game.ui.show_gameplay()
	game._set_surface_mood(false)
	game._set_actor_activity(true)
	game.update_hud()
	game.player.set_control_enabled(false)
	for frame_index in range(24):
		await process_frame
	for interaction_id in ["surface_work_order", "surface_equipment"]:
		if not _rear_interaction_has_clear_ray(game, interaction_id):
			game.queue_free()
			await process_frame
			push_error("HUSHPOINT_INGAME_CAPTURE_FAIL occluded_interaction=%s" % interaction_id)
			quit(1)
			return
	if not await _live_camera_reaches_work_order(game):
		game.queue_free()
		await process_frame
		push_error("HUSHPOINT_INGAME_CAPTURE_FAIL live_camera_work_order_occluded")
		quit(1)
		return
	await RenderingServer.frame_post_draw
	var viewport_image := root.get_texture().get_image()
	var save_error := viewport_image.save_png(output_path)
	game.queue_free()
	await process_frame
	if save_error != OK:
		push_error("HUSHPOINT_INGAME_CAPTURE_FAIL path=%s error=%d" % [output_path, save_error])
		quit(1)
		return
	print("HUSHPOINT_INGAME_CAPTURE_PASS path=%s size=%dx%d" % [
		output_path,
		viewport_image.get_width(),
		viewport_image.get_height(),
	])
	quit(0)


func _rear_interaction_has_clear_ray(game: Node, interaction_id: String) -> bool:
	var interaction := _find_interaction(game, interaction_id)
	if not is_instance_valid(interaction):
		return false
	var start := interaction.global_position + Vector3(0, 0, 3.0)
	var query := PhysicsRayQueryParameters3D.create(start, interaction.global_position)
	query.collide_with_areas = false
	query.collide_with_bodies = true
	var hit := interaction.get_world_3d().direct_space_state.intersect_ray(query)
	return hit.get("collider") == interaction


func _live_camera_reaches_work_order(game: Node) -> bool:
	var work_order := _find_interaction(game, "surface_work_order")
	var player: CharacterBody3D = game.player
	if not is_instance_valid(work_order) or not is_instance_valid(player.camera):
		return false
	var original_position := player.global_position
	var original_yaw := float(player.get("_yaw_angle"))
	var original_pitch := float(player.get("_pitch_angle"))
	player.global_position = Vector3(
		work_order.global_position.x,
		work_order.global_position.y - 2.0,
		work_order.global_position.z + 0.34
	)
	player.velocity = Vector3.ZERO
	for iteration in range(14):
		var direction: Vector3 = (work_order.global_position - player.camera.global_position).normalized()
		player.set("_yaw_angle", lerp_angle(float(player.get("_yaw_angle")), atan2(-direction.x, -direction.z), 0.35))
		player.set("_pitch_angle", lerpf(float(player.get("_pitch_angle")), asin(clampf(direction.y, -0.99, 0.99)), 0.35))
		await physics_frame
		await process_frame
	var query := PhysicsRayQueryParameters3D.create(
		player.camera.global_position,
		player.camera.global_position - player.camera.global_basis.z * 3.8,
		1
	)
	query.exclude = [player.get_rid()]
	var hit := player.get_world_3d().direct_space_state.intersect_ray(query)
	var reached: bool = hit.get("collider") == work_order
	if not reached:
		var collider: Object = hit.get("collider")
		printerr("HUSHPOINT_CAMERA_RAY_DEBUG collider=%s camera=%s forward=%s hit=%s target=%s" % [
			collider.get_path() if is_instance_valid(collider) else "none",
			player.camera.global_position,
			-player.camera.global_basis.z,
			hit.get("position", Vector3.ZERO),
			work_order.global_position,
		])
	player.global_position = original_position
	player.velocity = Vector3.ZERO
	player.set("_yaw_angle", original_yaw)
	player.set("_pitch_angle", original_pitch)
	for frame_index in range(4):
		await physics_frame
		await process_frame
	return reached


func _find_interaction(game: Node, interaction_id: String) -> StaticBody3D:
	for body in game.find_children("*", "StaticBody3D", true, false):
		if str(body.get_meta("interaction_id", "")) == interaction_id:
			return body as StaticBody3D
	return null
