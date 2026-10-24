"""Testler gerçek kullanıcı verisine dokunmaz: her test oturumu geçici bir veri klasörü kullanır ve
ağ (Yahoo) çağrıları sahte fiyatlarla değiştirilir."""
import os
import sys
import tempfile
from pathlib import Path

_TMP = tempfile.mkdtemp(prefix="trademetrix-test-")
os.environ["FINANS_DATA_DIR"] = _TMP
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest  # noqa: E402

from app import db, market  # noqa: E402

db.init_db()


@pytest.fixture
def prices(monkeypatch):
    """market.quotes'u sahte fiyatlarla değiştirir; testler fiyatları sözlük üzerinden değiştirebilir."""
    table: dict[str, float] = {"THYAO.IS": 100.0, "GARAN.IS": 50.0, "USDTRY=X": 40.0}

    def quotes(symbols):
        return [{"symbol": s, "name": s, "price": table.get(s), "change_pct": 0.0, "currency": market.currency_of(s)} for s in symbols]
    monkeypatch.setattr(market, "quotes", quotes)
    return table


@pytest.fixture
def user():
    """Her test için yeni bir kayıtlı kullanıcı (başlangıç sanal bakiyesiyle)."""
    import uuid
    from app import account, auth
    name = "t" + uuid.uuid4().hex[:10]
    auth.register(name, "Guclu-Parola-123")
    with db.connect() as con:
        uid = con.execute("SELECT id FROM users WHERE username=?", (name,)).fetchone()["id"]
    account.ensure_account(uid)
    return uid
