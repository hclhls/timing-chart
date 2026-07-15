import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { start } from '../api/server.mjs'

const validModel = { signal: [{ name: 'clk', wave: 'p.' }] }
const servers = []

after(async () => {
  await Promise.all(servers.map(({ server }) => new Promise((resolve) => server.close(resolve))))
})

async function createApi({ fetchImpl, env = {} } = {}) {
  const api = await start({
    port: 0,
    fetchImpl,
    env: { AI_BASE_URL: 'https://provider.example/v1', AI_API_KEY: 'test-key', AI_MODEL: 'test-model', ...env },
  })
  servers.push(api)
  return `http://127.0.0.1:${api.port}`
}

async function chat(base, body, { headers = {} } = {}) {
  return fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

async function rawChat(base, body, headers) {
  const url = new URL('/api/chat', base)
  return new Promise((resolve, reject) => {
    const request = http.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
    }, (response) => {
      const chunks = []
      response.on('data', (chunk) => chunks.push(chunk))
      response.on('end', () => resolve(new Response(Buffer.concat(chunks), {
        status: response.statusCode,
        headers: response.headers,
      })))
    })
    request.on('error', reject)
    request.end(JSON.stringify(body))
  })
}

test('POST /api/chat rejects non-loopback Hosts before calling a provider', async () => {
  let called = false
  const base = await createApi({
    fetchImpl: async () => {
      called = true
      return new Response('{}')
    },
  })

  const response = await rawChat(base, { message: 'Add reset', model: validModel }, { Host: 'provider.example' })
  assert.equal(response.status, 403)
  assert.deepEqual(await response.json(), { error: 'FORBIDDEN' })
  assert.equal(called, false)
})

test('POST /api/chat rejects untrusted Origins before calling a provider', async () => {
  let called = false
  const base = await createApi({
    fetchImpl: async () => {
      called = true
      return new Response('{}')
    },
  })

  const response = await chat(base, { message: 'Add reset', model: validModel }, {
    headers: { Origin: 'https://attacker.example' },
  })
  assert.equal(response.status, 403)
  assert.deepEqual(await response.json(), { error: 'FORBIDDEN' })
  assert.equal(called, false)
})

test('POST /api/chat reports missing AI configuration without calling a provider', async () => {
  let called = false
  const base = await createApi({
    env: { AI_API_KEY: '' },
    fetchImpl: async () => {
      called = true
      return new Response('{}')
    },
  })

  const response = await chat(base, { message: 'Add a reset lane', model: validModel })
  assert.equal(response.status, 503)
  assert.deepEqual(await response.json(), { error: 'AI_NOT_CONFIGURED' })
  assert.equal(called, false)
})

test('POST /api/chat limits concurrent provider requests', async () => {
  const releases = []
  let calls = 0
  const base = await createApi({
    fetchImpl: async () => {
      calls += 1
      return new Promise((resolve) => releases.push(() => resolve(new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ message: 'ok', model: validModel, warnings: [] }) } }],
      }), { status: 200 }))))
    },
  })
  const body = { message: 'Add reset', model: validModel }
  const first = chat(base, body)
  const second = chat(base, body)
  while (calls < 2) await new Promise((resolve) => setTimeout(resolve, 1))

  const rejected = await chat(base, body)
  assert.equal(rejected.status, 429)
  assert.deepEqual(await rejected.json(), { error: 'AI_BUSY' })

  releases.forEach((release) => release())
  await Promise.all([first, second])
})

test('GET /health reports readiness without AI configuration while retaining Host protection', async () => {
  let called = false
  const base = await createApi({
    env: { AI_BASE_URL: '', AI_API_KEY: '', AI_MODEL: '' },
    fetchImpl: async () => {
      called = true
      return new Response('{}')
    },
  })

  const response = await fetch(`${base}/health`)
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { ok: true })
  assert.equal(called, false)

  const forbidden = await new Promise((resolve, reject) => {
    const url = new URL('/health', base)
    const request = http.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      headers: { Host: 'provider.example' },
    }, (response) => {
      const chunks = []
      response.on('data', (chunk) => chunks.push(chunk))
      response.on('end', () => resolve(new Response(Buffer.concat(chunks), {
        status: response.statusCode,
        headers: response.headers,
      })))
    })
    request.on('error', reject)
    request.end()
  })
  assert.equal(forbidden.status, 403)
  assert.deepEqual(await forbidden.json(), { error: 'FORBIDDEN' })
})

