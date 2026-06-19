import { useEffect, useState } from 'react'
import { HashRouter, Routes, Route, NavLink } from 'react-router-dom'
import {
  LayoutDashboard, Table2, BarChart3, LineChart, Settings,
  Loader2, AlertCircle, TrendingUp, FlaskConical, GitBranch,
  BarChart2, Layers, CircleDot, Activity, ShieldCheck, Wand2, Grid3x3, Heart,
  Zap, ScanSearch, Star, Layers3, SlidersHorizontal, ArrowRight, Code2,
  Download, X,
} from 'lucide-react'

import { initPythonPort, health } from './services/pythonApi'
import { useT } from './i18n/useT'
import { useLangStore } from './i18n/useT'

import Home from './pages/Home'
import Descriptivos from './pages/Descriptivos'
import Graficos from './pages/Graficos'
import Configuracion from './pages/Configuracion'
import DataEditorPage from './pages/DataEditorPage'
import Correlaciones from './pages/Correlaciones'
import Hipotesis from './pages/Hipotesis'
import Regresion from './pages/Regresion'
import Anova from './pages/Anova'
import Factorial from './pages/Factorial'
import Clustering from './pages/Clustering'
import Arboles from './pages/Arboles'
import Series from './pages/Series'
import Fiabilidad from './pages/Fiabilidad'
import Glm from './pages/Glm'
import Transformar from './pages/Transformar'
import Crosstabs from './pages/Crosstabs'
import Supervivencia from './pages/Supervivencia'
import Arima from './pages/Arima'
import Potencia from './pages/Potencia'
import Discriminante from './pages/Discriminante'
import Psicometria from './pages/Psicometria'
import Manova from './pages/Manova'
import VariableView from './pages/VariableView'
import Mediacion from './pages/Mediacion'
import Sintaxis from './pages/Sintaxis'

// Detecta tema guardado en localStorage
function getInitialTheme() {
  return localStorage.getItem('nexus-theme') ?? 'dark'
}

