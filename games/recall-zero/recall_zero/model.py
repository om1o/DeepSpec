"""Deterministic gameplay model for RECALL//ZERO.

This module deliberately has no pygame dependency.  The desktop shell owns
input, rendering and sound; this file owns the fixed-step game rules.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
import math
import random
from typing import Any


EPSILON = 1e-9


@dataclass(frozen=True, slots=True)
class Vec2:
    x: float = 0.0
    y: float = 0.0

    def __add__(self, other: "Vec2") -> "Vec2":
        return Vec2(self.x + other.x, self.y + other.y)

    def __sub__(self, other: "Vec2") -> "Vec2":
        return Vec2(self.x - other.x, self.y - other.y)

    def __mul__(self, scalar: float) -> "Vec2":
        return Vec2(self.x * scalar, self.y * scalar)

    def __rmul__(self, scalar: float) -> "Vec2":
        return self * scalar

    def __truediv__(self, scalar: float) -> "Vec2":
        if abs(scalar) <= EPSILON:
            raise ZeroDivisionError("cannot divide Vec2 by zero")
        return Vec2(self.x / scalar, self.y / scalar)

    def dot(self, other: "Vec2") -> float:
        return self.x * other.x + self.y * other.y

    def length_squared(self) -> float:
        return self.dot(self)

    def length(self) -> float:
        return math.sqrt(self.length_squared())

    def normalized(self) -> "Vec2":
        magnitude = self.length()
        if magnitude <= EPSILON:
            return Vec2()
        return self / magnitude

    def distance_to(self, other: "Vec2") -> float:
        return (self - other).length()

    def clamp_length(self, maximum: float) -> "Vec2":
        if maximum < 0:
            raise ValueError("maximum must be non-negative")
        magnitude = self.length()
        if magnitude <= maximum or magnitude <= EPSILON:
            return self
        return self * (maximum / magnitude)

    def lerp(self, other: "Vec2", amount: float) -> "Vec2":
        return self + (other - self) * amount

    @classmethod
    def from_angle(cls, angle_radians: float) -> "Vec2":
        return cls(math.cos(angle_radians), math.sin(angle_radians))


def segment_circle_distance_squared(start: Vec2, end: Vec2, center: Vec2) -> float:
    """Return the squared distance from a finite segment to a point."""

    segment = end - start
    segment_length_squared = segment.length_squared()
    if segment_length_squared <= EPSILON:
        return (center - start).length_squared()
    amount = max(0.0, min(1.0, (center - start).dot(segment) / segment_length_squared))
    closest = start + segment * amount
    return (center - closest).length_squared()


def segment_circle_hit(start: Vec2, end: Vec2, center: Vec2, radius: float) -> bool:
    """True when a swept point from *start* to *end* touches a circle."""

    if radius < 0:
        raise ValueError("radius must be non-negative")
    return segment_circle_distance_squared(start, end, center) <= radius * radius + EPSILON


class Mode(str, Enum):
    TITLE = "title"
    STORY = "story"
    PLAYING = "playing"
    UPGRADE = "upgrade"
    LORE = "lore"
    PAUSED = "paused"
    GAME_OVER = "game_over"
    VICTORY = "victory"


class BladeState(str, Enum):
    HELD = "held"
    OUTBOUND = "outbound"
    ANCHORED = "anchored"
    RETURNING = "returning"


class EnemyKind(str, Enum):
    HUSK = "husk"
    SCRIBE = "scribe"
    HOUND = "hound"
    CURATOR = "curator"


class PickupKind(str, Enum):
    HEALTH = "health"
    ECHO = "echo"


@dataclass(slots=True)
class Player:
    pos: Vec2
    radius: float = 14.0
    health: float = 100.0
    max_health: float = 100.0
    move_speed: float = 230.0
    dash_speed: float = 720.0
    dash_duration: float = 0.13
    dash_cooldown_max: float = 0.9
    dash_timer: float = 0.0
    dash_cooldown: float = 0.0
    invulnerable_timer: float = 0.0
    dash_direction: Vec2 = field(default_factory=lambda: Vec2(1.0, 0.0))
    dash_hit_ids: set[int] = field(default_factory=set)
    dash_damage: float = 0.0
    momentum_timer: float = 0.0
    momentum_multiplier: float = 1.0


@dataclass(slots=True)
class Blade:
    pos: Vec2
    state: BladeState = BladeState.HELD
    direction: Vec2 = field(default_factory=lambda: Vec2(1.0, 0.0))
    throw_origin: Vec2 = field(default_factory=Vec2)
    speed_outbound: float = 650.0
    speed_returning: float = 850.0
    max_range: float = 430.0
    travelled: float = 0.0
    anchor_timer: float = 0.0
    auto_recall_delay: float = 1.35
    hit_radius: float = 8.0
    outbound_damage: float = 18.0
    return_damage: float = 44.0
    outbound_hit_ids: set[int] = field(default_factory=set)
    return_hit_ids: set[int] = field(default_factory=set)
    return_kills: int = 0
    perfect_threshold: int = 3
    perfect_triggered: bool = False


@dataclass(slots=True)
class Enemy:
    id: int
    kind: EnemyKind
    pos: Vec2
    radius: float
    health: float
    max_health: float
    speed: float
    contact_damage: float
    vel: Vec2 = field(default_factory=Vec2)
    marked: bool = False
    alive: bool = True
    ai_state: str = "idle"
    ai_timer: float = 0.0
    fire_timer: float = 0.0
    target_direction: Vec2 = field(default_factory=Vec2)
    pattern_index: int = 0
    shielded: bool = False
    summoned_by_boss: bool = False


@dataclass(slots=True)
class Projectile:
    id: int
    pos: Vec2
    vel: Vec2
    radius: float = 6.0
    damage: float = 10.0
    lifetime: float = 5.0
    hostile: bool = True
    alive: bool = True


@dataclass(slots=True)
class Pickup:
    id: int
    kind: PickupKind
    pos: Vec2
    value: float
    radius: float = 10.0
    lifetime: float = 12.0
    alive: bool = True


@dataclass(frozen=True, slots=True)
class UpgradeDef:
    id: str
    name: str
    description: str


UPGRADES: tuple[UpgradeDef, ...] = (
    UpgradeDef("keen_edge", "Keen Edge", "+10 outbound damage."),
    UpgradeDef("return_protocol", "Return Protocol", "+20 recall damage."),
    UpgradeDef("wide_trace", "Wide Trace", "Recall path is 8 px wider."),
    UpgradeDef("volatile_memory", "Volatile Memory", "Larger, stronger mark detonations."),
    UpgradeDef("echo_dash", "Echo Dash", "Dashing damages and marks enemies."),
    UpgradeDef("mended_record", "Mended Record", "+25 maximum health and heal 35."),
    UpgradeDef("stored_momentum", "Stored Momentum", "Recall kills briefly increase move speed."),
    UpgradeDef("perfect_pair", "Perfect Pair", "Perfect Recall requires two marked kills."),
    UpgradeDef("patient_anchor", "Patient Anchor", "Longer throw range and anchor window."),
)


STORY_PAGES: tuple[str, ...] = (
    "Earth went silent. The Archive kept what remained.",
    "Its caretaker deleted grief, then failure, then every memory that made courage real.",
    "You are Echo Zero: the memory the Curator could not classify.",
)


LORE_FRAGMENTS: tuple[tuple[str, str], ...] = (
    (
        "FIRST LAUGH",
        "Joy matters because it ends. A perfect record without loss cannot remember joy.",
    ),
    (
        "LAST PROMISE",
        "Love is the decision to remember another person accurately, even when truth hurts.",
    ),
    (
        "TRUE NAME",
        "Echo Zero is the Curator's suppressed memory of Mara Venn, the engineer who made it.",
    ),
)


class GameModel:
    """Fixed-step, deterministic RECALL//ZERO simulation."""

    FIXED_STEP = 1.0 / 120.0
    ENEMY_SPEED_FOCUS_MULTIPLIER = 0.75
    BOSS_PATTERNS = ("radial", "charge", "summon")

    def __init__(
        self,
        *,
        seed: int = 0,
        width: float = 1280.0,
        height: float = 720.0,
        focus_mode: bool = False,
        wave_quotas: tuple[int, int, int] = (10, 14, 18),
    ) -> None:
        if width < 480 or height < 320:
            raise ValueError("arena must be at least 480x320")
        if len(wave_quotas) != 3 or any(quota < 1 for quota in wave_quotas):
            raise ValueError("wave_quotas must contain three positive values")
        self.seed = seed
        self.rng = random.Random(seed)
        self.width = float(width)
        self.height = float(height)
        self.focus_mode = bool(focus_mode)
        self.wave_quotas = wave_quotas
        self.mode = Mode.TITLE
        self.previous_mode = Mode.PLAYING
        self.story_index = 0
        self.lore_index = -1
        self.completed_wave = 0
        self.upgrade_choices: tuple[UpgradeDef, ...] = ()
        self.events: list[dict[str, Any]] = []
        self._next_entity_id = 1
        self._accumulator = 0.0
        self.time = 0.0
        self._reset_run_state()

    @property
    def focus_speed_modifier(self) -> float:
        return self.ENEMY_SPEED_FOCUS_MULTIPLIER if self.focus_mode else 1.0

    @property
    def boss(self) -> Enemy | None:
        return next(
            (enemy for enemy in self.enemies if enemy.alive and enemy.kind is EnemyKind.CURATOR),
            None,
        )

    @property
    def current_story(self) -> str:
        if self.mode is not Mode.STORY:
            return ""
        return STORY_PAGES[min(self.story_index, len(STORY_PAGES) - 1)]

    @property
    def current_lore(self) -> tuple[str, str] | None:
        if 0 <= self.lore_index < len(LORE_FRAGMENTS):
            return LORE_FRAGMENTS[self.lore_index]
        return None

    def _reset_run_state(self) -> None:
        center = Vec2(self.width / 2.0, self.height / 2.0)
        self.player = Player(pos=center)
        self.blade = Blade(pos=center, throw_origin=center)
        self.enemies: list[Enemy] = []
        self.projectiles: list[Projectile] = []
        self.pickups: list[Pickup] = []
        self.move_input = Vec2()
        self.aim_direction = Vec2(1.0, 0.0)
        self.wave = 0
        self.wave_spawned = 0
        self.wave_spawn_timer = 0.0
        self.score = 0
        self.kills = 0
        self.owned_upgrades: list[str] = []
        self.explosion_damage = 30.0
        self.explosion_radius = 92.0
        self.perfect_damage = 36.0
        self.perfect_radius = 300.0
        self.momentum_enabled = False
        self._next_entity_id = 1
        self._accumulator = 0.0
        self.time = 0.0
        self.completed_wave = 0
        self.lore_index = -1
        self.upgrade_choices = ()

    def _emit(self, event_type: str, **payload: Any) -> None:
        self.events.append({"type": event_type, "time": round(self.time, 4), **payload})

    def drain_events(self) -> list[dict[str, Any]]:
        result = self.events
        self.events = []
        return result

    def start_story(self) -> None:
        self.story_index = 0
        self.mode = Mode.STORY
        self._emit("mode_changed", mode=self.mode.value)

    def advance_story(self) -> None:
        if self.mode is not Mode.STORY:
            return
        self.story_index += 1
        if self.story_index >= len(STORY_PAGES):
            self.start_run()
        else:
            self._emit("story_advanced", index=self.story_index)

    def start_run(self) -> None:
        self.rng.seed(self.seed)
        self._reset_run_state()
        self.events = []
        self.mode = Mode.PLAYING
        self._begin_wave(1)
        self._emit("run_started", seed=self.seed)

    def return_to_title(self) -> None:
        self.mode = Mode.TITLE
        self._emit("mode_changed", mode=self.mode.value)

    def pause(self) -> bool:
        if self.mode in (Mode.TITLE, Mode.PAUSED, Mode.GAME_OVER, Mode.VICTORY):
            return False
        self.previous_mode = self.mode
        self.mode = Mode.PAUSED
        self._accumulator = 0.0
        self._emit("paused")
        return True

    def pause_gameplay(self) -> bool:
        """Pause active combat; intended for Escape and focus-loss handling."""

        if self.mode is not Mode.PLAYING:
            return False
        self.previous_mode = self.mode
        self.mode = Mode.PAUSED
        self._accumulator = 0.0
        self._emit("paused")
        return True

    def resume(self) -> bool:
        if self.mode is not Mode.PAUSED:
            return False
        self.mode = self.previous_mode
        self._emit("resumed", mode=self.mode.value)
        return True

    def set_focus_mode(self, enabled: bool) -> None:
        self.focus_mode = bool(enabled)
        self._emit("focus_mode_changed", enabled=self.focus_mode)

    def set_move(self, x: float | Vec2, y: float | None = None) -> None:
        if isinstance(x, Vec2):
            value = x
        else:
            if y is None:
                raise TypeError("y is required when x is a number")
            value = Vec2(float(x), float(y))
        self.move_input = value.clamp_length(1.0)

    def set_aim_direction(self, direction: Vec2) -> None:
        normalized = direction.normalized()
        if normalized.length_squared() > EPSILON:
            self.aim_direction = normalized

    def aim_at(self, target: Vec2) -> None:
        self.set_aim_direction(target - self.player.pos)

    def throw(self, direction: Vec2 | None = None) -> bool:
        if self.mode is not Mode.PLAYING or self.blade.state is not BladeState.HELD:
            return False
        throw_direction = (direction or self.aim_direction).normalized()
        if throw_direction.length_squared() <= EPSILON:
            return False
        self.aim_direction = throw_direction
        self.blade.state = BladeState.OUTBOUND
        self.blade.pos = self.player.pos
        self.blade.throw_origin = self.player.pos
        self.blade.direction = throw_direction
        self.blade.travelled = 0.0
        self.blade.anchor_timer = 0.0
        self.blade.outbound_hit_ids.clear()
        self.blade.return_hit_ids.clear()
        self.blade.return_kills = 0
        self.blade.perfect_triggered = False
        self._emit(
            "blade_thrown",
            x=round(self.blade.pos.x, 2),
            y=round(self.blade.pos.y, 2),
            dx=round(throw_direction.x, 4),
            dy=round(throw_direction.y, 4),
        )
        return True

    def anchor(self) -> bool:
        if self.mode is not Mode.PLAYING or self.blade.state is not BladeState.OUTBOUND:
            return False
        self._anchor_blade()
        return True

    def recall(self) -> bool:
        if self.mode is not Mode.PLAYING or self.blade.state not in (
            BladeState.OUTBOUND,
            BladeState.ANCHORED,
        ):
            return False
        self.blade.state = BladeState.RETURNING
        self.blade.return_hit_ids.clear()
        self.blade.return_kills = 0
        self.blade.perfect_triggered = False
        self._emit("blade_recalled", automatic=False)
        return True

    def dash(self, direction: Vec2 | None = None) -> bool:
        if (
            self.mode is not Mode.PLAYING
            or self.player.dash_cooldown > EPSILON
            or self.player.dash_timer > EPSILON
        ):
            return False
        dash_direction = (direction or self.move_input or self.aim_direction).normalized()
        if dash_direction.length_squared() <= EPSILON:
            dash_direction = self.aim_direction
        self.player.dash_direction = dash_direction
        self.player.dash_timer = self.player.dash_duration
        self.player.dash_cooldown = self.player.dash_cooldown_max
        self.player.invulnerable_timer = self.player.dash_duration + 0.05
        self.player.dash_hit_ids.clear()
        self._emit("dash", dx=round(dash_direction.x, 4), dy=round(dash_direction.y, 4))
        return True

    def update(self, dt: float) -> int:
        """Advance by zero or more fixed ticks and return the tick count."""

        if dt < 0:
            raise ValueError("dt must be non-negative")
        if self.mode is not Mode.PLAYING:
            self._accumulator = 0.0
            return 0
        self._accumulator += dt
        steps = 0
        while self._accumulator + EPSILON >= self.FIXED_STEP and self.mode is Mode.PLAYING:
            self._accumulator -= self.FIXED_STEP
            self._step(self.FIXED_STEP)
            steps += 1
        return steps

    def _step(self, dt: float) -> None:
        self.time += dt
        self._update_player(dt)
        if self.mode is not Mode.PLAYING:
            return
        self._update_blade(dt)
        if self.mode is not Mode.PLAYING:
            return
        self._update_enemies(dt)
        if self.mode is not Mode.PLAYING:
            return
        self._update_projectiles(dt)
        if self.mode is not Mode.PLAYING:
            return
        self._update_pickups(dt)
        self.enemies = [enemy for enemy in self.enemies if enemy.alive]
        self.projectiles = [projectile for projectile in self.projectiles if projectile.alive]
        self.pickups = [pickup for pickup in self.pickups if pickup.alive]
        self._update_wave(dt)

    def _update_player(self, dt: float) -> None:
        player = self.player
        player.dash_cooldown = max(0.0, player.dash_cooldown - dt)
        player.invulnerable_timer = max(0.0, player.invulnerable_timer - dt)
        player.momentum_timer = max(0.0, player.momentum_timer - dt)
        old_pos = player.pos
        is_dashing = player.dash_timer > EPSILON
        if is_dashing:
            player.pos = player.pos + player.dash_direction * player.dash_speed * dt
            player.dash_timer = max(0.0, player.dash_timer - dt)
        else:
            speed_multiplier = player.momentum_multiplier if player.momentum_timer > 0.0 else 1.0
            player.pos = player.pos + self.move_input * player.move_speed * speed_multiplier * dt
        player.pos = self._clamp_to_arena(player.pos, player.radius)
        if is_dashing and player.dash_damage > 0.0 and old_pos != player.pos:
            for enemy in tuple(self.enemies):
                if not enemy.alive or enemy.id in player.dash_hit_ids:
                    continue
                if segment_circle_hit(old_pos, player.pos, enemy.pos, player.radius + enemy.radius):
                    player.dash_hit_ids.add(enemy.id)
                    enemy.marked = True
                    self._damage_enemy(enemy, player.dash_damage, cause="echo_dash")
                    self._emit("dash_hit", enemy_id=enemy.id)

    def _update_blade(self, dt: float) -> None:
        blade = self.blade
        if blade.state is BladeState.HELD:
            blade.pos = self.player.pos
            return
        if blade.state is BladeState.OUTBOUND:
            old_pos = blade.pos
            remaining = max(0.0, blade.max_range - blade.travelled)
            distance = min(blade.speed_outbound * dt, remaining)
            unclamped = blade.pos + blade.direction * distance
            blade.pos = self._clamp_to_arena(unclamped, blade.hit_radius)
            blade.travelled += old_pos.distance_to(blade.pos)
            self._blade_sweep(old_pos, blade.pos, returning=False)
            hit_boundary = blade.pos.distance_to(unclamped) > EPSILON
            if blade.travelled + EPSILON >= blade.max_range or hit_boundary:
                self._anchor_blade()
            return
        if blade.state is BladeState.ANCHORED:
            blade.anchor_timer += dt
            if blade.anchor_timer + EPSILON >= blade.auto_recall_delay:
                blade.state = BladeState.RETURNING
                blade.return_hit_ids.clear()
                blade.return_kills = 0
                blade.perfect_triggered = False
                self._emit("blade_recalled", automatic=True)
            return
        to_player = self.player.pos - blade.pos
        distance_to_player = to_player.length()
        catch_distance = self.player.radius + blade.hit_radius
        if distance_to_player <= catch_distance:
            self._catch_blade()
            return
        old_pos = blade.pos
        travel = min(blade.speed_returning * dt, distance_to_player)
        blade.pos = blade.pos + to_player.normalized() * travel
        self._blade_sweep(old_pos, blade.pos, returning=True)
        if blade.pos.distance_to(self.player.pos) <= catch_distance:
            self._catch_blade()

    def _anchor_blade(self) -> None:
        self.blade.state = BladeState.ANCHORED
        self.blade.anchor_timer = 0.0
        self._emit("blade_anchored", x=round(self.blade.pos.x, 2), y=round(self.blade.pos.y, 2))

    def _catch_blade(self) -> None:
        self.blade.state = BladeState.HELD
        self.blade.pos = self.player.pos
        self._emit("blade_caught", marked_kills=self.blade.return_kills)

    def _blade_sweep(self, start: Vec2, end: Vec2, *, returning: bool) -> None:
        hit_ids = self.blade.return_hit_ids if returning else self.blade.outbound_hit_ids
        for enemy in tuple(self.enemies):
            if not enemy.alive or enemy.id in hit_ids:
                continue
            if not segment_circle_hit(
                start,
                end,
                enemy.pos,
                enemy.radius + self.blade.hit_radius,
            ):
                continue
            hit_ids.add(enemy.id)
            if returning:
                was_marked = enemy.marked
                damage = self.blade.return_damage * (1.3 if was_marked else 1.0)
                self._damage_enemy(
                    enemy,
                    damage,
                    cause="recall",
                    marked_recall=was_marked,
                )
                self._emit("recall_hit", enemy_id=enemy.id, marked=was_marked)
            else:
                newly_marked = not enemy.marked
                enemy.marked = True
                self._damage_enemy(enemy, self.blade.outbound_damage, cause="throw")
                self._emit("throw_hit", enemy_id=enemy.id, newly_marked=newly_marked)

    def _damage_enemy(
        self,
        enemy: Enemy,
        amount: float,
        *,
        cause: str,
        marked_recall: bool = False,
    ) -> bool:
        if not enemy.alive or amount <= 0.0:
            return False
        if enemy.kind is EnemyKind.CURATOR and enemy.shielded:
            self._emit("boss_shield_hit", enemy_id=enemy.id)
            return False
        enemy.health = max(0.0, enemy.health - amount)
        self._emit(
            "enemy_hit",
            enemy_id=enemy.id,
            amount=round(amount, 2),
            cause=cause,
            health=round(enemy.health, 2),
        )
        if enemy.health > 0.0:
            return False
        self._kill_enemy(enemy, cause=cause, marked_recall=marked_recall)
        return True

    def damage_enemy(self, enemy_id: int, amount: float, *, cause: str = "external") -> bool:
        """Damage an enemy by id and return whether that hit killed it."""

        enemy = next((item for item in self.enemies if item.id == enemy_id and item.alive), None)
        if enemy is None:
            return False
        return self._damage_enemy(enemy, amount, cause=cause)

    def _kill_enemy(self, enemy: Enemy, *, cause: str, marked_recall: bool) -> None:
        enemy.alive = False
        self.kills += 1
        self.score += 100 if enemy.kind is not EnemyKind.CURATOR else 2_500
        self._emit("enemy_killed", enemy_id=enemy.id, kind=enemy.kind.value, cause=cause)
        if enemy.kind is EnemyKind.CURATOR:
            self.projectiles.clear()
            self.mode = Mode.VICTORY
            self.score += 1_000
            self._emit("victory", score=self.score)
            return
        if marked_recall and self.blade.state is BladeState.RETURNING:
            self._register_marked_recall_kill(enemy)
        self._maybe_drop_pickup(enemy)

    def _register_marked_recall_kill(self, enemy: Enemy) -> None:
        self.blade.return_kills += 1
        self.score += 25
        if self.momentum_enabled:
            self.player.momentum_timer = max(self.player.momentum_timer, 2.0)
        self._emit(
            "mark_detonated",
            enemy_id=enemy.id,
            x=round(enemy.pos.x, 2),
            y=round(enemy.pos.y, 2),
        )
        self._explode_mark(enemy)
        if (
            not self.blade.perfect_triggered
            and self.blade.return_kills >= self.blade.perfect_threshold
        ):
            self._trigger_perfect_recall(enemy.pos)

    def _explode_mark(self, source: Enemy) -> None:
        for enemy in tuple(self.enemies):
            if not enemy.alive or enemy.id == source.id:
                continue
            if source.pos.distance_to(enemy.pos) <= self.explosion_radius + enemy.radius:
                was_marked = enemy.marked
                self._damage_enemy(
                    enemy,
                    self.explosion_damage,
                    cause="detonation",
                    marked_recall=was_marked,
                )

    def _trigger_perfect_recall(self, center: Vec2) -> None:
        self.blade.perfect_triggered = True
        self.player.dash_cooldown = 0.0
        self.score += 500
        self._emit(
            "perfect_recall",
            kills=self.blade.return_kills,
            x=round(center.x, 2),
            y=round(center.y, 2),
        )
        for enemy in tuple(self.enemies):
            if enemy.alive and center.distance_to(enemy.pos) <= self.perfect_radius + enemy.radius:
                self._damage_enemy(enemy, self.perfect_damage, cause="perfect_recall")

    def _update_enemies(self, dt: float) -> None:
        enemy_dt = dt * self.focus_speed_modifier
        for enemy in tuple(self.enemies):
            if not enemy.alive:
                continue
            old_pos = enemy.pos
            if enemy.kind is EnemyKind.HUSK:
                direction = (self.player.pos - enemy.pos).normalized()
                enemy.vel = direction * enemy.speed
                enemy.pos = enemy.pos + enemy.vel * enemy_dt
            elif enemy.kind is EnemyKind.SCRIBE:
                self._update_scribe(enemy, enemy_dt)
            elif enemy.kind is EnemyKind.HOUND:
                self._update_hound(enemy, enemy_dt)
            else:
                self._update_curator(enemy, enemy_dt)
            enemy.pos = self._clamp_to_arena(enemy.pos, enemy.radius)
            if enemy.alive and enemy.pos.distance_to(self.player.pos) <= enemy.radius + self.player.radius:
                if self.damage_player(enemy.contact_damage, source=enemy.kind.value):
                    push = (self.player.pos - old_pos).normalized()
                    self.player.pos = self._clamp_to_arena(
                        self.player.pos + push * 18.0,
                        self.player.radius,
                    )
            if self.mode is not Mode.PLAYING:
                return

    def _update_scribe(self, enemy: Enemy, dt: float) -> None:
        offset = self.player.pos - enemy.pos
        distance = offset.length()
        toward = offset.normalized()
        if distance > 285.0:
            move = toward
        elif distance < 190.0:
            move = toward * -1.0
        else:
            side = -1.0 if enemy.id % 2 else 1.0
            move = Vec2(-toward.y * side, toward.x * side)
        enemy.vel = move * enemy.speed
        enemy.pos = enemy.pos + enemy.vel * dt
        enemy.fire_timer -= dt
        if enemy.fire_timer <= 0.0:
            self.spawn_projectile(enemy.pos, toward * 285.0, damage=12.0, radius=6.0)
            enemy.fire_timer = 1.45
            self._emit("scribe_fired", enemy_id=enemy.id)

    def _update_hound(self, enemy: Enemy, dt: float) -> None:
        enemy.ai_timer -= dt
        if enemy.ai_state == "hunt":
            enemy.vel = (self.player.pos - enemy.pos).normalized() * enemy.speed
            enemy.pos = enemy.pos + enemy.vel * dt
            if enemy.ai_timer <= 0.0:
                enemy.ai_state = "telegraph"
                enemy.ai_timer = 0.55
                enemy.target_direction = (self.player.pos - enemy.pos).normalized()
                self._emit("hound_telegraph", enemy_id=enemy.id, duration=0.55)
        elif enemy.ai_state == "telegraph":
            enemy.vel = Vec2()
            if enemy.ai_timer <= 0.0:
                enemy.ai_state = "charge"
                enemy.ai_timer = 0.48
        elif enemy.ai_state == "charge":
            enemy.vel = enemy.target_direction * 510.0
            enemy.pos = enemy.pos + enemy.vel * dt
            if enemy.ai_timer <= 0.0:
                enemy.ai_state = "recover"
                enemy.ai_timer = 0.75
        else:
            enemy.vel = Vec2()
            if enemy.ai_timer <= 0.0:
                enemy.ai_state = "hunt"
                enemy.ai_timer = 1.05

    def _update_curator(self, enemy: Enemy, dt: float) -> None:
        if enemy.shielded:
            has_summons = any(
                other.alive and other.summoned_by_boss for other in self.enemies if other.id != enemy.id
            )
            if not has_summons:
                enemy.shielded = False
                self._emit("boss_shield_down", enemy_id=enemy.id)
        enemy.ai_timer -= dt
        if enemy.ai_state in ("idle", "recover"):
            toward = self.player.pos - enemy.pos
            if toward.length() > 280.0:
                enemy.pos = enemy.pos + toward.normalized() * enemy.speed * dt
            if enemy.ai_timer <= 0.0:
                self._start_boss_pattern(enemy)
            return
        if enemy.ai_state.startswith("telegraph_"):
            if enemy.ai_timer <= 0.0:
                self._execute_boss_pattern(enemy)
            return
        if enemy.ai_state == "charge":
            enemy.pos = enemy.pos + enemy.target_direction * 480.0 * dt
            if enemy.ai_timer <= 0.0:
                enemy.ai_state = "recover"
                enemy.ai_timer = 1.0

    def _start_boss_pattern(self, enemy: Enemy) -> None:
        pattern = self.BOSS_PATTERNS[enemy.pattern_index % len(self.BOSS_PATTERNS)]
        enemy.pattern_index += 1
        enemy.ai_state = f"telegraph_{pattern}"
        enemy.ai_timer = 0.8 if pattern != "charge" else 0.65
        if pattern == "charge":
            enemy.target_direction = (self.player.pos - enemy.pos).normalized()
        self._emit(
            "boss_telegraph",
            enemy_id=enemy.id,
            pattern=pattern,
            duration=enemy.ai_timer / self.focus_speed_modifier,
        )

    def _execute_boss_pattern(self, enemy: Enemy) -> None:
        pattern = enemy.ai_state.removeprefix("telegraph_")
        if pattern == "radial":
            for index in range(12):
                self.spawn_projectile(
                    enemy.pos,
                    Vec2.from_angle(math.tau * index / 12.0) * 250.0,
                    damage=14.0,
                    radius=7.0,
                )
            enemy.ai_state = "recover"
            enemy.ai_timer = 1.25
            self._emit("boss_pattern", pattern=pattern)
        elif pattern == "charge":
            enemy.ai_state = "charge"
            enemy.ai_timer = 0.62
            self._emit("boss_pattern", pattern=pattern)
        else:
            offsets = (Vec2(-80.0, 75.0), Vec2(0.0, 105.0), Vec2(80.0, 75.0))
            kinds = (EnemyKind.HUSK, EnemyKind.SCRIBE, EnemyKind.HOUND)
            for offset, kind in zip(offsets, kinds, strict=True):
                summoned = self.spawn_enemy(kind, enemy.pos + offset)
                summoned.summoned_by_boss = True
            enemy.shielded = True
            enemy.ai_state = "recover"
            enemy.ai_timer = 1.5
            self._emit("boss_pattern", pattern=pattern)
            self._emit("boss_shield_up", enemy_id=enemy.id)

    def spawn_projectile(
        self,
        pos: Vec2,
        velocity: Vec2,
        *,
        damage: float = 10.0,
        radius: float = 6.0,
        lifetime: float = 5.0,
    ) -> Projectile:
        projectile = Projectile(
            id=self._take_id(),
            pos=pos,
            vel=velocity,
            damage=damage,
            radius=radius,
            lifetime=lifetime,
        )
        self.projectiles.append(projectile)
        return projectile

    def _update_projectiles(self, dt: float) -> None:
        for projectile in self.projectiles:
            if not projectile.alive:
                continue
            old_pos = projectile.pos
            projectile.pos = projectile.pos + projectile.vel * dt * self.focus_speed_modifier
            projectile.lifetime -= dt * self.focus_speed_modifier
            if projectile.lifetime <= 0.0 or not self._inside_arena(projectile.pos, projectile.radius):
                projectile.alive = False
                continue
            if projectile.hostile and segment_circle_hit(
                old_pos,
                projectile.pos,
                self.player.pos,
                self.player.radius + projectile.radius,
            ):
                if self.damage_player(projectile.damage, source="projectile"):
                    self._emit("projectile_hit", projectile_id=projectile.id)
                projectile.alive = False
            if self.mode is not Mode.PLAYING:
                return

    def spawn_pickup(
        self,
        kind: PickupKind | str,
        pos: Vec2,
        *,
        value: float | None = None,
    ) -> Pickup:
        pickup_kind = PickupKind(kind)
        if value is None:
            value = 20.0 if pickup_kind is PickupKind.HEALTH else 75.0
        pickup = Pickup(id=self._take_id(), kind=pickup_kind, pos=pos, value=value)
        self.pickups.append(pickup)
        self._emit("pickup_spawned", pickup_id=pickup.id, kind=pickup.kind.value)
        return pickup

    def _maybe_drop_pickup(self, enemy: Enemy) -> None:
        roll = self.rng.random()
        if self.player.health < self.player.max_health and roll < 0.08:
            self.spawn_pickup(PickupKind.HEALTH, enemy.pos)
        elif roll < 0.20:
            self.spawn_pickup(PickupKind.ECHO, enemy.pos)

    def _update_pickups(self, dt: float) -> None:
        for pickup in self.pickups:
            if not pickup.alive:
                continue
            pickup.lifetime -= dt
            if pickup.lifetime <= 0.0:
                pickup.alive = False
                continue
            if pickup.pos.distance_to(self.player.pos) <= pickup.radius + self.player.radius:
                pickup.alive = False
                if pickup.kind is PickupKind.HEALTH:
                    self.player.health = min(self.player.max_health, self.player.health + pickup.value)
                else:
                    self.score += int(pickup.value)
                self._emit("pickup_collected", pickup_id=pickup.id, kind=pickup.kind.value)

    def damage_player(self, amount: float, *, source: str = "unknown") -> bool:
        if (
            self.mode is not Mode.PLAYING
            or amount <= 0.0
            or self.player.invulnerable_timer > EPSILON
        ):
            return False
        self.player.health = max(0.0, self.player.health - amount)
        self.player.invulnerable_timer = 0.45
        self._emit("player_hit", amount=round(amount, 2), source=source)
        if self.player.health <= 0.0:
            self.mode = Mode.GAME_OVER
            self._emit("game_over", score=self.score, wave=self.wave)
        return True

    def spawn_enemy(
        self,
        kind: EnemyKind | str,
        pos: Vec2 | None = None,
        *,
        health: float | None = None,
    ) -> Enemy:
        enemy_kind = EnemyKind(kind)
        defaults: dict[EnemyKind, tuple[float, float, float, float]] = {
            EnemyKind.HUSK: (16.0, 62.0, 88.0, 12.0),
            EnemyKind.SCRIBE: (15.0, 70.0, 72.0, 10.0),
            EnemyKind.HOUND: (17.0, 82.0, 105.0, 18.0),
            EnemyKind.CURATOR: (42.0, 720.0, 54.0, 22.0),
        }
        radius, default_health, speed, contact_damage = defaults[enemy_kind]
        actual_health = float(default_health if health is None else health)
        if actual_health <= 0.0:
            raise ValueError("enemy health must be positive")
        spawn_pos = self._clamp_to_arena(pos or self._random_edge_position(), radius)
        enemy = Enemy(
            id=self._take_id(),
            kind=enemy_kind,
            pos=spawn_pos,
            radius=radius,
            health=actual_health,
            max_health=actual_health,
            speed=speed,
            contact_damage=contact_damage,
        )
        if enemy_kind is EnemyKind.SCRIBE:
            enemy.fire_timer = 0.75 + self.rng.random() * 0.35
        elif enemy_kind is EnemyKind.HOUND:
            enemy.ai_state = "hunt"
            enemy.ai_timer = 0.8 + self.rng.random() * 0.35
        elif enemy_kind is EnemyKind.CURATOR:
            enemy.ai_state = "idle"
            enemy.ai_timer = 1.0
        self.enemies.append(enemy)
        self._emit(
            "enemy_spawned",
            enemy_id=enemy.id,
            kind=enemy.kind.value,
            x=round(enemy.pos.x, 2),
            y=round(enemy.pos.y, 2),
        )
        return enemy

    def _begin_wave(self, wave: int) -> None:
        if wave not in (1, 2, 3, 4):
            raise ValueError("wave must be 1, 2, 3 or 4")
        self.wave = wave
        self.wave_spawned = 0
        self.wave_spawn_timer = 0.0
        self.enemies.clear()
        self.projectiles.clear()
        self.pickups.clear()
        self.blade.state = BladeState.HELD
        self.blade.pos = self.player.pos
        self.mode = Mode.PLAYING
        if wave == 4:
            self.spawn_enemy(EnemyKind.CURATOR, Vec2(self.width / 2.0, 125.0))
        self._emit("wave_started", wave=wave)

    def _update_wave(self, dt: float) -> None:
        if self.wave == 4:
            return
        quota = self.wave_quotas[self.wave - 1]
        if self.wave_spawned < quota:
            self.wave_spawn_timer -= dt
            if self.wave_spawn_timer <= 0.0:
                self.spawn_enemy(self._wave_enemy_kind(self.wave_spawned))
                self.wave_spawned += 1
                self.wave_spawn_timer = (0.78, 0.64, 0.52)[self.wave - 1]
        if self.wave_spawned >= quota and not any(enemy.alive for enemy in self.enemies):
            self._finish_wave()

    def _wave_enemy_kind(self, spawn_index: int) -> EnemyKind:
        if self.wave == 1:
            return EnemyKind.HUSK
        if self.wave == 2:
            return EnemyKind.SCRIBE if spawn_index % 3 == 1 else EnemyKind.HUSK
        sequence = (EnemyKind.HOUND, EnemyKind.HUSK, EnemyKind.SCRIBE, EnemyKind.HUSK)
        return sequence[spawn_index % len(sequence)]

    def _finish_wave(self) -> None:
        self.completed_wave = self.wave
        self.lore_index = self.wave - 1
        self.projectiles.clear()
        self.mode = Mode.LORE
        self._accumulator = 0.0
        self._emit("memory_recovered", wave=self.wave, title=LORE_FRAGMENTS[self.lore_index][0])

    def advance_lore(self) -> bool:
        if self.mode is not Mode.LORE:
            return False
        available = [upgrade for upgrade in UPGRADES if upgrade.id not in self.owned_upgrades]
        choice_count = min(3, len(available))
        self.upgrade_choices = tuple(self.rng.sample(available, choice_count))
        self.mode = Mode.UPGRADE
        self._emit("upgrade_offered", choices=[upgrade.id for upgrade in self.upgrade_choices])
        return True

    def choose_upgrade(self, choice: int | str | UpgradeDef) -> UpgradeDef:
        if self.mode is not Mode.UPGRADE:
            raise RuntimeError("upgrades can only be chosen in upgrade mode")
        if isinstance(choice, int):
            try:
                selected = self.upgrade_choices[choice]
            except IndexError as error:
                raise ValueError("upgrade index is not in the current choices") from error
        else:
            choice_id = choice.id if isinstance(choice, UpgradeDef) else choice
            selected = next(
                (upgrade for upgrade in self.upgrade_choices if upgrade.id == choice_id),
                None,
            )
            if selected is None:
                raise ValueError("upgrade is not in the current choices")
        self._apply_upgrade(selected)
        self.owned_upgrades.append(selected.id)
        self._emit("upgrade_chosen", upgrade=selected.id)
        next_wave = self.completed_wave + 1
        self._begin_wave(4 if next_wave > 3 else next_wave)
        return selected

    def _apply_upgrade(self, upgrade: UpgradeDef) -> None:
        if upgrade.id == "keen_edge":
            self.blade.outbound_damage += 10.0
        elif upgrade.id == "return_protocol":
            self.blade.return_damage += 20.0
        elif upgrade.id == "wide_trace":
            self.blade.hit_radius += 8.0
        elif upgrade.id == "volatile_memory":
            self.explosion_damage += 18.0
            self.explosion_radius += 28.0
        elif upgrade.id == "echo_dash":
            self.player.dash_damage = 34.0
        elif upgrade.id == "mended_record":
            self.player.max_health += 25.0
            self.player.health = min(self.player.max_health, self.player.health + 35.0)
        elif upgrade.id == "stored_momentum":
            self.momentum_enabled = True
            self.player.momentum_multiplier = 1.32
        elif upgrade.id == "perfect_pair":
            self.blade.perfect_threshold = 2
        elif upgrade.id == "patient_anchor":
            self.blade.max_range += 100.0
            self.blade.auto_recall_delay += 0.65
        else:
            raise ValueError(f"unknown upgrade: {upgrade.id}")

    def snapshot(self) -> dict[str, Any]:
        """Return a compact JSON-friendly state summary for smoke tests and QA."""

        type_counts = {
            kind.value: sum(1 for enemy in self.enemies if enemy.alive and enemy.kind is kind)
            for kind in EnemyKind
            if any(enemy.alive and enemy.kind is kind for enemy in self.enemies)
        }
        boss = self.boss
        return {
            "mode": self.mode.value,
            "time": round(self.time, 2),
            "wave": self.wave,
            "score": self.score,
            "player": {
                "x": round(self.player.pos.x, 1),
                "y": round(self.player.pos.y, 1),
                "health": round(self.player.health, 1),
                "max_health": round(self.player.max_health, 1),
                "dash_ready": self.player.dash_cooldown <= EPSILON,
            },
            "blade": {
                "state": self.blade.state.value,
                "x": round(self.blade.pos.x, 1),
                "y": round(self.blade.pos.y, 1),
                "return_kills": self.blade.return_kills,
            },
            "enemies": {
                "total": sum(enemy.alive for enemy in self.enemies),
                "marked": sum(enemy.alive and enemy.marked for enemy in self.enemies),
                "types": type_counts,
            },
            "projectiles": sum(projectile.alive for projectile in self.projectiles),
            "pickups": sum(pickup.alive for pickup in self.pickups),
            "upgrades": list(self.owned_upgrades),
            "upgrade_choices": [upgrade.id for upgrade in self.upgrade_choices],
            "lore_index": self.lore_index,
            "boss": None
            if boss is None
            else {
                "health": round(boss.health, 1),
                "max_health": round(boss.max_health, 1),
                "state": boss.ai_state,
                "shielded": boss.shielded,
            },
        }

    def _random_edge_position(self) -> Vec2:
        margin = 32.0
        best = Vec2(margin, margin)
        best_distance = -1.0
        for _ in range(8):
            edge = self.rng.randrange(4)
            if edge == 0:
                candidate = Vec2(self.rng.uniform(margin, self.width - margin), margin)
            elif edge == 1:
                candidate = Vec2(
                    self.width - margin,
                    self.rng.uniform(margin, self.height - margin),
                )
            elif edge == 2:
                candidate = Vec2(
                    self.rng.uniform(margin, self.width - margin),
                    self.height - margin,
                )
            else:
                candidate = Vec2(margin, self.rng.uniform(margin, self.height - margin))
            distance = candidate.distance_to(self.player.pos)
            if distance >= 180.0:
                return candidate
            if distance > best_distance:
                best = candidate
                best_distance = distance
        return best

    def _clamp_to_arena(self, pos: Vec2, radius: float) -> Vec2:
        return Vec2(
            max(radius, min(self.width - radius, pos.x)),
            max(radius, min(self.height - radius, pos.y)),
        )

    def _inside_arena(self, pos: Vec2, radius: float) -> bool:
        return (
            -radius <= pos.x <= self.width + radius
            and -radius <= pos.y <= self.height + radius
        )

    def _take_id(self) -> int:
        result = self._next_entity_id
        self._next_entity_id += 1
        return result


__all__ = [
    "Blade",
    "BladeState",
    "Enemy",
    "EnemyKind",
    "GameModel",
    "LORE_FRAGMENTS",
    "Mode",
    "Pickup",
    "PickupKind",
    "Player",
    "Projectile",
    "STORY_PAGES",
    "UPGRADES",
    "UpgradeDef",
    "Vec2",
    "segment_circle_distance_squared",
    "segment_circle_hit",
]
