import { useEditor } from '../../state/store'
import { flattenSignals, maxTicks, type Row } from '../../state/selectors'
import {
  setCellState,
  extendCell,
  setSignalName,
  addSignal,
  addSpacer,
  removeRow,
  moveRow,
  addTick,
  removeTick,
} from '../../state/actions'
import { expandWave, CYCLE_STATES, isBusState, dataIndexAtTick } from '../../model/wave-codec'
import { dataToArray } from '../../model/wavejson'
import { WaveCell } from './WaveCell'

function cycle(value: string, dir: 1 | -1): string {
  const states = CYCLE_STATES as readonly string[]
  const idx = states.indexOf(value)
  // Unknown state (d/u/h/l/H/L/2..9/'|'/sub-cycle '<>') — leave it untouched
  // rather than clobbering a valid waveform the GUI can't yet cycle through.
  if (idx < 0) return value
  return states[(idx + dir + states.length) % states.length]
}

export function SignalTable() {
  const model = useEditor((s) => s.model)
  const applyGuiModel = useEditor((s) => s.applyGuiModel)
  const selectedPath = useEditor((s) => s.selectedPath)
  const setSelectedPath = useEditor((s) => s.setSelectedPath)

  const rows = flattenSignals(model)
  const ticks = maxTicks(model)
  const tickArray = Array.from({ length: ticks }, (_, i) => i)

  const onCellClick = (path: number[], tick: number, e: React.MouseEvent) => {
    if (e.altKey) {
      if (tick === 0) return // tick 0 has nothing to extend from
      applyGuiModel(extendCell(model, path, tick))
      return
    }
    const sig = rowSignalAt(rows, path)
    const cells = expandWave(sig?.wave ?? '')
    const cur = cells[tick]?.value ?? '0'
    const next = cycle(cur, e.shiftKey ? -1 : 1)
    if (next === cur) return // unknown state — no-op, don't churn the model
    applyGuiModel(setCellState(model, path, tick, next))
  }

  return (
    <section className="signal-table">
      <div className="pane-title">信号エディタ</div>

      <div className="table-toolbar">
        <button onClick={() => applyGuiModel(addSignal(model))}>＋信号</button>
        <button onClick={() => applyGuiModel(addSpacer(model))}>＋空行</button>
        <span className="sep" />
        <button onClick={() => applyGuiModel(removeTick(model))} title="tickを減らす">
          − tick
        </button>
        <span className="tick-count">{ticks} tick</span>
        <button onClick={() => applyGuiModel(addTick(model))} title="tickを増やす">
          ＋ tick
        </button>
      </div>

      <div className="table-scroll">
        <table className="grid">
          <thead>
            <tr>
              <th className="name-col">信号</th>
              <th className="ctrl-col" />
              {tickArray.map((t) => (
                <th key={t} className="tick-head">
                  {t}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => {
              const key = row.path.join('-') + ':' + ri
              if (row.kind === 'group-label') {
                return (
                  <tr key={key} className="group-row">
                    <td colSpan={2 + ticks} style={{ paddingLeft: row.depth * 12 }}>
                      ▸ {row.label}
                    </td>
                  </tr>
                )
              }
              if (row.kind === 'spacer') {
                return (
                  <tr key={key} className="spacer-row">
                    <td className="name-col">
                      <span className="spacer-label">— 空行 —</span>
                    </td>
                    <td className="ctrl-col">
                      <RowControls path={row.path} />
                    </td>
                    <td colSpan={ticks} />
                  </tr>
                )
              }
              const sig = row.signal!
              const cells = expandWave(sig.wave ?? '')
              const data = dataToArray(sig.data)
              const selected = pathEq(selectedPath, row.path)
              return (
                <tr
                  key={key}
                  className={selected ? 'sig-row selected' : 'sig-row'}
                  onClick={() => setSelectedPath(row.path)}
                >
                  <td className="name-col" style={{ paddingLeft: 4 + row.depth * 12 }}>
                    <input
                      className="name-input"
                      aria-label="信号名"
                      placeholder="信号名"
                      value={sig.name ?? ''}
                      onChange={(e) =>
                        applyGuiModel(setSignalName(model, row.path, e.target.value))
                      }
                      onClick={(e) => e.stopPropagation()}
                    />
                  </td>
                  <td className="ctrl-col">
                    <RowControls path={row.path} />
                  </td>
                  {tickArray.map((t) => {
                    const cell = cells[t] ?? { value: '', head: false }
                    let label = ''
                    if (isBusState(cell.value)) {
                      const di = dataIndexAtTick(sig.wave ?? '', t)
                      if (di >= 0) label = data[di] ?? ''
                    }
                    return (
                      <td key={t} className="cell-td">
                        <WaveCell
                          value={cell.value}
                          isHead={cell.head}
                          busLabel={label}
                          onClick={(e) => {
                            e.stopPropagation()
                            setSelectedPath(row.path)
                            onCellClick(row.path, t, e)
                          }}
                        />
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="hint">
        クリック=状態送り / Shift+クリック=戻し / Alt+クリック=直前を延長
      </p>
    </section>
  )
}

function RowControls({ path }: { path: number[] }) {
  const model = useEditor((s) => s.model)
  const applyGuiModel = useEditor((s) => s.applyGuiModel)
  const setSelectedPath = useEditor((s) => s.setSelectedPath)
  const topLevel = path.length === 1
  // Indices shift on remove/move, so any held selection would now point at a
  // different signal — deselect to avoid silently editing the wrong row.
  const restructure = (next: ReturnType<typeof moveRow>) => {
    setSelectedPath(null)
    applyGuiModel(next)
  }
  return (
    <span className="row-controls" onClick={(e) => e.stopPropagation()}>
      <button
        disabled={!topLevel}
        onClick={() => restructure(moveRow(model, path, -1))}
        title="上へ"
        aria-label="信号を上へ移動"
      >
        ▲
      </button>
      <button
        disabled={!topLevel}
        onClick={() => restructure(moveRow(model, path, 1))}
        title="下へ"
        aria-label="信号を下へ移動"
      >
        ▼
      </button>
      <button
        onClick={() => restructure(removeRow(model, path))}
        title="削除"
        aria-label="この信号を削除"
      >
        ×
      </button>
    </span>
  )
}

function rowSignalAt(rows: Row[], path: number[]) {
  const r = rows.find((row) => pathEq(row.path, path))
  return r?.signal
}

function pathEq(a: number[] | null, b: number[]): boolean {
  if (!a || a.length !== b.length) return false
  return a.every((v, i) => v === b[i])
}
