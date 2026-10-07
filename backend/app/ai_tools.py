"""Yapay zekâ araçları: grafik yorumlayıcı, haftalık kişisel rapor, akıllı uyarılar ve doğal dille tarama.

LLM anahtarı tanımlıysa metinleri Claude yazar; yoksa aynı verilerden kural tabanlı Türkçe metin üretilir.
"""
import json
import re

import pandas as pd
from datetime import date, datetime, timedelta

from . import assistant, econ, engine, indicators, insights, market, news, notifications, patterns, screener
from .db import connect, rows


def _llm(prompt: str, data: dict, max_tokens: int = 1200) -> str | None:
    key = assistant.api_key()
    if not key:
        return None
    try:
        import anthropic
        resp = anthropic.Anthropic(api_key=key).messages.create(
            model=assistant.load_settings().get("model") or assistant.DEFAULT_MODEL, max_tokens=max_tokens,
            system=assistant.SYSTEM_PROMPT,
            messages=[{"role": "user", "content": prompt + "\n\nVeri (JSON):\n" + json.dumps(data, ensure_ascii=False, default=float)}])
        return "".join(b.text for b in resp.content if getattr(b, "type", "") == "text")
    except Exception:
        return None


def _f(v, d=2):
    return f"{v:,.{d}f}".replace(",", "X").replace(".", ",").replace("X", ".")


# ----------------------------------------------------------------------------- Grafik yorumlayıcı
def chart_insight(symbol: str) -> dict:
    symbol = symbol.upper()
    candles = market.history(symbol, "1y", "1d")
    df = market.to_frame(candles)
    summ = indicators.summary(df)
    pats = patterns.candle_patterns(df, 40)[-5:]
    levels = patterns.support_resistance(df)
    mtf = patterns.multi_timeframe(symbol)
    c = df["close"]
    vol = df["volume"]
    data = {
        "sembol": symbol, "ad": market.NAME_BY_SYMBOL.get(symbol, symbol), "son_fiyat": float(c.iloc[-1]),
        "degisim": {"1g": summ["stats"]["change_1d"], "1a": summ["stats"]["change_1m"], "1y": summ["stats"]["change_period"]},
        "52h_aralik": [summ["stats"]["low"], summ["stats"]["high"]], "oynaklik": summ["stats"]["volatility"],
        "gostergeler": summ["signals"], "genel": summ["overall"], "formasyonlar": pats, "seviyeler": levels,
        "zaman_dilimleri": [{k: v for k, v in m.items() if k in ("timeframe", "overall", "rsi", "trend")} for m in mtf],
        "hacim_orani": float(vol.iloc[-1] / vol.tail(21).iloc[:-1].mean()) if vol.tail(21).iloc[:-1].mean() > 0 else None,
        "son_30_kapanis": [round(float(x), 4) for x in c.tail(30)],
    }
    text = _llm("Aşağıdaki teknik verilerle bu varlığın grafiğini bir analist gibi yorumla. Başlıklar: ### Trend, ### Önemli seviyeler, "
                "### Göstergeler ve formasyonlar, ### Dikkat edilmesi gerekenler. Kısa ve net yaz (200-300 kelime), veri dışına çıkma, "
                "al/sat tavsiyesi verme.", data)
    if text:
        return {"text": text, "source": "llm", "data": data}

    # Kural tabanlı yorum
    st, lines = summ["stats"], [f"## {data['ad']} ({symbol}) grafik yorumu", ""]
    sma = {s["name"]: s for s in summ["signals"]}
    trend_words = []
    for n in ("SMA 20", "SMA 50", "SMA 200"):
        if n in sma:
            trend_words.append(f"{n} {'üzerinde' if sma[n]['signal'] == 'al' else 'altında'}")
    lines += ["### Trend",
              f"Fiyat son bir yılda %{_f(st['change_period'])}, son bir ayda %{_f(st['change_1m'] or 0)} değişti. Fiyat " + ", ".join(trend_words) + ". "
              + {"Güçlü Al": "Göstergelerin büyük çoğunluğu yükseliş yönünde.", "Al": "Görünüm hafif yükseliş eğiliminde.",
                 "Nötr": "Belirgin bir yön yok; yatay seyir öne çıkıyor.", "Sat": "Görünüm hafif düşüş eğiliminde.",
                 "Güçlü Sat": "Göstergelerin büyük çoğunluğu düşüş yönünde."}[summ["overall"]], ""]
    sup = [l for l in levels if l["type"] == "destek"][:2]
    res = [l for l in levels if l["type"] == "direnç"][:2]
    lines += ["### Önemli seviyeler"]
    if sup:
        lines.append("- Yakın destekler: " + ", ".join(f"{_f(l['price'], 4)} (%{_f(l['distance_pct'])})" for l in sup))
    if res:
        lines.append("- Yakın dirençler: " + ", ".join(f"{_f(l['price'], 4)} (%+{_f(l['distance_pct'])})" for l in res))
    lines.append(f"- 52 haftalık aralık: {_f(st['low'], 4)} – {_f(st['high'], 4)}")
    lines += ["", "### Göstergeler ve formasyonlar"]
    for s in summ["signals"]:
        if s["name"].startswith(("RSI", "MACD", "Bollinger")):
            lines.append(f"- {s['name']}: {s['note']}")
    if pats:
        p = pats[-1]
        lines.append(f"- Son mum formasyonu: **{p['name']}** ({p['direction']}) – {p['description']}")
    if data["hacim_orani"] and data["hacim_orani"] > 1.8:
        lines.append(f"- Hacim, 20 günlük ortalamanın {_f(data['hacim_orani'], 1)} katı; hareketin arkasında güçlü ilgi var.")
    agree = {m["overall"] for m in mtf if "overall" in m}
    lines += ["", "### Dikkat edilmesi gerekenler",
              f"- Zaman dilimleri {'aynı yönü gösteriyor' if len(agree) == 1 else 'farklı sinyaller veriyor (' + ', '.join(f'{m['timeframe']}: {m.get('overall')}' for m in mtf if 'overall' in m) + ')'}.",
              f"- Yıllık oynaklık %{_f(st['volatility'] or 0, 1)}; " + ("yüksek risk, geniş fiyat hareketleri beklenebilir." if (st['volatility'] or 0) > 40 else "orta/düşük risk düzeyi."),
              "", "_Bu yorum göstergelerden otomatik üretilmiştir; yatırım tavsiyesi değildir._"]
    return {"text": "\n".join(lines), "source": "kural tabanlı", "data": data}


