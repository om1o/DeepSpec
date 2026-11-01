"""Native pygame-ce shell for the deterministic RECALL//ZERO model."""

from __future__ import annotations

from dataclasses import dataclass
import json
import math
import random
from typing import Any

import pygame

from .audio import SoundBank
from .effects import EffectsLayer
from .model import (
    BladeState,
    Enemy,
    EnemyKind,
    GameModel,
    Mode,
    PickupKind,
    STORY_PAGES,
    Vec2,
)
from .save_data import load_save, save_data
from .ui import HIGH_CONTRAST, STANDARD, Palette, centered_text, meter, panel, text, wrapped_text


LOGICAL_WIDTH = 1280
LOGICAL_HEIGHT = 720
CAMERA_WIDTH = 1024
CAMERA_HEIGHT = 576
CAMERA_FOLLOW_SPEED = 9.0
TITLE = "RECALL//ZERO — No-Engine Desktop Edition"
ENDING_TEXT = (
    "The Curator remembers Mara Venn. It remembers why she built the Archive, why she was afraid, "
    "and why she refused to erase the truth. The sealed records open. Humanity returns whole: "
    "joy beside grief, courage beside failure, every promise carrying its real weight."
)


@dataclass
class Fonts:
    tiny: pygame.font.Font
    small: pygame.font.Font
    body: pygame.font.Font
    medium: pygame.font.Font
    large: pygame.font.Font
    title: pygame.font.Font


