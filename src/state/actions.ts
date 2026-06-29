// Pure model mutations used by the GUI editor. Each returns a NEW model
// (structural sharing along the touched path) so React/Zustand sees a change.

import type { WaveJson, WaveLane, WaveSignal } from '../model/wavejson'
import { dataToArray } from '../model/wavejson'
import {
  setTick,
  extendTick,
  resizeWave,
  busHeadTicks,
  isBusState,
} from '../model/wave-codec'
import { flattenSignals, usedNodeLetters } from './selectors'

/** Replace the lane at `path` by applying `updater`; returns a new lane array. */
function updateLane(
  lanes: WaveLane[],
  path: number[],
  updater: (lane: WaveLane) => WaveLane,
): WaveLane[] {
  const [head, ...rest] = path
  const copy = lanes.slice()
  if (rest.length === 0) {
    copy[head] = updater(copy[head])
  } else {
    copy[head] = updateLane(copy[head] as WaveLane[], rest, updater)
  }
  return copy
}

/** Remove the lane at `path`; returns a new lane array. */
function removeLane(lanes: WaveLane[], path: number[]): WaveLane[] {
  const [head, ...rest] = path
  const copy = lanes.slice()
  if (rest.length === 0) {
    copy.splice(head, 1)
  } else {
    copy[head] = removeLane(copy[head] as WaveLane[], rest)
  }
  return copy
}

function updateSignal(
  model: WaveJson,
  path: number[],
  updater: (sig: WaveSignal) => WaveSignal,
): WaveJson {
  return {
    ...model,
    signal: updateLane(model.signal, path, (lane) => updater(lane as WaveSignal)),
  }
}

/** Attach data[] to a signal, or drop the field entirely when empty. */
function withData(sig: WaveSignal, data: string[]): WaveSignal {
  if (data.length === 0) {
    if (sig.data === undefined) return sig
    const { data: _d, ...rest } = sig
    void _d
    return rest
  }
  return { ...sig, data }
}

/**
 * Rebuild data[] for a wave change, keeping each label glued to its bus
 * segment by TICK POSITION (not array index). This prevents the silent label
 * shuffle that a naive tail pad/truncate causes when a non-final bus segment
 * is added or removed.
 */
function remapData(oldWave: string, oldData: string[], newWave: string): string[] {
  const byTick = new Map<number, string>()
  busHeadTicks(oldWave).forEach((t, k) => byTick.set(t, oldData[k] ?? ''))
  return busHeadTicks(newWave).map((t) => byTick.get(t) ?? '')
}

/** Node-marker letters referenced by an edge spec (the part before any label). */
function edgeLetters(edge: string): string[] {
  const spec = edge.split(' ')[0]
  return spec.split('').filter((c) => /[A-Za-z]/.test(c))
}

/** Drop any edge whose endpoints no longer exist as node markers. */
function cleanupEdges(model: WaveJson): WaveJson {
  if (!model.edge || model.edge.length === 0) return model
  const letters = usedNodeLetters(model)
  const kept = model.edge.filter((e) => edgeLetters(e).every((l) => letters.has(l)))
  if (kept.length === model.edge.length) return model
  return setEdges(model, kept)
}

/** Set a single cell's state; remaps bus data labels by position. */
export function setCellState(
  model: WaveJson,
  path: number[],
  tick: number,
  value: string,
): WaveJson {
  return updateSignal(model, path, (sig) => {
    const oldWave = sig.wave ?? ''
    const wave = setTick(oldWave, tick, value)
    const data = remapData(oldWave, dataToArray(sig.data), wave)
    return withData({ ...sig, wave }, data)
  })
}

/** Make the cell at `tick` extend the previous cell ('.'). */
export function extendCell(model: WaveJson, path: number[], tick: number): WaveJson {
  return updateSignal(model, path, (sig) => {
    const oldWave = sig.wave ?? ''
    const wave = extendTick(oldWave, tick)
    const data = remapData(oldWave, dataToArray(sig.data), wave)
    return withData({ ...sig, wave }, data)
  })
}

