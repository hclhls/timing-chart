// Bridge client: keeps the in-browser model in sync with the local bridge
// server (bridge/server.mjs) over SSE + POST, so an external tool like Claude
// Code can drive the chart and pick up the user's edits.

import { useEditor } from '../state/store'

export const DEFAULT_BRIDGE_URL = 'http://localhost:51123'

export type BridgeStatus = 'connecting' | 'connected' | 'error' | 'disconnected'

let es: EventSource | null = null
let unsub: (() => void) | null = null
let pushTimer: number | undefined
// Guards against an echo loop: incoming SSE must not re-POST, and our own POST
// coming back over SSE must not be re-applied.
let suppressPush = false
let lastSent = ''

/** Connect to the bridge and start bidirectional sync. Idempotent. */
export function bridgeConnect(url: string, onStatus?: (s: BridgeStatus) => void): void {
  bridgeDisconnect()
  onStatus?.('connecting')

  es = new EventSource(`${url}/events`)
  es.onopen = () => onStatus?.('connected')
  es.onerror = () => onStatus?.('error')
  es.onmessage = (ev) => {
    let model
    try {
      model = JSON.parse(ev.data)
    } catch {
      return
    }
    const text = JSON.stringify(model)
    if (text === lastSent) return // echo of our own push — ignore
    // Apply remotely-driven model without re-pushing it back.
    suppressPush = true
    try {
      useEditor.getState().loadModel(model)
    } finally {
      suppressPush = false
    }
  }

  // Push local model edits to the bridge (debounced).
  let last = useEditor.getState().model
  unsub = useEditor.subscribe((s) => {
    if (s.model === last) return
    last = s.model
    if (suppressPush) return
    if (pushTimer) window.clearTimeout(pushTimer)
    pushTimer = window.setTimeout(() => {
      const body = JSON.stringify(s.model)
      lastSent = body
      fetch(`${url}/model`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      }).catch(() => onStatus?.('error'))
    }, 300)
  })
}

/** Stop syncing and close the connection. */
export function bridgeDisconnect(): void {
  if (pushTimer) window.clearTimeout(pushTimer)
  es?.close()
  es = null
  unsub?.()
  unsub = null
}
