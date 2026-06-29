import { useState } from 'react'
import { useEditor } from '../../state/store'
import { flattenSignals, nextNodeLetter, usedNodeLetters } from '../../state/selectors'
import { getEdges, setEdges, setSignalNode } from '../../state/actions'

const ARROWS = ['~>', '-~>', '~->', '->', '-|>', '<->', '-', '~', '<-|->'] as const

function pathEq(a: number[] | null, b: number[]): boolean {
  if (!a || a.length !== b.length) return false
  return a.every((v, i) => v === b[i])
}

/** Set the node-string char at `tick` to `letter` (padding with '.'). */
function placeNode(node: string | undefined, tick: number, letter: string): string {
  const chars = (node ?? '').split('')
  while (chars.length <= tick) chars.push('.')
  chars[tick] = letter
  return chars.join('')
}

/** Setup/hold (edge) annotation editor: place markers and connect them. */
export function EdgeEditor() {
  const model = useEditor((s) => s.model)
  const applyGuiModel = useEditor((s) => s.applyGuiModel)
  const selectedPath = useEditor((s) => s.selectedPath)

  const [markerTick, setMarkerTick] = useState(0)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [arrow, setArrow] = useState<string>('~>')
  const [label, setLabel] = useState('setup')

  const rows = flattenSignals(model)
  const letters = Array.from(usedNodeLetters(model)).sort()
  const edges = getEdges(model)

  const addMarker = () => {
    if (!selectedPath) return
    const row = rows.find((r) => pathEq(r.path, selectedPath))
    if (!row?.signal) return
    const letter = nextNodeLetter(model)
    if (!letter) return
    // Clamp to the signal's wave so the marker can't land off the waveform.
    const waveLen = row.signal.wave?.length ?? 0
    const tick = Math.min(markerTick, Math.max(0, waveLen - 1))
    const node = placeNode(row.signal.node, tick, letter)
    applyGuiModel(setSignalNode(model, selectedPath, node))
  }

  const addEdge = () => {
    if (!from || !to) return
    const str = `${from}${arrow}${to}${label ? ' ' + label : ''}`
    applyGuiModel(setEdges(model, [...edges, str]))
  }

  const removeEdge = (i: number) => {
    const next = edges.slice()
    next.splice(i, 1)
    applyGuiModel(setEdges(model, next))
  }

  return (
    <div className="edge-editor">
      <div className="bus-panel-title">注釈 (セットアップ/ホールド)</div>

      <div className="edge-section">
        <div className="edge-label">① マーカー配置（選択中の信号）</div>
        <div className="edge-row">
          tick
          <input
            type="number"
            min={0}
            value={markerTick}
            onChange={(e) => setMarkerTick(Math.max(0, Number(e.target.value)))}
            style={{ width: 56 }}
          />
          <button onClick={addMarker} disabled={!selectedPath}>
            マーカー追加
          </button>
        </div>
        {!selectedPath && (
          <div className="muted edge-hint">
            ↑ まず左の表で信号の行（マス）をクリックして選ぶと、その位置にマーカーを置けます
          </div>
        )}
        <div className="edge-markers">
          {letters.length === 0 ? (
            <span className="muted">マーカー未配置</span>
          ) : (
            letters.map((l) => (
              <span key={l} className="marker-chip">
                {l}
              </span>
            ))
          )}
        </div>
      </div>

      <div className="edge-section">
        <div className="edge-label">② マーカー間を接続</div>
        <div className="edge-row">
          <select value={from} onChange={(e) => setFrom(e.target.value)}>
            <option value="">from</option>
            {letters.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
          <select value={arrow} onChange={(e) => setArrow(e.target.value)}>
            {ARROWS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
          <select value={to} onChange={(e) => setTo(e.target.value)}>
            <option value="">to</option>
            {letters.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
          <input
            value={label}
            placeholder="ラベル"
            onChange={(e) => setLabel(e.target.value)}
            style={{ width: 80 }}
          />
          <button onClick={addEdge} disabled={!from || !to}>
            追加
          </button>
        </div>
        <div className="quick-row">
          <button onClick={() => setLabel('setup')}>setup</button>
          <button onClick={() => setLabel('hold')}>hold</button>
        </div>
      </div>

      <div className="edge-section">
        <div className="edge-label">既存の注釈</div>
        {edges.length === 0 ? (
          <span className="muted">なし</span>
        ) : (
          <ul className="edge-list">
            {edges.map((e, i) => (
              <li key={i}>
                <code>{e}</code>
                <button onClick={() => removeEdge(i)} title="注釈を削除" aria-label="注釈を削除">
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
