extends SceneTree


func _initialize() -> void:
	var arguments := OS.get_cmdline_user_args()
	if arguments.size() != 1:
		fail("Usage: --script tools/validate_godot_asset.gd -- res://path/to/asset.glb")
		return
	var asset_path := arguments[0]
	var resource := load(asset_path)
	if resource == null or not resource is PackedScene:
		fail("Godot could not load the GLB as a PackedScene: %s" % asset_path)
		return
	var instance := (resource as PackedScene).instantiate()
	if instance == null:
		fail("Godot could not instantiate the imported GLB: %s" % asset_path)
		return
	var mesh_count := count_meshes(instance)
	if mesh_count == 0:
		instance.queue_free()
		fail("Imported GLB contains no MeshInstance3D nodes: %s" % asset_path)
		return
	print("HUSHPOINT_GODOT_ASSET_PASS path=%s meshes=%d" % [asset_path, mesh_count])
	instance.queue_free()
	quit(0)


func count_meshes(node: Node) -> int:
	var total := 1 if node is MeshInstance3D else 0
	for child in node.get_children():
		total += count_meshes(child)
	return total


func fail(message: String) -> void:
	push_error("HUSHPOINT_GODOT_ASSET_FAIL %s" % message)
	quit(1)
