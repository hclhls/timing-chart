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
  duplicateSignal,
  addTick,
  removeTick,
} from '../../state/actions'
import { expandWave, CYCLE_STATES, isBusState, dataIndexAtTick } from '../../model/wave-codec'
import { dataToArray } from '../../model/wavejson'
import { WaveCell } from './WaveCell'
import { useI18n, type I18nKey } from '../../i18n'

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
const PRIMARY: { v: Brush; label: I18nKey }[] = [
  { v: null, label: 'brush.toggle' },
  { v: '1', label: 'brush.high' },
  { v: '0', label: 'brush.low' },
  { v: 'p', label: 'brush.clock' },
  { v: '=', label: 'brush.bus' },
  { v: 'extend', label: 'brush.extend' },
]
const DETAIL: { v: string; label: I18nKey }[] = [
  { v: 'x', label: 'brush.x' },
  { v: 'z', label: 'brush.z' },
  { v: 'cycle', label: 'brush.cycle' },
  { v: 'P', label: 'brush.clockArrow' },
  { v: 'n', label: 'brush.clockDown' },
  { v: 'N', label: 'brush.clockDownArrow' },
  { v: '2', label: 'brush.bus2' },
  { v: '3', label: 'brush.bus3' },
  { v: '4', label: 'brush.bus4' },
  { v: '5', label: 'brush.bus5' },
  { v: '6', label: 'brush.bus6' },
  { v: '7', label: 'brush.bus7' },
  { v: '8', label: 'brush.bus8' },
  { v: '9', label: 'brush.bus9' },
  { v: '|', label: 'brush.gap' },
]
// Persistent legend (the same meanings as the welcome modal, always available).
const LEGEND_STRIP: { sample: string; cls: string; text: I18nKey }[] = [
  { sample: '1', cls: 'state-high', text: 'legend.highName' },
  { sample: '0', cls: 'state-low', text: 'legend.lowName' },
  { sample: '⊓⊔', cls: 'state-clkp', text: 'legend.clockName' },
  { sample: 'A', cls: 'state-bus state-bus-3', text: 'legend.busName' },
  { sample: '✕', cls: 'state-x', text: 'legend.xName' },
  { sample: 'Z', cls: 'state-z', text: 'legend.zName' },
  { sample: '┊', cls: 'state-gap', text: 'legend.gapName' },
]

function brushClasses(v: Brush): string {
  if (v === '=') return 'palette-btn state-bus state-bus-eq'
  if (v && isBusState(v)) return `palette-btn state-bus state-bus-${v}`
  return 'palette-btn'
}

