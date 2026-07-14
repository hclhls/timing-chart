// First-run welcome + always-available help. Explains what the tool is, the
// 3-step flow, and a plain-language legend of the symbols/colors a novice sees.
import { useEffect, useRef } from 'react'
import { EXAMPLES } from '../examples'
import type { WaveJson } from '../model/wavejson'
import { useI18n } from '../i18n'

interface Props {
  onClose: () => void
  onStartBlank: () => void
  onLoadExample: (model: WaveJson) => void
}

const LEGEND: { sample: string; cls: string; name: Parameters<ReturnType<typeof useI18n>['t']>[0]; desc: Parameters<ReturnType<typeof useI18n>['t']>[0] }[] = [
  { sample: '1', cls: 'state-high', name: 'legend.highName', desc: 'legend.highDesc' },
  { sample: '0', cls: 'state-low', name: 'legend.lowName', desc: 'legend.lowDesc' },
  { sample: '⊓⊔', cls: 'state-clkp', name: 'legend.clockName', desc: 'legend.clockDesc' },
  { sample: 'A0', cls: 'state-bus state-bus-3', name: 'legend.busName', desc: 'legend.busDesc' },
  { sample: '✕', cls: 'state-x', name: 'legend.xName', desc: 'legend.xDesc' },
  { sample: 'Z', cls: 'state-z', name: 'legend.zName', desc: 'legend.zDesc' },
  { sample: '┊', cls: 'state-gap', name: 'legend.gapName', desc: 'legend.gapDesc' },
]

export function HelpModal({ onClose, onStartBlank, onLoadExample }: Props) {
  const { t } = useI18n()
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
        <button ref={closeRef} className="modal-close" onClick={onClose} aria-label={t('help.close')}>
          ×
        </button>

        <h1 id="help-modal-title">{t('help.title')}</h1>
        <p className="help-lead">{t('help.lead')}</p>

        <h2>{t('help.stepsTitle')}</h2>
        <ol className="help-steps">
          <li>{t('help.step1')}</li>
          <li>{t('help.step2')}</li>
          <li>{t('help.step3')}</li>
        </ol>

        <h2>{t('help.legendTitle')}</h2>
        <ul className="legend">
          {LEGEND.map((l) => (
            <li key={l.name}>
              <span className={`legend-chip wave-cell ${l.cls}`}>{l.sample}</span>
              <span className="legend-text">
                <b>{t(l.name)}</b> - {t(l.desc)}
              </span>
            </li>
          ))}
        </ul>
        <h2>{t('help.examplesTitle')}</h2>
        <div className="example-grid">
          {EXAMPLES.map((ex) => (
            <button key={ex.id} className="example-card" onClick={() => onLoadExample(ex.model)}>
              {t(`example.${ex.id}` as Parameters<typeof t>[0])}
            </button>
          ))}
        </div>

        <p className="help-note">{t('help.note')}</p>

        <div className="help-actions">
          <button className="primary" onClick={onClose}>
            {t('help.startExample')}
          </button>
          <button onClick={onStartBlank}>{t('help.startBlank')}</button>
        </div>
      </div>
    </div>
  )
}
