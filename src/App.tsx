import { useEffect, useState } from 'react'
import { useEditor } from './state/store'
import { flattenSignals } from './state/selectors'
import { busHeadTicks } from './model/wave-codec'
import { Toolbar } from './components/Toolbar'
import { SignalTable } from './components/gui/SignalTable'
import { BusDataPanel } from './components/gui/BusDataPanel'
import { EdgeEditor } from './components/annotations/EdgeEditor'
import { WaveJsonEditor } from './components/text/WaveJsonEditor'
import { PreviewPane } from './components/preview/PreviewPane'
import { HelpModal } from './components/HelpModal'

const HELP_SEEN_KEY = 'timing-chart:seen-help'
const BLANK = {
  signal: [
    { name: 'clk', wave: 'P....' },
    { name: 'data', wave: '0....' },
  ],
  config: { hscale: 1 },
}

type Tab = 'gui' | 'text' | 'preview'
const TABS: { id: Tab; label: string }[] = [
  { id: 'gui', label: '編集' },
  { id: 'text', label: 'WaveJSON' },
  { id: 'preview', label: 'プレビュー' },
]

export default function App() {
  const [tab, setTab] = useState<Tab>('gui')
  const selectedPath = useEditor((s) => s.selectedPath)
  const model = useEditor((s) => s.model)
  const loadModel = useEditor((s) => s.loadModel)

  // Show the welcome/help on first visit; reopenable via the ? button.
  const [helpOpen, setHelpOpen] = useState(() => {
    try {
      return !localStorage.getItem(HELP_SEEN_KEY)
    } catch {
      return true
    }
  })
  const closeHelp = () => {
    setHelpOpen(false)
    try {
      localStorage.setItem(HELP_SEEN_KEY, '1')
    } catch {
      /* ignore */
    }
  }

  // Selected signal's bus segments / name + edge count → drive panel discovery.
  const selSig = selectedPath
    ? flattenSignals(model).find(
        (r) =>
          r.kind === 'signal' &&
          r.path.length === selectedPath.length &&
          r.path.every((v, i) => v === selectedPath[i]),
      )?.signal
    : undefined
  const busCount = selSig?.wave ? busHeadTicks(selSig.wave).length : 0
  const edgeCount = model.edge?.length ?? 0

  const [busOpen, setBusOpen] = useState(false)
  // Auto-reveal the bus panel whenever the selected signal HAS bus values —
  // including when bus values are painted onto the already-selected row
  // (so depend on busCount, not just selectedPath).
  useEffect(() => {
    if (busCount > 0) setBusOpen(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPath, busCount])

  // Keep the tab state consistent across the responsive breakpoint: the preview
  // tab only exists on mobile, so normalize it away on desktop to avoid a
  // "no tab selected" dead state after a resize.
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 861px)')
    const fix = () => {
      if (mq.matches) setTab((t) => (t === 'preview' ? 'gui' : t))
    }
    fix()
    mq.addEventListener('change', fix)
    return () => mq.removeEventListener('change', fix)
  }, [])

  // Global undo/redo shortcuts. Skip when a text field is focused so the
  // browser's native field-level undo keeps working inside the editors.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
      if (e.isComposing) return
      if (!(e.ctrlKey || e.metaKey)) return
      const k = e.key.toLowerCase()
      const st = useEditor.getState()
      if (k === 'z' && !e.shiftKey) {
        if (st.past.length === 0) return
        e.preventDefault()
        st.undo()
      } else if (k === 'y' || (k === 'z' && e.shiftKey)) {
        if (st.future.length === 0) return
        e.preventDefault()
        st.redo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const onTabKey = (e: React.KeyboardEvent) => {
    const order = TABS.map((t) => t.id)
    const i = order.indexOf(tab)
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault()
      setTab(order[(i + 1) % order.length])
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault()
      setTab(order[(i - 1 + order.length) % order.length])
    } else if (e.key === 'Home') {
      e.preventDefault()
      setTab(order[0])
    } else if (e.key === 'End') {
      e.preventDefault()
      setTab(order[order.length - 1])
    }
  }

  return (
    <div className="app">
      {helpOpen && (
        <HelpModal
          onClose={closeHelp}
          onStartBlank={() => {
            loadModel(BLANK)
            closeHelp()
          }}
        />
      )}
      <Toolbar />

      <nav className="tabbar" role="tablist" aria-label="表示切替">
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            role="tab"
            id={`tab-${id}`}
            aria-controls={`pane-${id}`}
            aria-selected={tab === id}
            tabIndex={tab === id ? 0 : -1}
            className={id === 'preview' ? 'preview-tab' : undefined}
            onKeyDown={onTabKey}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
        <button className="help-btn" onClick={() => setHelpOpen(true)} title="はじめに / ヘルプ">
          ？ ヘルプ
        </button>
      </nav>

      <main className="workspace" data-tab={tab}>
        <div className="pane pane-editor" role="tabpanel" id="pane-gui" aria-labelledby="tab-gui">
          <SignalTable />
          <details className="panel" open={busOpen} onToggle={(e) => setBusOpen(e.currentTarget.open)}>
            <summary>
              バス値{busCount > 0 && selSig ? `: ${selSig.name || '(無名)'} #${busCount}` : ''}
            </summary>
            <BusDataPanel />
          </details>
          <details className="panel">
            <summary>注釈（セットアップ / ホールド）{edgeCount > 0 ? ` (${edgeCount})` : ''}</summary>
            <EdgeEditor />
          </details>
        </div>
        <div className="pane pane-text" role="tabpanel" id="pane-text" aria-labelledby="tab-text">
          <WaveJsonEditor />
        </div>
        <div
          className="pane pane-preview"
          role="tabpanel"
          id="pane-preview"
          aria-labelledby="tab-preview"
        >
          <PreviewPane />
        </div>
      </main>
    </div>
  )
}
