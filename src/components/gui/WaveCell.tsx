import { isBusState } from '../../model/wave-codec'
import { useI18n, type I18nKey } from '../../i18n'

interface Props {
  value: string
  isHead: boolean
  busLabel: string
  onClick: (e: React.MouseEvent) => void
  onPointerDown?: (e: React.PointerEvent) => void
  /** Roving-tabindex value (0 for the focused cell, -1 otherwise). */
  tabIndex?: number
  /** Identifies the cell for arrow-key focus moves, e.g. "2-5". */
  cellId?: string
  onKeyDown?: (e: React.KeyboardEvent) => void
  /** Prepended to the accessible label, e.g. "clk tick3: " for screen readers. */
  labelPrefix?: string
}

/** A single editable grid cell rendering a compact glyph for its state. */
export function WaveCell({
  value,
  isHead,
  busLabel,
  onClick,
  onPointerDown,
  tabIndex,
  cellId,
  onKeyDown,
  labelPrefix = '',
}: Props) {
  const { t } = useI18n()
  const cls = ['wave-cell', ...stateClasses(value)]
  if (!isHead) cls.push('extension')
  const label = labelPrefix + describe(value, busLabel, t)
  return (
    <button
      className={cls.join(' ')}
      onClick={onClick}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      tabIndex={tabIndex}
      data-cell={cellId}
      title={label}
      aria-label={label}
    >
      <span className="glyph">
        {/* A bus segment's value sits on its head cell; the continuation cells
            are already tinted by the bus fill, so repeating "=" there just
            reads like separate values. Blank them. */}
        {!isHead && isBusState(value) ? '' : glyph(value, busLabel)}
      </span>
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

function describe(v: string, busLabel = '', t: (key: I18nKey, params?: Record<string, string | number>) => string): string {
  if (isBusState(v)) {
    const id = v === '=' ? '' : ` ${v}`
    return t('wave.busValue', { suffix: busLabel ? ': ' + busLabel : id ? ' (' + v + ')' : '' })
  }
  const map: Record<string, I18nKey | string> = {
    '0': 'Low',
    '1': 'High',
    h: 'wave.highMarker',
    H: 'wave.highMarkerArrow',
    l: 'wave.lowMarker',
    L: 'wave.lowMarkerArrow',
    d: 'wave.weakPulldown',
    u: 'wave.weakPullup',
    p: 'wave.clockPos',
    P: 'wave.clockPosArrow',
    n: 'wave.clockNeg',
    N: 'wave.clockNegArrow',
    x: 'wave.unknown',
    z: 'wave.highImpedance',
    '|': 'wave.gap',
  }
  const text = map[v]
  return text && text.startsWith('wave.') ? t(text as I18nKey) : text ?? v
}
