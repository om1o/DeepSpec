from __future__ import annotations

from copy import deepcopy
import os
import unittest
from unittest.mock import patch

os.environ.setdefault("SDL_VIDEODRIVER", "dummy")
os.environ.setdefault("SDL_AUDIODRIVER", "dummy")

import pygame

from recall_zero import EnemyKind, Vec2
from recall_zero.app import CAMERA_HEIGHT, CAMERA_WIDTH, RecallZeroApp
from recall_zero.save_data import DEFAULT_SAVE


class FakeKeys:
    def __init__(self, pressed: set[int]) -> None:
        self.pressed = pressed

    def __getitem__(self, key: int) -> bool:
        return key in self.pressed


class AppInputTests(unittest.TestCase):
    def setUp(self) -> None:
        self.load_patch = patch("recall_zero.app.load_save", return_value=deepcopy(DEFAULT_SAVE))
        self.save_patch = patch("recall_zero.app.save_data")
        self.load_patch.start()
        self.save_patch.start()
        self.app = RecallZeroApp(headless=True, seed=41)

    def tearDown(self) -> None:
        self.app.close()
        self.save_patch.stop()
        self.load_patch.stop()

    def test_all_arrow_keys_drive_the_expected_movement_vector(self) -> None:
        cases = (
            (pygame.K_LEFT, Vec2(-1.0, 0.0)),
            (pygame.K_RIGHT, Vec2(1.0, 0.0)),
            (pygame.K_UP, Vec2(0.0, -1.0)),
            (pygame.K_DOWN, Vec2(0.0, 1.0)),
        )
        for key, expected in cases:
            with self.subTest(key=key), patch(
                "pygame.key.get_pressed",
                return_value=FakeKeys({key}),
            ):
                self.app._update_live_input()
                self.assertEqual(self.app.model.move_input, expected)

        with patch("pygame.key.get_pressed", return_value=FakeKeys(set())):
            self.app._update_live_input()
        self.assertEqual(self.app.model.move_input, Vec2())

    def test_diagonal_arrows_are_normalized_and_opposites_cancel(self) -> None:
        with patch(
            "pygame.key.get_pressed",
            return_value=FakeKeys({pygame.K_UP, pygame.K_RIGHT}),
        ):
            self.app._update_live_input()
        self.assertAlmostEqual(self.app.model.move_input.length(), 1.0)
        self.assertGreater(self.app.model.move_input.x, 0.0)
        self.assertLess(self.app.model.move_input.y, 0.0)

        with patch(
            "pygame.key.get_pressed",
            return_value=FakeKeys({pygame.K_LEFT, pygame.K_RIGHT, pygame.K_UP, pygame.K_DOWN}),
        ):
            self.app._update_live_input()
        self.assertEqual(self.app.model.move_input, Vec2())

    def test_camera_centers_and_clamps_to_all_arena_edges(self) -> None:
        self.app.model.player.pos = Vec2(640.0, 360.0)
        self.assertEqual(self.app._camera_target(), pygame.Vector2(128.0, 72.0))

        self.app.model.player.pos = Vec2(0.0, 0.0)
        self.assertEqual(self.app._camera_target(), pygame.Vector2())

        self.app.model.player.pos = Vec2(1280.0, 720.0)
        self.assertEqual(
            self.app._camera_target(),
            pygame.Vector2(1280.0 - CAMERA_WIDTH, 720.0 - CAMERA_HEIGHT),
        )

    def test_screen_center_maps_through_camera_while_ui_stays_on_canvas(self) -> None:
        self.app.camera.update(128.0, 72.0)
        self.assertEqual(self.app._screen_to_canvas((640, 360)), (640.0, 360.0))
        self.assertEqual(self.app._screen_to_world((640, 360)), (640.0, 360.0))
        self.assertEqual(self.app._upgrade_card_at((200.0, 300.0)), 0)

    def test_boss_framing_keeps_the_upper_arena_visible(self) -> None:
        self.app.model.player.pos = Vec2(640.0, 360.0)
        self.app.model.enemies.clear()
        self.app.model.spawn_enemy(EnemyKind.CURATOR, Vec2(640.0, 60.0))
        self.assertEqual(self.app._camera_target().y, 0.0)

    def test_arrow_movement_advances_the_follow_camera(self) -> None:
        self.app.model.start_run()
        self.app._snap_camera()
        camera_before = self.app.camera.x
        with patch(
            "pygame.key.get_pressed",
            return_value=FakeKeys({pygame.K_RIGHT}),
        ):
            self.app._update_live_input()
        self.app.model.update(0.25)
        self.app._update_camera(0.25)
        self.assertGreater(self.app.model.player.pos.x, 640.0)
        self.assertGreater(self.app.camera.x, camera_before)


if __name__ == "__main__":
    unittest.main()
