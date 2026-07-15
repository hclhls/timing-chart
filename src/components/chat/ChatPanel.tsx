import { useState } from 'react'
import { requestChat } from '../../chat/client'
import type { ChatMessage, ChatProposal } from '../../chat/types'
import { diffWaveJson } from '../../model/diff'
import { serializeModel } from '../../model/serialize'
import { WaveDromRenderer } from '../../render/WaveDromRenderer'
import { SKIN_BG } from '../../render/skins'
import { useEditor } from '../../state/store'
import { useI18n } from '../../i18n'

export function ChatPanel() {
  const { t } = useI18n()
  const model = useEditor((s) => s.model)
  const skinName = useEditor((s) => s.skinName)
  const applyGuiModel = useEditor((s) => s.applyGuiModel)
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [proposal, setProposal] = useState<ChatProposal | null>(null)
  const [proposalBase, setProposalBase] = useState<typeof model | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showDiff, setShowDiff] = useState(false)
  const [status, setStatus] = useState('')
  const [previewError, setPreviewError] = useState<string | null>(null)
  const isStale = proposalBase !== null && serializeModel(model) !== serializeModel(proposalBase)

  const generateProposal = async () => {
    const message = input.trim()
    if (!message || loading) return

    setLoading(true)
    setError(null)
    setStatus(t('chat.generating'))
    try {
      const nextProposal = await requestChat({ message, model, history: messages })
      setMessages((current) => [
        ...current,
        { role: 'user', content: message },
        { role: 'assistant', content: nextProposal.message },
      ])
      setProposal(nextProposal)
      setProposalBase(model)
      setPreviewError(null)
      setInput('')
      setStatus('')
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause)
      setError(t('chat.error', { error: detail }))
      setStatus('')
    } finally {
      setLoading(false)
    }
  }

  const applyProposal = () => {
    if (!proposal || isStale) {
      if (isStale) setStatus(t('chat.stale'))
      return
    }
    applyGuiModel(proposal.model)
    setProposal(null)
    setProposalBase(null)
    setShowDiff(false)
    setStatus(t('chat.applied'))
  }

  const discardProposal = () => {
    setProposal(null)
    setProposalBase(null)
    setShowDiff(false)
    setStatus(t('chat.discarded'))
  }

  const technicalDiff = proposal ? diffWaveJson(model, proposal.model) : ''

  return (
    <section className="chat-panel" aria-label={t('chat.heading')}>
      <div className="chat-status" role="status" aria-live="polite">
        {status}
      </div>
      {messages.length > 0 && (
        <ol className="chat-messages" aria-live="polite">
          {messages.map((message, index) => (
            <li key={`${message.role}-${index}`} className={`chat-message chat-message-${message.role}`}>
              {message.content}
            </li>
          ))}
        </ol>
      )}

      <form
        className="chat-form"
        onSubmit={(event) => {
          event.preventDefault()
          void generateProposal()
        }}
      >
        <label className="sr-only" htmlFor="chat-request">
          {t('chat.inputLabel')}
        </label>
        <textarea
          id="chat-request"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder={t('chat.inputPlaceholder')}
          disabled={loading}
          rows={3}
        />
        <button className="primary" type="submit" disabled={loading || !input.trim()}>
          {loading ? t('chat.generating') : t('chat.generate')}
        </button>
      </form>

      {error && <div className="banner banner-error" role="alert">{error}</div>}

      {proposal && (
        <section className="chat-proposal" aria-label={t('chat.proposalLabel')}>
          {isStale && <div className="banner banner-error" role="alert">{t('chat.stale')}</div>}
          {proposal.warnings.length > 0 && (
            <section className="chat-warnings" aria-label={t('chat.warnings')}>
              <h3>{t('chat.warnings')}</h3>
              <ul>
                {proposal.warnings.map((warning, index) => <li key={index}>{warning}</li>)}
              </ul>
            </section>
          )}
          <div className="chat-preview" style={{ background: SKIN_BG[skinName] }}>
            <WaveDromRenderer
              model={proposal.model}
              skin={skinName}
              onError={setPreviewError}
            />
          </div>
          {previewError && <div className="banner banner-error" role="alert">{previewError}</div>}
          <button
            className="chat-diff-toggle"
            type="button"
            aria-expanded={showDiff}
            onClick={() => setShowDiff((visible) => !visible)}
          >
            {t('chat.showDiff')}
          </button>
          {showDiff && <pre className="chat-diff">{technicalDiff || t('chat.noChanges')}</pre>}
          <div className="chat-actions">
            <button className="primary" type="button" onClick={applyProposal} disabled={loading || isStale}>
              {t('chat.apply')}
            </button>
            <button type="button" onClick={discardProposal} disabled={loading}>
              {t('chat.discard')}
            </button>
          </div>
        </section>
      )}
    </section>
  )
}
