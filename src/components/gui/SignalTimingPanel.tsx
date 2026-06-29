import { useEditor } from '../../state/store'
import { flattenSignals } from '../../state/selectors'
import { setSignalPeriod, setSignalPhase } from '../../state/actions'

function pathEq(a: number[] | null, b: number[]): boolean {
  if (!a || a.length !== b.length) return false
  return a.every((v, i) => v === b[i])
}

/**
 * Per-signal clock period (time stretch / divider) and phase. Lets a novice
 * build clk/2, clk/4 etc. without hand-editing JSON — WaveDrom honours these
 * natively in the preview. The grid stays 1-char-per-tick (see the period≠1
 * warning in SignalTable), so this is an "advanced" panel.
 */
export function SignalTimingPanel() {
  const model = useEditor((s) => s.model)
  const applyGuiModel = useEditor((s) => s.applyGuiModel)
  const selectedPath = useEditor((s) => s.selectedPath)

  if (!selectedPath) {
    return (
      <div className="bus-panel muted">信号を選ぶと、周期（分周）と位相を設定できます</div>
    )
  }
  const row = flattenSignals(model).find((r) => pathEq(r.path, selectedPath))
  const sig = row?.signal
  if (!sig) {
    return <div className="bus-panel muted">信号を選択してください</div>
  }
  const period = sig.period ?? 1
  const phase = sig.phase ?? 0

  return (
    <div className="timing-panel">
      <div className="bus-panel-title">「{sig.name || '(無名)'}」の周期・位相</div>
      <label className="labels-row">
        周期（分周比）
        <input
          type="number"
          min={0.1}
          step={1}
          value={period}
          onChange={(e) =>
            applyGuiModel(
              setSignalPeriod(model, selectedPath, Number(e.target.value)),
              `period:${selectedPath.join(',')}`,
            )
          }
        />
      </label>
      <label className="labels-row">
        位相（ずらし）
        <input
          type="number"
          step={0.5}
          value={phase}
          onChange={(e) =>
            applyGuiModel(
              setSignalPhase(model, selectedPath, Number(e.target.value)),
              `phase:${selectedPath.join(',')}`,
            )
          }
        />
      </label>
      <div className="muted timing-hint">
        例: クロックの<b>周期</b>を 2 にすると、周期 1 の信号より<b>2倍ゆっくり</b>の分周クロック
        （clk/2）になります。<b>位相</b>は開始位置のずらしです。値を変えると右のプレビューに反映されます。
      </div>
    </div>
  )
}
