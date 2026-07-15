import http from 'node:http'
import { fileURLToPath } from 'node:url'
import { validateWaveJson } from './wavejson.mjs'

const MAX_BODY_BYTES = 1_000_000
const DEFAULT_TIMEOUT_MS = 10_000
const MAX_CONCURRENT_CHAT_REQUESTS = 2
const requestKeys = new Set(['message', 'model', 'history'])
const historyKeys = new Set(['role', 'content'])
let activeChatRequests = 0

export async function start({ port, host, fetchImpl = globalThis.fetch, env = process.env } = {}) {
  const server = http.createServer((req, res) => {
    void handle(req, res, { fetchImpl, env })
  })
  server.headersTimeout = 10_000
  server.requestTimeout = 30_000

  const configuredPort = port ?? portFrom(env)
  const configuredHost = host ?? hostFrom(env)
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(configuredPort, configuredHost, () => {
      server.off('error', reject)
      resolve()
    })
  })
  return { server, port: server.address().port, host: configuredHost }
}

async function handle(req, res, options) {
  if (!isAllowedHost(req.headers.host) || !isAllowedOrigin(req.headers.origin)) {
    return sendJson(res, 403, { error: 'FORBIDDEN' })
  }

  const { pathname } = new URL(req.url, 'http://localhost')
  if (pathname === '/health') {
    if (req.method !== 'GET') return sendJson(res, 405, { error: 'METHOD_NOT_ALLOWED' })
    return sendJson(res, 200, { ok: true })
  }
  if (pathname !== '/api/chat') return sendJson(res, 404, { error: 'NOT_FOUND' })
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'METHOD_NOT_ALLOWED' })
  if (activeChatRequests >= MAX_CONCURRENT_CHAT_REQUESTS) return sendJson(res, 429, { error: 'AI_BUSY' })

  activeChatRequests += 1
  try {
    let request
    try {
      request = validateRequest(JSON.parse(await readBody(req)))
    } catch (error) {
      return sendJson(res, error?.code === 'REQUEST_TOO_LARGE' ? 413 : 400, { error: error?.code ?? 'INVALID_REQUEST' })
    }

    const config = readConfig(options.env)
    if (!config) return sendJson(res, 503, { error: 'AI_NOT_CONFIGURED' })

    let provider
    try {
      provider = await callProvider(request, config, options.fetchImpl)
    } catch (error) {
      return sendJson(res, error?.code === 'AI_TIMEOUT' ? 504 : 502, { error: error?.code ?? 'AI_PROVIDER_ERROR' })
    }

    try {
      if (!provider.response.ok) {
        await provider.response.body?.cancel().catch(() => {})
        return sendJson(res, 502, { error: 'AI_PROVIDER_ERROR' })
      }
      const proposal = validateProposal(await readProviderProposal(provider.response, provider.signal))
      return sendJson(res, 200, proposal)
    } catch (error) {
      const code = error?.code ?? (provider.signal.aborted ? 'AI_TIMEOUT' : undefined)
      return sendJson(res, code === 'AI_TIMEOUT' ? 504 : 502, { error: code ?? 'AI_INVALID_RESPONSE' })
    } finally {
      provider.dispose()
    }
  } finally {
    activeChatRequests -= 1
  }
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

function readBody(req) {
  const declaredLength = Number(req.headers['content-length'])
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    req.resume()
    return Promise.reject({ code: 'REQUEST_TOO_LARGE' })
  }
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        chunks.length = 0
        req.resume()
        reject({ code: 'REQUEST_TOO_LARGE' })
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function portFrom(env) {
  const value = env.AI_PORT ?? 51124
  const port = typeof value === 'string' && value.trim() === '' ? Number.NaN : Number(value)
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error('Invalid AI_PORT: expected an integer from 0 to 65535')
  }
  return port
}

function hostFrom(env) {
  const value = env.AI_HOST
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : '127.0.0.1'
}

function isAllowedHost(value) {
  if (typeof value !== 'string') return false
  try {
    return isLoopbackHostname(new URL(`http://${value}`).hostname)
  } catch {
    return false
  }
}

function isAllowedOrigin(value) {
  if (value === undefined) return true
  if (typeof value !== 'string') return false
  try {
    return isLoopbackHostname(new URL(value).hostname)
  } catch {
    return false
  }
}

function isLoopbackHostname(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]'
}

function validateRequest(value) {
  if (!isRecord(value) || !hasOnlyKeys(value, requestKeys)) throw invalidRequest()
  if (typeof value.message !== 'string' || value.message.trim() === '') throw invalidRequest()
  if (!validateWaveJson(value.model).ok) throw invalidRequest()
  if (hasOwn(value, 'history') && (!Array.isArray(value.history) || !value.history.every(isValidHistoryItem))) throw invalidRequest()
  return value
}

function isValidHistoryItem(value) {
  return isRecord(value)
    && hasOnlyKeys(value, historyKeys)
    && (value.role === 'user' || value.role === 'assistant')
    && typeof value.content === 'string'
}

