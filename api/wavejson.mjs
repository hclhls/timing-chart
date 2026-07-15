const rootKeys = new Set(['signal', 'edge', 'config', 'head', 'foot'])
const signalKeys = new Set(['name', 'wave', 'data', 'node', 'period', 'phase'])
const configKeys = new Set(['hscale', 'skin'])
const labelKeys = new Set(['text', 'tick', 'tock', 'every'])

export function validateWaveJson(value) {
  if (!isRecord(value)) return invalid('root must be an object')
  if (!hasOnlyKeys(value, rootKeys)) return invalid('root contains unsupported fields')
  if (!hasOwn(value, 'signal') || !Array.isArray(value.signal)) return invalid('signal must be an array')
  if (!value.signal.every(isValidLane)) return invalid('signal contains an invalid lane')
  if (hasOwn(value, 'edge') && (!Array.isArray(value.edge) || !value.edge.every((edge) => typeof edge === 'string'))) {
    return invalid('edge must be an array of strings')
  }
  if (hasOwn(value, 'config') && !isValidConfig(value.config)) return invalid('config has an invalid shape')
  if (hasOwn(value, 'head') && !isValidLabel(value.head)) return invalid('head has an invalid shape')
  if (hasOwn(value, 'foot') && !isValidLabel(value.foot)) return invalid('foot has an invalid shape')
  return { ok: true, model: value }
}

function isValidLane(value) {
  if (typeof value === 'string') return true
  if (Array.isArray(value)) return value.length > 0 && value.every(isValidLane)
  if (!isRecord(value) || !hasOnlyKeys(value, signalKeys)) return false
  if (hasOwn(value, 'name') && typeof value.name !== 'string') return false
  if (hasOwn(value, 'wave') && typeof value.wave !== 'string') return false
  if (hasOwn(value, 'data') && !(typeof value.data === 'string' || (Array.isArray(value.data) && value.data.every((entry) => typeof entry === 'string')))) return false
  if (hasOwn(value, 'node') && typeof value.node !== 'string') return false
  if (hasOwn(value, 'period') && !isFiniteNumber(value.period)) return false
  if (hasOwn(value, 'phase') && !isFiniteNumber(value.phase)) return false
  return true
}

function isValidConfig(value) {
  if (!isRecord(value) || !hasOnlyKeys(value, configKeys)) return false
  return (!hasOwn(value, 'hscale') || isFiniteNumber(value.hscale)) && (!hasOwn(value, 'skin') || typeof value.skin === 'string')
}

function isValidLabel(value) {
  if (!isRecord(value) || !hasOnlyKeys(value, labelKeys)) return false
  if (hasOwn(value, 'text') && typeof value.text !== 'string') return false
  return ['tick', 'tock', 'every'].every((key) => !hasOwn(value, key) || isFiniteNumber(value[key]))
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

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

function invalid(error) {
  return { ok: false, error }
}
