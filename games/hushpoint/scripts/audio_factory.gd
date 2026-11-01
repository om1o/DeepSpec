class_name AudioFactory
extends RefCounted


static func tone(
	frequency: float,
	duration: float,
	volume: float = 0.35,
	decay: float = 3.0,
	noise_amount: float = 0.0,
	seed: int = 1
) -> AudioStreamWAV:
	var mix_rate := 22050
	var frames := maxi(1, int(duration * mix_rate))
	var data := PackedByteArray()
	data.resize(frames * 2)
	var rng := RandomNumberGenerator.new()
	rng.seed = seed
	for index in frames:
		var seconds := float(index) / float(mix_rate)
		var envelope := exp(-decay * seconds)
		var harmonic := sin(TAU * frequency * seconds)
		harmonic += sin(TAU * frequency * 0.503 * seconds) * 0.28
		var noise := rng.randf_range(-1.0, 1.0) * noise_amount
		var sample := clampf((harmonic * (1.0 - noise_amount) + noise) * envelope * volume, -1.0, 1.0)
		data.encode_s16(index * 2, int(sample * 32767.0))
	var stream := AudioStreamWAV.new()
	stream.format = AudioStreamWAV.FORMAT_16_BITS
	stream.mix_rate = mix_rate
	stream.stereo = false
	stream.data = data
	return stream

static func impact(seed: int = 4) -> AudioStreamWAV:
	return tone(74.0, 0.22, 0.72, 14.0, 0.72, seed)


static func bell() -> AudioStreamWAV:
	var mix_rate := 22050
	var duration := 2.2
	var frames := int(duration * mix_rate)
	var data := PackedByteArray()
	data.resize(frames * 2)
	for index in frames:
		var seconds := float(index) / float(mix_rate)
		var envelope := exp(-1.8 * seconds)
		var sample := (
			sin(TAU * 118.0 * seconds)
			+ sin(TAU * 237.3 * seconds) * 0.52
			+ sin(TAU * 361.0 * seconds) * 0.21
		) * envelope * 0.32
		data.encode_s16(index * 2, int(clampf(sample, -1.0, 1.0) * 32767.0))
	var stream := AudioStreamWAV.new()
	stream.format = AudioStreamWAV.FORMAT_16_BITS
	stream.mix_rate = mix_rate
	stream.stereo = false
	stream.data = data
	return stream


static func industrial_drone() -> AudioStreamWAV:
	var mix_rate := 22050
	var duration := 5.0
	var frames := int(duration * mix_rate)
	var data := PackedByteArray()
	data.resize(frames * 2)
	var rng := RandomNumberGenerator.new()
	rng.seed = 1978
	var filtered_noise := 0.0
	for index in frames:
		var seconds := float(index) / float(mix_rate)
		filtered_noise = lerpf(filtered_noise, rng.randf_range(-1.0, 1.0), 0.008)
		var pulse := 0.78 + sin(TAU * 0.13 * seconds) * 0.16
		var sample := (
			sin(TAU * 42.0 * seconds) * 0.16
			+ sin(TAU * 61.7 * seconds) * 0.09
			+ sin(TAU * 91.0 * seconds) * 0.035
			+ filtered_noise * 0.045
		) * pulse
		data.encode_s16(index * 2, int(clampf(sample, -1.0, 1.0) * 32767.0))
	var stream := AudioStreamWAV.new()
	stream.format = AudioStreamWAV.FORMAT_16_BITS
	stream.mix_rate = mix_rate
	stream.stereo = false
	stream.data = data
	stream.loop_mode = AudioStreamWAV.LOOP_FORWARD
	stream.loop_begin = 0
	stream.loop_end = frames
	return stream
