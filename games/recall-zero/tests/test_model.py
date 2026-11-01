from __future__ import annotations

import unittest

from recall_zero.model import (
    BladeState,
    EnemyKind,
    GameModel,
    Mode,
    UPGRADES,
    Vec2,
    segment_circle_distance_squared,
    segment_circle_hit,
)


def advance(model: GameModel, seconds: float, *, frame: float = 1.0 / 60.0) -> None:
    frames = int(seconds / frame)
    for _ in range(frames):
        model.update(frame)
    remainder = seconds - frames * frame
    if remainder > 1e-10:
        model.update(remainder)


class GeometryTests(unittest.TestCase):
    def test_segment_circle_hit_is_inclusive_and_handles_zero_length(self) -> None:
        start = Vec2(0.0, 0.0)
        end = Vec2(10.0, 0.0)

        self.assertTrue(segment_circle_hit(start, end, Vec2(5.0, 2.0), 2.0))
        self.assertFalse(segment_circle_hit(start, end, Vec2(5.0, 2.01), 2.0))
        self.assertTrue(segment_circle_hit(start, start, Vec2(0.0, 1.0), 1.0))
        self.assertAlmostEqual(
            segment_circle_distance_squared(start, end, Vec2(12.0, 3.0)),
            13.0,
        )


class BladeTests(unittest.TestCase):
    def make_model(self) -> GameModel:
        model = GameModel(seed=7, wave_quotas=(99, 99, 99))
        model.start_run()
        model.wave_spawn_timer = 999.0
        return model

    def test_blade_follows_four_states_and_auto_returns(self) -> None:
        model = self.make_model()

        self.assertTrue(model.throw(Vec2(1.0, 0.0)))
        self.assertEqual(model.blade.state, BladeState.OUTBOUND)
        advance(model, 0.8)
        self.assertEqual(model.blade.state, BladeState.ANCHORED)

        advance(model, model.blade.auto_recall_delay)
        self.assertEqual(model.blade.state, BladeState.RETURNING)
        advance(model, 0.7)
        self.assertEqual(model.blade.state, BladeState.HELD)
        event_types = [event["type"] for event in model.drain_events()]
        self.assertIn("blade_anchored", event_types)
        self.assertIn("blade_recalled", event_types)
        self.assertIn("blade_caught", event_types)

    def test_marked_recall_kill_detonates_nearby_enemy(self) -> None:
        model = self.make_model()
        target = model.spawn_enemy(EnemyKind.HUSK, Vec2(790.0, 360.0), health=60.0)
        target.speed = 0.0
        neighbor = model.spawn_enemy(EnemyKind.HUSK, Vec2(790.0, 405.0), health=25.0)
        neighbor.speed = 0.0

        model.throw(Vec2(1.0, 0.0))
        advance(model, 0.8)
        self.assertTrue(target.marked)
        self.assertFalse(neighbor.marked)
        model.recall()
        advance(model, 0.7)

        living_ids = {enemy.id for enemy in model.enemies}
        self.assertNotIn(target.id, living_ids)
        self.assertNotIn(neighbor.id, living_ids)
        event_types = [event["type"] for event in model.drain_events()]
        self.assertIn("mark_detonated", event_types)

    def test_three_marked_path_kills_trigger_one_perfect_recall(self) -> None:
        model = self.make_model()
        enemies = [
            model.spawn_enemy(EnemyKind.HUSK, Vec2(x, 360.0), health=70.0)
            for x in (735.0, 850.0, 965.0)
        ]
        for enemy in enemies:
            enemy.speed = 0.0

        model.throw(Vec2(1.0, 0.0))
        advance(model, 0.8)
        self.assertTrue(all(enemy.marked for enemy in enemies))
        model.player.dash_cooldown = 10.0
        model.recall()
        advance(model, 0.7)

        perfect_events = [
            event for event in model.drain_events() if event["type"] == "perfect_recall"
        ]
        self.assertEqual(len(perfect_events), 1)
        self.assertEqual(model.blade.return_kills, 3)
        self.assertEqual(model.player.dash_cooldown, 0.0)
        self.assertGreaterEqual(model.score, 800)


