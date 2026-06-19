import { useNavigate } from 'react-router-dom'
import {
  FolderOpen, BarChart3, LineChart, Sparkles,
  TrendingUp, FlaskConical, GitBranch, BarChart2,
  Layers, CircleDot, Activity, ShieldCheck, Microscope,
} from 'lucide-react'
import { useDataStore } from '../store/dataStore'
import { cargarArchivo, getPreview } from '../services/pythonApi'

const MODULOS = [
  { icon: <BarChart3 className="w-4 h-4" />, color: 'text-violet-400', title: 'Descriptivos', desc: 'Media, mediana, percentiles, frecuencias', ruta: '/descriptivos' },
  { icon: <LineChart className="w-4 h-4" />, color: 'text-emerald-400', title: 'Gráficos', desc: 'Histogramas, barras, dispersión, boxplot', ruta: '/graficos' },
  { icon: <TrendingUp className="w-4 h-4" />, color: 'text-sky-400', title: 'Correlaciones', desc: 'Pearson, Spearman, tau-b de Kendall', ruta: '/correlaciones' },
  { icon: <FlaskConical className="w-4 h-4" />, color: 'text-pink-400', title: 'Tests de hipótesis', desc: 't-test, chi², Mann-Whitney, Kruskal-Wallis', ruta: '/hipotesis' },
  { icon: <GitBranch className="w-4 h-4" />, color: 'text-blue-400', title: 'Regresión', desc: 'Lineal simple/múltiple y logística binaria', ruta: '/regresion' },
  { icon: <BarChart2 className="w-4 h-4" />, color: 'text-amber-400', title: 'ANOVA', desc: 'ANOVA de un factor + post-hoc Tukey HSD', ruta: '/anova' },
  { icon: <Layers className="w-4 h-4" />, color: 'text-indigo-400', title: 'Factorial', desc: 'PCA y análisis factorial exploratorio (Varimax)', ruta: '/factorial' },
  { icon: <CircleDot className="w-4 h-4" />, color: 'text-teal-400', title: 'Clustering', desc: 'K-means + análisis de silueta para k óptimo', ruta: '/clustering' },
  { icon: <GitBranch className="w-4 h-4" />, color: 'text-orange-400', title: 'Árboles de decisión', desc: 'Clasificación y regresión CART (scikit-learn)', ruta: '/arboles' },
  { icon: <Activity className="w-4 h-4" />, color: 'text-rose-400', title: 'Series temporales', desc: 'Tendencia, ACF/PACF, descomposición, suavizado', ruta: '/series' },
  { icon: <ShieldCheck className="w-4 h-4" />, color: 'text-cyan-400', title: 'Fiabilidad', desc: 'Alpha de Cronbach, Split-half, correlaciones ítem-total', ruta: '/fiabilidad' },
]

export default function Home() {
  const navigate = useNavigate()
  const { metadata, setMetadata, setRows, setLoading, setLoadError, isLoading } = useDataStore()

  async function handleAbrirArchivo() {
    if (!window.electronAPI) return
    const ruta = await window.electronAPI.openFile()
    if (!ruta) return

    setLoading(true)
    setLoadError(null)
    try {
      const { metadata: meta } = await cargarArchivo(ruta)
      setMetadata(meta)
      const { filas } = await getPreview(100)
      setRows(filas)
      navigate('/datos')
    } catch (err) {
      setLoadError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex-1 overflow-y-auto p-8">
      <div className="max-w-3xl mx-auto">
        {/* Hero */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-slate-100 mb-2">
            Bienvenido a <span className="text-blue-400">Nexus Stats</span>
          </h1>
          <p className="text-slate-400 text-base leading-relaxed">
            Herramienta de análisis estadístico profesional, gratuita y en español.
            Importa tus datos y comienza a explorar en segundos.
          </p>
        </div>

        {/* Abrir archivo */}
        <div className="mb-8 flex gap-3">
          <button
            onClick={handleAbrirArchivo}
            disabled={isLoading}
            className="btn-primary flex items-center gap-2 px-5 py-2.5"
          >
            <FolderOpen className="w-4 h-4" />
            {isLoading ? 'Cargando...' : 'Abrir archivo'}
          </button>
          <p className="text-slate-500 text-xs self-center">CSV, Excel, SPSS (.sav), SAS, Stata</p>
        </div>

        {/* Dataset activo */}
        {metadata && (
          <div className="card p-4 mb-8 flex items-center justify-between">
            <div>
              <p className="text-slate-300 font-medium">{metadata.filename}</p>
              <p className="text-slate-500 text-xs mt-0.5">
                {metadata.rows.toLocaleString()} filas · {metadata.columns} variables
              </p>
            </div>
            <button onClick={() => navigate('/datos')} className="btn-primary text-sm">
              Ver datos
            </button>
          </div>
        )}

        {/* Módulos */}
        <div>
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-4">Módulos de análisis</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {MODULOS.map((m) => (
              <button
                key={m.ruta}
                onClick={() => navigate(m.ruta)}
                disabled={!metadata}
                className="card p-4 text-left hover:border-blue-500/30 hover:bg-white/[0.02]
                           transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed
                           active:scale-[0.99]"
              >
                <div className={`mb-2 ${m.color}`}>{m.icon}</div>
                <p className="font-medium text-slate-200 text-sm mb-1">{m.title}</p>
                <p className="text-slate-500 text-xs leading-relaxed">{m.desc}</p>
              </button>
            ))}
          </div>
        </div>

        {/* IA */}
        <div className="mt-6 card p-4 flex items-center gap-3">
          <Sparkles className="w-5 h-5 text-amber-400 flex-shrink-0" />
          <div>
            <p className="text-slate-300 text-sm font-medium">Interpretación con IA</p>
            <p className="text-slate-500 text-xs mt-0.5">
              Cada módulo incluye un botón para que LLaMA 3.3 (Groq) explique los resultados en lenguaje claro.
              Configura tu API key gratuita en <button onClick={() => navigate('/configuracion')} className="text-blue-400 hover:underline">Configuración</button>.
            </p>
          </div>
        </div>

        {/* Footer */}
        <p className="text-slate-600 text-xs mt-10 text-center">
          Nexus Stats v1.0 · Gratuito · Sin registro · Sin telemetría
        </p>
      </div>
    </div>
  )
}
