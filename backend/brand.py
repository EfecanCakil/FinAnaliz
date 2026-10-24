"""TradeMetrix marka bilgisi ve logonun bitmap çizimi (exe simgesi, sistem tepsisi, Windows bildirimleri).

Logo arayüzdeki SVG ile aynıdır (frontend/src/components/Logo.tsx): lacivert zemin, büyüyen metrik çubukları,
"M" biçiminde yükselen turkuaz→yeşil fiyat çizgisi, ok ucu ve iki veri noktası.
"""
from pathlib import Path

APP_NAME = "TradeMetrix"
APP_TAGLINE = "Yapay zekâ destekli piyasa analizi"
LEGACY_DATA_NAME = "FinAnaliz"  # eski sürümün veri klasörü adı; kullanıcı verisi kaybolmasın diye korunur
ICON_PATH = Path(__file__).resolve().parent / "trademetrix.ico"

_LINE = [(11, 46), (21, 23), (32, 37), (43, 20), (50, 14)]


def _lerp(a, b, t):
    return tuple(round(x + (y - x) * t) for x, y in zip(a, b))


def logo_image(size: int = 256, bars: bool = True):
    """Logoyu `size` piksel kare RGBA görüntü olarak çizer (4 kat büyük çizilip küçültülür; kenarlar yumuşak olur)."""
    from PIL import Image, ImageDraw

    k = size * 4 / 64
    big = Image.new("RGBA", (size * 4, size * 4), (0, 0, 0, 0))
    # zemin: köşegen yönde hafif koyulaşan lacivert
    bg = Image.new("RGBA", big.size)
    gd = ImageDraw.Draw(bg)
    top, bottom = (16, 38, 74), (10, 21, 40)
    for y in range(big.size[1]):
        gd.line([(0, y), (big.size[0], y)], fill=_lerp(top, bottom, y / big.size[1]) + (255,))
    mask = Image.new("L", big.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, big.size[0] - 1, big.size[1] - 1), radius=round(15 * k), fill=255)
    big.paste(bg, (0, 0), mask)
    d = ImageDraw.Draw(big)
    if bars and size >= 32:  # küçük simgelerde çubuklar seçilemez; sade kalsın
        for x, y, h in ((13, 40, 13), (28, 31, 22), (43, 23, 30)):
            d.rounded_rectangle((x * k, y * k, (x + 8) * k, (y + h) * k), radius=round(2 * k), fill=(31, 59, 99, 255))
    w = 5 if size >= 48 else 7  # küçük boyutta çizgi kalın olsun
    c1, c2 = (34, 211, 238), (74, 222, 128)
    for i in range(len(_LINE) - 1):
        a, b = _LINE[i], _LINE[i + 1]
        col = _lerp(c1, c2, (i + 0.5) / (len(_LINE) - 1)) + (255,)
        d.line([(a[0] * k, a[1] * k), (b[0] * k, b[1] * k)], fill=col, width=round(w * k))
        r = w * k / 2
        for p in (a, b):  # yuvarlak birleşimler
            d.ellipse((p[0] * k - r, p[1] * k - r, p[0] * k + r, p[1] * k + r), fill=col)
    d.polygon([(47 * k, 9 * k), (56 * k, 8 * k), (55 * k, 17 * k)], fill=c2 + (255,))
    if size >= 32:
        for cx, cy in ((21, 23), (43, 20)):
            r = 2.8 * k
            d.ellipse((cx * k - r, cy * k - r, cx * k + r, cy * k + r), fill=(255, 255, 255, 255))
    return big.resize((size, size), Image.LANCZOS)


def write_icon(path: Path = ICON_PATH) -> Path:
    """Windows .ico dosyası (16–256 px, her boyut kendi çiziminden)."""
    sizes = [16, 24, 32, 48, 64, 128, 256]
    imgs = [logo_image(s) for s in sizes]
    imgs[-1].save(path, format="ICO", sizes=[(s, s) for s in sizes], append_images=imgs[:-1])
    return path


if __name__ == "__main__":
    print(write_icon())
    logo_image(512).save(Path(__file__).resolve().parent / "trademetrix_logo.png")