class RecallZeroApp:
    def __init__(self, *, headless: bool = False, seed: int = 7) -> None:
        pygame.mixer.pre_init(44_100, -16, 1, 512)
        pygame.init()
        pygame.font.init()
        self.headless = headless
        self.windowed_size = (1280, 720)
        self.fullscreen = False
        flags = pygame.DOUBLEBUF if headless else pygame.RESIZABLE | pygame.DOUBLEBUF
        self.screen = pygame.display.set_mode(self.windowed_size, flags)
        pygame.display.set_caption(TITLE)
        pygame.display.set_icon(self._create_icon())

        self.canvas = pygame.Surface((LOGICAL_WIDTH, LOGICAL_HEIGHT)).convert()
        self.camera_frame = pygame.Surface((LOGICAL_WIDTH, LOGICAL_HEIGHT)).convert()
        self.scene_layer = pygame.Surface((LOGICAL_WIDTH, LOGICAL_HEIGHT)).convert()
        self.world_layer = pygame.Surface((LOGICAL_WIDTH, LOGICAL_HEIGHT), pygame.SRCALPHA).convert_alpha()
        self.effect_layer = pygame.Surface((LOGICAL_WIDTH, LOGICAL_HEIGHT), pygame.SRCALPHA).convert_alpha()
        self.overlay_layer = pygame.Surface((LOGICAL_WIDTH, LOGICAL_HEIGHT), pygame.SRCALPHA).convert_alpha()
        self.fonts = Fonts(
            tiny=pygame.font.SysFont("Segoe UI", 16),
            small=pygame.font.SysFont("Segoe UI", 20),
            body=pygame.font.SysFont("Segoe UI", 26),
            medium=pygame.font.SysFont("Segoe UI Semibold", 34, bold=True),
            large=pygame.font.SysFont("Segoe UI Semibold", 54, bold=True),
            title=pygame.font.SysFont("Segoe UI Black", 82, bold=True),
        )

        self.save = load_save()
        settings = self.save["settings"]
        self.reduced_motion = bool(settings["reduced_motion"])
        self.high_contrast = bool(settings["high_contrast"])
        self.palette = HIGH_CONTRAST if self.high_contrast else STANDARD
        self.model = GameModel(seed=seed, focus_mode=bool(settings["focus_mode"]))
        self.sound = SoundBank(muted=bool(settings["muted"]))
        self.effects = EffectsLayer(seed)
        self.clock = pygame.time.Clock()
        self.running = True
        self.selected_upgrade = 0
        self.camera = pygame.Vector2()
        self._snap_camera()
        self.mouse_canvas = pygame.Vector2(LOGICAL_WIDTH * 0.7, LOGICAL_HEIGHT * 0.5)
        self.mouse_world = pygame.Vector2(LOGICAL_WIDTH * 0.7, LOGICAL_HEIGHT * 0.5)
        self.shake_amount = 0.0
        self.hit_stop = 0.0
        self.damage_flash = 0.0
        self.last_entity_positions: dict[int, pygame.Vector2] = {}
        self.last_mode = self.model.mode
        self.stars = self._build_stars(seed)
        self.background = self._build_background()
        self._victory_recorded = False

    @property
    def focus_mode(self) -> bool:
        return self.model.focus_mode

    @property
    def muted(self) -> bool:
        return self.sound.muted

    def run(self, *, max_frames: int | None = None) -> int:
        frames = 0
        while self.running and (max_frames is None or frames < max_frames):
            dt = min(0.05, self.clock.tick(120) / 1000.0)
            self.tick(dt)
            frames += 1
        return 0

    def tick(self, dt: float) -> None:
        self._capture_entity_positions()
        self._handle_events()
        if self.last_mode is not Mode.PLAYING and self.model.mode is Mode.PLAYING:
            self._snap_camera()
        else:
            self._update_camera(dt)
        self._update_pointer()
        if self.model.mode is Mode.PLAYING:
            self._update_live_input()
            if self.hit_stop > 0.0 and not self.reduced_motion:
                self.hit_stop = max(0.0, self.hit_stop - dt)
            else:
                self.model.update(dt)
        else:
            self.model.set_move(0.0, 0.0)

        self._process_model_events()
        self.effects.update(dt)
        self.shake_amount = max(0.0, self.shake_amount - dt * 22.0)
        self.damage_flash = max(0.0, self.damage_flash - dt * 2.8)
        self._render()
        self._present()
        self.last_mode = self.model.mode

    def close(self) -> None:
        self._persist()
        self.sound.stop()
        pygame.quit()

    def _handle_events(self) -> None:
        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                self.running = False
                continue
            if event.type == pygame.WINDOWFOCUSLOST:
                self.model.pause_gameplay()
                continue
            if event.type == pygame.KEYDOWN:
                self._handle_key(event.key)
                continue
            if event.type == pygame.MOUSEBUTTONDOWN:
                self._handle_pointer_button(event.button, event.pos)

    def _handle_key(self, key: int) -> None:
        if key == pygame.K_F11:
            self._toggle_fullscreen()
            return
        if key == pygame.K_m:
            self.sound.set_muted(not self.sound.muted)
            self._persist()
            self.sound.play("menu")
            return

        mode = self.model.mode
        if mode is Mode.TITLE:
            if key in (pygame.K_RETURN, pygame.K_SPACE):
                self._begin_story()
            elif key == pygame.K_1:
                self.model.set_focus_mode(not self.model.focus_mode)
                self._persist()
            elif key == pygame.K_2:
                self.reduced_motion = not self.reduced_motion
                self._persist()
            elif key == pygame.K_3:
                self.high_contrast = not self.high_contrast
                self.palette = HIGH_CONTRAST if self.high_contrast else STANDARD
                self.background = self._build_background()
                self._persist()
            return

        if mode is Mode.STORY:
            if key in (pygame.K_RETURN, pygame.K_SPACE):
                self.sound.play("menu")
                self.model.advance_story()
            elif key == pygame.K_ESCAPE:
                self.model.return_to_title()
            return

        if mode is Mode.LORE:
            if key in (pygame.K_RETURN, pygame.K_SPACE):
                self.sound.play("upgrade")
                self.model.advance_lore()
                self.selected_upgrade = 0
            return

        if mode is Mode.UPGRADE:
            if pygame.K_1 <= key <= pygame.K_3:
                self._choose_upgrade(key - pygame.K_1)
            elif key in (pygame.K_LEFT, pygame.K_a):
                self.selected_upgrade = max(0, self.selected_upgrade - 1)
                self.sound.play("menu")
            elif key in (pygame.K_RIGHT, pygame.K_d):
                self.selected_upgrade = min(len(self.model.upgrade_choices) - 1, self.selected_upgrade + 1)
                self.sound.play("menu")
            elif key in (pygame.K_RETURN, pygame.K_SPACE):
                self._choose_upgrade(self.selected_upgrade)
            return

        if mode is Mode.PLAYING:
            if key in (pygame.K_RETURN, pygame.K_e):
                self._attack()
            elif key in (pygame.K_SPACE, pygame.K_LSHIFT, pygame.K_RSHIFT):
                self.model.dash()
            elif key in (pygame.K_ESCAPE, pygame.K_p):
                self.model.pause_gameplay()
            return

        if mode is Mode.PAUSED:
            if key in (pygame.K_ESCAPE, pygame.K_p, pygame.K_RETURN):
                self.model.resume()
            elif key == pygame.K_r:
                self._restart_run()
            elif key in (pygame.K_q, pygame.K_BACKSPACE):
                self.model.return_to_title()
            return

        if mode in (Mode.GAME_OVER, Mode.VICTORY):
            if key in (pygame.K_r, pygame.K_RETURN, pygame.K_SPACE):
                self._restart_run()
            elif key == pygame.K_ESCAPE:
                self.model.return_to_title()

    def _handle_pointer_button(self, button: int, position: tuple[int, int]) -> None:
        canvas = self._screen_to_canvas(position)
        world = self._canvas_to_world(canvas)
        self.mouse_canvas.update(canvas)
        self.mouse_world.update(world)
        mode = self.model.mode
        if button == 1:
            if mode is Mode.TITLE:
                self._begin_story()
            elif mode is Mode.STORY:
                self.model.advance_story()
            elif mode is Mode.LORE:
                self.model.advance_lore()
                self.selected_upgrade = 0
            elif mode is Mode.UPGRADE:
                index = self._upgrade_card_at(canvas)
                if index is not None:
                    self._choose_upgrade(index)
            elif mode is Mode.PLAYING:
                self._attack()
            elif mode is Mode.PAUSED:
                self.model.resume()
            elif mode in (Mode.GAME_OVER, Mode.VICTORY):
                self._restart_run()
        elif button == 3 and mode is Mode.PLAYING:
            self.model.dash()

    def _begin_story(self) -> None:
        self.effects.clear()
        self.sound.start_ambient()
        self.sound.play("menu")
        self._victory_recorded = False
        self.model.start_story()

    def _restart_run(self) -> None:
        self.effects.clear()
        self._victory_recorded = False
        self.model.start_run()
        self.sound.start_ambient()

    def _attack(self) -> None:
        if self.model.blade.state is BladeState.HELD:
            self.model.throw()
        elif self.model.blade.state in (BladeState.OUTBOUND, BladeState.ANCHORED):
            self.model.recall()

    def _choose_upgrade(self, index: int) -> None:
        if not 0 <= index < len(self.model.upgrade_choices):
            return
        self.model.choose_upgrade(index)
        self.sound.play("upgrade")

    def _update_live_input(self) -> None:
        keys = pygame.key.get_pressed()
        x = float(keys[pygame.K_d] or keys[pygame.K_RIGHT]) - float(keys[pygame.K_a] or keys[pygame.K_LEFT])
        y = float(keys[pygame.K_s] or keys[pygame.K_DOWN]) - float(keys[pygame.K_w] or keys[pygame.K_UP])
        self.model.set_move(x, y)
        self.model.aim_at(Vec2(self.mouse_world.x, self.mouse_world.y))

    def _update_pointer(self) -> None:
        if not self.headless:
            canvas = self._screen_to_canvas(pygame.mouse.get_pos())
            self.mouse_canvas.update(canvas)
            self.mouse_world.update(self._canvas_to_world(canvas))

    def _toggle_fullscreen(self) -> None:
        if self.headless:
            return
        if not self.fullscreen:
            self.windowed_size = self.screen.get_size()
            self.screen = pygame.display.set_mode((0, 0), pygame.FULLSCREEN | pygame.DOUBLEBUF)
        else:
            self.screen = pygame.display.set_mode(self.windowed_size, pygame.RESIZABLE | pygame.DOUBLEBUF)
        self.fullscreen = not self.fullscreen

    def _screen_to_canvas(self, position: tuple[int, int]) -> tuple[float, float]:
        screen_width, screen_height = self.screen.get_size()
        scale = min(screen_width / LOGICAL_WIDTH, screen_height / LOGICAL_HEIGHT)
        width = LOGICAL_WIDTH * scale
        height = LOGICAL_HEIGHT * scale
        left = (screen_width - width) * 0.5
        top = (screen_height - height) * 0.5
        return (
            max(0.0, min(LOGICAL_WIDTH, (position[0] - left) / max(scale, 0.001))),
            max(0.0, min(LOGICAL_HEIGHT, (position[1] - top) / max(scale, 0.001))),
        )

    def _canvas_to_world(self, position: tuple[float, float]) -> tuple[float, float]:
        return (
            self.camera.x + position[0] * CAMERA_WIDTH / LOGICAL_WIDTH,
            self.camera.y + position[1] * CAMERA_HEIGHT / LOGICAL_HEIGHT,
        )

    def _screen_to_world(self, position: tuple[int, int]) -> tuple[float, float]:
        return self._canvas_to_world(self._screen_to_canvas(position))

    def _camera_target(self) -> pygame.Vector2:
        focus = pygame.Vector2(self.model.player.pos.x, self.model.player.pos.y)
        boss = self.model.boss
        if boss is not None:
            boss_position = pygame.Vector2(boss.pos.x, boss.pos.y)
            focus = focus.lerp(boss_position, 0.30)
        return pygame.Vector2(
            max(0.0, min(LOGICAL_WIDTH - CAMERA_WIDTH, focus.x - CAMERA_WIDTH * 0.5)),
            max(0.0, min(LOGICAL_HEIGHT - CAMERA_HEIGHT, focus.y - CAMERA_HEIGHT * 0.5)),
        )

    def _snap_camera(self) -> None:
        self.camera.update(self._camera_target())

    def _update_camera(self, dt: float) -> None:
        target = self._camera_target()
        response = 1.0 - math.exp(-CAMERA_FOLLOW_SPEED * max(0.0, dt))
        self.camera += (target - self.camera) * response
        if self.camera.distance_squared_to(target) < 0.0001:
            self.camera.update(target)

    def _camera_rect(self, shake: pygame.Vector2 | None = None) -> pygame.Rect:
        shake = shake or pygame.Vector2()
        left = round(max(0.0, min(LOGICAL_WIDTH - CAMERA_WIDTH, self.camera.x + shake.x)))
        top = round(max(0.0, min(LOGICAL_HEIGHT - CAMERA_HEIGHT, self.camera.y + shake.y)))
        return pygame.Rect(left, top, CAMERA_WIDTH, CAMERA_HEIGHT)

    def _upgrade_card_at(self, canvas: tuple[float, float]) -> int | None:
        for index, rect in enumerate(self._upgrade_card_rects()):
            if rect.collidepoint(canvas):
                return index
        return None

    def _process_model_events(self) -> None:
        for event in self.model.drain_events():
            kind = event["type"]
            position = self._event_position(event)
            if kind == "blade_thrown":
                self.sound.play("throw")
                self.effects.ring(*position, self.palette.cyan, start=4, end=34, life=0.18, width=2)
            elif kind == "blade_anchored":
                self.sound.play("anchor")
                self.effects.ring(*position, self.palette.cyan, start=8, end=56, life=0.28)
            elif kind == "blade_recalled":
                self.sound.play("recall")
            elif kind in ("throw_hit", "dash_hit"):
                self.sound.play("hit", 0.6)
                self.effects.burst(*position, self.palette.cyan, count=7)
            elif kind == "recall_hit":
                self.sound.play("hit")
                self.effects.burst(*position, self.palette.bone, count=10, speed=(90, 300))
            elif kind == "mark_detonated":
                self.sound.play("detonate", 0.75)
                self.effects.burst(*position, self.palette.magenta, count=18, speed=(120, 360))
                self.effects.ring(*position, self.palette.cyan, end=self.model.explosion_radius, life=0.30)
            elif kind == "perfect_recall":
                self.sound.play("perfect")
                self.effects.burst(*position, self.palette.amber, count=48, speed=(160, 520), life=(0.25, 0.65))
                self.effects.ring(*position, self.palette.amber, start=16, end=220, life=0.48, width=5)
                self.effects.label(position[0], position[1] - 44, "PERFECT RECALL", self.palette.amber)
                if not self.reduced_motion:
                    self.shake_amount = max(self.shake_amount, 10.0)
                    self.hit_stop = 0.055
            elif kind == "dash":
                self.sound.play("dash")
                if not self.reduced_motion:
                    self.shake_amount = max(self.shake_amount, 2.5)
            elif kind == "enemy_spawned":
                self.effects.ring(*position, self.palette.magenta, start=2, end=30, life=0.24, width=2)
            elif kind == "enemy_killed":
                self.effects.burst(*position, self.palette.magenta, count=15, speed=(80, 280))
            elif kind in ("hound_telegraph", "boss_telegraph"):
                self.sound.play("warning", 0.75)
            elif kind == "player_hit":
                self.sound.play("hurt")
                self.effects.burst(*position, self.palette.danger, count=20, speed=(130, 330))
                self.damage_flash = 1.0
                if not self.reduced_motion:
                    self.shake_amount = max(self.shake_amount, 8.0)
            elif kind == "pickup_collected":
                self.sound.play("pickup")
            elif kind == "memory_recovered":
                self.save["unlocked_lore"] = max(self.save["unlocked_lore"], int(event["wave"]))
                self.sound.play("upgrade")
                self._persist()
            elif kind == "game_over":
                self.sound.play("defeat")
                self._record_score()
            elif kind == "victory":
                self.sound.play("victory")
                if not self._victory_recorded:
                    self._victory_recorded = True
                    self.save["victories"] += 1
                self.save["unlocked_lore"] = 3
                self._record_score()

    def _event_position(self, event: dict[str, Any]) -> tuple[float, float]:
        if "x" in event and "y" in event:
            return float(event["x"]), float(event["y"])
        for key in ("enemy_id", "projectile_id", "pickup_id"):
            entity_id = event.get(key)
            if entity_id in self.last_entity_positions:
                point = self.last_entity_positions[entity_id]
                return point.x, point.y
        return self.model.player.pos.x, self.model.player.pos.y

    def _capture_entity_positions(self) -> None:
        positions: dict[int, pygame.Vector2] = {}
        for entity in (*self.model.enemies, *self.model.projectiles, *self.model.pickups):
            positions[entity.id] = pygame.Vector2(entity.pos.x, entity.pos.y)
        self.last_entity_positions = positions

    def _record_score(self) -> None:
        self.save["best_score"] = max(int(self.save["best_score"]), int(self.model.score))
        self._persist()

    def _persist(self) -> None:
        self.save["settings"].update(
            {
                "focus_mode": self.model.focus_mode,
                "reduced_motion": self.reduced_motion,
                "high_contrast": self.high_contrast,
                "muted": self.sound.muted,
            }
        )
        try:
            save_data(self.save)
        except OSError:
            pass

    def _render(self) -> None:
        self.world_layer.fill((0, 0, 0, 0))
        self.effect_layer.fill((0, 0, 0, 0))
        self.overlay_layer.fill((0, 0, 0, 0))

        offset = pygame.Vector2()
        if self.shake_amount > 0.0 and not self.reduced_motion:
            offset.update(
                random.uniform(-self.shake_amount, self.shake_amount),
                random.uniform(-self.shake_amount, self.shake_amount),
            )

        if self.model.mode not in (Mode.TITLE, Mode.STORY):
            self._draw_world(pygame.Vector2())
            self.effects.draw(self.effect_layer, self.fonts.small, pygame.Vector2())
            self.scene_layer.blit(self.background, (0, 0))
            self.scene_layer.blit(self.world_layer, (0, 0))
            self.scene_layer.blit(self.effect_layer, (0, 0))
            camera_view = self.scene_layer.subsurface(self._camera_rect(offset))
            pygame.transform.scale(
                camera_view,
                (LOGICAL_WIDTH, LOGICAL_HEIGHT),
                self.camera_frame,
            )
            self.canvas.blit(self.camera_frame, (0, 0))
        else:
            self.canvas.blit(self.background, (0, 0))

        if self.model.mode is Mode.TITLE:
            self._draw_title()
        elif self.model.mode is Mode.STORY:
            self._draw_story()
        elif self.model.mode is Mode.LORE:
            self._draw_lore()
        elif self.model.mode is Mode.UPGRADE:
            self._draw_hud()
            self._draw_upgrade()
        elif self.model.mode is Mode.PAUSED:
            self._draw_hud()
            self._draw_pause()
        elif self.model.mode is Mode.GAME_OVER:
            self._draw_hud()
            self._draw_end_screen(victory=False)
        elif self.model.mode is Mode.VICTORY:
            self._draw_hud()
            self._draw_end_screen(victory=True)
        else:
            self._draw_hud()

        if self.damage_flash > 0.0:
            alpha = int(80 * self.damage_flash)
            self.overlay_layer.fill((*self.palette.danger, alpha))
            self.canvas.blit(self.overlay_layer, (0, 0))

    def _draw_world(self, offset: pygame.Vector2) -> None:
        self._draw_telegraphs(offset)
        for pickup in self.model.pickups:
            if not pickup.alive:
                continue
            point = pygame.Vector2(pickup.pos.x, pickup.pos.y) + offset
            if pickup.kind is PickupKind.HEALTH:
                pygame.draw.circle(self.world_layer, self.palette.danger, point, 10)
                pygame.draw.rect(self.world_layer, self.palette.bone, (point.x - 6, point.y - 2, 12, 4))
                pygame.draw.rect(self.world_layer, self.palette.bone, (point.x - 2, point.y - 6, 4, 12))
            else:
                points = [(point.x, point.y - 11), (point.x + 8, point.y), (point.x, point.y + 11), (point.x - 8, point.y)]
                pygame.draw.polygon(self.world_layer, self.palette.amber, points)
                pygame.draw.polygon(self.world_layer, self.palette.bone, points, 2)

        for projectile in self.model.projectiles:
            if not projectile.alive:
                continue
            point = pygame.Vector2(projectile.pos.x, projectile.pos.y) + offset
            pygame.draw.circle(self.world_layer, self.palette.magenta, point, round(projectile.radius + 3), 2)
            pygame.draw.circle(self.world_layer, self.palette.bone, point, max(2, round(projectile.radius - 2)))

        for enemy in self.model.enemies:
            if enemy.alive:
                self._draw_enemy(enemy, offset)

        self._draw_blade(offset)
        self._draw_player(offset)

    def _draw_telegraphs(self, offset: pygame.Vector2) -> None:
        for enemy in self.model.enemies:
            if not enemy.alive:
                continue
            point = pygame.Vector2(enemy.pos.x, enemy.pos.y) + offset
            direction = pygame.Vector2(enemy.target_direction.x, enemy.target_direction.y)
            if enemy.kind is EnemyKind.HOUND and enemy.ai_state == "telegraph":
                end = point + direction * 340
                pygame.draw.line(self.world_layer, (*self.palette.danger, 150), point, end, 5)
                pygame.draw.circle(self.world_layer, self.palette.bone, point, round(enemy.radius + 8), 2)
            elif enemy.kind is EnemyKind.CURATOR and enemy.ai_state.startswith("telegraph_"):
                pattern = enemy.ai_state.removeprefix("telegraph_")
                if pattern == "charge":
                    start = point - direction * 80
                    end = point + direction * 720
                    pygame.draw.line(self.world_layer, (*self.palette.danger, 160), start, end, 28)
                    pygame.draw.line(self.world_layer, self.palette.bone, start, end, 3)
                elif pattern == "radial":
                    for angle_index in range(12):
                        ray = pygame.Vector2(1, 0).rotate(angle_index * 30)
                        pygame.draw.line(self.world_layer, (*self.palette.magenta, 150), point + ray * 52, point + ray * 240, 3)
                else:
                    pygame.draw.circle(self.world_layer, self.palette.amber, point, 92, 5)

    def _draw_enemy(self, enemy: Enemy, offset: pygame.Vector2) -> None:
        point = pygame.Vector2(enemy.pos.x, enemy.pos.y) + offset
        radius = round(enemy.radius)
        fill = self.palette.magenta
        outline = self.palette.bone
        if enemy.kind is EnemyKind.HUSK:
            points = [point + pygame.Vector2(radius, 0).rotate(index * 45 + 22.5) for index in range(8)]
            pygame.draw.polygon(self.world_layer, fill, points)
            pygame.draw.polygon(self.world_layer, outline, points, 2)
            pygame.draw.circle(self.world_layer, self.palette.void, point, max(3, radius // 3))
        elif enemy.kind is EnemyKind.SCRIBE:
            points = [(point.x, point.y - radius), (point.x + radius, point.y), (point.x, point.y + radius), (point.x - radius, point.y)]
            pygame.draw.polygon(self.world_layer, fill, points)
            pygame.draw.polygon(self.world_layer, outline, points, 2)
            pygame.draw.line(self.world_layer, outline, (point.x - 6, point.y), (point.x + 6, point.y), 2)
        elif enemy.kind is EnemyKind.HOUND:
            facing = pygame.Vector2(enemy.vel.x, enemy.vel.y)
            if facing.length_squared() == 0:
                facing = pygame.Vector2(enemy.target_direction.x, enemy.target_direction.y)
            if facing.length_squared() == 0:
                facing = pygame.Vector2(1, 0)
            facing = facing.normalize()
            side = facing.rotate(90)
            points = [point + facing * radius * 1.25, point - facing * radius + side * radius * 0.8, point - facing * radius - side * radius * 0.8]
            pygame.draw.polygon(self.world_layer, fill, points)
            pygame.draw.polygon(self.world_layer, outline, points, 2)
        else:
            points = [point + pygame.Vector2(radius, 0).rotate(index * 60 + 30) for index in range(6)]
            pygame.draw.polygon(self.world_layer, (78, 25, 78), points)
            pygame.draw.polygon(self.world_layer, outline, points, 3)
            pygame.draw.circle(self.world_layer, fill, point, radius // 2)
            pygame.draw.circle(self.world_layer, self.palette.bone, point, radius // 6)
            if enemy.shielded:
                pygame.draw.circle(self.world_layer, self.palette.amber, point, radius + 14, 5)
                for angle in (0, 120, 240):
                    guard = point + pygame.Vector2(radius + 14, 0).rotate(angle + self.model.time * 60)
                    pygame.draw.circle(self.world_layer, self.palette.amber, guard, 5)

        if enemy.marked:
            pulse = 4 + 2 * math.sin(self.model.time * 8 + enemy.id)
            pygame.draw.circle(self.world_layer, self.palette.cyan, point, round(radius + 7 + pulse), 3)
            for angle in (45, 135, 225, 315):
                start = point + pygame.Vector2(radius + 2, 0).rotate(angle)
                end = point + pygame.Vector2(radius + 8, 0).rotate(angle)
                pygame.draw.line(self.world_layer, self.palette.cyan, start, end, 2)

        if enemy.kind is not EnemyKind.CURATOR and enemy.health < enemy.max_health:
            health_rect = pygame.Rect(round(point.x - 18), round(point.y + radius + 9), 36, 5)
            meter(self.world_layer, health_rect, enemy.health / enemy.max_health, self.palette.magenta, self.palette.void, self.palette.grid, radius=2)

    def _draw_player(self, offset: pygame.Vector2) -> None:
        point = pygame.Vector2(self.model.player.pos.x, self.model.player.pos.y) + offset
        direction = pygame.Vector2(self.model.aim_direction.x, self.model.aim_direction.y)
        if direction.length_squared() == 0:
            direction = pygame.Vector2(1, 0)
        side = direction.rotate(90)
        radius = self.model.player.radius
        points = [point + direction * radius * 1.35, point - direction * radius + side * radius * 0.82, point - direction * radius - side * radius * 0.82]
        glow = 4 if self.model.player.invulnerable_timer <= 0 else 8
        pygame.draw.circle(self.world_layer, (*self.palette.cyan_soft, 100), point, round(radius + glow))
        pygame.draw.polygon(self.world_layer, self.palette.cyan, points)
        pygame.draw.polygon(self.world_layer, self.palette.bone, points, 2)
        pygame.draw.circle(self.world_layer, self.palette.void, point, 4)
        if self.model.player.dash_timer > 0:
            self.effects.trail(point.x, point.y, self.palette.cyan, direction * 500, count=4)

    def _draw_blade(self, offset: pygame.Vector2) -> None:
        blade = self.model.blade
        point = pygame.Vector2(blade.pos.x, blade.pos.y) + offset
        player = pygame.Vector2(self.model.player.pos.x, self.model.player.pos.y) + offset
        if blade.state is BladeState.ANCHORED:
            preview = pygame.Surface((LOGICAL_WIDTH, LOGICAL_HEIGHT), pygame.SRCALPHA)
            pygame.draw.line(preview, (*self.palette.cyan, 42), point, player, round(blade.hit_radius * 2 + 4))
            pygame.draw.line(preview, (*self.palette.bone, 150), point, player, 2)
            self.world_layer.blit(preview, (0, 0))
        direction = pygame.Vector2(blade.direction.x, blade.direction.y)
        if blade.state is BladeState.RETURNING:
            direction = player - point
            if direction.length_squared():
                direction = direction.normalize()
        if blade.state is BladeState.HELD:
            direction = pygame.Vector2(self.model.aim_direction.x, self.model.aim_direction.y)
            point = player + direction * 25
        if direction.length_squared() == 0:
            direction = pygame.Vector2(1, 0)
        side = direction.rotate(90)
        length = 18
        width = 6
        points = [point + direction * length, point + side * width, point - direction * length, point - side * width]
        pygame.draw.polygon(self.world_layer, self.palette.bone, points)
        pygame.draw.polygon(self.world_layer, self.palette.cyan, points, 2)
        if blade.state is not BladeState.HELD:
            self.effects.trail(point.x, point.y, self.palette.cyan, direction * 500, count=1)

    def _draw_hud(self) -> None:
        palette = self.palette
        panel(self.canvas, pygame.Rect(28, 24, 285, 78), palette, radius=10)
        text(self.canvas, self.fonts.tiny, "ARCHIVE INTEGRITY", palette.muted, (48, 39))
        meter(
            self.canvas,
            pygame.Rect(48, 64, 238, 18),
            self.model.player.health / self.model.player.max_health,
            palette.cyan,
            palette.void,
            palette.bone,
        )

        wave_label = "THE CURATOR" if self.model.wave == 4 else f"MEMORY {max(1, self.model.wave)} / 3"
        centered_text(self.canvas, self.fonts.medium, wave_label, palette.bone, (LOGICAL_WIDTH // 2, 45))
        if self.model.wave == 4 and self.model.boss:
            meter(
                self.canvas,
                pygame.Rect(455, 72, 370, 16),
                self.model.boss.health / self.model.boss.max_health,
                palette.magenta,
                palette.void,
                palette.bone,
            )

        panel(self.canvas, pygame.Rect(1002, 24, 250, 78), palette, radius=10)
        text(self.canvas, self.fonts.tiny, "RECONSTRUCTED", palette.muted, (1024, 39))
        text(self.canvas, self.fonts.medium, f"{self.model.score:07d}", palette.amber, (1024, 61))

        dash_ratio = 1.0 - self.model.player.dash_cooldown / self.model.player.dash_cooldown_max
        meter(self.canvas, pygame.Rect(36, 674, 180, 12), dash_ratio, palette.cyan, palette.void, palette.grid, radius=4)
        text(self.canvas, self.fonts.tiny, "DASH" if dash_ratio >= 0.999 else "RECHARGING", palette.muted, (36, 649))

        blade = self.model.blade
        status = {
            BladeState.HELD: "THROW READY",
            BladeState.OUTBOUND: "RECALL NOW",
            BladeState.ANCHORED: "REPOSITION • RECALL",
            BladeState.RETURNING: f"TRACE {blade.return_kills}/{blade.perfect_threshold}",
        }[blade.state]
        centered_text(self.canvas, self.fonts.small, status, palette.cyan if blade.state is not BladeState.HELD else palette.muted, (LOGICAL_WIDTH // 2, 672))
        text(self.canvas, self.fonts.tiny, "M  SOUND" if not self.muted else "M  MUTED", palette.muted, (1244, 674), anchor="topright")

        if self.model.wave == 1 and self.model.time < 14.0:
            hint = "LEFT CLICK / ENTER  THROW & RECALL     •     MOVE TO BEND THE RETURN LINE     •     SPACE  DASH"
            centered_text(self.canvas, self.fonts.tiny, hint, palette.bone, (LOGICAL_WIDTH // 2, 632))

    def _draw_title(self) -> None:
        palette = self.palette
        phase = pygame.time.get_ticks() / 1000.0
        for index in range(5):
            radius = 95 + index * 54 + math.sin(phase * 0.8 + index) * 7
            pygame.draw.circle(self.canvas, palette.grid, (LOGICAL_WIDTH // 2, 244), round(radius), 1)
        blade_start = pygame.Vector2(365, 236)
        blade_end = pygame.Vector2(915, 236)
        pygame.draw.line(self.canvas, palette.cyan_soft, blade_start, blade_end, 3)
        moving = blade_start.lerp(blade_end, (math.sin(phase * 0.9) + 1) * 0.5)
        pygame.draw.circle(self.canvas, palette.cyan, moving, 8)

        centered_text(self.canvas, self.fonts.tiny, "ARCHIVE ANOMALY 000", palette.amber, (LOGICAL_WIDTH // 2, 116))
        centered_text(self.canvas, self.fonts.title, "RECALL//ZERO", palette.bone, (LOGICAL_WIDTH // 2, 226))
        centered_text(self.canvas, self.fonts.body, "THROW THE MEMORY. MOVE. REWRITE THE RETURN.", palette.cyan, (LOGICAL_WIDTH // 2, 300))

        start_rect = pygame.Rect(490, 350, 300, 64)
        panel(self.canvas, start_rect, palette, border=palette.cyan, radius=10)
        centered_text(self.canvas, self.fonts.medium, "ENTER  BEGIN RECALL", palette.bone, start_rect.center)

        text(self.canvas, self.fonts.small, "MOVE", palette.muted, (270, 466))
        text(self.canvas, self.fonts.small, "WASD / ARROWS", palette.bone, (270, 494))
        text(self.canvas, self.fonts.small, "BLADE", palette.muted, (520, 466))
        text(self.canvas, self.fonts.small, "CLICK / ENTER", palette.bone, (520, 494))
        text(self.canvas, self.fonts.small, "DASH", palette.muted, (760, 466))
        text(self.canvas, self.fonts.small, "SPACE / RIGHT CLICK", palette.bone, (760, 494))

        toggle_y = 572
        self._draw_toggle(225, toggle_y, "1", "FOCUS", self.focus_mode)
        self._draw_toggle(455, toggle_y, "2", "REDUCED MOTION", self.reduced_motion)
        self._draw_toggle(735, toggle_y, "3", "HIGH CONTRAST", self.high_contrast)
        self._draw_toggle(1010, toggle_y, "M", "SOUND", not self.muted)

        text(self.canvas, self.fonts.tiny, f"BEST  {int(self.save['best_score']):07d}", palette.amber, (34, 682))
        text(self.canvas, self.fonts.tiny, "NO GAME ENGINE  •  NATIVE WINDOWS BUILD  •  F11 FULLSCREEN", palette.muted, (1246, 682), anchor="topright")

    def _draw_toggle(self, x: int, y: int, key: str, label: str, enabled: bool) -> None:
        color = self.palette.cyan if enabled else self.palette.muted
        pygame.draw.rect(self.canvas, self.palette.floor, (x, y, 190, 54), border_radius=8)
        pygame.draw.rect(self.canvas, color, (x, y, 190, 54), 2, border_radius=8)
        pygame.draw.rect(self.canvas, color, (x + 12, y + 12, 30, 30), border_radius=5)
        centered_text(self.canvas, self.fonts.small, key, self.palette.void, (x + 27, y + 27))
        text(self.canvas, self.fonts.tiny, label, self.palette.bone, (x + 54, y + 10))
        text(self.canvas, self.fonts.tiny, "ON" if enabled else "OFF", color, (x + 54, y + 29))

    def _draw_story(self) -> None:
        palette = self.palette
        index = min(self.model.story_index, len(STORY_PAGES) - 1)
        panel(self.canvas, pygame.Rect(260, 150, 760, 420), palette, border=palette.cyan_soft, radius=16)
        text(self.canvas, self.fonts.small, f"ARCHIVE ENTRY  0{index + 1} / 0{len(STORY_PAGES)}", palette.amber, (310, 198))
        wrapped_text(
            self.canvas,
            self.fonts.medium,
            self.model.current_story,
            palette.bone,
            pygame.Rect(310, 260, 660, 190),
            line_spacing=10,
            center=True,
        )
        centered_text(self.canvas, self.fonts.small, "ENTER / CLICK  CONTINUE", palette.cyan, (LOGICAL_WIDTH // 2, 518))

    def _draw_lore(self) -> None:
        palette = self.palette
        veil = pygame.Surface((LOGICAL_WIDTH, LOGICAL_HEIGHT), pygame.SRCALPHA)
        veil.fill((palette.void[0], palette.void[1], palette.void[2], 210))
        self.canvas.blit(veil, (0, 0))
        lore = self.model.current_lore
        if lore is None:
            return
        panel(self.canvas, pygame.Rect(250, 150, 780, 420), palette, border=palette.amber, radius=16)
        centered_text(self.canvas, self.fonts.small, f"MEMORY {self.model.wave} RECOVERED", palette.amber, (LOGICAL_WIDTH // 2, 206))
        centered_text(self.canvas, self.fonts.large, lore[0], palette.bone, (LOGICAL_WIDTH // 2, 285))
        wrapped_text(self.canvas, self.fonts.body, lore[1], palette.muted, pygame.Rect(335, 345, 610, 100), line_spacing=8, center=True)
        centered_text(self.canvas, self.fonts.small, "ENTER / CLICK  STABILIZE MEMORY", palette.cyan, (LOGICAL_WIDTH // 2, 520))

    def _upgrade_card_rects(self) -> list[pygame.Rect]:
        return [pygame.Rect(145 + index * 340, 265, 310, 270) for index in range(3)]

    def _draw_upgrade(self) -> None:
        palette = self.palette
        veil = pygame.Surface((LOGICAL_WIDTH, LOGICAL_HEIGHT), pygame.SRCALPHA)
        veil.fill((palette.void[0], palette.void[1], palette.void[2], 220))
        self.canvas.blit(veil, (0, 0))
        centered_text(self.canvas, self.fonts.small, "THE MEMORY CHANGES YOU", palette.amber, (LOGICAL_WIDTH // 2, 145))
        centered_text(self.canvas, self.fonts.large, "CHOOSE ONE RECONSTRUCTION", palette.bone, (LOGICAL_WIDTH // 2, 204))
        for index, (upgrade, rect) in enumerate(zip(self.model.upgrade_choices, self._upgrade_card_rects(), strict=False)):
            selected = index == self.selected_upgrade
            hover = rect.collidepoint(self.mouse_canvas)
            border = palette.cyan if selected or hover else palette.grid
            panel(self.canvas, rect, palette, border=border, radius=14)
            pygame.draw.circle(self.canvas, border, (rect.x + 38, rect.y + 39), 19)
            centered_text(self.canvas, self.fonts.small, str(index + 1), palette.void if selected else palette.bone, (rect.x + 38, rect.y + 39))
            wrapped_text(self.canvas, self.fonts.medium, upgrade.name.upper(), palette.bone, pygame.Rect(rect.x + 28, rect.y + 80, rect.width - 56, 84), line_spacing=4)
            wrapped_text(self.canvas, self.fonts.small, upgrade.description, palette.muted, pygame.Rect(rect.x + 28, rect.y + 170, rect.width - 56, 70), line_spacing=6)
        centered_text(self.canvas, self.fonts.small, "1 / 2 / 3  SELECT     •     ARROWS + ENTER", palette.cyan, (LOGICAL_WIDTH // 2, 590))

    def _draw_pause(self) -> None:
        palette = self.palette
        veil = pygame.Surface((LOGICAL_WIDTH, LOGICAL_HEIGHT), pygame.SRCALPHA)
        veil.fill((palette.void[0], palette.void[1], palette.void[2], 205))
        self.canvas.blit(veil, (0, 0))
        panel(self.canvas, pygame.Rect(420, 205, 440, 310), palette, border=palette.cyan_soft, radius=16)
        centered_text(self.canvas, self.fonts.large, "RECALL SUSPENDED", palette.bone, (LOGICAL_WIDTH // 2, 280))
        centered_text(self.canvas, self.fonts.body, "ESC / P / ENTER  RESUME", palette.cyan, (LOGICAL_WIDTH // 2, 360))
        centered_text(self.canvas, self.fonts.small, "R  RESTART RUN", palette.muted, (LOGICAL_WIDTH // 2, 416))
        centered_text(self.canvas, self.fonts.small, "Q  RETURN TO TITLE", palette.muted, (LOGICAL_WIDTH // 2, 452))

    def _draw_end_screen(self, *, victory: bool) -> None:
        palette = self.palette
        veil = pygame.Surface((LOGICAL_WIDTH, LOGICAL_HEIGHT), pygame.SRCALPHA)
        veil.fill((palette.void[0], palette.void[1], palette.void[2], 220))
        self.canvas.blit(veil, (0, 0))
        rect = pygame.Rect(220, 112, 840, 500)
        panel(self.canvas, rect, palette, border=palette.amber if victory else palette.danger, radius=18)
        centered_text(
            self.canvas,
            self.fonts.large,
            "THE RECORD IS WHOLE" if victory else "ECHO ZERO LOST",
            palette.amber if victory else palette.danger,
            (LOGICAL_WIDTH // 2, 190),
        )
        if victory:
            wrapped_text(self.canvas, self.fonts.body, ENDING_TEXT, palette.bone, pygame.Rect(310, 248, 660, 175), line_spacing=7, center=True)
        else:
            wrapped_text(
                self.canvas,
                self.fonts.body,
                "The Archive closes around the unfinished memory. The trace remains. Recall it differently.",
                palette.bone,
                pygame.Rect(340, 265, 600, 120),
                line_spacing=8,
                center=True,
            )
        centered_text(self.canvas, self.fonts.medium, f"SCORE  {self.model.score:07d}", palette.cyan, (LOGICAL_WIDTH // 2, 466))
        centered_text(self.canvas, self.fonts.small, "R / ENTER / CLICK  RECALL AGAIN", palette.bone, (LOGICAL_WIDTH // 2, 540))

    def _present(self) -> None:
        if self.headless:
            pygame.display.flip()
            return
        width, height = self.screen.get_size()
        scale = min(width / LOGICAL_WIDTH, height / LOGICAL_HEIGHT)
        target = (max(1, round(LOGICAL_WIDTH * scale)), max(1, round(LOGICAL_HEIGHT * scale)))
        scaled = pygame.transform.smoothscale(self.canvas, target)
        left = (width - target[0]) // 2
        top = (height - target[1]) // 2
        self.screen.fill(self.palette.void)
        self.screen.blit(scaled, (left, top))
        pygame.display.flip()

    def _build_background(self) -> pygame.Surface:
        palette = self.palette
        surface = pygame.Surface((LOGICAL_WIDTH, LOGICAL_HEIGHT)).convert()
        surface.fill(palette.floor)
        for y in range(LOGICAL_HEIGHT):
            amount = y / LOGICAL_HEIGHT
            shade = tuple(round(palette.floor[index] * (1.0 - amount * 0.28)) for index in range(3))
            pygame.draw.line(surface, shade, (0, y), (LOGICAL_WIDTH, y))
        for x in range(0, LOGICAL_WIDTH + 1, 64):
            pygame.draw.line(surface, palette.grid, (x, 0), (x, LOGICAL_HEIGHT), 1)
        for y in range(0, LOGICAL_HEIGHT + 1, 64):
            pygame.draw.line(surface, palette.grid, (0, y), (LOGICAL_WIDTH, y), 1)
        for x, y, radius in self.stars:
            pygame.draw.circle(surface, palette.muted, (x, y), radius)
        pygame.draw.rect(surface, palette.grid, (18, 18, LOGICAL_WIDTH - 36, LOGICAL_HEIGHT - 36), 2, border_radius=12)
        return surface

    def _build_stars(self, seed: int) -> list[tuple[int, int, int]]:
        rng = random.Random(seed ^ 0x57A2)
        return [(rng.randrange(LOGICAL_WIDTH), rng.randrange(LOGICAL_HEIGHT), rng.choice((1, 1, 1, 2))) for _ in range(90)]

    def _create_icon(self) -> pygame.Surface:
        icon = pygame.Surface((64, 64), pygame.SRCALPHA)
        pygame.draw.circle(icon, (4, 7, 18), (32, 32), 30)
        pygame.draw.circle(icon, (68, 226, 232), (32, 32), 24, 3)
        pygame.draw.line(icon, (238, 235, 220), (14, 45), (50, 19), 5)
        pygame.draw.circle(icon, (255, 184, 76), (14, 45), 6)
        pygame.draw.circle(icon, (224, 61, 138), (50, 19), 6)
        return icon

    def render_snapshot(self) -> str:
        """Concise state used by smoke tests and external QA."""

        snapshot = self.model.snapshot()
        snapshot["camera"] = {
            "x": round(self.camera.x, 2),
            "y": round(self.camera.y, 2),
            "width": CAMERA_WIDTH,
            "height": CAMERA_HEIGHT,
        }
        return json.dumps(snapshot, sort_keys=True)
