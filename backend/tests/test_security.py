"""Giriş güvenliği ve sunucu güvenlik katmanı."""
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app import auth
from app.main import app

client = TestClient(app)


def test_password_hash_roundtrip():
    h = auth.hash_password("Guclu-Parola-123")
    assert h != "Guclu-Parola-123"
    assert auth.verify_password("Guclu-Parola-123", h)
    assert not auth.verify_password("yanlis", h)


def test_weak_password_rejected():
    with pytest.raises(HTTPException):
        auth.check_password("123", "ali")


def test_login_lockout_after_repeated_failures(user):
    from app.db import connect
    with connect() as con:
        name = con.execute("SELECT username FROM users WHERE id=?", (user,)).fetchone()["username"]
    for _ in range(auth.MAX_FAILS):
        with pytest.raises(HTTPException):
            auth.login(name, "yanlis-parola")
    with pytest.raises(HTTPException) as e:  # doğru parolayla bile kilit süresince giriş yapılamaz
        auth.login(name, "Guclu-Parola-123")
    assert e.value.status_code in (423, 429)


def test_api_requires_token():
    r = client.get("/api/portfolio/risks", headers={"host": "127.0.0.1:8765"})
    assert r.status_code == 401


def test_invalid_token_rejected():
    r = client.get("/api/portfolio/risks", headers={"host": "127.0.0.1:8765", "Authorization": "Bearer sahte.anahtar.degeri"})
    assert r.status_code == 401


def test_foreign_host_rejected_dns_rebinding():
    r = client.get("/api/markets", headers={"host": "kotu-site.example"})
    assert r.status_code == 400


def test_security_headers_present():
    r = client.get("/api/markets", headers={"host": "localhost:8765"})
    assert r.headers["x-frame-options"] == "DENY"
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.headers["cache-control"] == "no-store"


@pytest.mark.parametrize("path", ["/..%2f..%2fapp%2fdb.py", "/../secret.key", "/%2e%2e/%2e%2e/backend/app/main.py"])
def test_path_traversal_does_not_leak_files(path):
    r = client.get(path, headers={"host": "localhost:8765"})
    assert "import" not in r.text and "sqlite" not in r.text


def test_client_error_endpoint_is_rate_limited():
    codes = [client.post("/api/client-error", json={"message": f"hata {i}"}, headers={"host": "localhost"}).json()["ok"] for i in range(70)]
    assert codes.count(False) >= 1
