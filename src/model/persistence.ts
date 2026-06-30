// Versioned envelope for PERSISTED / SHARED payloads (localStorage + share URL).
// The model itself stays bare WaveJSON everywhere the user sees it (code tab,
// .wavejson export); only the storage/share layer wraps it as { v, model } so a
// future incompatible model-shape change has a version to branch a migration on.
// Reading is backward-compatible: a legacy bare model (pre-versioning) still loads.
import { parseModel } from './parse'
import type { WaveJson } from './wavejson'

export const SCHEMA_VERSION = 1

/** Serialize a model into a versioned envelope (compact JSON for short URLs). */
export function serializeEnvelope(model: WaveJson): string {
  return JSON.stringify({ v: SCHEMA_VERSION, model })
}

/**
 * Return the inner model candidate from a parsed payload: unwrap a versioned
 * `{ v, model }` envelope, otherwise pass the value through (a legacy bare
 * model). Pure + tiny so the version-detection logic is unit-testable. A bare
 * WaveJSON has neither `v` nor `model`, so it can't be mistaken for an envelope.
 */
export function unwrapEnvelope(parsed: unknown): unknown {
  if (
    parsed &&
    typeof parsed === 'object' &&
    !Array.isArray(parsed) &&
    'v' in parsed &&
    'model' in parsed
  ) {
    return (parsed as { model: unknown }).model
  }
  return parsed
}

/**
 * Parse a persisted/shared JSON string into a validated model, accepting both
 * the versioned envelope and a legacy bare model. Returns null if neither.
 */
export function parseEnvelope(text: string): WaveJson | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    // Not strict JSON — fall back to the lenient model parser (handles a legacy
    // bare model that may have been written/edited loosely).
    const r = parseModel(text)
    return r.ok && r.model ? r.model : null
  }
  const candidate = unwrapEnvelope(parsed)
  // Reuse the model validator (signal array + lane field types) on the candidate.
  const r = parseModel(JSON.stringify(candidate))
  return r.ok && r.model ? r.model : null
}
