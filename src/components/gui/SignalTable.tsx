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

// Brush model. `null` = the friendly default: click toggles High/Low. 'cycle'
// = power mode (click steps through all states). Any other value = paint that
// state. Primary picker is always visible with plain labels; rarer states fold
// away under "もっと".
type Brush = string | null
const PRIMARY: { v: Brush; label: string }[] = [
  { v: null, label: 'High/Low切替' },
  { v: '1', label: 'High（オン）' },
  { v: '0', label: 'Low（オフ）' },
  { v: 'P', label: 'クロック' },
  { v: '=', label: 'バス（値）' },
  { v: 'x', label: '不定 X' },
  { v: 'z', label: 'Z（切断）' },
  { v: 'cycle', label: '順送り' },
]
const DETAIL: { v: string; label: string }[] = [
  { v: 'p', label: 'クロック（矢印なし）' },
  { v: 'n', label: 'クロック↓' },
  { v: 'N', label: 'クロック↓（矢印）' },
  { v: '2', label: 'バス2' },
  { v: '3', label: 'バス3' },
  { v: '4', label: 'バス4' },
  { v: '5', label: 'バス5' },
  { v: '6', label: 'バス6' },
  { v: '7', label: 'バス7' },
  { v: '8', label: 'バス8' },
  { v: '9', label: 'バス9' },
  { v: '|', label: 'ギャップ' },
]
const BRUSH_LABEL: Record<string, string> = Object.fromEntries(
  [...PRIMARY, ...DETAIL].filter((b) => b.v !== null).map((b) => [b.v as string, b.label]),
)