export function SignalTable() {
  const { t: tr } = useI18n()
  const brushLabel = (value: string) => tr(([...PRIMARY, ...DETAIL].find((b) => b.v === value)?.label ?? 'brush.toggle') as I18nKey)
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
  // Touch paint mode (mobile opt-in). OFF by default so touch pans/scrolls the
  // grid; ON lets a finger sweep-paint a run of cells (disables grid scroll).
  const [paintMode, setPaintMode] = useState(false)
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
  // The selection, but only when it points at a signal (not a group/spacer) —
  // gates the "複製" button.
  const selectedSignalPath =
    selectedPath && rows.some((r) => r.kind === 'signal' && pathEq(r.path, selectedPath))
      ? selectedPath
      : null
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
        flash(tr('signal.busProtected'))
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
      flash(tr('signal.busProtected'))
      return null
    }
    applyGuiModel(setCellState(model, path, tick, brush), coalesceKey)
    return brush
  }

  // Drag-to-paint (mouse via Pointer Events). Hold and sweep across a row to set
  // a run of cells to one state; the whole sweep is one undo step. On TOUCH we
  // deliberately don't sweep-paint — it fought page scrolling, leaving columns
  // unreachable on phones; touch taps edit one cell (handled in onClick).
  const dragValue = useRef<string | null>(null)
  const dragRow = useRef<number>(-1)
  const dragKey = useRef<string>('')
  const dragSeq = useRef<number>(0)
  const lastPointerType = useRef<string>('')
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
    lastPointerType.current = e.pointerType
    if (e.pointerType === 'touch' && !paintMode) {
      // Scroll mode (default): let the browser pan the grid; a genuine tap fires
      // onClick, which performs the single-cell edit. In paint mode we fall
      // through and arm a sweep just like a mouse.
      return
    }
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
    <section className={paintMode ? 'signal-table paint-mode' : 'signal-table'}>
      <div className="pane-title">{tr('signal.title')}</div>

      {hasPeriodPhase && (
        <div className="grid-warning" role="status">
          {tr('signal.periodWarning')}
        </div>
      )}

      <div className="table-toolbar">
        <button onClick={() => applyGuiModel(addSignal(model))}>{tr('signal.addSignal')}</button>
        <button onClick={() => applyGuiModel(addGroup(model))}>{tr('signal.addGroup')}</button>
        <button onClick={() => applyGuiModel(addSpacer(model))}>{tr('signal.addSpacer')}</button>
        <button
          disabled={!selectedSignalPath}
          onClick={() => {
            if (!selectedSignalPath) return
            applyGuiModel(duplicateSignal(model, selectedSignalPath))
            const p = selectedSignalPath
            setSelectedPath([...p.slice(0, -1), p[p.length - 1] + 1]) // select the new copy
            flash(tr('signal.duplicated'))
          }}
          title={tr('signal.duplicateTitle')}
        >
          {tr('signal.duplicate')}
        </button>
        <span className="sep" />
        <button
          onClick={() => {
            if (ticks <= 1) return
            applyGuiModel(removeTick(model))
            flash(tr('signal.removedTime'))
          }}
          title={tr('signal.removeTimeTitle')}
        >
          {tr('signal.removeTime')}
        </button>
        <span className="tick-count" title={tr('signal.lengthTitle')}>
          {tr('signal.length', { ticks })}
        </span>
        <button onClick={() => applyGuiModel(addTick(model))} title={tr('signal.addTimeTitle')}>
          {tr('signal.addTime')}
        </button>
      </div>

      <div className="state-picker" role="group" aria-label={tr('signal.stateAria')}>
        <span className="state-picker-label">{tr('signal.stateLabel')}</span>
        {PRIMARY.map(({ v, label }) => (
          <button
            key={String(v)}
            className={brush === v ? `${brushClasses(v)} active` : brushClasses(v)}
            // Re-clicking a selected brush returns to the default (consistent
            // with the「もっと」buttons). The default button itself stays null.
            onClick={() => setBrush(v === null || brush === v ? null : v)}
            aria-pressed={brush === v}
          >
            {tr(label)}
          </button>
        ))}
        <details className="more-states">
          <summary>{tr('signal.more')}</summary>
          <div className="brush-palette" role="group" aria-label={tr('signal.moreAria')}>
            {DETAIL.map(({ v, label }) => (
              <button
                key={v}
                className={brush === v ? `${brushClasses(v)} active` : brushClasses(v)}
                onClick={() => setBrush(brush === v ? null : v)}
                title={tr(label)}
                aria-label={tr(label)}
                aria-pressed={brush === v}
              >
                {tr(label)}
              </button>
            ))}
          </div>
        </details>
        <label
          className="paint-mode-toggle"
          title={tr('signal.paintModeTitle')}
        >
          <input
            type="checkbox"
            checked={paintMode}
            onChange={(e) => setPaintMode(e.target.checked)}
          />
          {tr('signal.paintMode')}
        </label>
      </div>

      {signalPaths.length === 0 && (
        <div className="empty-state">
          <p>{tr('signal.empty')}</p>
          <button onClick={() => applyGuiModel(addSignal(model))}>{tr('signal.addFirst')}</button>
          <span className="empty-hint">{tr('signal.emptyHint')}</span>
        </div>
      )}

      <div className="table-scroll" hidden={signalPaths.length === 0}>
        <table className="grid">
          <thead>
            <tr>
              <th className="name-col">{tr('signal.nameHead')}</th>
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
                        aria-label={tr('signal.groupNameAria')}
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
                          title={tr('signal.groupUpTitle')}
                          aria-label={tr('signal.groupUpAria')}
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
                          title={tr('signal.groupDownTitle')}
                          aria-label={tr('signal.groupDownAria')}
                        >
                          ▼
                        </button>
                        <button
                          onClick={() => applyGuiModel(addSignalToGroup(model, row.path))}
                          title={tr('signal.groupAddTitle')}
                          aria-label={tr('signal.groupAddAria')}
                        >
                          {tr('signal.addSignal')}
                        </button>
                        <button
                          onClick={() => {
                            setSelectedPath(null)
                            applyGuiModel(removeGroup(model, row.path))
                          }}
                          title={tr('signal.groupDeleteTitle')}
                          aria-label={tr('signal.groupDeleteAria')}
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
                      <span className="spacer-label">{tr('signal.blankRow')}</span>
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
                      aria-label={tr('signal.nameAria')}
                      placeholder={tr('signal.namePlaceholder')}
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
                          labelPrefix={tr('signal.cellLabel', { name: sig.name || tr('app.unnamed'), tick: t })}
                          tabIndex={isFocused ? 0 : -1}
                          cellId={`${sigIndex}-${t}`}
                          onKeyDown={(e) => onCellKeyDown(sigIndex, t, e)}
                          onPointerDown={(e) => {
                            e.stopPropagation()
                            onCellPointerDown(row.path, t, sigIndex, e)
                          }}
                          onClick={(e) => {
                            // Act on keyboard activation (Enter/Space → click with
                            // detail 0) OR a touch tap in SCROLL mode (pointerdown
                            // intentionally did nothing). Mouse, and touch in paint
                            // mode, were already handled on pointerdown.
                            const touchTapInScroll =
                              lastPointerType.current === 'touch' && !paintMode
                            if (e.detail !== 0 && !touchTapInScroll) return
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
          ? tr('signal.hintDefault')
          : brush === 'cycle'
            ? tr('signal.hintCycle')
            : tr('signal.hintPaint', { brush: brushLabel(brush) })}
        <br />
        <span className="hint-sub">
          {tr('signal.hintKeyboard')}
        </span>
      </p>

      <details className="legend-strip">
        <summary>{tr('signal.legendSummary')}</summary>
        <ul className="legend-row">
          {LEGEND_STRIP.map((l) => (
            <li key={l.text}>
              <span className={`legend-chip wave-cell ${l.cls}`}>{l.sample}</span>
              {tr(l.text)}
            </li>
          ))}
        </ul>
      </details>
    </section>
  )
}

