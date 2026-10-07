"""FinAnaliz masaüstü uygulaması (FinAnaliz.exe giriş noktası).

Yerel FastAPI sunucusunu arka planda başlatır ve arayüzü pywebview ile
yerel bir Windows penceresinde (WebView2) açar. Pencere kapanınca uygulama
tamamen kapanır.
"""
import os
import socket
import sys
import threading
import time
import urllib.request
from pathlib import Path

APP_NAME = "FinAnaliz"

# Konsolsuz exe'de stdout/stderr yoktur; kütüphanelerin yazdığı çıktılar hata vermesin
if sys.stdout is None:
    sys.stdout = open(os.devnull, "w")
if sys.stderr is None:
    sys.stderr = open(os.devnull, "w")

# Paketlenmiş (exe) sürümde kullanıcı verileri %APPDATA%\FinAnaliz altında tutulur
if getattr(sys, "frozen", False):
    os.environ.setdefault("FINANS_DATA_DIR", str(Path(os.environ.get("APPDATA", Path.home())) / APP_NAME))
else:
    sys.path.insert(0, str(Path(__file__).resolve().parent))

import uvicorn  # noqa: E402
import webview  # noqa: E402

from app.db import DATA_DIR  # noqa: E402
from app.main import app  # noqa: E402

HOST = "127.0.0.1"


def pick_port(preferred: int = 8765) -> int:
    # Sabit bir aralık denenir: adres değişmezse tarayıcı deposu (oturum, tercihler) korunur
    for port in (*range(preferred, preferred + 10), 0):
        with socket.socket() as s:
            try:
                s.bind((HOST, port))
                return s.getsockname()[1]
            except OSError:
                continue
    raise RuntimeError("Boş port bulunamadı.")


def wait_ready(url: str, timeout: float = 30) -> bool:
    end = time.time() + timeout
    while time.time() < end:
        try:
            urllib.request.urlopen(url + "/api/markets", timeout=1)
            return True
        except Exception:
            time.sleep(0.2)
    return False


def tray_image():
    from PIL import Image, ImageDraw

    size = 64
    im = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle((2, 2, size - 2, size - 2), radius=12, fill=(13, 17, 23, 255))
    d.polygon([(32, 10), (54, 32), (32, 54), (10, 32)], fill=(76, 141, 255, 255))
    d.line([(18, 40), (27, 31), (34, 36), (47, 22)], fill=(255, 255, 255, 255), width=4)
    return im


def tray_enabled() -> bool:
    from app.assistant import load_settings

    return bool(load_settings().get("tray_on_close", True))