# ----------------------------------------------------------------------------- Haftalık kişisel rapor
def weekly_report(uid: int) -> dict:
    today = date.today()
    start = today - timedelta(days=7)
    with connect() as con:
        txs = rows(con.execute("SELECT * FROM transactions WHERE user_id=? AND date>=? ORDER BY date", (uid, start.isoformat())))
        snaps = rows(con.execute("SELECT day, equity FROM equity_snapshots WHERE user_id=? AND day>=? ORDER BY day", (uid, (start - timedelta(days=3)).isoformat())))
        notes = rows(con.execute("SELECT kind, title FROM notifications WHERE user_id=? AND created_at>=? ORDER BY id DESC",
                                 (uid, start.isoformat())))
    value, items = engine.holdings_value_try(uid)
    qs = {q["symbol"]: q for q in market.quotes([i["symbol"] for i in items])} if items else {}
    holdings = sorted([{"sembol": i["symbol"], "haftalik_%": qs.get(i["symbol"], {}).get("change_1w"), "deger_tl": i["value_try"]} for i in items],
                      key=lambda x: -(x["haftalik_%"] or -999))
    eq_change = (snaps[-1]["equity"] / snaps[0]["equity"] - 1) * 100 if len(snaps) >= 2 and snaps[0]["equity"] else None
    try:
        cal = [{"zaman": datetime.fromtimestamp(e["time"]).strftime("%d.%m %H:%M"), "ulke": e["country_name"], "etkinlik": e["title"]}
               for e in econ.week_events()["events"] if e["impact"] == "High" and e["time"] > datetime.now().timestamp()][:5]
    except Exception:
        cal = []
    data = {"donem": f"{start:%d.%m} – {today:%d.%m.%Y}", "islem_sayisi": len(txs),
            "islemler": [{"tarih": t["date"], "sembol": t["symbol"], "islem": "alış" if t["side"] == "buy" else "satış", "adet": t["quantity"]} for t in txs][:15],
            "hesap_degeri_degisimi_%": eq_change, "yatirim_degeri_tl": value, "varliklar": holdings,
            "alarmlar": [n["title"] for n in notes if n["kind"] == "alert"][:8], "emir_bot": [n["title"] for n in notes if n["kind"] in ("order", "bot")][:8],
            "takvim": cal}
    source = "llm"
    text = _llm("Bu verilerle kullanıcıya hitap eden kısa bir 'Haftalık Kişisel Rapor' yaz. ## başlık ve ### alt başlıklar kullan "
                "(Haftanın özeti, Varlıklarınız, İşlemler ve alarmlar, Gelecek hafta). 200-300 kelime, tavsiye verme.", data)
    if not text:
        source = "şablon"
        L = [f"## Haftalık Kişisel Rapor ({data['donem']})", "", "### Haftanın özeti"]
        L.append(f"Bu hafta {len(txs)} işlem yaptınız." + (f" Hesap değeriniz %{_f(eq_change)} değişti." if eq_change is not None else "")
                 + f" Yatırımlarınızın güncel değeri {_f(value)} TL.")
        if holdings:
            L += ["", "### Varlıklarınız"]
            for h in holdings[:6]:
                L.append(f"- {h['sembol'].replace('.IS', '')}: haftalık " + (f"%{_f(h['haftalik_%'])}" if h['haftalik_%'] is not None else "—"))
        if data["alarmlar"] or data["emir_bot"] or txs:
            L += ["", "### İşlemler ve alarmlar"]
            L += [f"- {t['tarih']} {t['sembol']} {t['islem']} ({t['adet']:g} adet)" for t in data["islemler"][:6]]
            L += [f"- {a}" for a in (data["alarmlar"] + data["emir_bot"])[:6]]
        if cal:
            L += ["", "### Gelecek hafta"] + [f"- {c['zaman']} · {c['ulke']}: {c['etkinlik']}" for c in cal]
        L += ["", "_Rapor otomatik üretilmiştir; yatırım tavsiyesi değildir._"]
        text = "\n".join(L)
    return {"text": text, "source": source, "data": data,
            "created_at": datetime.now().isoformat(timespec="minutes")}


