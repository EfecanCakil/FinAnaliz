"""Windows masaüstü bildirimleri (Eylem Merkezi'ne düşen yerel bildirimler).

Alarmlar, gerçekleşen emirler, bot işlemleri, takaslar, rozetler ve YZ uyarıları; uygulama arka plandayken
(simge durumunda, tepside veya başka bir pencere öndeyken) "Aç" düğmeli Windows bildirimi olarak gösterilir.
Bildirime tıklamak uygulamayı öne getirir ve ilgili sayfayı (ör. hissenin grafiği) açar.
"""
import ctypes
import datetime as dt
import os
import threading
import winreg
from pathlib import Path

from app.assistant import load_settings, save_settings

AUMID = "FinAnaliz.Desktop"
KIND_LABELS = {
    "alert": "Fiyat alarmları ve YZ uyarıları", "order": "Emirler", "bot": "Strateji botları",
    "settlement": "Takaslar", "badge": "Rozetler ve tahmin oyunu", "system": "Raporlar ve sistem", "kap": "KAP bildirimleri",
}
ATTRIBUTION = {"alert": "Alarm", "order": "Emir", "bot": "Strateji botu", "settlement": "Takas", "badge": "Başarı",
               "system": "FinAnaliz", "kap": "KAP"}
BUTTON = {"alert": "Grafiği aç", "order": "Portföyü aç", "bot": "Botları aç", "settlement": "Portföyü aç", "badge": "Karneyi aç"}
DEFAULTS = {"enabled": True, "mode": "background", "kinds": list(KIND_LABELS), "sound": True,
            "quiet": False, "quiet_start": 23, "quiet_end": 8}


def get_settings() -> dict:
    return {**DEFAULTS, **(load_settings().get("desktop_notify") or {})}


def set_settings(data: dict) -> dict:
    cur = get_settings()
    for k, v in data.items():
        if k in DEFAULTS and v is not None:
            cur[k] = v
    save_settings({"desktop_notify": cur})
    return cur


def _register_aumid(icon_path: Path) -> None:
    """Bildirimlerde uygulama adı ve simgesinin görünmesi için kullanıcıya özel uygulama kimliği kaydı (HKCU)."""
    with winreg.CreateKey(winreg.HKEY_CURRENT_USER, rf"Software\Classes\AppUserModelId\{AUMID}") as k:
        winreg.SetValueEx(k, "DisplayName", 0, winreg.REG_SZ, "FinAnaliz")
        winreg.SetValueEx(k, "IconUri", 0, winreg.REG_SZ, str(icon_path))
        winreg.SetValueEx(k, "IconBackgroundColor", 0, winreg.REG_SZ, "FF0D1117")


def app_in_foreground() -> bool:
    """Öndeki pencere bu işleme mi ait? (kullanıcı şu an uygulamaya bakıyor mu)"""
    try:
        user32 = ctypes.windll.user32
        hwnd = user32.GetForegroundWindow()
        pid = ctypes.c_ulong()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
        return pid.value == os.getpid() and not user32.IsIconic(hwnd)
    except Exception:
        return False


def _quiet_now(s: dict) -> bool:
    if not s.get("quiet"):
        return False
    h, a, b = dt.datetime.now().hour, int(s["quiet_start"]), int(s["quiet_end"])
    return (a <= h < b) if a < b else (h >= a or h < b)


class DesktopNotifier:
    def __init__(self, icon_image, data_dir: Path, on_open):
        """on_open(link | None): uygulamayı öne getirip ilgili sayfayı açar."""
        self.on_open = on_open
        self.toaster = None
        self.lock = threading.Lock()
        try:
            from windows_toasts import InteractableWindowsToaster

            icon_path = data_dir / "bildirim-simgesi.png"
            data_dir.mkdir(parents=True, exist_ok=True)
            icon_image.resize((128, 128)).save(icon_path)
            try:
                _register_aumid(icon_path)
                self.toaster = InteractableWindowsToaster("FinAnaliz", AUMID)
            except Exception:
                self.toaster = InteractableWindowsToaster("FinAnaliz")
        except Exception:
            self.toaster = None

    @property
    def available(self) -> bool:
        return self.toaster is not None

    def should_show(self, kind: str, force: bool = False) -> bool:
        s = get_settings()
        if force:
            return True
        if not s["enabled"] or kind not in s["kinds"] or _quiet_now(s):
            return False
        return s["mode"] == "always" or not app_in_foreground()

    def show(self, title: str, body: str = "", kind: str = "system", link: str | None = None) -> bool:
        if not self.toaster:
            return False
        from windows_toasts import AudioSource, Toast, ToastAudio, ToastButton

        s = get_settings()

        def activated(args):
            a = (args.arguments or "")
            if a == "dismiss":
                return
            self.on_open(a[5:] if a.startswith("open:") and len(a) > 5 else link)

        toast = Toast(
            text_fields=[title, body or None],
            attribution_text=ATTRIBUTION.get(kind, "FinAnaliz"),
            group=kind,
            audio=ToastAudio(AudioSource.Default, silent=not s["sound"]),
            on_activated=activated,
            launch_action=f"open:{link or ''}",
            actions=[ToastButton(BUTTON.get(kind, "Aç") if link else "FinAnaliz'i aç", f"open:{link or ''}"),
                     ToastButton("Kapat", "dismiss")],
        )
        try:
            with self.lock:
                self.toaster.show_toast(toast)
            return True
        except Exception:
            return False