def main():
    preferred = int(os.environ.get("FINANS_PORT", "8765"))
    # Uygulama zaten çalışıyorsa (ör. sistem tepsisinde) yeni kopya açmak yerine mevcut pencereyi göster
    for p in range(preferred, preferred + 10):
        try:
            req = urllib.request.Request(f"http://{HOST}:{p}/api/desktop/show", method="POST")
            if urllib.request.urlopen(req, timeout=1).status == 200:
                return
        except Exception:
            pass

    port = pick_port(preferred)
    url = f"http://{HOST}:{port}"
    state = {"quitting": False, "hidden": False, "window": None, "icon": None}

    @app.post("/api/desktop/show", include_in_schema=False)
    def _show():
        show_window()
        return {"ok": True}

    config = uvicorn.Config(app, host=HOST, port=port, log_level="warning", log_config=None)
    server = uvicorn.Server(config)
    threading.Thread(target=server.run, daemon=True).start()

    if not wait_ready(url):
        webview.create_window(APP_NAME, html="<h3 style='font-family:sans-serif'>Yerel sunucu başlatılamadı.</h3>")
        webview.start()
        return

    # Sürüme özgü adres: eski bir arayüz sayfası önbellekte kalmışsa bile yeni sürüm yüklenir
    from app.main import DIST

    version = int((DIST / "index.html").stat().st_mtime) if (DIST / "index.html").exists() else int(time.time())
    window = webview.create_window(
        f"{APP_NAME} – Yapay Zekâ Destekli Finansal Analiz", f"{url}/?v={version}",
        width=1440, height=900, min_size=(1000, 650), background_color="#0d1117",
    )
    state["window"] = window
    state["widget"] = None

    def open_widget():
        """Her zaman üstte duran küçük favoriler penceresi (açıksa kapatır)."""
        w = state["widget"]
        if w is not None:
            try:
                w.destroy()
            except Exception:
                pass
            state["widget"] = None
            return
        w = webview.create_window(f"{APP_NAME} – Mini", f"{url}/widget?v={version}", width=330, height=460,
                                  on_top=True, resizable=True, min_size=(260, 240), background_color="#0d1117")
        w.events.closed += lambda: state.update(widget=None)
        state["widget"] = w

    app.state.open_widget = open_widget

    def show_window(*_):
        state["hidden"] = False
        window.show()
        window.restore()

    def quit_app(*_):
        state["quitting"] = True
        if state["icon"]:
            state["icon"].stop()
        window.destroy()

    def on_closing():
        # Ayar açıksa pencere kapatılınca uygulama sistem tepsisine küçülür ve alarmları izlemeye devam eder
        if state["quitting"] or state["icon"] is None or not tray_enabled():
            return True
        window.hide()
        if not state["hidden"]:
            state["hidden"] = True
            try:
                state["icon"].notify("FinAnaliz arka planda çalışmaya devam ediyor. Fiyat alarmları izleniyor.", APP_NAME)
            except Exception:
                pass
        return False

    window.events.closing += on_closing

    try:
        import pystray

        icon = pystray.Icon(APP_NAME, tray_image(), f"{APP_NAME} – Finansal Analiz", menu=pystray.Menu(
            pystray.MenuItem("FinAnaliz'i aç", show_window, default=True),
            pystray.MenuItem("Çıkış", quit_app),
        ))
        icon.run_detached()
        state["icon"] = icon
    except Exception:
        state["icon"] = None

    def open_link(link: str | None):
        """Bildirime tıklanınca: pencereyi öne getir, ilgili sayfayı aç."""
        show_window()
        if link:
            import json as _json
            try:
                window.evaluate_js(f"window.dispatchEvent(new CustomEvent('finanaliz:navigate', {{detail: {_json.dumps(link)}}}))")
            except Exception:
                pass

    from desktop_notify import DesktopNotifier

    notifier = DesktopNotifier(tray_image(), DATA_DIR, open_link)
    app.state.desktop_notifier = notifier

    def alert_loop():
        # Alarmlar, emirler ve botlar arka plan motorunda işlenir; uygulama arka plandayken yeni bildirimler
        # "Aç" düğmeli Windows bildirimi olarak gösterilir (Ayarlar > Masaüstü bildirimleri).
        from app import notifications

        last = max([n["id"] for n in notifications.since(None, 0)] or [0])
        while not state["quitting"]:
            time.sleep(5)
            try:
                new = notifications.since(None, last)
            except Exception:
                continue
            if not new:
                continue
            last = new[-1]["id"]
            shown = [n for n in new if notifier.should_show(n["kind"])]
            if len(shown) > 4:  # çok sayıda bildirim aynı anda gelirse tek özet bildirim
                notifier.show(f"{len(shown)} yeni bildirim", " · ".join(n["title"] for n in shown[:4]) + " …", "system", None)
                continue
            for n in shown:
                if not notifier.show(n["title"], n["body"], n["kind"], n.get("link")) and state["icon"]:
                    try:
                        state["icon"].notify(n["body"] or n["title"], n["title"])
                    except Exception:
                        pass

    threading.Thread(target=alert_loop, daemon=True).start()

    # private_mode=False: oturum (giriş) bilgisi uygulama yeniden açıldığında korunur
    webview.start(private_mode=False, storage_path=str(DATA_DIR / "webview"))
    state["quitting"] = True
    if state["icon"]:
        state["icon"].stop()
    server.should_exit = True


if __name__ == "__main__":
    main()
