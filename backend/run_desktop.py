"""Masaüstü başlatıcı.

Yerel FastAPI sunucusunu başlatır ve arayüzü Microsoft Edge / Chrome'un
"uygulama modu" (adres çubuğu olmayan ayrı pencere) ile açar. Bu konsol
penceresi kapatıldığında sunucu da durur.
"""
import os
import shutil
import subprocess
import sys
import threading
import time
import urllib.request
import webbrowser
from pathlib import Path

import uvicorn

# --web: sunucu yerel ağdaki/sunucudaki diğer cihazlardan (tarayıcı, telefon) erişilebilir şekilde başlatılır
HOST = "0.0.0.0" if "--web" in sys.argv else "127.0.0.1"
PORT = int(sys.argv[sys.argv.index("--port") + 1]) if "--port" in sys.argv else int(os.environ.get("FINANS_PORT") or os.environ.get("PORT") or "8765")
URL = f"http://{HOST}:{PORT}"


def find_browser() -> str | None:
    candidates = [
        shutil.which("msedge"),
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
        shutil.which("chrome"),
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    ]
    return next((c for c in candidates if c and Path(c).exists()), None)


def wait_ready(timeout=30) -> bool:
    end = time.time() + timeout
    while time.time() < end:
        try:
            urllib.request.urlopen(URL + "/api/markets", timeout=1)
            return True
        except Exception:
            time.sleep(0.3)
    return False


def open_window():
    if not wait_ready():
        print("Sunucu başlatılamadı.")
        return
    browser = find_browser()
    if browser:
        profile = Path(__file__).resolve().parent / "data" / "browser-profile"
        subprocess.Popen([browser, f"--app={URL}", "--window-size=1440,900", f"--user-data-dir={profile}"])
    else:
        webbrowser.open(URL)
    print(f"FinAnaliz çalışıyor: {URL}  (kapatmak için bu pencereyi kapatın veya Ctrl+C)")


if __name__ == "__main__":
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    if "--no-window" not in sys.argv and "--web" not in sys.argv:
        threading.Thread(target=open_window, daemon=True).start()
    uvicorn.run("app.main:app", host=HOST, port=PORT, log_level="warning")
