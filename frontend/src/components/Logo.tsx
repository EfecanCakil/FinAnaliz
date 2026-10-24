import { useId } from 'react'

// TradeMetrix logosu: arkada büyüyen metrik çubukları, önde "M" biçiminde yükselen fiyat çizgisi ve ok.
export const APP_NAME = 'TradeMetrix'

export function LogoMark({ size = 32, bars = true, className = '' }: { size?: number; bars?: boolean; className?: string }) {
  const id = useId().replace(/:/g, '')
  return (
    <svg className={`logo-mark ${className}`} width={size} height={size} viewBox="0 0 64 64" role="img" aria-label={APP_NAME}>
      <defs>
        <linearGradient id={`bg${id}`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#10264a" /><stop offset="1" stopColor="#0a1528" /></linearGradient>
        <linearGradient id={`ln${id}`} x1="0" y1="1" x2="1" y2="0"><stop offset="0" stopColor="#22d3ee" /><stop offset="1" stopColor="#4ade80" /></linearGradient>
      </defs>
      <rect width="64" height="64" rx="15" fill={`url(#bg${id})`} />
      {bars && (
        <g className="lm-bars" fill="#1f3b63">
          <rect x="13" y="40" width="8" height="13" rx="2" />
          <rect x="28" y="31" width="8" height="22" rx="2" />
          <rect x="43" y="23" width="8" height="30" rx="2" />
        </g>
      )}
      <polyline className="lm-line" points="11,46 21,23 32,37 43,20 50,14" fill="none" stroke={`url(#ln${id})`} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      <path className="lm-arrow" d="M47 9 L56 8 L55 17 Z" fill="#4ade80" />
      <circle className="lm-dot" cx="21" cy="23" r="2.8" fill="#fff" />
      <circle className="lm-dot" cx="43" cy="20" r="2.8" fill="#fff" />
    </svg>
  )
}

export function Wordmark({ className = '' }: { className?: string }) {
  return <span className={`wordmark ${className}`}>Trade<span className="wm-accent">Metrix</span></span>
}
