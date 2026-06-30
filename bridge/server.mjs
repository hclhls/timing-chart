// timing-chart bridge — a tiny dependency-free HTTP endpoint so external tools
// (e.g. Claude Code) can read/edit the chart that's open in the browser.
//
//   npm run build && npm run bridge      # serves the app + API on one origin
//   # then open  http://localhost:51123/timing-chart/  and toggle ブリッジ on
//
// API:
//   GET  /health        -> { ok, clients, rev }
//   GET  /model         -> current WaveJSON model (raw, for curl/jq)
//   POST /model         -> set model (body = WaveJSON; header X-Client-Id opt.)
//   GET  /events        -> SSE stream of { model, rev, source } on every change
//
// Security/robustness: binds to 127.0.0.1 only (not the LAN), CORS is limited to
// localhost + the GitHub Pages origin, bad/oversized input returns 4xx without
// crashing, and static paths are confined to dist/.

import http from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { join, extname, normalize, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../dist', import.meta.url))
const MAX_BODY = 5_000_000
const MAX_CLIENTS = 50 // cap SSE connections so a local actor can't exhaust FDs
const ALLOW_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/

/** The single shared model + a monotonic revision and the last editor's id. */
let model = { signal: [{ name: 'clk', wave: 'P....' }], config: { hscale: 1 } }
let rev = 0
let lastSource = ''
const clients = new Set()

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.map': 'application/json',
  '.woff2': 'font/woff2',
}

/** A browser Origin we trust (localhost dev, the Pages app) — or no Origin at
 *  all (curl / other non-browser tools, which can't be a CSRF vector). */
function isAllowedOrigin(origin) {
  return !origin || ALLOW_ORIGIN.test(origin) || origin === 'https://kakuteki.github.io'
}

/** Reject Host headers that aren't loopback — blocks DNS-rebinding, where a
 *  malicious page resolves its own hostname to 127.0.0.1 and POSTs here. */
function isAllowedHost(req) {
  const host = String(req.headers.host || '').split(':')[0].toLowerCase()
  return host === '' || host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]'
}

function cors(req, res) {
  const origin = req.headers.origin
  if (!origin) {
    res.setHeader('Access-Control-Allow-Origin', '*') // non-browser caller (curl)
  } else if (isAllowedOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Vary', 'Origin')
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Client-Id')
}

function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(obj))
}

/** Minimal shape check (mirrors the app parser) so a bad POST can't crash the tab. */
function isValidModel(m) {
  if (!m || typeof m !== 'object' || Array.isArray(m)) return false
  if (!Array.isArray(m.signal)) return false
  const validLane = (l) => {
    if (typeof l === 'string') return true // group label
    if (Array.isArray(l)) return l.every(validLane) // nested group
    if (typeof l === 'object' && l !== null) {
      // A signal whose wave/name isn't a string would crash expandWave in the
      // tab; reject it at the door (mirrors the app parser's expectations).
      if ('wave' in l && typeof l.wave !== 'string') return false
      if ('name' in l && typeof l.name !== 'string') return false
      return true
    }
    return false
  }
  return m.signal.every(validLane)
}

function frame() {
  return `data: ${JSON.stringify({ model, rev, source: lastSource })}\n\n`
}

function broadcast() {
  const f = frame()
  for (const res of clients) {
    try {
      res.write(f)
    } catch {
      clients.delete(res)
    }
  }
}

async function serveStatic(pathname, res) {
  // The built app uses base /timing-chart/; strip it so assets resolve here.
  // decodeURIComponent throws URIError on a malformed % sequence (e.g. /%C0);
  // catch it here — uncaught it would crash the whole bridge process.
  let decoded
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('bad request')
    return
  }
  let rel = decoded.replace(/^\/timing-chart/, '')
  if (rel === '' || rel === '/') rel = '/index.html'
  const file = normalize(join(ROOT, rel))
  // Must be ROOT itself or strictly inside it. A bare startsWith(ROOT) would
  // also let a sibling like `<ROOT>-secret\…` through (prefix match).
  if (file !== ROOT && !file.startsWith(ROOT + sep)) {
    res.writeHead(403)
    res.end('forbidden')
    return
  }
  try {
    const s = await stat(file)
    if (s.isDirectory()) throw new Error('dir')
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' })
    res.end(await readFile(file))
  } catch {
    try {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(await readFile(join(ROOT, 'index.html')))
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('dist/ がありません。先に `npm run build` を実行してください。')
    }
  }
}