class PlayerAndProgressionTests(unittest.TestCase):
    def test_dash_has_cooldown_and_becomes_available_again(self) -> None:
        model = GameModel(seed=2, wave_quotas=(99, 99, 99))
        model.start_run()
        model.wave_spawn_timer = 999.0
        model.set_move(1.0, 0.0)

        self.assertTrue(model.dash())
        self.assertFalse(model.dash())
        advance(model, 0.5)
        self.assertFalse(model.dash())
        advance(model, 0.5)
        self.assertTrue(model.dash())

    def test_echo_dash_only_damages_while_dashing(self) -> None:
        model = GameModel(seed=2, wave_quotas=(99, 99, 99))
        model.start_run()
        model.wave_spawn_timer = 999.0
        start = model.player.pos
        enemy = model.spawn_enemy(EnemyKind.HUSK, start + Vec2(90.0, 0.0), health=100.0)
        enemy.speed = 0.0
        model.player.dash_damage = 34.0

        model.set_move(1.0, 0.0)
        advance(model, 0.4)
        self.assertEqual(enemy.health, 100.0)
        self.assertFalse(enemy.marked)

        model.player.pos = start
        model.set_move(0.0, 0.0)
        self.assertTrue(model.dash(Vec2(1.0, 0.0)))
        advance(model, 0.2)
        self.assertEqual(enemy.health, 66.0)
        self.assertTrue(enemy.marked)

    def test_wave_clear_enters_lore_then_upgrade_then_next_wave(self) -> None:
        model = GameModel(seed=11, wave_quotas=(1, 1, 1))
        model.start_run()
        model.update(model.FIXED_STEP)
        enemy = next(enemy for enemy in model.enemies if enemy.alive)

        self.assertTrue(model.damage_enemy(enemy.id, 1_000.0))
        model.update(model.FIXED_STEP)
        self.assertEqual(model.mode, Mode.LORE)
        self.assertEqual(model.current_lore[0], "FIRST LAUGH")

        self.assertTrue(model.advance_lore())
        self.assertEqual(model.mode, Mode.UPGRADE)
        self.assertEqual(len(model.upgrade_choices), 3)
        self.assertEqual(len({choice.id for choice in model.upgrade_choices}), 3)
        selected = model.upgrade_choices[0]
        self.assertEqual(model.choose_upgrade(0), selected)
        self.assertEqual(model.mode, Mode.PLAYING)
        self.assertEqual(model.wave, 2)
        self.assertIn(selected.id, model.owned_upgrades)

    def test_damage_uses_invulnerability_then_reaches_game_over(self) -> None:
        model = GameModel(seed=4)
        model.start_run()

        self.assertTrue(model.damage_player(60.0, source="test"))
        self.assertFalse(model.damage_player(60.0, source="same_tick"))
        self.assertEqual(model.player.health, 40.0)
        advance(model, 0.5)
        self.assertTrue(model.damage_player(50.0, source="test"))
        self.assertEqual(model.mode, Mode.GAME_OVER)
        self.assertEqual(model.player.health, 0.0)

    def test_game_over_cannot_be_overwritten_by_same_tick_wave_clear(self) -> None:
        model = GameModel(seed=8, wave_quotas=(1, 1, 1))
        model.start_run()
        model.update(model.FIXED_STEP)
        enemy = next(enemy for enemy in model.enemies if enemy.alive)
        model.damage_enemy(enemy.id, 1_000.0)
        model.spawn_projectile(model.player.pos, Vec2(), damage=1_000.0)

        model.update(model.FIXED_STEP)

        self.assertEqual(model.mode, Mode.GAME_OVER)
        event_types = [event["type"] for event in model.drain_events()]
        self.assertIn("game_over", event_types)
        self.assertNotIn("memory_recovered", event_types)

    def test_all_nine_upgrades_change_gameplay_values(self) -> None:
        self.assertEqual(len(UPGRADES), 9)
        changed: set[str] = set()
        for upgrade in UPGRADES:
            model = GameModel(seed=1)
            model.start_run()
            before = (
                model.blade.outbound_damage,
                model.blade.return_damage,
                model.blade.hit_radius,
                model.explosion_damage,
                model.explosion_radius,
                model.player.dash_damage,
                model.player.max_health,
                model.momentum_enabled,
                model.blade.perfect_threshold,
                model.blade.max_range,
                model.blade.auto_recall_delay,
            )
            model._apply_upgrade(upgrade)
            after = (
                model.blade.outbound_damage,
                model.blade.return_damage,
                model.blade.hit_radius,
                model.explosion_damage,
                model.explosion_radius,
                model.player.dash_damage,
                model.player.max_health,
                model.momentum_enabled,
                model.blade.perfect_threshold,
                model.blade.max_range,
                model.blade.auto_recall_delay,
            )
            if before != after:
                changed.add(upgrade.id)
        self.assertEqual(changed, {upgrade.id for upgrade in UPGRADES})


