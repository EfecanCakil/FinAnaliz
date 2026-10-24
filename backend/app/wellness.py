"""Portföy sağlığı: hedef fiyat / zarar sınırı koruması, 100 üzerinden sağlık skoru ve temettü takvimi."""
import threading
import time
from datetime import date, datetime, timedelta

import pandas as pd
import yfinance as yf
from fastapi import HTTPException

from . import account, market, orders, portfolio, universe, yahoo
from .db import connect, rows

PROTECT_NOTE = "Koruma"  # bu özellikle kurulan emir/alarmları ayırt etmek için


# ----------------------------------------------------------------------------- hedef fiyat / zarar sınırı
def protection(uid: int, symbol: str) -> dict:
    """Bir pozisyon için mevcut hedef (kâr al) ve zarar sınırı (zarar durdur) — emir veya alarm olarak."""
    sym = symbol.upper()
    with connect() as con:
        ords = rows(con.execute("SELECT id, type, price, quantity FROM orders WHERE user_id=? AND symbol=? AND status='open' "
                                "AND type IN ('stop_loss','take_profit')", (uid, sym)))
        alts = rows(con.execute("SELECT id, condition, target FROM alerts WHERE user_id=? AND symbol=? AND triggered=0 "
                                "AND note=? AND condition IN ('above','below')", (uid, sym, PROTECT_NOTE)))
    target = next((o for o in ords if o["type"] == "take_profit"), None)
    stop = next((o for o in ords if o["type"] == "stop_loss"), None)
    out = {"target": target["price"] if target else None, "stop": stop["price"] if stop else None, "mode": "order" if (target or stop) else None}
    if not target and not stop:
        a_t = next((a for a in alts if a["condition"] == "above"), None)
        a_s = next((a for a in alts if a["condition"] == "below"), None)
        if a_t or a_s:
            out = {"target": a_t["target"] if a_t else None, "stop": a_s["target"] if a_s else None, "mode": "alert"}
    return out


def set_protection(uid: int, symbol: str, target: float | None, stop: float | None, mode: str) -> dict:
    """Hedef ve zarar sınırını kaydeder. mode='order': fiyat seviyeye gelince tüm pozisyon otomatik satılır
    (biri gerçekleşince diğeri iptal olur); mode='alert': yalnızca bildirim gönderilir."""
    sym = symbol.upper()
    if mode not in ("order", "alert"):
        raise HTTPException(400, "Geçersiz koruma türü.")
    held = portfolio.holding(uid, sym)
    if held <= 0:
        raise HTTPException(400, "Bu varlık portföyünüzde yok.")
    price = market.quotes([sym])[0].get("price")
    if price:
        if target is not None and target <= price:
            raise HTTPException(400, f"Hedef fiyat güncel fiyatın ({price:,.2f}) üzerinde olmalı.")
        if stop is not None and stop >= price:
            raise HTTPException(400, f"Zarar sınırı güncel fiyatın ({price:,.2f}) altında olmalı.")
    # Önce eskileri kaldır (bu özellikle kurulmuş emir ve alarmlar)
    with connect() as con:
        con.execute("UPDATE orders SET status='cancelled', closed_at=CURRENT_TIMESTAMP, result='Yeni koruma ayarıyla değiştirildi.' "
                    "WHERE user_id=? AND symbol=? AND status='open' AND type IN ('stop_loss','take_profit')", (uid, sym))
        con.execute("DELETE FROM alerts WHERE user_id=? AND symbol=? AND triggered=0 AND note=?", (uid, sym, PROTECT_NOTE))
    if mode == "order":
        if target is not None:
            orders.create(uid, {"symbol": sym, "type": "take_profit", "quantity": held, "price": target, "note": PROTECT_NOTE})
        if stop is not None:
            orders.create(uid, {"symbol": sym, "type": "stop_loss", "quantity": held, "price": stop, "note": PROTECT_NOTE})
    else:
        with connect() as con:
            for cond, val in (("above", target), ("below", stop)):
                if val is not None:
                    con.execute("INSERT INTO alerts (user_id, symbol, condition, target, repeat, note) VALUES (?,?,?,?,0,?)",
                                (uid, sym, cond, val, PROTECT_NOTE))
    return protection(uid, sym)


