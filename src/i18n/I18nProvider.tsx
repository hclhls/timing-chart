import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import { detectLanguage, saveLanguagePreference, translate } from './language'
import type { I18nKey, I18nParams, Language } from './types'

interface I18nContextValue {
  language: Language
  setLanguage: (language: Language) => void
  t: (key: I18nKey, params?: I18nParams) => string
}

const I18nContext = createContext<I18nContextValue | null>(null)

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(() => detectLanguage())
  const value = useMemo<I18nContextValue>(() => ({
    language,
    setLanguage: (next) => {
      setLanguageState(next)
      saveLanguagePreference(next)
    },
    t: (key, params) => translate(language, key, params),
  }), [language])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nContextValue {
  const value = useContext(I18nContext)
  if (!value) throw new Error('useI18n must be used inside I18nProvider')
  return value
}
