import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2, Sparkles, X, Layers, AlertCircle, CheckCircle2, Info } from 'lucide-react'
import { useDataStore } from '../store/dataStore'
import { factorialExploratorio } from '../services/pythonApi'
import { interpretarResultado } from '../services/groqService'

const MAGNITUD_STYLE = {
  excelente:    'text-emerald-400 bg-emerald-400/10',
  bueno:        'text-sky-400 bg-sky-400/10',
  aceptable:    'text-blue-400 bg-blue-400/10',
  mediocre:     'text-amber-400 bg-amber-400/10',
  deficiente:   'text-orange-400 bg-orange-400/10',
  inaceptable:  'text-red-400 bg-red-400/10',
}

export default function Factorial() {
  const navigate = useNavigate()
  const { metadata, getNumericColumns } = useDataStore()

  const [variables, setVariables] = useState([])
  const [nFactores, setNFactores] = useState('')
  const [rotacion, setRotacion] = useState('varimax')
  const [estandarizar, setEstandarizar] = useState(true)

  const [calculando, setCalculando] = useState(false)
  const [resultado, setResultado] = useState(null)
  const [error, setError] = useState(null)

  const [interpretacionIA, setInterpretacionIA] = useState(null)
  const [interpretandoIA, setInterpretandoIA] = useState(false)
  const [errorIA, setErrorIA] = useState(null)
  const abortRef = useRef(null)

  const numericCols = (getNumericColumns?.() ?? []).map((c) => c.nombre)

  function toggleVar(col) {
    setVariables((prev) => prev.includes(col) ? prev.filter((c) => c !== col) : [...prev, col])
  }

  async function handleCalcular() {
    if (variables.length < 3) return
    setCalculando(true)
    setError(null)
    setResultado(null)
    try {
      const resp = await factorialExploratorio(
        variables,
        nFactores ? parseInt(nFactores) : null,
        rotacion,
        estandarizar
      )
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
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Análisis Factorial</p>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-4">
          {/* Opciones */}
          <div>
            <p className="text-xs text-slate-500 mb-1.5">N.º de factores</p>
            <input
              type="number"
              min="1"
              value={nFactores}
              onChange={(e) => setNFactores(e.target.value)}
              placeholder="Kaiser (auto)"
              className="w-full text-xs bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-2 py-1.5 text-slate-300 focus:outline-none focus:border-blue-500"
            />
          </div>

          <div>
            <p className="text-xs text-slate-500 mb-1.5">Rotación</p>
            <select
              value={rotacion}
              onChange={(e) => setRotacion(e.target.value)}
              className="w-full text-xs bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-2 py-1.5 text-slate-300 focus:outline-none focus:border-blue-500"
            >
              <option value="varimax">Varimax</option>
              <option value="none">Sin rotación</option>
            </select>
          </div>

          <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer">
            <input type="checkbox" checked={estandarizar} onChange={(e) => setEstandarizar(e.target.checked)} className="accent-blue-500" />
            Estandarizar variables
          </label>
        </div>

        <div className="p-3 border-t border-[var(--color-border)]">
          <button
            onClick={handleCalcular}
            disabled={variables.length < 3 || calculando}
            className="btn-primary w-full text-sm flex items-center justify-center gap-2"
          >
            {calculando ? <><Loader2 size={14} className="animate-spin" /> Calculando...</> : 'Calcular'}
          </button>
          {variables.length < 3 && (
            <p className="text-[10px] text-slate-600 text-center mt-1">Selecciona ≥ 3 variables</p>
          )}
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
              <p className="font-semibold text-slate-200">Análisis Factorial Exploratorio</p>
              <p className="text-slate-500 text-xs mt-0.5">PCA con rotación Varimax — selecciona ≥ 3 variables numéricas</p>
            </div>
            {resultado && (
              <button
                onClick={handleInterpretarIA}
                disabled={interpretandoIA}
                className="flex items-center gap-1.5 text-xs text-amber-400 hover:text-amber-300 px-3 py-1.5 rounded-lg hover:bg-amber-400/10 border border-amber-400/20 transition-colors"
              >
                {interpretandoIA ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                Interpretar con IA
              </button>
            )}
          </div>

          <p className="text-xs text-slate-500 mb-2">Variables ({variables.length} seleccionadas)</p>
          <div className="flex flex-wrap gap-1.5">
            {numericCols.map((col) => (
              <button
                key={col}
                onClick={() => toggleVar(col)}
                className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                  variables.includes(col)
                    ? 'bg-blue-500/20 text-blue-300 border-blue-500/40'
                    : 'text-slate-400 border-[var(--color-border)] hover:text-slate-200 hover:border-slate-500'
                }`}
              >
                {col}
              </button>
            ))}
          </div>
        </div>

        {error && (
          <div className="mx-5 mt-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-xs text-red-400 flex items-center gap-2">
            <AlertCircle size={14} /> {error}
          </div>
        )}

        {!resultado && !error && (
          <div className="flex flex-col items-center justify-center h-48 text-center">
            <Layers size={36} className="text-slate-700 mb-3" />
            <p className="text-slate-500 text-sm">Selecciona variables y ejecuta el análisis</p>
          </div>
        )}

        {resultado && <ResultadoFactorial resultado={resultado} />}
      </div>

      {/* Panel IA */}
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

function ResultadoFactorial({ resultado }) {
  const ok = resultado.bartlett_significativo && resultado.kmo >= 0.5

  return (
    <div className="p-5 space-y-4">
      {/* Adecuación muestral */}
      <div className={`flex items-start gap-3 p-4 rounded-xl border ${ok ? 'bg-emerald-500/5 border-emerald-500/20' : 'bg-amber-500/5 border-amber-500/20'}`}>
        {ok ? <CheckCircle2 size={20} className="text-emerald-400 flex-shrink-0 mt-0.5" /> : <AlertCircle size={20} className="text-amber-400 flex-shrink-0 mt-0.5" />}
        <div>
          <p className={`font-semibold text-sm ${ok ? 'text-emerald-300' : 'text-amber-300'}`}>
            {ok ? 'Datos adecuados para el análisis factorial' : 'Adecuación muestral insuficiente'}
          </p>
          <p className="text-slate-500 text-xs mt-0.5">
            KMO = {resultado.kmo} ({resultado.kmo_interpretacion}) · Bartlett p {resultado.bartlett_p < 0.001 ? '< 0.001' : `= ${resultado.bartlett_p}`}
          </p>
        </div>
      </div>

      {/* KMO y Bartlett */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="KMO" value={resultado.kmo} badge={resultado.kmo_interpretacion} />
        <StatCard label="Bartlett χ²" value={resultado.bartlett_chi2} />
        <StatCard label="Bartlett p" value={resultado.bartlett_p < 0.001 ? '< 0.001' : resultado.bartlett_p} highlight={resultado.bartlett_significativo ? 'green' : 'default'} />
        <StatCard label="Factores extraídos" value={resultado.n_factores} />
      </div>

      {/* Eigenvalues y varianza */}
      <div className="card overflow-auto">
        <p className="text-xs text-slate-500 px-4 pt-3 pb-1 font-semibold">Eigenvalues y varianza explicada</p>
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-[var(--color-border)]" style={{ background: 'var(--color-bg)' }}>
              <th className="px-4 py-2.5 text-left text-slate-400">Factor</th>
              <th className="px-4 py-2.5 text-right text-slate-400">Eigenvalue</th>
              <th className="px-4 py-2.5 text-right text-slate-400">Var. explicada %</th>
              <th className="px-4 py-2.5 text-right text-slate-400">Var. acumulada %</th>
              <th className="px-4 py-2.5 text-center text-slate-400">Retenido</th>
            </tr>
          </thead>
          <tbody>
            {resultado.eigenvalues.filter((e) => e.factor <= resultado.p).map((e) => (
              <tr key={e.factor} className={`border-b border-[var(--color-border)] last:border-0 ${e.retenido ? 'bg-blue-500/5' : ''}`}>
                <td className="px-4 py-2 text-slate-300">{e.factor}</td>
                <td className={`px-4 py-2 text-right stat-value ${e.retenido ? 'text-blue-300' : 'text-slate-400'}`}>{e.eigenvalue}</td>
                <td className="px-4 py-2 text-right stat-value text-slate-300">{e.varianza_pct}%</td>
                <td className="px-4 py-2 text-right stat-value text-slate-400">{e.varianza_acum}%</td>
                <td className="px-4 py-2 text-center">{e.retenido ? '✓' : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Matriz de cargas */}
      <div className="card overflow-auto">
        <p className="text-xs text-slate-500 px-4 pt-3 pb-1 font-semibold">
          Matriz de cargas{resultado.rotacion !== 'none' ? ` (${resultado.rotacion})` : ''}
        </p>
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-[var(--color-border)]" style={{ background: 'var(--color-bg)' }}>
              <th className="px-4 py-2.5 text-left text-slate-400">Variable</th>
              {resultado.factores_labels.map((f) => (
                <th key={f} className="px-4 py-2.5 text-right text-slate-400">{f}</th>
              ))}
              <th className="px-4 py-2.5 text-right text-slate-400">h²</th>
            </tr>
          </thead>
          <tbody>
            {resultado.loadings.map((row, i) => (
              <tr key={i} className="border-b border-[var(--color-border)] last:border-0">
                <td className="px-4 py-2 text-slate-300 font-medium">{row.variable}</td>
                {resultado.factores_labels.map((f) => {
                  const val = row[f]
                  const abs = Math.abs(val)
                  const color = abs >= 0.5 ? 'text-blue-300 font-semibold' : abs >= 0.3 ? 'text-slate-200' : 'text-slate-500'
                  return (
                    <td key={f} className={`px-4 py-2 text-right stat-value ${color}`}>{val}</td>
                  )
                })}
                <td className="px-4 py-2 text-right stat-value text-slate-400">{row.comunalidad}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="px-4 pb-2 text-[10px] text-slate-600">Cargas ≥ 0.5 en negrita. h² = comunalidad.</p>
      </div>
    </div>
  )
}

function StatCard({ label, value, highlight = 'default', badge }) {
  const valColor = highlight === 'green' ? 'text-emerald-400' : 'text-slate-200'
  return (
    <div className="card p-3 space-y-1">
      <p className="text-[10px] text-slate-500 uppercase tracking-wider">{label}</p>
      <p className={`stat-value font-bold text-base ${valColor}`}>{value}</p>
      {badge && (
        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium capitalize ${MAGNITUD_STYLE[badge] ?? 'text-slate-400 bg-slate-400/10'}`}>
          {badge}
        </span>
      )}
    </div>
  )
}
