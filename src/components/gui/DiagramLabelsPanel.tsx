import { useEditor } from '../../state/store'
import type { WaveHead, WaveJson } from '../../model/wavejson'

// Drop empty keys so an all-blank head/foot disappears from the JSON entirely
// (keeps exported WaveJSON clean and avoids an empty `head: {}` artifact).
function clean(h: WaveHead | undefined): WaveHead | undefined {
  if (!h) return undefined
  const out: WaveHead = {}
  if (typeof h.text === 'string' && h.text.length > 0) out.text = h.text
  else if (h.text !== undefined && typeof h.text !== 'string') out.text = h.text
  if (h.tick !== undefined) out.tick = h.tick
  if (h.tock !== undefined) out.tock = h.tock
  if (h.every !== undefined) out.every = h.every
  return Object.keys(out).length > 0 ? out : undefined
}

/**
 * Edit the diagram-level title / caption and the cycle-number axis (WaveDrom
 * head/foot). Without these, an exported chart has no time reference — this is
 * what makes the image usable in a spec or review.
 */
export function DiagramLabelsPanel() {
  const model = useEditor((s) => s.model)
  const applyGuiModel = useEditor((s) => s.applyGuiModel)

  const updateHead = (patch: Partial<WaveHead>, key: string) => {
    const head = clean({ ...model.head, ...patch })
    const next: WaveJson = { ...model }
    if (head) next.head = head
    else delete next.head
    applyGuiModel(next, key)
  }
  const updateFoot = (patch: Partial<WaveHead>, key: string) => {
    const foot = clean({ ...model.foot, ...patch })
    const next: WaveJson = { ...model }
    if (foot) next.foot = foot
    else delete next.foot
    applyGuiModel(next, key)
  }

  const title = typeof model.head?.text === 'string' ? model.head.text : ''
  const caption = typeof model.foot?.text === 'string' ? model.foot.text : ''
  const tickOn = model.head?.tick !== undefined
  const start = model.head?.tick ?? 0

  return (
    <div className="labels-panel">
      <label className="labels-row">
        タイトル（上）
        <input
          value={title}
          placeholder="例: 書き込みシーケンス"
          onChange={(e) => updateHead({ text: e.target.value || undefined }, 'head-text')}
        />
      </label>

      <label className="labels-row">
        注記（下）
        <input
          value={caption}
          placeholder="例: ※ tCK = 10 ns"
          onChange={(e) => updateFoot({ text: e.target.value || undefined }, 'foot-text')}
        />
      </label>

      <label className="labels-row labels-check">
        <input
          type="checkbox"
          checked={tickOn}
          onChange={(e) => updateHead({ tick: e.target.checked ? 0 : undefined }, 'head-tick')}
        />
        サイクル番号（時間軸）を上に表示
      </label>

      <label className="labels-row">
        開始番号
        <input
          type="number"
          value={start}
          disabled={!tickOn}
          onChange={(e) => updateHead({ tick: Number(e.target.value) || 0 }, 'head-tick-n')}
        />
      </label>
    </div>
  )
}