test('POST /api/chat rejects malformed request bodies and invalid WaveJSON', async () => {
  const base = await createApi()
  for (const body of [
    '{ broken',
    { message: 1, model: validModel },
    { message: 'Add a reset lane', model: { signal: [{ wave: 1 }] } },
    { message: 'Add a reset lane', model: validModel, history: [{ role: 'system', content: 'nope' }] },
  ]) {
    const response = await chat(base, body)
    assert.equal(response.status, 400)
    assert.deepEqual(await response.json(), { error: 'INVALID_REQUEST' })
  }
})

test('POST /api/chat returns a structured provider proposal including fenced JSON', async () => {
  let request
  const base = await createApi({
    fetchImpl: async (url, options) => {
      request = { url, options }
      return new Response(JSON.stringify({
        choices: [{ message: { content: '```json\n{"message":"Added reset","model":{"signal":[{"name":"rst","wave":"01"}]},"warnings":[]}\n```' } }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    },
  })

  const response = await chat(base, {
    message: 'Add reset',
    model: validModel,
    history: [{ role: 'assistant', content: 'I can help.' }],
  })
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), {
    message: 'Added reset',
    model: { signal: [{ name: 'rst', wave: '01' }] },
    warnings: [],
  })
  assert.equal(request.url, 'https://provider.example/v1/chat/completions')
  assert.equal(request.options.headers.Authorization, 'Bearer test-key')
  const providerBody = JSON.parse(request.options.body)
  assert.equal(providerBody.model, 'test-model')
  assert.deepEqual(providerBody.response_format, { type: 'text' })
  assert.equal(providerBody.max_tokens, 2048)
  assert.deepEqual(providerBody.chat_template_kwargs, { enable_thinking: false })
  assert.equal(providerBody.reasoning_effort, 'none')
  assert.match(providerBody.messages[0].content, /exactly.*message.*model.*warnings/i)
})

test('POST /api/chat accepts a provider that serializes the WaveJSON model as a string', async () => {
  const base = await createApi({
    fetchImpl: async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        message: 'Added a blank row',
        model: JSON.stringify({ signal: [{ name: 'blank', wave: '...' }] }),
        warnings: [],
      }) } }],
    }), { status: 200 }),
  })

  const response = await chat(base, { message: 'Add a blank row', model: validModel })
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), {
    message: 'Added a blank row',
    model: { signal: [{ name: 'blank', wave: '...' }] },
    warnings: [],
  })
})

test('POST /api/chat extracts WaveJSON embedded in provider commentary', async () => {
  const model = { signal: [{ name: 'blank', wave: '...' }] }
  const base = await createApi({
    fetchImpl: async () => new Response(JSON.stringify({
      choices: [{ message: { content: `\`\`\`json
{"message":"Added a blank row","model":"WaveJSON","warnings":[]}

\`\`\`

Updated model: \`${JSON.stringify(model)}\`` } }],
    }), { status: 200 }),
  })

  const response = await chat(base, { message: 'Add a blank row', model: validModel })
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { message: 'Added a blank row', model, warnings: [] })
})

test('POST /api/chat maps non-success provider responses to a stable error', async () => {
  const base = await createApi({ fetchImpl: async () => new Response('down', { status: 503 }) })
  const response = await chat(base, { message: 'Add reset', model: validModel })
  assert.equal(response.status, 502)
  assert.deepEqual(await response.json(), { error: 'AI_PROVIDER_ERROR' })
})

