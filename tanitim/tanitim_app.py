"""TradeMetrix tanıtım uygulaması (TradeMetrix_Tanitim.exe giriş noktası).

Projenin arka planda nasıl çalıştığını anlatan etkileşimli sunumu (tanitim.html)
pywebview ile yerel bir Windows penceresinde açar. İnternet veya sunucu gerektirmez.
"""
import sys
from pathlib import Path

import webview

BASE = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))


class Api:
    def toggle_fullscreen(self):
        webview.windows[0].toggle_fullscreen()


def main():
    webview.create_window("TradeMetrix – Nasıl Çalışır?", str(BASE / "tanitim.html"), js_api=Api(),
                          width=1366, height=820, min_size=(1000, 640), background_color="#0b1220")
    webview.start()


if __name__ == "__main__":
    main()