# ----------------------------------------------------------------------------- Akıllı uyarılar
def smart_alerts() -> None:
    """Portföy ve favorilerdeki varlıklar için günde en fazla bir kez: olağandışı hacim, sert hareket, olumsuz haber yoğunluğu."""
    today = date.today().isoformat()
    with connect() as con:
        users = [r["id"] for r in con.execute("SELECT id FROM users")]
    for uid in users:
        with connect() as con:
            syms = {r["symbol"] for r in con.execute("SELECT symbol FROM watchlist WHERE user_id=?", (uid,))}
            held = {r["symbol"] for r in con.execute(
                "SELECT symbol FROM transactions WHERE user_id=? GROUP BY symbol HAVING SUM(CASE WHEN side='buy' THEN quantity ELSE -quantity END) > 0", (uid,))}
            sent = {(r["symbol"], r["kind"]) for r in con.execute("SELECT symbol, kind FROM smart_alert_log WHERE user_id=? AND day=?", (uid, today))}
        syms = sorted(syms | held)
        if not syms:
            continue
        frames = market.daily_frames(syms)
        for s in syms:
            try:
                row = screener._row(s, frames.get(s))
            except Exception:
                row = None
            if not row:
                continue
            found = []
            if (row.get("vol_ratio") or 0) >= 2.5:
                found.append(("volume", f"Olağandışı hacim: {s.replace('.IS', '')}", f"Hacim 20 günlük ortalamanın {row['vol_ratio']:.1f} katı; fiyat %{row['change_pct']:+.2f}."))
            if abs(row.get("change_pct") or 0) >= 5:
                found.append(("move", f"Sert hareket: {s.replace('.IS', '')} %{row['change_pct']:+.2f}",
                              f"{'Portföyünüzdeki' if s in held else 'Favorinizdeki'} varlık bugün güçlü hareket ediyor."))
            for kind, title, body in found:
                if (s, kind) in sent:
                    continue
                notifications.add(uid, "alert", "🧠 " + title, body, f"/analiz?s={s}")
                with connect() as con:
                    con.execute("INSERT OR IGNORE INTO smart_alert_log VALUES (?,?,?,?)", (uid, s, kind, today))
        # Olumsuz haber yoğunluğu (yalnızca portföydeki varlıklar, maliyetli olduğu için en fazla 5)
        for s in sorted(held)[:5]:
            if (s, "news") in sent:
                continue
            try:
                n = news.get_news(s, 15)
                sm = n.get("summary")
                if sm and sm["count"] >= 5 and sm["negative"] >= max(3, sm["positive"] * 2):
                    notifications.add(uid, "alert", f"🧠 Olumsuz haber yoğunluğu: {s.replace('.IS', '')}",
                                      f"Son haberlerin {sm['negative']}/{sm['count']} tanesi olumsuz.", f"/haberler?s={s}")
                    with connect() as con:
                        con.execute("INSERT OR IGNORE INTO smart_alert_log VALUES (?,?,?,?)", (uid, s, "news", today))
            except Exception:
                pass


