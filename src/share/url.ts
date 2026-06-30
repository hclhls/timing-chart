import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string'
import type { WaveJson } from '../model/wavejson'
import { serializeEnvelope, parseEnvelope } from '../model/persistence'

const HASH_KEY = 'd'

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
  try {
    const json = decompressFromEncodedURIComponent(payload)
    if (!json) return { present: true, model: null }
    // Accepts the versioned envelope and a legacy bare-model share link.
    return { present: true, model: parseEnvelope(json) }
  } catch {
    return { present: true, model: null }
  }
}
