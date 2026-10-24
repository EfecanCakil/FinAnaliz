"""Kullanıcı kaydı, girişi, misafir hesabı ve JWT tabanlı yetkilendirme.

- Şifreler PBKDF2-SHA256 (200.000 tur, kullanıcıya özel tuz) ile saklanır.
- Uygulama yerel çalıştığı ve e-posta gönderilmediği için "şifremi unuttum" akışı kayıtta bir kez
  gösterilen kurtarma koduyla çalışır (kodun yalnızca özeti saklanır).
- Art arda hatalı denemelerde hesap kısa süreliğine kilitlenir.
- Her kullanıcının bir "oturum sürümü" vardır; şifre değişince veya "tüm oturumlardan çık" denince artar
  ve eski oturum anahtarları geçersiz olur.
- Misafir hesapları kayıt olmadan denemek içindir; 7 gün kullanılmazsa silinir, istenirse kalıcı hesaba
  dönüştürülür (veriler korunur).
"""
import hashlib
import hmac
import re
import secrets
import time

import jwt
from fastapi import Depends, Header, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from .db import DATA_DIR, connect

TOKEN_TTL = 30 * 24 * 3600        # "Beni hatırla"
SHORT_TTL = 12 * 3600             # beni hatırla kapalı
GUEST_TTL = 7 * 24 * 3600
GUEST_KEEP_DAYS = 7
MAX_FAILS = 5
LOCK_SECONDS = 5 * 60
USERNAME_RE = re.compile(r"^[A-Za-z0-9ÇĞİÖŞÜçğıöşü._-]{3,24}$")
COMMON = {"12345678", "123456789", "1234567890", "password", "sifre123", "şifre123", "qwerty123", "11111111", "abc12345",
          "password1", "iloveyou", "00000000", "parola123", "123123123", "finanaliz", "finanaliz1"}
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


def verify_password(password: str, stored: str | None) -> bool:
    if not stored or "$" not in stored:
        return False
    salt, digest = stored.split("$", 1)
    check = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 200_000).hex()
    return hmac.compare_digest(check, digest)


# ---------- Doğrulama kuralları ----------
def check_username(username: str) -> str:
    u = username.strip()
    if not USERNAME_RE.match(u):
        raise HTTPException(400, "Kullanıcı adı 3–24 karakter olmalı; yalnızca harf, rakam, nokta, alt çizgi ve tire içerebilir.")
    if u.lower().startswith("misafir"):
        raise HTTPException(400, "Bu kullanıcı adı sistem tarafından kullanılıyor; başka bir ad seçin.")
    return u


def check_password(password: str, username: str = "") -> None:
    problems = []
    if len(password) < 8:
        problems.append("en az 8 karakter")
    if not re.search(r"[A-Za-zÇĞİÖŞÜçğıöşü]", password) or not re.search(r"\d", password):
        problems.append("en az bir harf ve bir rakam")
    if problems:
        raise HTTPException(400, "Şifre " + " ve ".join(problems) + " içermelidir.")
    if password.lower() in COMMON or (username and username.lower() in password.lower()):
        raise HTTPException(400, "Bu şifre kolay tahmin edilebilir; kullanıcı adınızı içermeyen daha güçlü bir şifre seçin.")


def _new_recovery_code() -> tuple[str, str]:
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # karışabilecek karakterler (0/O, 1/I) yok
    raw = "".join(secrets.choice(alphabet) for _ in range(16))
    code = "-".join(raw[i:i + 4] for i in range(0, 16, 4))
    return code, hash_password(raw)


