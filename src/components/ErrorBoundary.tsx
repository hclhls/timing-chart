import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}
interface State {
  error: Error | null
}

/**
 * Catches render crashes so a malformed model (e.g. one autosaved before a
 * validation fix, or arriving via a crafted share link) shows a recovery panel
 * instead of a white screen the user can't escape. Reset clears the autosave
 * and the share hash, then reloads to the default document.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Surface for debugging; no external reporting (fully client-side).
    console.error('描画クラッシュ:', error, info.componentStack)
  }

  private reset = () => {
    try {
      localStorage.removeItem('timing-chart:model')
    } catch {
      /* ignore */
    }
    // Clear the share hash FIRST: replacing to origin+pathname while a hash is
    // present is a same-document navigation that would not reload. Strip it via
    // history, then force a real reload to remount from the default document.
    window.history.replaceState(
      null,
      '',
      window.location.origin + window.location.pathname + window.location.search,
    )
    window.location.reload()
  }

  render() {
    if (this.state.error) {
      return (
        <div className="crash-panel">
          <h1>表示中に問題が発生しました</h1>
          <p>
            データが壊れている可能性があります。リセットすると保存内容を破棄して
            デフォルトのチャートで再起動します。
          </p>
          <pre className="crash-detail">{this.state.error.message}</pre>
          <button onClick={this.reset}>リセットして再読み込み</button>
        </div>
      )
    }
    return this.props.children
  }
}
