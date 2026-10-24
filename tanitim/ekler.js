/* TradeMetrix tanıtımı: bölümlü menü, "Kısaca" kutuları, sözlük ve etkileşimli ekler.
   tanitim.html içindeki ana betikten sonra yüklenir; oradaki yardımcıları ($, $$, sections, cur, go, openCode,
   KOD, SON, FILES, nf, lbShow, NOTES, DB, FEATS…) kullanır. */
(() => {
  const A0 = SON && SON.assets && SON.assets[0];
  const SER = A0 && A0.series ? A0.series.map(r => ({ t: r[0], o: r[1], h: r[2], l: r[3], c: r[4], v: r[5] })) : [];
  const trDate = (t, o = { day: "2-digit", month: "short", year: "numeric" }) => new Date(t * 1000).toLocaleDateString("tr", o);
  const pc = (v, d = 2) => (v > 0 ? "+" : v < 0 ? "−" : "") + "%" + nf(Math.abs(v), d);
  const fin = Number.isFinite;

  /* ---------- kapak istatistikleri (koddan) ---------- */
  if (KOD.files.length) {
    const grp = n => KOD.files.filter(f => f.group === n);
    const lines = l => KOD.files.filter(f => f.lang === l).reduce((s, f) => s + f.lines, 0);
    const approx = n => "~" + (Math.round(n / 100) * 100).toLocaleString("tr");
    $("#stRoutes").textContent = KOD.routes.length;
    $("#stMods").textContent = grp("Arka uç (FastAPI)").length;
    $("#stPages").textContent = grp("Arayüz: sayfalar").length;
    $("#stTables").textContent = KOD.schema.length;
    $("#stPy").textContent = approx(lines("py"));
    $("#stTs").textContent = approx(lines("ts"));
  }

  /* ---------- bölümlü menü ---------- */
  let navHtml = "", lastCh = "";
  sections.forEach((s, i) => {
    const ch = s.dataset.ch || "";
    if (ch !== lastCh) { lastCh = ch; navHtml += `<div class="chh">${ch}</div>`; }
    navHtml += `<button data-i="${i}"><span class="n">${i + 1}</span>${s.dataset.title}</button>`;
  });
  $("#navlist").innerHTML = navHtml;
  $$("#navlist button").forEach(b => b.onclick = () => go(+b.dataset.i));
  sections.forEach(s => {
    const h = s.querySelector("h2");
    if (h && s.dataset.ch) h.insertAdjacentHTML("beforebegin", `<div class="chlabel">Bölüm ${s.dataset.ch}</div>`);
  });
  const baseGo = window.go;
  window.go = i => {
    baseGo(i);
    const s = sections[cur];
    $("#crumb").textContent = `${cur + 1} / ${sections.length} · Bölüm ${s.dataset.ch} · ${s.dataset.title}`;
    const b = $$("#navlist button")[cur];
    if (b) b.scrollIntoView({ block: "nearest" });
  };

  /* ---------- "Kısaca" kutuları: her slaytın sade dille özeti ---------- */
  const KISACA = {
    "Problem ve amaç": ["Yatırımcının dağınık veri, pahalı araç ve \"kara kutu\" tahmin sorununa tek, Türkçe ve şeffaf bir platformla çözüm."],
    "Uygulamadan ekranlar": ["Anlatacağımız her şeyin kullanıcıya nasıl göründüğü: gerçek verilerle çalışan uygulamadan 10 ekran."],
    "Özellik haritası": ["Her ekran üç parçadan oluşur: kullanıcının gördüğü arayüz dosyası, sunucuya giden istekler ve hesaplamayı yapan Python modülleri.", "Bir binanın tesisat planı: hangi odada hangi priz var, kablosu hangi panoya gidiyor."],
    "Büyük resim: basit anlatım": ["Arayüz sadece gösterir; bütün hesaplama Python sunucusunda yapılır. İkisi API üzerinden konuşur.", "Restoran: salon arayüz, garson API, mutfak Python, kiler veritabanı, tedarikçi Yahoo Finance."],
    "Genel mimari": ["Üç katman: React arayüzü, FastAPI sunucusu ve veri katmanı. Şemadaki her kutu projede gerçek bir dosyadır.", "Bir şirketin organizasyon şeması: her departmanın görevi ve kime bağlı olduğu."],
    "Exe açılınca ne olur?": ["Exe'ye tıklanınca içeride önce görünmez bir web sunucusu başlar, sonra bu sunucuya bağlanan bir pencere açılır.", "Dükkânı açmadan önce mutfağın ocaklarını yakmak, sonra kapıyı müşteriye açmak."],
    "Bir isteğin yolculuğu": ["Bir tıklamanın sekiz adımlık yolculuğu: arayüz → kimlik kontrolü → önbellek → gerekirse Yahoo → hesaplama → ekrana çizim.", "Kargo takibi: paketin hangi aktarma merkezlerinden geçtiğini adım adım görmek."],
    "API kataloğu": ["Arayüzün sunucudan isteyebileceği her şeyin listesi. Her adrese bir Python fonksiyonu cevap verir.", "Restoranın menüsü: ne sipariş edilebilir ve onu hangi aşçı hazırlar."],
    "Veri toplama ve önbellek": ["Fiyatlar Yahoo Finance'ten gelir; aynı veriyi tekrar tekrar indirmemek için veritabanında bir süre saklanır.", "Her yemek için markete koşmak yerine önce buzdolabına bakmak."],
    "Veritabanı": ["Kullanıcıların bütün kayıtları (işlemler, emirler, alarmlar…) tek dosyalık bir SQLite veritabanında tutulur. Her kayıtta sahibinin numarası yazar.", "Konulara göre ayrılmış klasörleri olan bir dosya dolabı; her dosyanın köşesinde sahibinin numarası var."],
    "Teknik göstergeler": ["Gösterge, geçmiş fiyatlardan hesaplanan bir sayıdır; trendi ya da fiyatın aşırı uçlarda olup olmadığını özetler.", "Hastanın ateşi, nabzı, tansiyonu: tek başına teşhis koymaz ama durumu özetler."],
    "Strateji testi ve tarama": ["Bir al-sat kuralını geçmiş veride dener ve \"bu kuralı uygulasaydım kazanır mıydım?\" sorusunu cevaplar.", "Bir futbol taktiğini geçmiş maçların kayıtları üzerinde denemek."],
    "Yapay zekâ: fiyat tahmini": ["Model, bugünün 13 göstergesine bakarak yarın fiyatın yükselip yükselmeyeceğini tahmin eder. Geçmişin ilk %80'inden öğrenir, son %20'sinde sınanır.", "Öğrenciyi geçmiş yılların sorularıyla çalıştırıp hiç görmediği bu yılın sınavıyla ölçmek."],
    "Modeller nasıl öğrenir?": ["Altı yöntem aynı soruyu farklı yollarla cevaplar: kimi tek bir formül kurar, kimi yüzlerce küçük karar ağacını oylatır.", "Aynı soruyu bir istatistikçiye, 300 kişilik bir jüriye ve birbirinin hatasını düzelten editörlere sormak."],
    "Deney sonuçları": ["Gerçek veride modeller \"yarın da bugünkü gibi olur\" diyen basit referansı geçti; ama test dönemi kısa olduğu için farkların bir kısmı kesin değil."],
    "LLM asistanı ve duygu analizi": ["Claude API metin yazma ve yorumlama işlerinde kullanılır; anahtar yoksa aynı özellikler hazır kurallarla çalışır.", "Yanında danışmanı olan bir çalışan: danışman yokken de el kitabına bakarak işini yapabiliyor."],
    "Sanal hesap ve emirler": ["Kullanıcı 100.000 sanal TL ile gerçek fiyatlardan işlem yapar; takas, alım gücü ve emir kuralları gerçek bir aracı kurum gibidir.", "Uçuş simülatörü: kokpit gerçek, düşersen kimse zarar görmez."],
    "Arka plan motoru": ["Kullanıcı ekrana bakmasa da dakikada bir emirleri, botları ve alarmları kontrol eden görünmez bir döngü.", "Gece bekçisi: herkes uyurken düzenli aralıklarla tur atıp kapıları kontrol eder."],
    "Bildirim, rapor ve eğitim": ["Analiz dışındaki yardımcı sistemler: Windows ve Telegram bildirimleri, Excel/PDF raporları, yedekleme ve öğrenme modülleri."],
    "Kimlik doğrulama ve güvenlik": ["Şifreler geri çözülemeyecek şekilde özetlenerek saklanır. Giriş yapan kullanıcıya, her istekte gösterdiği imzalı bir jeton verilir.", "Konser bilekliği: kapıda bir kez kimlik gösterirsin, sonra sadece bilekliği gösterip girersin; bileklik taklit edilemez."],
    "Arayüz (React)": ["Ekranlar React bileşenlerinden kurulur; sayfa değişince sadece veri istenir, sayfa yeniden yüklenmez.", "Lego parçaları: aynı grafik ya da tablo parçası birçok ekranda tekrar kullanılır."],
    "Kullanılan teknolojiler": ["Tamamı açık kaynak araçlar: Python tarafında FastAPI, pandas, scikit-learn; arayüzde React ve TypeScript; masaüstünde pywebview."],
    "Paketleme (exe oluşturma)": ["Bütün program, Python yorumlayıcısı dahil, tek pakette toplanır; kullanıcının hiçbir şey kurması gerekmez.", "Kurulum gerektirmeyen hazır yemek kutusu: ısıt ve ye."],
    "Zorluklar ve çözümler": ["Projede karşılaşılan gerçek sorunlar ve her birinin kodda nasıl çözüldüğü."],
    "Sonuç ve değerlendirme": ["Çalışan, şeffaf ve genişletilebilir bir platform ortaya çıktı; sınırlılıklar ve sonraki adımlar belli."],
    "Web sürümüne geçiş": ["Mimari baştan istemci–sunucu kurulduğu için aynı kod küçük değişikliklerle bir web sitesi olarak yayınlanabilir."],
    "Kaynak kod gezgini": ["Sunumda anlatılan her şeyin gerçek kodu: dosyayı seç, fonksiyona tıkla, satıra git."],
  };
  sections.forEach(s => {
    const k = KISACA[s.dataset.title], h = s.querySelector("h2");
    if (!k || !h) return;
    const lead = s.querySelector(".lead");
    (lead || h).insertAdjacentHTML("afterend", `<div class="kisaca"><span class="ic">💡</span><p><b>Kısaca:</b> ${k[0]}</p>${k[1] ? `<p class="b">${k[1]}</p>` : ""}</div>`);
  });

  /* ---------- sözlük ---------- */
  // t: terim, c: kategori, d: açıklama, v: metinde aranacak diğer yazımlar, x: ek almadan tam eşleşme, n: metinde işaretleme
  const GL = [
    ["API", "Mimari", "Uygulama Programlama Arayüzü. Bir programın başka bir programdan \"bana şunu ver\" diyebildiği kurallar bütünü. Burada arayüz bütün verileri sunucudan API ile ister.", { v: ["REST API"] }],
    ["REST", "Mimari", "Web API'leri için yaygın bir tasarım tarzı: her kaynağın bir adresi vardır (ör. /api/portfolio) ve GET, POST gibi HTTP yöntemleriyle işlem yapılır."],
    ["Uç nokta", "Mimari", "API'deki tek bir adres ve yöntem çifti; ör. GET /api/history/THYAO.IS. İngilizcesi endpoint.", { v: ["endpoint"] }],
    ["HTTP", "Mimari", "Tarayıcı ile sunucunun konuştuğu protokol: istemci bir istek gönderir, sunucu bir yanıt ve durum kodu (200 başarılı, 401 yetkisiz…) döner."],
    ["JSON", "Mimari", "Verinin metin olarak taşındığı biçim: {\"fiyat\": 287.5, \"sembol\": \"THYAO\"}. Arayüz ile sunucu birbirine JSON gönderir."],
    ["İstemci–sunucu", "Mimari", "İşi ikiye bölen mimari: istemci (arayüz) ister ve gösterir; sunucu hesaplar ve veriyi saklar. Web siteleri de böyle çalışır.", { v: ["istemci-sunucu"] }],
    ["Sunucu", "Mimari", "İstekleri karşılayan program. Bu projede bilgisayarın içinde çalışan FastAPI uygulaması.", { n: 1 }],
    ["FastAPI", "Mimari", "Python ile REST API yazmaya yarayan modern kütüphane. Gelen veriyi otomatik doğrular ve API belgesini (Swagger) kendisi üretir."],
    ["Uvicorn", "Mimari", "FastAPI uygulamasını çalıştıran, gelen HTTP isteklerini ona ileten web sunucusu programı."],
    ["React", "Mimari", "Facebook'un geliştirdiği, arayüzü küçük ve yeniden kullanılabilir bileşenlerden kuran JavaScript kütüphanesi."],
    ["TypeScript", "Mimari", "Değişkenlerin türü (sayı, metin…) belirtilebilen JavaScript. Pek çok hatayı kod çalışmadan önce yakalar."],
    ["SPA", "Mimari", "Tek Sayfa Uygulaması: sayfa geçişlerinde tarayıcı sayfayı yeniden yüklemez, sadece yeni veri istenip ekranın ilgili kısmı güncellenir.", { v: ["tek sayfa uygulaması"] }],
    ["Bileşen", "Mimari", "React'te ekranın kendi başına çalışan bir parçası (grafik, tablo, buton). Aynı bileşen birçok sayfada kullanılabilir.", { v: ["bileşen"] }],
    ["Vite", "Mimari", "Arayüz kodunu geliştirme sırasında anında yenileyen, yayın için de küçültüp paketleyen derleme aracı."],
    ["İş parçacığı", "Mimari", "Bir programın içinde aynı anda çalışan ayrı iş kolu (thread). Sunucu ve arka plan motoru ayrı iş parçacıklarında çalışır, birbirini bekletmez.", { v: ["thread"] }],
    ["Port", "Mimari", "Bilgisayardaki bir programa ağ üzerinden ulaşılan kapı numarası. Uygulamanın sunucusu 8765 numaralı portu kullanır.", { x: 1 }],
    ["127.0.0.1", "Mimari", "\"Bu bilgisayarın kendisi\" anlamına gelen adres (localhost). Buraya bağlanan programa başka bilgisayarlardan erişilemez.", { v: ["localhost"], x: 1 }],
    ["pywebview", "Mimari", "Python'dan yerel bir pencere açıp içinde web sayfası gösteren kütüphane. Exe'nin penceresi bununla açılır."],
    ["WebView2", "Mimari", "Windows'ta yerleşik gelen, Microsoft Edge tabanlı web görüntüleme bileşeni. Ayrıca tarayıcı kurmaya gerek kalmaz."],
    ["PyInstaller", "Mimari", "Python programını, Python kurulu olmayan bilgisayarlarda çalışan bir exe'ye dönüştüren paketleme aracı."],
    ["Önbellek", "Mimari", "Sık kullanılan verinin, her seferinde uzaktan çekmemek için yakında tutulan kopyası (cache). Süresi dolunca yenilenir.", { v: ["cache"] }],
    ["Devre kesici", "Mimari", "Bir dış servis hata vermeye başlayınca bir süre ona istek göndermeyi durduran koruma deseni (circuit breaker)."],
    ["Pydantic", "Mimari", "Gelen verinin doğru türde ve aralıkta olduğunu (ör. tutar > 0) otomatik kontrol eden Python kütüphanesi."],
    ["Swagger", "Mimari", "API'nin otomatik oluşturulan, tarayıcıda denenebilen belgesi. Geliştirme modunda /docs adresinde açılır."],
    ["CORS", "Mimari", "Tarayıcının, bir sayfanın başka bir adresteki API'ye erişip erişemeyeceğine karar verdiği güvenlik kuralı."],
    ["İş kuyruğu", "Mimari", "Uzun süren işleri arka planda sırayla ve gerekirse birden fazla sunucuda çalıştıran sistem (Celery, RQ gibi).", { v: ["Celery"] }],
    ["Veritabanı", "Veri", "Verilerin düzenli biçimde saklandığı ve sorgulandığı sistem.", { n: 1 }],
    ["SQLite", "Veri", "Sunucu kurulumu gerektirmeyen, bütün veritabanını tek bir dosyada tutan hafif veritabanı."],
    ["PostgreSQL", "Veri", "Çok kullanıcılı web uygulamaları için güçlü, sunucu tabanlı açık kaynak veritabanı."],
    ["SQL", "Veri", "Veritabanından veri sorgulamak ve değiştirmek için kullanılan dil: SELECT * FROM orders WHERE user_id = 1.", { x: 1 }],
    ["Birincil anahtar", "Veri", "Bir tablodaki her satırı benzersiz biçimde tanımlayan sütun (genellikle id).", { v: ["PK"] }],
    ["Yabancı anahtar", "Veri", "Bir tablodaki sütunun başka bir tablonun satırına işaret etmesi; ör. orders.user_id → users.id. Kullanıcı silinince ona bağlı kayıtlar da silinir.", { v: ["FK"] }],
    ["yfinance", "Veri", "Yahoo Finance'ten fiyat ve şirket verisi çekmeye yarayan açık kaynak Python kütüphanesi."],
    ["RSS", "Veri", "Haber sitelerinin yeni içeriklerini makinelerin okuyabileceği biçimde yayımladığı akış. Google Haberler buradan okunur.", { x: 1 }],
    ["pandas", "Veri", "Python'da tablo ve zaman serisi verisiyle çalışmanın standart kütüphanesi. Göstergeler bununla hesaplanır."],
    ["Teknik analiz", "Analiz", "Geleceği tahmin etmek için yalnızca fiyat ve hacim geçmişine (grafiklere) bakan yaklaşım."],
    ["Temel analiz", "Analiz", "Şirketin bilançosuna, kârlılığına ve borçluluğuna bakarak değerini anlamaya çalışan yaklaşım."],
    ["Gösterge", "Analiz", "Fiyat geçmişinden bir formülle hesaplanan ve piyasanın durumunu özetleyen sayı (RSI, MACD gibi).", { n: 1 }],
    ["SMA", "Analiz", "Basit hareketli ortalama: son n günün kapanış fiyatlarının ortalaması. Trendi gösterir, günlük gürültüyü yumuşatır.", { v: ["hareketli ortalama"] }],
    ["EMA", "Analiz", "Üssel hareketli ortalama: son günlere daha fazla ağırlık veren ortalama; fiyat değişimine SMA'dan hızlı tepki verir."],
    ["RSI", "Analiz", "Göreceli Güç Endeksi (0–100). Son 14 günde yükselişlerin düşüşlere oranını ölçer: 70 üstü aşırı alım, 30 altı aşırı satım."],
    ["MACD", "Analiz", "12 ve 26 günlük üssel ortalamaların farkı. 9 günlük ortalaması (sinyal çizgisi) ile kesişmesi momentumun değiştiğini gösterir."],
    ["Bollinger bantları", "Analiz", "20 günlük ortalamanın 2 standart sapma üstü ve altında çizilen bantlar. Fiyatın normalde ne kadar oynadığını gösterir.", { v: ["Bollinger"] }],
    ["ATR", "Analiz", "Ortalama Gerçek Aralık: bir varlığın günde ortalama ne kadar oynadığını ölçer; zarar durdur seviyesi önermek için kullanılır.", { x: 1 }],
    ["Destek / direnç", "Analiz", "Fiyatın geçmişte düşüşte durduğu (destek) veya yükselişte takıldığı (direnç) seviyeler.", { v: ["destek-direnç", "destek/direnç"] }],
    ["Mum grafiği", "Analiz", "Her günü açılış, en yüksek, en düşük ve kapanış fiyatlarıyla bir 'mum' olarak gösteren grafik türü.", { v: ["mum"] , x: 1 }],
    ["Formasyon", "Analiz", "Grafikte tekrar eden ve belirli bir hareketin habercisi sayılan şekil (çekiç, yutan boğa, kayan yıldız…)."],
    ["Strateji testi", "Analiz", "Bir al-sat kuralını geçmiş veride uygulayıp sonucunu ölçmek (backtest).", { v: ["backtest", "geri test"] }],
    ["Al-Tut", "Analiz", "Başta alıp sonuna kadar hiç satmama stratejisi. Diğer stratejilerin kıyaslandığı referanstır.", { x: 1 }],
    ["Sharpe oranı", "Analiz", "Getirinin aldığı riske (oynaklığa) oranı. Yüksekse, getiri az dalgalanmayla elde edilmiş demektir.", { v: ["Sharpe"] }],
    ["Maksimum düşüş", "Analiz", "Bir yatırımın zirvesinden sonraki en büyük değer kaybı (yüzde). Yaşanabilecek en kötü dönemi gösterir.", { v: ["maks. düşüş"] }],
    ["İleriye bakma hatası", "Analiz", "Testte, o anda bilinemeyecek bir bilgiyi (ör. günün kapanış fiyatını gün içinde) kullanmak. Sonuçları gerçekte olduğundan iyi gösterir.", { v: ["ileriye bakma"] }],
    ["Oynaklık", "Analiz", "Fiyatın ne kadar dalgalandığı; genellikle günlük getirilerin standart sapmasıyla ölçülür (volatilite)."],
    ["Getiri", "Analiz", "Bir yatırımın yüzde olarak değer değişimi. Günlük getiri = bugünkü fiyat / dünkü fiyat − 1.", { n: 1 }],
    ["Monte Carlo", "Analiz", "Binlerce rastgele senaryo üretip olası sonuçların dağılımını görme yöntemi; portföy riskini ölçmek için kullanılır."],
    ["Etkin sınır", "Analiz", "Her risk seviyesinde elde edilebilecek en yüksek getiriyi veren portföy dağılımlarının oluşturduğu eğri."],
    ["Makine öğrenmesi", "Yapay zekâ", "Bilgisayarın kuralları elle yazılmadan, örneklerden kendi kendine çıkarması."],
    ["Model", "Yapay zekâ", "Örneklerden öğrenilmiş ve yeni verilere tahmin yapabilen matematiksel yapı.", { n: 1 }],
    ["Öznitelik", "Yapay zekâ", "Modele verilen girdi sütunlarından her biri (feature). Bu projede 13 tane: RSI, getiriler, ortalamalara uzaklık…"],
    ["Eğitim", "Yapay zekâ", "Modelin geçmiş örneklere bakarak parametrelerini (ağırlıklarını) ayarladığı aşama.", { n: 1 }],
    ["Test kümesi", "Yapay zekâ", "Modelin eğitimde hiç görmediği, başarısını ölçmek için ayrılan veri. Burada son %20'lik dönem.", { v: ["test verisi", "test dönemi"] }],
    ["Veri sızıntısı", "Yapay zekâ", "Eğitime, gerçekte o anda bilinemeyecek bilginin (ör. gelecek günlerin) karışması. Model sınavda soruları önceden görmüş gibi olur."],
    ["Aşırı öğrenme", "Yapay zekâ", "Modelin genel kuralı değil, eğitim verisindeki tesadüfleri ezberlemesi (overfitting). Eğitimde çok iyi, yeni veride kötü sonuç verir.", { v: ["overfitting", "ezberleme"] }],
    ["Naif model", "Yapay zekâ", "\"Yarın da bugün gibi olur\" diyen, hiçbir şey öğrenmeyen referans model. Gerçek modellerin geçmesi gereken alt çıta.", { v: ["naif referans", "naif modeli", "naif modelle", "naif modele"] }],
    ["Sınıflandırma", "Yapay zekâ", "Sonucun bir kategori olduğu tahmin türü; burada \"yükselir mi, düşer mi?\""],
    ["Regresyon", "Yapay zekâ", "Sonucun bir sayı olduğu tahmin türü; burada \"yüzde kaç değişir?\"", { n: 1 }],
    ["Yön doğruluğu", "Yapay zekâ", "Modelin yükseliş/düşüş yönünü doğru bildiği günlerin oranı. %50 yazı-tura düzeyidir."],
    ["MAE", "Yapay zekâ", "Ortalama Mutlak Hata: tahminin gerçekten ortalama ne kadar saptığı.", { x: 1 }],
    ["RMSE", "Yapay zekâ", "Kök Ortalama Kare Hata: büyük hataları daha çok cezalandıran hata ölçüsü.", { x: 1 }],
    ["Lojistik regresyon", "Yapay zekâ", "Girdilerin ağırlıklı toplamını S şeklinde bir eğriden geçirip 0–1 arası olasılığa çeviren sınıflandırma modeli.", { v: ["Lojistik"] }],
    ["Ridge", "Yapay zekâ", "Aşırı büyük ağırlıkları cezalandıran doğrusal regresyon. Lojistik regresyonun sayı tahmini yapan karşılığı olarak kullanıldı.", { x: 1 }],
    ["Karar ağacı", "Yapay zekâ", "Evet/hayır sorularıyla dallanarak karar veren model: \"RSI < 30 mu? → Evet → …\""],
    ["Rastgele Orman", "Yapay zekâ", "Her biri verinin farklı bir parçasını gören yüzlerce karar ağacının oylamasıyla karar veren model (Random Forest)."],
    ["Gradyan Artırma", "Yapay zekâ", "Ağaçları sırayla kuran, her yeni ağacın öncekilerin hatalarını düzelttiği model (Gradient Boosting, XGBoost benzeri)."],
    ["Yapay sinir ağı", "Yapay zekâ", "Katmanlar hâlinde bağlanmış 'nöronlardan' oluşan, ağırlıkları hatayı azaltacak yönde güncellenerek eğitilen model.", { v: ["MLP"] }],
    ["ARIMA", "Yapay zekâ", "Bir zaman serisinin bugünkü değerini kendi geçmiş değerleri ve geçmiş tahmin hatalarıyla açıklayan klasik istatistiksel model."],
    ["LSTM", "Yapay zekâ", "Zaman serileri için tasarlanmış, neyi hatırlayıp neyi unutacağına kendisi karar veren bir sinir ağı türü."],
    ["AIC", "Yapay zekâ", "Akaike Bilgi Ölçütü: modelin veriye uyumunu ve karmaşıklığını birlikte değerlendirir; küçük olan tercih edilir.", { x: 1 }],
    ["Güven aralığı", "Yapay zekâ", "Ölçülen değerin, verinin azlığı nedeniyle hangi aralıkta olabileceği. %58 ±10 demek, gerçek başarının %48–68 arasında olabileceği demek."],
    ["Düzenlileştirme", "Yapay zekâ", "Modelin aşırı karmaşıklaşmasını cezalandırarak ezberlemesini önleyen teknik (regularization)."],
    ["Erken durdurma", "Yapay zekâ", "Eğitim sırasında, ayrılmış bir doğrulama verisinde hata artmaya başlayınca eğitimi durdurmak."],
    ["Kayan pencere doğrulama", "Yapay zekâ", "Modeli zaman içinde ilerleyen pencerelerle defalarca eğitip test etmek (walk-forward). Tek bir test döneminden daha güvenilir sonuç verir.", { v: ["walk-forward"] }],
    ["LLM", "Yapay zekâ", "Büyük Dil Modeli: çok büyük metin verisiyle eğitilmiş, metin anlayıp üretebilen yapay zekâ (Claude, GPT gibi).", { v: ["büyük dil modeli"] }],
    ["Duygu analizi", "Yapay zekâ", "Bir metnin olumlu mu olumsuz mu olduğunu otomatik belirlemek."],
    ["Bağlam ekleme", "Yapay zekâ", "LLM'e soruyla birlikte gerçek verileri de göndermek; böylece model uydurmak yerine verilen sayılar üzerinden cevap verir (grounding).", { v: ["grounding"] }],
    ["JWT", "Güvenlik", "JSON Web Token: sunucunun gizli anahtarıyla imzaladığı, kullanıcının kim olduğunu ve ne zamana kadar geçerli olduğunu taşıyan dijital jeton.", { v: ["jeton"] }],
    ["Özet (hash)", "Güvenlik", "Bir metni geri çözülemeyecek sabit uzunlukta bir parmak izine dönüştürmek. Şifreler açık değil, özeti saklanır.", { v: ["hash", "özetlenir", "özetlenerek"] }],
    ["Tuz", "Güvenlik", "Her kullanıcıya özel rastgele değer (salt). Şifreyle birlikte özetlenir; böylece aynı şifreye sahip iki kullanıcının özeti farklı olur.", { v: ["salt"], x: 1 }],
    ["PBKDF2", "Güvenlik", "Şifre özetini kasıtlı olarak yavaşlatan algoritma (burada 200.000 tur). Tahmin denemelerini çok pahalı hâle getirir."],
    ["Kaba kuvvet saldırısı", "Güvenlik", "Şifreyi bulmak için olası bütün şifreleri tek tek denemek."],
    ["HMAC", "Güvenlik", "Bir mesajın gizli bir anahtarla imzalanması; imza, anahtarı bilmeyen biri tarafından taklit edilemez.", { x: 1 }],
    ["BIST", "Finans", "Borsa İstanbul. Türkiye'nin menkul kıymet borsası; BIST 100 en büyük 100 şirketin endeksidir.", { x: 1 }],
    ["KAP", "Finans", "Kamuyu Aydınlatma Platformu: borsa şirketlerinin resmi açıklamalarını yayımladığı sistem.", { x: 1 }],
    ["SPK", "Finans", "Sermaye Piyasası Kurulu: halka arzları onaylayan ve borsayı denetleyen kurum.", { x: 1 }],
    ["Halka arz", "Finans", "Bir şirketin hisselerini ilk kez borsada satışa sunması."],
    ["Temettü", "Finans", "Şirketin kârının bir kısmını hissedarlarına nakit olarak dağıtması (kâr payı)."],
    ["Takas", "Finans", "Alım satımdan sonra para ve hissenin el değiştirmesi. Borsa İstanbul'da işlemden iki iş günü sonra (T+2) gerçekleşir.", { v: ["T+2"] }],
    ["Alım gücü", "Finans", "Yeni alım için kullanılabilecek tutar. Türk aracı kurumlarında olduğu gibi T2 bakiyesi esas alınır."],
    ["Limit emir", "Finans", "\"Fiyat şu seviyeye gelince işlem yap\" talimatı.", { v: ["limit alış"] }],
    ["Zarar durdur", "Finans", "Fiyat belirli bir seviyenin altına düşerse otomatik satış yapan emir (stop-loss)."],
    ["Kâr al", "Finans", "Fiyat belirli bir seviyenin üstüne çıkarsa otomatik satış yapan emir (take-profit).", { x: 1 }],
    ["F/K", "Finans", "Fiyat/Kazanç oranı: hisse fiyatının hisse başına yıllık kâra oranı. Kabaca, şirketin bugünkü kârıyla kendi fiyatını kaç yılda çıkaracağını gösterir.", { x: 1 }],
    ["PD/DD", "Finans", "Piyasa değerinin defter (öz sermaye) değerine oranı.", { x: 1 }],
    ["Portföy", "Finans", "Bir yatırımcının sahip olduğu varlıkların toplamı.", { n: 1 }],
    ["Endeks", "Finans", "Bir grup hissenin ortalama performansını gösteren gösterge (BIST 100, S&P 500).", { n: 1 }],
  ];
  const GLM = GL.map(([t, c, d, o = {}]) => ({ t, c, d, ...o }));

  // metindeki ilk geçişleri işaretle (her slaytta her terim bir kez)
  const esc2 = s => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  const termRx = GLM.filter(g => !g.n).flatMap(g => [g.t, ...(g.v || [])].map(w => {
    const abbr = /^[A-ZÇĞİÖŞÜ0-9./+\-]+$/.test(w) || g.x;
    return { g, rx: new RegExp(`(?<![\\p{L}\\d_])${esc2(w)}${abbr ? "(?:'\\p{L}+)?" : "\\p{L}*"}(?![\\p{L}\\d_])`, abbr ? "u" : "iu"), len: w.length };
  })).sort((a, b) => b.len - a.len);
  const SKIP = "code, pre, a, button, input, svg, h1, h2, h3, h4, script, style, textarea, .term, .chlabel, [hidden], .mono, " +
    // tıklamayla yeniden çizilen paneller: işaretler kaybolup tutarsız görünmesin diye dokunulmaz
    "#fmDetail, #fmList, #dbDetail, #mlText, #apiTable, #btStats, #resBars, #resImp, #resBt, #indExplain, #indRead, #detail, " +
    "#ordLog, #restMsg, #reqCode, #bootMsg, #ftree, #chead, #syms, #lbCap, #newsOut, #pwOut, #modelInfo, #reqSteps";
  function markTerms(root) {
    const done = new Set();
    for (const { g, rx } of termRx) {
      if (done.has(g.t)) continue;
      const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode: n => n.parentElement.closest(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,  // SVG içindeki yazılara dokunulmaz
      });
      for (let n; (n = w.nextNode());) {
        const m = rx.exec(n.nodeValue);
        if (!m) continue;
        const after = n.splitText(m.index);
        after.splitText(m[0].length);
        const span = document.createElement("span");
        span.className = "term"; span.dataset.t = g.t; span.textContent = after.nodeValue;
        after.replaceWith(span);
        done.add(g.t);
        break;
      }
    }
  }
  const tip = $("#tip"), GLBY = Object.fromEntries(GLM.map(g => [g.t, g]));
  document.addEventListener("mouseover", e => {
    const el = e.target.closest(".term"); if (!el) return;
    const g = GLBY[el.dataset.t];
    tip.innerHTML = `<b>${g.t}</b>${g.d}`; tip.style.display = "block";
  });
  document.addEventListener("mousemove", e => {
    if (tip.style.display !== "block") return;
    const x = Math.min(e.clientX + 14, innerWidth - 360), y = e.clientY + 18 + tip.offsetHeight > innerHeight ? e.clientY - tip.offsetHeight - 12 : e.clientY + 18;
    tip.style.left = x + "px"; tip.style.top = y + "px";
  });
  document.addEventListener("mouseout", e => { if (e.target.closest(".term")) tip.style.display = "none"; });

  // sözlük slaytı
  let glCat = "Tümü";
  function renderGlossary() {
    const q = ($("#glQ").value || "").trim().toLocaleLowerCase("tr");
    const cats = ["Tümü", ...new Set(GLM.map(g => g.c))];
    $("#glCats").innerHTML = cats.map(c => `<button class="chip${c === glCat ? " on" : ""}" data-c="${c}">${c}<small>${c === "Tümü" ? GLM.length : GLM.filter(g => g.c === c).length}</small></button>`).join("");
    const list = GLM.filter(g => (glCat === "Tümü" || g.c === glCat) && (!q || (g.t + " " + g.d + " " + (g.v || []).join(" ")).toLocaleLowerCase("tr").includes(q)))
      .sort((a, b) => a.t.localeCompare(b.t, "tr"));
    $("#glList").innerHTML = list.map(g => `<div class="card"><small>${g.c}</small><b>${g.t}</b><p>${g.d}</p></div>`).join("") || `<p style="color:var(--muted)">Sonuç yok.</p>`;
    $("#glCount").textContent = `${list.length} terim`;
  }
  $("#glQ").oninput = renderGlossary;
  $("#glCats").onclick = e => { const b = e.target.closest(".chip"); if (b) { glCat = b.dataset.c; renderGlossary(); } };
  renderGlossary();

  /* ---------- SVG yardımcıları ---------- */
  const yScale = (vals, top, h, pad = 0.06) => {
    const f = vals.filter(fin); let mn = Math.min(...f), mx = Math.max(...f);
    const p = (mx - mn) * pad || 1; mn -= p; mx += p;
    const Y = v => top + (1 - (v - mn) / (mx - mn)) * h; Y.mn = mn; Y.mx = mx; return Y;
  };
  const pathOf = (vals, X, Y) => {
    let d = "", pen = false;
    vals.forEach((v, i) => { if (!fin(v)) { pen = false; return; } d += (pen ? "L" : "M") + X(i).toFixed(1) + "," + Y(v).toFixed(1); pen = true; });
    return d;
  };
  const axisY = (Y, x0, x1, ticks, fmt) => ticks.map(v => `<line x1="${x0}" x2="${x1}" y1="${Y(v)}" y2="${Y(v)}" stroke="#1f2c47"/><text x="${x0 - 6}" y="${Y(v) + 4}" text-anchor="end">${fmt(v)}</text>`).join("");
  const niceTicks = (Y, n = 4) => { const out = []; for (let i = 0; i <= n; i++) out.push(Y.mn + (Y.mx - Y.mn) * (i / n)); return out.slice(1, -1); };

  /* ---------- gösterge hesapları (indicators.py ile aynı formüller) ---------- */
  const smaA = (a, n) => a.map((_, i) => { if (i < n - 1) return NaN; let s = 0; for (let j = i - n + 1; j <= i; j++) s += a[j]; return s / n; });
  const emaA = (a, n) => { const k = 2 / (n + 1), o = []; a.forEach((v, i) => o.push(i ? k * v + (1 - k) * o[i - 1] : v)); return o; };
  const stdA = (a, n) => a.map((_, i) => { if (i < n - 1) return NaN; const w = a.slice(i - n + 1, i + 1), m = w.reduce((s, x) => s + x, 0) / n; return Math.sqrt(w.reduce((s, x) => s + (x - m) ** 2, 0) / (n - 1)); });
  const rsiA = (a, n = 14) => {
    const o = [NaN]; let g = null, l = null;
    for (let i = 1; i < a.length; i++) {
      const d = a[i] - a[i - 1], up = Math.max(d, 0), dn = Math.max(-d, 0);
      g = g === null ? up : up / n + g * (1 - 1 / n); l = l === null ? dn : dn / n + l * (1 - 1 / n);
      o.push(i < n ? NaN : l === 0 ? 100 : 100 - 100 / (1 + g / l));
    }
    return o;
  };

  /* ---------- teknik göstergeler slaytı ---------- */
  if (SER.length) {
    const C = SER.map(r => r.c), N = C.length;
    const IND2 = { sma20: smaA(C, 20), sma50: smaA(C, 50), mid: smaA(C, 20), sd: stdA(C, 20), rsi: rsiA(C) };
    const e12 = emaA(C, 12), e26 = emaA(C, 26); IND2.macd = e12.map((v, i) => v - e26[i]); IND2.sig = emaA(IND2.macd, 9);
    IND2.up = IND2.mid.map((m, i) => m + 2 * IND2.sd[i]); IND2.lo = IND2.mid.map((m, i) => m - 2 * IND2.sd[i]);
    const last = N - 1;
    const TG = {
      sma: { n: "Ortalamalar (SMA 20/50)", on: true,
        d: () => `<h3>Hareketli ortalamalar</h3><p><b>Ne?</b> Son 20 (mavi) ve 50 (mor) günün kapanış fiyatlarının ortalaması. Günlük dalgalanmayı yumuşatıp asıl eğilimi gösterir.</p><p style="margin-top:8px"><b>Nasıl okunur?</b> Fiyat ortalamanın üstündeyse eğilim yukarı. Kısa ortalama uzun ortalamayı <b>yukarı</b> keserse "altın kesişim" (al sinyali), <b>aşağı</b> keserse "ölüm kesişimi" denir.</p><p style="margin-top:8px"><b>Şu an:</b> Fiyat 20 günlük ortalamanın ${pc((C[last] / IND2.sma20[last] - 1) * 100, 1)} ${C[last] >= IND2.sma20[last] ? "üstünde" : "altında"}, 50 günlüğün ${pc((C[last] / IND2.sma50[last] - 1) * 100, 1)} ${C[last] >= IND2.sma50[last] ? "üstünde" : "altında"}.</p>` },
      bb: { n: "Bollinger bantları", on: false,
        d: () => { const p = (C[last] - IND2.lo[last]) / (IND2.up[last] - IND2.lo[last]); return `<h3>Bollinger bantları</h3><p><b>Ne?</b> Ortada 20 günlük ortalama; üst ve alt bantlar bu ortalamanın 2 standart sapma uzağında. Fiyat zamanın büyük kısmında bu bantların içinde kalır.</p><p style="margin-top:8px"><b>Nasıl okunur?</b> Bantlar genişliyorsa piyasa hareketlendi. Fiyat alt banda değerse "fazla düştü", üst banda değerse "fazla yükseldi" diye yorumlanır.</p><p style="margin-top:8px"><b>Şu an:</b> Fiyat bandın %${nf(p * 100, 0)} seviyesinde (0 = alt bant, 100 = üst bant). Bu değer YZ modelindeki <code>bb_pos</code> özniteliğidir.</p>`; } },
      rsi: { n: "RSI", on: true,
        d: () => { const r = IND2.rsi[last]; return `<h3>RSI (Göreceli Güç Endeksi)</h3><p><b>Ne?</b> Son 14 günde yükseliş günlerinin düşüş günlerine göre ne kadar güçlü olduğunu 0–100 arasında ölçer.</p><p style="margin-top:8px"><b>Nasıl okunur?</b> <b>70 üstü</b> "aşırı alım": çok hızlı yükseldi, düzeltme gelebilir. <b>30 altı</b> "aşırı satım": çok hızlı düştü, tepki gelebilir. Arası nötr.</p><p style="margin-top:8px"><b>Şu an:</b> RSI ${nf(r, 1)}: ${r > 70 ? "aşırı alım bölgesinde" : r < 30 ? "aşırı satım bölgesinde" : "nötr bölgede"}.</p>`; } },
      macd: { n: "MACD", on: false,
        d: () => `<h3>MACD</h3><p><b>Ne?</b> 12 ve 26 günlük üssel ortalamaların farkı (mavi çizgi) ve bu farkın 9 günlük ortalaması (turuncu sinyal çizgisi). Çubuklar ikisi arasındaki fark.</p><p style="margin-top:8px"><b>Nasıl okunur?</b> Mavi çizgi turuncuyu <b>yukarı</b> keserse yükseliş ivmesi artıyor (al sinyali), aşağı keserse azalıyor.</p><p style="margin-top:8px"><b>Şu an:</b> MACD çizgisi sinyal çizgisinin ${IND2.macd[last] >= IND2.sig[last] ? "üstünde (olumlu)" : "altında (olumsuz)"}.</p>` },
    };
    let focus = "rsi";
    const W = 860, X = i => 54 + i / (N - 1) * (W - 64);
    function drawInd() {
      $("#indToggles").innerHTML = Object.entries(TG).map(([k, t]) => `<button class="chip${t.on ? " on" : ""}" data-k="${k}">${t.on ? "✓ " : ""}${t.n}</button>`).join("");
      let y = 8, svg = "";
      const pH = 250, Yp = yScale([...C, ...(TG.bb.on ? [...IND2.up, ...IND2.lo] : [])], y, pH);
      svg += axisY(Yp, 54, W - 10, niceTicks(Yp), v => nf(v, 0));
      if (TG.bb.on) {
        const top = IND2.up.map((v, i) => fin(v) ? `${X(i).toFixed(1)},${Yp(v).toFixed(1)}` : null).filter(Boolean);
        const bot = IND2.lo.map((v, i) => fin(v) ? `${X(i).toFixed(1)},${Yp(v).toFixed(1)}` : null).filter(Boolean).reverse();
        svg += `<polygon points="${top.join(" ")} ${bot.join(" ")}" fill="#38bdf81a" stroke="none"/><path d="${pathOf(IND2.up, X, Yp)}" stroke="#38bdf880" fill="none"/><path d="${pathOf(IND2.lo, X, Yp)}" stroke="#38bdf880" fill="none"/>`;
      }
      svg += `<path d="${pathOf(C, X, Yp)}" stroke="#cbd5e1" stroke-width="1.6" fill="none"/>`;
      if (TG.sma.on) svg += `<path d="${pathOf(IND2.sma20, X, Yp)}" stroke="#38bdf8" stroke-width="1.6" fill="none"/><path d="${pathOf(IND2.sma50, X, Yp)}" stroke="#a78bfa" stroke-width="1.6" fill="none"/>`;
      svg += `<text x="58" y="${y + 14}" style="fill:#e6ecf7">THYAO kapanış (₺)</text>`;
      y += pH + 22;
      const panels = [];
      if (TG.rsi.on) {
        const Yr = v => y + (1 - v / 100) * 80;
        svg += `<rect x="54" y="${Yr(70)}" width="${W - 64}" height="${Yr(30) - Yr(70)}" fill="#a78bfa14"/>` + axisY(Yr, 54, W - 10, [30, 70], v => v) +
          `<path d="${pathOf(IND2.rsi, X, Yr)}" stroke="#a78bfa" stroke-width="1.4" fill="none"/><text x="58" y="${y + 12}" style="fill:#e6ecf7">RSI (14)</text>`;
        panels.push(["rsi", y]); y += 80 + 22;
      }
      if (TG.macd.on) {
        const hist = IND2.macd.map((v, i) => v - IND2.sig[i]), Ym = yScale([...IND2.macd, ...IND2.sig].slice(30), y, 80);
        svg += axisY(Ym, 54, W - 10, [0], () => "0") + hist.map((h, i) => i < 30 ? "" : `<line x1="${X(i)}" x2="${X(i)}" y1="${Ym(0)}" y2="${Ym(h)}" stroke="${h >= 0 ? "#22c55e88" : "#f43f5e88"}"/>`).join("") +
          `<path d="${pathOf(IND2.macd.map((v, i) => i < 30 ? NaN : v), X, Ym)}" stroke="#38bdf8" stroke-width="1.4" fill="none"/><path d="${pathOf(IND2.sig.map((v, i) => i < 30 ? NaN : v), X, Ym)}" stroke="#f59e0b" stroke-width="1.2" fill="none"/><text x="58" y="${y + 12}" style="fill:#e6ecf7">MACD (12, 26, 9)</text>`;
        y += 80 + 22;
      }
      svg += `<text x="54" y="${y - 6}">${trDate(SER[0].t)}</text><text x="${W - 10}" y="${y - 6}" text-anchor="end">${trDate(SER[N - 1].t)}</text>`;
      svg += `<line id="indCross" x1="0" x2="0" y1="8" y2="${y - 20}" stroke="#f59e0b" stroke-dasharray="3 3" visibility="hidden"/><rect id="indHit" x="54" y="0" width="${W - 64}" height="${y}" fill="transparent"/>`;
      $("#indChart").innerHTML = `<svg viewBox="0 0 ${W} ${y}" width="100%">${svg}</svg>`;
      $("#indExplain").innerHTML = TG[focus].d();
      const svgEl = $("#indChart svg");
      $("#indHit").onmousemove = e => {
        const r = svgEl.getBoundingClientRect(), sx = (e.clientX - r.left) / r.width * W;
        const i = Math.max(0, Math.min(N - 1, Math.round((sx - 54) / (W - 64) * (N - 1))));
        const cr = $("#indCross"); cr.setAttribute("x1", X(i)); cr.setAttribute("x2", X(i)); cr.setAttribute("visibility", "visible");
        const rv = IND2.rsi[i];
        $("#indRead").innerHTML = `<b>${trDate(SER[i].t, { day: "2-digit", month: "long", year: "numeric" })}</b> · Kapanış <b>${nf(C[i])} ₺</b>` +
          (fin(IND2.sma20[i]) ? ` · SMA20 <b>${nf(IND2.sma20[i])}</b>` : "") + (fin(IND2.sma50[i]) ? ` · SMA50 <b>${nf(IND2.sma50[i])}</b>` : "") +
          (fin(rv) ? ` · RSI <b>${nf(rv, 1)}</b> (${rv > 70 ? "aşırı alım" : rv < 30 ? "aşırı satım" : "nötr"})` : "") +
          ` · MACD ${IND2.macd[i] >= IND2.sig[i] ? "sinyalin <b>üstünde</b>" : "sinyalin <b>altında</b>"}`;
      };
      $("#indHit").onmouseleave = () => $("#indCross").setAttribute("visibility", "hidden");
    }
    $("#indToggles").onclick = e => {
      const b = e.target.closest(".chip"); if (!b) return;
      const t = TG[b.dataset.k]; t.on = !t.on; if (t.on) focus = b.dataset.k; else if (focus === b.dataset.k) focus = Object.keys(TG).find(k => TG[k].on) || b.dataset.k;
      drawInd();
    };
    drawInd();

    /* ---------- strateji testi (backtest.py ile aynı mantık) ---------- */
    function runBt(fast, slow) {
      const sf = smaA(C, fast), ss = smaA(C, slow);
      const raw = C.map((_, i) => fin(sf[i]) && fin(ss[i]) && sf[i] > ss[i] ? 1 : 0);
      const pos = raw.map((_, i) => i ? raw[i - 1] : 0);  // sinyal ertesi gün uygulanır
      const eq = [], bh = []; let e = 10000, b = 10000, peak = 10000, dd = 0;
      for (let i = 0; i < N; i++) {
        const ret = i ? C[i] / C[i - 1] - 1 : 0, flag = i ? Math.abs(pos[i] - pos[i - 1]) : pos[0];
        e *= 1 + pos[i] * ret - flag * 0.001; b *= 1 + ret - (i === 1 ? 0.001 : 0);  // Al-Tut da ilk alımda komisyon öder
        eq.push(e); bh.push(b); peak = Math.max(peak, e); dd = Math.min(dd, e / peak - 1);
      }
      const trades = []; let entry = null;
      for (let i = 0; i < N; i++) {
        const prev = i ? pos[i - 1] : 0, price = i ? C[i - 1] : C[0];
        if (prev === 0 && pos[i] === 1) entry = { i: Math.max(0, i - 1), p: price };
        else if (prev === 1 && pos[i] === 0 && entry) { trades.push({ ...entry, xi: i - 1, xp: price }); entry = null; }
      }
      if (entry) trades.push({ ...entry, xi: N - 1, xp: C[N - 1], open: true });
      return { sf, ss, eq, bh, dd, trades, exposure: pos.reduce((s, x) => s + x, 0) / N };
    }
    function drawBt() {
      let fast = +$("#btFast").value, slow = +$("#btSlow").value;
      if (fast >= slow) { slow = Math.min(200, fast + 5); $("#btSlow").value = slow; }
      $("#btFastV").textContent = fast; $("#btSlowV").textContent = slow;
      const r = runBt(fast, slow), W2 = 820, X2 = i => 54 + i / (N - 1) * (W2 - 64);
      const Yp = yScale(C, 8, 220);
      let svg = axisY(Yp, 54, W2 - 10, niceTicks(Yp), v => nf(v, 0)) +
        `<path d="${pathOf(C, X2, Yp)}" stroke="#94a3b8" stroke-width="1.3" fill="none"/>` +
        `<path d="${pathOf(r.sf, X2, Yp)}" stroke="#38bdf8" stroke-width="1.5" fill="none"/><path d="${pathOf(r.ss, X2, Yp)}" stroke="#a78bfa" stroke-width="1.5" fill="none"/>`;
      r.trades.forEach(t => {
        svg += `<path d="M${X2(t.i) - 5},${Yp(C[t.i]) + 14} l5,-8 l5,8 z" fill="#22c55e"/>`;
        if (!t.open) svg += `<path d="M${X2(t.xi) - 5},${Yp(C[t.xi]) - 14} l5,8 l5,-8 z" fill="#f43f5e"/>`;
      });
      $("#btChart").innerHTML = `<svg viewBox="0 0 ${W2} 240" width="100%">${svg}</svg>`;
      const Ye = yScale([...r.eq, ...r.bh], 8, 130);
      $("#btEq").innerHTML = `<svg viewBox="0 0 ${W2} 162" width="100%">${axisY(Ye, 54, W2 - 10, niceTicks(Ye, 3), v => nf(v / 1000, 1) + " B")}<line x1="54" x2="${W2 - 10}" y1="${Ye(10000)}" y2="${Ye(10000)}" stroke="#475569" stroke-dasharray="4 4"/><path d="${pathOf(r.bh, X2, Ye)}" stroke="#94a3b8" stroke-width="1.3" fill="none"/><path d="${pathOf(r.eq, X2, Ye)}" stroke="#22c55e" stroke-width="1.8" fill="none"/><text x="54" y="156">${trDate(SER[0].t)}</text><text x="${W2 - 10}" y="156" text-anchor="end">${trDate(SER[N - 1].t)}</text></svg>`;
      const sr = (r.eq[N - 1] / 10000 - 1) * 100, br = (r.bh[N - 1] / 10000 - 1) * 100;
      const done = r.trades.filter(t => !t.open), wins = r.trades.filter(t => t.xp > t.p).length;
      $("#btStats").innerHTML = `<div class="kv"><span>Strateji getirisi</span><b class="${sr >= 0 ? "pos" : "neg"}">${pc(sr)}</b><span>Al-Tut getirisi</span><b class="${br >= 0 ? "pos" : "neg"}">${pc(br)}</b><span>İşlem sayısı</span><b>${r.trades.length}</b><span>Kârla kapanan işlem</span><b>${r.trades.length ? nf(wins / r.trades.length * 100, 0) + "%" : "—"}</b><span>Maksimum düşüş</span><b class="neg">${pc(r.dd * 100)}</b><span>Piyasada kalma süresi</span><b>%${nf(r.exposure * 100, 0)}</b></div>` +
        `<p style="margin-top:10px;font-size:13.5px;color:${sr > br ? "#86efac" : "#fcd34d"}">${sr > br ? "Bu ayarla strateji Al-Tut'u geçti." : "Bu ayarla strateji Al-Tut'u geçemedi."} Ayarlar değiştikçe sonucun ne kadar oynadığına dikkat edin: geçmişte en iyi çalışan ayarı seçmek, gelecekte de çalışacağını göstermez.</p>`;
    }
    $("#btFast").oninput = drawBt; $("#btSlow").oninput = drawBt;
    drawBt();

    /* ---------- eğitim / test ayrımı ---------- */
    const iStart = SER.findIndex(r => r.t >= A0.data_start), iSplit = SER.findIndex(r => r.t >= A0.split_time);
    const W3 = 560, X3 = i => 40 + i / (N - 1) * (W3 - 48), Y3 = yScale(C, 26, 150);
    $("#splitChart").innerHTML = `<svg viewBox="0 0 ${W3} 200" width="100%">
      <rect x="${X3(0)}" y="22" width="${X3(iStart) - X3(0)}" height="156" fill="#47556933"/>
      <rect x="${X3(iStart)}" y="22" width="${X3(iSplit) - X3(iStart)}" height="156" fill="#22c55e1f"/>
      <rect x="${X3(iSplit)}" y="22" width="${X3(N - 1) - X3(iSplit)}" height="156" fill="#f59e0b26"/>
      <text x="${(X3(0) + X3(iStart)) / 2}" y="16" text-anchor="middle">ısınma</text>
      <text x="${(X3(iStart) + X3(iSplit)) / 2}" y="16" text-anchor="middle" style="fill:#86efac">EĞİTİM: model bu kısmı görür</text>
      <text x="${(X3(iSplit) + X3(N - 1)) / 2}" y="16" text-anchor="middle" style="fill:#fcd34d">TEST</text>
      <path d="${pathOf(C, X3, Y3)}" stroke="#cbd5e1" stroke-width="1.3" fill="none"/>
      <text x="40" y="194">${trDate(SER[0].t)}</text><text x="${X3(iSplit)}" y="194" text-anchor="middle">${trDate(SER[iSplit].t)}</text><text x="${W3 - 8}" y="194" text-anchor="end">${trDate(SER[N - 1].t)}</text></svg>`;
    $("#splitText").innerHTML = `THYAO'nun ${N} işlem günlük verisinin ilk ~${iStart} günü, 50 günlük ortalama gibi göstergeler hesaplanabilsin diye kullanılmadı (ısınma). Sonraki <b>${A0.train_size} gün</b> eğitim, son <b>${A0.test_size} gün</b> test için ayrıldı. Model, test döneminin hiçbir gününü eğitimde görmedi.`;

    /* ---------- modelin gördüğü 13 sayı ---------- */
    const F = A0.features_last, P = v => pc(v * 100);
    const FEAT_TXT = {
      ret1: v => `Son 1 günde fiyat ${P(v)} değişti`, ret2: v => `Son 2 günde ${P(v)}`, ret3: v => `Son 3 günde ${P(v)}`,
      ret5: v => `Son 5 günde (1 hafta) ${P(v)}`, ret10: v => `Son 10 günde (2 hafta) ${P(v)}`,
      rsi: v => `RSI ${nf(v * 100, 1)}: ${v > .7 ? "aşırı alım" : v < .3 ? "aşırı satım" : "nötr bölge"}`,
      macd_hist: v => `MACD çizgisi sinyalin ${v >= 0 ? "üstünde" : "altında"} (fark fiyatın %${nf(Math.abs(v) * 100, 2)}'i)`,
      dist_sma20: v => `Fiyat 20 günlük ortalamanın %${nf(Math.abs(v) * 100, 1)} ${v >= 0 ? "üstünde" : "altında"}`,
      dist_sma50: v => `Fiyat 50 günlük ortalamanın %${nf(Math.abs(v) * 100, 1)} ${v >= 0 ? "üstünde" : "altında"}`,
      bb_pos: v => `Bollinger bandının %${nf(v * 100, 0)} seviyesinde (0 alt bant, 100 üst bant)`,
      vol10: v => `Son 10 günde günlük ortalama oynaklık %${nf(v * 100, 2)}`,
      vol_chg: v => `Bugünkü hacim 20 günlük ortalamanın %${nf(Math.abs(v) * 100, 0)} ${v >= 0 ? "üstünde" : "altında"}`,
      range: v => `Gün içi en yüksek–en düşük farkı fiyatın %${nf(v * 100, 2)}'i`,
    };
    $("#featTitle").textContent = `Modelin gördüğü 13 sayı (${A0.symbol.replace(".IS", "")}, ${A0.features_date})`;
    $("#featToday").innerHTML = `<tr><th>Öznitelik</th><th>Değer</th><th>Ne anlama geliyor?</th></tr>` +
      Object.entries(F).map(([k, v]) => `<tr><td class="mono">${k}</td><td class="mono">${nf(v, 4)}</td><td>${FEAT_TXT[k] ? FEAT_TXT[k](v) : ""}</td></tr>`).join("") +
      `<tr><td colspan="3" style="color:var(--muted);font-size:12px">Model bu 13 sayıya bakıp "yarın yükselir mi?" sorusuna bir olasılık üretir.</td></tr>`;
  } else {
    ["#indChart", "#btChart", "#splitChart"].forEach(s => { const el = $(s); if (el) el.innerHTML = `<p style="color:var(--muted)">Fiyat serisi (sonuclar.js) bulunamadı; sonuc_uret.py ile oluşturulur.</p>`; });
  }

  /* ---------- modeller nasıl öğrenir? ---------- */
  const box = (x, y, w, h, t, o = {}) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="7" fill="${o.f || "#16213a"}" stroke="${o.s || "#2b3d60"}"/><text x="${x + w / 2}" y="${y + h / 2 + 4}" text-anchor="middle" style="fill:${o.c || "#e6ecf7"};font-size:${o.fs || 11.5}px">${t}</text>`;
  const ln = (x1, y1, x2, y2, c = "#3b4f78", w = 1.4) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${c}" stroke-width="${w}"/>`;
  const arrowDefs = `<defs><marker id="ar" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#38bdf8"/></marker></defs>`;
  const arr = (x1, y1, x2, y2) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#38bdf8" stroke-width="1.6" marker-end="url(#ar)"/>`;
  const tree = (cx, y, s, q, a, b) => {
    const w = 120 * s, h = 26 * s;
    return box(cx - w / 2, y, w, h, q, { fs: 11 * s }) + ln(cx, y + h, cx - 42 * s, y + h + 26 * s) + ln(cx, y + h, cx + 42 * s, y + h + 26 * s) +
      `<text x="${cx - 34 * s}" y="${y + h + 14 * s}" style="font-size:${10 * s}px">evet</text><text x="${cx + 22 * s}" y="${y + h + 14 * s}" style="font-size:${10 * s}px">hayır</text>` +
      box(cx - 42 * s - 30 * s, y + h + 26 * s, 60 * s, 22 * s, a, { f: a.includes("↑") ? "#0f2a1d" : "#2a0f17", s: a.includes("↑") ? "#22c55e" : "#f43f5e", fs: 11 * s }) +
      box(cx + 42 * s - 30 * s, y + h + 26 * s, 60 * s, 22 * s, b, { f: b.includes("↑") ? "#0f2a1d" : "#2a0f17", s: b.includes("↑") ? "#22c55e" : "#f43f5e", fs: 11 * s });
  };
  const SVGS = {
    naive: () => {
      const days = [["Pzt", "↑"], ["Sal", "↑"], ["Çar", "↓"], ["Per", "↓"], ["Cum", "↑"]];
      let s = days.map(([d, a], i) => box(30 + i * 92, 70, 70, 50, `${d} ${a}`, { f: a === "↑" ? "#0f2a1d" : "#2a0f17", s: a === "↑" ? "#22c55e" : "#f43f5e", fs: 14 })).join("");
      s += `<path d="M ${30 + 4 * 92 + 35} 124 C ${30 + 4 * 92 + 35} 190, ${30 + 5 * 92 - 10} 190, ${30 + 5 * 92 - 10} 150" stroke="#38bdf8" stroke-width="1.6" fill="none" marker-end="url(#ar)"/>`;
      s += box(30 + 5 * 92 - 40, 96, 64, 50, "Yarın ↑?", { f: "#13304a", s: "#38bdf8", fs: 13 });
      s += `<text x="260" y="40" text-anchor="middle" style="font-size:14px;fill:#e6ecf7">"Bugün ne olduysa yarın da o olur"</text><text x="260" y="230" text-anchor="middle">Cuma yükseldi → Naif model pazartesi için de "yükselir" der.</text>`;
      return s;
    },
    log: () => {
      const ins = [["RSI", "+0,8"], ["ret5", "−0,3"], ["dist_sma20", "+0,5"], ["… 10 tane daha", ""]];
      let s = ins.map(([n, w], i) => box(10, 30 + i * 52, 110, 34, n) + arr(122, 47 + i * 52, 208, 140) + (w ? `<text x="${150}" y="${40 + i * 52 + (i < 2 ? 12 : 22)}" style="fill:#fcd34d">${w}</text>` : "")).join("");
      s += `<circle cx="232" cy="140" r="24" fill="#13304a" stroke="#38bdf8"/><text x="232" y="146" text-anchor="middle" style="font-size:20px;fill:#e6ecf7">Σ</text>` + arr(258, 140, 300, 140);
      let curve = ""; for (let k = 0; k <= 40; k++) { const x = -6 + k * 0.3, y = 1 / (1 + Math.exp(-x)); curve += (k ? "L" : "M") + (310 + k * 4) + "," + (190 - y * 100); }
      s += `<rect x="304" y="80" width="172" height="120" rx="8" fill="#0a1222" stroke="#2b3d60"/><path d="${curve}" stroke="#22c55e" stroke-width="2" fill="none"/><text x="390" y="98" text-anchor="middle">S eğrisi</text>` + arr(478, 140, 500, 140);
      s += `<text x="260" y="246" text-anchor="middle" style="fill:#e6ecf7">Ağırlıklı toplam → 0 ile 1 arası "yükselme olasılığı"</text><text x="260" y="266" text-anchor="middle">Ağırlıkları (sarı) model eğitimde kendisi bulur.</text>`;
      return s;
    },
    rf: () => {
      let s = tree(90, 24, 1, "RSI < 30?", "↑ yük.", "↓ düş.") + tree(260, 24, 1, "ret5 < −3%?", "↑ yük.", "↓ düş.") + tree(430, 24, 1, "bb_pos < 0,2?", "↑ yük.", "↑ yük.");
      s += `<text x="260" y="150" text-anchor="middle" style="font-size:20px;fill:#93a1bd">… toplam 300 ağaç …</text>`;
      s += arr(90, 160, 220, 200) + arr(260, 160, 260, 196) + arr(430, 160, 300, 200);
      s += box(170, 202, 180, 40, "Oylama: 172 ↑ · 128 ↓", { f: "#13304a", s: "#38bdf8", fs: 13 }) + `<text x="260" y="268" text-anchor="middle" style="fill:#86efac">Sonuç: yükseliş, olasılık %57</text>`;
      return s;
    },
    gb: () => {
      let s = "";
      [["1. ağaç", "kaba tahmin", 100], ["2. ağaç", "1'in hatasını düzeltir", 62], ["3. ağaç", "kalan hatayı düzeltir", 40], ["… 200. ağaç", "", 18]].forEach(([a, b, err], i) => {
        const x = 14 + i * 126;
        s += box(x, 40, 104, 40, a, { fs: 12.5 }) + `<text x="${x + 52}" y="98" text-anchor="middle" style="font-size:10.5px">${b}</text>` + (i < 3 ? arr(x + 106, 60, x + 124, 60) : "");
        s += `<rect x="${x + 22}" y="${230 - err}" width="60" height="${err}" rx="4" fill="${i === 3 ? "#22c55e" : "#f43f5e"}" opacity=".75"/><text x="${x + 52}" y="${222 - err}" text-anchor="middle">hata</text>`;
      });
      s += `<line x1="10" x2="510" y1="230" y2="230" stroke="#2b3d60"/><text x="260" y="256" text-anchor="middle" style="fill:#e6ecf7">Her yeni ağaç, öncekilerin bıraktığı hatayı küçültür.</text>`;
      return s;
    },
    mlp: () => {
      const L = [[6, "13 giriş"], [8, "32 nöron"], [6, "16 nöron"], [1, "çıktı"]], xs = [60, 190, 320, 450];
      const pos = L.map(([n], li) => Array.from({ length: n }, (_, k) => [xs[li], 140 + (k - (n - 1) / 2) * 26]));
      let s = "";
      for (let li = 0; li < 3; li++) pos[li].forEach(a => pos[li + 1].forEach(b => { s += ln(a[0], a[1], b[0], b[1], "#24365a", .7); }));
      pos.forEach((col, li) => col.forEach(([x, y]) => { s += `<circle cx="${x}" cy="${y}" r="9" fill="${li === 3 ? "#0f2a1d" : "#13304a"}" stroke="${li === 3 ? "#22c55e" : "#38bdf8"}"/>`; }));
      L.forEach(([, t], li) => { s += `<text x="${xs[li]}" y="270" text-anchor="middle" style="fill:#e6ecf7">${t}</text>`; });
      s += `<text x="${xs[3] + 14}" y="144" style="fill:#86efac">↑ %57</text><text x="260" y="26" text-anchor="middle">Her çizgi bir ağırlık. Eğitim, binlerce ağırlığı hatayı azaltacak şekilde ayarlar.</text>`;
      return s;
    },
    arima: () => {
      let s = "";
      [["r(t−2)", "−0,4%"], ["r(t−1)", "+1,1%"], ["hata(t−1)", "+0,3%"]].forEach(([a, b], i) => {
        s += box(20 + i * 130, 70, 110, 50, a, { fs: 13 }) + `<text x="${75 + i * 130}" y="138" text-anchor="middle">${b}</text>` + arr(75 + i * 130, 146, 400, 196);
      });
      s += box(400, 70, 100, 50, "r(t) ?", { f: "#13304a", s: "#38bdf8", fs: 14 }) + box(330, 196, 150, 34, "ağırlıklı toplam", { fs: 12 }) + arr(480, 196, 460, 122);
      s += `<text x="260" y="36" text-anchor="middle" style="fill:#e6ecf7">Göstergelere bakmaz: sadece getirinin kendi geçmişi ve geçmiş hatalar</text><text x="260" y="266" text-anchor="middle">p ve q (kaç gün geriye bakılacağı) 0–2 arasında denenir, en iyi AIC seçilir.</text>`;
      return s;
    },
    lstm: () => {
      let s = "";
      for (let i = 0; i < 6; i++) {
        const x = 20 + i * 82;
        s += box(x, 170, 62, 34, i === 4 ? "…" : i === 5 ? "gün 20" : `gün ${i + 1}`, { fs: 12 }) + arr(x + 31, 168, x + 31, 128) + box(x, 84, 62, 42, "hafıza", { f: "#1e1636", s: "#a78bfa", fs: 12 });
        if (i < 5) s += arr(x + 63, 105, x + 80, 105);
      }
      s += arr(461, 82, 461, 44) + box(420, 12, 82, 30, "↑ / ↓", { f: "#0f2a1d", s: "#22c55e", fs: 13 }) + `<text x="200" y="40" text-anchor="middle" style="fill:#e6ecf7">Son 20 günü sırayla okur</text><text x="260" y="246" text-anchor="middle">Her adımda neyi hatırlayıp neyi unutacağına kendisi karar verir.</text>`;
      return s;
    },
  };
  const MX = [
    ["naive", "Naif model", "Naif Model (referans)", "Hiçbir şey öğrenmez. Yön için \"yarın da bugünkü gibi olur\" der: bugün yükseldiyse yarın da yükselir. Getiri için de \"fiyat değişmez\" (%0) der.", "Hava durumunu \"yarın da bugünkü gibi olacak\" diye tahmin eden biri. Şaşırtıcı derecede sık tutar!", "Eğitim gerektirmez. Diğer bütün modellerin geçmesi gereken alt çıta olarak kullanılır.", "Basit ve dürüst bir referans.", "Hiçbir örüntü yakalamaz."],
    ["log", "Lojistik / Ridge regresyon", "Lojistik/Ridge Regresyon", "Her göstergeye bir ağırlık verir (önemliyse büyük, ters etkiliyse eksi). Ağırlıklı toplamı bir S eğrisinden geçirip 0 ile 1 arasında bir \"yükselme olasılığına\" çevirir. Eğitim, geçmişte en az hata yapan ağırlıkları bulmaktır. Ridge, aynı fikrin yüzde değişim tahmini yapan sürümüdür.", "Bir öğretmenin not hesabı: vize %30, final %50, ödev %20. Model bu yüzdeleri kendisi bulur.", "Göstergeler önce aynı ölçeğe getirilir (StandardScaler). Ridge'de α = 1 ile aşırı büyük ağırlıklar cezalandırılır.", "Hızlı, yorumlanabilir, az veriyle bile kararlı.", "Sadece doğrusal ilişkileri yakalar; \"RSI hem çok düşükken hem çok yüksekken önemli\" gibi durumları kaçırır."],
    ["rf", "Rastgele Orman", "Rastgele Orman", "Bir karar ağacı evet/hayır sorularıyla karar verir: \"RSI 30'un altında mı? Evet → fiyat ortalamanın altında mı? …\". Tek bir ağaç kolayca ezberler. Rastgele Orman 300 ağaç kurar, her biri verinin ve göstergelerin farklı bir rastgele parçasını görür. Sonunda ağaçlar oylanır.", "Tek bir uzmana değil, 300 kişilik bir jüriye sormak. Bireysel hatalar birbirini götürür.", "300 ağaç, en fazla 6 seviye derinlik, her yaprakta en az 5 örnek. Sunumdaki \"öznitelik önemleri\" bu modelden alınır.", "Doğrusal olmayan ilişkileri yakalar, ezberlemeye karşı dirençli.", "Yüzlerce ağacı tek tek yorumlamak zor."],
    ["gb", "Gradyan Artırma", "Gradyan Artırma", "Ağaçları sırayla kurar. İlk ağaç kaba bir tahmin yapar; ikinci ağaç sadece birincinin hatalarını düzeltmeye çalışır; üçüncüsü kalan hataları… Her yeni ağaç öncekilerin eksiğini kapatır. XGBoost ve LightGBM bu fikrin ünlü uygulamalarıdır.", "Bir yazıyı sırayla okuyan editörler: her biri sadece öncekilerin kaçırdığı hataları düzeltir.", "HistGradientBoosting: 200 küçük ağaç (3 seviye), öğrenme hızı 0,05.", "Tablo verisinde genellikle en güçlü yöntemlerden.", "Ayarlanmazsa gürültüyü de öğrenebilir."],
    ["mlp", "Yapay sinir ağı (MLP)", "Yapay Sinir Ağı (MLP)", "13 gösterge giriş katmanına verilir. Ara katmanlardaki her \"nöron\", bir önceki katmanın ağırlıklı toplamını alıp bir eşikten geçirir. Katmanlar üst üste binince karmaşık ilişkiler öğrenilebilir. Eğitimde ağırlıklar, hata küçülecek yönde adım adım güncellenir (geri yayılım).", "Bir fabrikadaki ardışık ayıklama bantları: her bant bir öncekinin çıktısından daha soyut bir özellik çıkarır.", "İki ara katman (32 ve 16 nöron), düzenlileştirme α = 0,001, doğrulama hatası artmaya başlayınca erken durdurma.", "Çok esnek; büyük veride güçlü.", "Birkaç yüz günlük veri için fazla esnek; deneylerde getiri tahmini hatası diğer modellerden belirgin şekilde yüksek çıktı."],
    ["arima", "ARIMA", "ARIMA", "Klasik istatistiksel zaman serisi modeli. Göstergelere bakmaz; sadece getiri serisinin kendi geçmişine bakar: bugünkü getiri, son birkaç günün getirileri ve son tahmin hatalarının ağırlıklı toplamı olarak modellenir.", "Bir şarkının ritmini dinleyip sıradaki notayı tahmin etmek.", "statsmodels ARIMA(p, 0, q); p ve q 0–2 arasında denenir, en düşük AIC'yi veren seçilir.", "Onlarca yıllık teorisi var, az veriyle çalışır.", "Doğrusaldır ve sadece kendi geçmişine bakar; haberleri veya diğer göstergeleri bilmez."],
    ["lstm", "LSTM (isteğe bağlı)", "LSTM (Derin Öğrenme)", "Zaman serileri için tasarlanmış bir sinir ağı. Son 20 günü sırayla okur ve bir \"hafıza hücresinde\" neyi hatırlayıp neyi unutacağına kendisi karar verir.", "Bir romanı okurken önemli olayları aklında tutup gereksiz ayrıntıları unutan okuyucu.", "32 birim, 20 günlük pencere, erken durdurma. PyTorch gerektirir; exe paketinde yoktur.", "Uzun vadeli bağımlılıkları yakalayabilir.", "Çok veri ister; bu projede diğerlerinden belirgin biçimde iyi değildi ve uygulamayı ~420 MB büyütüyordu."],
  ];
  function showModel(k) {
    const m = MX.find(x => x[0] === k);
    $$("#mlTabs button").forEach(b => b.classList.toggle("on", b.dataset.k === k));
    $("#mlSvg").innerHTML = `<svg viewBox="0 0 520 280" width="100%">${arrowDefs}${SVGS[k]()}</svg>`;
    let res = "";
    if (A0) {
      const r = A0.metrics.find(x => x.model === m[2]), nv = A0.metrics.find(x => x.model === NAIVE);
      if (r) res = `<p style="margin-top:10px;padding:8px 10px;background:#0b2536;border-radius:8px;font-size:13.5px">📊 ${A0.symbol} deneyinde yön doğruluğu: <b>%${nf(r.direction_accuracy, 1)}</b>${m[0] !== "naive" ? ` (naif model %${nf(nv.direction_accuracy, 1)})` : ""}${A0.best_model === m[2] ? ' <span class="tag">bu varlıkta seçildi</span>' : ""}</p>`;
    }
    $("#mlText").innerHTML = `<h3>${m[1]}</h3><p><b>Nasıl çalışır?</b> ${m[3]}</p><p style="margin-top:8px;color:#a7c4bc"><b style="color:#86efac">Benzetme:</b> ${m[4]}</p><p style="margin-top:8px"><b>Projede:</b> ${m[5]}</p><div class="grid g2" style="margin-top:10px;gap:8px"><div style="font-size:13px"><b style="color:#86efac">+ Güçlü yanı</b><br><span style="color:var(--muted)">${m[6]}</span></div><div style="font-size:13px"><b style="color:#fda4af">− Zayıf yanı</b><br><span style="color:var(--muted)">${m[7]}</span></div></div>${res}`;
  }
  $("#mlTabs").innerHTML = MX.map(m => `<button data-k="${m[0]}">${m[1]}</button>`).join("");
  $("#mlTabs").onclick = e => { const b = e.target.closest("button"); if (b) showModel(b.dataset.k); };
  showModel("rf");

  /* ---------- restoran benzetmesi ---------- */
  const ROLES = [
    ["🧑", "Müşteri", "Kullanıcı", "kullanıcı"],
    ["🍽️", "Salon ve menü", "React arayüzü", "frontend/src"],
    ["🤵", "Garson", "FastAPI (REST API)", "main.py"],
    ["👨‍🍳", "Aşçılar", "Python modülleri", "market · ml · …"],
    ["🗄️", "Kiler", "SQLite veritabanı", "db.py"],
    ["🚚", "Tedarikçi", "Yahoo Finance, KAP, SPK", "dış kaynak"],
  ];
  $("#rest").innerHTML = ROLES.map(([e, a, b, t]) => `<div class="role"><span class="e">${e}</span><b>${a}</b><small>${b}</small><span class="t">${t}</span></div>`).join("");
  const STEPS = [
    [0, "Kullanıcı THYAO grafiğine tıklar: \"Bu hissenin grafiğini görmek istiyorum.\""],
    [1, "Arayüz siparişi yazar: GET /api/history/THYAO.IS. Yanına giriş bilekliğini (JWT) iliştirir."],
    [2, "Garson (FastAPI) önce bilekliği kontrol eder, sonra siparişi doğru aşçıya (market.py) götürür."],
    [4, "Aşçı önce kilere bakar: bu veri son 30 dakika içinde alınmış mı? (önbellek)"],
    [5, "Kilerde taze veri yoksa tedarikçiden (Yahoo Finance) istenir ve kilere konur."],
    [3, "Aşçı yemeği hazırlar: ortalamalar, RSI, MACD hesaplanır."],
    [2, "Garson tabağı (JSON) salona taşır."],
    [0, "Arayüz grafiği çizer, kullanıcı sonucu görür. Önbellekten bu iş yaklaşık 50 milisaniye sürer."],
  ];
  let restT;
  $("#restPlay").onclick = () => {
    clearInterval(restT); let i = 0;
    const tick = () => {
      if (i >= STEPS.length) { clearInterval(restT); return; }
      const [r, msg] = STEPS[i]; $$("#rest .role").forEach((el, j) => el.classList.toggle("on", j === r));
      $("#restMsg").textContent = `${i + 1}/${STEPS.length} · ${msg}`; i++;
    };
    tick(); restT = setInterval(tick, 2300);
  };
  const RT = [
    ["🧑 Müşteri", "Kullanıcı", "—", null],
    ["🍽️ Salon ve menü", "Ekranlar, butonlar, grafikler", "React, TypeScript, Lightweight Charts", "frontend/src/App.tsx"],
    ["🤵 Garson", "Siparişleri (istekleri) alıp mutfağa iletir, tabağı (JSON) geri getirir", "FastAPI, Uvicorn", "backend/app/main.py"],
    ["🎫 Kapıdaki bileklik", "Kim olduğunu her seferinde kanıtlayan imzalı jeton", "JWT, PBKDF2", "backend/app/auth.py"],
    ["👨‍🍳 Aşçılar", "Asıl hesaplamayı yapan uzmanlar: veri, gösterge, yapay zekâ, portföy", "pandas, scikit-learn, statsmodels", "backend/app/ml.py"],
    ["🗄️ Kiler", "Kullanıcı kayıtları ve kısa süreli fiyat önbelleği", "SQLite", "backend/app/db.py"],
    ["🚚 Tedarikçi", "Dışarıdan gelen ham veri", "yfinance, KAP, SPK, Google Haberler", "backend/app/market.py"],
    ["🌙 Gece bekçisi", "Herkes giderken bile dakikada bir tur atıp emirleri ve alarmları kontrol eder", "threading", "backend/app/engine.py"],
    ["📖 Danışman şef", "İsteğe bağlı: yorum ve metin yazar; yoksa mutfak el kitabıyla devam eder", "Claude API", "backend/app/assistant.py"],
  ];
  $("#restTable").innerHTML = `<tr><th>Restoranda</th><th>Projede ne iş yapar?</th><th>Teknoloji</th><th>Dosya</th></tr>` +
    RT.map(([a, b, c, f]) => `<tr><td><b>${a}</b></td><td>${b}</td><td>${c}</td><td>${f ? `<a class="code-link" href="#" data-code="${f}" style="margin:0">${f.split("/").pop()}</a>` : ""}</td></tr>`).join("");

  /* ---------- özellik haritası ---------- */
  const SHOT_BY = { "/": 0, "/analiz": 1, "/tahmin": 2, "/portfoy": 3, "/backtest": 4, "/tarama": 5, "/piyasa/bist": 6, "/kap": 7, "/halka-arz": 8, "/haberler": 9 };
  const RBY = Object.fromEntries((KOD.routes || []).map(r => [`${r.method} ${r.path}`, r]));
  const modFile = m => m === "db" ? "backend/app/db.py" : `backend/app/${m}.py`;
  let fmSel = 0;
  function renderFm() {
    const P = KOD.pages || []; let html = "", sec = "";
    P.forEach((p, i) => {
      if (p.section !== sec) { sec = p.section; html += `<div class="grp">${p.section_icon} ${sec}</div>`; }
      html += `<div class="it${i === fmSel ? " on" : ""}" data-i="${i}"><span>${p.icon}</span>${p.label}<small>${p.apis.length} istek</small></div>`;
    });
    $("#fmList").innerHTML = html;
    const p = P[fmSel]; if (!p) return;
    const routes = p.apis.flatMap(a => a.routes.map(k => RBY[k]).filter(Boolean));
    const mods = [...new Set(routes.flatMap(r => r.mods))].sort();
    const shot = SHOT_BY[p.to];
    $("#fmDetail").innerHTML = `<h3 style="font-size:19px">${p.icon} ${p.label} ${p.advanced ? '<span class="tag o">gelişmiş mod</span>' : ""}</h3>
      <p>${p.desc}</p>
      <div class="flowmini"><span>🖥️ Ekran: <b>${p.file ? p.file.split("/").pop() : "—"}</b></span><i>→</i><span>🔌 ${p.apis.length} API isteği</span><i>→</i><span>🐍 ${mods.length} Python modülü</span></div>
      <div class="grid g2" style="gap:10px">
        <div><b style="font-size:13px">Sunucudan istediği veriler</b><div class="apiwrap" style="max-height:230px;min-height:0;margin-top:4px"><table>${p.apis.map(a => a.routes.filter(k => RBY[k]).map(k => { const r = RBY[k]; return `<tr class="rw" data-l="${r.line}"><td><span class="m ${r.method.toLowerCase()}">${r.method}</span></td><td class="mono" style="font-size:12px">${r.path.replace("/api", "")}</td><td class="mono" style="font-size:12px;color:var(--muted)">${r.func}()</td></tr>`; }).join("")).join("")}</table></div></div>
        <div><b style="font-size:13px">Çalışan Python modülleri</b><div style="margin-top:6px">${mods.map(m => `<a class="code-link" href="#" data-code="${modFile(m)}" style="display:inline-block;margin:2px 10px 2px 0">${m === "db" ? "db.py (doğrudan SQL)" : m + ".py"}</a>`).join("") || '<span style="color:var(--muted)">—</span>'}</div>
          <b style="font-size:13px;display:block;margin-top:10px">Arayüz dosyası</b>${p.file ? `<a class="code-link" href="#" data-code="${p.file}">${p.file}</a>` : "—"}</div>
      </div>
      ${shot !== undefined ? `<img src="ekran/${SHOTS[shot][0]}.jpg" alt="${p.label}" data-shot="${shot}">` : '<p style="font-size:12.5px;margin-top:10px;color:var(--muted)">Bu sayfanın ekran görüntüsü sunuma eklenmedi.</p>'}`;
  }
  $("#fmList").onclick = e => { const it = e.target.closest(".it"); if (it) { fmSel = +it.dataset.i; renderFm(); } };
  $("#fmDetail").onclick = e => {
    const tr = e.target.closest("tr.rw"); if (tr) return openCode("backend/app/main.py", +tr.dataset.l);
    const im = e.target.closest("img[data-shot]"); if (im) lbShow(+im.dataset.shot);
  };
  if ((KOD.pages || []).length) renderFm();

  /* ---------- API kataloğu ---------- */
  const API_GRP = [
    ["Kimlik ve hesap", ["auth", "profile", "prefs", "settings"]],
    ["Piyasa verisi", ["markets", "market", "overview", "quotes", "search", "history", "heatmap", "data-status", "today", "stock-card", "sectors", "dividends", "fundamentals"]],
    ["Analiz", ["analysis", "mtf", "compare", "correlation", "headtohead", "screener", "ai"]],
    ["Yapay zekâ ve LLM", ["predict", "assistant", "bulletin"]],
    ["Portföy ve işlemler", ["portfolio", "account", "trade", "orders", "journal", "equity", "report"]],
    ["Strateji ve nicel", ["backtest", "bots", "optimize", "montecarlo", "inflation", "real-return", "scenario", "timetravel"]],
    ["Haber ve duyuru", ["news", "kap", "calendar", "ipo"]],
    ["Bildirim ve alarm", ["notifications", "alerts", "watchlist", "telegram"]],
    ["Eğitim ve oyun", ["academy", "game", "badges"]],
    ["Sistem", ["desktop", "backup", "export"]],
  ];
  const grpOf = r => { const seg = r.key.split("/")[1]; const g = API_GRP.find(([, s]) => s.includes(seg)); return g ? g[0] : "Diğer"; };
  const PAGE_BY_FILE = {}; (KOD.pages || []).forEach(p => { if (p.file) (PAGE_BY_FILE[p.file] ||= []).push(p.label); });
  const usedBy = r => [...new Set((r.files || []).flatMap(f => PAGE_BY_FILE[f] || [f.split("/").pop().replace(".tsx", "").replace(".ts", "")]))];
  let apiG = "Tümü";
  function renderApi() {
    const R = KOD.routes || [], q = ($("#apiQ").value || "").trim().toLocaleLowerCase("tr");
    const groups = ["Tümü", ...API_GRP.map(g => g[0])];
    $("#apiGroups").innerHTML = groups.map(g => `<button class="chip${g === apiG ? " on" : ""}" data-g="${g}">${g}<small>${g === "Tümü" ? R.length : R.filter(r => grpOf(r) === g).length}</small></button>`).join("");
    const list = R.filter(r => (apiG === "Tümü" || grpOf(r) === apiG) && (!q || `${r.method} ${r.path} ${r.func} ${grpOf(r)} ${usedBy(r).join(" ")} ${r.mods.join(" ")}`.toLocaleLowerCase("tr").includes(q)));
    $("#apiTable").innerHTML = `<tr><th>Yöntem</th><th>Adres</th><th>Cevap veren fonksiyon</th><th>Çalışan modüller</th><th>Kullanan ekranlar</th><th></th></tr>` +
      list.map(r => { const u = usedBy(r); return `<tr class="rw" data-l="${r.line}"><td><span class="m ${r.method.toLowerCase()}">${r.method}</span></td><td class="mono" style="font-size:12.5px">${r.path}</td><td class="mono" style="font-size:12.5px">${r.func}()</td><td style="font-size:12.5px;color:var(--muted)">${r.mods.join(", ") || "—"}</td><td style="font-size:12.5px">${u.slice(0, 3).join(", ")}${u.length > 3 ? ` +${u.length - 3}` : ""}${u.length ? "" : '<span style="color:var(--muted)">indirme / masaüstü</span>'}</td><td>${r.auth ? "🔒" : ""}</td></tr>`; }).join("");
    $("#apiCount").textContent = `${list.length} / ${R.length} uç nokta`;
  }
  $("#apiQ").oninput = renderApi;
  $("#apiGroups").onclick = e => { const b = e.target.closest(".chip"); if (b) { apiG = b.dataset.g; renderApi(); } };
  $("#apiTable").onclick = e => { const tr = e.target.closest("tr.rw"); if (tr) openCode("backend/app/main.py", +tr.dataset.l); };
  if ((KOD.routes || []).length) renderApi();

  /* ---------- veritabanı şeması ---------- */
  const DBD = Object.fromEntries((typeof DB !== "undefined" ? DB : []).map(([a, b]) => [a, b]));
  const SCH = KOD.schema || [];
  const pyFiles = KOD.files.filter(f => f.lang === "py");
  let dbSel = "users";
  function renderDb() {
    const W = 640, H = 470, cx = W / 2, cy = 196, R = 168;
    const linked = SCH.filter(t => Object.values(t.fk).includes("users"));
    const loose = SCH.filter(t => t.table !== "users" && !linked.includes(t));
    const P = { users: [cx, cy] };
    linked.forEach((t, i) => { const a = -Math.PI / 2 + i / linked.length * Math.PI * 2; P[t.table] = [cx + Math.cos(a) * R * 1.45, cy + Math.sin(a) * R]; });
    loose.forEach((t, i) => { P[t.table] = [cx + (i - (loose.length - 1) / 2) * 150, H - 26]; });
    let s = linked.map(t => `<line x1="${cx}" y1="${cy}" x2="${P[t.table][0]}" y2="${P[t.table][1]}" class="${dbSel === t.table || dbSel === "users" ? "on" : ""}"/>`).join("");
    s += loose.filter(t => t.columns.some(c => c.name === "user_id")).map(t => `<line x1="${cx}" y1="${cy}" x2="${P[t.table][0]}" y2="${P[t.table][1]}" stroke-dasharray="4 4" class="${dbSel === t.table ? "on" : ""}"/>`).join("");
    s += `<text x="${cx}" y="${H - 52}" text-anchor="middle">Önbellek ve yardımcı tablolar (kesikli çizgi: user_id var ama kısıt tanımlı değil)</text>`;
    s += SCH.map(t => { const [x, y] = P[t.table], w = t.table === "users" ? 120 : Math.max(96, t.table.length * 7.6 + 16); return `<g class="tb${dbSel === t.table ? " on" : ""}" data-t="${t.table}"><rect x="${x - w / 2}" y="${y - 14}" width="${w}" height="28" rx="7"${t.table === "users" ? ' style="stroke:#38bdf8;stroke-width:2"' : ""}/><text x="${x}" y="${y + 4}" text-anchor="middle">${t.table}</text></g>`; }).join("");
    $("#dbDiagram").innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%">${s}</svg>`;
    const t = SCH.find(x => x.table === dbSel);
    const rx = new RegExp(`\\b(?:FROM|INTO|UPDATE|JOIN)\\s+${t.table}\\b`, "i");
    const users = pyFiles.filter(f => rx.test(f.code) && f.path !== "backend/app/db.py").map(f => f.path);
    const refs = SCH.filter(x => Object.values(x.fk).includes(t.table)).map(x => x.table);
    $("#dbDetail").innerHTML = `<h3 class="mono" style="color:#7dd3fc;font-size:17px">${t.table}</h3><p>${DBD[t.table] || ""}</p>
      <div class="cols" style="margin-top:10px">${t.columns.map(c => `<div><b class="${t.pk.includes(c.name) ? "pk" : t.fk[c.name] ? "fk" : c.added ? "add" : ""}">${t.pk.includes(c.name) ? "🔑 " : ""}${c.name}${t.fk[c.name] ? ` → ${t.fk[c.name]}` : ""}</b><span>${c.type}${c.added ? " · sonradan eklendi" : ""}</span></div>`).join("")}</div>
      <p style="font-size:12px;margin-top:8px"><span style="color:#fcd34d">🔑 birincil anahtar</span> · <span style="color:#86efac">→ yabancı anahtar</span> · <span style="color:#c4b5fd">sonradan eklenen sütun (otomatik geçiş)</span></p>
      ${refs.length ? `<p style="margin-top:8px;font-size:13px"><b>Bu tabloya bağlanan tablolar:</b> ${refs.length}</p>` : ""}
      <p style="margin-top:8px;font-size:13px"><b>Bu tabloyu sorgulayan modüller:</b></p><div>${users.map(f => `<a class="code-link" href="#" data-code="${f}" style="display:inline-block;margin:2px 10px 2px 0">${f.split("/").pop()}</a>`).join("") || '<span style="color:var(--muted)">—</span>'}</div>`;
  }
  $("#dbDiagram").onclick = e => { const g = e.target.closest(".tb"); if (g) { dbSel = g.dataset.t; renderDb(); } };
  if (SCH.length) renderDb();

  /* ---------- takas ve emir canlandırması ---------- */
  $("#tl").innerHTML = [["Pazartesi · T0", "Alım yapılır. Tutar alım gücünden düşer."], ["Salı · T1", "Para hâlâ yolda (takas bekliyor)."], ["Çarşamba · T2", "Para hesaptan çıkar, hisse kesinleşir."]]
    .map(([a, b]) => `<div class="on"><b>${a}</b>${b}</div>`).join("");
  const OP = [100, 99.5, 99, 98.6, 98.9, 98.2, 97.6, 97.9, 97.1, 96.8, 96.4, 96.6, 96.2, 95.8, 95.5, 95.9, 96.7, 97.4, 97.1, 98, 98.8, 99.5, 99.1, 100.2, 101, 100.6, 101.8, 102.5, 102.1, 103.4, 104, 103.6, 104.9, 105.5, 105.1, 106.3, 106.9, 106.4, 107.4, 107.9, 108.4, 108.1, 107.6, 108, 107.2];
  const LV = { buy: 96, stop: 91, tp: 108 };
  function drawOrd(k) {
    const W = 520, X = i => 40 + i / (OP.length - 1) * (W - 50), Y = v => 14 + (1 - (v - 88) / (112 - 88)) * 150;
    const lvl = (v, c, t, on) => `<line x1="40" x2="${W - 10}" y1="${Y(v)}" y2="${Y(v)}" stroke="${c}" stroke-dasharray="5 4" opacity="${on ? 1 : .35}"/><text x="${W - 12}" y="${Y(v) - 4}" text-anchor="end" style="fill:${c};opacity:${on ? 1 : .5}">${t} ${v}</text>`;
    const bought = k >= 13;
    let s = lvl(LV.buy, "#22c55e", "limit alış", !bought) + lvl(LV.stop, "#f43f5e", "zarar durdur", bought && k < 40) + lvl(LV.tp, "#f59e0b", "kâr al", bought && k < 40);
    s += `<path d="${pathOf(OP.slice(0, k + 1), X, Y)}" stroke="#cbd5e1" stroke-width="1.8" fill="none"/><circle cx="${X(k)}" cy="${Y(OP[k])}" r="5" fill="#38bdf8"/>`;
    if (bought) s += `<circle cx="${X(13)}" cy="${Y(OP[13])}" r="6" fill="none" stroke="#22c55e" stroke-width="2"/>`;
    if (k >= 40) s += `<circle cx="${X(40)}" cy="${Y(OP[40])}" r="6" fill="none" stroke="#f59e0b" stroke-width="2"/>`;
    $("#ordChart").innerHTML = `<svg viewBox="0 0 ${W} 180" width="100%">${s}<text x="40" y="178">dakika 0</text><text x="${W - 10}" y="178" text-anchor="end">dakika ${OP.length - 1}</text></svg>`;
  }
  let ordT;
  $("#ordPlay").onclick = () => {
    clearInterval(ordT); let k = 0; $("#ordLog").innerHTML = `<div>Emir girildi: fiyat ${LV.buy} veya altına inerse 10 adet al.</div>`;
    ordT = setInterval(() => {
      drawOrd(k);
      if (k === 13) $("#ordLog").innerHTML += `<div style="color:#86efac">Dakika 13: fiyat ${nf(OP[13], 1)} ≤ ${LV.buy} → limit alış gerçekleşti. Zarar durdur (${LV.stop}) ve kâr al (${LV.tp}) emirleri kuruldu.</div>`;
      if (k === 40) { $("#ordLog").innerHTML += `<div style="color:#fcd34d">Dakika 40: fiyat ${nf(OP[40], 1)} ≥ ${LV.tp} → kâr al gerçekleşti. Kâr: ${pc((OP[40] / OP[13] - 1) * 100, 1)}. Bildirim gönderildi.</div>`; }
      if (++k >= OP.length) clearInterval(ordT);
    }, 140);
  };
  drawOrd(0);
  $("#ordLog").innerHTML = `<div style="color:var(--muted)">Canlandır'a basın.</div>`;

  /* ---------- zorluklar ve çözümler ---------- */
  const CH = [
    ["Yahoo Finance çok sık istek gelince geçici olarak engelliyor, ekranlar boş kalıyordu.", "Üç katmanlı önlem: SQLite önbelleği (5–30 dk), eski kaydı hemen gösterip arka planda yenileme ve engel algılanınca süre dolana kadar istek göndermeyen devre kesici.", "backend/app/yahoo.py", "fail"],
    ["Bazı BIST şirketleri (ör. THY) finansallarını dolarla raporluyor; F/K gibi oranlar TL piyasa değeriyle kıyaslanınca anlamsız çıkıyordu.", "Finansallar raporlama para biriminden TL'ye çevrilip oranlar yeniden hesaplanıyor.", "backend/app/fundamentals.py", null],
    ["Rastgele eğitim/test ayrımı ve aynı günün kapanışıyla işlem yapmak, sonuçları gerçekte olduğundan iyi gösteriyordu (veri sızıntısı, ileriye bakma).", "Veri zaman sırası korunarak bölünüyor; strateji testinde sinyal ertesi gün uygulanıyor (pos.shift(1)).", "backend/app/backtest.py", "run"],
    ["Model eğitimi birkaç saniye sürüyor, bu sırada sunucu diğer isteklere cevap veremiyordu.", "Ağır işler run_in_threadpool ile ayrı iş parçacığına aktarılıyor; arayüz donmuyor.", "backend/app/main.py", "predict"],
    ["LLM her zaman kullanılamayabilir: anahtar yok, internet yok ya da maliyet istenmiyor.", "Her LLM özelliğinin kural tabanlı bir yedeği var; uygulama LLM'e mecbur değil.", "backend/app/assistant.py", "rule_based"],
    ["PyTorch (LSTM için) exe'yi ~420 MB büyütüyordu ama sonuçları iyileştirmiyordu.", "LSTM isteğe bağlı yapıldı: PyTorch kuruluysa çalışıyor, exe paketinde yok.", "backend/app/seq_models.py", null],
    ["Uygulama farklı bir portta açılınca tarayıcı deposundaki tercihler (tema, favoriler, sekmeler) kayboluyordu.", "Önce sabit bir port aralığı deneniyor; ayrıca bütün tercihler kullanıcı bazında sunucuya da yazılıp açılışta geri yükleniyor.", "frontend/src/prefs.ts", null],
    ["Konsolsuz (penceresiz) exe'de bazı kütüphaneler ekrana yazmaya çalışınca program çöküyordu.", "Çıktı akışları yoksa boş bir hedefe (os.devnull) yönlendiriliyor.", "backend/desktop_app.py", null],
    ["Yeni özellikler eklendikçe tablolara sütun eklemek gerekti; eski kullanıcıların verisi bozulmamalıydı.", "Açılışta eksik sütunlar otomatik ekleniyor (_add_columns), eski alarm tablosu yeni yapıya taşınıyor (_migrate_alerts).", "backend/app/db.py", "_add_columns"],
    ["SPK halka arz onaylarını yalnızca haftalık PDF bülteninde yayımlıyor.", "Bülten PDF'leri pypdf ile okunup tablo verisine dönüştürülüyor.", "backend/app/spk.py", null],
    ["Uygulamanın adı FinAnaliz'den TradeMetrix'e değişti; eski kullanıcıların hesapları kaybolmamalıydı.", "Veri klasörünün eski adı (%APPDATA%\\FinAnaliz) bilinçli olarak korunuyor.", "backend/brand.py", null],
    ["Gram altın ve gram gümüş Yahoo'da doğrudan yok; vadeli işlem ve kur seansları farklı saatlerde kapanıyor.", "Ons fiyatı ve USD/TRY kuru gün bazında eşleştirilip gram fiyatı hesaplanıyor.", "backend/app/market.py", "_synthetic_history"],
  ];
  $("#chal").classList.add("chal");
  $("#chal").innerHTML = CH.map(([p, s, f, sym]) => `<div class="card"><p><b class="chal-p">Sorun:</b> ${p}</p><p><b class="chal-s">Çözüm:</b> ${s}</p><a class="code-link" href="#" data-code="${f}"${sym ? ` data-sym="${sym}"` : ""}>${f.split("/").pop()}${sym ? ` → ${sym}()` : ""}</a></div>`).join("");

  /* ---------- yeni slaytların konuşma notları ---------- */
  Object.assign(NOTES, {
    "Özellik haritası": ["Uygulamada 30 sayfa var. Bu ekranda her sayfanın ne yaptığını ve arkasında hangi kodun çalıştığını gösterebiliyorum.", "Örneğin Portföy sayfasını seçersem, arayüzün sunucudan hangi verileri istediğini ve bu istekleri hangi Python modüllerinin karşıladığını görüyoruz.", "Bu liste elle yazılmadı; kaynak koddan otomatik çıkarıldı, yani kod değiştikçe güncel kalıyor."],
    "Büyük resim: basit anlatım": ["Teknik ayrıntılara girmeden önce bütün sistemi bir restoran benzetmesiyle anlatmak istiyorum.", "Kullanıcı müşteri, arayüz salon ve menü, API garson, Python modülleri aşçılar, veritabanı kiler, Yahoo Finance de tedarikçi.", "Önemli nokta şu: arayüz hiçbir hesaplama yapmıyor, sadece gösteriyor. Bu ayrım sayesinde salonu değiştirsek bile, yani masaüstü yerine web sitesi yapsak bile, mutfak aynı kalıyor."],
    "API kataloğu": ["Arayüz ile sunucu arasındaki bütün iletişim bu adresler üzerinden oluyor; projede 128 tane var.", "GET veri okur, POST yeni bir şey oluşturur, PUT günceller, DELETE siler.", "Kilit işaretli olanlar oturum jetonu istiyor; giriş yapmamış biri bunlara erişemiyor. Herhangi bir satıra tıklayınca o isteğe cevap veren Python fonksiyonu açılıyor."],
    "Teknik göstergeler": ["Bu grafik THYAO'nun gerçek verisi; göstergeler uygulamadakiyle aynı formüllerle burada yeniden hesaplanıyor.", "Örneğin RSI 70'in üstüne çıktığında hisse çok hızlı yükselmiş demektir; 30'un altı ise çok hızlı düşmüş demektir.", "Bu göstergeler hem grafik ekranında kullanıcıya gösteriliyor hem de yapay zekâ modeline girdi olarak veriliyor."],
    "Strateji testi ve tarama": ["Strateji testi, bir kuralı geçmiş veride deneyip kazandırıp kazandırmayacağını ölçüyor.", "Burada iki ortalamanın kesişimine dayanan kuralı deniyorum; ayarları değiştirince sonuç anında yeniden hesaplanıyor.", "Dikkat çekmek istediğim nokta: ayarlar değişince sonuç çok oynuyor. Geçmişte en iyi çalışan ayarı seçmek, gelecekte de çalışacağı anlamına gelmiyor. Ayrıca sinyali ertesi gün uyguluyorum ki geleceği görme hatası olmasın."],
    "Modeller nasıl öğrenir?": ["Altı modeli matematiğe girmeden anlatayım.", "Lojistik regresyon her göstergeye bir ağırlık verip tek bir formül kuruyor. Rastgele Orman 300 karar ağacını oylatıyor. Gradyan Artırma ağaçları sırayla kurup her birine öncekinin hatasını düzelttiriyor. Sinir ağı katmanlı nöronlarla öğreniyor. ARIMA ise göstergelere bakmadan sadece fiyatın kendi geçmişine bakıyor.", "Hepsini aynı veriyle eğitip aynı test döneminde karşılaştırıyorum."],
    "Sanal hesap ve emirler": ["Kullanıcı 100.000 sanal TL ile gerçek fiyatlardan işlem yapıyor; para riske girmiyor.", "Gerçekçi olsun diye takas kurallarını da uyguladım: Borsa İstanbul'da para iki iş günü sonra kesin olarak çıkıyor, alım gücü de buna göre hesaplanıyor.", "Kullanıcı limit, zarar durdur ve kâr al emirleri verebiliyor; arka plan motoru dakikada bir fiyatı kontrol edip koşul gerçekleşince işlemi yapıyor ve bildirim gönderiyor."],
    "Bildirim, rapor ve eğitim": ["Analiz dışında uygulamayı günlük kullanımda faydalı kılan sistemler de var.", "Alarmlar ve gerçekleşen emirler Windows bildirimi olarak, istenirse Telegram'a da gidiyor. Portföy ve analizler Excel ya da PDF olarak indirilebiliyor.", "Ayrıca yeni başlayanlar için kısa dersler, haftalık tahmin oyunu ve rozetlerle bir öğrenme tarafı var."],
    "Zorluklar ve çözümler": ["Projenin en öğretici kısmı karşılaştığım sorunlar oldu. Birkaçını anlatayım.", "Mesela Yahoo Finance çok sık istek gelince engelliyordu; bunu önbellek ve devre kesiciyle çözdüm. Başka bir örnek: THY finansallarını dolarla raporladığı için oranlar yanlış çıkıyordu; TL'ye çevirerek düzelttim.", "Her kartın altında çözümün kodda nerede olduğu var; isterseniz açıp gösterebilirim."],
    "Sözlük": ["Sunum boyunca geçen teknik terimlerin hepsi burada sade bir açıklamayla toplu duruyor.", "Ayrıca slaytlarda altı noktalı çizgili kelimelerin üzerine gelince açıklaması çıkıyor."],
  });

  /* ---------- son adımlar ---------- */
  sections.forEach(s => { if (!["Sözlük", "Kaynak kod gezgini"].includes(s.dataset.title)) markTerms(s); });
  go(cur);
})();
