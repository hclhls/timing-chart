// Unit tests for the core model/state logic (wave codec + GUI mutations).
// Imports the real TS via the esbuild-bundled fixture (built by `pretest`).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { codec, actions, pwl, validation, diff } from './_bundles/lib.mjs'

// ---- AI proposal boundary helpers ----

test('validateWaveJson accepts supported signals and nested groups', () => {
  const value = {
    signal: [
      { name: 'clk', wave: 'p.' },
      ['bus group', { name: 'bus', wave: '=.', data: ['A0'] }],
    ],
    edge: ['a~>b'],
    config: { hscale: 2, skin: 'narrow' },
    head: { text: 'Title', tick: 1, tock: 2, every: 3 },
    foot: { text: 'Caption' },
  }
  const result = validation.validateWaveJson(value)
  assert.equal(result.ok, true)
  assert.deepEqual(result.model, value)
})

test('validateWaveJson rejects malformed lanes and optional fields', () => {
  const invalid = [
    { signal: 'not an array' },
    { signal: [{ name: 1, wave: '0' }] },
    { signal: [{ name: 's', wave: 1 }] },
    { signal: [{ name: 's', wave: '0', data: ['ok', 1] }] },
    { signal: [['group', []]] },
    { signal: [{ wave: '0' }], edge: [1] },
    { signal: [{ wave: '0' }], config: { hscale: Infinity } },
    { signal: [{ wave: '0' }], head: { tick: NaN } },
    { signal: [{ wave: '0' }], foot: 'caption' },
  ]
  for (const value of invalid) {
    const result = validation.validateWaveJson(value)
    assert.equal(result.ok, false, JSON.stringify(value))
    assert.equal(typeof result.error, 'string')
  }
})

test('validateWaveJson requires signal to be an own property', () => {
  const root = Object.create({ signal: [{ wave: '0' }] })
  const nested = { signal: [Object.create({ wave: '0' })] }
  for (const value of [root, nested]) {
    const result = validation.validateWaveJson(value)
    assert.equal(result.ok, false)
  }
})

test('validateWaveJson rejects explicitly undefined optional fields', () => {
  const invalid = [
    { signal: [{ wave: '0', name: undefined }] },
    { signal: [{ wave: '0', data: undefined }] },
    { signal: [{ wave: '0', node: undefined }] },
    { signal: [{ wave: '0', period: undefined }] },
    { signal: [{ wave: '0', phase: undefined }] },
    { signal: [{ wave: '0' }], edge: undefined },
    { signal: [{ wave: '0' }], config: undefined },
    { signal: [{ wave: '0' }], head: undefined },
    { signal: [{ wave: '0' }], foot: undefined },
  ]
  for (const value of invalid) {
    const result = validation.validateWaveJson(value)
    assert.equal(result.ok, false, JSON.stringify(value))
  }
})

test('diffWaveJson is empty for equal models and deterministic for changes', () => {
  const before = { signal: [{ name: 'a', wave: '0' }] }
  const after = { signal: [{ name: 'a', wave: '1' }, { name: 'b', wave: '0' }] }
  assert.equal(diff.diffWaveJson(before, before), '')
  assert.equal(
    diff.diffWaveJson(before, after),
    'M signal[0].wave: "0" -> "1"\nA signal[1]: {"name":"b","wave":"0"}',
  )
  assert.equal(diff.diffWaveJson(before, after), diff.diffWaveJson(before, after))
})

// ---- wave-codec: the lossless expand/compress contract ----

test('expand/compress is lossless and distinguishes "=..." from "===="', () => {
  for (const w of ['0', '01', 'p..x34.5z', '=...', '====', 'x=.=.x', '0.1.0.1.', '|', '0|0']) {
    assert.equal(codec.compressCells(codec.expandWave(w)), w, `round-trip ${w}`)
  }
  // The crucial distinction: one extended bus segment vs four separate ones.
  assert.equal(codec.expandWave('=...').filter((c) => c.head).length, 1)
  assert.equal(codec.expandWave('====').filter((c) => c.head).length, 4)
})

test('busHeadTicks / busSegmentCount / dataIndexAtTick', () => {
  assert.deepEqual(codec.busHeadTicks('=.=.'), [0, 2])
  assert.equal(codec.busSegmentCount('=.=.'), 2)
  assert.equal(codec.busSegmentCount('x=.=.x'), 2)
  assert.equal(codec.dataIndexAtTick('=.=.', 0), 0)
  assert.equal(codec.dataIndexAtTick('=.=.', 2), 1) // 2nd segment → data[1]
  assert.equal(codec.dataIndexAtTick('=.=.', 1), -1) // extension cell, not a head
})

test('isBusState, setTick, extendTick, resizeWave', () => {
  assert.equal(codec.isBusState('='), true)
  assert.equal(codec.isBusState('3'), true)
  assert.equal(codec.isBusState('1'), false)
  assert.equal(codec.isBusState('p'), false)
  assert.equal(codec.setTick('0000', 2, '1'), '0010') // each '0' is its own head
  assert.equal(codec.extendTick('0101', 1), '0.01') // tick1 becomes extension of tick0
  assert.equal(codec.resizeWave('01', 4), '01..') // pad by extending last level
  assert.equal(codec.resizeWave('0123', 2), '01') // truncate
})

