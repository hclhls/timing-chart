// timing-chart bridge — a tiny dependency-free HTTP endpoint so external tools
// (e.g. Claude Code) can read/edit the chart that's open in the browser.
//
//   npm run build && npm run bridge      # serves the app + API on one origin
//   # then open  http://localhost:51123/timing-chart/  and toggle ブリッジ on
//
// API (CORS enabled, so the dev server / GitHub Pages site can connect too):
//   GET  /health        -> { ok, clients }
//   GET  /model         -> current WaveJSON model
//   POST /model         -> set model (body = WaveJSON); broadcast to clients
//   GET  /events        -> SSE stream pushing the model on every change
//
// Loose-coupling by design: bad input returns 4xx but never crashes the server,
// and a missing dist/ just means the static routes 404 (the API still works).

import http from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { join, extname, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

const PORT = Number(process.env.BRIDGE_PORT ?? 51123)
const ROOT = fileURLToPath(new URL('../dist', import.meta.url))

/** The single shared model. Starts with a tiny placeholder. */
let model = { signal: [{ name: 'clk', wave: 'P....' }], config: { hscale: 1 } }
/** Connected SSE responses. */
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

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
}

function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(obj))
}

/** Validate the minimum shape, mirroring the app's parser, so a bad POST can't
 * crash the open browser tab. */
function isValidModel(m) {
  if (!m || typeof m !== 'object' || Array.isArray(m)) return false
  if (!Array.isArray(m.signal)) return false
  const validLane = (l) =>
    typeof l === 'string' ||
    (Array.isArray(l) && l.every(validLane)) ||
    (typeof l === 'object' && l !== null)
  return m.signal.every(validLane)
}

function broadcast() {
  const frame = `data: ${JSON.stringify(model)}\n\n`
  for (const res of clients) {
    try {
      res.write(frame)
    } catch {
      clients.delete(res)
    }
  }
}

async function serveStatic(pathname, res) {
  // The built app uses base /timing-chart/; strip it so assets resolve here.
  let rel = decodeURIComponent(pathname).replace(/^\/timing-chart/, '')
  if (rel === '' || rel === '/') rel = '/index.html'
  const file = normalize(join(ROOT, rel))
  if (!file.startsWith(ROOT)) {
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
    // SPA fallback (or a helpful message when not built yet).
    try {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(await readFile(join(ROOT, 'index.html')))
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('dist/ がありません。先に `npm run build` を実行してください。')
    }
  }
}

const server = http.createServer((req, res) => {
  const { pathname } = new URL(req.url, `http://localhost:${PORT}`)
  cors(res)

  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  if (pathname === '/health') {
    json(res, 200, { ok: true, clients: clients.size })
    return
  }

  if (pathname === '/model' && req.method === 'GET') {
    json(res, 200, model)
    return
  }

  if (pathname === '/model' && req.method === 'POST') {
    let body = ''
    req.on('data', (c) => {
      body += c
      if (body.length > 5_000_000) req.destroy() // 5MB guard
    })
    req.on('end', () => {
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
      broadcast()
      json(res, 200, { ok: true })
    })
    return
  }

  if (pathname === '/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    })
    res.write(`data: ${JSON.stringify(model)}\n\n`) // send current state immediately
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
})

server.listen(PORT, () => {
  console.log(`timing-chart bridge → http://localhost:${PORT}`)
  console.log(`  app:    http://localhost:${PORT}/timing-chart/   (after npm run build)`)
  console.log(`  GET/POST /model · GET /events · GET /health`)
})
