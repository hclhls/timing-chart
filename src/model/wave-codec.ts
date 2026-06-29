// Conversions between a WaveDrom `wave` string and an expanded per-tick array.
//
// In a wave string, '.' means "extend the previous cell" (no new transition).
// Crucially `=...` is ONE bus segment (one data label) extended over 4 ticks,
// while `====` is FOUR segments (four labels). A plain value array can't tell
// these apart, so each expanded cell carries a `head` flag: head=true means the
// cell starts a new segment (was an explicit char), head=false means it extends
// the previous one (was a '.'). This makes expand/compress fully lossless.

/** A bus-value state char: consumes one entry from the signal's data array. */
export const BUS_STATES = ['=', '2', '3', '4', '5', '6', '7', '8', '9'] as const

/** States the GUI cell-cycle steps through, in order. */
export const CYCLE_STATES = ['0', '1', 'p', 'n', 'P', 'N', 'x', 'z', '='] as const

export interface Cell {
  /** The state character ('0','1','p','=', …). */
  value: string
  /** True if this cell starts a new segment; false if it extends the previous. */
  head: boolean
}

export function isBusState(ch: string): boolean {
  return (BUS_STATES as readonly string[]).includes(ch)
}

/** Expand a wave string into one Cell per tick. */
export function expandWave(wave: string): Cell[] {
  const out: Cell[] = []
  let last = 'x'
  for (const ch of wave) {
    if (ch === '.') {
      out.push({ value: last, head: false })
    } else if (ch === '|') {
      // A gap is an overlay marker: it does NOT change the underlying level,
      // so following '.' cells must keep inheriting the pre-gap value.
      out.push({ value: '|', head: true })
    } else {
      out.push({ value: ch, head: true })
      last = ch
    }
  }
  return out
}

/**
 * Ticks at which a bus segment STARTS (head + bus state), in left-to-right
 * order. The k-th entry corresponds to the signal's data[k] label.
 */
export function busHeadTicks(wave: string): number[] {
  const ticks: number[] = []
  expandWave(wave).forEach((c, i) => {
    if (c.head && isBusState(c.value)) ticks.push(i)
  })
  return ticks
}


/** Compress a Cell array back into a wave string (lossless inverse of expand). */
export function compressCells(cells: Cell[]): string {
  let out = ''
  for (const c of cells) out += c.head ? c.value : '.'
  return out
}

/** Number of ticks a wave string occupies. */
export function waveLength(wave: string): number {
  return wave.length
}

/**
 * Set the value at `tick`, marking it as a new segment (head). Pads with
 * extension cells if the wave is shorter than `tick`. Returns the new wave.
 */
export function setTick(wave: string, tick: number, value: string): string {
  const cells = expandWave(wave)
  while (cells.length <= tick) {
    const last = cells.length ? cells[cells.length - 1].value : 'x'
    cells.push({ value: last, head: false })
  }
  cells[tick] = { value, head: true }
  return compressCells(cells)
}

/** Turn the cell at `tick` into an extension of the previous cell. */
export function extendTick(wave: string, tick: number): string {
  const cells = expandWave(wave)
  if (tick > 0 && tick < cells.length) {
    cells[tick] = { value: cells[tick - 1].value, head: false }
  }
  return compressCells(cells)
}

/** Pad (extending the last level) or truncate a wave to exactly `length` ticks. */
export function resizeWave(wave: string, length: number): string {
  const cells = expandWave(wave)
  if (cells.length > length) return compressCells(cells.slice(0, length))
  while (cells.length < length) {
    const last = cells.length ? cells[cells.length - 1].value : '0'
    cells.push(cells.length ? { value: last, head: false } : { value: '0', head: true })
  }
  return compressCells(cells)
}

/**
 * Index into the signal's data[] array for the bus segment at `tick`, or -1 if
 * the cell at `tick` is not the head of a bus segment.
 */
export function dataIndexAtTick(wave: string, tick: number): number {
  const cells = expandWave(wave)
  if (tick >= cells.length) return -1
  const c = cells[tick]
  if (!c.head || !isBusState(c.value)) return -1
  let idx = 0
  for (let i = 0; i < tick; i++) {
    if (cells[i].head && isBusState(cells[i].value)) idx++
  }
  return idx
}

/** Total number of bus segments (= number of data labels the wave consumes). */
export function busSegmentCount(wave: string): number {
  let n = 0
  for (const c of expandWave(wave)) {
    if (c.head && isBusState(c.value)) n++
  }
  return n
}
