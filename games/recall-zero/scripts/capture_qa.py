"""Render deterministic UI states for visual review."""

from __future__ import annotations

from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pygame

from recall_zero import BladeState, EnemyKind, Mode, UPGRADES, Vec2
from recall_zero.app import RecallZeroApp


def capture(app: RecallZeroApp, name: str, output: Path) -> None:
    app._snap_camera()
    app._render()
    pygame.image.save(app.canvas, output / f"{name}.png")


def main() -> int:
    output = Path("build") / "qa-screens"
    output.mkdir(parents=True, exist_ok=True)
    app = RecallZeroApp(headless=True, seed=31)
    try:
        capture(app, "01-title", output)

        app.model.start_story()
        app.model.story_index = 1
        capture(app, "02-story", output)

        app.model.start_run()
        app.model.enemies.clear()
        center = app.model.player.pos
        app.model.spawn_enemy(EnemyKind.HUSK, center + Vec2(180, -30))
        app.model.spawn_enemy(EnemyKind.SCRIBE, center + Vec2(290, 140))
        hound = app.model.spawn_enemy(EnemyKind.HOUND, center + Vec2(-230, 110))
        hound.ai_state = "telegraph"
        hound.target_direction = (app.model.player.pos - hound.pos).normalized()
        app.model.aim_at(center + Vec2(310, 0))
        app.model.throw()
        app.model.update(0.68)
        if app.model.blade.state is BladeState.OUTBOUND:
            app.model.anchor()
        capture(app, "03-gameplay", output)

        app.model.mode = Mode.LORE
        app.model.wave = 1
        app.model.lore_index = 0
        capture(app, "04-lore", output)

        app.model.mode = Mode.UPGRADE
        app.model.upgrade_choices = UPGRADES[:3]
        capture(app, "05-upgrade", output)

        app.model._begin_wave(4)
        boss = app.model.boss
        assert boss is not None
        boss.ai_state = "telegraph_radial"
        boss.health = boss.max_health * 0.72
        capture(app, "06-boss", output)

        app.model.mode = Mode.VICTORY
        app.model.score = 7_450
        capture(app, "07-victory", output)

        print(f"qa-screens: {output.resolve()}")
        return 0
    finally:
        app.close()


if __name__ == "__main__":
    raise SystemExit(main())
