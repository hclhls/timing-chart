import { useEffect, useState } from 'react'
import { useEditor } from '../../state/store'
import { flattenSignals, maxTicks, type Row } from '../../state/selectors'
import {
  setCellState,
  extendCell,
  setSignalName,
  addSignal,
  addSpacer,
  addGroup,
  setGroupLabel,
  removeGroup,
  addSignalToGroup,
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

/** Brush palette: every state authorable by click, incl. bus 2-9 and gap. */
const PALETTE: { v: string; t: string }[] = [
  { v: '0', t: 'Low' },
  { v: '1', t: 'High' },
  { v: 'p', t: 'クロック正' },
  { v: 'n', t: 'クロック負' },
  { v: 'P', t: 'クロック正(矢印)' },
  { v: 'N', t: 'クロック負(矢印)' },
  { v: 'x', t: '不定 X' },
  { v: 'z', t: 'ハイZ' },
  { v: '=', t: 'バス =' },
  { v: '2', t: 'バス 2' },
  { v: '3', t: 'バス 3' },
  { v: '4', t: 'バス 4' },
  { v: '5', t: 'バス 5' },
  { v: '6', t: 'バス 6' },
  { v: '7', t: 'バス 7' },
  { v: '8', t: 'バス 8' },
  { v: '9', t: 'バス 9' },
  { v: '|', t: 'ギャップ' },
]

function brushClasses(v: string): string {
  if (v === '=') return 'palette-btn state-bus state-bus-eq'
  if (isBusState(v)) return `palette-btn state-bus state-bus-${v}`
  return 'palette-btn'
}

export function SignalTable() {
  const model = useEditor((s) => s.model)
  const applyGuiModel = useEditor((s) => s.applyGuiModel)
  const selectedPath = useEditor((s) => s.selectedPath)
  const setSelectedPath = useEditor((s) => s.setSelectedPath)

  // Active "brush": when set, clicking a cell paints that state; when null,
  // clicking cycles through the common states (the default behavior).
  const [brush, setBrush] = useState<string | null>(null)
  // Disarm the brush when a new document is loaded so the first click on the
  // new doc cycles (as expected) instead of painting the stale brush.
  const loadEpoch = useEditor((s) => s.loadEpoch)
  useEffect(() => setBrush(null), [loadEpoch])

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
    if (brush !== null) {
      // No-op only when this exact cell already starts that state. A missing
      // (beyond-wave) or extension cell must still be paintable — otherwise a
      // '0' brush can't draw on a short signal's tail.
      const c = cells[tick]
      if (c && c.head && c.value === brush) return
      applyGuiModel(setCellState(model, path, tick, brush))
      return
    }
    const next = cycle(cur, e.shiftKey ? -1 : 1)
    if (next === cur) return // unknown state — no-op, don't churn the model
    applyGuiModel(setCellState(model, path, tick, next))
  }

  return (
    <section className="signal-table">
      <div className="pane-title">信号エディタ</div>

      <div className="table-toolbar">
        <button onClick={() => applyGuiModel(addSignal(model))}>＋信号</button>
        <button onClick={() => applyGuiModel(addGroup(model))}>＋グループ</button>
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

      <div className="brush-palette" role="group" aria-label="ペン（状態ブラシ）">
        <span className="brush-label">ペン</span>
        <button
          className={brush === null ? 'palette-btn active' : 'palette-btn'}
          onClick={() => setBrush(null)}
          title="クリックで状態を順送り（既定）"
          aria-pressed={brush === null}
        >
          サイクル
        </button>
        {PALETTE.map(({ v, t }) => (
          <button
            key={v}
            className={brush === v ? `${brushClasses(v)} active` : brushClasses(v)}
            onClick={() => setBrush(brush === v ? null : v)}
            title={t}
            aria-label={t}
            aria-pressed={brush === v}
          >
            {v}
          </button>
        ))}
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
                    <td colSpan={2 + ticks} style={{ paddingLeft: 4 + row.depth * 12 }}>
                      <span className="group-caret">▸</span>
                      <input
                        className="group-input"
                        aria-label="グループ名"
                        value={row.label ?? ''}
                        onChange={(e) =>
                          applyGuiModel(setGroupLabel(model, row.path, e.target.value), true)
                        }
                      />
                      <span className="group-controls">
                        <button
                          onClick={() => {
                            const next = moveRow(model, row.path.slice(0, -1), -1)
                            if (next !== model) {
                              setSelectedPath(null)
                              applyGuiModel(next)
                            }
                          }}
                          title="グループを上へ"
                          aria-label="グループを上へ移動"
                        >
                          ▲
                        </button>
                        <button
                          onClick={() => {
                            const next = moveRow(model, row.path.slice(0, -1), 1)
                            if (next !== model) {
                              setSelectedPath(null)
                              applyGuiModel(next)
                            }
                          }}
                          title="グループを下へ"
                          aria-label="グループを下へ移動"
                        >
                          ▼
                        </button>
                        <button
                          onClick={() => applyGuiModel(addSignalToGroup(model, row.path))}
                          title="このグループに信号を追加"
                          aria-label="グループに信号を追加"
                        >
                          ＋信号
                        </button>
                        <button
                          onClick={() => {
                            setSelectedPath(null)
                            applyGuiModel(removeGroup(model, row.path))
                          }}
                          title="グループを削除"
                          aria-label="グループを削除"
                        >
                          ×
                        </button>
                      </span>
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
                        applyGuiModel(setSignalName(model, row.path, e.target.value), true)
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
        {brush === null
          ? 'クリック=状態送り / Shift+クリック=戻し / Alt+クリック=直前を延長'
          : `ペン「${brush}」: クリックで適用 / 同じペン再クリックで解除 / Alt+クリック=延長`}
      </p>
    </section>
  )
}

function RowControls({ path }: { path: number[] }) {
  const model = useEditor((s) => s.model)
  const applyGuiModel = useEditor((s) => s.applyGuiModel)
  const setSelectedPath = useEditor((s) => s.setSelectedPath)
  // Indices shift on remove/move, so any held selection would now point at a
  // different signal — deselect to avoid silently editing the wrong row.
  const restructure = (next: ReturnType<typeof moveRow>) => {
    if (next === model) return // boundary no-op — don't churn history/selection
    setSelectedPath(null)
    applyGuiModel(next)
  }
  return (
    <span className="row-controls" onClick={(e) => e.stopPropagation()}>
      <button
        onClick={() => restructure(moveRow(model, path, -1))}
        title="上へ"
        aria-label="信号を上へ移動"
      >
        ▲
      </button>
      <button
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