# ----------------------------------------------------------------------------- sağlık skoru
def _clip(x: float) -> float:
    return max(0.0, min(1.0, x))


def _sector(sym: str) -> str:
    m = market.market_of(sym)
    if m == "crypto":
        return "Kripto"
    if m == "fx":
        return "Döviz & Emtia"
    return (universe.asset(sym) or {}).get("sector") or market.ASSET_BY_SYMBOL.get(sym, {}).get("sector") or "Diğer"


def health(uid: int) -> dict:
    pos = portfolio.positions(uid)
    items = [i for i in pos["items"] if i["quantity"] > 0]
    if not items:
        return {"empty": True}
    rates: dict[str, float] = {}
    for cur in {i["currency"] for i in items}:
        try:
            rates[cur] = 1.0 if cur == "TRY" else account.fx_to_try(next(i["symbol"] for i in items if i["currency"] == cur))
        except Exception:
            rates[cur] = 1.0
    vals = {i["symbol"]: (i["value"] if i["value"] is not None else i["cost"]) * rates[i["currency"]] for i in items}
    total = sum(vals.values()) or 1.0
    weights = {s: v / total for s, v in vals.items()}
    top_sym, top_w = max(weights.items(), key=lambda kv: kv[1])
    n = len(items)

    sectors: dict[str, float] = {}
    for s, w in weights.items():
        sectors[_sector(s)] = sectors.get(_sector(s), 0) + w
    top_sec, top_sec_w = max(sectors.items(), key=lambda kv: kv[1])
    try_share = sum(w for s, w in weights.items() if market.currency_of(s) == "TRY")

    bal = account.balances(uid)
    cash = bal["total_cash"]
    cash_ratio = cash / (cash + total) if cash + total > 0 else 0

    with connect() as con:
        protected = {r["symbol"] for r in con.execute(
            "SELECT DISTINCT symbol FROM orders WHERE user_id=? AND status='open' AND type='stop_loss'", (uid,))}
        protected |= {r["symbol"] for r in con.execute(
            "SELECT DISTINCT symbol FROM alerts WHERE user_id=? AND triggered=0 AND condition='below'", (uid,))}
    covered = sum(w for s, w in weights.items() if s in protected)

    try:
        risk = portfolio.analytics(uid).get("risk") or {}
    except Exception:
        risk = {}
    vol = risk.get("volatility_pct")

    comps = []

    def add(key, title, weight, score, status, tip=None):
        tip = tip.strip() if tip else None
        tip = tip[0].upper() + tip[1:] if tip else None
        comps.append({"key": key, "title": title, "weight": weight, "score": round(score * 100), "status": status,
                      "tip": tip, "gain": round((1 - score) * weight)})

    div = 0.5 * _clip(n / 6) + 0.5 * _clip((0.6 - top_w) / 0.35)
    add("diversification", "Çeşitlendirme", 25, div,
        f"{n} farklı varlık; en büyük pozisyon {top_sym.replace('.IS', '')} (%{top_w * 100:.0f}).",
        None if div >= 0.8 else (f"{top_sym.replace('.IS', '')} payını %35'in altına indirmek" if top_w > 0.35 else "")
        + (" ve " if top_w > 0.35 and n < 6 else "") + (f"varlık sayısını 6'ya çıkarmak ({6 - n} varlık daha)" if n < 6 else "") + " puanınızı artırır.")
    sec = _clip((0.75 - top_sec_w) / 0.45) if n > 1 else 0.2
    add("sector", "Sektör dağılımı", 15, sec, f"En ağır sektör: {top_sec} (%{top_sec_w * 100:.0f}).",
        None if sec >= 0.8 else f"{top_sec} dışındaki sektörlerden hisse eklemek tek sektöre bağımlılığı azaltır.")
    if vol is not None:
        rsk = _clip((60 - vol) / 40)
        add("risk", "Risk (oynaklık)", 20, rsk, f"Yıllık oynaklık %{vol:.0f}" + (" — yüksek." if vol > 40 else " — makul." if vol > 25 else " — düşük."),
            None if rsk >= 0.8 else "Daha az dalgalı varlıklar (büyük şirket hisseleri, altın) eklemek riski dengeler.")
    else:
        add("risk", "Risk (oynaklık)", 20, 0.6, "Oynaklığı hesaplamak için yeterli geçmiş yok.")
    add("protection", "Koruma (zarar sınırı)", 15, covered,
        f"Zarar sınırı tanımlı pozisyonların portföydeki payı: %{covered * 100:.0f}.",
        None if covered >= 0.8 else "Pozisyonlarınıza zarar sınırı koyun: hisse kartında \"🛡 Hedef & zarar sınırı\" ile tek adımda.")
    cash_score = 1.0 if 0.05 <= cash_ratio <= 0.35 else _clip(0.4 + cash_ratio / 0.05 * 0.6) if cash_ratio < 0.05 else _clip(1 - (cash_ratio - 0.35) / 0.5)
    add("cash", "Nakit dengesi", 10, cash_score, f"Nakit oranı %{cash_ratio * 100:.0f}.",
        None if cash_score >= 0.8 else ("Fırsatlar ve beklenmedik durumlar için %5–35 arası nakit tutmak önerilir." if cash_ratio < 0.05
                                       else "Nakdin büyük kısmı boşta; enflasyon karşısında değer kaybedebilir."))
    cur_score = 1.0 if 0.3 <= try_share <= 0.85 else _clip(0.5 + (1 - try_share) / 0.15 * 0.5) if try_share > 0.85 else _clip(0.6 + try_share / 0.3 * 0.4)
    add("currency", "Kur dengesi", 15, cur_score, f"TL cinsinden varlıkların payı: %{try_share * 100:.0f}.",
        None if cur_score >= 0.8 else ("Döviz cinsinden varlıklar (ABD hisseleri, altın) TL'deki değer kaybına karşı koruma sağlar." if try_share > 0.85
                                       else "TL varlık oranı çok düşük; kur hareketleri getirinizi güçlü etkiler."))

    total_w = sum(c["weight"] for c in comps)
    score = round(sum(c["score"] * c["weight"] for c in comps) / total_w)
    grade = "Çok iyi" if score >= 80 else "İyi" if score >= 65 else "Orta" if score >= 50 else "Geliştirilmeli"
    tips = sorted([c for c in comps if c["tip"]], key=lambda c: -c["gain"])[:3]
    return {"empty": False, "score": score, "grade": grade, "components": comps,
            "tips": [{"title": c["title"], "text": c["tip"], "gain": c["gain"]} for c in tips],
            "sectors": [{"label": k, "pct": v * 100} for k, v in sorted(sectors.items(), key=lambda kv: -kv[1])]}