export default function App() {
  const t = useT()
  const [engineStatus, setEngineStatus] = useState('connecting') // connecting | ok | error
  const [theme, setTheme] = useState(getInitialTheme)
  const [updateInfo, setUpdateInfo] = useState(null)      // { version, releaseNotes }
  const [updateState, setUpdateState] = useState('idle')  // idle | downloading | ready | dismissed
  const [dlPercent, setDlPercent] = useState(0)

  useEffect(() => {
    document.documentElement.classList.toggle('light', theme === 'light')
    localStorage.setItem('nexus-theme', theme)
  }, [theme])

  // Reservar espacio para los botones de ventana solo cuando corre en Electron
  useEffect(() => {
    if (window.electronAPI) {
      document.documentElement.style.setProperty('--titlebar-controls-width', '140px')
    }
  }, [])

  // Exponer setTheme globalmente para que Configuracion lo use
  useEffect(() => {
    window.__nexusSetTheme = setTheme
  }, [])

  // Escuchar eventos del auto-updater
  useEffect(() => {
    if (!window.electronAPI) return
    const offAvail = window.electronAPI.onUpdateAvailable((info) => {
      setUpdateInfo(info)
      setUpdateState('available')
    })
    const offProgress = window.electronAPI.onDownloadProgress(({ percent }) => {
      setDlPercent(percent)
    })
    const offReady = window.electronAPI.onUpdateDownloaded(() => {
      setUpdateState('ready')
    })
    return () => { offAvail?.(); offProgress?.(); offReady?.() }
  }, [])

  useEffect(() => {
    async function init() {
      await initPythonPort()
      // Intentar conectar al motor con reintentos
      for (let i = 0; i < 10; i++) {
        try {
          await health()
          setEngineStatus('ok')
          return
        } catch {
          await new Promise((r) => setTimeout(r, 800))
        }
      }
      setEngineStatus('error')
    }
    init()
  }, [])

  if (engineStatus === 'connecting') {
    return (
      <div className="h-screen flex flex-col items-center justify-center gap-4" style={{ background: 'var(--color-bg)' }}>
        <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
        <p className="text-slate-400 text-sm">{t('app.cargando')}</p>
      </div>
    )
  }

  if (engineStatus === 'error') {
    return (
      <div className="h-screen flex flex-col items-center justify-center gap-3" style={{ background: 'var(--color-bg)' }}>
        <AlertCircle className="w-8 h-8 text-red-400" />
        <p className="text-slate-200 font-medium">{t('app.errorMotor')}</p>
        <p className="text-slate-500 text-xs max-w-sm text-center">
          Asegúrate de que Python está instalado y el puerto 5174 está libre.
        </p>
      </div>
    )
  }

  return (
    <HashRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <div className="h-screen flex overflow-hidden" style={{ background: 'var(--color-bg)' }}>
        {/* Sidebar */}
        <aside className="w-56 flex-shrink-0 flex flex-col border-r border-[var(--color-border)]" style={{ background: 'var(--color-surface)' }}>
          {/* Logo */}
          <div className="h-10 flex items-center px-4 border-b border-[var(--color-border)]" style={{ WebkitAppRegion: 'drag' }}>
            <span className="font-bold text-base text-blue-400 tracking-tight">
              Nexus Stats
            </span>
          </div>

          {/* Nav */}
          <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto">
            <NavItem to="/" icon={<LayoutDashboard size={16} />} label={t('nav.inicio')} end />
            <NavItem to="/datos" icon={<Table2 size={16} />} label={t('nav.datos')} />
            <NavItem to="/transformar" icon={<Wand2 size={16} />} label="Transformar" />
            <NavItem to="/crosstabs" icon={<Grid3x3 size={16} />} label="Tablas cruzadas" />
            <NavItem to="/supervivencia" icon={<Heart size={16} />} label="Supervivencia" />
            <NavItem to="/arima"          icon={<TrendingUp size={16} />} label="ARIMA" />
            <NavItem to="/potencia"       icon={<Zap size={16} />}       label="Potencia" />
            <NavItem to="/discriminante"  icon={<ScanSearch size={16} />} label="Discriminante" />
            <NavItem to="/psicometria"    icon={<Star size={16} />}       label="Psicometría" />
            <NavItem to="/manova"        icon={<Layers3 size={16} />}         label="MANOVA" />
            <NavItem to="/mediacion"     icon={<ArrowRight size={16} />}      label="Mediación" />
            <NavItem to="/variables"     icon={<SlidersHorizontal size={16}/>} label="Variables" />
            <NavItem to="/sintaxis"      icon={<Code2 size={16} />}           label="Sintaxis" />
            <NavItem to="/descriptivos" icon={<BarChart3 size={16} />} label={t('nav.descriptivos')} />
            <NavItem to="/graficos" icon={<LineChart size={16} />} label={t('nav.graficos')} />
            <NavItem to="/correlaciones" icon={<TrendingUp size={16} />} label={t('nav.correlaciones')} />
            <NavItem to="/hipotesis" icon={<FlaskConical size={16} />} label={t('nav.hipotesis')} />
            <NavItem to="/regresion" icon={<GitBranch size={16} />} label={t('nav.regresion')} />
            <NavItem to="/anova" icon={<BarChart2 size={16} />} label={t('nav.anova')} />
            <NavItem to="/factorial" icon={<Layers size={16} />} label={t('nav.factorial')} />
            <NavItem to="/clustering" icon={<CircleDot size={16} />} label={t('nav.clustering')} />
            <NavItem to="/arboles" icon={<GitBranch size={16} />} label={t('nav.arboles')} />
            <NavItem to="/series" icon={<Activity size={16} />} label={t('nav.series')} />
            <NavItem to="/fiabilidad" icon={<ShieldCheck size={16} />} label={t('nav.fiabilidad')} />
            <NavItem to="/glm" icon={<FlaskConical size={16} />} label={t('nav.glm')} />
          </nav>

          {/* Settings al fondo */}
          <div className="p-2 border-t border-[var(--color-border)]">
            <NavItem to="/configuracion" icon={<Settings size={16} />} label={t('nav.configuracion')} />
          </div>
        </aside>

        {/* Contenido principal */}
        <main className="flex-1 overflow-hidden flex flex-col">
          {/* Banner de actualización */}
          {updateState !== 'idle' && updateState !== 'dismissed' && (
            <div className="flex-shrink-0 flex items-center gap-3 px-4 py-2 bg-blue-600/20 border-b border-blue-500/30 text-sm">
              <Download size={14} className="text-blue-400 flex-shrink-0" />
              {updateState === 'available' && (
                <>
                  <span className="text-slate-300 flex-1">
                    Nueva versión <strong className="text-white">{updateInfo?.version}</strong> disponible.
                  </span>
                  <button
                    onClick={() => { setUpdateState('downloading'); window.electronAPI.downloadUpdate() }}
                    className="px-3 py-0.5 rounded bg-blue-500 hover:bg-blue-400 text-white text-xs font-medium transition-colors"
                  >
                    Descargar
                  </button>
                  <button onClick={() => setUpdateState('dismissed')} className="text-slate-500 hover:text-slate-300 transition-colors">
                    <X size={14} />
                  </button>
                </>
              )}
              {updateState === 'downloading' && (
                <>
                  <span className="text-slate-300 flex-1">Descargando actualización… {dlPercent}%</span>
                  <div className="w-24 h-1.5 rounded-full bg-slate-700 overflow-hidden">
                    <div className="h-full bg-blue-500 transition-all" style={{ width: `${dlPercent}%` }} />
                  </div>
                </>
              )}
              {updateState === 'ready' && (
                <>
                  <span className="text-slate-300 flex-1">
                    Actualización lista. Instala y reinicia para aplicarla.
                  </span>
                  <button
                    onClick={() => window.electronAPI.installUpdate()}
                    className="px-3 py-0.5 rounded bg-blue-500 hover:bg-blue-400 text-white text-xs font-medium transition-colors"
                  >
                    Instalar y reiniciar
                  </button>
                  <button onClick={() => setUpdateState('dismissed')} className="text-slate-500 hover:text-slate-300 transition-colors">
                    <X size={14} />
                  </button>
                </>
              )}
            </div>
          )}

          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/datos" element={<DataEditorPage />} />
            <Route path="/descriptivos" element={<Descriptivos />} />
            <Route path="/graficos" element={<Graficos />} />
            <Route path="/correlaciones" element={<Correlaciones />} />
            <Route path="/hipotesis" element={<Hipotesis />} />
            <Route path="/regresion" element={<Regresion />} />
            <Route path="/anova" element={<Anova />} />
            <Route path="/factorial" element={<Factorial />} />
            <Route path="/clustering" element={<Clustering />} />
            <Route path="/arboles" element={<Arboles />} />
            <Route path="/series" element={<Series />} />
            <Route path="/fiabilidad" element={<Fiabilidad />} />
            <Route path="/glm" element={<Glm />} />
            <Route path="/transformar" element={<Transformar />} />
            <Route path="/crosstabs" element={<Crosstabs />} />
            <Route path="/supervivencia" element={<Supervivencia />} />
            <Route path="/arima"         element={<Arima />} />
            <Route path="/potencia"      element={<Potencia />} />
            <Route path="/discriminante" element={<Discriminante />} />
            <Route path="/psicometria"   element={<Psicometria />} />
            <Route path="/manova"        element={<Manova />} />
            <Route path="/mediacion"     element={<Mediacion />} />
            <Route path="/variables"     element={<VariableView />} />
            <Route path="/sintaxis"      element={<Sintaxis />} />
            <Route path="/configuracion" element={<Configuracion />} />
          </Routes>
        </main>
      </div>
    </HashRouter>
  )
}

function NavItem({ to, icon, label, end }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `nav-item ${isActive ? 'active' : ''}`
      }
    >
      {icon}
      <span>{label}</span>
    </NavLink>
  )
}
