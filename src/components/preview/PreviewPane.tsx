import { useCallback, useState } from 'react'
import { useEditor } from '../../state/store'
import { WaveDromRenderer } from '../../render/WaveDromRenderer'
import { setLatestSvg } from '../../export/svgRegistry'
import { SKIN_BG } from '../../render/skins'

export function PreviewPane() {
  const model = useEditor((s) => s.lastValidModel)
  const skin = useEditor((s) => s.skinName)
  const [renderError, setRenderError] = useState<string | null>(null)

  const onRendered = useCallback((svg: SVGSVGElement | null) => {
    setLatestSvg(svg)
  }, [])

  const onError = useCallback((msg: string | null) => {
    setRenderError(msg)
  }, [])

  return (
    <section className="preview-pane">
      <div className="pane-title">プレビュー</div>
      {renderError && (
        <div className="banner banner-error">描画エラー: {renderError}</div>
      )}
      <div className="preview-scroll" style={{ background: SKIN_BG[skin] }}>
        <WaveDromRenderer
          model={model}
          skin={skin}
          onRendered={onRendered}
          onError={onError}
        />
      </div>
    </section>
  )
}
