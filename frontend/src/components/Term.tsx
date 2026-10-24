import type { ReactNode } from 'react'

// Yeni başlayanlar için terim sözlüğü: terimin üzerine gelince kısa açıklama çıkar.
export const GLOSSARY: Record<string, string> = {
  rsi: 'RSI (Göreceli Güç Endeksi): Fiyatın son 14 günde ne kadar hızlı yükselip düştüğünü 0–100 arası ölçer. 70 üstü "çok yükselmiş", 30 altı "çok düşmüş" demektir.',
  macd: 'MACD: İki hareketli ortalamanın farkıdır. Sinyal çizgisini yukarı keserse yükseliş, aşağı keserse düşüş sinyali sayılır.',
  sma: 'Hareketli ortalama (SMA): Son N günün ortalama fiyatı. Fiyat ortalamanın üzerindeyse trend genelde yukarıdır.',
  sma50: '50 günlük ortalama: Yaklaşık son 2,5 ayın ortalama fiyatı; orta vadeli trendi gösterir.',
  sma200: '200 günlük ortalama: Yaklaşık son 10 ayın ortalama fiyatı; uzun vadeli trendin en çok bakılan göstergesi.',
  bollinger: 'Bollinger bantları: Fiyatın normal dalgalanma aralığı. Üst banda değmesi pahalı, alt banda değmesi ucuz olabileceğine işaret eder.',
  pe: 'F/K (Fiyat/Kazanç): Şirketin piyasa değerinin yıllık kârına oranı. "Kârıyla kendini kaç yılda öder?" sorusunun cevabıdır; düşük olması genelde ucuzluk işaretidir.',
  pb: 'PD/DD (Piyasa Değeri/Defter Değeri): Şirketin borsa değerinin, şirketin kayıtlı öz varlığına oranı. 1\'in altı, şirketin varlıklarından daha ucuza satıldığı anlamına gelebilir.',
  dividend_yield: 'Temettü verimi: Şirketin son bir yılda dağıttığı kâr payının hisse fiyatına oranı. %5 verim, 100 TL\'lik hisse için yılda yaklaşık 5 TL nakit demektir.',
  market_cap: 'Piyasa değeri: Şirketin tüm hisselerinin borsadaki toplam değeri (hisse fiyatı × hisse sayısı). Şirketin büyüklüğünü gösterir.',
  roe: 'Özkaynak kârlılığı (ROE): Şirketin ortaklarının parasıyla ne kadar kâr ettiği. %20 ROE, 100 TL özkaynakla yılda 20 TL kâr demektir.',
  profit_margin: 'Net kâr marjı: Satışların yüzde kaçının net kâra dönüştüğü. Yüksek olması şirketin verimli çalıştığını gösterir.',
  volatility: 'Oynaklık: Fiyatın ne kadar sert dalgalandığı. Yüksek oynaklık, hem kazanç hem kayıp ihtimalinin büyük olduğu anlamına gelir.',
  volume: 'Hacim: O gün ne kadar alım-satım yapıldığı. Normalin çok üzerindeki hacim, hisseye özel bir ilgi veya haber olduğunu gösterir.',
  high_52w: '52 haftalık aralık: Son bir yılın en düşük ve en yüksek fiyatı. Fiyatın bu aralıkta nerede durduğunu gösterir.',
  t2: 'T+2 takas: Borsa İstanbul\'da hisse alım-satımında paranın ve hissenin el değiştirmesi işlemden 2 iş günü sonra tamamlanır.',
  signal: 'Teknik görünüm: RSI, MACD, hareketli ortalamalar ve Bollinger bantlarının ortak "oyu". Güçlü Al / Al / Nötr / Sat / Güçlü Sat. Yatırım tavsiyesi değildir.',
  golden_cross: 'Altın kesişim: 50 günlük ortalamanın 200 günlük ortalamayı yukarı kesmesi; uzun vadeli yükseliş sinyali olarak bilinir.',
  death_cross: 'Ölüm kesişimi: 50 günlük ortalamanın 200 günlük ortalamayı aşağı kesmesi; uzun vadeli düşüş sinyali olarak bilinir.',
  bedelli: 'Bedelli sermaye artırımı: Şirket yeni pay çıkarır; mevcut ortaklar bu payları genelde nominal değerden (1 TL) parayla alma hakkına (rüçhan) sahip olur. Şirkete nakit girer.',
  bedelsiz: 'Bedelsiz sermaye artırımı: Şirket kendi kaynaklarından (yedekler, kâr) ortaklarına ücretsiz pay dağıtır. Şirketin değeri değişmez; hisse fiyatı aynı oranda bölünür.',
  halka_arz: 'Halka arz: Bir şirketin paylarını ilk kez borsada yatırımcılara satması. SPK onayından sonra talep toplanır, ardından paylar borsada işlem görmeye başlar.',
  kap: 'KAP (Kamuyu Aydınlatma Platformu): Borsa şirketlerinin önemli gelişmeleri (bilanço, temettü, yeni iş vb.) resmi olarak duyurduğu platform.',
}

export default function Term({ k, children }: { k: keyof typeof GLOSSARY | string; children: ReactNode }) {
  const text = GLOSSARY[k]
  if (!text) return <>{children}</>
  return <span className="term" tabIndex={0} data-tip={text}>{children}</span>
}
