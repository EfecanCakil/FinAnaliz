"""Uygulama içi hata kaydı.

Sunucu hataları, arka plan görevlerindeki hatalar ve arayüzde (tarayıcı tarafında) oluşan hatalar
veri klasöründeki logs/trademetrix.log dosyasına yazılır (en fazla 3 x 1 MB, eskiler silinir).
Kayıtlara parola, oturum anahtarı veya istek gövdesi yazılmaz; yalnızca hata türü, yeri ve adres yolu tutulur.
"""
import logging
import sys
import threading
import time
from collections import deque
from logging.handlers import RotatingFileHandler

from .db import DATA_DIR

LOG_DIR = DATA_DIR / "logs"
LOG_FILE = LOG_DIR / "trademetrix.log"
log = logging.getLogger("finanaliz")
_ready = False
_seen: dict[str, float] = {}  # aynı hatayı kısa sürede tekrar tekrar yazmamak için
_client_times: deque = deque(maxlen=60)
_lock = threading.Lock()


def setup() -> None:
    global _ready
    if _ready:
        return
    try:
        LOG_DIR.mkdir(parents=True, exist_ok=True)
        h = RotatingFileHandler(LOG_FILE, maxBytes=1_000_000, backupCount=2, encoding="utf-8")
        h.setFormatter(logging.Formatter("%(asctime)s %(levelname)-7s %(name)s: %(message)s", "%Y-%m-%d %H:%M:%S"))
        log.addHandler(h)
        log.setLevel(logging.INFO)
        log.disabled = False  # uvicorn kendi kayıt ayarlarını yüklerken önceden oluşturulmuş kaydedicileri kapatabiliyor
    except Exception:
        return
    _ready = True

    def hook(args):  # arka plan iş parçacıklarında yakalanmayan hatalar
        log.error("İş parçacığı hatası (%s)", getattr(args.thread, "name", "?"), exc_info=(args.exc_type, args.exc_value, args.exc_traceback))
    threading.excepthook = hook
    prev = sys.excepthook

    def sys_hook(t, v, tb):
        log.critical("Yakalanmayan hata", exc_info=(t, v, tb))
        prev(t, v, tb)
    sys.excepthook = sys_hook
    log.info("TradeMetrix başlatıldı (Python %s)", sys.version.split()[0])


def throttled(key: str, every: float = 3600) -> bool:
    """Aynı anahtarlı kayıt son 'every' saniyede yazıldıysa False döner."""
    now = time.time()
    with _lock:
        if now - _seen.get(key, 0) < every:
            return False
        _seen[key] = now
    return True


def task_error(name: str) -> None:
    """Arka plan görevindeki hatayı (saatte en fazla bir kez) kaydeder; except bloğu içinden çağrılır."""
    if throttled(f"task:{name}"):
        log.exception("Arka plan görevi hata verdi: %s", name)


def client_error(message: str, source: str | None, stack: str | None, path: str | None) -> bool:
    """Arayüzden gelen hata raporu (saatte en fazla 60, aynı hata 10 dakikada bir)."""
    now = time.time()
    with _lock:
        while _client_times and now - _client_times[0] > 3600:
            _client_times.popleft()
        if len(_client_times) >= 60:
            return False
        _client_times.append(now)
    message = (message or "")[:300]
    if not throttled(f"ui:{message}", 600):
        return True
    log.error("Arayüz hatası: %s | sayfa=%s | kaynak=%s\n%s", message, (path or "")[:120], (source or "")[:160], (stack or "")[:1500])
    return True


def tail(lines: int = 300) -> dict:
    try:
        text = LOG_FILE.read_text(encoding="utf-8", errors="replace")
    except FileNotFoundError:
        text = ""
    rows = text.splitlines()
    week_ago = time.strftime("%Y-%m-%d", time.localtime(time.time() - 7 * 86400))
    errors = sum(1 for r in rows if (" ERROR " in r or " CRITICAL" in r) and r[:10] >= week_ago)
    return {"path": str(LOG_FILE), "lines": rows[-lines:], "errors_7d": errors, "size": len(text.encode("utf-8"))}
