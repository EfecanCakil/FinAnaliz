import { useEffect, useState } from 'react'
import { api } from '../api'
import { confetti } from '../components/fx'
import { Skeleton } from '../components/ui'

type Lesson = { id: string; icon: string; title: string; minutes: number; body: string[]; questions: { q: string; options: string[] }[]; score: number | null; completed: boolean }
type Result = { score: number; passed: boolean; correct: number[]; answers: number[] }

export default function Academy() {
  const [lessons, setLessons] = useState<Lesson[] | null>(null)
  const [open, setOpen] = useState<Lesson | null>(null)
  const [answers, setAnswers] = useState<number[]>([])
  const [result, setResult] = useState<Result | null>(null)
  const load = () => api<Lesson[]>('/academy').then(setLessons)
  useEffect(() => { load() }, [])
  const start = (l: Lesson) => { setOpen(l); setAnswers([]); setResult(null); window.scrollTo({ top: 0, behavior: 'smooth' }) }
  const submit = async () => {
    if (!open) return
    const r = await api<Result>(`/academy/${open.id}/submit`, { body: { answers } })
    setResult(r)
    if (r.passed) confetti()
    load()
  }
  const done = lessons?.filter(l => l.completed).length ?? 0

  return (
    <div className="page">
      <header className="page-head"><div><h1>Yatırım Akademisi</h1><p className="muted">Kısa derslerle temel kavramları öğrenin, mini testle kendinizi deneyin</p></div></header>
      {lessons && (
        <div className="card">
          <div className="row between"><b>İlerlemeniz</b><span className="muted">{done} / {lessons.length} ders tamamlandı</span></div>
          <div className="prob neutral mt"><div style={{ width: `${done / lessons.length * 100}%` }} /></div>
          <p className="muted small mt">3 ders tamamlayınca 🎓 "Öğrenci", tümünü tamamlayınca 🏛 "Akademi Mezunu" rozeti kazanırsınız. Bir dersi geçmek için testten en az %66 almanız gerekir.</p>
        </div>
      )}
      {open && (
        <div className="card lesson">
          <div className="row between"><h2>{open.icon} {open.title}</h2><button className="btn ghost small" onClick={() => setOpen(null)}>✕ Kapat</button></div>
          {open.body.map((p, i) => <p key={i} className="lesson-p">{p}</p>)}
          <h3 className="mt">Mini test</h3>
          {open.questions.map((q, i) => (
            <div key={i} className="quiz-q">
              <div className="strong">{i + 1}. {q.q}</div>
              <div className="quiz-opts">{q.options.map((o, k) => {
                const state = result ? (k === result.answers[i] ? 'right' : answers[i] === k ? 'wrong' : '') : answers[i] === k ? 'sel' : ''
                return <button key={k} className={`quiz-opt ${state}`} disabled={!!result} onClick={() => { const a = [...answers]; a[i] = k; setAnswers(a) }}>{o}</button>
              })}</div>
            </div>
          ))}
          {!result ? <button className="btn primary" disabled={answers.filter(a => a !== undefined).length < open.questions.length} onClick={submit}>Cevapları kontrol et</button> : (
            <div className={result.passed ? 'info-box' : 'error-box'}>
              {result.passed ? `🎉 Tebrikler! %${result.score} ile dersi tamamladınız.` : `%${result.score} — geçmek için en az %66 gerekiyor. Metni tekrar okuyup yeniden deneyin.`}
              {!result.passed && <button className="btn ghost small ml" onClick={() => { setAnswers([]); setResult(null) }}>Tekrar dene</button>}
            </div>
          )}
        </div>
      )}
      {!lessons ? <Skeleton rows={6} /> : (
        <div className="lesson-grid">
          {lessons.map((l, i) => (
            <button key={l.id} className={`lesson-card ${l.completed ? 'done' : ''}`} onClick={() => start(l)}>
              <div className="lesson-icon">{l.icon}</div>
              <div className="muted tiny">Ders {i + 1} · {l.minutes} dk</div>
              <div className="strong">{l.title}</div>
              <div className="small">{l.completed ? <span className="up">✓ Tamamlandı (%{l.score})</span> : <span className="muted">Başla →</span>}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
