import { create } from 'zustand'
import type { WaveJson } from '../model/wavejson'
import { serializeModel } from '../model/serialize'
import { parseModel } from '../model/parse'
import type { SkinName } from '../render/skins'
import { DEFAULT_MODEL } from './defaultModel'
import { readShare } from '../share/url'
import { flattenSignals } from './selectors'

const STORAGE_KEY = 'timing-chart:model'
const HISTORY_CAP = 50

/** The signal at `path`, or undefined. */
function signalAt(path: number[] | null, model: WaveJson) {
  if (!path) return undefined
  return flattenSignals(model).find(
    (r) => r.kind === 'signal' && r.path.length === path.length && r.path.every((v, i) => v === path[i]),
  )?.signal
}

/**
 * Is the selection still valid after a structural change? Requires both that
 * the path resolves AND that it points at the SAME signal (by name) — so a
 * reorder/insert that shifts indices doesn't leave the panels editing a
 * different row that happens to occupy the old path.
 */
function selectionSurvives(path: number[] | null, before: WaveJson, after: WaveJson): boolean {
  const a = signalAt(path, before)
  const b = signalAt(path, after)
  return !!a && !!b && a.name === b.name
}

/**
 * Detach a `#d=` share hash from the URL once the user edits. A share link is a
 * snapshot; without this, the hash keeps winning over localStorage on reload
 * (hash > localStorage), silently discarding post-share edits.
 */
function detachShareHash(): void {
  if (typeof window === 'undefined') return
  if (window.location.hash.includes('d=')) {
    window.history.replaceState(
      null,
      '',
      window.location.origin + window.location.pathname + window.location.search,
    )
  }
}

/** Load the autosaved model from localStorage, or null. Never throws. */
function loadPersisted(): WaveJson | null {
  try {
    const s = localStorage.getItem(STORAGE_KEY)
    if (!s) return null
    const res = parseModel(s)
    return res.ok && res.model ? res.model : null
  } catch {
    return null
  }
}

const share = readShare()
const startModel: WaveJson = share.model ?? loadPersisted() ?? DEFAULT_MODEL
// If a #d= link was present but failed to decode, surface it once on mount
// instead of silently showing the default (which looks like the sender's doc).
const startNotice = share.present && !share.model ? '共有リンクが壊れています（デフォルトを表示）' : null

export interface EditorState {
  /** Canonical model — the single source of truth that drives rendering. */
  model: WaveJson
  /** Last model that parsed/validated OK; the renderer always uses this. */
  lastValidModel: WaveJson
  /** Raw text shown in the WaveJSON editor (may be mid-edit / invalid). */
  textBuffer: string
  /**
   * Origin of the latest change. 'typing' means the text buffer changed from
   * user keystrokes and still needs a (debounced) parse; other values mean the
   * buffer already matches the model, so the debounced committer must NOT
   * re-parse (which would needlessly rebuild the model + re-render preview).
   */
  editSource: 'gui' | 'text' | 'load' | 'typing'
  /** Parse error from the text editor, or null when text is valid. */
  parseError: string | null
  /** True while the text editor is focused (it then "owns" its buffer). */
  textFocused: boolean
  skinName: SkinName
  /** Path of the currently selected signal row (for bus/annotation panels). */
  selectedPath: number[] | null
  /** One-shot startup notice (e.g. broken share link), shown then cleared. */
  notice: string | null
  /** Increments on each file/document load — lets views reset transient UI. */
  loadEpoch: number
  /** True while showing a shared-link snapshot that hasn't been edited yet. */
  viewingShared: boolean
  /** Undo stack (previous model snapshots, oldest first). */
  past: WaveJson[]
  /** Redo stack (snapshots undone, most-recently-undone last). */
  future: WaveJson[]

  /**
   * Apply a model produced by the GUI; regenerates the text buffer.
   * `coalesceText` collapses a run of inline text-field edits (signal/group
   * name, bus label) into ONE undo step instead of one-per-keystroke.
   */
  applyGuiModel: (model: WaveJson, coalesceText?: boolean) => void
  /** Update the raw text buffer without parsing (responsive typing). */
  setText: (text: string) => void
  /** Parse the current text buffer and, if valid, promote it to the model. */
  commitText: () => void
  setTextFocused: (focused: boolean) => void
  /** Replace everything from a loaded file / share link. */
  loadModel: (model: WaveJson) => void
  setSkin: (skin: SkinName) => void
  setSelectedPath: (path: number[] | null) => void
  clearNotice: () => void
  /** Restore the previous model snapshot. */
  undo: () => void
  /** Re-apply a snapshot that was undone. */
  redo: () => void
}

/** History fields recording `state.model` as the latest undo point. */
function histPush(state: EditorState): Pick<EditorState, 'past' | 'future'> {
  return { past: [...state.past, state.model].slice(-HISTORY_CAP), future: [] }
}

// True when the latest model change came from a text commit. Used to coalesce a
// run of debounced text commits into a single undo step. (editSource can't be
// used: setText flips it to 'typing' before every commit, so it can neither
// detect a continuation nor distinguish the first commit of a session.)
let lastChangeWasText = false

