"""Telefondan erişim: aynı Wi-Fi ağındaki bir telefonun uygulamayı tarayıcıdan açabilmesi.

Varsayılan olarak kapalıdır. Açıldığında yerel ağ adresinde ikinci bir sunucu başlatılır. Bu sunucuya yalnızca
QR kodundaki tek kullanımlık olmayan ama tahmin edilemez eşleştirme anahtarını bilen cihazlar erişebilir:
anahtar ilk açılışta çereze yazılır ve sonraki her istekte denetlenir. Erişim kapatılınca anahtar geçersiz olur.
Telefonda yine kullanıcı adı ve şifreyle giriş yapılır."""
import hmac
import io
import secrets
import socket
import threading

LAN_PORT = 8770
COOKIE = "tm_pair"
_state = {"server": None, "thread": None, "key": None, "port": LAN_PORT, "error": None}
_lock = threading.Lock()


def lan_ip() -> str | None:
    """Bu bilgisayarın yerel ağ adresi (paket gönderilmez; yalnızca yönlendirme tablosu sorgulanır)."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("10.255.255.255", 1))
        ip = s.getsockname()[0]
        s.close()
        return None if ip.startswith("127.") else ip
    except OSError:
        return None


def is_lan_request(scope: dict) -> bool:
    server = scope.get("server") or (None, None)
    return _state["server"] is not None and server[1] == _state["port"] and server[0] not in ("127.0.0.1", "::1")


def key_ok(value: str | None) -> bool:
    k = _state["key"]
    return bool(k and value and hmac.compare_digest(value, k))


def status() -> dict:
    running = _state["server"] is not None and _state["thread"] is not None and _state["thread"].is_alive()
    ip = lan_ip()
    url = f"http://{ip}:{_state['port']}/?{COOKIE}={_state['key']}" if running and ip else None
    return {"enabled": running, "ip": ip, "port": _state["port"], "url": url, "error": _state["error"],
            "base": f"http://{ip}:{_state['port']}" if ip else None}


def qr_svg(url: str) -> str:
    import segno
    buf = io.BytesIO()
    segno.make(url, error="m").save(buf, kind="svg", scale=6, border=2, dark="#0d1117", light="#ffffff", xmldecl=False, omitsize=True)
    return buf.getvalue().decode()


def start(app) -> dict:
    import uvicorn
    with _lock:
        if _state["server"] is not None:
            return status()
        if not lan_ip():
            _state["error"] = "Bilgisayar bir yerel ağa (Wi-Fi/Ethernet) bağlı görünmüyor."
            return status()
        _state["key"] = secrets.token_urlsafe(18)
        _state["error"] = None
        config = uvicorn.Config(app, host="0.0.0.0", port=_state["port"], log_level="warning", log_config=None)
        server = uvicorn.Server(config)
        server.install_signal_handlers = lambda: None  # ana iş parçacığı dışında çalışır

        def run():
            try:
                server.run()
            except Exception as e:  # noqa: BLE001
                _state["error"] = f"Sunucu başlatılamadı: {e}"
            finally:
                with _lock:
                    if _state["server"] is server:
                        _state["server"] = None
        t = threading.Thread(target=run, name="lan-server", daemon=True)
        _state["server"], _state["thread"] = server, t
        t.start()
    t.join(1.5)  # port kullanımda gibi hızlı hataları yakalamak için kısa bekleme
    return status()


def stop() -> dict:
    with _lock:
        server = _state["server"]
        _state["key"] = None  # eşleşmiş cihazların erişimi hemen kesilir
        _state["error"] = None
    if server is not None:
        server.should_exit = True
        if _state["thread"]:
            _state["thread"].join(5)
    with _lock:
        _state["server"] = None
    return status()
