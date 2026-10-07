"""Yatırım akademisi (kısa dersler + mini testler) ve haftalık tahmin oyunu."""
from datetime import date, timedelta

import pandas as pd

from fastapi import HTTPException

from . import market
from .db import connect, rows

LESSONS = [
    {"id": "temel", "icon": "📘", "title": "Borsa nedir, hisse nasıl alınır?", "minutes": 3, "body": [
        "Borsa, şirket paylarının (hisse senetlerinin) alınıp satıldığı düzenli bir piyasadır. Türkiye'de bu piyasa Borsa İstanbul'dur (BIST).",
        "Bir hisse aldığınızda o şirketin küçük bir parçasına ortak olursunuz. Şirket büyüyüp kâr ettikçe hissenin değeri artabilir; şirket kâr dağıtırsa temettü alırsınız.",
        "Hisse alım-satımı aracı kurumlar üzerinden yapılır. Türkiye'de işlemler T+2 günde takas edilir: bugün yaptığınız alışın parası iki iş günü sonra hesabınızdan çıkar.",
        "Endeksler (ör. BIST 100) birçok hissenin ortalama performansını gösterir ve piyasanın genel yönünü anlamaya yarar."],
     "quiz": [
         {"q": "BIST 100 nedir?", "options": ["Tek bir hisse", "100 hisseden oluşan bir endeks", "Bir döviz kuru"], "answer": 1},
         {"q": "Türkiye'de hisse işlemleri kaç günde takas edilir?", "options": ["Aynı gün (T+0)", "T+1", "T+2"], "answer": 2},
         {"q": "Şirketin kârından ortaklara dağıtılan paya ne denir?", "options": ["Temettü", "Komisyon", "Teminat"], "answer": 0}]},
    {"id": "mum", "icon": "🕯", "title": "Mum grafikleri ve formasyonlar", "minutes": 4, "body": [
        "Her mum bir zaman dilimindeki açılış, en yüksek, en düşük ve kapanış fiyatını gösterir. Yeşil mumda kapanış açılıştan yüksek, kırmızı mumda düşüktür.",
        "Mumun gövdesi açılış-kapanış arasını, ince çizgiler (fitiller) ise en yüksek ve en düşük fiyatları gösterir.",
        "Doji: açılış ve kapanış neredeyse aynıdır, kararsızlığı gösterir. Çekiç: uzun alt fitilli küçük gövde; düşüş sonrası dönüş işareti olabilir.",
        "Yutan boğa: yeşil mumun gövdesi önceki kırmızı mumu tamamen kapsar. Formasyonlar tek başına değil, trend ve hacimle birlikte değerlendirilmelidir."],
     "quiz": [
         {"q": "Yeşil mum ne anlama gelir?", "options": ["Kapanış açılıştan yüksek", "Kapanış açılıştan düşük", "İşlem olmamış"], "answer": 0},
         {"q": "Açılış ve kapanışı neredeyse eşit olan mum hangisidir?", "options": ["Çekiç", "Doji", "Yutan ayı"], "answer": 1},
         {"q": "Mumun ince çizgileri neyi gösterir?", "options": ["Hacmi", "En yüksek ve en düşük fiyatı", "Temettüyü"], "answer": 1}]},
    {"id": "rsi", "icon": "📉", "title": "RSI ve aşırı alım / satım", "minutes": 3, "body": [
        "RSI (Göreceli Güç Endeksi), son 14 dönemdeki yükseliş ve düşüşlerin gücünü 0–100 arasında ölçer.",
        "RSI 70'in üzerindeyse varlık 'aşırı alım', 30'un altındaysa 'aşırı satım' bölgesinde kabul edilir.",
        "Güçlü trendlerde RSI uzun süre aşırı bölgede kalabilir; bu yüzden tek başına al-sat sinyali olarak kullanılmamalıdır.",
        "Fiyat yeni zirve yaparken RSI yapamıyorsa (uyumsuzluk), trendin zayıfladığına işaret edebilir."],
     "quiz": [
         {"q": "RSI hangi aralıkta değer alır?", "options": ["-1 ile 1", "0 ile 100", "0 ile 1000"], "answer": 1},
         {"q": "RSI 25 ise varlık genellikle hangi bölgededir?", "options": ["Aşırı satım", "Aşırı alım", "Nötr"], "answer": 0},
         {"q": "RSI tek başına güvenilir bir al-sat sinyali midir?", "options": ["Evet, her zaman", "Hayır, diğer araçlarla birlikte değerlendirilmeli"], "answer": 1}]},
    {"id": "ortalama", "icon": "〰", "title": "Hareketli ortalamalar ve MACD", "minutes": 4, "body": [
        "Hareketli ortalama (SMA), son N günün kapanışlarının ortalamasıdır ve fiyattaki gürültüyü azaltıp trendi gösterir.",
        "Fiyat SMA 50 ve SMA 200'ün üzerindeyse genellikle yükseliş trendi olarak yorumlanır.",
        "Altın kesişim: SMA 50'nin SMA 200'ü yukarı kesmesi; ölüm kesişimi: aşağı kesmesi.",
        "MACD, iki üssel ortalama (12 ve 26 günlük) arasındaki farktır. MACD sinyal çizgisini yukarı kestiğinde momentum artıyor demektir."],
     "quiz": [
         {"q": "SMA 50'nin SMA 200'ü yukarı kesmesine ne denir?", "options": ["Ölüm kesişimi", "Altın kesişim", "Bollinger sıkışması"], "answer": 1},
         {"q": "MACD hangi ortalamaların farkıdır?", "options": ["12 ve 26 günlük üssel", "50 ve 200 günlük basit", "7 ve 14 günlük"], "answer": 0},
         {"q": "Hareketli ortalamanın temel amacı nedir?", "options": ["Gürültüyü azaltıp trendi göstermek", "Temettüyü hesaplamak"], "answer": 0}]},
    {"id": "temelanaliz", "icon": "🏢", "title": "Temel analiz: F/K ve PD/DD", "minutes": 4, "body": [
        "F/K (Fiyat/Kazanç) oranı, piyasa değerinin yıllık net kâra bölünmesidir. 'Bu şirketin kârını kaç yılda geri alırım' sorusunun kaba bir cevabıdır.",
        "PD/DD (Piyasa Değeri/Defter Değeri), şirketin borsadaki değerinin özkaynaklarına oranıdır. 1'in altı, şirketin defter değerinin altında işlem gördüğünü gösterir.",
        "Düşük F/K her zaman ucuzluk demek değildir; kârlar düşecekse oran yanıltıcı olabilir. Oranlar aynı sektördeki şirketlerle karşılaştırılmalıdır.",
        "ROE (özkaynak kârlılığı), şirketin ortak sermayesini ne kadar verimli kullandığını gösterir."],
     "quiz": [
         {"q": "F/K oranı nasıl hesaplanır?", "options": ["Piyasa değeri / net kâr", "Net kâr / satışlar", "Borç / özkaynak"], "answer": 0},
         {"q": "PD/DD 0,8 ise ne anlama gelir?", "options": ["Defter değerinin altında işlem görüyor", "Çok pahalı", "Zarar ediyor"], "answer": 0},
         {"q": "Oranlar en doğru nasıl yorumlanır?", "options": ["Tek başına", "Aynı sektördeki şirketlerle karşılaştırılarak"], "answer": 1}]},
    {"id": "temettu", "icon": "💰", "title": "Temettü yatırımı", "minutes": 3, "body": [
        "Temettü, şirketin kârının bir kısmını ortaklarına nakit olarak dağıtmasıdır.",
        "Temettü verimi = son 12 ayda ödenen hisse başı temettü / hisse fiyatı. Örneğin 10 TL'lik hisse 0,50 TL temettü verdiyse verim %5'tir.",
        "Hak kullanım tarihinden önce hisseyi almış olmanız gerekir; o gün hisse fiyatı genellikle temettü kadar düşerek açılır.",
        "Düzenli ve artan temettü ödeyen şirketler genellikle olgun ve nakit üreten şirketlerdir."],
     "quiz": [
         {"q": "20 TL'lik hisse yılda 1 TL temettü öderse verim kaçtır?", "options": ["%2", "%5", "%20"], "answer": 1},
         {"q": "Temettü almak için hisse en geç ne zaman alınmalı?", "options": ["Hak kullanım tarihinden önce", "Ödeme gününden sonra"], "answer": 0},
         {"q": "Temettü neyin bir kısmıdır?", "options": ["Şirketin borcunun", "Şirketin kârının"], "answer": 1}]},
    {"id": "risk", "icon": "🛡", "title": "Risk yönetimi ve çeşitlendirme", "minutes": 4, "body": [
        "Çeşitlendirme, paranızı birbiriyle aynı yönde hareket etmeyen farklı varlıklara bölmektir. Böylece tek bir varlıktaki düşüş portföyü daha az etkiler.",
        "Zarar durdur (stop-loss) emri, fiyat belirlediğiniz seviyeye inerse otomatik satış yaparak kaybı sınırlar.",
        "Pozisyon büyüklüğü: tek bir işleme portföyün küçük bir kısmını (ör. %5–10) ayırmak, büyük kayıpları önler.",
        "Oynaklık (volatilite) fiyatın ne kadar dalgalandığını gösterir; yüksek oynaklık hem yüksek kazanç hem yüksek kayıp ihtimali demektir."],
     "quiz": [
         {"q": "Çeşitlendirmenin amacı nedir?", "options": ["Riski dağıtmak", "Komisyonu artırmak", "Vergiyi azaltmak"], "answer": 0},
         {"q": "Zarar durdur emri ne işe yarar?", "options": ["Kârı artırır", "Kaybı sınırlar", "Temettü getirir"], "answer": 1},
         {"q": "Yüksek oynaklık ne demektir?", "options": ["Fiyat çok az değişir", "Fiyat sert dalgalanır"], "answer": 1}]},
    {"id": "psikoloji", "icon": "🧠", "title": "Yatırımcı psikolojisi", "minutes": 3, "body": [
        "FOMO (fırsatı kaçırma korkusu), hızla yükselen bir varlığı plansız ve geç almaya yol açabilir.",
        "Kayıptan kaçınma: insanlar kaybı, aynı büyüklükteki kazançtan daha güçlü hisseder; bu yüzden zarardaki pozisyonları gereğinden uzun tutabilir.",
        "İntikam işlemi: kaybı hemen telafi etmek için daha riskli işlemler yapmak.",
        "İşlem günlüğü tutmak (neden aldım, ne hissettim, ne öğrendim) bu hataları fark etmeyi kolaylaştırır."],
     "quiz": [
         {"q": "FOMO neyi ifade eder?", "options": ["Fırsatı kaçırma korkusu", "Bir teknik gösterge", "Bir emir tipi"], "answer": 0},
         {"q": "Kayıptan kaçınma eğilimi neye yol açabilir?", "options": ["Zarardaki pozisyonu gereğinden uzun tutmaya", "Daha çok temettüye"], "answer": 0},
         {"q": "Psikolojik hataları fark etmek için ne yardımcı olur?", "options": ["İşlem günlüğü tutmak", "Daha sık işlem yapmak"], "answer": 0}]},
]