# ----------------------------------------------------------------------------- risk uyarıcı
RISK_PREF = "risk_notified"


def _tr(x: float, digits: int = 1) -> str:
    return f"{x:.{digits}f}".replace(".", ",")


def risk_warnings(uid: int) -> dict:
    """Portföydeki yoğunlaşma ve birlikte hareket risklerini sade uyarılara çevirir (en önemlisi önce)."""
    from . import quant
    pos = portfolio.positions(uid)
    items = [i for i in pos["items"] if i["quantity"] > 0]
    if not items:
        return {"empty": True, "warnings": []}
    rates: dict[str, float] = {}
    for cur in {i["currency"] for i in items}:
        try:
            rates[cur] = 1.0 if cur == "TRY" else account.fx_to_try(next(i["symbol"] for i in items if i["currency"] == cur))
        except Exception:
            rates[cur] = 1.0
    vals = {i["symbol"]: (i["value"] if i["value"] is not None else i["cost"]) * rates[i["currency"]] for i in items}
    total = sum(vals.values()) or 1.0
    w = {s: v / total for s, v in vals.items()}
    out: list[dict] = []

    def name(s: str) -> str:
        return s.replace(".IS", "")

    def add(key, level, icon, title, text, action=None):
        out.append({"key": key, "level": level, "icon": icon, "title": title, "text": text, "action": action})

    # 1) Tek varlığa yoğunlaşma
    for s, x in sorted(w.items(), key=lambda kv: -kv[1]):
        if x >= 0.3:
            add(f"single:{s}", "high" if x >= 0.5 else "medium", "⚖️", f"Tek varlığa yoğunlaşma: {name(s)} (%{x * 100:.0f})",
                f"Tek bir varlıktaki sert düşüş tüm portföyü etkiler: {name(s)} %10 düşerse portföyünüz yaklaşık %{_tr(x * 10)} kaybeder.",
                "Payını %30'un altına indirmeyi veya başka varlıklar eklemeyi düşünün.")

    # 2) Sektör yoğunlaşması
    sectors: dict[str, list[str]] = {}
    for s in w:
        sectors.setdefault(_sector(s), []).append(s)
    flagged: dict[str, dict] = {}
    for sec, syms in sectors.items():
        x = sum(w[s] for s in syms)
        if x >= 0.45 and len(syms) >= 2:
            flagged[sec] = {"syms": set(syms)}
            flagged[sec]["key"] = f"sector:{sec}"
            add(f"sector:{sec}", "high" if x >= 0.65 else "medium", "🏭", f"Sektör yoğunlaşması: {sec} (%{x * 100:.0f})",
                f"{', '.join(name(s) for s in syms[:5])} aynı sektörde. Sektöre özgü kötü bir gelişme (düzenleme, faiz, talep düşüşü) hepsini birlikte etkiler.",
                "Farklı sektörlerden varlık eklemek bu riski azaltır.")

    # 3) Birlikte hareket eden varlıklar ve oynaklık
    syms = sorted(w, key=lambda s: -w[s])[:12]
    vols: dict[str, float] = {}
    if len(syms) >= 2:
        try:
            r = quant._returns(syms, "6mo")
            if len(r) >= 40:
                corr = r.corr()
                cols = list(r.columns)
                vols = {s: float(r[s].std() * (252 ** 0.5) * 100) for s in cols}
                pairs = sorted(((a, b, float(corr.loc[a, b])) for i, a in enumerate(cols) for b in cols[i + 1:]
                                if corr.loc[a, b] >= 0.75 and w[a] + w[b] >= 0.15), key=lambda p: -p[2])
                shown = 0
                for a, b, c in pairs:
                    same = next((f for f in flagged.values() if a in f["syms"] and b in f["syms"]), None)
                    if same is not None:  # aynı sektör uyarısında zaten anlatılıyor; tekrar etmek yerine oraya eklenir
                        same["corr"] = max(same.get("corr", 0), c)
                        continue
                    if shown >= 3:
                        continue
                    shown += 1
                    add(f"pair:{a}:{b}", "high" if c >= 0.85 and w[a] + w[b] >= 0.4 else "medium", "🔗",
                        f"{name(a)} ve {name(b)} neredeyse aynı hareket ediyor",
                        f"Son 6 ayda günlük hareketlerinin korelasyonu {_tr(c, 2)}; ikisinin portföydeki toplam payı %{(w[a] + w[b]) * 100:.0f}. "
                        "Biri düşerken diğeri de büyük olasılıkla düşer.",
                        "Birini farklı hareket eden bir varlıkla değiştirmek gerçek çeşitlendirme sağlar.")
                for f in flagged.values():
                    if f.get("corr"):
                        warn = next(x for x in out if x["key"] == f["key"])
                        warn["text"] += f" Üstelik fiyatları da neredeyse birlikte hareket ediyor (korelasyon {_tr(f['corr'], 2)})."
                if len(cols) >= 3:
                    cs = [float(corr.loc[a, b]) for i, a in enumerate(cols) for b in cols[i + 1:]]
                    avg = sum(cs) / len(cs)
                    if avg >= 0.55:
                        add("avgcorr", "medium", "🧩", "Çeşitlendirme etkisi zayıf",
                            f"Varlıklarınızın ortalama korelasyonu {_tr(avg, 2)}: sayıca çok görünse de çoğu aynı yöne hareket ediyor.",
                            "Altın, döviz veya farklı piyasalardan (ör. ABD hisseleri) varlıklar korelasyonu düşürür.")
        except Exception:
            pass
    for s, v in sorted(vols.items(), key=lambda kv: -kv[1]):
        if v >= 65 and w.get(s, 0) >= 0.1:
            add(f"vol:{s}", "medium", "🌪️", f"{name(s)} çok oynak",
                f"Yıllık oynaklığı %{v:.0f}; bu, günde ±%{_tr(v / 15.9)} civarı dalgalanmanın olağan olduğu anlamına gelir.",
                "Pozisyon büyüklüğünü sınırlamak veya zarar sınırı koymak riski kontrol eder.")

    # 4) Kripto ağırlığı
    crypto = sum(x for s, x in w.items() if market.market_of(s) == "crypto")
    if crypto >= 0.3:
        add("crypto", "high" if crypto >= 0.5 else "medium", "🪙", f"Kripto ağırlığı %{crypto * 100:.0f}",
            f"Kripto paralar kısa sürede %30–50 değer kaybedebilir; bu, portföyünüzde %{crypto * 30:.0f}–{crypto * 50:.0f} kayıp demektir.", "Kripto payını risk toleransınıza göre sınırlamayı düşünün.")

    # 5) Korumasız büyüyen zararlar
    with connect() as con:
        protected = {r["symbol"] for r in con.execute(
            "SELECT DISTINCT symbol FROM orders WHERE user_id=? AND status='open' AND type='stop_loss'", (uid,))}
        protected |= {r["symbol"] for r in con.execute(
            "SELECT DISTINCT symbol FROM alerts WHERE user_id=? AND triggered=0 AND condition='below'", (uid,))}
    for i in items:
        if (i.get("pnl_pct") or 0) <= -15 and i["symbol"] not in protected and w[i["symbol"]] >= 0.05:
            add(f"loss:{i['symbol']}", "medium", "📉", f"Korumasız zarar: {name(i['symbol'])} (−%{abs(i['pnl_pct']):.0f})",
                "Zarar büyüdükçe telafisi zorlaşır: %20 düşen bir varlığın başa baş için %25 yükselmesi gerekir.",
                "Hisse kartındaki “🛡 Hedef & zarar sınırı” ile bir sınır belirleyebilirsiniz.")

    # 6) Tamamı TL
    try_share = sum(x for s, x in w.items() if market.currency_of(s) == "TRY")
    if try_share >= 0.97 and len(items) >= 3:
        add("currency", "info", "💱", "Varlıkların tamamı TL cinsinden",
            "TL'deki değer kaybı portföyün döviz bazındaki değerini doğrudan düşürür.",
            "Az miktarda altın veya döviz cinsinden varlık kur riskini dengeler.")

    rank = {"high": 0, "medium": 1, "info": 2}
    out.sort(key=lambda x: rank[x["level"]])
    lvl = "high" if any(x["level"] == "high" for x in out) else "medium" if any(x["level"] == "medium" for x in out) else "ok"
    summary = {"high": "Portföyünüzde dikkat gerektiren önemli riskler var.",
               "medium": "Portföyünüzde gözden geçirmeye değer bazı riskler var.",
               "ok": "Belirgin bir yoğunlaşma veya birlikte hareket riski görünmüyor."}[lvl]
    return {"empty": False, "level": lvl, "summary": summary, "warnings": out}