class DeterminismAndBossTests(unittest.TestCase):
    def test_render_frame_chunking_does_not_change_fixed_step_state(self) -> None:
        first = GameModel(seed=21, wave_quotas=(99, 99, 99))
        second = GameModel(seed=21, wave_quotas=(99, 99, 99))
        first.start_run()
        second.start_run()
        first.set_move(0.75, -0.25)
        second.set_move(0.75, -0.25)
        first.throw(Vec2(1.0, 0.0))
        second.throw(Vec2(1.0, 0.0))

        first.update(2.0)
        for _ in range(120):
            second.update(1.0 / 60.0)

        self.assertEqual(first.snapshot(), second.snapshot())
        self.assertEqual(first.drain_events(), second.drain_events())

    def test_focus_mode_scales_enemy_time_but_not_player_motion(self) -> None:
        normal = GameModel(seed=1, focus_mode=False, wave_quotas=(99, 99, 99))
        focus = GameModel(seed=1, focus_mode=True, wave_quotas=(99, 99, 99))
        for model in (normal, focus):
            model.start_run()
            model.wave_spawn_timer = 999.0
            model.set_move(1.0, 0.0)
        normal_enemy = normal.spawn_enemy(EnemyKind.HUSK, Vec2(100.0, 360.0))
        focus_enemy = focus.spawn_enemy(EnemyKind.HUSK, Vec2(100.0, 360.0))

        advance(normal, 0.5)
        advance(focus, 0.5)

        normal_distance = normal_enemy.pos.x - 100.0
        focus_distance = focus_enemy.pos.x - 100.0
        self.assertAlmostEqual(focus_distance / normal_distance, 0.75, places=5)
        self.assertEqual(normal.player.pos, focus.player.pos)

    def test_curator_telegraphs_three_patterns_and_death_wins(self) -> None:
        model = GameModel(seed=5, wave_quotas=(1, 1, 1))
        model.start_run()
        model._begin_wave(4)
        model.player.max_health = 10_000.0
        model.player.health = 10_000.0

        advance(model, 7.0)
        events = model.drain_events()
        patterns = {
            event["pattern"]
            for event in events
            if event["type"] == "boss_telegraph"
        }
        self.assertTrue({"radial", "charge", "summon"}.issubset(patterns))

        boss = model.boss
        self.assertIsNotNone(boss)
        assert boss is not None
        for enemy in tuple(model.enemies):
            if enemy.summoned_by_boss:
                model.damage_enemy(enemy.id, 1_000.0)
        model.update(model.FIXED_STEP)
        self.assertFalse(boss.shielded)
        self.assertTrue(model.damage_enemy(boss.id, 10_000.0))
        self.assertEqual(model.mode, Mode.VICTORY)
        self.assertIsNone(model.boss)
        self.assertIn("victory", [event["type"] for event in model.drain_events()])


if __name__ == "__main__":
    unittest.main()
