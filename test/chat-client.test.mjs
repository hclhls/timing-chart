import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chat } from './_bundles/lib.mjs'

const model = { signal: [{ name: 'clk', wave: 'p.' }] }
const proposal = { message: 'Added reset', model, warnings: ['Check polarity'] }

test('requestChat serializes the request and returns a valid proposal', async () => {
  let request
  const result = await chat.requestChat(
    { message: 'Add reset', model, history: [{ role: 'assistant', content: 'Sure' }] },
    {
      fetchImpl: async (url, options) => {
        request = { url, options }
        return new Response(JSON.stringify(proposal), { status: 200 })
      },
    },
  )

  assert.equal(request.url, '/api/chat')
  assert.equal(request.options.method, 'POST')
  assert.equal(request.options.headers['Content-Type'], 'application/json')
  assert.deepEqual(JSON.parse(request.options.body), {
    message: 'Add reset',
    model,
    history: [{ role: 'assistant', content: 'Sure' }],
  })
  assert.deepEqual(result, proposal)
})

test('requestChat allows enough time for local large-model inference by default', () => {
  assert.equal(chat.DEFAULT_CHAT_TIMEOUT_MS, 120_000)
})

test('requestChat rejects HTTP errors with a readable stable error', async () => {
  await assert.rejects(
    chat.requestChat({ message: 'Add reset', model }, {
      fetchImpl: async () => new Response(JSON.stringify({ error: 'AI_TIMEOUT' }), { status: 504, statusText: 'Gateway Timeout' }),
    }),
    { message: 'Chat request failed: 504' },
  )
})

test('requestChat rejects malformed successful responses', async () => {
  await assert.rejects(
    chat.requestChat({ message: 'Add reset', model }, {
      fetchImpl: async () => new Response(JSON.stringify({ message: 'Bad', model: { signal: [{ wave: 1 }] }, warnings: [] }), { status: 200 }),
    }),
    { message: 'Chat response is invalid' },
  )
})

test('requestChat aborts a stalled request after the configured timeout', async () => {
  let signal
  await assert.rejects(
    chat.requestChat({ message: 'Add reset', model }, {
      timeoutMs: 10,
      fetchImpl: async (_url, options) => {
        signal = options.signal
        return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason)))
      },
    }),
    { message: 'Chat request timed out' },
  )
  assert.equal(signal.aborted, true)
})

test('requestChat clears its timeout after a successful response', async () => {
  let signal
  await chat.requestChat({ message: 'Add reset', model }, {
    timeoutMs: 10,
    fetchImpl: async (_url, options) => {
      signal = options.signal
      return new Response(JSON.stringify(proposal), { status: 200 })
    },
  })
  await new Promise((resolve) => setTimeout(resolve, 30))
  assert.equal(signal.aborted, false)
})
