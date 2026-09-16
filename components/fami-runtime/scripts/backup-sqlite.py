"""Create a consistent private backup of live Hermes SQLite stores; no content output."""
import sqlite3
import sys
from pathlib import Path

source, target = map(Path, sys.argv[1:])
target.mkdir(parents=True, exist_ok=False)
for filename in ("state.db", "projects.db"):
    with sqlite3.connect((source / filename).as_uri() + "?mode=ro", uri=True) as src:
        with sqlite3.connect(target / filename) as dst:
            src.backup(dst)
            assert dst.execute("PRAGMA integrity_check").fetchone() == ("ok",)
    print(f"{filename}: consistent backup and integrity check passed")