def notify_risks() -> None:
    """Günde bir kez: daha önce bildirilmemiş önemli (yüksek seviye) risk uyarılarını bildirim olarak gönderir."""
    import json
    from . import notifications
    today_s = date.today().isoformat()
    with connect() as con:
        users = [r["user_id"] for r in con.execute("SELECT DISTINCT user_id FROM transactions")]
        prefs = {r["user_id"]: r["value"] for r in con.execute("SELECT user_id, value FROM user_prefs WHERE key=?", (RISK_PREF,))}
    for uid in users:
        try:
            saved = json.loads(prefs.get(uid) or "{}")
            if saved.get("day") == today_s:
                continue
            res = risk_warnings(uid)
            high = [x for x in res["warnings"] if x["level"] == "high"]
            new = [x for x in high if x["key"] not in saved.get("keys", [])]
            if new:
                more = f" (+{len(new) - 1} uyarı daha)" if len(new) > 1 else ""
                notifications.add(uid, "system", f"⚠️ Portföy riski: {new[0]['title']}", new[0]["text"][:180] + more, "/portfoy")
            with connect() as con:
                con.execute("INSERT OR REPLACE INTO user_prefs VALUES (?,?,?)",
                            (uid, RISK_PREF, json.dumps({"day": today_s, "keys": [x["key"] for x in high]})))
        except Exception:
            continue


