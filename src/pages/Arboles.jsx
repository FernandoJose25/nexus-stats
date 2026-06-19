import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2, Sparkles, X, GitBranch, AlertCircle, CheckCircle2, Info } from 'lucide-react'
import { useDataStore } from '../store/dataStore'
import { ajustarArbol } from '../services/pythonApi'
import { interpretarResultado } from '../services/groqService'

export default function Arboles() {
  const navigate = useNavigate()
  const { metadata, getNumericColumns, getAllColumns } = useDataStore()

  const [tipo, setTipo] = useState('clasificacion')
  const [dependiente, setDependiente] = useState('')
  const [independientes, setIndependientes] = useState([])
  const [maxProfundidad, setMaxProfundidad] = useState(5)
  const [minHoja, setMinHoja] = useState(5)

  const [calculando, setCalculando] = useState(false)
  const [resultado, setResultado] = useState(null)
  const [error, setError] = useState(null)

  const [interpretacionIA, setInterpretacionIA] = useState(null)
  const [interpretandoIA, setInterpretandoIA] = useState(false)
  const [errorIA, setErrorIA] = useState(null)
  const abortRef = useRef(null)

  const numericCols = (getNumericColumns?.() ?? []).map((c) => c.nombre)
  const allCols = (getAllColumns?.() ?? []).map((c) => c.nombre)

  const depOpts = tipo === 'clasificacion' ? allCols : numericCols
  const indOpts = numericCols.filter((c) => c !== dependiente)

  function toggleIndep(col) {
    setIndependientes((prev) => prev.includes(col) ? prev.filter((c) => c !== col) : [...prev, col])
  }

  function handleTipo(t) {
    setTipo(t)
    setDependiente('')
    setIndependientes([])
    setResultado(null)
    setError(null)
    setInterpretacionIA(null)
  }

  async function handleCalcular() {
    if (!dependiente || independientes.length === 0) return
    setCalculando(true)
    setError(null)
    setResultado(null)
    try {
      const resp = await ajustarArbol(dependiente, independientes, tipo, maxProfundidad, minHoja)
      setResultado(resp)
    } catch (err) {
      setError(err.message)
    } finally {
      setCalculando(false)
    }
  }

  async function handleInterpretarIA() {
    const apiKey = localStorage.getItem('nexus-groq-key')
    if (!apiKey) { navigate('/configuracion'); return }
    setInterpretandoIA(true)
    setInterpretacionIA(null)
    setErrorIA(null)
    abortRef.current?.abort()
    abortRef.current = new AbortController()
    try {
      const texto = await interpretarResultado(resultado, apiKey, resultado.tipo, abortRef.current.signal)
      setInterpretacionIA(texto)
    } catch (err) {
      if (err.name === 'AbortError') return
      setErrorIA(err.message)
    } finally {
      setInterpretandoIA(false)
    }
  }

  if (!metadata) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <p className="text-slate-400 mb-4">No hay datos cargados.</p>
          <button onClick={() => navigate('/datos')} className="btn-primary text-sm">Ir al editor de datos</button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Sidebar */}
      <aside className="w-56 flex-shrink-0 border-r border-[var(--color-border)] flex flex-col overflow-hidden">
        <div className="px-4 py-3 border-b border-[var(--color-border)]">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Árbol de decisión</p>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-4">
          <div>
            <p className="text-xs text-slate-500 mb-1.5">Tipo</p>
            <div className="flex rounded-lg overflow-hidden border border-[var(--color-border)]">
              {[{ val: 'clasificacion', label: 'Clasificación' }, { val: 'regresion', label: 'Regresión' }].map(({ val, label }) => (
                <button key={val} onClick={() => handleTipo(val)}
                  className={`flex-1 text-xs py-1.5 transition-colors ${tipo === val ? 'bg-blue-500/20 text-blue-300' : 'text-slate-400 hover:text-slate-200'}`}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="text-xs text-slate-500 mb-1.5">Prof. máxima</p>
            <input type="number" min="1" max="20" value={maxProfundidad}
              onChange={(e) => setMaxProfundidad(parseInt(e.target.value))}
              className="w-full text-xs bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-2 py-1.5 text-slate-300 focus:outline-none focus:border-blue-500" />
          </div>

          <div>
            <p className="text-xs text-slate-500 mb-1.5">Mín. muestras/hoja</p>
            <input type="number" min="1" value={minHoja}
              onChange={(e) => setMinHoja(parseInt(e.target.value))}
              className="w-full text-xs bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-2 py-1.5 text-slate-300 focus:outline-none focus:border-blue-500" />
          </div>
        </div>

        <div className="p-3 border-t border-[var(--color-border)]">
          <button
            onClick={handleCalcular}
            disabled={!dependiente || independientes.length === 0 || calculando}
            className="btn-primary w-full text-sm flex items-center justify-center gap-2"
          >
            {calculando ? <><Loader2 size={14} className="animate-spin" /> Calculando...</> : 'Calcular'}
          </button>
        </div>
      </aside>

      {/* Panel central */}
      <div className="flex-1 overflow-y-auto">
        <div className="p-5 border-b border-[var(--color-border)]">
          <div
            className="flex items-start justify-between mb-4"
            style={{ paddingRight: 'calc(var(--titlebar-controls-width) + 8px)' }}
          >
            <div>
              <p className="font-semibold text-slate-200">
                Árbol de {tipo === 'clasificacion' ? 'clasificación' : 'regresión'} (CART)
              </p>
              <p className="text-slate-500 text-xs mt-0.5">
                {tipo === 'clasificacion' ? 'Predice categorías' : 'Predice valores continuos'} · requiere scikit-learn
              </p>
            </div>
            {resultado && (
              <button onClick={handleInterpretarIA} disabled={interpretandoIA}
                className="flex items-center gap-1.5 text-xs text-amber-400 hover:text-amber-300 px-3 py-1.5 rounded-lg hover:bg-amber-400/10 border border-amber-400/20 transition-colors">
                {interpretandoIA ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                Interpretar con IA
              </button>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4 max-w-2xl">
            <div>
              <label className="text-xs text-slate-500 block mb-1.5">Variable dependiente (Y)</label>
              <select value={dependiente} onChange={(e) => { setDependiente(e.target.value); setIndependientes([]) }}
                className="w-full text-xs bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-2 py-1.5 text-slate-300 focus:outline-none focus:border-blue-500">
                <option value="">— Seleccionar —</option>
                {depOpts.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="col-span-2">
              <label className="text-xs text-slate-500 block mb-1.5">Variables independientes (X)</label>
              <div className="flex flex-wrap gap-1.5">
                {indOpts.map((col) => (
                  <button key={col} onClick={() => toggleIndep(col)}
                    className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                      independientes.includes(col)
                        ? 'bg-blue-500/20 text-blue-300 border-blue-500/40'
                        : 'text-slate-400 border-[var(--color-border)] hover:text-slate-200 hover:border-slate-500'
                    }`}>
                    {col}
                  </button>
                ))}
                {indOpts.length === 0 && <p className="text-xs text-slate-600">Selecciona primero la variable dependiente</p>}
              </div>
            </div>
          </div>
        </div>

        {error && (
          <div className="mx-5 mt-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-xs text-red-400 flex items-center gap-2">
            <AlertCircle size={14} /> {error}
          </div>
        )}

        {!resultado && !error && (
          <div className="flex flex-col items-center justify-center h-48 text-center">
            <GitBranch size={36} className="text-slate-700 mb-3" />
            <p className="text-slate-500 text-sm">Configura las variables y ejecuta el modelo</p>
          </div>
        )}

        {resultado && (
          <div className="p-5 space-y-4">
            {resultado.tipo?.includes('clasificación') ? <ResultadoClasif resultado={resultado} /> : <ResultadoRegArbol resultado={resultado} />}
          </div>
        )}
      </div>

      {(interpretacionIA || interpretandoIA || errorIA) && (
        <aside className="w-72 flex-shrink-0 border-l border-[var(--color-border)] flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)]">
            <div className="flex items-center gap-2 text-amber-400">
              <Sparkles size={14} /><span className="text-xs font-semibold">Interpretación IA</span>
            </div>
            <button onClick={() => { setInterpretacionIA(null); setErrorIA(null); setInterpretandoIA(false) }} className="btn-ghost p-1"><X size={14} /></button>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            {interpretandoIA && <div className="flex items-center gap-2 text-slate-400 text-sm"><Loader2 size={14} className="animate-spin" /> Analizando...</div>}
            {errorIA && <p className="text-red-400 text-xs">{errorIA}</p>}
            {interpretacionIA && <p className="text-slate-300 text-sm leading-relaxed">{interpretacionIA}</p>}
          </div>
        </aside>
      )}
    </div>
  )
}

function ResultadoClasif({ resultado }) {
  const { confusion } = resultado
  const clases = confusion.clases

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Accuracy (train)" value={`${(resultado.accuracy * 100).toFixed(1)}%`} highlight={resultado.accuracy >= 0.7 ? 'green' : 'default'} />
        <StatCard label="CV Accuracy" value={`${(resultado.cv_accuracy * 100).toFixed(1)}% ± ${(resultado.cv_std * 100).toFixed(1)}%`} />
        <StatCard label="Profundidad" value={resultado.profundidad_real} />
        <StatCard label="N.º hojas" value={resultado.n_hojas} />
      </div>

      <ImportanciaTable importancias={resultado.importancias} />

      {/* Matriz de confusión */}
      <div className="card overflow-auto">
        <p className="text-xs text-slate-500 px-4 pt-3 pb-1 font-semibold">Matriz de confusión</p>
        <div className="p-4 overflow-auto">
          <table className="text-xs">
            <thead>
              <tr>
                <th className="px-3 py-2 text-slate-600">Real \ Pred.</th>
                {clases.map((c) => <th key={c} className="px-3 py-2 text-right text-slate-400">{c}</th>)}
              </tr>
            </thead>
            <tbody>
              {confusion.matrix.map((row, i) => (
                <tr key={i}>
                  <td className="px-3 py-2 text-slate-400 font-medium">{clases[i]}</td>
                  {row.map((v, j) => (
                    <td key={j} className={`px-3 py-2 text-right stat-value ${i === j ? 'text-emerald-400 font-bold' : 'text-slate-300'}`}>{v}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <ReglasList reglas={resultado.reglas} />
    </div>
  )
}

function ResultadoRegArbol({ resultado }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="R² (train)" value={resultado.r2} highlight={resultado.r2 >= 0.5 ? 'green' : 'default'} />
        <StatCard label="CV R²" value={`${resultado.cv_r2} ± ${resultado.cv_std}`} />
        <StatCard label="RMSE" value={resultado.rmse} />
        <StatCard label="MAE" value={resultado.mae} />
        <StatCard label="Profundidad" value={resultado.profundidad_real} />
        <StatCard label="N.º hojas" value={resultado.n_hojas} />
      </div>
      <ImportanciaTable importancias={resultado.importancias} />
      <ReglasList reglas={resultado.reglas} />
    </div>
  )
}

function ImportanciaTable({ importancias }) {
  const maxImp = importancias[0]?.importancia ?? 1
  return (
    <div className="card overflow-hidden">
      <p className="text-xs text-slate-500 px-4 pt-3 pb-1 font-semibold">Importancia de variables</p>
      <div className="p-4 space-y-2">
        {importancias.map((item) => (
          <div key={item.variable}>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-slate-300">{item.variable}</span>
              <span className="stat-value text-slate-400">{(item.importancia * 100).toFixed(1)}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-white/5">
              <div
                className="h-full rounded-full bg-blue-500/70 transition-all"
                style={{ width: `${(item.importancia / maxImp) * 100}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function ReglasList({ reglas }) {
  const [expanded, setExpanded] = useState(false)
  if (!reglas?.length) return null
  const visible = expanded ? reglas : reglas.slice(0, 5)
  return (
    <div className="card overflow-hidden">
      <p className="text-xs text-slate-500 px-4 pt-3 pb-1 font-semibold">Reglas del árbol (hasta prof. 3)</p>
      <div className="p-4 space-y-1">
        {visible.map((r, i) => (
          <p key={i} className="text-xs text-slate-400 font-mono leading-relaxed">{r}</p>
        ))}
        {reglas.length > 5 && (
          <button onClick={() => setExpanded(!expanded)} className="text-xs text-blue-400 hover:text-blue-300 mt-1">
            {expanded ? 'Ver menos' : `Ver ${reglas.length - 5} más`}
          </button>
        )}
      </div>
    </div>
  )
}

function StatCard({ label, value, highlight = 'default' }) {
  const valColor = highlight === 'green' ? 'text-emerald-400' : 'text-slate-200'
  return (
    <div className="card p-3 space-y-1">
      <p className="text-[10px] text-slate-500 uppercase tracking-wider">{label}</p>
      <p className={`stat-value font-bold text-base ${valColor}`}>{value}</p>
    </div>
  )
}
