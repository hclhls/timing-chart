import { useEffect, useState } from 'react'
import { useEditor } from './state/store'
import { flattenSignals } from './state/selectors'
import { serializeModel } from './model/serialize'
import { readShare } from './share/url'
import { busHeadTicks } from './model/wave-codec'
import { Toolbar } from './components/Toolbar'
import { SignalTable } from './components/gui/SignalTable'
import { BusDataPanel } from './components/gui/BusDataPanel'
import { DiagramLabelsPanel } from './components/gui/DiagramLabelsPanel'
import { SignalTimingPanel } from './components/gui/SignalTimingPanel'
import { EdgeEditor } from './components/annotations/EdgeEditor'
import { WaveJsonEditor } from './components/text/WaveJsonEditor'
import { PreviewPane } from './components/preview/PreviewPane'
import { HelpModal } from './components/HelpModal'
import { useI18n } from './i18n'

const HELP_SEEN_KEY = 'timing-chart:seen-help'
// A truly blank document → the empty-state guide walks the user from zero.
const BLANK = { signal: [], config: { hscale: 1 } }

type Tab = 'gui' | 'text' | 'preview'
export default function App() {
  const { t } = useI18n()
  const [tab, setTab] = useState<Tab>('gui')
  const tabs: { id: Tab; label: string }[] = [
    { id: 'gui', label: t('app.tabGui') },
    { id: 'text', label: t('app.tabText') },
    { id: 'preview', label: t('app.tabPreview') },
  ]
  const selectedPath = useEditor((s) => s.selectedPath)
  const model = useEditor((s) => s.model)
  const loadModel = useEditor((s) => s.loadModel)

  // Show the welcome/help on first visit; reopenable via the ? button. Don't
  // cover a shared-link view with it (the visitor came to see that chart).
  const [helpOpen, setHelpOpen] = useState(() => {
    try {
      if (useEditor.getState().viewingShared) return false
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

  // Load a share link that arrives via a live URL hashchange (pasting a #d= URL
  // into this tab, or browser back/forward between share states). replaceState
  // from our own share()/detach doesn't fire hashchange, so this won't loop.
  useEffect(() => {
    const onHash = () => {
      const share = readShare()
      if (!share.present || !share.model) return
      const st = useEditor.getState()
      if (serializeModel(st.model) === serializeModel(share.model)) return // no change
      st.loadSharedFromHash(share.model)
      st.flash(t('app.toastShareLoaded'))
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [t])

  // While the help dialog is open, make the rest of the app inert so screen
  // readers and Tab/clicks can't reach the background behind the modal.
  useEffect(() => {
    const regions = ['.toolbar', '.tabbar', '.workspace']
    for (const sel of regions) {
      document.querySelector(sel)?.toggleAttribute('inert', helpOpen)
    }
    return () => {
      for (const sel of regions) document.querySelector(sel)?.removeAttribute('inert')
    }
  }, [helpOpen])

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
  // Reflect the bus panel to the selected signal: open when it has bus values
  // (incl. when painted onto the current row), close when it has none.
  useEffect(() => {
    setBusOpen(busCount > 0)
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
    const order = tabs.map((t) => t.id)
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

  const toast = useEditor((s) => s.toast)

  return (
    <div className="app">
      <span className="app-toast-region" role="status" aria-live="polite">
        {toast && <span className="app-toast">{toast}</span>}
      </span>
      {helpOpen && (
        <HelpModal
          onClose={closeHelp}
          onStartBlank={() => {
            loadModel(BLANK)
            closeHelp()
          }}
          onLoadExample={(m) => {
            loadModel(m)
            closeHelp()
          }}
        />
      )}
      <Toolbar />

      <nav className="tabbar" role="tablist" aria-label={t('app.tabAria')}>
        {tabs.map(({ id, label }) => (
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
        <button className="help-btn" onClick={() => setHelpOpen(true)} title={t('app.helpTitle')}>
          {t('app.help')}
        </button>
      </nav>

      <main className="workspace" data-tab={tab}>
        <div className="pane pane-editor" role="tabpanel" id="pane-gui" aria-labelledby="tab-gui">
          <SignalTable />
          <details className="panel" open={busOpen} onToggle={(e) => setBusOpen(e.currentTarget.open)}>
            <summary>
              {t('app.busSummary')}{busCount > 0 && selSig ? `: ${selSig.name || t('app.unnamed')} #${busCount}` : ''}
            </summary>
            <BusDataPanel />
          </details>
          <details className="panel">
            <summary>{t('app.labelsSummary')}</summary>
            <DiagramLabelsPanel />
          </details>
          <details className="panel">
            <summary>{t('app.timingSummary')}</summary>
            <SignalTimingPanel />
          </details>
          <details className="panel">
            <summary>
              {t('app.edgesSummary')}{edgeCount > 0 ? ` (${edgeCount})` : ''}
            </summary>
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
