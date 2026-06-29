import defaultSkin from 'wavedrom/skins/default.js'
import narrowSkin from 'wavedrom/skins/narrow.js'
import lowkeySkin from 'wavedrom/skins/lowkey.js'
import darkSkin from 'wavedrom/skins/dark.js'

export type SkinName = 'default' | 'narrow' | 'lowkey' | 'dark'

export const SKIN_NAMES: SkinName[] = ['default', 'narrow', 'lowkey', 'dark']

/** Background color each skin is designed to be viewed/exported against. */
export const SKIN_BG: Record<SkinName, string> = {
  default: '#ffffff',
  narrow: '#ffffff',
  lowkey: '#ffffff',
  dark: '#202020',
}

// Each wavedrom skin module exports under its own key, e.g. { dark: [...] }.
// WaveDrom's renderer selects the lane params via `waveSkin[config.skin]` and
// falls back to `waveSkin.default`. Merging every skin into one object lets us
// switch skins purely by setting config.skin, with 'default' always present.
export const WAVE_SKIN: Record<string, unknown> = {
  ...(defaultSkin as Record<string, unknown>),
  ...(narrowSkin as Record<string, unknown>),
  ...(lowkeySkin as Record<string, unknown>),
  ...(darkSkin as Record<string, unknown>),
}