def lessons(uid: int) -> list[dict]:
    with connect() as con:
        prog = {r["lesson"]: r for r in rows(con.execute("SELECT * FROM academy_progress WHERE user_id=?", (uid,)))}
    return [{k: v for k, v in l.items() if k != "quiz"} | {"questions": [{"q": q["q"], "options": q["options"]} for q in l["quiz"]],
            "score": prog.get(l["id"], {}).get("score"), "completed": l["id"] in prog} for l in LESSONS]


def submit_quiz(uid: int, lesson_id: str, answers: list[int]) -> dict:
    lesson = next((l for l in LESSONS if l["id"] == lesson_id), None)
    if not lesson:
        raise HTTPException(404, "Ders bulunamadı.")
    correct = [i for i, q in enumerate(lesson["quiz"]) if i < len(answers) and answers[i] == q["answer"]]
    score = round(len(correct) / len(lesson["quiz"]) * 100)
    if score >= 66:
        with connect() as con:
            con.execute("INSERT INTO academy_progress (user_id, lesson, score) VALUES (?,?,?) "
                        "ON CONFLICT(user_id, lesson) DO UPDATE SET score=MAX(score, excluded.score)", (uid, lesson_id, score))
    return {"score": score, "passed": score >= 66, "correct": correct, "answers": [q["answer"] for q in lesson["quiz"]]}


