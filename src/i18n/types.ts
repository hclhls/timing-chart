import type { DICTIONARIES } from './dictionary'

export type Language = keyof typeof DICTIONARIES
export type I18nKey = keyof typeof DICTIONARIES['en']
export type I18nParams = Record<string, string | number>