def _norm_code(code: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", code.upper())


# ---------- Oturum anahtarı ----------
def create_token(user_id: int, username: str, version: int = 0, guest: bool = False, remember: bool = True) -> str:
    ttl = GUEST_TTL if guest else TOKEN_TTL if remember else SHORT_TTL
    payload = {"sub": str(user_id), "name": username, "ver": version, "guest": guest, "exp": int(time.time()) + ttl}
    return jwt.encode(payload, _secret(), algorithm="HS256")


def _session(row, remember: bool = True, extra: dict | None = None) -> dict:
    with connect() as con:
        con.execute("UPDATE users SET prev_login=last_login, last_login=CURRENT_TIMESTAMP, failed_attempts=0, locked_until=NULL WHERE id=?",
                    (row["id"],))
    guest = bool(row["is_guest"])
    return {"token": create_token(row["id"], row["username"], row["token_version"] or 0, guest, remember),
            "username": row["username"], "guest": guest, "display_name": row["full_name"] or row["username"], **(extra or {})}


def _find(con, identifier: str):
    ident = identifier.strip()
    return con.execute("SELECT * FROM users WHERE parent_id IS NULL AND (lower(username)=lower(?) OR (email IS NOT NULL AND lower(email)=lower(?)))",
                       (ident, ident)).fetchone()


def _check_lock(row) -> None:
    if row and row["locked_until"] and row["locked_until"] > time.time():
        mins = max(1, round((row["locked_until"] - time.time()) / 60))
        raise HTTPException(429, f"Çok fazla hatalı deneme yapıldı. Güvenliğiniz için hesap {mins} dakika kilitlendi.")


def _fail(row) -> None:
    if not row:
        raise HTTPException(401, "Kullanıcı adı veya şifre hatalı.")
    fails = (row["failed_attempts"] or 0) + 1
    with connect() as con:
        if fails >= MAX_FAILS:
            con.execute("UPDATE users SET failed_attempts=0, locked_until=? WHERE id=?", (time.time() + LOCK_SECONDS, row["id"]))
        else:
            con.execute("UPDATE users SET failed_attempts=? WHERE id=?", (fails, row["id"]))
    if fails >= MAX_FAILS:
        raise HTTPException(429, f"Çok fazla hatalı deneme yapıldı. Güvenliğiniz için hesap {LOCK_SECONDS // 60} dakika kilitlendi.")
    left = MAX_FAILS - fails
    raise HTTPException(401, f"Kullanıcı adı veya şifre hatalı. {left} deneme hakkınız kaldı." if left <= 2 else "Kullanıcı adı veya şifre hatalı.")


# ---------- Kayıt / giriş ----------
def username_available(username: str) -> dict:
    try:
        u = check_username(username)
    except HTTPException as e:
        return {"available": False, "reason": e.detail}
    with connect() as con:
        taken = con.execute("SELECT 1 FROM users WHERE lower(username)=lower(?)", (u,)).fetchone()
    return {"available": not taken, "reason": "Bu kullanıcı adı alınmış." if taken else None}


def register(username: str, password: str, full_name: str | None = None, email: str | None = None) -> dict:
    username = check_username(username)
    check_password(password, username)
    email = (email or "").strip() or None
    if email and not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email):
        raise HTTPException(400, "E-posta adresi geçerli görünmüyor.")
    code, code_hash = _new_recovery_code()
    with connect() as con:
        if con.execute("SELECT 1 FROM users WHERE lower(username)=lower(?)", (username,)).fetchone():
            raise HTTPException(409, "Bu kullanıcı adı zaten kayıtlı.")
        if email and con.execute("SELECT 1 FROM users WHERE lower(email)=lower(?)", (email,)).fetchone():
            raise HTTPException(409, "Bu e-posta adresiyle kayıtlı bir hesap var.")
        cur = con.execute("INSERT INTO users (username, password_hash, full_name, email, recovery_hash) VALUES (?,?,?,?,?)",
                          (username, hash_password(password), (full_name or "").strip() or None, email, code_hash))
        row = con.execute("SELECT * FROM users WHERE id=?", (cur.lastrowid,)).fetchone()
    return _session(row, extra={"recovery_code": code})


def login(identifier: str, password: str, remember: bool = True) -> dict:
    with connect() as con:
        row = _find(con, identifier)
    if row and row["is_guest"]:
        row = None
    _check_lock(row)
    if not row or not verify_password(password, row["password_hash"]):
        _fail(row)
    return _session(row, remember)


_guest_times: list[float] = []


def guest() -> dict:
    # Kısa sürede çok sayıda misafir hesabı açılmasını engelle (saatte en fazla 20)
    now = time.time()
    _guest_times[:] = [t for t in _guest_times if now - t < 3600]
    if len(_guest_times) >= 20:
        raise HTTPException(429, "Çok fazla misafir oturumu açıldı. Lütfen biraz sonra tekrar deneyin veya hesap oluşturun.")
    _guest_times.append(now)
    with connect() as con:
        for _ in range(10):
            name = f"misafir-{secrets.randbelow(900000) + 100000}"
            if not con.execute("SELECT 1 FROM users WHERE username=?", (name,)).fetchone():
                break
        cur = con.execute("INSERT INTO users (username, password_hash, full_name, is_guest) VALUES (?,?,?,1)",
                          (name, "!", "Misafir"))
        row = con.execute("SELECT * FROM users WHERE id=?", (cur.lastrowid,)).fetchone()
    return _session(row)


