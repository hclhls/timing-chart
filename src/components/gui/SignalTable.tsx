import { useEffect, useRef, useState } from 'react'
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
  makeClock,
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
  { v: 'p', label: 'クロック' },
  { v: '=', label: 'バス（値）' },
  { v: 'extend', label: '→ 延長' },
]
const DETAIL: { v: string; label: string }[] = [
  { v: 'x', label: '不定 X（未確定）' },
  { v: 'z', label: 'Z（切断）' },
  { v: 'cycle', label: '順送り（クリックで次へ）' },
  { v: 'P', label: 'クロック（矢印つき）' },
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
// Persistent legend (the same meanings as the welcome modal, always available).
const LEGEND_STRIP: { sample: string; cls: string; text: string }[] = [
  { sample: '1', cls: 'state-high', text: 'High（オン）' },
  { sample: '0', cls: 'state-low', text: 'Low（オフ）' },
  { sample: '⊓⊔', cls: 'state-clkp', text: 'クロック' },
  { sample: 'A', cls: 'state-bus state-bus-3', text: 'バス（値）' },
  { sample: '✕', cls: 'state-x', text: '不定（X）' },
  { sample: 'Z', cls: 'state-z', text: 'Z（切断）' },
  { sample: '┊', cls: 'state-gap', text: 'ギャップ' },
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
  const flash = useEditor((s) => s.flash)

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
  // Esc clears the active paint brush (back to High/Low切替). Stay out of the
  // way when a dialog already handled Esc (defaultPrevented) or when the user is
  // typing in a field — otherwise closing the help modal or editing WaveJSON
  // would silently disarm the brush too.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      const el = document.activeElement as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
      setBrush(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

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

  // Apply a cell edit. Returns the concrete state value that was painted so a
  // drag can repeat it across cells (null = nothing draggable: extend / cycle /
  // protected bus / no-op).
  // `coalesceKey` groups this edit's undo with same-key edits (e.g. one drag).
  const applyCellAction = (
    path: number[],
    tick: number,
    mods: { altKey: boolean; shiftKey: boolean },
    coalesceKey: boolean | string = false,
  ): string | null => {
    if (mods.altKey || brush === 'extend') {
      if (tick === 0) return null // tick 0 has nothing to extend from
      applyGuiModel(extendCell(model, path, tick), coalesceKey)
      return '__extend__' // lets a drag keep extending across the run
    }
    const sig = rowSignalAt(rows, path)
    const cells = expandWave(sig?.wave ?? '')
    const cur = cells[tick]?.value ?? '0'
    if (brush === null) {
      // Default: simple High/Low toggle. Protect data-bearing bus cells from a
      // stray click (their label would be lost) — change those via the picker.
      if (isBusState(cur)) {
        flash('ここはバス区間です。下の「バス値」で値を編集できます')
        return null
      }
      const v = cur === '1' ? '0' : '1'
      applyGuiModel(setCellState(model, path, tick, v), coalesceKey)
      return v
    }
    if (brush === 'cycle') {
      const next = cycle(cur, mods.shiftKey ? -1 : 1)
      if (next === cur) return null
      applyGuiModel(setCellState(model, path, tick, next), coalesceKey)
      return null // cycle is per-click, not a paintable run
    }
    // Paint the selected state. Missing/extension cells stay paintable so e.g.
    // a Low brush can draw on a short signal's tail.
    const c = cells[tick]
    if (c && c.head && c.value === brush) return brush
    // Protect a data-bearing bus cell from a stray High/Low brush click (its
    // label would be silently dropped) — same rule the toggle and drag use.
    if ((brush === '0' || brush === '1') && isBusState(cur)) {
      flash('ここはバス区間です。下の「バス値」で値を編集できます')
      return null
    }
    applyGuiModel(setCellState(model, path, tick, brush), coalesceKey)
    return brush
  }

  // Drag-to-paint (mouse + touch via Pointer Events). Hold and sweep across a
  // row to set a run of cells to one state; the whole sweep is one undo step.
  const dragValue = useRef<string | null>(null)
  const dragRow = useRef<number>(-1)
  const dragKey = useRef<string>('')
  const dragSeq = useRef<number>(0)
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const v = dragValue.current
      if (v === null) return
      const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null
      const dc = el?.closest('[data-cell]')?.getAttribute('data-cell')
      if (!dc) return
      const [r, t] = dc.split('-').map(Number)
      if (r !== dragRow.current) return // keep the sweep on its own row
      const m = useEditor.getState().model
      const row = flattenSignals(m).filter((x) => x.kind === 'signal')[r]
      if (!row?.signal) return
      if (v === '__extend__') {
        if (t === 0) return
        useEditor.getState().applyGuiModel(extendCell(m, row.path, t), dragKey.current)
        return
      }
      const cell = expandWave(row.signal.wave ?? '')[t]
      if ((v === '0' || v === '1') && isBusState(cell?.value ?? '')) return // protect bus
      if (cell && cell.head && cell.value === v) return
      useEditor.getState().applyGuiModel(setCellState(m, row.path, t, v), dragKey.current)
    }
    const onUp = () => (dragValue.current = null)
    document.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    // A touch sweep that turns into a page scroll fires pointercancel, not
    // pointerup — disarm there too so the brush doesn't stay "live" and paint
    // a stray cell on the next move.
    window.addEventListener('pointercancel', onUp)
    return () => {
      document.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [])

  const onCellPointerDown = (path: number[], tick: number, sigIndex: number, e: React.PointerEvent) => {
    if (e.button > 0) return // ignore right/middle mouse buttons
    e.preventDefault() // avoid text selection / page scroll while sweeping
    setSelectedPath(path)
    setFocusedCell({ r: sigIndex, t: tick })
    dragKey.current = `drag-${++dragSeq.current}`
    const v = applyCellAction(path, tick, { altKey: e.altKey, shiftKey: e.shiftKey }, dragKey.current)
    // Bus paints stay single-cell (a sweep would make many empty bus segments).
    dragValue.current = v !== null && !isBusState(v) ? v : null
    dragRow.current = sigIndex
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

  // period/phase stretch a signal's wave beyond 1-tick-per-char, but the grid,
  // ±時間 and markers all count raw chars — so cells visually misalign with the
  // preview. The GUI can't safely edit those yet; steer the user to the code tab
  // rather than letting them paint onto a lying grid.
  const hasPeriodPhase = rows.some(
    (r) =>
      r.kind === 'signal' &&
      !!r.signal &&
      ((r.signal.period != null && r.signal.period !== 1) ||
        (r.signal.phase != null && r.signal.phase !== 0)),
  )

  return (
    <section className="signal-table">
      <div className="pane-title">信号エディタ</div>

      {hasPeriodPhase && (
        <div className="grid-warning" role="status">
          ⚠ 一部の信号に period／phase が設定されています。マス目の編集だとプレビューと位置がずれて見えることがあります。微調整は「コード（上級者）」タブで行ってください。
        </div>
      )}

      <div className="table-toolbar">
        <button onClick={() => applyGuiModel(addSignal(model))}>＋信号</button>
        <button onClick={() => applyGuiModel(addGroup(model))}>＋グループ</button>
        <button onClick={() => applyGuiModel(addSpacer(model))}>＋空行</button>
        <span className="sep" />
        <button
          onClick={() => {
            if (ticks <= 1) return
            applyGuiModel(removeTick(model))
            flash('コマを1つ減らしました（「戻す」で復元できます）')
          }}
          title="時間の長さ（横のコマ）を1つ減らす"
        >
          − 時間
        </button>
        <span className="tick-count" title="時間の長さ＝横のコマ数">
          長さ {ticks}
        </span>
        <button onClick={() => applyGuiModel(addTick(model))} title="時間の長さ（横のコマ）を1つ増やす">
          ＋ 時間
        </button>
      </div>

      <div className="state-picker" role="group" aria-label="置く状態を選ぶ">
        <span className="state-picker-label">状態:</span>
        {PRIMARY.map(({ v, label }) => (
          <button
            key={String(v)}
            className={brush === v ? `${brushClasses(v)} active` : brushClasses(v)}
            // Re-clicking a selected brush returns to the default (consistent
            // with the「もっと」buttons). The default button itself stays null.
            onClick={() => setBrush(v === null || brush === v ? null : v)}
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

      <div className="table-scroll" hidden={signalPaths.length === 0}>
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
                          applyGuiModel(
                            setGroupLabel(model, row.path, e.target.value),
                            `glabel:${row.path.join(',')}`,
                          )
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
                      <RowControls path={row.path} isSignal={false} />
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
                        applyGuiModel(
                          setSignalName(model, row.path, e.target.value),
                          `name:${row.path.join(',')}`,
                        )
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
                          onPointerDown={(e) => {
                            e.stopPropagation()
                            onCellPointerDown(row.path, t, sigIndex, e)
                          }}
                          onClick={(e) => {
                            // Mouse already handled via mousedown/drag; only act on
                            // keyboard activation (Enter/Space → click with detail 0).
                            if (e.detail !== 0) return
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
          ? '👆 マスをクリックで High（オン）/ Low（オフ）を切り替え。ドラッグで連続して塗れます。Alt+クリックで直前を延長。'
          : brush === 'cycle'
            ? '順送りモード：クリックで状態が一巡（Shift+クリックで戻す）。'
            : `「${BRUSH_LABEL[brush] ?? brush}」を置きます：マスをクリック／ドラッグで連続適用。「High/Low切替」に戻すと通常編集。`}
        <br />
        <span className="hint-sub">
          キーボード: 矢印=移動 / Enter・Space=適用 / Alt+Enter=延長
        </span>
      </p>

      <details className="legend-strip">
        <summary>記号の見かた</summary>
        <ul className="legend-row">
          {LEGEND_STRIP.map((l) => (
            <li key={l.text}>
              <span className={`legend-chip wave-cell ${l.cls}`}>{l.sample}</span>
              {l.text}
            </li>
          ))}
        </ul>
      </details>
    </section>
  )
}

function RowControls({ path, isSignal = true }: { path: number[]; isSignal?: boolean }) {
  const model = useEditor((s) => s.model)
  const applyGuiModel = useEditor((s) => s.applyGuiModel)
  const setSelectedPath = useEditor((s) => s.setSelectedPath)
  const flash = useEditor((s) => s.flash)
  // Indices shift on remove/move, so any held selection would now point at a
  // different signal — deselect to avoid silently editing the wrong row.
  const restructure = (next: ReturnType<typeof moveRow>) => {
    if (next === model) return // boundary no-op — don't churn history/selection
    setSelectedPath(null)
    applyGuiModel(next)
  }
  // Gray out the move that would do nothing (already at the top/bottom) so the
  // button doesn't look broken when nothing happens.
  const canUp = moveRow(model, path, -1) !== model
  const canDown = moveRow(model, path, 1) !== model
  return (
    <span className="row-controls" onClick={(e) => e.stopPropagation()}>
      <button
        onClick={() => restructure(moveRow(model, path, -1))}
        disabled={!canUp}
        title="上へ"
        aria-label="信号を上へ移動"
      >
        ▲
      </button>
      <button
        onClick={() => restructure(moveRow(model, path, 1))}
        disabled={!canDown}
        title="下へ"
        aria-label="信号を下へ移動"
      >
        ▼
      </button>
      {isSignal && (
        <button
          onClick={() => {
            applyGuiModel(makeClock(model, path))
            flash('クロック（周期信号）にしました（「戻す」で元に戻せます）')
          }}
          title="この信号をクロック（周期信号）にする"
          aria-label="この信号をクロックにする"
        >
          ⎍
        </button>
      )}
      <button
        onClick={() => {
          restructure(removeRow(model, path))
          flash('削除しました（「戻す」で元に戻せます）')
        }}
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
