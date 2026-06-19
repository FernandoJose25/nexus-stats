import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2, Sparkles, X, CircleDot, AlertCircle, Info } from 'lucide-react'
import Plot from 'react-plotly.js'
import { useDataStore } from '../store/dataStore'
import { kmeansCluster, siluetaAnalysis } from '../services/pythonApi'
import { interpretarResultado } from '../services/groqService'

const CLUSTER_COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#14B8A6', '#F97316']

export default function Clustering() {
  const navigate = useNavigate()
  const { metadata, getNumericColumns } = useDataStore()

  const [variables, setVariables] = useState([])
  const [k, setK] = useState(3)
  const [estandarizar, setEstandarizar] = useState(true)
  const [modoBuscarK, setModoBuscarK] = useState(false)
  const [kMin, setKMin] = useState(2)
  const [kMax, setKMax] = useState(8)

  const [calculando, setCalculando] = useState(false)
  const [resultado, setResultado] = useState(null)
  const [resultadoSil, setResultadoSil] = useState(null)
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
    if (variables.length < 1) return
    setCalculando(true)
    setError(null)
    setResultado(null)
    setResultadoSil(null)
    try {
      if (modoBuscarK) {
        const resp = await siluetaAnalysis(variables, kMin, kMax, estandarizar)
        setResultadoSil(resp)
      } else {
        const resp = await kmeansCluster(variables, k, estandarizar)
        setResultado(resp)
      }
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
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Clustering</p>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-4">
          <div>
            <p className="text-xs text-slate-500 mb-1.5">Modo</p>
            <div className="flex rounded-lg overflow-hidden border border-[var(--color-border)]">
              {[{ val: false, label: 'K-means' }, { val: true, label: 'Buscar k' }].map(({ val, label }) => (
                <button
                  key={String(val)}
                  onClick={() => setModoBuscarK(val)}
                  className={`flex-1 text-xs py-1.5 transition-colors ${modoBuscarK === val ? 'bg-blue-500/20 text-blue-300' : 'text-slate-400 hover:text-slate-200'}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {!modoBuscarK ? (
            <div>
              <p className="text-xs text-slate-500 mb-1.5">Número de clusters (k)</p>
              <input
                type="number" min="2" max="20" value={k}
                onChange={(e) => setK(parseInt(e.target.value))}
                className="w-full text-xs bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-2 py-1.5 text-slate-300 focus:outline-none focus:border-blue-500"
              />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <p className="text-xs text-slate-500 mb-1.5">k mín.</p>
                <input type="number" min="2" max="15" value={kMin} onChange={(e) => setKMin(parseInt(e.target.value))}
                  className="w-full text-xs bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-2 py-1.5 text-slate-300 focus:outline-none focus:border-blue-500" />
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-1.5">k máx.</p>
                <input type="number" min="2" max="20" value={kMax} onChange={(e) => setKMax(parseInt(e.target.value))}
                  className="w-full text-xs bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-2 py-1.5 text-slate-300 focus:outline-none focus:border-blue-500" />
              </div>
            </div>
          )}

          <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer">
            <input type="checkbox" checked={estandarizar} onChange={(e) => setEstandarizar(e.target.checked)} className="accent-blue-500" />
            Estandarizar variables
          </label>
        </div>

        <div className="p-3 border-t border-[var(--color-border)]">
          <button
            onClick={handleCalcular}
            disabled={variables.length < 1 || calculando}
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
              <p className="font-semibold text-slate-200">Clustering K-means</p>
              <p className="text-slate-500 text-xs mt-0.5">Agrupa observaciones en k grupos homogéneos</p>
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
              <button key={col} onClick={() => toggleVar(col)}
                className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                  variables.includes(col)
                    ? 'bg-blue-500/20 text-blue-300 border-blue-500/40'
                    : 'text-slate-400 border-[var(--color-border)] hover:text-slate-200 hover:border-slate-500'
                }`}>
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

        {!resultado && !resultadoSil && !error && (
          <div className="flex flex-col items-center justify-center h-48 text-center">
            <CircleDot size={36} className="text-slate-700 mb-3" />
            <p className="text-slate-500 text-sm">Selecciona variables y ejecuta el clustering</p>
          </div>
        )}

        {resultadoSil && <ResultadoSilueta resultado={resultadoSil} />}
        {resultado && <ResultadoKmeans resultado={resultado} />}
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

function ResultadoKmeans({ resultado }) {
  const { scatter } = resultado

  const scatterTraces = resultado.clusters.map((c, i) => {
    const mask = scatter.cluster.map((cl, idx) => cl === c.cluster ? idx : -1).filter((idx) => idx >= 0)
    return {
      x: mask.map((idx) => scatter.x[idx]),
      y: scatter.y ? mask.map((idx) => scatter.y[idx]) : null,
      mode: 'markers',
      type: 'scatter',
      name: `Cluster ${c.cluster}`,
      marker: { color: CLUSTER_COLORS[i % CLUSTER_COLORS.length], size: 5, opacity: 0.7 },
    }
  }).filter((t) => t.y)

  return (
    <div className="p-5 space-y-4">
      {/* Métricas globales */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="k" value={resultado.k} />
        <StatCard label="Inercia" value={resultado.inercia} />
        <StatCard label="Silueta" value={resultado.silhouette} badge={resultado.silhouette_interpretacion} />
        <StatCard label="n" value={resultado.n} />
      </div>

      {/* Scatter si hay ≥2 variables */}
      {scatterTraces.length > 0 && (
        <div className="card p-3">
          <p className="text-xs text-slate-500 font-semibold mb-2">Dispersión de clusters ({scatter.var_x} vs {scatter.var_y})</p>
          <Plot
            data={scatterTraces}
            layout={{
              paper_bgcolor: 'transparent', plot_bgcolor: 'transparent',
              height: 300, margin: { l: 40, r: 10, t: 10, b: 40 },
              font: { color: '#94A3B8', size: 11 },
              showlegend: true,
              xaxis: { title: scatter.var_x, gridcolor: '#1E293B', color: '#64748B' },
              yaxis: { title: scatter.var_y, gridcolor: '#1E293B', color: '#64748B' },
              legend: { font: { size: 10 } },
            }}
            config={{ displayModeBar: false, responsive: true }}
            style={{ width: '100%' }}
          />
        </div>
      )}

      {/* Resumen por cluster */}
      <div className="space-y-3">
        {resultado.clusters.map((c, i) => (
          <div key={c.cluster} className="card overflow-auto">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--color-border)]">
              <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: CLUSTER_COLORS[i % CLUSTER_COLORS.length] }} />
              <p className="text-sm font-semibold text-slate-200">Cluster {c.cluster}</p>
              <span className="text-xs text-slate-500 ml-1">{c.n} obs. ({c.pct}%)</span>
            </div>
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[var(--color-border)]" style={{ background: 'var(--color-bg)' }}>
                  <th className="px-4 py-2 text-left text-slate-400">Variable</th>
                  <th className="px-4 py-2 text-right text-slate-400">Centroide</th>
                  <th className="px-4 py-2 text-right text-slate-400">Media</th>
                  <th className="px-4 py-2 text-right text-slate-400">Desv.</th>
                </tr>
              </thead>
              <tbody>
                {resultado.variables.map((v) => (
                  <tr key={v} className="border-b border-[var(--color-border)] last:border-0">
                    <td className="px-4 py-2 text-slate-300">{v}</td>
                    <td className="px-4 py-2 text-right stat-value text-blue-300">{c.centroide[v]}</td>
                    <td className="px-4 py-2 text-right stat-value text-slate-200">{c.estadisticos[v].media}</td>
                    <td className="px-4 py-2 text-right stat-value text-slate-400">{c.estadisticos[v].desv}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </div>
  )
}

function ResultadoSilueta({ resultado }) {
  const trace = {
    x: resultado.resultados.map((r) => r.k),
    y: resultado.resultados.map((r) => r.silhouette),
    type: 'scatter', mode: 'lines+markers',
    marker: { color: '#3B82F6', size: 8 },
    line: { color: '#3B82F6' },
    name: 'Silueta',
  }

  return (
    <div className="p-5 space-y-4">
      <div className="flex items-center gap-2 p-3 bg-blue-500/5 border border-blue-500/20 rounded-lg">
        <Info size={14} className="text-blue-400 flex-shrink-0" />
        <p className="text-xs text-blue-300">
          k óptimo sugerido: <strong>{resultado.k_optimo}</strong> (mayor coeficiente de silueta)
        </p>
      </div>

      <div className="card p-3">
        <p className="text-xs text-slate-500 font-semibold mb-2">Coeficiente de silueta por k</p>
        <Plot
          data={[trace]}
          layout={{
            paper_bgcolor: 'transparent', plot_bgcolor: 'transparent',
            height: 260, margin: { l: 50, r: 20, t: 10, b: 40 },
            font: { color: '#94A3B8', size: 11 },
            xaxis: { title: 'k (número de clusters)', gridcolor: '#1E293B', color: '#64748B', dtick: 1 },
            yaxis: { title: 'Silueta', gridcolor: '#1E293B', color: '#64748B' },
          }}
          config={{ displayModeBar: false, responsive: true }}
          style={{ width: '100%' }}
        />
      </div>

      <div className="card overflow-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-[var(--color-border)]" style={{ background: 'var(--color-bg)' }}>
              <th className="px-4 py-2.5 text-left text-slate-400">k</th>
              <th className="px-4 py-2.5 text-right text-slate-400">Silueta</th>
              <th className="px-4 py-2.5 text-right text-slate-400">Inercia</th>
            </tr>
          </thead>
          <tbody>
            {resultado.resultados.map((r) => (
              <tr key={r.k} className={`border-b border-[var(--color-border)] last:border-0 ${r.k === resultado.k_optimo ? 'bg-blue-500/5' : ''}`}>
                <td className={`px-4 py-2 ${r.k === resultado.k_optimo ? 'text-blue-300 font-semibold' : 'text-slate-300'}`}>
                  {r.k} {r.k === resultado.k_optimo && '★'}
                </td>
                <td className="px-4 py-2 text-right stat-value text-slate-200">{r.silhouette}</td>
                <td className="px-4 py-2 text-right stat-value text-slate-400">{r.inercia}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

const SIL_STYLE = {
  'estructura fuerte':    'text-emerald-400 bg-emerald-400/10',
  'estructura razonable': 'text-sky-400 bg-sky-400/10',
  'estructura débil':     'text-amber-400 bg-amber-400/10',
  'sin estructura':       'text-red-400 bg-red-400/10',
}

function StatCard({ label, value, badge }) {
  return (
    <div className="card p-3 space-y-1">
      <p className="text-[10px] text-slate-500 uppercase tracking-wider">{label}</p>
      <p className="stat-value font-bold text-base text-slate-200">{value}</p>
      {badge && (
        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${SIL_STYLE[badge] ?? 'text-slate-400 bg-slate-400/10'}`}>
          {badge}
        </span>
      )}
    </div>
  )
}