def upgrade_guest(uid: int, username: str, password: str, full_name: str | None, email: str | None) -> dict:
    """Misafir hesabını kalıcı hesaba çevirir; portföy, favoriler ve alarmlar korunur."""
    with connect() as con:
        row = con.execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone()
    if not row or not row["is_guest"]:
        raise HTTPException(400, "Bu hesap zaten kalıcı bir hesap.")
    username = check_username(username)
    check_password(password, username)
    email = (email or "").strip() or None
    code, code_hash = _new_recovery_code()
    with connect() as con:
        if con.execute("SELECT 1 FROM users WHERE lower(username)=lower(?) AND id<>?", (username, uid)).fetchone():
            raise HTTPException(409, "Bu kullanıcı adı zaten kayıtlı.")
        if email and con.execute("SELECT 1 FROM users WHERE lower(email)=lower(?) AND id<>?", (email, uid)).fetchone():
            raise HTTPException(409, "Bu e-posta adresiyle kayıtlı bir hesap var.")
        con.execute("""UPDATE users SET username=?, password_hash=?, full_name=?, email=COALESCE(?, email), recovery_hash=?,
                       is_guest=0, token_version=COALESCE(token_version,0)+1 WHERE id=?""",
                    (username, hash_password(password), (full_name or "").strip() or None, email, code_hash, uid))
        row = con.execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone()
    return _session(row, extra={"recovery_code": code})


def reset_with_code(identifier: str, code: str, new_password: str) -> dict:
    with connect() as con:
        row = _find(con, identifier)
    if row and row["is_guest"]:
        row = None
    _check_lock(row)
    if not row or not row["recovery_hash"] or not verify_password(_norm_code(code), row["recovery_hash"]):
        try:
            _fail(row)
        except HTTPException as e:
            if e.status_code == 401:
                raise HTTPException(401, "Kullanıcı adı veya kurtarma kodu hatalı.")
            raise
    check_password(new_password, row["username"])
    new_code, code_hash = _new_recovery_code()
    with connect() as con:
        con.execute("UPDATE users SET password_hash=?, recovery_hash=?, token_version=COALESCE(token_version,0)+1 WHERE id=?",
                    (hash_password(new_password), code_hash, row["id"]))
        row = con.execute("SELECT * FROM users WHERE id=?", (row["id"],)).fetchone()
    return _session(row, extra={"recovery_code": new_code})


# ---------- Hesap güvenliği (giriş yapmış kullanıcı) ----------
def _require_password(uid: int, password: str):
    with connect() as con:
        row = con.execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone()
    if not row:
        raise HTTPException(401, "Kullanıcı bulunamadı.")
    if row["is_guest"]:
        raise HTTPException(400, "Misafir hesabında şifre yok; önce hesap oluşturun.")
    if not verify_password(password, row["password_hash"]):
        raise HTTPException(400, "Şifre hatalı.")
    return row


def change_password(uid: int, current: str, new: str) -> dict:
    row = _require_password(uid, current)
    check_password(new, row["username"])
    with connect() as con:
        con.execute("UPDATE users SET password_hash=?, token_version=COALESCE(token_version,0)+1 WHERE id=?", (hash_password(new), uid))
        row = con.execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone()
    return _session(row)  # diğer oturumlar kapanır, bu oturum yeni anahtarla devam eder


def regenerate_code(uid: int, password: str) -> dict:
    _require_password(uid, password)
    code, code_hash = _new_recovery_code()
    with connect() as con:
        con.execute("UPDATE users SET recovery_hash=? WHERE id=?", (code_hash, uid))
    return {"recovery_code": code}


def logout_all(uid: int) -> dict:
    with connect() as con:
        con.execute("UPDATE users SET token_version=COALESCE(token_version,0)+1 WHERE id=?", (uid,))
        row = con.execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone()
    return _session(row)