# ----------------------------------------------------------------------------- tahmin oyunu
GAME_SYMBOLS = {"XU100.IS": "BIST 100", "USDTRY=X": "Dolar/TL", "GRAM-ALTIN": "Gram altın", "^GSPC": "S&P 500", "BTC-USD": "Bitcoin"}


def _week_bounds(d: date) -> tuple[date, date]:
    monday = d - timedelta(days=d.weekday())
    return monday, monday + timedelta(days=4)


def _closes(symbol: str):
    df = market.to_frame(market.history(symbol, "3mo", "1d"))
    c = df["close"]
    c.index = c.index.normalize()
    return c[~c.index.duplicated(keep="last")]


def resolve() -> None:
    """Haftası biten tahminleri cuma kapanışına göre sonuçlandırır."""
    today = date.today()
    with connect() as con:
        open_ = rows(con.execute("SELECT * FROM predictions WHERE result IS NULL"))
    for p in open_:
        mon, fri = _week_bounds(date.fromisoformat(p["week"]))
        if today <= fri:  # cuma kapanışı kesinleşmeden sonuçlandırma
            continue
        try:
            c = _closes(p["symbol"])
            end = c[c.index <= pd.Timestamp(fri)]
            if end.empty:
                continue
            close = float(end.iloc[-1])
        except Exception:
            continue
        up = close > p["base_price"]
        ok = (p["direction"] == "up") == up
        with connect() as con:
            con.execute("UPDATE predictions SET result=?, end_price=?, points=? WHERE id=?", ("correct" if ok else "wrong", close, 10 if ok else 0, p["id"]))
        from . import notifications
        notifications.add(p["user_id"], "badge" if ok else "system", f"Tahmin {'doğru' if ok else 'yanlış'}: {GAME_SYMBOLS.get(p['symbol'], p['symbol'])}",
                          f"Haftayı {close:,.2f} ile kapattı ({'+10 puan' if ok else 'puan yok'}).", "/tahmin-oyunu")


