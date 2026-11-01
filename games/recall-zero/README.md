# RECALL//ZERO

RECALL//ZERO is a compact Windows arena-action game made without a game engine. You throw the last human memory into a swarm, move to reshape its path, then recall it through marked enemies to create chain detonations.

The camera follows Echo Zero across the arena with clamped edge framing. The world view moves with play while the HUD and upgrade screens remain fixed and readable.

## Run from source

Requirements: Windows and Python 3.12.

```powershell
cd games/recall-zero
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe run_game.py
```

## Controls

| Input | Action |
| --- | --- |
| `WASD` / arrows | Move |
| Mouse | Aim |
| Left click / `Enter` | Throw or recall the blade |
| `Space` / right click | Dash |
| `Esc` / `P` | Pause or back |
| `F11` | Toggle fullscreen |
| `M` | Mute |
| `R` | Restart after victory or defeat |

Title-screen accessibility toggles:

- `1`: Focus mode (enemies move 25% slower)
- `2`: Reduced motion (no shake or hit-stop)
- `3`: High contrast

## Test

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
$env:SDL_VIDEODRIVER = "dummy"
$env:SDL_AUDIODRIVER = "dummy"
.\.venv\Scripts\python.exe scripts\smoke_test.py
.\.venv\Scripts\python.exe scripts\performance_check.py
```

## Build the Windows release

```powershell
powershell -ExecutionPolicy Bypass -File .\build.ps1
```

The executable is produced under `dist/RecallZero/RecallZero.exe`. The build is intentionally one-folder rather than one-file so bundled LGPL components remain visible and replaceable.

## Technology boundary

Pygame-ce is an SDL-based multimedia library, not a game engine. RECALL//ZERO owns its fixed-step loop, collisions, AI, encounter direction, state machine, effects, procedural audio, persistence, and UI.

See [GAME_DESIGN.md](GAME_DESIGN.md) for lore, mechanics, reference boundaries, and the later engine-port plan.