function handler(req, res) {
  const { pathname } = new URL(req.url, 'http://localhost')
  cors(req, res)

  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  // Reject cross-origin browser callers and non-loopback Hosts. A simple POST
  // (text/plain, no preflight) would otherwise let any website overwrite the
  // chart while the bridge is on; curl (no Origin) is unaffected.
  if (!isAllowedOrigin(req.headers.origin) || !isAllowedHost(req)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('forbidden')
    return
  }

  if (pathname === '/health') {
    json(res, 200, { ok: true, clients: clients.size, rev })
    return
  }

  if (pathname === '/model' && req.method === 'GET') {
    json(res, 200, model)
    return
  }

  if (pathname === '/model' && req.method === 'POST') {
    let body = ''
    let aborted = false
    req.on('data', (c) => {
      if (aborted) return
      body += c
      if (body.length > MAX_BODY) {
        aborted = true
        json(res, 413, { ok: false, error: 'モデルが大きすぎます (上限 5MB)' })
        req.destroy()
      }
    })
    req.on('end', () => {
      if (aborted) return
      let parsed
      try {
        parsed = JSON.parse(body)
      } catch (e) {
        json(res, 400, { ok: false, error: 'JSON 解析エラー: ' + (e?.message ?? e) })
        return
      }
      if (!isValidModel(parsed)) {
        json(res, 400, { ok: false, error: '"signal" 配列を含む有効な WaveJSON が必要です' })
        return
      }
      model = parsed
      rev += 1
      lastSource = String(req.headers['x-client-id'] ?? '')
      broadcast()
      json(res, 200, { ok: true, rev })
    })
    return
  }

  if (pathname === '/events') {
    if (clients.size >= MAX_CLIENTS) {
      json(res, 503, { ok: false, error: 'too many SSE connections' })
      return
    }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    })
    res.write(frame()) // current state immediately
    clients.add(res)
    const ping = setInterval(() => {
      try {
        res.write(': ping\n\n')
      } catch {
        /* ignore */
      }
    }, 25000)
    req.on('close', () => {
      clearInterval(ping)
      clients.delete(res)
    })
    return
  }

  serveStatic(pathname, res)
}

/** Create (and optionally start) the bridge server. Exported for tests. */
export function createBridge() {
  return http.createServer(handler)
}

export function start(port = Number(process.env.BRIDGE_PORT ?? 51123)) {
  const server = createBridge()
  // Bound slow/oversized requests (slowloris) — a request must finish headers
  // and body within these windows or the socket is dropped.
  server.headersTimeout = 10_000
  server.requestTimeout = 30_000
  // 127.0.0.1 only — never expose the chart to the LAN.
  server.listen(port, '127.0.0.1', () => {
    console.log(`timing-chart bridge → http://localhost:${port}  (127.0.0.1 のみ)`)
    console.log(`  app:    http://localhost:${port}/timing-chart/   (after npm run build)`)
    console.log(`  GET/POST /model · GET /events · GET /health`)
  })
  return server
}

// Auto-start only when run directly (not when imported by tests).
if (process.argv[1] && fileURLToPath(import.meta.url) === normalize(process.argv[1])) {
  // Last-resort net (only for the standalone bridge, not under the test runner):
  // a stray unhandled error must not take the long-running helper down.
  process.on('uncaughtException', (e) => console.error('bridge uncaught:', e?.message ?? e))
  process.on('unhandledRejection', (e) => console.error('bridge rejection:', e?.message ?? e))
  start()
}
