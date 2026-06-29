import { isBusState } from '../../model/wave-codec'

interface Props {
  value: string
  isHead: boolean
  busLabel: string
  onClick: (e: React.MouseEvent) => void
  /** Roving-tabindex value (0 for the focused cell, -1 otherwise). */
  tabIndex?: number
  /** Identifies the cell for arrow-key focus moves, e.g. "2-5". */
  cellId?: string
  onKeyDown?: (e: React.KeyboardEvent) => void
}

/** A single editable grid cell rendering a compact glyph for its state. */
export function WaveCell({ value, isHead, busLabel, onClick, tabIndex, cellId, onKeyDown }: Props) {
  const cls = ['wave-cell', ...stateClasses(value)]
  if (!isHead) cls.push('extension')
  const label = describe(value, busLabel)
  return (
    <button
      className={cls.join(' ')}
      onClick={onClick}
      onKeyDown={onKeyDown}
      tabIndex={tabIndex}
      data-cell={cellId}
      title={label}
      aria-label={label}
    >
      <span className="glyph">{glyph(value, busLabel)}</span>
    </button>
  )
}

function stateClasses(v: string): string[] {
  if (v === '=') return ['state-bus', 'state-bus-eq']
  if (isBusState(v)) return ['state-bus', `state-bus-${v}`] // 2..9 → distinct fills
  switch (v) {
    case '0':
      return ['state-low']
    case '1':
      return ['state-high']
    case 'h':
    case 'H':
      return ['state-high'] // high level (H also draws an edge arrow)
    case 'l':
    case 'L':
      return ['state-low']
    case 'd':
      return ['state-weak0'] // weak pull-down
    case 'u':
      return ['state-weak1'] // weak pull-up
    case 'p':
    case 'P':
      return ['state-clkp']
    case 'n':
    case 'N':
      return ['state-clkn']
    case 'x':
      return ['state-x']
    case 'z':
      return ['state-z']
    case '|':
      return ['state-gap']
    default:
      return ['state-unknown']
  }
}

function glyph(v: string, busLabel: string): string {
  // Bus: prefer the data label, else show the digit so 3 ≠ 5 is visible.
  if (isBusState(v)) return busLabel || (v === '=' ? '=' : v)
  switch (v) {
    case '0':
    case 'l':
    case 'L':
      return '0'
    case '1':
    case 'h':
    case 'H':
      return '1'
    case 'd':
      return 'd'
    case 'u':
      return 'u'
    case 'p':
      return '⊓⊔' // posedge clock: rises first
    case 'P':
      return '↑'
    case 'n':
      return '⊔⊓' // negedge clock: falls first
    case 'N':
      return '↓'
    case 'x':
      return '✕'
    case 'z':
      return 'Z'
    case '|':
      return '┊'
    default:
      return v || '·'
  }
}

function describe(v: string, busLabel = ''): string {
  if (isBusState(v)) {
    const id = v === '=' ? '' : ` ${v}`
    return `バス値${busLabel ? ': ' + busLabel : id ? ' (' + v + ')' : ''}`
  }
  const map: Record<string, string> = {
    '0': 'Low',
    '1': 'High',
    h: 'High (マーカー)',
    H: 'High (マーカー・矢印)',
    l: 'Low (マーカー)',
    L: 'Low (マーカー・矢印)',
    d: '弱プルダウン (d)',
    u: '弱プルアップ (u)',
    p: 'クロック (正エッジ)',
    P: 'クロック (正エッジ・矢印)',
    n: 'クロック (負エッジ)',
    N: 'クロック (負エッジ・矢印)',
    x: '不定 (X)',
    z: 'ハイインピーダンス (Z)',
    '|': 'ギャップ',
  }
  return map[v] ?? v
}
