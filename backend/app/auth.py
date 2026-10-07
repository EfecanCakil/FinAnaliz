"""Kullanıcı kaydı, girişi ve JWT tabanlı yetkilendirme."""
import hashlib
import hmac
import secrets
import time

import jwt
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from .db import DATA_DIR, connect

TOKEN_TTL = 7 * 24 * 3600
_bearer = HTTPBearer(auto_error=False)


def _secret() -> str:
    path = DATA_DIR / "secret.key"
    if not path.exists():
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        path.write_text(secrets.token_hex(32))
    return path.read_text().strip()


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 200_000).hex()
    return f"{salt}${digest}"


def verify_password(password: str, stored: str) -> bool:
    salt, digest = stored.split("$", 1)
    check = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 200_000).hex()
    return hmac.compare_digest(check, digest)


def create_token(user_id: int, username: str) -> str:
    payload = {"sub": str(user_id), "name": username, "exp": int(time.time()) + TOKEN_TTL}
    return jwt.encode(payload, _secret(), algorithm="HS256")


def register(username: str, password: str) -> dict:
    username = username.strip()
    if len(username) < 3 or len(password) < 6:
        raise HTTPException(400, "Kullanıcı adı en az 3, şifre en az 6 karakter olmalıdır.")
    with connect() as con:
        if con.execute("SELECT 1 FROM users WHERE username = ?", (username,)).fetchone():
            raise HTTPException(409, "Bu kullanıcı adı zaten kayıtlı.")
        cur = con.execute(
            "INSERT INTO users (username, password_hash) VALUES (?, ?)",
            (username, hash_password(password)),
        )
        user_id = cur.lastrowid
    return {"token": create_token(user_id, username), "username": username}


def login(username: str, password: str) -> dict:
    with connect() as con:
        row = con.execute("SELECT * FROM users WHERE username = ?", (username.strip(),)).fetchone()
    if not row or not verify_password(password, row["password_hash"]):
        raise HTTPException(401, "Kullanıcı adı veya şifre hatalı.")
    return {"token": create_token(row["id"], row["username"]), "username": row["username"]}


def current_user(creds: HTTPAuthorizationCredentials | None = Depends(_bearer)) -> int:
    if creds is None:
        raise HTTPException(401, "Giriş yapmanız gerekiyor.")
    try:
        payload = jwt.decode(creds.credentials, _secret(), algorithms=["HS256"])
    except jwt.PyJWTError:
        raise HTTPException(401, "Oturum süresi doldu, lütfen tekrar giriş yapın.")
    return int(payload["sub"])
