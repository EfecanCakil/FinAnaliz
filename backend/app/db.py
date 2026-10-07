"""SQLite veritabanı katmanı.

Yerel masaüstü sürümünde kurulum gerektirmeyen SQLite kullanılır. Şema,
ileride web sürümüne geçerken PostgreSQL'e doğrudan taşınabilecek şekilde
standart SQL ile yazılmıştır.
"""
import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path

DATA_DIR = Path(os.environ.get("FINANS_DATA_DIR", Path(__file__).resolve().parents[1] / "data"))
DB_PATH = DATA_DIR / "finans.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS user_prefs (
    user_id INTEGER NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    PRIMARY KEY (user_id, key)
);
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS watchlist (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    symbol TEXT NOT NULL,
    UNIQUE(user_id, symbol)
);
CREATE TABLE IF NOT EXISTS portfolio (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    symbol TEXT NOT NULL,
    quantity REAL NOT NULL,
    buy_price REAL NOT NULL,
    buy_date TEXT,
    note TEXT
);
CREATE TABLE IF NOT EXISTS alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    symbol TEXT NOT NULL,
    condition TEXT NOT NULL,
    target REAL,
    triggered INTEGER NOT NULL DEFAULT 0,
    triggered_at TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    repeat INTEGER NOT NULL DEFAULT 0,
    note TEXT,
    last_value REAL,
    last_fired REAL
);
CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    symbol TEXT NOT NULL,
    side TEXT NOT NULL CHECK (side IN ('buy', 'sell')),
    quantity REAL NOT NULL CHECK (quantity > 0),
    price REAL NOT NULL CHECK (price >= 0),
    date TEXT,
    fee REAL NOT NULL DEFAULT 0,
    note TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS cash_movements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    amount REAL NOT NULL,
    date TEXT NOT NULL,
    settle_date TEXT NOT NULL,
    note TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT, link TEXT,
    read INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    symbol TEXT NOT NULL, type TEXT NOT NULL, quantity REAL NOT NULL, price REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'open', expires TEXT, note TEXT, reserved_try REAL NOT NULL DEFAULT 0,
    filled_price REAL, result TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP, closed_at TEXT
);
CREATE TABLE IF NOT EXISTS bots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    symbol TEXT NOT NULL, strategy TEXT NOT NULL, params TEXT, amount_try REAL NOT NULL,
    active INTEGER NOT NULL DEFAULT 1, position_qty REAL NOT NULL DEFAULT 0,
    last_action_date TEXT, last_message TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS badges (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    badge TEXT NOT NULL,
    earned_at TEXT DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, badge)
);
CREATE TABLE IF NOT EXISTS equity_snapshots (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    day TEXT NOT NULL, equity REAL, cash REAL, invested REAL,
    PRIMARY KEY (user_id, day)
);
CREATE TABLE IF NOT EXISTS smart_alert_log (
    user_id INTEGER NOT NULL, symbol TEXT NOT NULL, kind TEXT NOT NULL, day TEXT NOT NULL,
    PRIMARY KEY (user_id, symbol, kind, day)
);
CREATE TABLE IF NOT EXISTS academy_progress (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    lesson TEXT NOT NULL, score INTEGER NOT NULL,
    completed_at TEXT DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, lesson)
);
CREATE TABLE IF NOT EXISTS predictions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    week TEXT NOT NULL, symbol TEXT NOT NULL, direction TEXT NOT NULL, base_price REAL NOT NULL,
    end_price REAL, result TEXT, points INTEGER,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS weekly_reports (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    week TEXT NOT NULL, payload TEXT NOT NULL,
    PRIMARY KEY (user_id, week)
);
CREATE TABLE IF NOT EXISTS targets (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category TEXT NOT NULL,
    target_pct REAL NOT NULL,
    PRIMARY KEY (user_id, category)
);
CREATE TABLE IF NOT EXISTS price_cache (
    symbol TEXT NOT NULL,
    period TEXT NOT NULL,
    interval TEXT NOT NULL,
    fetched_at REAL NOT NULL,
    payload TEXT NOT NULL,
    PRIMARY KEY (symbol, period, interval)
);
"""


def init_db() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with connect() as con:
        _migrate_alerts(con)
        con.executescript(SCHEMA)
        _add_columns(con, "transactions", {"funded": "INTEGER NOT NULL DEFAULT 0", "amount_try": "REAL", "settle_date": "TEXT",
                                           "settled_notified": "INTEGER NOT NULL DEFAULT 0", "reason": "TEXT", "emotion": "TEXT",
                                           "tag": "TEXT", "review": "TEXT"})
        _add_columns(con, "users", {"full_name": "TEXT", "email": "TEXT", "phone": "TEXT", "city": "TEXT",
                                    "risk_profile": "TEXT", "experience": "TEXT", "bio": "TEXT"})
        # Eski sürümdeki pozisyon kayıtları alış işlemlerine dönüştürülür (tek seferlik geçiş)
        con.execute("""INSERT INTO transactions (user_id, symbol, side, quantity, price, date, note)
                       SELECT user_id, symbol, 'buy', quantity, buy_price, buy_date, note FROM portfolio""")
        con.execute("DELETE FROM portfolio")


def _add_columns(con, table: str, columns: dict[str, str]) -> None:
    existing = {r["name"] for r in con.execute(f"PRAGMA table_info({table})")}
    for name, ddl in columns.items():
        if name not in existing:
            con.execute(f"ALTER TABLE {table} ADD COLUMN {name} {ddl}")


def _migrate_alerts(con) -> None:
    """Eski alarm tablosu yalnızca 'above/below' koşullarına izin veriyordu; yeni sütunlarla yeniden oluşturulur."""
    row = con.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='alerts'").fetchone()
    if not row or "CHECK (condition IN" not in row["sql"]:
        return
    con.executescript("""
        PRAGMA foreign_keys = OFF;
        ALTER TABLE alerts RENAME TO alerts_old;
        CREATE TABLE alerts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            symbol TEXT NOT NULL, condition TEXT NOT NULL, target REAL,
            triggered INTEGER NOT NULL DEFAULT 0, triggered_at TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            repeat INTEGER NOT NULL DEFAULT 0, note TEXT, last_value REAL, last_fired REAL
        );
        INSERT INTO alerts (id, user_id, symbol, condition, target, triggered, triggered_at, created_at)
            SELECT id, user_id, symbol, condition, target, triggered, triggered_at, created_at FROM alerts_old;
        DROP TABLE alerts_old;
        PRAGMA foreign_keys = ON;
    """)


@contextmanager
def connect():
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys = ON")
    try:
        yield con
        con.commit()
    finally:
        con.close()


def rows(cur) -> list[dict]:
    return [dict(r) for r in cur.fetchall()]
