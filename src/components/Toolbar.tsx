import { useEffect, useRef, useState } from 'react'
import { useEditor } from '../state/store'
import { maxTicks, flattenSignals } from '../state/selectors'
import { uniqueName } from '../state/actions'
import { clockWave, type ClockKind } from '../model/clockgen'
import { serializeModel } from '../model/serialize'
import { parseModel } from '../model/parse'
import { waveJsonToPwl } from '../model/pwl'
import { SKIN_NAMES, SKIN_BG, type SkinName } from '../render/skins'
import { getLatestSvg } from '../export/svgRegistry'
import { svgToString } from '../export/svg'
import { svgToPngBlob } from '../export/png'
import { downloadBlob, downloadText } from '../export/download'
import { buildShareUrl } from '../share/url'
import { bridgeConnect, bridgeDisconnect, DEFAULT_BRIDGE_URL, type BridgeStatus } from '../bridge/client'
import { LANGUAGES, useI18n, type Language } from '../i18n'

export function Toolbar() {
  const { language, setLanguage, t } = useI18n()
  const model = useEditor((s) => s.model)
  const applyGuiModel = useEditor((s) => s.applyGuiModel)
  const loadModel = useEditor((s) => s.loadModel)
  const skinName = useEditor((s) => s.skinName)
  const setSkin = useEditor((s) => s.setSkin)
  const notice = useEditor((s) => s.notice)
  const clearNotice = useEditor((s) => s.clearNotice)
  const undo = useEditor((s) => s.undo)
  const redo = useEditor((s) => s.redo)
  const canUndo = useEditor((s) => s.past.length > 0)
  const canRedo = useEditor((s) => s.future.length > 0)
  const viewingShared = useEditor((s) => s.viewingShared)

  const fileRef = useRef<HTMLInputElement>(null)
  const toastTimer = useRef<number | undefined>(undefined)
  const [clockKind, setClockKind] = useState<ClockKind>('P')
  const [pngScale, setPngScale] = useState(2)
  const [pngTransparent, setPngTransparent] = useState(false)
  const [pwlStep, setPwlStep] = useState(1)
  const [pwlLow, setPwlLow] = useState(0)
  const [pwlHigh, setPwlHigh] = useState(1)
  const [pwlSourceStart, setPwlSourceStart] = useState(100)
  const [pwlTimeSuffix, setPwlTimeSuffix] = useState('')
  const [toast, setToast] = useState<string | null>(null)
  const [bridgeOn, setBridgeOn] = useState(false)
  const [bridgeStatus, setBridgeStatus] = useState<BridgeStatus>('disconnected')

  const flash = (msg: string) => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current)
    setToast(msg)
    toastTimer.current = window.setTimeout(() => setToast(null), 2500)
  }

  // Surface a one-shot startup notice (e.g. broken share link) once.
  useEffect(() => {
    if (notice) {
      flash(notice)
      clearNotice()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Close the bridge connection if the toolbar ever unmounts.
  useEffect(() => () => bridgeDisconnect(), [])

  const addClock = () => {
    const ticks = maxTicks(model)
    const wave = clockWave(clockKind, ticks)
    const name = uniqueName(model, 'clk')
    applyGuiModel({ ...model, signal: [...model.signal, { name, wave }] })
  }

  // Name exports after the first signal + a timestamp so writing several charts
  // doesn't collide on one fixed name (browser "(1)" suffixes / overwrites).
  const fileName = (ext: string) => {
    const first = flattenSignals(model).find((r) => r.kind === 'signal')?.signal?.name?.trim()
    const base = (first && first.length ? first : 'timing-chart')
      .replace(/[\\/:*?"<>|]+/g, '-')
      .slice(0, 40)
    const d = new Date()
    const p = (n: number) => String(n).padStart(2, '0')
    const ts = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`
    return `${base}-${ts}.${ext}`
  }

  const exportSvg = () => {
    const svg = getLatestSvg()
    if (!svg) return flash(t('toolbar.noSvg'))
    // Pass the skin background so a dark-skin SVG isn't transparent-on-white.
    downloadText(svgToString(svg, SKIN_BG[skinName]), fileName('svg'), 'image/svg+xml')
  }

  const exportPng = async () => {
    const svg = getLatestSvg()
    if (!svg) return flash(t('toolbar.noSvg'))
    try {
      const { blob, effectiveScale } = await svgToPngBlob(svg, pngScale, SKIN_BG[skinName], pngTransparent)
      downloadBlob(blob, fileName('png'))
      // The chart was too big for the requested scale — say so instead of
      // handing back a silently lower-resolution image.
      if (effectiveScale < pngScale - 0.01) {
        flash(t('toolbar.pngScaled', { scale: effectiveScale.toFixed(1) }))
      }
    } catch (e) {
      flash(e instanceof Error ? e.message : t('toolbar.pngFailed'))
    }
  }

  const copyImage = async () => {
    const svg = getLatestSvg()
    if (!svg) return flash(t('toolbar.noSvg'))
    // Image clipboard needs the async Clipboard API + ClipboardItem (absent on
    // some browsers / non-secure contexts) — degrade to a hint, never throw.
    if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) {
      return flash(t('toolbar.copyUnsupported'))
    }
    try {
      const { blob } = await svgToPngBlob(svg, pngScale, SKIN_BG[skinName], pngTransparent)
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
      flash(t('toolbar.copySuccess'))
    } catch {
      flash(t('toolbar.copyFailed'))
    }
  }

  const exportJson = () => {
    downloadText(serializeModel(model), fileName('wavejson'), 'application/json')
  }

  const exportPwl = () => {
    downloadText(
      waveJsonToPwl(model, {
        step: pwlStep,
        low: pwlLow,
        high: pwlHigh,
        sourceStart: pwlSourceStart,
        timeSuffix: pwlTimeSuffix,
      }),
      fileName('cir'),
      'text/plain',
    )
  }

  const onLoadFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    file.text().then((text) => {
      const res = parseModel(text)
      if (res.ok && res.model) {
        loadModel(res.model)
        flash(t('toolbar.fileLoaded'))
      } else {
        flash(t('toolbar.fileLoadFailed', { error: res.error ?? '' }))
      }
    })
    e.target.value = ''
  }

  const share = async () => {
    const url = buildShareUrl(model)
    history.replaceState(null, '', url)
    let copied = false
    try {
      await navigator.clipboard.writeText(url)
      copied = true
    } catch {
      copied = false
    }
    // Build one message so a length warning doesn't overwrite the success line.
    const base = copied ? t('toolbar.shareCopied') : t('toolbar.shareUpdated')
    let suffix = ''
    if (url.length > 8000) suffix = t('toolbar.shareTooLong')
    else if (url.length > 2000) suffix = t('toolbar.shareLong')
    flash(base + suffix)
  }

  const toggleBridge = () => {
    if (bridgeOn) {
      bridgeDisconnect()
      setBridgeOn(false)
      setBridgeStatus('disconnected')
      flash(t('toolbar.bridgeDisconnected'))
    } else {
      bridgeConnect(DEFAULT_BRIDGE_URL, setBridgeStatus)
      setBridgeOn(true)
      flash(t('toolbar.bridgeConnecting', { url: DEFAULT_BRIDGE_URL }))
    }
  }

  return (
    <header className="toolbar">
      <span className="app-title">{t('app.title')}</span>

      <div className="tb-group">
        <button onClick={undo} disabled={!canUndo} title={t('toolbar.undoTitle')} aria-label={t('toolbar.undo')}>
          {t('toolbar.undo')}
        </button>
        <button onClick={redo} disabled={!canRedo} title={t('toolbar.redoTitle')} aria-label={t('toolbar.redo')}>
          {t('toolbar.redo')}
        </button>
      </div>

      <div className="tb-group">
        <button onClick={addClock} title={t('toolbar.addClockTitle')}>
          {t('toolbar.addClock')}
        </button>
        <select
          value={clockKind}
          onChange={(e) => setClockKind(e.target.value as ClockKind)}
          title={t('toolbar.clockKindTitle')}
        >
          <option value="P">{t('toolbar.clockP')}</option>
          <option value="N">{t('toolbar.clockN')}</option>
          <option value="p">{t('toolbar.clockp')}</option>
          <option value="n">{t('toolbar.clockn')}</option>
        </select>
      </div>

      <div className="tb-group">
        <button onClick={exportPng}>{t('toolbar.savePng')}</button>
        <select value={pngScale} onChange={(e) => setPngScale(Number(e.target.value))} title={t('toolbar.pngScaleTitle')}>
          <option value={1}>1×</option>
          <option value={2}>2×</option>
          <option value={4}>4×</option>
        </select>
        <button onClick={copyImage} title={t('toolbar.copyImageTitle')}>
          {t('toolbar.copyImage')}
        </button>
        <label className="png-opt" title={t('toolbar.transparentTitle')}>
          <input
            type="checkbox"
            checked={pngTransparent}
            onChange={(e) => setPngTransparent(e.target.checked)}
          />
          {t('toolbar.transparent')}
        </label>
        <button onClick={share}>{t('toolbar.share')}</button>
      </div>

      <details className="adv-menu">
        <summary title={t('toolbar.moreTitle')}>{t('toolbar.more')}</summary>
        <div className="adv-pop">
          <button onClick={exportJson} title={t('toolbar.saveFileTitle')}>
            {t('toolbar.saveFile')}
          </button>
          <button onClick={() => fileRef.current?.click()} title={t('toolbar.openFileTitle')}>
            {t('toolbar.openFile')}
          </button>
          <button onClick={exportSvg} title={t('toolbar.saveSvgTitle')}>
            {t('toolbar.saveSvg')}
          </button>
          <button onClick={exportPwl} title={t('toolbar.savePwlTitle')}>
            {t('toolbar.savePwl')}
          </button>
          <label className="adv-row" title={t('toolbar.pwlStepTitle')}>
            PWL step
            <input
              type="number"
              min={0.001}
              step={0.1}
              value={pwlStep}
              onChange={(e) => setPwlStep(Number(e.target.value) || 1)}
            />
          </label>
          <label className="adv-row" title={t('toolbar.pwlLowTitle')}>
            PWL low
            <input
              type="number"
              step={0.1}
              value={pwlLow}
              onChange={(e) => setPwlLow(Number(e.target.value))}
            />
          </label>
          <label className="adv-row" title={t('toolbar.pwlHighTitle')}>
            PWL high
            <input
              type="number"
              step={0.1}
              value={pwlHigh}
              onChange={(e) => setPwlHigh(Number(e.target.value) || 1)}
            />
          </label>
          <label className="adv-row" title={t('toolbar.pwlSourceTitle')}>
            PWL V#
            <input
              type="number"
              min={1}
              step={1}
              value={pwlSourceStart}
              onChange={(e) => setPwlSourceStart(Math.max(1, Math.trunc(Number(e.target.value) || 100)))}
            />
          </label>
          <label className="adv-row" title={t('toolbar.pwlTimeTitle')}>
            PWL time
            <select value={pwlTimeSuffix} onChange={(e) => setPwlTimeSuffix(e.target.value)}>
              <option value="">{t('toolbar.noUnit')}</option>
              <option value="n">ns (n)</option>
              <option value="u">us (u)</option>
              <option value="m">ms (m)</option>
            </select>
          </label>
          <label className="adv-row">
            {t('toolbar.skin')}
            <select value={skinName} onChange={(e) => setSkin(e.target.value as SkinName)}>
              {SKIN_NAMES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label className="adv-row" title={t('toolbar.hscaleTitle')}>
            {t('toolbar.hscale')}
            <select
              value={model.config?.hscale ?? 1}
              onChange={(e) =>
                applyGuiModel({
                  ...model,
                  config: { ...model.config, hscale: Number(e.target.value) },
                })
              }
            >
              <option value={1}>{t('toolbar.hscale1')}</option>
              <option value={2}>{t('toolbar.hscale2')}</option>
              <option value={3}>{t('toolbar.hscale3')}</option>
            </select>
          </label>

          <label className="adv-row" title={t('toolbar.langTitle')}>
            {t('toolbar.lang')}
            <select value={language} onChange={(e) => setLanguage(e.target.value as Language)}>
              {LANGUAGES.map((lang) => (
                <option key={lang} value={lang}>
                  {lang === 'ja' ? t('toolbar.langJa') : lang === 'en' ? t('toolbar.langEn') : t('toolbar.langZh')}
                </option>
              ))}
            </select>
          </label>
          <button
            onClick={toggleBridge}
            title={t('toolbar.bridgeTitle', { url: DEFAULT_BRIDGE_URL })}
            className={bridgeOn ? 'bridge-btn on' : 'bridge-btn'}
          >
            <span className={`bridge-dot ${bridgeStatus}`} />
            {bridgeOn ? t('toolbar.bridgeDisconnect') : t('toolbar.bridgeConnect')} {t('toolbar.bridgeDev')}
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".json,.wavejson,application/json"
          hidden
          onChange={onLoadFile}
        />
      </details>

      <span
        className={viewingShared ? 'save-status shared' : 'save-status'}
        title={
          viewingShared
            ? t('toolbar.sharedStatusTitle')
            : t('toolbar.savedStatusTitle')
        }
      >
        {viewingShared ? t('toolbar.sharedStatus') : t('toolbar.savedStatus')}
      </span>

      <span className="toast-region" role="status" aria-live="polite">
        {toast && <span className="toast">{toast}</span>}
      </span>
    </header>
  )
}
