import { useEditor } from '../../state/store'
import { flattenSignals } from '../../state/selectors'
import { setDataLabel } from '../../state/actions'
import { busSegmentCount } from '../../model/wave-codec'
import { dataToArray } from '../../model/wavejson'

function pathEq(a: number[] | null, b: number[]): boolean {
  if (!a || a.length !== b.length) return false
  return a.every((v, i) => v === b[i])
}

/** Edit the data[] labels of the selected signal's bus segments. */
export function BusDataPanel() {
  const model = useEditor((s) => s.model)
  const applyGuiModel = useEditor((s) => s.applyGuiModel)
  const selectedPath = useEditor((s) => s.selectedPath)

  if (!selectedPath) {
    return <div className="bus-panel muted">信号を選択するとバス値を編集できます</div>
  }
  const row = flattenSignals(model).find((r) => pathEq(r.path, selectedPath))
  const sig = row?.signal
  if (!sig) {
    return <div className="bus-panel muted">信号を選択してください</div>
  }
  const segments = sig.wave ? busSegmentCount(sig.wave) : 0
  const data = dataToArray(sig.data)

  if (segments === 0) {
    return (
      <div className="bus-panel muted">
        「{sig.name || '(無名)'}」にバス区間はありません。状態「バス（値）」でマスを塗ると作れます。
      </div>
    )
  }

  return (
    <div className="bus-panel">
      <div className="bus-panel-title">「{sig.name || '(無名)'}」のバスに流す値</div>
      <div className="bus-chips">
        {Array.from({ length: segments }, (_, i) => (
          <label key={i} className="bus-chip">
            <span className="chip-index">{i + 1}つ目</span>
            <input
              value={data[i] ?? ''}
              placeholder="例: 0xFF"
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
