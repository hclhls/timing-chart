import type { WaveJson, WaveLane, WaveSignal } from './wavejson'
import { expandWave } from './wave-codec'

export interface PwlOptions {
  step?: number
  high?: number
  low?: number
  sourceStart?: number
  timeSuffix?: string
}

interface Point {
  t: number
  v: number
}

const DIGITAL_STATES = new Set(['0', '1', 'p', 'P', 'n', 'N'])

export function waveJsonToPwl(model: WaveJson, options: PwlOptions = {}): string {
  const step = options.step ?? 1
  const high = options.high ?? 1
  const low = options.low ?? 0
  const sourceStart = options.sourceStart ?? 100
  const timeSuffix = options.timeSuffix ?? ''
  const lines: string[] = [
    '* PWL export from timing-chart',
    `* step=${formatNumber(step)}${timeSuffix} low=${formatNumber(low)} high=${formatNumber(high)}`,
  ]
  let exported = 0

  for (const signal of collectSignals(model.signal)) {
    if (!signal.wave) continue
    const points = signalToPwlPoints(signal, step, low, high)
    if (!points.length) continue
    exported++
    const nodeName = sanitizeNodeName(signal.name, exported)
    lines.push('', `* ${signal.name ?? `signal_${exported}`}`)
    lines.push(`V${sourceStart + exported - 1} ${nodeName} GND pwl(${formatPoints(points, timeSuffix)})`)
  }

  if (exported === 0) {
    lines.push('', '* No digital 0/1/clock signals were available for PWL export.')
  }

  return `${lines.join('\n')}\n`
}

export function signalToPwlPoints(signal: WaveSignal, step = 1, low = 0, high = 1): Point[] {
  if (!signal.wave) return []
  const cells = expandWave(signal.wave)
  const period = signal.period ?? 1
  const phase = signal.phase ?? 0
  const points: Point[] = []

  for (let i = 0; i < cells.length; i++) {
    const ch = fallbackDigitalState(cells[i].value, points, high)
    const start = (phase + i * period) * step
    const mid = (phase + (i + 0.5) * period) * step
    const end = (phase + (i + 1) * period) * step

    if (ch === '0') {
      appendPoint(points, start, low)
      appendPoint(points, end, low)
    } else if (ch === '1') {
      appendPoint(points, start, high)
      appendPoint(points, end, high)
    } else if (ch === 'p' || ch === 'P') {
      appendPoint(points, start, low)
      appendPoint(points, mid, high)
      appendPoint(points, end, low)
    } else {
      appendPoint(points, start, high)
      appendPoint(points, mid, low)
      appendPoint(points, end, high)
    }
  }

  return points
}

function fallbackDigitalState(ch: string, points: Point[], high: number): string {
  if (DIGITAL_STATES.has(ch)) return ch
  const last = points[points.length - 1]
  if (!last) return '0'
  return last.v === high ? '1' : '0'
}

function appendPoint(points: Point[], t: number, v: number): void {
  const last = points[points.length - 1]
  if (last && last.t === t && last.v === v) return
  points.push({ t, v })
}

function formatPoints(points: Point[], timeSuffix: string): string {
  return points.map(({ t, v }) => `${formatNumber(t)}${timeSuffix},${formatNumber(v)}`).join(', ')
}

function formatNumber(n: number): string {
  return Number.isInteger(n) ? String(n) : Number(n.toPrecision(12)).toString()
}

function sanitizeNodeName(name: string | undefined, fallback: number): string {
  const safe = (name?.trim() || `signal_${fallback}`).replace(/[^A-Za-z0-9_]/g, '_')
  return /^[A-Za-z]/.test(safe) ? safe : `sig_${safe}`
}

function collectSignals(lanes: WaveLane[]): WaveSignal[] {
  const signals: WaveSignal[] = []
  for (const lane of lanes) {
    if (typeof lane === 'string') continue
    if (Array.isArray(lane)) signals.push(...collectSignals(lane))
    else if (Object.keys(lane).length > 0) signals.push(lane)
  }
  return signals
}
