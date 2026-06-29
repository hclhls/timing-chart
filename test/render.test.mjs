// WaveDrom render smoke tests (Node built-in runner): `npm test`
// Guards the rendering contract the app depends on — that the merged skin map
// and the model shapes the GUI produces actually render without throwing, and
// that head/foot (title + cycle-number axis) reach the output. Renders headless
// via renderAny + onml.stringify (no DOM), mirroring src/render/skins.ts.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const w = require('wavedrom')
// Each skin module exports under its own name key ({default:[…]}, {narrow:[…]},
// …); merge raw so the renderer can pick via waveSkin[config.skin] (mirrors
// src/render/skins.ts). Do NOT unwrap .default — that collapses the map.
const SKIN = Object.assign(
  {},
  require('wavedrom/skins/default.js'),
  require('wavedrom/skins/narrow.js'),
  require('wavedrom/skins/lowkey.js'),
  require('wavedrom/skins/dark.js'),
)

// renderAny mutates its source; hand it a deep copy so the model literal is safe.
const render = (model) => w.onml.stringify(w.renderAny(0, structuredClone(model), SKIN))

test('renders a basic clock + data chart', () => {
  const svg = render({ signal: [{ name: 'clk', wave: 'p...' }, { name: 'd', wave: '0.1.' }] })
  assert.ok(svg.startsWith('<svg'))
  assert.ok(svg.length > 1000)
})

test('head/foot reach the output (title, caption, cycle numbers)', () => {
  const svg = render({
    signal: [{ name: 'clk', wave: 'p...' }],
    head: { text: 'TITLE_MARKER', tick: 5 },
    foot: { text: 'FOOT_MARKER' },
  })
  assert.ok(svg.includes('TITLE_MARKER'), 'head.text missing')
  assert.ok(svg.includes('FOOT_MARKER'), 'foot.text missing')
  // tick:5 ⇒ the cycle axis is numbered 5,6,7,8 across the 4 ticks.
  assert.ok(/[>"]5[<"]/.test(svg) && /[>"]8[<"]/.test(svg), 'cycle numbers missing')
})

test('bus with data labels renders', () => {
  const svg = render({
    signal: [{ name: 'addr', wave: 'x=.=.x', data: ['A0', 'A1'] }],
  })
  assert.ok(svg.includes('A0') && svg.includes('A1'))
})

test('groups, hscale and a non-default skin render without throwing', () => {
  const svg = render({
    signal: [['バス', { name: 'a', wave: '01' }, { name: 'b', wave: '10' }], { name: 'c', wave: 'x=', data: ['v'] }],
    config: { hscale: 2, skin: 'narrow' },
  })
  assert.ok(svg.startsWith('<svg'))
})

// Mirror src/model/parse.ts isValidLane — guards the share-URL / localStorage
// path against malformed models that would crash the tab and trap it on reload.
// (Kept in sync by hand; the app parser is TypeScript and not importable here.)
function isValidLane(lane) {
  if (typeof lane === 'string') return true
  if (Array.isArray(lane)) return lane.length > 0 && lane.every(isValidLane)
  if (typeof lane !== 'object' || lane === null) return false
  if ('wave' in lane && typeof lane.wave !== 'string') return false
  if ('name' in lane && typeof lane.name !== 'string') return false
  if ('node' in lane && typeof lane.node !== 'string') return false
  if ('data' in lane && !(typeof lane.data === 'string' || Array.isArray(lane.data))) return false
  if ('period' in lane && typeof lane.period !== 'number') return false
  if ('phase' in lane && typeof lane.phase !== 'number') return false
  return true
}

test('lane validation rejects the crash-inducing shapes', () => {
  assert.equal(isValidLane({ name: 'a', wave: 5 }), false) // non-string wave → expandWave crash
  assert.equal(isValidLane({ name: 'a', wave: '01', data: 5 }), false) // non-array data → split crash
  assert.equal(isValidLane({ name: 7, wave: '01' }), false)
  assert.equal(isValidLane([]), false) // empty dead lane
  // valid shapes still pass
  assert.equal(isValidLane({ name: 'a', wave: '01', data: ['x'] }), true)
  assert.equal(isValidLane(['group', { name: 'a', wave: '0' }]), true)
  assert.equal(isValidLane('label'), true)
  assert.equal(isValidLane({ name: 'clk', wave: 'p', period: 2, phase: 0.5 }), true)
})
