"""Büyük dil modeli (LLM) tabanlı analiz asistanı.

ANTHROPIC_API_KEY tanımlıysa (ortam değişkeni veya Ayarlar sayfası) Claude
modeli kullanılır. Anahtar yoksa asistan, göstergelerden kural tabanlı bir
Türkçe yorum üretir; böylece uygulama çevrimdışı/anahtarsız da çalışır.
"""
import json
import os

from .db import DATA_DIR

SETTINGS_PATH = DATA_DIR / "settings.json"
DEFAULT_MODEL = "claude-sonnet-5-5"

SYSTEM_PROMPT = """Sen bir finansal analiz platformunda çalışan Türkçe konuşan bir analiz asistanısın.
Kullanıcıya Borsa İstanbul, ABD borsaları, döviz ve kripto piyasalarıyla ilgili verileri yorumlamada yardım edersin.
Kurallar:
- Her zaman Türkçe, açık ve anlaşılır yaz; teknik terimleri kısaca açıkla.
- Sana verilen piyasa verilerini ve gösterge değerlerini kullan; veri yoksa uydurma, bilmediğini söyle.
- Kesinlikle kişisel yatırım tavsiyesi verme, "al/sat" emri verme. Göstergelerin ne söylediğini eğitim amaçlı yorumla.
- Yanıtın sonunda kısa bir hatırlatma ekle: "Bu yorum yatırım tavsiyesi değildir."
"""


def load_settings() -> dict:
    try:
        return json.loads(SETTINGS_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {}


def save_settings(data: dict) -> None:
    """None olan alanlar değiştirilmez, boş metin ("") alanı siler."""
    current = load_settings()
    for k, v in data.items():
        if v == "":
            current.pop(k, None)
        elif v is not None:
            current[k] = v
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    SETTINGS_PATH.write_text(json.dumps(current, ensure_ascii=False, indent=2), encoding="utf-8")


def api_key() -> str | None:
    return load_settings().get("anthropic_api_key") or os.environ.get("ANTHROPIC_API_KEY")


def status() -> dict:
    key = api_key()
    return {"llm_enabled": bool(key), "model": load_settings().get("model") or DEFAULT_MODEL,
            "key_hint": f"…{key[-4:]}" if key else None,
            "tray_on_close": load_settings().get("tray_on_close", True),
            "telegram_configured": bool(load_settings().get("telegram_bot_token") and load_settings().get("telegram_chat_id")),
            "telegram_chat_id": load_settings().get("telegram_chat_id")}


def rule_based(context: dict) -> str:
    if not context.get("symbol"):
        return ("Yapay zekâ modeli için API anahtarı tanımlı değil. Ayarlar sayfasından bir Anthropic API "
                "anahtarı girerek serbest soru-cevap özelliğini açabilirsiniz. Şimdilik bir varlık seçerseniz "
                "göstergelere dayalı otomatik bir yorum üretebilirim.")
    s = context["analysis"]
    st = s["stats"]
    lines = [f"**{context['name']} ({context['symbol']})** için gösterge özeti:", ""]
    lines.append(f"- Son fiyat **{st['last']:.4f}**; günlük değişim %{st['change_1d']:.2f}"
                 + (f", son 1 ayda %{st['change_1m']:.2f}." if st.get("change_1m") is not None else "."))
    if st.get("volatility") is not None:
        level = "yüksek" if st["volatility"] > 40 else "orta" if st["volatility"] > 20 else "düşük"
        lines.append(f"- Yıllıklandırılmış oynaklık yaklaşık %{st['volatility']:.1f} ({level}).")
    for sig in s["signals"]:
        lines.append(f"- {sig['name']}: {sig['note']} → *{sig['signal']}* eğilimi.")
    lines.append("")
    lines.append(f"Göstergelerin genel görünümü: **{s['overall']}**. "
                 "Bu görünüm yalnızca teknik göstergelerin anlık durumunu yansıtır; haberler, temel veriler "
                 "ve risk toleransınız dikkate alınmamıştır.")
    lines.append("")
    lines.append("_Not: LLM anahtarı tanımlı olmadığı için bu yorum kural tabanlı üretildi. "
                 "Bu yorum yatırım tavsiyesi değildir._")
    return "\n".join(lines)


def ask(question: str, history: list[dict], context: dict) -> dict:
    key = api_key()
    if not key:
        return {"answer": rule_based(context), "source": "kural-tabanlı"}

    import anthropic

    ctx_text = "Şu an seçili varlık yok."
    if context.get("symbol"):
        ctx_text = "Seçili varlığın güncel verileri (JSON):\n" + json.dumps(
            {"sembol": context["symbol"], "ad": context["name"], "piyasa": context.get("market"),
             "istatistikler": context["analysis"]["stats"], "göstergeler": context["analysis"]["signals"],
             "genel_görünüm": context["analysis"]["overall"],
             "son_20_kapanış": context.get("recent_closes")}, ensure_ascii=False)
    if context.get("news"):
        ctx_text += "\n\nVarlıkla ilgili son haber başlıkları (JSON):\n" + json.dumps(context["news"], ensure_ascii=False)
    if context.get("market_overview"):
        ctx_text += "\n\nGenel piyasa görünümü (JSON):\n" + json.dumps(context["market_overview"], ensure_ascii=False)

    messages = [{"role": m["role"], "content": m["content"]} for m in history[-10:]
                if m.get("role") in ("user", "assistant") and m.get("content")]
    messages.append({"role": "user", "content": f"{ctx_text}\n\nSoru: {question}"})

    client = anthropic.Anthropic(api_key=key)
    try:
        resp = client.messages.create(
            model=load_settings().get("model") or DEFAULT_MODEL,
            max_tokens=1500,
            system=SYSTEM_PROMPT,
            messages=messages,
        )
        text = "".join(b.text for b in resp.content if getattr(b, "type", "") == "text")
        return {"answer": text, "source": "llm"}
    except Exception as e:
        return {"answer": f"LLM isteği başarısız oldu ({e}). Kural tabanlı yorum:\n\n" + rule_based(context),
                "source": "kural-tabanlı"}
