"""Hedef planlayıcı ve enflasyona göre gerçek kazanç.

- goal: "X yılda Y TL" hedefi için gereken aylık birikim ve Monte Carlo ile hedefe ulaşma olasılığı.
  Tüm tutarlar bugünkü alım gücüyle (reel) hesaplanır; böylece yüksek enflasyon hesabı bozmaz.
- real_pnl: portföydeki her pozisyonun maliyetini alış tarihinden bugüne TÜFE ile güncelleyip
  "alım gücü olarak" gerçek kâr/zararı gösterir.
"""
from datetime import datetime

import numpy as np
import pandas as pd
from fastapi import HTTPException

from . import account, market, portfolio, quant

# Reel (enflasyondan arındırılmış) yıllık getiri ve oynaklık varsayımları. Uzun dönem küresel ve yerel
# varlık sınıflarının tarihsel ortalamalarına dayanan, bilinçli olarak temkinli tutulmuş değerlerdir.
PROFILES = {
    "temkinli": {"label": "Temkinli", "real": 0.02, "vol": 0.07, "mix": "Ağırlıkla mevduat/para piyasası, bir miktar altın"},
    "dengeli": {"label": "Dengeli", "real": 0.05, "vol": 0.15, "mix": "Hisse, altın ve döviz karışık"},
    "atak": {"label": "Atak", "real": 0.08, "vol": 0.26, "mix": "Ağırlıkla hisse senedi"},
}


def _fv(start: float, monthly: float, r_month: float, months: int) -> float:
    g = (1 + r_month) ** months
    return start * g + (monthly * (g - 1) / r_month if r_month else monthly * months)


def current_equity(uid: int) -> float:
    """Kullanıcının bugünkü toplam varlığı (nakit + portföy, TL)."""
    from .engine import holdings_value_try
    try:
        value, _ = holdings_value_try(uid)
        return float(account.balances(uid)["total_cash"] + value)
    except Exception:
        return 0.0