# ----------------------------------------------------------------------------- Doğal dille tarama
SECTOR_WORDS = {"banka": "Bankacılık", "holding": "Holding", "havacılık": "Ulaştırma", "ulaştırma": "Ulaştırma", "enerji": "Enerji",
                "kimya": "Kimya", "otomotiv": "Otomotiv", "perakende": "Perakende & Gıda", "gıda": "Perakende & Gıda", "telekom": "Telekom",
                "teknoloji": "Teknoloji", "savunma": "Savunma & Teknoloji", "maden": "Metal & Madencilik", "demir": "Metal & Madencilik",
                "inşaat": "İnşaat & GYO", "gyo": "İnşaat & GYO", "sağlık": "Sağlık", "finans": "Finans"}


def _norm(x: str) -> str:
    """Türkçe büyük/küçük harf ve ı/i farkını ortadan kaldırır (ör. "BIST", "Banka", "altında" → karşılaştırılabilir)."""
    return x.replace("İ", "i").lower().replace("ı", "i").replace("ğ", "g").replace("ü", "u").replace("ş", "s").replace("ö", "o").replace("ç", "c")


def _has(t: str, *words: str) -> bool:
    return any(_norm(w) in t for w in words)


def _rule_parse(q: str) -> dict:
    t = _norm(q)
    f: dict = {"markets": [], "conditions": [], "sector": None, "dividend": False, "sort": None}
    if _has(t, "bist", "borsa istanbul", "türk", "turk"): f["markets"].append("bist")
    if _has(t, "abd", "amerika", "nasdaq", "s&p", "sp500"): f["markets"].append("us")
    if _has(t, "kripto", "coin"): f["markets"].append("crypto")
    if _has(t, "döviz", "emtia"): f["markets"].append("fx")
    for w, sec in SECTOR_WORDS.items():
        if _norm(w) in t:
            f["sector"] = sec
            if sec in ("Bankacılık", "Holding", "Ulaştırma", "Kimya", "Otomotiv", "Telekom", "Metal & Madencilik", "İnşaat & GYO",
                       "Savunma & Teknoloji", "Perakende & Gıda") and not f["markets"]:
                f["markets"].append("bist")
    m = re.search(r"rsi\D{0,15}?(\d+(?:[.,]\d+)?)\D{0,15}?(alt|kucuk|<|ust|uzer|buyuk|>)", t)
    if m:
        f["conditions"].append({"field": "rsi", "op": "<" if m.group(2) in ("alt", "kucuk", "<") else ">", "value": float(m.group(1).replace(",", "."))})
    elif _has(t, "aşırı satım"):
        f["conditions"].append({"field": "rsi", "op": "<", "value": 30})
    elif _has(t, "aşırı alım"):
        f["conditions"].append({"field": "rsi", "op": ">", "value": 70})
    if _has(t, "temettü"): f["dividend"] = True
    if _has(t, "yükseliş trend", "yükselen trend", "yükselişteki", "yükseliş trendindeki"): f["conditions"].append({"field": "trend", "op": "=", "value": "Yükseliş"})
    if _has(t, "düşüş trend", "düşüşteki"): f["conditions"].append({"field": "trend", "op": "=", "value": "Düşüş"})
    if _has(t, "zirve"): f["conditions"].append({"field": "dist_high_52w", "op": ">", "value": -3})
    if _has(t, "dibe yakın", "dipte", "dip seviye"): f["conditions"].append({"field": "dist_low_52w", "op": "<", "value": 5})
    if _has(t, "hacim", "hacmi"): f["conditions"].append({"field": "vol_ratio", "op": ">", "value": 1.8})
    if _has(t, "altın kesişim"): f["conditions"].append({"field": "golden_cross", "op": "=", "value": True})
    if _has(t, "ölüm kesişim"): f["conditions"].append({"field": "death_cross", "op": "=", "value": True})
    if _has(t, "macd") and _has(t, "al sinyal", "yukarı"): f["conditions"].append({"field": "macd_cross_up", "op": "=", "value": True})
    if _has(t, "en çok yükselen", "kazandıran"): f["sort"] = "change_1m"
    if _has(t, "en çok düşen", "kaybettiren"): f["sort"] = "-change_1m"
    if not f["markets"]:
        f["markets"] = ["bist", "us"]
    return f


