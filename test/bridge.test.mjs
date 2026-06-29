// Bridge server tests (Node built-in runner): `npm test`
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { start } from '../bridge/server.mjs'

let server
let base

before(async () => {
  server = start(0) // 0 → random free port on 127.0.0.1
  await new Promise((r) => server.once('listening', r))
  base = `http://127.0.0.1:${server.address().port}`
})
after(() => {
  server.closeAllConnections?.() // force-close keep-alive SSE sockets
  server.close()
})

const post = (body, headers = {}) =>
  fetch(`${base}/model`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })

test('health reports ok + rev', async () => {
  const j = await (await fetch(`${base}/health`)).json()
  assert.equal(j.ok, true)
  assert.equal(typeof j.rev, 'number')
})

test('POST valid model then GET returns it', async () => {
  const m = { signal: [{ name: 'a', wave: '01' }] }
  const r = await post(m)
  assert.equal(r.status, 200)
  const j = await r.json()
  assert.equal(j.ok, true)
  assert.ok(j.rev >= 1)
  assert.deepEqual(await (await fetch(`${base}/model`)).json(), m)
})

test('POST invalid shape → 400', async () => {
  assert.equal((await post({ nope: 1 })).status, 400)
})

test('POST signal with non-string wave → 400 (would crash the tab)', async () => {
  assert.equal((await post({ signal: [{ name: 'a', wave: 123 }] })).status, 400)
  assert.equal((await post({ signal: [{ name: 7, wave: '01' }] })).status, 400)
})

test('POST non-JSON → 400', async () => {
  assert.equal((await post('{ broken')).status, 400)
})

test('rev increments per accepted POST', async () => {
  const before = (await (await fetch(`${base}/health`)).json()).rev
  await post({ signal: [] })
  const after = (await (await fetch(`${base}/health`)).json()).rev
  assert.equal(after, before + 1)
})

test('SSE initial frame carries model, rev, source', async () => {
  await post({ signal: [{ name: 'Z', wave: '0' }] }, { 'X-Client-Id': 'tester' })
  const res = await fetch(`${base}/events`)
  const reader = res.body.getReader()
  const { value } = await reader.read()
  const text = new TextDecoder().decode(value)
  const frame = JSON.parse(text.replace(/^data: /, '').trim())
  assert.ok(Array.isArray(frame.model.signal))
  assert.equal(typeof frame.rev, 'number')
  assert.equal(frame.source, 'tester')
  await reader.cancel()
})

test('path traversal is blocked', async () => {
  const txt = await (await fetch(`${base}/..%2f..%2fpackage.json`)).text()
  assert.ok(!txt.includes('"dependencies"'))
})
