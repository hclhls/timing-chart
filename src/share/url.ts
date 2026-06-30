import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string'
import type { WaveJson } from '../model/wavejson'
import { serializeEnvelope, parseEnvelope } from '../model/persistence'

const HASH_KEY = 'd'
// Reject absurdly large share payloads before/after decompression so a crafted
// link can't blow up memory / hang the tab (decompression-bomb DoS). A real
// chart compresses to well under these.
const MAX_PAYLOAD = 1_000_000
const MAX_JSON = 2_000_000
// Even within the size cap, a link could pack thousands of signals to freeze the
// renderer. Reject absurd counts (a real chart is well under this).
const MAX_SIGNALS = 2000

/** Count signal objects in a lane tree (groups nest), short-circuiting at the cap. */
function countSignals(lanes: unknown[], acc = { n: 0 }): number {
  for (const l of lanes) {
    if (Array.isArray(l)) countSignals(l, acc)
    else if (l && typeof l === 'object') acc.n++
    if (acc.n > MAX_SIGNALS) break
  }
  return acc.n
}

/** Encode a model into a compressed share string for the URL hash. */
export function encodeShare(model: WaveJson): string {
  return compressToEncodedURIComponent(serializeEnvelope(model))
}

/** Build a full shareable URL (current origin+path, model in the hash). */
export function buildShareUrl(model: WaveJson): string {
  const base = window.location.origin + window.location.pathname
  return `${base}#${HASH_KEY}=${encodeShare(model)}`
}

/** Extract the raw `d=` payload from the location hash, or null. */
function rawPayload(): string | null {
  // Parse manually rather than via URLSearchParams: the lz-string alphabet
  // contains '+', which URLSearchParams would turn into a space.
  const hash = window.location.hash.replace(/^#/, '')
  if (!hash) return null
  for (const part of hash.split('&')) {
    if (part.startsWith(HASH_KEY + '=')) return part.slice(HASH_KEY.length + 1)
  }
  return null
}

export interface ShareRead {
  /** True if a `d=` payload was present in the hash at all. */
  present: boolean
  /** The decoded model, or null if absent / malformed. */
  model: WaveJson | null
}

/** Read a model from the location hash, distinguishing absent from broken. */
export function readShare(): ShareRead {
  const payload = rawPayload()
  if (!payload) return { present: false, model: null }
  if (payload.length > MAX_PAYLOAD) return { present: true, model: null } // oversized link
  try {
    const json = decompressFromEncodedURIComponent(payload)
    if (!json || json.length > MAX_JSON) return { present: true, model: null }
    // Accepts the versioned envelope and a legacy bare-model share link.
    const model = parseEnvelope(json)
    if (model && countSignals(model.signal) > MAX_SIGNALS) return { present: true, model: null }
    return { present: true, model }
  } catch {
    return { present: true, model: null }
  }
}
