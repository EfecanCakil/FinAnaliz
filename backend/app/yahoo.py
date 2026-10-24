"""Yahoo Finance erişim koruması.

Yahoo, kısa sürede çok fazla istek gelince bir süre boş/hatalı yanıt vermeye başlar ("rate limit"). Bu modül:
- Eşzamanlı istek sayısını sınırlar (aynı anda en fazla MAX_PARALLEL istek),
- Kısıtlama belirtilerini (429 hatası, toplu isteğin tamamen boş dönmesi, art arda hatalar) izler,
- Kısıtlama algılanınca bir süre (30 sn'den başlayıp 10 dk'ya kadar artan) yeni istek göndermez; bu sürede
  uygulama önbellekteki son verilerle çalışır ve kısıtlama gereksiz yere uzamaz,
- Arayüzdeki "veri kaynağı yoğun" bandı için durum bilgisi verir.
"""
import threading
import time
from contextlib import contextmanager

MAX_PARALLEL = 3
MIN_BACKOFF, MAX_BACKOFF = 30, 600

_sem = threading.BoundedSemaphore(MAX_PARALLEL)
_lock = threading.Lock()
_st = {"streak": 0, "backoff": 0, "until": 0.0, "last_ok": None, "limited_since": None, "last_error": None}


class YahooBusy(Exception):
    """Kısıtlama süresi dolmadan Yahoo'ya istek gönderilmez."""


def available() -> bool:
    return time.time() >= _st["until"]


def _is_rate_limit(exc: BaseException | None) -> bool:
    if exc is None:
        return False
    name = type(exc).__name__
    text = str(exc)
    return "RateLimit" in name or "Too Many Requests" in text or "429" in text or "Rate limited" in text


def ok() -> None:
    with _lock:
        _st.update(streak=0, backoff=0, until=0.0, last_ok=time.time(), limited_since=None, last_error=None)


def fail(exc: BaseException | None = None, strong: bool = False) -> None:
    """Başarısız istek. strong=True: kısıtlama olduğu neredeyse kesin (429 veya toplu isteğin tamamen boş dönmesi)."""
    with _lock:
        _st["streak"] += 1
        _st["last_error"] = str(exc)[:200] if exc else "boş yanıt"
        if strong or _is_rate_limit(exc) or _st["streak"] >= 6:
            _st["backoff"] = min(MAX_BACKOFF, max(MIN_BACKOFF, _st["backoff"] * 2))
            _st["until"] = time.time() + _st["backoff"]
            _st["limited_since"] = _st["limited_since"] or time.time()
            _st["streak"] = 0


@contextmanager
def slot():
    """Yahoo'ya yapılacak her isteği sarar: kısıtlama varsa YahooBusy, yoksa sıraya girip isteği yapar."""
    if not available():
        raise YahooBusy()
    with _sem:
        yield


def status() -> dict:
    now = time.time()
    limited = now < _st["until"]
    return {"ok": not limited and _st["streak"] < 3, "limited": limited,
            "retry_in": max(0, int(_st["until"] - now)) if limited else 0,
            "limited_since": _st["limited_since"], "last_ok": _st["last_ok"], "last_error": _st["last_error"]}