function brushClasses(v: Brush): string {
  if (v === '=') return 'palette-btn state-bus state-bus-eq'
  if (v && isBusState(v)) return `palette-btn state-bus state-bus-${v}`
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
  // Roving-tabindex focus: which cell (signal-row index, tick) is keyboard-active.
  const [focusedCell, setFocusedCell] = useState<{ r: number; t: number } | null>(null)
  // Disarm the brush AND reset keyboard focus when a new document is loaded.
  const loadEpoch = useEditor((s) => s.loadEpoch)
  useEffect(() => {
    setBrush(null)
    setFocusedCell(null)
  }, [loadEpoch])

  const rows = flattenSignals(model)
  const ticks = maxTicks(model)
  const tickArray = Array.from({ length: ticks }, (_, i) => i)
  // Editable signal rows in display order — the index space for keyboard focus.
  const signalPaths = rows.filter((r) => r.kind === 'signal').map((r) => r.path)
  const sigIndexOf = (path: number[]) => signalPaths.findIndex((p) => pathEq(p, path))
  // Effective focus: fall back to (0,0) when focusedCell is unset or stale
  // (out of range after a delete / tick-down / load), so the grid stays Tab-able.
  const effFocus =
    focusedCell && focusedCell.r < signalPaths.length && focusedCell.t < ticks
      ? focusedCell
      : { r: 0, t: 0 }

  useEffect(() => {
    if (!focusedCell) return
    document
      .querySelector<HTMLElement>(`[data-cell="${focusedCell.r}-${focusedCell.t}"]`)
      ?.focus()
  }, [focusedCell])

  const applyCellAction = (
    path: number[],
    tick: number,
    mods: { altKey: boolean; shiftKey: boolean },
  ) => {
    if (mods.altKey) {
      if (tick === 0) return // tick 0 has nothing to extend from
      applyGuiModel(extendCell(model, path, tick))
      return
    }
    const sig = rowSignalAt(rows, path)
    const cells = expandWave(sig?.wave ?? '')
    const cur = cells[tick]?.value ?? '0'
    if (brush === null) {
      // Default: simple High/Low toggle. Any odd state resets to High first.
      applyGuiModel(setCellState(model, path, tick, cur === '1' ? '0' : '1'))
      return
    }
    if (brush === 'cycle') {
      const next = cycle(cur, mods.shiftKey ? -1 : 1)
      if (next === cur) return
      applyGuiModel(setCellState(model, path, tick, next))
      return
    }
    // Paint the selected state. Missing/extension cells stay paintable so e.g.
    // a Low brush can draw on a short signal's tail.
    const c = cells[tick]
    if (c && c.head && c.value === brush) return
    applyGuiModel(setCellState(model, path, tick, brush))
  }

  // Only arrows are handled here. Enter/Space are intentionally NOT intercepted:
  // a native <button> already fires a click on Enter/Space (carrying shiftKey/
  // altKey), so the onClick handler applies the action. Handling them here too
  // would double-fire (Space activates on keyup, which keydown.preventDefault
  // can't stop).
  const onCellKeyDown = (r: number, t: number, e: React.KeyboardEvent) => {
    const k = e.key
    if (k !== 'ArrowRight' && k !== 'ArrowLeft' && k !== 'ArrowUp' && k !== 'ArrowDown') return
    e.preventDefault()
    let nr = r
    let nt = t
    if (k === 'ArrowRight') nt = Math.min(ticks - 1, t + 1)
    else if (k === 'ArrowLeft') nt = Math.max(0, t - 1)
    else if (k === 'ArrowDown') nr = Math.min(signalPaths.length - 1, r + 1)
    else nr = Math.max(0, r - 1)
    setFocusedCell({ r: nr, t: nt })
    // Keep selection in step with keyboard focus.
    if (signalPaths[nr]) setSelectedPath(signalPaths[nr])
  }

  return (
    <section className="signal-table">
      <div className="pane-title">信号エディタ</div>

      <div className="table-toolbar">
        <button onClick={() => applyGuiModel(addSignal(model))}>＋信号</button>
        <button onClick={() => applyGuiModel(addGroup(model))}>＋グループ</button>
        <button onClick={() => applyGuiModel(addSpacer(model))}>＋空行</button>
        <span className="sep" />
        <button onClick={() => applyGuiModel(removeTick(model))} title="時間のコマ（列）を減らす">
          − コマ
        </button>
        <span className="tick-count" title="時間のコマ数（横の列数）">
          {ticks} コマ
        </span>
        <button onClick={() => applyGuiModel(addTick(model))} title="時間のコマ（列）を増やす">
          ＋ コマ
        </button>
      </div>

      <div className="state-picker" role="group" aria-label="置く状態を選ぶ">
        <span className="state-picker-label">状態:</span>
        {PRIMARY.map(({ v, label }) => (
          <button
            key={String(v)}
            className={brush === v ? `${brushClasses(v)} active` : brushClasses(v)}
            onClick={() => setBrush(v)}
            aria-pressed={brush === v}
          >
            {label}
          </button>
        ))}
        <details className="more-states">
          <summary>もっと</summary>
          <div className="brush-palette" role="group" aria-label="その他の状態">
            {DETAIL.map(({ v, label }) => (
              <button
                key={v}
                className={brush === v ? `${brushClasses(v)} active` : brushClasses(v)}
                onClick={() => setBrush(brush === v ? null : v)}
                title={label}
                aria-label={label}
                aria-pressed={brush === v}
              >
                {label}
              </button>
            ))}
          </div>
        </details>
      </div>

      {signalPaths.length === 0 && (
        <div className="empty-state">
          <p>信号がまだありません。</p>
          <button onClick={() => applyGuiModel(addSignal(model))}>＋ 最初の信号を追加</button>
          <span className="empty-hint">追加したら、マスをクリックして High / Low を描けます。</span>
        </div>
      )}

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
              const sigIndex = sigIndexOf(row.path)
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
                    const isFocused = effFocus.r === sigIndex && effFocus.t === t
                    return (
                      <td key={t} className="cell-td">
                        <WaveCell
                          value={cell.value}
                          isHead={cell.head}
                          busLabel={label}
                          labelPrefix={`${sig.name || '信号'} tick${t}: `}
                          tabIndex={isFocused ? 0 : -1}
                          cellId={`${sigIndex}-${t}`}
                          onKeyDown={(e) => onCellKeyDown(sigIndex, t, e)}
                          onClick={(e) => {
                            e.stopPropagation()
                            setSelectedPath(row.path)
                            setFocusedCell({ r: sigIndex, t })
                            applyCellAction(row.path, t, { altKey: e.altKey, shiftKey: e.shiftKey })
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
          ? '👆 マスをクリックで High（オン）/ Low（オフ）を切り替え。Alt+クリックで直前を延長。'
          : brush === 'cycle'
            ? '順送りモード：クリックで状態が一巡（Shift+クリックで戻す）。'
            : `「${BRUSH_LABEL[brush] ?? brush}」を置きます：マスをクリックで適用。「High/Low切替」に戻すと通常編集。`}
        <br />
        <span className="hint-sub">
          キーボード: 矢印=移動 / Enter・Space=適用 / Alt+Enter=延長
        </span>
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
