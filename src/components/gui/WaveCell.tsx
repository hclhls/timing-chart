import { isBusState } from '../../model/wave-codec'

interface Props {
  value: string
  isHead: boolean
  busLabel: string
  onClick: (e: React.MouseEvent) => void
}

/** A single editable grid cell rendering a compact glyph for its state. */
export function WaveCell({ value, isHead, busLabel, onClick }: Props) {
  const cls = ['wave-cell', `state-${stateClass(value)}`]
  if (!isHead) cls.push('extension')
  const label = describe(value, busLabel)
  return (
    <button className={cls.join(' ')} onClick={onClick} title={label} aria-label={label}>
      <span className="glyph">{glyph(value, busLabel)}</span>
    </button>
  )
}

function stateClass(v: string): string {
  if (isBusState(v)) return 'bus'
  switch (v) {
    case '0':
      return 'low'
    case '1':
      return 'high'
    case 'p':
    case 'P':
      return 'clkp'
    case 'n':
    case 'N':
      return 'clkn'
    case 'x':
      return 'x'
    case 'z':
      return 'z'
    case '|':
      return 'gap'
    default:
      return 'unknown'
  }
}

function glyph(v: string, busLabel: string): string {
  if (isBusState(v)) return busLabel || '='
  switch (v) {
    case '0':
      return '0'
    case '1':
      return '1'
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
  if (isBusState(v)) return `バス値${busLabel ? ': ' + busLabel : ' (' + v + ')'}`
  const map: Record<string, string> = {
    '0': 'Low',
    '1': 'High',
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
