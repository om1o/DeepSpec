from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from recall_zero.save_data import DEFAULT_SAVE, load_save, save_data


class SaveDataTests(unittest.TestCase):
    def test_missing_and_invalid_files_fail_closed_to_defaults(self) -> None:
        with TemporaryDirectory() as temp:
            path = Path(temp) / "save.json"
            self.assertEqual(load_save(path), DEFAULT_SAVE)

            path.write_text("not json", encoding="utf-8")
            self.assertEqual(load_save(path), DEFAULT_SAVE)

    def test_round_trip_preserves_supported_progress_and_settings(self) -> None:
        with TemporaryDirectory() as temp:
            path = Path(temp) / "nested" / "save.json"
            expected = load_save(path)
            expected["best_score"] = 12_345
            expected["victories"] = 2
            expected["unlocked_lore"] = 3
            expected["settings"]["focus_mode"] = True
            expected["settings"]["muted"] = True

            save_data(expected, path)

            self.assertEqual(load_save(path), expected)

    def test_unknown_or_wrongly_typed_fields_are_ignored(self) -> None:
        with TemporaryDirectory() as temp:
            path = Path(temp) / "save.json"
            path.write_text(
                '{"best_score": "huge", "victories": -1, "settings": {"muted": "yes"}}',
                encoding="utf-8",
            )

            self.assertEqual(load_save(path), DEFAULT_SAVE)


if __name__ == "__main__":
    unittest.main()