test('POST /api/chat cancels a stalled body for non-success provider responses', async () => {
  let cancelled = false
  const base = await createApi({
    fetchImpl: async () => new Response(new ReadableStream({
      pull: () => new Promise(() => {}),
      cancel: () => {
        cancelled = true
      },
    }), { status: 503 }),
  })

  const response = await chat(base, { message: 'Add reset', model: validModel })
  assert.equal(response.status, 502)
  assert.deepEqual(await response.json(), { error: 'AI_PROVIDER_ERROR' })
  assert.equal(cancelled, true)
})

test('POST /api/chat rejects malformed provider content', async () => {
  const base = await createApi({
    fetchImpl: async () => new Response(JSON.stringify({ choices: [{ message: { content: 'not json' } }] }), { status: 200 }),
  })
  const response = await chat(base, { message: 'Add reset', model: validModel })
  assert.equal(response.status, 502)
  assert.deepEqual(await response.json(), { error: 'AI_INVALID_RESPONSE' })
})

test('POST /api/chat rejects returned models that fail WaveJSON validation', async () => {
  const base = await createApi({
    fetchImpl: async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ message: 'Bad', model: { signal: [{ wave: 7 }] }, warnings: [] }) } }],
    }), { status: 200 }),
  })
  const response = await chat(base, { message: 'Add reset', model: validModel })
  assert.equal(response.status, 502)
  assert.deepEqual(await response.json(), { error: 'AI_INVALID_RESPONSE' })
})

test('POST /api/chat aborts a provider request that exceeds the timeout', async () => {
  const base = await createApi({
    env: { AI_TIMEOUT_MS: '20' },
    fetchImpl: async (_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason))
    }),
  })
  const response = await chat(base, { message: 'Add reset', model: validModel })
  assert.equal(response.status, 504)
  assert.deepEqual(await response.json(), { error: 'AI_TIMEOUT' })
})

test('POST /api/chat times out while consuming a stalled provider response body', async () => {
  let cancelled = false
  const base = await createApi({
    env: { AI_TIMEOUT_MS: '20' },
    fetchImpl: async () => new Response(new ReadableStream({
      pull: () => new Promise(() => {}),
      cancel: () => {
        cancelled = true
      },
    })),
  })

  const response = await chat(base, { message: 'Add reset', model: validModel })
  assert.equal(response.status, 504)
  assert.deepEqual(await response.json(), { error: 'AI_TIMEOUT' })
  assert.equal(cancelled, true)
})

test('POST /api/chat rejects oversized provider response bodies before JSON parsing', async () => {
  const base = await createApi({
    fetchImpl: async () => new Response('x'.repeat(1_000_001)),
  })

  const response = await chat(base, { message: 'Add reset', model: validModel })
  assert.equal(response.status, 502)
  assert.deepEqual(await response.json(), { error: 'AI_RESPONSE_TOO_LARGE' })
})

test('POST /api/chat rejects bodies above the size limit', async () => {
  const base = await createApi()
  const response = await chat(base, { message: 'x'.repeat(1_000_001), model: validModel })
  assert.equal(response.status, 413)
  assert.deepEqual(await response.json(), { error: 'REQUEST_TOO_LARGE' })
})

test('start rejects an invalid AI_PORT with a clear configuration error', async () => {
  await assert.rejects(
    start({ env: { AI_PORT: 'not-a-port' } }),
    /Invalid AI_PORT: expected an integer from 0 to 65535/,
  )
})

test('start uses AI_HOST when configured and otherwise binds to loopback', async () => {
  const publicApi = await start({ port: 0, env: { AI_HOST: '0.0.0.0' } })
  const localApi = await start({ port: 0, env: {} })
  servers.push(publicApi, localApi)

  assert.equal(publicApi.server.address().address, '0.0.0.0')
  assert.equal(localApi.server.address().address, '127.0.0.1')
  assert.equal(publicApi.host, '0.0.0.0')
  assert.equal(localApi.host, '127.0.0.1')
})
