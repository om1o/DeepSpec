"""Procedural sound bank; RECALL//ZERO ships no third-party audio assets."""

from __future__ import annotations

from array import array
import math
import random
from typing import Callable

import pygame


SAMPLE_RATE = 44_100


class SoundBank:
    def __init__(self, muted: bool = False) -> None:
        self.muted = muted
        self.available = False
        self.sounds: dict[str, pygame.mixer.Sound] = {}
        self.ambient: pygame.mixer.Sound | None = None
        self.ambient_channel: pygame.mixer.Channel | None = None

        try:
            if pygame.mixer.get_init() is None:
                pygame.mixer.init(frequency=SAMPLE_RATE, size=-16, channels=1, buffer=512)
            self.sounds = {
                "throw": _tone(330, 760, 0.11, 0.32, triangle=True),
                "anchor": _tone(190, 150, 0.09, 0.20),
                "recall": _tone(880, 260, 0.17, 0.38, triangle=True),
                "hit": _noise_burst(0.045, 0.22, 2_800),
                "detonate": _chord((110, 165, 220), 0.16, 0.36),
                "perfect": _chord((220, 330, 440, 660), 0.34, 0.48),
                "dash": _noise_sweep(0.11, 0.25),
                "hurt": _tone(120, 58, 0.24, 0.42, triangle=True),
                "pickup": _tone(620, 1_120, 0.08, 0.24),
                "warning": _tone(96, 96, 0.18, 0.34, triangle=True),
                "upgrade": _chord((262, 330, 392), 0.31, 0.31),
                "victory": _arpeggio((262, 330, 392, 523), 0.72, 0.40),
                "defeat": _tone(190, 52, 0.65, 0.32, triangle=True),
                "menu": _tone(420, 540, 0.07, 0.16),
            }
            self.ambient = _ambient_loop()
            self.available = True
        except pygame.error:
            self.available = False

    def set_muted(self, muted: bool) -> None:
        self.muted = muted
        if self.ambient_channel:
            self.ambient_channel.set_volume(0.0 if muted else 0.12)

    def play(self, name: str, volume: float = 1.0) -> None:
        if not self.available or self.muted:
            return
        sound = self.sounds.get(name)
        if sound is None:
            return
        channel = sound.play()
        if channel:
            channel.set_volume(max(0.0, min(1.0, volume)))

    def start_ambient(self) -> None:
        if not self.available or self.ambient is None or self.ambient_channel is not None:
            return
        self.ambient_channel = self.ambient.play(loops=-1)
        if self.ambient_channel:
            self.ambient_channel.set_volume(0.0 if self.muted else 0.12)

    def stop(self) -> None:
        if self.ambient_channel:
            self.ambient_channel.fadeout(250)
            self.ambient_channel = None


def _render(duration: float, sample: Callable[[int, float], float]) -> pygame.mixer.Sound:
    count = max(1, int(SAMPLE_RATE * duration))
    pcm = array("h")
    for index in range(count):
        time = index / SAMPLE_RATE
        value = max(-1.0, min(1.0, sample(index, time)))
        pcm.append(int(value * 32_767))
    return pygame.mixer.Sound(buffer=pcm.tobytes())


def _envelope(index: int, count: int, attack: float = 0.05, release: float = 0.35) -> float:
    progress = index / max(1, count - 1)
    rise = min(1.0, progress / max(0.001, attack))
    fall = min(1.0, (1.0 - progress) / max(0.001, release))
    return rise * fall


def _tone(
    start_frequency: float,
    end_frequency: float,
    duration: float,
    volume: float,
    *,
    triangle: bool = False,
) -> pygame.mixer.Sound:
    count = max(1, int(SAMPLE_RATE * duration))

    def sample(index: int, time: float) -> float:
        progress = index / count
        frequency = start_frequency + (end_frequency - start_frequency) * progress
        phase = 2.0 * math.pi * frequency * time
        wave = 2.0 / math.pi * math.asin(math.sin(phase)) if triangle else math.sin(phase)
        return wave * volume * _envelope(index, count)

    return _render(duration, sample)


def _chord(frequencies: tuple[float, ...], duration: float, volume: float) -> pygame.mixer.Sound:
    count = max(1, int(SAMPLE_RATE * duration))

    def sample(index: int, time: float) -> float:
        waves = sum(math.sin(2.0 * math.pi * frequency * time) for frequency in frequencies)
        return waves / len(frequencies) * volume * _envelope(index, count, 0.03, 0.5)

    return _render(duration, sample)


def _noise_burst(duration: float, volume: float, low_pass: int) -> pygame.mixer.Sound:
    rng = random.Random(0xEC40)
    count = max(1, int(SAMPLE_RATE * duration))
    last = 0.0
    smoothing = min(0.95, low_pass / SAMPLE_RATE)

    def sample(index: int, _time: float) -> float:
        nonlocal last
        last += (rng.uniform(-1.0, 1.0) - last) * smoothing
        return last * volume * _envelope(index, count, 0.01, 0.9)

    return _render(duration, sample)


def _noise_sweep(duration: float, volume: float) -> pygame.mixer.Sound:
    rng = random.Random(0xDA54)
    count = max(1, int(SAMPLE_RATE * duration))
    last = 0.0

    def sample(index: int, _time: float) -> float:
        nonlocal last
        progress = index / count
        smoothing = 0.24 - 0.18 * progress
        last += (rng.uniform(-1.0, 1.0) - last) * smoothing
        return last * volume * _envelope(index, count, 0.01, 0.5)

    return _render(duration, sample)


def _arpeggio(frequencies: tuple[float, ...], duration: float, volume: float) -> pygame.mixer.Sound:
    count = max(1, int(SAMPLE_RATE * duration))
    segment = duration / len(frequencies)

    def sample(index: int, time: float) -> float:
        note_index = min(len(frequencies) - 1, int(time / segment))
        local_time = time - note_index * segment
        local_progress = local_time / segment
        envelope = math.sin(math.pi * min(1.0, local_progress))
        return math.sin(2.0 * math.pi * frequencies[note_index] * time) * volume * envelope

    return _render(duration, sample)


def _ambient_loop() -> pygame.mixer.Sound:
    duration = 4.0

    def sample(_index: int, time: float) -> float:
        fade = 0.5 - 0.5 * math.cos(2.0 * math.pi * time / duration)
        low = math.sin(2.0 * math.pi * 55.0 * time) * 0.06
        fifth = math.sin(2.0 * math.pi * 82.5 * time + 0.4) * 0.025
        shimmer = math.sin(2.0 * math.pi * 220.0 * time) * 0.008 * fade
        return low + fifth + shimmer

    return _render(duration, sample)
