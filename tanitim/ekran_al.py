"""Tanıtımdaki "Uygulamadan ekranlar" bölümü için ekran görüntülerini (ekran/*.jpg) yeniden alır.

Önce uygulamanın yerel sunucusu çalıştırılmalıdır (ör. python backend/run_desktop.py --no-window --port 8766).
Edge'i görünmez (headless) modda açar, kaynak koddaki test hesabı (demo) ile oturum açmış gibi
sayfaları gezer ve ekran görüntüsü alır. Kullanım: python ekran_al.py http://127.0.0.1:8766 [sayfa-adı ...]
"""
import base64
import io
import json
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

from PIL import Image
from websockets.sync.client import connect

BASE = sys.argv[1]  # ör. http://127.0.0.1:8766
OUT = Path(r"C:\Projeler\FinAnaliz\tanitim\ekran")
OUT.mkdir(exist_ok=True)
sys.path.insert(0, r"C:\Projeler\FinAnaliz\backend")
from app import auth  # noqa: E402
from app.db import connect as dbc  # noqa: E402

with dbc() as con:
    u = con.execute("SELECT id, username, token_version, full_name FROM users WHERE username='demo'").fetchone()
token = auth.create_token(u["id"], u["username"], u["token_version"] or 0)
user = json.dumps({"username": u["username"], "guest": False, "display_name": u["full_name"] or u["username"]})

PAGES = [
    ("01-piyasa-ozeti", "/", 9),
    ("02-teknik-analiz", "/analiz?s=THYAO.IS", 25),
    ("03-yz-tahmin", "/tahmin?s=THYAO.IS", 60),
    ("04-portfoy", "/portfoy", 10),
    ("05-strateji-testi", "/backtest?s=THYAO.IS", 15),
    ("06-tarama", "/tarama", 14),
    ("07-borsa-istanbul", "/piyasa/bist", 10),
    ("08-kap", "/kap", 10),
    ("09-halka-arz", "/halka-arz", 10),
    ("10-haberler", "/haberler", 10),
]
if len(sys.argv) > 2:
    PAGES = [p for p in PAGES if p[0] in sys.argv[2:]]

HIDE = ("(() => { const s = document.createElement('style'); s.textContent = "
        "'.qs-backdrop:has(.tour), .guest-banner, .page-tip { display: none !important }'; document.head.appendChild(s) })()")
CLICK = {"03-yz-tahmin": "Modelleri Eğit", "05-strateji-testi": "Testi Çalıştır"}

prof = tempfile.mkdtemp(prefix="tm-edge-")
edge = subprocess.Popen([r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe", "--headless=new",
                         "--remote-debugging-port=9333", f"--user-data-dir={prof}", "--window-size=1440,900",
                         "--no-first-run", "--disable-extensions", "about:blank"])
try:
    for _ in range(50):
        try:
            tabs = json.load(urllib.request.urlopen("http://127.0.0.1:9333/json"))
            page = next(t for t in tabs if t["type"] == "page")
            break
        except Exception:
            time.sleep(0.2)
    ws = connect(page["webSocketDebuggerUrl"], max_size=None).__enter__()
    n = [0]

    def cdp(method, **params):
        n[0] += 1
        ws.send(json.dumps({"id": n[0], "method": method, "params": params}))
        while True:
            msg = json.loads(ws.recv())
            if msg.get("id") == n[0]:
                return msg.get("result", {})

    cdp("Emulation.setDeviceMetricsOverride", width=1440, height=900, deviceScaleFactor=1, mobile=False)
    cdp("Page.navigate", url=BASE + "/")
    time.sleep(2)
    cdp("Runtime.evaluate", expression=f"localStorage.setItem('finanaliz_token', {json.dumps(token)});"
                                       f"localStorage.setItem('finanaliz_user', {json.dumps(user)});"
                                       "localStorage.setItem('finanaliz_theme', 'dark');")
    for name, path, wait in PAGES:
        cdp("Page.navigate", url=BASE + path)
        time.sleep(3)
        cdp("Runtime.evaluate", expression=HIDE)
        if name in CLICK:
            cdp("Runtime.evaluate", expression="[...document.querySelectorAll('button')].find(b => b.textContent.includes("
                                               + json.dumps(CLICK[name]) + "))?.click()")
        time.sleep(wait)
        cdp("Runtime.evaluate", expression="window.scrollTo(0,0); document.querySelector('.content')?.scrollTo(0,0)")
        data = base64.b64decode(cdp("Page.captureScreenshot", format="png")["data"])
        Image.open(io.BytesIO(data)).convert("RGB").save(OUT / f"{name}.jpg", quality=82, optimize=True)
        print(name, "ok", flush=True)
finally:
    edge.kill()