function RowControls({ path, isSignal = true }: { path: number[]; isSignal?: boolean }) {
  const { t: tr } = useI18n()
  const model = useEditor((s) => s.model)
  const applyGuiModel = useEditor((s) => s.applyGuiModel)
  const setSelectedPath = useEditor((s) => s.setSelectedPath)
  const flash = useEditor((s) => s.flash)
  // On phones these 4 buttons otherwise eat the row's whole width and crowd out
  // the waveform cells; collapse them behind a ⋯ toggle (CSS shows the toggle
  // only on mobile — on desktop the buttons stay inline as before).
  const [open, setOpen] = useState(false)
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
        className="row-actions-toggle"
        onClick={() => setOpen((o) => !o)}
        aria-label={tr('signal.rowActions')}
        aria-expanded={open}
        title={tr('signal.rowActionsTitle')}
      >
        ⋯
      </button>
      <span className={open ? 'row-actions open' : 'row-actions'}>
        <button
          onClick={() => restructure(moveRow(model, path, -1))}
          disabled={!canUp}
          title={tr('signal.moveUpTitle')}
          aria-label={tr('signal.moveUpAria')}
        >
          ▲
        </button>
        <button
          onClick={() => restructure(moveRow(model, path, 1))}
          disabled={!canDown}
          title={tr('signal.moveDownTitle')}
          aria-label={tr('signal.moveDownAria')}
        >
          ▼
        </button>
        {isSignal && (
          <button
            onClick={() => {
              applyGuiModel(makeClock(model, path))
              flash(tr('signal.madeClock'))
            }}
            title={tr('signal.makeClockTitle')}
            aria-label={tr('signal.makeClockAria')}
          >
            ⎍
          </button>
        )}
        <button
          onClick={() => {
            restructure(removeRow(model, path))
            flash(tr('signal.deleted'))
          }}
          title={tr('signal.deleteTitle')}
          aria-label={tr('signal.deleteAria')}
        >
          ×
        </button>
      </span>
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
