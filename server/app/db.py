import sqlite3
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  username    TEXT,
  allows_pm   INTEGER NOT NULL DEFAULT 0,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS plans (
  id                 TEXT PRIMARY KEY,
  owner_id           INTEGER NOT NULL REFERENCES users(id),
  title              TEXT NOT NULL,
  format             TEXT NOT NULL,
  budget             TEXT NOT NULL,
  duration           TEXT NOT NULL,
  vote_place         INTEGER NOT NULL,
  middle             INTEGER NOT NULL,
  days               TEXT NOT NULL,  -- JSON: ["2026-11-06", ...]
  times              TEXT NOT NULL,  -- JSON: ["19:00", ...]
  deadline           TEXT,
  status             TEXT NOT NULL DEFAULT 'collecting',
  chosen_date        TEXT,
  chosen_time        TEXT,
  place_id           TEXT,
  inline_message_id  TEXT,
  reminded_day       INTEGER NOT NULL DEFAULT 0,
  reminded_soon      INTEGER NOT NULL DEFAULT 0,
  bill               TEXT,           -- JSON: {"total":186,"payerId":1,"paid":[3]}
  created_at         TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS members (
  plan_id    TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  status     TEXT,
  slots      TEXT NOT NULL DEFAULT '{}',
  area_lat   REAL,
  area_lng   REAL,
  remind     INTEGER NOT NULL DEFAULT 1,
  review     TEXT,
  joined_at  TEXT NOT NULL,
  PRIMARY KEY (plan_id, user_id)
);

CREATE TABLE IF NOT EXISTS votes (
  plan_id   TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  user_id   INTEGER NOT NULL,
  place_id  TEXT NOT NULL,
  PRIMARY KEY (plan_id, user_id, place_id)
);

CREATE TABLE IF NOT EXISTS custom_places (
  id        TEXT PRIMARY KEY,
  plan_id   TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  name      TEXT NOT NULL,
  url       TEXT,
  lat       REAL,
  lng       REAL,
  added_by  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS members_user ON members(user_id);
"""


def open_db(path: str) -> sqlite3.Connection:
    if path != ":memory:":
        Path(path).parent.mkdir(parents=True, exist_ok=True)
    # Все запросы идут из одного event loop, поэтому общий коннект безопасен.
    db = sqlite3.connect(path, check_same_thread=False, isolation_level=None)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys = ON")
    if path != ":memory:":
        db.execute("PRAGMA journal_mode = WAL")
    db.executescript(SCHEMA)
    migrate(db)
    return db


def migrate(db: sqlite3.Connection) -> None:
    """Доводит старые базы до текущей схемы."""
    columns = {r["name"] for r in db.execute("PRAGMA table_info(custom_places)")}
    for column in ("lat", "lng"):
        if column not in columns:
            db.execute(f"ALTER TABLE custom_places ADD COLUMN {column} REAL")
