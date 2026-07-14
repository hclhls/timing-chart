import { DICTIONARIES } from './dictionary'
import type { I18nKey, I18nParams, Language } from './types'

export const LANGUAGE_STORAGE_KEY = 'timing-chart:language'
export const LANGUAGES: Language[] = ['ja', 'en', 'zh-TW']

export function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && value in DICTIONARIES
}

export function resolveLanguage(locales: readonly string[] = [], persisted?: unknown): Language {
  if (isLanguage(persisted)) return persisted
  for (const locale of locales) {
    const tag = locale.toLowerCase()
    if (tag === 'zh-tw' || tag === 'zh-hk' || tag === 'zh-mo' || tag.includes('zh-hant')) return 'zh-TW'
  }
  return 'ja'
}

export function detectLanguage(): Language {
  const persisted = loadLanguagePreference()
  if (typeof navigator === 'undefined') return resolveLanguage([], persisted)
  return resolveLanguage(navigator.languages ?? [navigator.language], persisted)
}

export function loadLanguagePreference(): Language | undefined {
  try {
    const value = localStorage.getItem(LANGUAGE_STORAGE_KEY)
    return isLanguage(value) ? value : undefined
  } catch {
    return undefined
  }
}

export function saveLanguagePreference(language: Language): void {
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, language)
  } catch {
    /* ignore */
  }
}

export function translate(language: Language, key: I18nKey, params: I18nParams = {}): string {
  const template = DICTIONARIES[language][key] ?? DICTIONARIES.en[key]
  return template.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? ''))
}

export function dictionaryKeyCount(language: Language): number {
  return Object.keys(DICTIONARIES[language]).length
}
