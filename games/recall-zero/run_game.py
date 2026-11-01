from __future__ import annotations

import os

os.environ.setdefault("PYGAME_HIDE_SUPPORT_PROMPT", "1")

from recall_zero.app import RecallZeroApp  # noqa: E402


def main() -> int:
    app = RecallZeroApp()
    try:
        return app.run()
    finally:
        app.close()


if __name__ == "__main__":
    raise SystemExit(main())