# ----------------------------------------------------------------------------- temettü takvimi
_cal_cache: dict[str, tuple[float, dict]] = {}
_cal_lock = threading.Lock()
CAL_TTL = 12 * 3600


def _calendar(sym: str) -> dict:
    with _cal_lock:
        hit = _cal_cache.get(sym)
    if hit and time.time() - hit[0] < (CAL_TTL if hit[1] else 600):
        return hit[1]
    try:
        with yahoo.slot():
            cal = yf.Ticker(sym).calendar or {}
        cal = cal if isinstance(cal, dict) else {}
    except yahoo.YahooBusy:
        return hit[1] if hit else {}
    except Exception as e:
        yahoo.fail(e)
        return hit[1] if hit else {}
    with _cal_lock:
        _cal_cache[sym] = (time.time(), cal)
    return cal


def _as_date(v) -> date | None:
    if isinstance(v, list):
        v = v[0] if v else None
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    return None


def dividend_calendar(uid: int) -> dict:
    """Önümüzdeki 12 ayın temettüleri: şirketin açıkladığı kesin tarihler ve geçmiş ödeme düzeninden tahminler."""
    pos = portfolio.positions(uid)
    items = [i for i in pos["items"] if i["quantity"] > 0 and market.market_of(i["symbol"]) in ("bist", "us")]
    today = date.today()
    horizon = today + timedelta(days=365)
    events = []
    rates = {}
    for i in items:
        if i["currency"] not in rates:
            try:
                rates[i["currency"]] = account.fx_to_try(i["symbol"])
            except Exception:
                rates[i["currency"]] = 1.0
    # Her hissenin temettü geçmişi ve takvimi paralel çekilir (ilk açılışta hızlı olsun diye)
    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(max_workers=4) as ex:
        fetched = dict(zip([i["symbol"] for i in items],
                           ex.map(lambda i: (portfolio._dividends(i["symbol"]), _calendar(i["symbol"])), items)))
    for i in items:
        sym, qty, cur = i["symbol"], i["quantity"], i["currency"]
        divs, cal = fetched[sym]
        last = divs[divs.index > pd.Timestamp(today - timedelta(days=400))] if len(divs) else divs
        per_share_last = float(divs.iloc[-1]) if len(divs) else None
        confirmed = set()
        ex = _as_date(cal.get("Ex-Dividend Date"))
        if ex and today <= ex <= horizon and per_share_last:
            pay = _as_date(cal.get("Dividend Date"))
            events.append({"symbol": sym, "name": i["name"], "date": ex.isoformat(), "pay_date": pay.isoformat() if pay else None,
                           "status": "kesin", "per_share": per_share_last, "quantity": qty, "currency": cur,
                           "amount": per_share_last * qty, "amount_try": per_share_last * qty * rates[cur]})
            confirmed.add((ex.year, ex.month))
        # Geçmiş düzen: son ~13 aydaki her ödeme bir yıl sonra tekrarlanacak gibi tahmin edilir
        for d, amount in last.items():
            nd = (d + pd.DateOffset(years=1)).date()
            if nd <= today or nd > horizon:
                continue
            if any(abs((nd - date(y, m, 15)).days) < 45 for y, m in confirmed):
                continue
            events.append({"symbol": sym, "name": i["name"], "date": nd.isoformat(), "pay_date": None, "status": "tahmini",
                           "per_share": float(amount), "quantity": qty, "currency": cur,
                           "amount": float(amount) * qty, "amount_try": float(amount) * qty * rates[cur]})
    events.sort(key=lambda e: e["date"])
    months = []
    for k in range(12):
        m = (today.replace(day=1) + pd.DateOffset(months=k)).date()
        tot = sum(e["amount_try"] for e in events if e["date"][:7] == m.strftime("%Y-%m"))
        months.append({"month": m.strftime("%Y-%m"), "total_try": tot})
    received = portfolio.dividends(uid)
    last12 = sum(p["amount_try"] for p in received["payments"] if p["date"] >= (today - timedelta(days=365)).isoformat())
    return {"events": events, "months": months, "expected_try": sum(e["amount_try"] for e in events),
            "received_12m_try": last12, "payers": len({e["symbol"] for e in events}), "holdings": len(items)}
