import type { WaveJson } from './wavejson'

export function diffWaveJson(before: WaveJson, after: WaveJson): string {
  const lines: string[] = []
  compare(before, after, '', lines)
  return lines.join('\n')
}

function compare(before: unknown, after: unknown, path: string, lines: string[]): void {
  if (Object.is(before, after)) return
  if (isRecord(before) && isRecord(after)) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()
    for (const key of keys) {
      const childPath = path ? `${path}.${key}` : key
      if (!(key in before)) lines.push(`A ${childPath}: ${format(after[key])}`)
      else if (!(key in after)) lines.push(`D ${childPath}: ${format(before[key])}`)
      else compare(before[key], after[key], childPath, lines)
    }
    return
  }
  if (Array.isArray(before) && Array.isArray(after)) {
    const length = Math.max(before.length, after.length)
    for (let index = 0; index < length; index++) {
      const childPath = `${path}[${index}]`
      if (index >= before.length) lines.push(`A ${childPath}: ${format(after[index])}`)
      else if (index >= after.length) lines.push(`D ${childPath}: ${format(before[index])}`)
      else compare(before[index], after[index], childPath, lines)
    }
    return
  }
  lines.push(`M ${path}: ${format(before)} -> ${format(after)}`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function format(value: unknown): string {
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${format(value[key])}`).join(',')}}`
  }
  if (Array.isArray(value)) return `[${value.map(format).join(',')}]`
  return JSON.stringify(value)
}