export const useEditor = create<EditorState>((set, get) => ({
  model: startModel,
  lastValidModel: startModel,
  textBuffer: serializeModel(startModel),
  editSource: 'load',
  parseError: null,
  textFocused: false,
  skinName: (startModel.config?.skin as SkinName) ?? 'default',
  selectedPath: null,
  notice: startNotice,
  loadEpoch: 0,
  viewingShared: share.present && !!share.model,
  past: [],
  future: [],

  applyGuiModel: (model, coalesceText = false) => {
    detachShareHash() // first edit after opening a share link → own working copy
    // Coalesce consecutive inline text-field edits into one undo step.
    const coalesce = coalesceText && lastChangeWasText
    lastChangeWasText = coalesceText
    set((state) => ({
      ...(coalesce ? {} : histPush(state)),
      model,
      lastValidModel: model,
      // Don't clobber the text buffer the user is actively typing in.
      textBuffer: state.textFocused ? state.textBuffer : serializeModel(model),
      editSource: 'gui',
      parseError: state.textFocused ? state.parseError : null,
      viewingShared: false,
    }))
  },

  setText: (text) => set({ textBuffer: text, editSource: 'typing' }),

  commitText: () => {
    const { textBuffer } = get()
    const res = parseModel(textBuffer)
    if (!(res.ok && res.model)) {
      set({ parseError: res.error ?? 'パースに失敗しました' })
      return
    }
    const state = get()
    // No-op: the text reduces to the current model (blur with no real edit, or
    // a formatting-only change) — don't pollute history / autosave.
    if (serializeModel(res.model) === serializeModel(state.model)) {
      set({ parseError: null, editSource: 'text' })
      return
    }
    detachShareHash()
    // Coalesce a run of text-edit commits into ONE undo step: only the first
    // commit of a text-editing session records history (debounced typing would
    // otherwise flood the 50-entry stack and evict earlier GUI/load undo points).
    const coalesce = lastChangeWasText
    lastChangeWasText = true
    set((s) => ({
      ...(coalesce ? {} : histPush(s)),
      model: res.model!,
      lastValidModel: res.model!,
      editSource: 'text',
      parseError: null,
      // model.config.skin is the single source of truth for the skin.
      skinName: (res.model!.config?.skin as SkinName) ?? 'default',
      // A text edit may have removed/reordered/inserted signals — drop the
      // selection unless it still points at the same signal.
      selectedPath: selectionSurvives(s.selectedPath, s.model, res.model!) ? s.selectedPath : null,
      viewingShared: false,
    }))
  },

  setTextFocused: (focused) => set({ textFocused: focused }),

  loadModel: (model) => {
    lastChangeWasText = false
    detachShareHash() // loading a file/blank = own working copy, not the share snapshot
    set((state) => ({
      ...histPush(state),
      model,
      lastValidModel: model,
      textBuffer: serializeModel(model),
      editSource: 'load',
      parseError: null,
      skinName: (model.config?.skin as SkinName) ?? 'default',
      // Fresh document — clear any selection pointing into the old one.
      selectedPath: null,
      loadEpoch: state.loadEpoch + 1,
      viewingShared: false,
    }))
  },

  // Skin is part of the model so it survives share/save/reload (the renderer
  // injects config.skin from skinName; keep both in sync here).
  setSkin: (skin) => {
    detachShareHash()
    lastChangeWasText = false
    set((state) => {
      const model = { ...state.model, config: { ...state.model.config, skin } }
      return {
        ...histPush(state),
        skinName: skin,
        model,
        lastValidModel: model,
        textBuffer: state.textFocused ? state.textBuffer : serializeModel(model),
        editSource: 'gui',
        viewingShared: false,
      }
    })
  },

  setSelectedPath: (path) => set({ selectedPath: path }),

  clearNotice: () => set({ notice: null }),

  undo: () => {
    lastChangeWasText = false
    set((state) => {
      if (state.past.length === 0) return {}
      const prev = state.past[state.past.length - 1]
      return {
        model: prev,
        lastValidModel: prev,
        textBuffer: state.textFocused ? state.textBuffer : serializeModel(prev),
        editSource: 'load',
        parseError: null,
        // Restore the snapshot's exact skin (default when it had none).
        skinName: (prev.config?.skin as SkinName) ?? 'default',
        past: state.past.slice(0, -1),
        future: [...state.future, state.model],
        selectedPath: selectionSurvives(state.selectedPath, state.model, prev) ? state.selectedPath : null,
      }
    })
  },

  redo: () => {
    lastChangeWasText = false
    set((state) => {
      if (state.future.length === 0) return {}
      const next = state.future[state.future.length - 1]
      return {
        model: next,
        lastValidModel: next,
        textBuffer: state.textFocused ? state.textBuffer : serializeModel(next),
        editSource: 'load',
        parseError: null,
        skinName: (next.config?.skin as SkinName) ?? 'default',
        past: [...state.past, state.model],
        future: state.future.slice(0, -1),
        selectedPath: selectionSurvives(state.selectedPath, state.model, next) ? state.selectedPath : null,
      }
    })
  },
}))

// Autosave the canonical model so a reload/accidental close doesn't lose work.
// Gate on MODEL identity so unrelated changes (selection, focus, skin, notice)
// don't trigger a save — critically, merely opening + clicking around a shared
// link (which only changes selection) must not overwrite the user's own work.
// Debounced so rapid edits don't hammer synchronous localStorage I/O.
let lastSavedModel: WaveJson = startModel
let saveTimer: number | undefined
useEditor.subscribe((state) => {
  if (state.model === lastSavedModel) return
  lastSavedModel = state.model
  if (saveTimer) window.clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => {
    saveTimer = undefined // clear so the pagehide flush guard stays meaningful
    try {
      localStorage.setItem(STORAGE_KEY, serializeModel(state.model))
    } catch {
      // storage full / disabled — best-effort autosave, ignore.
    }
  }, 400)
})

// Flush a pending debounced save when the page is being hidden/closed, so an
// edit made within the debounce window isn't lost on a quick close/reload.
function flushSave(): void {
  if (saveTimer === undefined) return
  window.clearTimeout(saveTimer)
  saveTimer = undefined
  try {
    localStorage.setItem(STORAGE_KEY, serializeModel(useEditor.getState().model))
  } catch {
    /* ignore */
  }
}
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flushSave)
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushSave()
  })
}
