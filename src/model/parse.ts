import JSON5 from 'json5'
import type { WaveJson } from './wavejson'

export interface ParseResult {
  ok: boolean
  model?: WaveJson
  error?: string
}

/**
 * Parse WaveJSON text with JSON5 (relaxed: unquoted keys, trailing commas,
 * comments) and validate the minimum shape WaveDrom requires.
 */
export function parseModel(text: string): ParseResult {
  const trimmed = text.trim()
  if (trimmed.length === 0) {
    return { ok: false, error: '入力が空です' }
  }
  let value: unknown
  try {
    value = JSON5.parse(trimmed)
  } catch (e) {
    return { ok: false, error: formatJson5Error(e) }
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, error: 'ルートはオブジェクト { … } である必要があります' }
  }
  const obj = value as Record<string, unknown>
  if (!Array.isArray(obj.signal)) {
    return { ok: false, error: '"signal" 配列が必要です' }
  }
  // Every lane must be a signal object, a group label string, or a nested
  // group array. A stray null/number would crash the editor (Object.keys(null))
  // and, once autosaved, trap the app on reload — reject it up front.
  const badLane = !obj.signal.every((lane) => isValidLane(lane))
  if (badLane) {
    return { ok: false, error: '"signal" の各要素はオブジェクト/配列/文字列である必要があります' }
  }
  if (obj.edge !== undefined && !Array.isArray(obj.edge)) {
    return { ok: false, error: '"edge" は配列である必要があります' }
  }
  return { ok: true, model: value as WaveJson }
}

function isValidLane(lane: unknown): boolean {
  if (typeof lane === 'string') return true // group label
  if (Array.isArray(lane)) {
    // A group is [label, ...items]; a truly empty [] carries neither and would
    // persist as an invisible dead lane — reject it.
    if (lane.length === 0) return false
    return lane.every((l) => isValidLane(l))
  }
  if (typeof lane !== 'object' || lane === null) return false
  // A signal object: validate the field TYPES, not just presence. A wave that
  // isn't a string (or data that isn't string/array) crashes expandWave/split
  // on render — and once autosaved, traps the app on reload. The bridge already
  // rejects these; the share-URL / localStorage path must be just as strict.
  const l = lane as Record<string, unknown>
  if ('wave' in l && typeof l.wave !== 'string') return false
  if ('name' in l && typeof l.name !== 'string') return false
  if ('node' in l && typeof l.node !== 'string') return false
  if ('data' in l && !(typeof l.data === 'string' || Array.isArray(l.data))) return false
  if ('period' in l && typeof l.period !== 'number') return false
  if ('phase' in l && typeof l.phase !== 'number') return false
  return true
}

function formatJson5Error(e: unknown): string {
  if (e instanceof Error) {
    // JSON5 errors carry lineNumber/columnNumber properties
    const ln = (e as { lineNumber?: number }).lineNumber
    const col = (e as { columnNumber?: number }).columnNumber
    const loc = ln ? ` (行 ${ln}${col ? `, 列 ${col}` : ''})` : ''
    return `JSON 構文エラー${loc}: ${e.message}`
  }
  return 'JSON 構文エラー'
}
