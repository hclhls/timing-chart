import { useCallback, useState } from 'react'
import { useEditor } from '../../state/store'
import { WaveDromRenderer } from '../../render/WaveDromRenderer'
import { setLatestSvg } from '../../export/svgRegistry'
import { SKIN_BG } from '../../render/skins'
import { useI18n } from '../../i18n'

export function PreviewPane() {
  const { t } = useI18n()
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
      <div className="pane-title">{t('preview.title')}</div>
      {renderError && (
        <div className="banner banner-error">{t('preview.error', { error: renderError })}</div>
      )}
      <div className="preview-scroll" style={{ background: SKIN_BG[skin] }}>
        <WaveDromRenderer
          model={model}
          skin={skin}
          onRendered={onRendered}
          onError={onError}
        />
        {(model.signal?.length ?? 0) === 0 && (
          <div className="preview-empty">{t('preview.empty')}</div>
        )}
      </div>
    </section>
  )
}