export function setSignalName(model: WaveJson, path: number[], name: string): WaveJson {
  return updateSignal(model, path, (sig) => ({ ...sig, name }))
}

export function setSignalNode(model: WaveJson, path: number[], node: string): WaveJson {
  const next = updateSignal(model, path, (sig) => {
    if (node.replace(/\./g, '').length === 0) {
      const { node: _n, ...rest } = sig
      void _n
      return rest
    }
    return { ...sig, node }
  })
  return cleanupEdges(next)
}

/** Replace the data label at bus-segment index `dataIndex` (kept in sync). */
export function setDataLabel(
  model: WaveJson,
  path: number[],
  dataIndex: number,
  label: string,
): WaveJson {
  return updateSignal(model, path, (sig) => {
    // Pad up to the edited index but DON'T truncate: WaveDrom keeps surplus
    // data labels (reserved for future segments); dropping them loses work.
    const arr = dataToArray(sig.data)
    if (dataIndex < 0) return sig
    while (arr.length <= dataIndex) arr.push('')
    arr[dataIndex] = label
    return withData({ ...sig }, arr)
  })
}

/** Collect every signal name currently in the model. */
function existingNames(model: WaveJson): Set<string> {
  const names = new Set<string>()
  for (const row of flattenSignals(model)) {
    if (row.kind === 'signal' && row.signal?.name) names.add(row.signal.name)
  }
  return names
}

/** Produce a name not already used: base, base2, base3, … */
export function uniqueName(model: WaveJson, base: string): string {
  const used = existingNames(model)
  if (!used.has(base)) return base
  let n = 2
  while (used.has(`${base}${n}`)) n++
  return `${base}${n}`
}

/** Append a new signal at the top level, with a unique name. */
export function addSignal(model: WaveJson, base = 'sig'): WaveJson {
  const ticks = currentMaxTicks(model)
  const wave = '0'.padEnd(ticks, '.')
  return { ...model, signal: [...model.signal, { name: uniqueName(model, base), wave }] }
}

/** Append a spacer ({}) at the top level. */
export function addSpacer(model: WaveJson): WaveJson {
  return { ...model, signal: [...model.signal, {}] }
}

export function removeRow(model: WaveJson, path: number[]): WaveJson {
  const next = { ...model, signal: removeLane(model.signal, path) }
  return cleanupEdges(next)
}

/** Read the lane array at `path` (the root array when path is empty). */
function lanesAt(model: WaveJson, path: number[]): WaveLane[] {
  let cur: WaveLane[] = model.signal
  for (const idx of path) cur = cur[idx] as WaveLane[]
  return cur
}

/**
 * Move a row up/down by one WITHIN its parent array (top level or inside a
 * group). Index 0 of a group array is its label string, so signals inside a
 * group can't be swapped above it.
 */
export function moveRow(model: WaveJson, path: number[], dir: -1 | 1): WaveJson {
  if (path.length === 0) return model
  const parentPath = path.slice(0, -1)
  const i = path[path.length - 1]
  const parent = lanesAt(model, parentPath)
  if (!Array.isArray(parent)) return model
  const minIdx = typeof parent[0] === 'string' ? 1 : 0 // keep a group label first
  const j = i + dir
  if (j < minIdx || j >= parent.length) return model
  const swap = (arr: WaveLane[]): WaveLane[] => {
    const c = arr.slice()
    ;[c[i], c[j]] = [c[j], c[i]]
    return c
  }
  if (parentPath.length === 0) return { ...model, signal: swap(model.signal) }
  return { ...model, signal: updateLane(model.signal, parentPath, (g) => swap(g as WaveLane[])) }
}

/** Existing group label strings anywhere in the model. */
function existingGroupLabels(model: WaveJson): Set<string> {
  const labels = new Set<string>()
  for (const row of flattenSignals(model)) {
    if (row.kind === 'group-label' && row.label) labels.add(row.label)
  }
  return labels
}

