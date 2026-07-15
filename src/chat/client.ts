import { validateWaveJson } from '../model/validate'
import type { ChatProposal, ChatRequest } from './types'

const DEFAULT_TIMEOUT_MS = 30_000
const proposalKeys = new Set(['message', 'model', 'warnings'])

export async function requestChat(
  request: ChatRequest,
  options: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<ChatProposal> {
  const fetchImpl = options.fetchImpl ?? fetch
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)

  try {
    const response = await fetchImpl('/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(request),
      signal: controller.signal,
    })
    if (!response.ok) {
      throw new Error(`Chat request failed: ${response.status}`)
    }

    let value: unknown
    try {
      value = await response.json()
    } catch {
      throw new Error('Chat response is invalid')
    }
    return parseProposal(value)
  } catch (error) {
    if (timedOut) throw new Error('Chat request timed out')
    if (error instanceof Error && error.message.startsWith('Chat ')) throw error
    throw new Error('Chat request failed')
  } finally {
    clearTimeout(timer)
  }
}

function parseProposal(value: unknown): ChatProposal {
  if (!isRecord(value) || !hasOnlyKeys(value, proposalKeys)) throw new Error('Chat response is invalid')
  if (typeof value.message !== 'string' || !Array.isArray(value.warnings) || !value.warnings.every((warning) => typeof warning === 'string')) {
    throw new Error('Chat response is invalid')
  }
  const model = validateWaveJson(value.model)
  if (!model.ok) throw new Error('Chat response is invalid')
  return { message: value.message, model: model.model, warnings: value.warnings }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: Set<string>): boolean {
  return Reflect.ownKeys(value).every((key) => typeof key === 'string' && allowed.has(key))
}