def _delete_user(con, uid: int) -> None:
    for child in [r["id"] for r in con.execute("SELECT id FROM users WHERE parent_id=?", (uid,))]:
        _delete_user(con, child)  # kullanıcının ek portföyleri
    tables = [r["name"] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")]
    for t in tables:
        cols = {c["name"] for c in con.execute(f"PRAGMA table_info({t})")}
        if "user_id" in cols:
            con.execute(f"DELETE FROM {t} WHERE user_id=?", (uid,))
    con.execute("DELETE FROM users WHERE id=?", (uid,))


def delete_account(uid: int, password: str | None) -> dict:
    with connect() as con:
        row = con.execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone()
    if not row:
        raise HTTPException(404, "Hesap bulunamadı.")
    if not row["is_guest"]:
        _require_password(uid, password or "")
    with connect() as con:
        _delete_user(con, uid)
    return {"ok": True}


def cleanup_guests() -> int:
    """GUEST_KEEP_DAYS gündür kullanılmayan misafir hesaplarını ve verilerini siler."""
    with connect() as con:
        old = [r["id"] for r in con.execute(
            "SELECT id FROM users WHERE is_guest=1 AND COALESCE(last_login, created_at) < datetime('now', ?)", (f"-{GUEST_KEEP_DAYS} days",))]
        for uid in old:
            _delete_user(con, uid)
    return len(old)


def me(uid: int) -> dict:
    with connect() as con:
        row = con.execute("SELECT id, username, full_name, email, is_guest, created_at, last_login, recovery_hash IS NOT NULL AS has_recovery "
                          "FROM users WHERE id=?", (uid,)).fetchone()
    if not row:
        raise HTTPException(401, "Kullanıcı bulunamadı.")
    d = dict(row)
    d["is_guest"] = bool(d["is_guest"])
    d["has_recovery"] = bool(d["has_recovery"])
    d["display_name"] = d["full_name"] or d["username"]
    if d["is_guest"]:
        d["guest_days_left"] = GUEST_KEEP_DAYS
    return d


def _verify(creds: HTTPAuthorizationCredentials | None) -> int:
    if creds is None:
        raise HTTPException(401, "Giriş yapmanız gerekiyor.")
    try:
        payload = jwt.decode(creds.credentials, _secret(), algorithms=["HS256"])
    except jwt.PyJWTError:
        raise HTTPException(401, "Oturum süresi doldu, lütfen tekrar giriş yapın.")
    uid = int(payload["sub"])
    with connect() as con:
        row = con.execute("SELECT token_version FROM users WHERE id=?", (uid,)).fetchone()
        if row and payload.get("guest"):  # kullanılan misafir hesabı silinmesin (en fazla saatte bir güncellenir)
            con.execute("UPDATE users SET last_login=CURRENT_TIMESTAMP WHERE id=? AND (last_login IS NULL OR last_login < datetime('now','-1 hour'))", (uid,))
    if not row or (row["token_version"] or 0) != payload.get("ver", 0):
        raise HTTPException(401, "Oturumunuz sonlandırıldı, lütfen tekrar giriş yapın.")
    return uid


def current_person(creds: HTTPAuthorizationCredentials | None = Depends(_bearer)) -> int:
    """Oturum sahibi kişi (favoriler, alarmlar, bildirimler, ayarlar gibi kişiye ait veriler için)."""
    return _verify(creds)


def current_user(creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
                 x_portfolio: str | None = Header(default=None, alias="X-Portfolio")) -> int:
    """Etkin portföyün hesap kimliği. Ek portföyler kişiye bağlı ayrı hesaplar olarak tutulur; arayüz seçili portföyü
    "X-Portfolio" başlığıyla bildirir. Başlık yoksa veya kişiye ait değilse ana portföy kullanılır."""
    uid = _verify(creds)
    if x_portfolio and x_portfolio.isdigit() and int(x_portfolio) != uid:
        with connect() as con:
            if con.execute("SELECT 1 FROM users WHERE id=? AND parent_id=?", (int(x_portfolio), uid)).fetchone():
                return int(x_portfolio)
    return uid


def person_of(uid: int) -> int:
    with connect() as con:
        r = con.execute("SELECT parent_id FROM users WHERE id=?", (uid,)).fetchone()
    return r["parent_id"] if r and r["parent_id"] else uid


def family(uid: int) -> list[int]:
    """Kişi ve tüm portföy hesapları."""
    person = person_of(uid)
    with connect() as con:
        return [person] + [r["id"] for r in con.execute("SELECT id FROM users WHERE parent_id=? ORDER BY id", (person,))]