/** Append a new group `["ラベル", {新規信号}]` at the top level. */
export function addGroup(model: WaveJson): WaveJson {
  const ticks = currentMaxTicks(model)
  const wave = '0'.padEnd(ticks, '.')
  const used = existingGroupLabels(model)
  let label = 'グループ'
  for (let n = 2; used.has(label); n++) label = `グループ${n}`
  const group: WaveLane = [label, { name: uniqueName(model, 'sig'), wave }]
  return { ...model, signal: [...model.signal, group] }
}

/** Rename a group label (its row path points at the label string). */
export function setGroupLabel(model: WaveJson, labelPath: number[], label: string): WaveJson {
  return { ...model, signal: updateLane(model.signal, labelPath, () => label) }
}

/** Remove the whole group that owns the label at `labelPath`. */
export function removeGroup(model: WaveJson, labelPath: number[]): WaveJson {
  const groupPath = labelPath.slice(0, -1) // label → its containing group array
  return cleanupEdges({ ...model, signal: removeLane(model.signal, groupPath) })
}

/** Append a new signal inside the group that owns the label at `labelPath`. */
export function addSignalToGroup(model: WaveJson, labelPath: number[]): WaveJson {
  const groupPath = labelPath.slice(0, -1)
  const ticks = currentMaxTicks(model)
  const wave = '0'.padEnd(ticks, '.')
  const sig: WaveLane = { name: uniqueName(model, 'sig'), wave }
  return {
    ...model,
    signal: updateLane(model.signal, groupPath, (g) => [...(g as WaveLane[]), sig]),
  }
}

/** Longest wave length among all signals (local helper to avoid import cycle). */
function currentMaxTicks(model: WaveJson): number {
  let max = 0
  for (const row of flattenSignals(model)) {
    if (row.kind === 'signal' && row.signal?.wave) {
      max = Math.max(max, row.signal.wave.length)
    }
  }
  return Math.max(max, 1)
}

/**
 * Resize one signal's wave, remapping data by position. Node markers and edges
 * are intentionally LEFT INTACT: WaveDrom renders markers/edges that fall
 * outside the (shorter) wave without error, so a transient shrink must not
 * silently destroy annotations — they reappear when the wave grows back.
 */
function resizeSignal(sig: WaveSignal, len: number): WaveSignal {
  if (sig.wave === undefined) return sig
  const oldWave = sig.wave
  const wave = resizeWave(oldWave, len)
  const data = remapData(oldWave, dataToArray(sig.data), wave)
  return withData({ ...sig, wave }, data)
}

function mapSignals(model: WaveJson, fn: (sig: WaveSignal) => WaveSignal): WaveJson {
  const rec = (lanes: WaveLane[]): WaveLane[] =>
    lanes.map((lane) => {
      if (typeof lane === 'string') return lane
      if (Array.isArray(lane)) return rec(lane)
      if (Object.keys(lane).length === 0) return lane
      return fn(lane as WaveSignal)
    })
  // No edge cleanup here: resizing is not a delete, so it must not drop edges.
  return { ...model, signal: rec(model.signal) }
}

/** Grow every signal's wave by one tick. */
export function addTick(model: WaveJson): WaveJson {
  return mapSignals(model, (s) => resizeSignal(s, (s.wave?.length ?? 0) + 1))
}

/** Shrink every signal's wave by one tick (min 1). */
export function removeTick(model: WaveJson): WaveJson {
  return mapSignals(model, (s) => resizeSignal(s, Math.max(1, (s.wave?.length ?? 1) - 1)))
}

/** All edge strings currently defined. */
export function getEdges(model: WaveJson): string[] {
  return model.edge ? model.edge.slice() : []
}

export function setEdges(model: WaveJson, edges: string[]): WaveJson {
  if (edges.length === 0) {
    const { edge: _e, ...rest } = model
    void _e
    return rest
  }
  return { ...model, edge: edges }
}

/** Convenience: does the signal use any bus state needing data labels? */
export function hasBus(sig: WaveSignal): boolean {
  if (!sig.wave) return false
  for (const ch of sig.wave) if (isBusState(ch)) return true
  return false
}

/** Reference flatten for callers that mutate by displayed row. */
export { flattenSignals }