def goal(uid: int, target: float, years: float, monthly: float | None, start: float | None, profile: str) -> dict:
    if profile not in PROFILES:
        raise HTTPException(400, "Bilinmeyen risk profili.")
    if not (target > 0 and 0.25 <= years <= 50):
        raise HTTPException(400, "Hedef tutar pozitif, süre 3 ay ile 50 yıl arasında olmalı.")
    p = PROFILES[profile]
    months = int(round(years * 12))
    start = current_equity(uid) if start is None else max(0.0, float(start))
    r_m = (1 + p["real"]) ** (1 / 12) - 1
    vol_m = p["vol"] / np.sqrt(12)

    # Hedefe beklenen getiriyle ulaşmak için gereken aylık birikim
    g = (1 + r_m) ** months
    need = max(0.0, (target - start * g) * r_m / (g - 1)) if r_m else max(0.0, (target - start) / months)
    monthly = need if monthly is None else max(0.0, float(monthly))

    # Monte Carlo: aylık log-normal reel getiriler
    rng = np.random.default_rng(7)
    paths = 3000
    mu = np.log(1 + r_m) - vol_m ** 2 / 2
    rets = np.exp(rng.normal(mu, vol_m, size=(paths, months))) - 1
    wealth = np.empty((paths, months + 1))
    wealth[:, 0] = start
    for m in range(months):
        wealth[:, m + 1] = wealth[:, m] * (1 + rets[:, m]) + monthly
    final = wealth[:, -1]
    prob = float((final >= target).mean() * 100)
    reached = (wealth >= target).argmax(axis=1).astype(float)
    reached[~(wealth >= target).any(axis=1)] = np.inf  # süre içinde ulaşamayan senaryolar
    med = float(np.median(reached))
    median_months = med if np.isfinite(med) else None  # senaryoların yarısından fazlası ulaşamıyorsa ortanca süre yoktur

    step = max(1, months // 60)
    idx = list(range(0, months + 1, step)) + ([months] if months % step else [])
    today = pd.Timestamp(datetime.now().date())
    times = [int((today + pd.DateOffset(months=i)).timestamp()) for i in idx]
    pct = {q: np.percentile(wealth[:, idx], q, axis=0) for q in (10, 50, 90)}
    contributed = [start + monthly * i for i in idx]

    try:
        infl = float(quant.cpi()["yearly"].iloc[-1])
    except Exception:
        infl = None
    nominal_target = target * (1 + infl / 100) ** years if infl is not None else None  # bugünkü enflasyon sürerse

    # Olasılığa göre birkaç aylık birikim alternatifi (aynı rastgele senaryolarla)
    def prob_for(c: float) -> float:
        w = np.full(paths, start)
        for m in range(months):
            w = w * (1 + rets[:, m]) + c
        return float((w >= target).mean() * 100)
    options = [{"monthly": round(c, -1), "probability": round(prob_for(c), 1)}
               for c in sorted({need * k for k in (0.75, 1.0, 1.25, 1.5)} | {monthly}) if c >= 0]

    # %75 olasılıkla hedefe ulaştıran aylık birikim (ikili arama)
    lo, hi = 0.0, max(need * 4, target / months)
    if prob_for(0.0) >= 75:
        safe = 0.0
    else:
        for _ in range(18):
            mid = (lo + hi) / 2
            lo, hi = (lo, mid) if prob_for(mid) >= 75 else (mid, hi)
        safe = hi
    if prob >= 75:
        verdict = ("good", f"Bu planla hedefe ulaşma olasılığınız yüksek (%{prob:.0f}).")
    elif prob >= 45:
        verdict = ("neutral", f"Hedefe ulaşma olasılığı %{prob:.0f}. %75 olasılık için aylık yaklaşık {safe:,.0f} TL biriktirmek veya süreyi uzatmak gerekir.".replace(",", "."))
    else:
        verdict = ("bad", f"Bu planla hedefe ulaşma olasılığı düşük (%{prob:.0f}). %75 olasılık için aylık yaklaşık {safe:,.0f} TL biriktirmeniz gerekir.".replace(",", "."))
    return {
        "target": target, "years": years, "months": months, "start": round(start, 2), "monthly": round(monthly, 2),
        "required_monthly": round(need, 2), "safe_monthly": round(safe, 2), "profile": {"key": profile, **p}, "probability": round(prob, 1),
        "expected_final": round(_fv(start, monthly, r_m, months), 2), "median_final": round(float(np.median(final)), 2),
        "p10_final": round(float(np.percentile(final, 10)), 2), "p90_final": round(float(np.percentile(final, 90)), 2),
        "total_contributed": round(start + monthly * months, 2), "median_months_to_target": median_months,
        "inflation_now": infl, "nominal_target": round(nominal_target, 2) if nominal_target else None,
        "verdict": {"tone": verdict[0], "text": verdict[1]}, "options": options,
        "chart": {"times": times, "p10": [round(float(v), 2) for v in pct[10]], "p50": [round(float(v), 2) for v in pct[50]],
                  "p90": [round(float(v), 2) for v in pct[90]], "contributed": [round(v, 2) for v in contributed]},
        "profiles": [{"key": k, **v} for k, v in PROFILES.items()],
        "note": "Tutarlar bugünkü alım gücüyle (enflasyondan arındırılmış) hesaplanır. Getiri varsayımları tarihsel ortalamalara "
                "dayanır; gelecekteki getiriler farklı olabilir.",
    }


def real_pnl(uid: int) -> dict:
    """Her açık pozisyon için maliyetin TÜFE ile bugüne taşınmış hâli ve alım gücü olarak gerçek kâr/zarar."""
    txs = portfolio.transactions(uid)
    if not txs:
        return {"empty": True}
    today = pd.Timestamp(datetime.now().date())
    fx = portfolio.FxRates({market.currency_of(t["symbol"]) for t in txs})
    infl_cache: dict[pd.Timestamp, float] = {}

    def infl(d: pd.Timestamp) -> float:
        if d not in infl_cache:
            try:
                infl_cache[d] = quant.inflation_between(d) or 0.0
            except Exception:
                infl_cache[d] = 0.0
        return infl_cache[d]

    book: dict[str, dict] = {}
    for t in txs:
        sym = t["symbol"]
        d = portfolio._tx_date(t, today)
        rate = fx.at(market.currency_of(sym), d) or 1.0
        b = book.setdefault(sym, {"qty": 0.0, "cost_try": 0.0, "cost_real": 0.0, "first": d})
        if t["side"] == "buy":
            if b["qty"] <= 1e-9:
                b["first"] = d
            c = (t["quantity"] * t["price"] + t["fee"]) * rate
            b["qty"] += t["quantity"]
            b["cost_try"] += c
            b["cost_real"] += c * (1 + infl(d) / 100)
        elif b["qty"] > 1e-9:
            k = min(1.0, t["quantity"] / b["qty"])
            b["qty"] -= t["quantity"]
            b["cost_try"] *= 1 - k
            b["cost_real"] *= 1 - k
    pos = {i["symbol"]: i for i in portfolio.positions(uid)["items"]}
    items = []
    for sym, b in book.items():
        if b["qty"] <= 1e-9 or sym not in pos:
            continue
        i = pos[sym]
        rate = fx.at(i["currency"]) or 1.0
        value = (i["value"] if i["value"] is not None else i["cost"]) * rate
        items.append({"symbol": sym, "name": i["name"], "since": b["first"].strftime("%Y-%m-%d"), "cost_try": b["cost_try"],
                      "cost_real": b["cost_real"], "value_try": value, "nominal_pnl": value - b["cost_try"],
                      "nominal_pct": (value / b["cost_try"] - 1) * 100 if b["cost_try"] else None,
                      "real_pnl": value - b["cost_real"], "real_pct": (value / b["cost_real"] - 1) * 100 if b["cost_real"] else None,
                      "inflation_pct": (b["cost_real"] / b["cost_try"] - 1) * 100 if b["cost_try"] else 0.0})
    if not items:
        return {"empty": True}
    items.sort(key=lambda x: -x["value_try"])
    tot = {k: sum(x[k] for x in items) for k in ("cost_try", "cost_real", "value_try")}
    tot["nominal_pnl"] = tot["value_try"] - tot["cost_try"]
    tot["real_pnl"] = tot["value_try"] - tot["cost_real"]
    tot["nominal_pct"] = (tot["value_try"] / tot["cost_try"] - 1) * 100 if tot["cost_try"] else None
    tot["real_pct"] = (tot["value_try"] / tot["cost_real"] - 1) * 100 if tot["cost_real"] else None
    tot["eroded"] = tot["cost_real"] - tot["cost_try"]  # enflasyonun "yediği" tutar
    beat = sum(1 for x in items if (x["real_pct"] or 0) > 0)
    return {"empty": False, "items": items, "totals": tot, "beat": beat, "count": len(items),
            "summary": (f"{len(items)} pozisyonun {beat} tanesi enflasyonun üzerinde getiri sağlıyor. "
                        + ("Portföyünüz alım gücü olarak kazandırıyor." if (tot["real_pnl"] or 0) >= 0
                           else "Portföyünüz nominal olarak " + ("kârda" if tot["nominal_pnl"] >= 0 else "zararda")
                           + " görünse de alım gücü olarak geride.")),
            "source": "TÜFE: TCMB (TÜİK verisi). Son açıklanan aydan sonrası son aylık değerle tahmin edilir."}
