import { create } from 'zustand'
import type { WaveJson } from '../model/wavejson'
import { serializeModel } from '../model/serialize'
import { parseModel } from '../model/parse'
import type { SkinName } from '../render/skins'
import { DEFAULT_MODEL } from './defaultModel'
import { readShare } from '../share/url'

const STORAGE_KEY = 'timing-chart:model'

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

  /** Apply a model produced by the GUI; regenerates the text buffer. */
  applyGuiModel: (model: WaveJson) => void
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
}

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

  applyGuiModel: (model) =>
    set((state) => ({
      model,
      lastValidModel: model,
      // Don't clobber the text buffer the user is actively typing in.
      textBuffer: state.textFocused ? state.textBuffer : serializeModel(model),
      editSource: 'gui',
      parseError: state.textFocused ? state.parseError : null,
    })),

  setText: (text) => set({ textBuffer: text, editSource: 'typing' }),

  commitText: () => {
    const { textBuffer } = get()
    const res = parseModel(textBuffer)
    if (res.ok && res.model) {
      // Promote to model but DO NOT rewrite textBuffer — the user owns it.
      set({
        model: res.model,
        lastValidModel: res.model,
        editSource: 'text',
        parseError: null,
        skinName: (res.model.config?.skin as SkinName) ?? get().skinName,
      })
    } else {
      set({ parseError: res.error ?? 'パースに失敗しました' })
    }
  },

  setTextFocused: (focused) => set({ textFocused: focused }),

  loadModel: (model) =>
    set({
      model,
      lastValidModel: model,
      textBuffer: serializeModel(model),
      editSource: 'load',
      parseError: null,
      skinName: (model.config?.skin as SkinName) ?? get().skinName,
    }),

  setSkin: (skin) => set({ skinName: skin }),

  setSelectedPath: (path) => set({ selectedPath: path }),

  clearNotice: () => set({ notice: null }),
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
    try {
      localStorage.setItem(STORAGE_KEY, serializeModel(state.model))
    } catch {
      // storage full / disabled — best-effort autosave, ignore.
    }
  }, 400)
})
