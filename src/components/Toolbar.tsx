import { useEffect, useRef, useState } from 'react'
import { useEditor } from '../state/store'
import { maxTicks } from '../state/selectors'
import { uniqueName } from '../state/actions'
import { clockWave, type ClockKind } from '../model/clockgen'
import { serializeModel } from '../model/serialize'
import { parseModel } from '../model/parse'
import { SKIN_NAMES, SKIN_BG, type SkinName } from '../render/skins'
import { getLatestSvg } from '../export/svgRegistry'
import { svgToString } from '../export/svg'
import { svgToPngBlob } from '../export/png'
import { downloadBlob, downloadText } from '../export/download'
import { buildShareUrl } from '../share/url'
import { bridgeConnect, bridgeDisconnect, DEFAULT_BRIDGE_URL, type BridgeStatus } from '../bridge/client'

export function Toolbar() {
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

  const exportSvg = () => {
    const svg = getLatestSvg()
    if (!svg) return flash('描画SVGが見つかりません')
    // Pass the skin background so a dark-skin SVG isn't transparent-on-white.
    downloadText(svgToString(svg, SKIN_BG[skinName]), 'timing-chart.svg', 'image/svg+xml')
  }

  const exportPng = async () => {
    const svg = getLatestSvg()
    if (!svg) return flash('描画SVGが見つかりません')
    try {
      const { blob, effectiveScale } = await svgToPngBlob(svg, pngScale, SKIN_BG[skinName])
      downloadBlob(blob, 'timing-chart.png')
      // The chart was too big for the requested scale — say so instead of
      // handing back a silently lower-resolution image.
      if (effectiveScale < pngScale - 0.01) {
        flash(`図が大きいため ${effectiveScale.toFixed(1)}× で書き出しました（上限による調整）`)
      }
    } catch (e) {
      flash(e instanceof Error ? e.message : 'PNG出力に失敗')
    }
  }

  const exportJson = () => {
    downloadText(serializeModel(model), 'timing-chart.wavejson', 'application/json')
  }

  const onLoadFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    file.text().then((text) => {
      const res = parseModel(text)
      if (res.ok && res.model) {
        loadModel(res.model)
        flash('読み込みました')
      } else {
        flash('読み込み失敗: ' + (res.error ?? ''))
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
    const base = copied ? '共有リンクをコピーしました' : 'URLを更新しました（コピーは手動で）'
    let suffix = ''
    if (url.length > 8000) suffix = ' ⚠ リンクが長すぎ、一部環境で開けない場合があります'
    else if (url.length > 2000) suffix = '（やや長め）'
    flash(base + suffix)
  }

  const toggleBridge = () => {
    if (bridgeOn) {
      bridgeDisconnect()
      setBridgeOn(false)
      setBridgeStatus('disconnected')
      flash('ブリッジを切断しました')
    } else {
      bridgeConnect(DEFAULT_BRIDGE_URL, setBridgeStatus)
      setBridgeOn(true)
      flash(`ブリッジ接続中… (${DEFAULT_BRIDGE_URL})`)
    }
  }

  return (
    <header className="toolbar">
      <span className="app-title">タイミングチャート</span>

      <div className="tb-group">
        <button onClick={undo} disabled={!canUndo} title="元に戻す (Ctrl+Z)" aria-label="元に戻す">
          ↶ 戻す
        </button>
        <button onClick={redo} disabled={!canRedo} title="やり直し (Ctrl+Y)" aria-label="やり直し">
          ↷ やり直し
        </button>
      </div>

      <div className="tb-group">
        <button onClick={addClock} title="周期的なクロック信号を1本追加します">
          ＋クロック
        </button>
        <select
          value={clockKind}
          onChange={(e) => setClockKind(e.target.value as ClockKind)}
          title="クロックの種類"
        >
          <option value="P">↑立ち上がり（矢印）</option>
          <option value="N">↓立ち下がり（矢印）</option>
          <option value="p">↑立ち上がり</option>
          <option value="n">↓立ち下がり</option>
        </select>
      </div>

      <div className="tb-group">
        <button onClick={exportPng}>PNG保存</button>
        <select value={pngScale} onChange={(e) => setPngScale(Number(e.target.value))} title="PNGの倍率">
          <option value={1}>1×</option>
          <option value={2}>2×</option>
          <option value={4}>4×</option>
        </select>
        <button onClick={share}>共有リンク</button>
      </div>

      <details className="adv-menu">
        <summary title="その他・上級者向け">⚙ その他</summary>
        <div className="adv-pop">
          <button onClick={exportJson} title="作りかけを保存（別の端末へ持ち運ぶ用）">
            ファイルに保存
          </button>
          <button onClick={() => fileRef.current?.click()} title="保存したファイルを開く">
            ファイルを開く
          </button>
          <button onClick={exportSvg} title="ベクター画像(SVG)で保存">
            SVGで保存
          </button>
          <label className="adv-row">
            スキン（見た目）
            <select value={skinName} onChange={(e) => setSkin(e.target.value as SkinName)}>
              {SKIN_NAMES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label className="adv-row" title="図の横方向の伸縮（長い波形を読みやすく広げる）">
            横の伸縮
            <select
              value={model.config?.hscale ?? 1}
              onChange={(e) =>
                applyGuiModel({
                  ...model,
                  config: { ...model.config, hscale: Number(e.target.value) },
                })
              }
            >
              <option value={1}>標準（1×）</option>
              <option value={2}>広め（2×）</option>
              <option value={3}>とても広い（3×）</option>
            </select>
          </label>
          <button
            onClick={toggleBridge}
            title={`Claude Code連携: ${DEFAULT_BRIDGE_URL} と双方向同期（開発者向け）`}
            className={bridgeOn ? 'bridge-btn on' : 'bridge-btn'}
          >
            <span className={`bridge-dot ${bridgeStatus}`} />
            ブリッジ{bridgeOn ? '切断' : '接続'}（開発者向け）
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
            ? '共有リンクのスナップショットを表示中。編集すると自分の作業として自動保存されます'
            : '編集内容はこのブラウザに自動保存されます'
        }
      >
        {viewingShared ? '共有リンク表示中' : '自動保存済み ✓'}
      </span>

      <span className="toast-region" role="status" aria-live="polite">
        {toast && <span className="toast">{toast}</span>}
      </span>
    </header>
  )
}
