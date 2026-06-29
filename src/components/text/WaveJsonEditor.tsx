import { useEffect, useRef } from 'react'
import { useEditor } from '../../state/store'

const DEBOUNCE_MS = 300

/**
 * Raw WaveJSON text editor. Typing updates the buffer instantly; parsing +
 * model promotion is debounced. Invalid JSON keeps the last good diagram and
 * shows a non-blocking error banner.
 */
export function WaveJsonEditor() {
  const textBuffer = useEditor((s) => s.textBuffer)
  const editSource = useEditor((s) => s.editSource)
  const parseError = useEditor((s) => s.parseError)
  const setText = useEditor((s) => s.setText)
  const commitText = useEditor((s) => s.commitText)
  const setTextFocused = useEditor((s) => s.setTextFocused)

  const timer = useRef<number | undefined>(undefined)

  // Debounced commit ONLY for user keystrokes. When the buffer changed because
  // the GUI/load regenerated it (editSource !== 'typing'), it already matches
  // the model, so re-parsing would needlessly rebuild it and re-render preview.
  useEffect(() => {
    if (editSource !== 'typing') return
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => commitText(), DEBOUNCE_MS)
    return () => {
      if (timer.current) window.clearTimeout(timer.current)
    }
  }, [textBuffer, editSource, commitText])

  return (
    <section className="text-editor">
      <div className="pane-title">WaveJSON</div>
      {parseError ? (
        <div className="banner banner-error" role="alert">
          {parseError}
        </div>
      ) : (
        <div className="banner banner-ok" role="status" aria-live="polite">
          構文OK
        </div>
      )}
      <textarea
        className="wavejson-textarea"
        spellCheck={false}
        value={textBuffer}
        onChange={(e) => setText(e.target.value)}
        onFocus={() => setTextFocused(true)}
        onBlur={() => {
          setTextFocused(false)
          commitText()
        }}
      />
    </section>
  )
}