test('waveJsonToPwl exports digital voltage sources and falls back on buses', () => {
  const text = pwl.waveJsonToPwl({
    signal: [
      { name: 'clk', wave: 'p.' },
      { name: 'enable', wave: '01' },
      { name: 'bus', wave: '=.', data: ['A0'] },
    ],
  })

  assert.match(text, /V100 clk GND pwl\(0,0, 0\.5,1, 1,0, 1\.5,1, 2,0\)/)
  assert.match(text, /V101 enable GND pwl\(0,0, 1,0, 1,1, 2,1\)/)
  assert.match(text, /V102 bus GND pwl\(0,0, 1,0, 2,0\)/)
})

test('waveJsonToPwl supports source index and time suffix options', () => {
  const text = pwl.waveJsonToPwl(
    { signal: [{ name: 'in', wave: '01' }] },
    { step: 10, high: 1.8, sourceStart: 200, timeSuffix: 'n' },
  )

  assert.match(text, /V200 in GND pwl\(0n,0, 10n,0, 10n,1\.8, 20n,1\.8\)/)
})

test('signalToPwlPoints falls back unsupported cells to prior digital state', () => {
  assert.deepEqual(
    pwl.signalToPwlPoints({ name: 's', wave: '1=xz0' }),
    [
      { t: 0, v: 1 },
      { t: 1, v: 1 },
      { t: 2, v: 1 },
      { t: 3, v: 1 },
      { t: 4, v: 1 },
      { t: 4, v: 0 },
      { t: 5, v: 0 },
    ],
  )
})

test('signalToPwlPoints applies period and phase', () => {
  assert.deepEqual(
    pwl.signalToPwlPoints({ name: 's', wave: '1', period: 2, phase: 0.25 }, 10),
    [
      { t: 2.5, v: 1 },
      { t: 22.5, v: 1 },
    ],
  )
})

// ---- actions: GUI mutations (each returns a NEW model) ----

const M = () => ({
  signal: [
    { name: 'clk', wave: '010101' }, // 6 ticks, matching bus
    { name: 'bus', wave: 'x=.=.x', data: ['A0', 'A1'] },
  ],
})

test('makeClock drops data/node and writes a clock wave', () => {
  const m = { signal: [{ name: 's', wave: 'x=.x', data: ['A'], node: 'a...' }] }
  const r = actions.makeClock(m, [0])
  assert.equal(r.signal[0].name, 's')
  assert.equal(r.signal[0].wave, 'p...') // clockWave over the model's tick count
  assert.equal(r.signal[0].data, undefined)
  assert.equal(r.signal[0].node, undefined)
  assert.notEqual(r, m) // new object
})

test('duplicateSignal: top-level, in-group, and group-label no-op', () => {
  const r = actions.duplicateSignal(M(), [1])
  assert.deepEqual(
    r.signal.map((s) => s.name),
    ['clk', 'bus', 'bus2'],
  )
  assert.deepEqual(r.signal[2].data, ['A0', 'A1'])
  assert.notEqual(r.signal[2].data, r.signal[1].data) // independent copy

  const g = { signal: [['G', { name: 'a', wave: '0' }, { name: 'b', wave: '1' }]] }
  const rg = actions.duplicateSignal(g, [0, 1])
  assert.deepEqual(rg.signal[0].slice(1).map((s) => s.name), ['a', 'a2', 'b'])
  assert.equal(actions.duplicateSignal(g, [0, 0]), g) // label isn't a signal → no-op
})

test('moveRow swaps within parent; boundary is a no-op (same ref)', () => {
  const m = M()
  assert.equal(actions.moveRow(m, [0], -1), m) // already at top
  const r = actions.moveRow(m, [0], 1)
  assert.deepEqual(
    r.signal.map((s) => s.name),
    ['bus', 'clk'],
  )
})

test('addTick / removeTick grow/shrink each signal by one and preserve bus data', () => {
  const m = M() // both signals are 6 ticks
  const grown = actions.addTick(m) // each +1 from its own length
  assert.ok(grown.signal.every((s) => s.wave.length === 7))
  assert.deepEqual(grown.signal[1].data, ['A0', 'A1']) // bus labels intact
  const shrunk = actions.removeTick(grown)
  assert.ok(shrunk.signal.every((s) => s.wave.length === 6))
  assert.deepEqual(shrunk.signal[1].data, ['A0', 'A1'])
})

test('setSignalPeriod / setSignalPhase set and drop to keep JSON clean', () => {
  let r = actions.setSignalPeriod(M(), [0], 2)
  assert.equal(r.signal[0].period, 2)
  r = actions.setSignalPeriod(r, [0], 1) // default → field removed
  assert.equal(r.signal[0].period, undefined)
  r = actions.setSignalPhase(M(), [0], 0.5)
  assert.equal(r.signal[0].phase, 0.5)
  r = actions.setSignalPhase(r, [0], 0)
  assert.equal(r.signal[0].phase, undefined)
})
