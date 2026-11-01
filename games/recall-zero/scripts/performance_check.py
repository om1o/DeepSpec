"""Bounded performance gate for crowded native gameplay."""

from __future__ import annotations

import json
from pathlib import Path
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from recall_zero import EnemyKind, GameModel, Vec2
from recall_zero.app import RecallZeroApp


def populate(model: GameModel, count: int = 100) -> None:
    model.enemies.clear()
    model.wave_spawned = model.wave_quotas[0]
    for index in range(count):
        column = index % 20
        row = index // 20
        model.spawn_enemy(
            (EnemyKind.HUSK, EnemyKind.SCRIBE, EnemyKind.HOUND)[index % 3],
            Vec2(45 + column * 62, 70 + row * 110),
        )
    model.player.max_health = 1_000_000
    model.player.health = model.player.max_health


def main() -> int:
    model = GameModel(seed=23)
    model.start_run()
    populate(model)
    model.drain_events()

    started = time.perf_counter()
    for _ in range(600):
        model.update(1 / 60)
        model.drain_events()
    simulation_seconds = time.perf_counter() - started
    if simulation_seconds >= 9.0:
        raise AssertionError(f"10 simulated seconds took {simulation_seconds:.3f}s; expected < 9s")

    render_enemy_count = 36  # Twice the largest normal-wave quota.
    render_cpu_samples: list[float] = []
    render_wall_samples: list[float] = []
    app = RecallZeroApp(headless=True, seed=23)
    try:
        app.model.start_run()
        populate(app.model, render_enemy_count)
        app.model.drain_events()
        for _ in range(8):
            app._render()  # Warm font glyphs and renderer caches before timing.
        for _ in range(3):
            wall_started = time.perf_counter()
            cpu_started = time.process_time()
            for _ in range(120):
                app._render()
            render_cpu_samples.append(time.process_time() - cpu_started)
            render_wall_samples.append(time.perf_counter() - wall_started)
    finally:
        app.close()

    # This is a synthetic software-render regression gate, not a native FPS
    # claim. CPU time excludes unrelated scheduler/antivirus pauses; the wall
    # samples remain in the report so unusual host contention stays visible.
    render_cpu_seconds = min(render_cpu_samples)
    if render_cpu_seconds >= 2.5:
        samples = ", ".join(f"{sample:.3f}s" for sample in render_cpu_samples)
        raise AssertionError(f"120 static crowded renders used [{samples}] CPU; best must be < 2.5s")

    result = {
        "performance": "pass",
        "active_enemies": 100,
        "simulated_seconds": 10,
        "simulation_wall_seconds": round(simulation_seconds, 4),
        "render_enemies": render_enemy_count,
        "synthetic_render_frames": 120,
        "render_cpu_samples": [round(sample, 4) for sample in render_cpu_samples],
        "render_wall_samples": [round(sample, 4) for sample in render_wall_samples],
        "best_render_cpu_seconds": round(render_cpu_seconds, 4),
    }
    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
