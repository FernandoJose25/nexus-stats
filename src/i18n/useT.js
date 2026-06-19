/**
 * Hook minimalista de i18n. Busca claves con notación de punto en el JSON activo.
 * Uso: const t = useT(); t('datos.abrirArchivo')
 */
import { create } from 'zustand'
import es from './es.json'
import en from './en.json'

const TRANSLATIONS = { es, en }

export const useLangStore = create((set) => ({
  lang: 'es',
  setLang: (lang) => set({ lang }),
}))

function resolve(obj, path) {
  return path.split('.').reduce((acc, key) => acc?.[key], obj) ?? path
}

export function useT() {
  const lang = useLangStore((s) => s.lang)
  const dict = TRANSLATIONS[lang] ?? TRANSLATIONS.es
  return (key) => resolve(dict, key)
}
