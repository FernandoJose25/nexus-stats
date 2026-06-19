import { useState, useEffect } from 'react'
import { Eye, EyeOff, Sun, Moon, ExternalLink, Check } from 'lucide-react'
import { validarFormatoApiKey } from '../services/groqService'
import { useT } from '../i18n/useT'
import { useLangStore } from '../i18n/useT'

export default function Configuracion() {
  const t = useT()
  const { lang, setLang } = useLangStore()

  const [apiKey, setApiKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [guardado, setGuardado] = useState(false)
  const [tema, setTema] = useState(localStorage.getItem('nexus-theme') ?? 'dark')

  // Cargar key guardada al montar
  useEffect(() => {
    const saved = localStorage.getItem('nexus-groq-key') ?? ''
    setApiKey(saved)
  }, [])

  function handleGuardar() {
    localStorage.setItem('nexus-groq-key', apiKey.trim())
    localStorage.setItem('nexus-theme', tema)
    window.__nexusSetTheme?.(tema)
    setGuardado(true)
    setTimeout(() => setGuardado(false), 2500)
  }

  function handleTema(t) {
    setTema(t)
    window.__nexusSetTheme?.(t)
    localStorage.setItem('nexus-theme', t)
  }

  const keyValida = validarFormatoApiKey(apiKey)
  const keyGuardada = localStorage.getItem('nexus-groq-key')

  return (
    <div className="flex-1 overflow-y-auto p-8">
      <div className="max-w-lg mx-auto space-y-8">
        <h1 className="text-xl font-semibold text-slate-200">{t('configuracion.titulo')}</h1>

        {/* Tema */}
        <Section title={t('configuracion.tema')}>
          <div className="flex gap-2">
            <ThemeBtn
              active={tema === 'dark'}
              icon={<Moon size={15} />}
              label={t('configuracion.temaOscuro')}
              onClick={() => handleTema('dark')}
            />
            <ThemeBtn
              active={tema === 'light'}
              icon={<Sun size={15} />}
              label={t('configuracion.temaClaro')}
              onClick={() => handleTema('light')}
            />
          </div>
        </Section>

        {/* Idioma */}
        <Section title="Idioma / Language">
          <div className="flex gap-2">
            <ThemeBtn active={lang === 'es'} label="Español" onClick={() => setLang('es')} />
            <ThemeBtn active={lang === 'en'} label="English" onClick={() => setLang('en')} />
          </div>
        </Section>

        {/* API Key Groq */}
        <Section title={t('configuracion.apiKeyGroq')}>
          <div className="space-y-3">
            <div className="relative">
              <input
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={t('configuracion.apiKeyPlaceholder')}
                className="w-full bg-[var(--color-bg)] border border-[var(--color-border)] rounded-lg
                           px-3 py-2.5 pr-10 text-sm text-slate-300 placeholder-slate-600
                           focus:outline-none focus:border-blue-500 font-mono"
              />
              <button
                onClick={() => setShowKey((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
              >
                {showKey ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>

            {apiKey && !keyValida && (
              <p className="text-amber-400 text-xs">La key debe comenzar con "gsk_"</p>
            )}
            {keyValida && (
              <p className="text-emerald-400 text-xs flex items-center gap-1">
                <Check size={12} /> Formato válido
              </p>
            )}

            <p className="text-slate-600 text-xs">
              {t('configuracion.apiKeyDesc')}.{' '}
              <button
                onClick={() => window.electronAPI?.openExternal('https://console.groq.com')}
                className="text-blue-400 hover:underline inline-flex items-center gap-0.5"
              >
                console.groq.com <ExternalLink size={11} />
              </button>
            </p>
          </div>
        </Section>

        {/* Guardar */}
        <button onClick={handleGuardar} className="btn-primary flex items-center gap-2">
          {guardado ? <><Check size={15} /> {t('configuracion.guardado')}</> : t('configuracion.guardar')}
        </button>

        {/* Info */}
        <div className="text-slate-700 text-xs space-y-1 pt-4 border-t border-[var(--color-border)]">
          <p>Nexus Stats v0.1.0</p>
          <p>Motor estadístico: Python 3.11 + FastAPI + pandas + scipy</p>
          <p>IA: Groq LLaMA 3.3 70B (requiere API key gratuita)</p>
          <p>100% gratuito · Sin telemetría · Sin registro</p>
        </div>
      </div>
    </div>
  )
}

function Section({ title, children }) {
  return (
    <div>
      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">{title}</p>
      {children}
    </div>
  )
}

function ThemeBtn({ active, icon, label, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors border
                  ${active
                    ? 'bg-blue-500/10 text-blue-400 border-blue-500/30'
                    : 'text-slate-400 border-[var(--color-border)] hover:text-slate-200 hover:bg-white/5'}`}
    >
      {icon} {label}
    </button>
  )
}
