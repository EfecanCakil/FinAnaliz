// Menü yapısı: benzer sayfalar tek bir bölümde toplanır, bölüm içinde sekmelerle gezilir.
// "advanced" işaretli sayfa/bölümler yalnızca Gelişmiş modda menüde görünür (adresle açılınca yine çalışır).
export type Page = { to: string; label: string; icon: string; desc: string; advanced?: boolean }
export type Section = { id: string; label: string; icon: string; pages: Page[]; advanced?: boolean; bottom?: boolean }

export const SECTIONS: Section[] = [
  { id: 'home', label: 'Ana Sayfa', icon: '🏠', pages: [
    { to: '/', label: 'Piyasa Özeti', icon: '◧', desc: 'Günün özeti, portföyünüz, favorileriniz ve piyasaların genel durumu tek bakışta.' },
    { to: '/bulten', label: 'Günün Bülteni', icon: '📝', desc: 'Her sabah hazırlanan kısa piyasa bülteni: dün ne oldu, bugün nelere dikkat etmeli.' },
  ] },
  { id: 'markets', label: 'Piyasalar', icon: '📊', pages: [
    { to: '/piyasa/bist', label: 'Borsa İstanbul', icon: '🏛', desc: 'Borsa İstanbul\'daki tüm hisseler. ★ ile favorilere ekleyin, hisseye tıklayınca özet kartı açılır.' },
    { to: '/piyasa/abd', label: 'ABD Borsaları', icon: '🗽', desc: 'S&P 500 şirketleri ve ABD endeksleri.' },
    { to: '/piyasa/doviz', label: 'Döviz & Emtia', icon: '💱', desc: 'Dolar, euro, altın, gümüş ve petrol gibi döviz ve emtia fiyatları.' },
    { to: '/piyasa/kripto', label: 'Kripto', icon: '₿', desc: 'Bitcoin, Ethereum ve diğer büyük kripto paralar.' },
    { to: '/piyasa/harita', label: 'Isı Haritası', icon: '🟩', desc: 'Piyasanın renkli haritası: yeşil yükselen, kırmızı düşen hisseler. Kutu ne kadar büyükse şirket o kadar büyük.' },
    { to: '/temettu', label: 'Temettü', icon: '💰', desc: 'Kâr payı (temettü) dağıtan şirketler ve verimleri.' },
    { to: '/halka-arz', label: 'Halka Arz', icon: '🚀', desc: 'Borsa İstanbul (SPK) ve ABD halka arzları: yaklaşan ve onaylanan halka arzlar, bekleyen başvurular, geçmiş halka arzların getirisi, bedelli/bedelsiz sermaye artırımları. Yeni gelişmelerde bildirim alırsınız.' },
  ] },
  { id: 'news', label: 'Haberler', icon: '📰', pages: [
    { to: '/haberler', label: 'Haberler', icon: '📰', desc: 'Piyasa ve şirket haberleri; her haberin olumlu/olumsuz etkisi otomatik değerlendirilir.' },
    { to: '/kap', label: 'KAP', icon: '📢', desc: 'Şirketlerin Kamuyu Aydınlatma Platformu\'na yaptığı resmi açıklamalar.' },
    { to: '/takvim', label: 'Ekonomik Takvim', icon: '📅', desc: 'Faiz kararı, enflasyon gibi piyasayı etkileyebilecek önemli veri açıklamalarının takvimi.' },
  ] },
  { id: 'analysis', label: 'Analiz', icon: '📈', pages: [
    { to: '/analiz', label: 'Teknik Analiz', icon: '📈', desc: 'Grafik ve göstergeler (RSI, MACD, ortalamalar). "🧠 Grafiği yorumla" ile yapay zekâdan sade bir yorum alın.' },
    { to: '/temel', label: 'Temel Analiz', icon: '🏢', desc: 'Şirketin bilançosu ve oranları: F/K, PD/DD, kârlılık, borçluluk. Şirket ucuz mu, sağlam mı?' },
    { to: '/karsilastir', label: 'Karşılaştırma', icon: '⇄', desc: 'Birden fazla varlığı getiri, risk ve temel oranlarda yan yana karşılaştırın.' },
    { to: '/coklu-grafik', label: 'Çoklu Grafik', icon: '▦', desc: 'Dört grafiği aynı anda izleyin.', advanced: true },
  ] },
  { id: 'screener', label: 'Hisse Bul', icon: '🔍', pages: [
    { to: '/tarama', label: 'Teknik Tarama', icon: '🔍', desc: 'Yüzlerce hisse arasından aradığınız duruma uyanları bulur: "çok düşmüş olanlar", "yükseliş trendindekiler" gibi.' },
  ] },
  { id: 'predict', label: 'YZ Tahmin', icon: '🤖', pages: [
    { to: '/tahmin', label: 'YZ Tahmin', icon: '🤖', desc: 'Yapay zekâ modellerinin önümüzdeki günler için fiyat tahmini ve güven aralığı. Tahminler kesin değildir.' },
  ] },
  { id: 'portfolio', label: 'Portföyüm', icon: '💼', pages: [
    { to: '/portfoy', label: 'Portföy', icon: '💼', desc: '100.000 TL sanal bakiyeyle al-sat yapın; varlıklarınızı, kâr/zararınızı ve işlemlerinizi buradan izleyin.' },
    { to: '/portfoyler', label: 'Portföylerim', icon: '🗂', desc: 'Ayrı bakiyeli ek portföyler (ör. Uzun vade, Deneme, Kripto) oluşturun, aralarında geçiş yapın ve performanslarını karşılaştırın.' },
    { to: '/hedefler', label: 'Hedefler & Reel Getiri', icon: '🎯', desc: 'Birikim hedefinizi planlayın (ne kadar biriktirmeli, ulaşma olasılığı) ve kazancınızın enflasyonu yenip yenmediğini görün.' },
    { to: '/izleme', label: 'Favoriler & Alarmlar', icon: '🔔', desc: 'Favori hisseleriniz ve fiyat alarmlarınız. Alarm çalınca bildirim alırsınız.' },
    { to: '/basarilar', label: 'Başarılar', icon: '🏅', desc: 'Kazandığınız rozetler ve yatırım karneniz.', advanced: true },
  ] },
  { id: 'learn', label: 'Öğren', icon: '🎓', pages: [
    { to: '/akademi', label: 'Yatırım Akademisi', icon: '🎓', desc: 'Kısa derslerle borsa ve yatırımın temellerini öğrenin, testlerle kendinizi deneyin.' },
    { to: '/tahmin-oyunu', label: 'Tahmin Oyunu', icon: '🎯', desc: 'Yarın yükselir mi, düşer mi? Tahmin edin, puan toplayın.' },
  ] },
  { id: 'tools', label: 'Araçlar', icon: '🧰', advanced: true, pages: [
    { to: '/backtest', label: 'Strateji Testi', icon: '⏱', desc: 'Bir al-sat stratejisi geçmişte uygulansaydı ne kazandırırdı?' },
    { to: '/botlar', label: 'Strateji Botları', icon: '⚙️', desc: 'Kurduğunuz kurala göre sizin yerinize otomatik al-sat yapan botlar.' },
    { to: '/laboratuvar', label: 'Portföy Laboratuvarı', icon: '🧪', desc: 'En iyi dağılım, risk simülasyonu ve senaryo analizleri.' },
    { to: '/sektor-rotasyonu', label: 'Sektör Rotasyonu', icon: '🔄', desc: 'Hangi sektörler güçleniyor, hangileri zayıflıyor?' },
    { to: '/zaman-makinesi', label: 'Geçmişe Yolculuk', icon: '⏳', desc: '"X yıl önce şuna yatırsaydım bugün ne olurdu?" hesaplayıcısı.' },
  ] },
  { id: 'account', label: 'Hesabım', icon: '👤', bottom: true, pages: [
    { to: '/profil', label: 'Profilim', icon: '👤', desc: 'Hesap bilgileriniz ve özet istatistikleriniz.' },
    { to: '/ayarlar', label: 'Ayarlar', icon: '⚙', desc: 'Görünüm, bildirimler, yapay zekâ ve uygulama ayarları.' },
  ] },
]

export const ALL_PAGES: Page[] = SECTIONS.flatMap(s => s.pages)

export function sectionOf(path: string): { section: Section; page: Page } | null {
  const p = path.split('?')[0]
  let best: { section: Section; page: Page } | null = null
  for (const section of SECTIONS) {
    for (const page of section.pages) {
      if (page.to === p || (page.to !== '/' && p.startsWith(page.to + '/')) || (page.to !== '/' && p === page.to)) {
        if (!best || page.to.length > best.page.to.length) best = { section, page }
      }
    }
  }
  return best
}

export const visiblePages = (s: Section, advanced: boolean) => s.pages.filter(p => advanced || !p.advanced)
export const visibleSections = (advanced: boolean) => SECTIONS.filter(s => advanced || !s.advanced)