function readConfig(env) {
  const baseUrl = typeof env.AI_BASE_URL === 'string' ? env.AI_BASE_URL.trim() : ''
  const apiKey = typeof env.AI_API_KEY === 'string' ? env.AI_API_KEY.trim() : ''
  const model = typeof env.AI_MODEL === 'string' ? env.AI_MODEL.trim() : ''
  if (!baseUrl || !apiKey || !model) return null
  try {
    return { apiKey, model, endpoint: new URL('chat/completions', `${baseUrl.replace(/\/+$/, '')}/`).toString(), timeoutMs: timeoutFrom(env) }
  } catch {
    return null
  }
}

function timeoutFrom(env) {
  const value = Number(env.AI_TIMEOUT_MS)
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_TIMEOUT_MS
}

async function callProvider(request, config, fetchImpl) {
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, config.timeoutMs)
  try {
    const response = await fetchImpl(config.endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        model: config.model,
        response_format: { type: 'text' },
        max_tokens: 2048,
        chat_template_kwargs: { enable_thinking: false },
        reasoning_effort: 'none',
        messages: [
          { role: 'system', content: 'Return exactly one JSON object with only "message", "model", and "warnings". "message" must be a string, "model" must be valid WaveJSON, and "warnings" must be an array of strings.' },
          ...(request.history ?? []),
          { role: 'user', content: `${request.message}\n\nCurrent WaveJSON:\n${JSON.stringify(request.model)}` },
        ],
      }),
      signal: controller.signal,
    })
    return {
      response,
      signal: controller.signal,
      dispose: () => clearTimeout(timer),
    }
  } catch (error) {
    clearTimeout(timer)
    if (timedOut) throw { code: 'AI_TIMEOUT' }
    throw error
  }
}

async function readProviderProposal(response, signal) {
  const payload = JSON.parse(await readProviderBody(response, signal))
  const content = payload?.choices?.[0]?.message?.content
  if (typeof content !== 'string') throw new Error('missing message content')
  const proposal = parseProviderProposal(content)
  if (isRecord(proposal) && typeof proposal.model === 'string') {
    const embeddedModel = extractEmbeddedWaveJson(content)
    if (embeddedModel) proposal.model = embeddedModel
  }
  return proposal
}

function parseProviderProposal(content) {
  try {
    return JSON.parse(unfenceJson(content))
  } catch (error) {
    const fenced = content.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/i)
    if (!fenced) throw error
    return JSON.parse(fenced[1])
  }
}

function extractEmbeddedWaveJson(content) {
  const candidates = [...content.matchAll(/`([\s\S]*?)`/g)]
  for (const [, candidate] of candidates) {
    try {
      const value = JSON.parse(candidate)
      if (validateWaveJson(value).ok) return value
    } catch {
      // Ignore non-JSON commentary snippets.
    }
  }
  return undefined
}

async function readProviderBody(response, signal) {
  const declaredLength = response.headers.get('content-length')
  if (declaredLength !== null && Number(declaredLength) > MAX_BODY_BYTES) {
    await response.body?.cancel().catch(() => {})
    throw { code: 'AI_RESPONSE_TOO_LARGE' }
  }

  const reader = response.body?.getReader()
  if (!reader) return ''

  let rejectOnAbort
  const abortPromise = new Promise((_, reject) => {
    rejectOnAbort = () => {
      void reader.cancel().catch(() => {})
      reject({ code: 'AI_TIMEOUT' })
    }
    signal.addEventListener('abort', rejectOnAbort, { once: true })
  })
  if (signal.aborted) rejectOnAbort()

  try {
    let size = 0
    const chunks = []
    while (true) {
      const { done, value } = await Promise.race([reader.read(), abortPromise])
      if (done) return Buffer.concat(chunks).toString('utf8')
      size += value.byteLength
      if (size > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => {})
        throw { code: 'AI_RESPONSE_TOO_LARGE' }
      }
      chunks.push(Buffer.from(value))
    }
  } catch (error) {
    if (signal.aborted) throw { code: 'AI_TIMEOUT' }
    throw error
  } finally {
    signal.removeEventListener('abort', rejectOnAbort)
  }
}

function unfenceJson(content) {
  const match = content.trim().match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i)
  return match ? match[1] : content
}

function validateProposal(value) {
  const proposalKeys = new Set(['message', 'model', 'warnings'])
  if (!isRecord(value) || !hasOnlyKeys(value, proposalKeys)) throw new Error('invalid proposal')
  if (typeof value.message !== 'string' || !Array.isArray(value.warnings) || !value.warnings.every((warning) => typeof warning === 'string')) {
    throw new Error('invalid proposal')
  }
  const modelValue = typeof value.model === 'string' ? parseJsonModel(value.model) : value.model
  const model = validateWaveJson(modelValue)
  if (!model.ok) throw new Error('invalid model')
  return { message: value.message, model: model.model, warnings: value.warnings }
}

function parseJsonModel(value) {
  try {
    return JSON.parse(value)
  } catch {
    throw new Error('invalid model')
  }
}

function isRecord(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function hasOnlyKeys(value, allowed) {
  return Reflect.ownKeys(value).every((key) => typeof key === 'string' && allowed.has(key))
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function invalidRequest() {
  return { code: 'INVALID_REQUEST' }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  start().then(({ host, port }) => {
    console.log(`timing-chart AI API → http://${host}:${port}`)
    console.log('  POST /api/chat · OpenAI-compatible proxy')
  }).catch((error) => {
    console.error('AI API failed to start:', error?.message ?? error)
    process.exitCode = 1
  })
}
