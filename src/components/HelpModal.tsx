// First-run welcome + always-available help. Explains what the tool is, the
// 3-step flow, and a plain-language legend of the symbols/colors a novice sees.
import { useEffect, useRef } from 'react'
import { EXAMPLES } from '../examples'
import type { WaveJson } from '../model/wavejson'

interface Props {
  onClose: () => void
  onStartBlank: () => void
  onLoadExample: (model: WaveJson) => void
}

const LEGEND: { sample: string; cls: string; name: string; desc: string }[] = [
  { sample: '1', cls: 'state-high', name: 'High（オン）', desc: '信号がON（電圧が高い）' },
  { sample: '0', cls: 'state-low', name: 'Low（オフ）', desc: '信号がOFF（電圧が低い）' },
  { sample: '⊓⊔', cls: 'state-clkp', name: 'クロック', desc: '一定の周期でカチカチ繰り返すON/OFF信号' },
  { sample: 'A0', cls: 'state-bus state-bus-3', name: 'バス（値）', desc: '複数bitをまとめた値。色は区間の区切り' },
  { sample: '✕', cls: 'state-x', name: '不定（X）', desc: '値が決まっていない状態' },
  { sample: 'Z', cls: 'state-z', name: 'Z', desc: 'どこにも繋がっていない（ハイインピーダンス）' },
  { sample: '┊', cls: 'state-gap', name: 'ギャップ', desc: '波形を省略する区切り' },
]

export function HelpModal({ onClose, onStartBlank, onLoadExample }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)

  // Focus the dialog on open; Esc closes; keep Tab focus inside the dialog.
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
        return
      }
      if (e.key !== 'Tab') return
      const focusables = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button, [href], select, input, [tabindex]:not([tabindex="-1"])',
      )
      if (!focusables || focusables.length === 0) return
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      prev?.focus?.() // restore focus to where it was
    }
  }, [onClose])

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        ref={dialogRef}
        className="help-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <button ref={closeRef} className="modal-close" onClick={onClose} aria-label="閉じる">
          ×
        </button>

        <h1 id="help-modal-title">タイミングチャート作図ツール</h1>
        <p className="help-lead">
          デジタル回路などの信号が、時間とともに <b>ON / OFF</b>{' '}
          する様子を波形で描く図（タイミングチャート）を、かんたんに作れます。
        </p>

        <h2>使い方（3ステップ）</h2>
        <ol className="help-steps">
          <li>
            <b>「＋信号」</b>で行を追加（または下にあるサンプルをそのまま編集）
          </li>
          <li>
            表の<b>マスをクリック</b>して <b>High / Low</b> を切り替え（
            <b>ドラッグ</b>で連続して塗れます）。上の「状態」から<b>クロック・バス</b>なども選べます
          </li>
          <li>
            右の<b>プレビュー</b>に図がその場で出ます。<b>「PNG」</b>で画像として保存
          </li>
        </ol>

        <h2>記号の見かた</h2>
        <ul className="legend">
          {LEGEND.map((l) => (
            <li key={l.name}>
              <span className={`legend-chip wave-cell ${l.cls}`}>{l.sample}</span>
              <span className="legend-text">
                <b>{l.name}</b> — {l.desc}
              </span>
            </li>
          ))}
        </ul>
        <h2>例から始める</h2>
        <div className="example-grid">
          {EXAMPLES.map((ex) => (
            <button key={ex.id} className="example-card" onClick={() => onLoadExample(ex.model)}>
              {ex.name}
            </button>
          ))}
        </div>

        <p className="help-note">
          間違えても <b>「戻す」(Ctrl+Z)</b> でいつでも元に戻せます。編集は自動保存されます。
        </p>

        <div className="help-actions">
          <button className="primary" onClick={onClose}>
            サンプルを見ながら始める
          </button>
          <button onClick={onStartBlank}>白紙から始める</button>
        </div>
      </div>
    </div>
  )
}
