import { useEditor } from '../../state/store'
import { flattenSignals } from '../../state/selectors'
import { setDataLabel } from '../../state/actions'
import { busSegmentCount } from '../../model/wave-codec'
import { dataToArray } from '../../model/wavejson'
import { useI18n } from '../../i18n'

function pathEq(a: number[] | null, b: number[]): boolean {
  if (!a || a.length !== b.length) return false
  return a.every((v, i) => v === b[i])
}

/** Edit the data[] labels of the selected signal's bus segments. */
export function BusDataPanel() {
  const { t } = useI18n()
  const model = useEditor((s) => s.model)
  const applyGuiModel = useEditor((s) => s.applyGuiModel)
  const selectedPath = useEditor((s) => s.selectedPath)

  if (!selectedPath) {
    return <div className="bus-panel muted">{t('bus.selectHint')}</div>
  }
  const row = flattenSignals(model).find((r) => pathEq(r.path, selectedPath))
  const sig = row?.signal
  if (!sig) {
    return <div className="bus-panel muted">{t('bus.selectSignal')}</div>
  }
  const segments = sig.wave ? busSegmentCount(sig.wave) : 0
  const data = dataToArray(sig.data)

  if (segments === 0) {
    return (
      <div className="bus-panel muted">
        {t('bus.noSegments', { name: sig.name || t('app.unnamed') })}
      </div>
    )
  }

  return (
    <div className="bus-panel">
      <div className="bus-panel-title">{t('bus.title', { name: sig.name || t('app.unnamed') })}</div>
      <div className="bus-chips">
        {Array.from({ length: segments }, (_, i) => (
          <label key={i} className="bus-chip">
            <span className="chip-index">{t('bus.index', { index: i + 1 })}</span>
            <input
              value={data[i] ?? ''}
              placeholder={t('bus.placeholder')}
              onChange={(e) =>
                applyGuiModel(
                  setDataLabel(model, selectedPath, i, e.target.value),
                  `data:${selectedPath.join(',')}:${i}`,
                )
              }
            />
          </label>
        ))}
      </div>
    </div>
  )
}
