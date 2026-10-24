// Teknik hata mesajlarını kullanıcının anlayacağı sade Türkçeye çevirir.
const TECH = /(Traceback|Exception|Error\b|errno|HTTPS?Connection|timed? ?out|Max retries|urlopen|JSONDecode|NoneType|KeyError|delisted|getaddrinfo|SSL)/i

export function friendlyMessage(status: number, msg: string): string {
  if (status === 0) return 'İnternete veya uygulama sunucusuna bağlanılamadı. Bağlantınızı kontrol edip tekrar deneyin.'
  const head = msg.split(':')[0].trim()
  if (status === 502 || status === 503 || status === 504)
    return `${head || 'Veri kaynağına ulaşılamadı'}. İnternet bağlantınızı kontrol edin veya biraz sonra tekrar deneyin.`
  if (status >= 500) return TECH.test(msg) || !msg ? 'Beklenmeyen bir sorun oluştu. Lütfen biraz sonra tekrar deneyin.' : msg
  if (TECH.test(msg)) return head && !TECH.test(head) ? `${head}.` : 'İşlem tamamlanamadı. Lütfen tekrar deneyin.'
  return msg
}

export function friendlyError(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}