def nl_screen(query: str) -> dict:
    parsed = None
    raw = _llm("Kullanıcının hisse tarama isteğini aşağıdaki JSON şemasına çevir ve YALNIZCA JSON döndür: "
               '{"markets":["bist"|"us"|"crypto"|"fx"], "sector": null|"Bankacılık"|..., "dividend": bool, '
               '"conditions":[{"field":"rsi|change_pct|change_1w|change_1m|dist_sma50|dist_sma200|vol_ratio|dist_high_52w|dist_low_52w|volatility|trend|golden_cross|death_cross|macd_cross_up|macd_cross_down",'
               '"op":"<|>|=","value":sayı|metin|bool}], "sort": null|"alan"|"-alan"}. Sektör adları: ' + ", ".join(sorted(set(SECTOR_WORDS.values()))),
               {"istek": query}, 500)
    if raw:
        try:
            parsed = json.loads(raw[raw.index("{"): raw.rindex("}") + 1])
        except Exception:
            parsed = None
    method = "llm" if parsed else "kural tabanlı"
    parsed = parsed or _rule_parse(query)
    rows_ = screener.scan([m for m in parsed.get("markets") or ["bist", "us"] if m in market.CATALOG], "all")
    def ok(r):
        if parsed.get("sector") and r.get("sector") != parsed["sector"]:
            return False
        for c in parsed.get("conditions") or []:
            v = r.get(c["field"])
            if v is None:
                return False
            if c["op"] == "<" and not v < c["value"]: return False
            if c["op"] == ">" and not v > c["value"]: return False
            if c["op"] == "=" and v != c["value"]: return False
        return True
    res = [r for r in rows_ if ok(r)]
    if parsed.get("dividend"):
        from concurrent.futures import ThreadPoolExecutor
        from .fundamentals import dividends_series
        cutoff = pd.Timestamp.now() - pd.Timedelta(days=365)
        # Önce teknik koşullara göre sırala, temettü kontrolünü en fazla 80 adayla sınırla (hız)
        res = [r for r in res if r["market"] in ("bist", "us")]
        res.sort(key=lambda r: (not r.get("featured"), -(r.get("score") or 0)))
        res = res[:80]
        with ThreadPoolExecutor(max_workers=8) as ex:
            ttm = list(ex.map(lambda r: float(dividends_series(r["symbol"]).loc[lambda x: x.index > cutoff].sum()), res))
        keep = []
        for r, d in zip(res, ttm):
            if d > 0:
                r["ttm_dividend_yield"] = d / r["price"] * 100
                keep.append(r)
        res = keep
    srt = parsed.get("sort")
    if srt:
        key = srt.lstrip("-")
        res.sort(key=lambda r: (r.get(key) is None, -(r.get(key) or 0) if not srt.startswith("-") else (r.get(key) or 0)))
    return {"query": query, "parsed": parsed, "method": method, "results": res[:60], "scanned": len(rows_)}
