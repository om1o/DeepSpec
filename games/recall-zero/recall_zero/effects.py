"""Bounded screen-space effects for combat feedback."""

from __future__ import annotations

from dataclasses import dataclass
import math
import random

import pygame


MAX_PARTICLES = 320


@dataclass
class Particle:
    position: pygame.Vector2
    velocity: pygame.Vector2
    color: tuple[int, int, int]
    radius: float
    life: float
    total_life: float
    drag: float = 0.90


@dataclass
class Ring:
    position: pygame.Vector2
    color: tuple[int, int, int]
    start_radius: float
    end_radius: float
    life: float
    total_life: float
    width: int = 3


@dataclass
class FloatingText:
    position: pygame.Vector2
    text: str
    color: tuple[int, int, int]
    life: float
    total_life: float


class EffectsLayer:
    def __init__(self, seed: int = 0xE0) -> None:
        self.rng = random.Random(seed)
        self.particles: list[Particle] = []
        self.rings: list[Ring] = []
        self.text: list[FloatingText] = []

    def clear(self) -> None:
        self.particles.clear()
        self.rings.clear()
        self.text.clear()

    def burst(
        self,
        x: float,
        y: float,
        color: tuple[int, int, int],
        *,
        count: int = 12,
        speed: tuple[float, float] = (80.0, 260.0),
        life: tuple[float, float] = (0.18, 0.48),
        radius: tuple[float, float] = (1.5, 4.5),
    ) -> None:
        room = max(0, MAX_PARTICLES - len(self.particles))
        for _ in range(min(count, room)):
            angle = self.rng.random() * math.tau
            magnitude = self.rng.uniform(*speed)
            ttl = self.rng.uniform(*life)
            self.particles.append(
                Particle(
                    pygame.Vector2(x, y),
                    pygame.Vector2(math.cos(angle), math.sin(angle)) * magnitude,
                    color,
                    self.rng.uniform(*radius),
                    ttl,
                    ttl,
                )
            )

    def trail(
        self,
        x: float,
        y: float,
        color: tuple[int, int, int],
        velocity: pygame.Vector2,
        *,
        count: int = 2,
    ) -> None:
        room = max(0, MAX_PARTICLES - len(self.particles))
        for _ in range(min(count, room)):
            ttl = self.rng.uniform(0.10, 0.24)
            jitter = pygame.Vector2(self.rng.uniform(-25, 25), self.rng.uniform(-25, 25))
            self.particles.append(
                Particle(
                    pygame.Vector2(x, y),
                    -velocity * self.rng.uniform(0.02, 0.06) + jitter,
                    color,
                    self.rng.uniform(1.0, 2.8),
                    ttl,
                    ttl,
                    0.82,
                )
            )

    def ring(
        self,
        x: float,
        y: float,
        color: tuple[int, int, int],
        *,
        start: float = 8.0,
        end: float = 90.0,
        life: float = 0.35,
        width: int = 3,
    ) -> None:
        self.rings.append(Ring(pygame.Vector2(x, y), color, start, end, life, life, width))

    def label(self, x: float, y: float, text: str, color: tuple[int, int, int]) -> None:
        self.text.append(FloatingText(pygame.Vector2(x, y), text, color, 0.8, 0.8))

    def update(self, dt: float) -> None:
        for particle in self.particles:
            particle.life -= dt
            particle.position += particle.velocity * dt
            particle.velocity *= particle.drag ** (dt * 60.0)
            particle.radius = max(0.0, particle.radius - dt * 4.0)
        self.particles = [particle for particle in self.particles if particle.life > 0.0]

        for ring in self.rings:
            ring.life -= dt
        self.rings = [ring for ring in self.rings if ring.life > 0.0]

        for item in self.text:
            item.life -= dt
            item.position.y -= 34.0 * dt
        self.text = [item for item in self.text if item.life > 0.0]

    def draw(self, surface: pygame.Surface, font: pygame.font.Font, offset: pygame.Vector2) -> None:
        for particle in self.particles:
            alpha = max(0, min(255, int(255 * particle.life / particle.total_life)))
            color = (*particle.color, alpha)
            radius = max(1, int(particle.radius))
            point = particle.position + offset
            pygame.draw.circle(surface, color, (round(point.x), round(point.y)), radius)

        for ring in self.rings:
            progress = 1.0 - ring.life / ring.total_life
            eased = 1.0 - (1.0 - progress) ** 3
            radius = ring.start_radius + (ring.end_radius - ring.start_radius) * eased
            alpha = max(0, min(255, int(255 * (1.0 - progress))))
            point = ring.position + offset
            pygame.draw.circle(
                surface,
                (*ring.color, alpha),
                (round(point.x), round(point.y)),
                max(1, round(radius)),
                ring.width,
            )

        for item in self.text:
            alpha = max(0, min(255, int(255 * item.life / item.total_life)))
            rendered = font.render(item.text, True, item.color)
            rendered.set_alpha(alpha)
            rect = rendered.get_rect(center=(round(item.position.x + offset.x), round(item.position.y + offset.y)))
            surface.blit(rendered, rect)