def game_state(uid: int) -> dict:
    resolve()
    mon, fri = _week_bounds(date.today())
    with connect() as con:
        mine = rows(con.execute("SELECT * FROM predictions WHERE user_id=? ORDER BY week DESC, id DESC LIMIT 60", (uid,)))
        board = rows(con.execute("SELECT u.username, COALESCE(SUM(p.points),0) AS points, SUM(p.result='correct') AS correct, "
                                 "SUM(p.result IS NOT NULL) AS resolved FROM users u LEFT JOIN predictions p ON p.user_id=u.id "
                                 "GROUP BY u.id ORDER BY points DESC LIMIT 20"))
    this_week = {p["symbol"]: p for p in mine if p["week"] == mon.isoformat()}
    qs = {q["symbol"]: q for q in market.quotes(list(GAME_SYMBOLS))}
    cards = []
    for s, name in GAME_SYMBOLS.items():
        try:
            c = _closes(s)
            prev = c[c.index < pd.Timestamp(mon)]
            base = float(prev.iloc[-1]) if len(prev) else None
        except Exception:
            base = None
        price = qs.get(s, {}).get("price")
        cards.append({"symbol": s, "name": name, "base_price": base, "price": price,
                      "week_change_pct": (price / base - 1) * 100 if price and base else None, "prediction": this_week.get(s)})
    resolved = [p for p in mine if p["result"]]
    return {"week": mon.isoformat(), "week_end": fri.isoformat(), "can_predict": date.today() <= fri - timedelta(days=2), "cards": cards,
            "history": mine, "leaderboard": board, "points": sum(p["points"] or 0 for p in mine),
            "accuracy": (sum(p["result"] == "correct" for p in resolved) / len(resolved) * 100) if resolved else None}


def predict(uid: int, symbol: str, direction: str) -> None:
    if symbol not in GAME_SYMBOLS or direction not in ("up", "down"):
        raise HTTPException(400, "Geçersiz tahmin.")
    mon, fri = _week_bounds(date.today())
    if date.today() > fri - timedelta(days=2):
        raise HTTPException(400, "Bu haftanın tahminleri çarşamba akşamı kapandı; pazartesi yeni hafta başlar.")
    c = _closes(symbol)
    prev = c[c.index < pd.Timestamp(mon)]
    if prev.empty:
        raise HTTPException(400, "Başlangıç fiyatı bulunamadı.")
    with connect() as con:
        if con.execute("SELECT 1 FROM predictions WHERE user_id=? AND week=? AND symbol=?", (uid, mon.isoformat(), symbol)).fetchone():
            raise HTTPException(400, "Bu varlık için bu hafta zaten tahmin yaptınız.")
        con.execute("INSERT INTO predictions (user_id, week, symbol, direction, base_price) VALUES (?,?,?,?,?)",
                    (uid, mon.isoformat(), symbol, direction, float(prev.iloc[-1])))
