"""Headless integration smoke test for model + native pygame shell."""

from __future__ import annotations

import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from recall_zero import BladeState, EnemyKind, Mode, Vec2
from recall_zero.app import RecallZeroApp


def main() -> int:
    app = RecallZeroApp(headless=True, seed=19)
    try:
        app.model.start_story()
        for _ in range(3):
            app.model.advance_story()
        assert app.model.mode is Mode.PLAYING

        app.model.enemies.clear()
        target = app.model.spawn_enemy(
            EnemyKind.HUSK,
            app.model.player.pos + Vec2(150, 0),
            health=45,
        )
        app.model.aim_at(target.pos)
        assert app.model.throw()
        app.model.update(0.28)
        assert target.marked
        assert app.model.blade.state in (BladeState.OUTBOUND, BladeState.ANCHORED)
        assert app.model.recall()
        app.model.update(0.4)
        assert app.model.blade.state is BladeState.HELD
        assert not target.alive

        camera_before = app.camera.x
        app.model.set_move(1.0, 0.0)
        app.model.update(0.25)
        app._update_camera(0.25)
        app.model.set_move(0.0, 0.0)
        assert app.camera.x > camera_before

        assert app.model.pause_gameplay()
        app.tick(1 / 60)
        assert app.model.mode is Mode.PAUSED
        assert app.model.resume()
        app.tick(1 / 60)

        output = Path("build")
        output.mkdir(exist_ok=True)
        app._render()  # Native shell render is the integration target of this script.
        import pygame

        pygame.image.save(app.canvas, output / "smoke-gameplay.png")
        snapshot = json.loads(app.render_snapshot())
        (output / "smoke-state.json").write_text(json.dumps(snapshot, indent=2), encoding="utf-8")
        assert snapshot["mode"] == "playing"
        assert snapshot["camera"]["width"] == 1024
        assert app.canvas.get_at((640, 360)) != app.canvas.get_at((0, 0))
        print(json.dumps({"smoke": "pass", "screenshot": str(output / "smoke-gameplay.png"), "state": snapshot}))
        return 0
    finally:
        app.close()


if __name__ == "__main__":
    raise SystemExit(main())
