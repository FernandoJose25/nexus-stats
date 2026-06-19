import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2, Sparkles, X, ShieldCheck, AlertCircle, CheckCircle2, Info, TrendingUp, TrendingDown } from 'lucide-react'
import { useDataStore } from '../store/dataStore'
import { cronbachAlpha } from '../services/pythonApi'
import { interpretarResultado } from '../services/groqService'

const ALPHA_STYLE = {
  excelente:    'text-emerald-400 bg-emerald-400/10 border-emerald-400/20',
  bueno:        'text-sky-400 bg-sky-400/10 border-sky-400/20',
  aceptable:    'text-blue-400 bg-blue-400/10 border-blue-400/20',
  cuestionable: 'text-amber-400 bg-amber-400/10 border-amber-400/20',
  deficiente:   'text-orange-400 bg-orange-400/10 border-orange-400/20',
  inaceptable:  'text-red-400 bg-red-400/10 border-red-400/20',
}

export default function Fiabilidad() {
  const navigate = useNavigate()
  const { metadata, getNumericColumns } = useDataStore()

  const [items, setItems] = useState([])
  const [eliminarSiMejora, setEliminarSiMejora] = useState(true)

  const [calculando, setCalculando] = useState(false)
  const [resultado, setResultado] = useState(null)
  const [error, setError] = useState(null)

  const [interpretacionIA, setInterpretacionIA] = useState(null)
  const [interpretandoIA, setInterpretandoIA] = useState(false)
  const [errorIA, setErrorIA] = useState(null)
  const abortRef = useRef(null)

  const numericCols = (getNumericColumns?.() ?? []).map((c) => c.nombre)

  function toggleItem(col) {
    setItems((prev) => prev.includes(col) ? prev.filter((c) => c !== col) : [...prev, col])
  }

  async function handleCalcular() {
    if (items.length < 2) return
    setCalculando(true)
    setError(null)
    setResultado(null)
    try {
      const resp = await cronbachAlpha(items, eliminarSiMejora)
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
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Fiabilidad</p>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          <button className="w-full text-left px-2.5 py-2 rounded-lg text-xs bg-blue-500/10 text-blue-400 border border-blue-500/20">
            Alpha de Cronbach
          </button>
        </div>
        <div className="p-3 border-t border-[var(--color-border)] space-y-3">
          <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer">
            <input type="checkbox" checked={eliminarSiMejora} onChange={(e) => setEliminarSiMejora(e.target.checked)} className="accent-blue-500" />
            Alpha si se elimina el ítem
          </label>
          <button
            onClick={handleCalcular}
            disabled={items.length < 2 || calculando}
            className="btn-primary w-full text-sm flex items-center justify-center gap-2"
          >
            {calculando ? <><Loader2 size={14} className="animate-spin" /> Calculando...</> : 'Calcular'}
          </button>
          {items.length < 2 && <p className="text-[10px] text-slate-600 text-center">Selecciona ≥ 2 ítems</p>}
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
              <p className="font-semibold text-slate-200">Análisis de fiabilidad — Alpha de Cronbach</p>
              <p className="text-slate-500 text-xs mt-0.5">Consistencia interna de una escala o test psicométrico</p>
            </div>
            {resultado && (
              <button onClick={handleInterpretarIA} disabled={interpretandoIA}
                className="flex items-center gap-1.5 text-xs text-amber-400 hover:text-amber-300 px-3 py-1.5 rounded-lg hover:bg-amber-400/10 border border-amber-400/20 transition-colors">
                {interpretandoIA ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                Interpretar con IA
              </button>
            )}
          </div>

          <p className="text-xs text-slate-500 mb-2">Ítems de la escala ({items.length} seleccionados)</p>
          <div className="flex flex-wrap gap-1.5">
            {numericCols.map((col) => (
              <button key={col} onClick={() => toggleItem(col)}
                className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                  items.includes(col)
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

        {!resultado && !error && (
          <div className="flex flex-col items-center justify-center h-48 text-center">
            <ShieldCheck size={36} className="text-slate-700 mb-3" />
            <p className="text-slate-500 text-sm">Selecciona los ítems de tu escala y ejecuta el análisis</p>
          </div>
        )}

        {resultado && <ResultadoCronbach resultado={resultado} />}
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

function ResultadoCronbach({ resultado }) {
  const alpha = resultado.alpha
  const interp = resultado.interpretacion
  const styleClass = ALPHA_STYLE[interp] ?? 'text-slate-400 bg-slate-400/10 border-slate-400/20'
  const bueno = alpha >= 0.7

  return (
    <div className="p-5 space-y-4">
      {/* Veredicto */}
      <div className={`flex items-start gap-3 p-4 rounded-xl border ${bueno ? 'bg-emerald-500/5 border-emerald-500/20' : 'bg-amber-500/5 border-amber-500/20'}`}>
        {bueno
          ? <CheckCircle2 size={20} className="text-emerald-400 flex-shrink-0 mt-0.5" />
          : <AlertCircle size={20} className="text-amber-400 flex-shrink-0 mt-0.5" />}
        <div>
          <p className={`font-semibold text-sm ${bueno ? 'text-emerald-300' : 'text-amber-300'}`}>
            Fiabilidad {interp}
          </p>
          <p className="text-slate-500 text-xs mt-0.5">
            {resultado.k} ítems · {resultado.n} observaciones · escala media = {resultado.escala.media}
          </p>
        </div>
        <span className={`ml-auto text-xs px-2 py-0.5 rounded-full border font-semibold capitalize ${styleClass}`}>
          {interp}
        </span>
      </div>

      {/* Métricas principales */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Alpha de Cronbach" value={alpha} big />
        <StatCard label="Alpha estandarizado" value={resultado.alpha_estandarizado} />
        <StatCard label="Ítems (k)" value={resultado.k} />
        <StatCard label="n" value={resultado.n} />
      </div>

      {/* Estadísticos de la escala */}
      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Media escala" value={resultado.escala.media} />
        <StatCard label="Varianza escala" value={resultado.escala.varianza} />
        <StatCard label="Desv. típica escala" value={resultado.escala.desv_tipica} />
      </div>

      {/* Split-half */}
      {resultado.split_half && (
        <div className="flex items-start gap-2 text-xs text-slate-400 p-3 bg-white/[0.02] border border-[var(--color-border)] rounded-lg">
          <Info size={13} className="flex-shrink-0 mt-0.5" />
          <span>
            Split-half: r entre mitades = {resultado.split_half.r_mitades} →
            Spearman-Brown = <strong className="text-slate-200">{resultado.split_half.spearman_brown}</strong>
          </span>
        </div>
      )}

      {/* Tabla por ítem */}
      <div className="card overflow-auto">
        <p className="text-xs text-slate-500 px-4 pt-3 pb-1 font-semibold">Estadísticos por ítem</p>
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-[var(--color-border)]" style={{ background: 'var(--color-bg)' }}>
              <th className="px-4 py-2.5 text-left text-slate-400">Ítem</th>
              <th className="px-4 py-2.5 text-right text-slate-400">Media</th>
              <th className="px-4 py-2.5 text-right text-slate-400">Desv.</th>
              <th className="px-4 py-2.5 text-right text-slate-400">r ítem-total</th>
              {resultado.items_estadisticos[0]?.alpha_si_se_elimina !== undefined && (
                <th className="px-4 py-2.5 text-right text-slate-400">Alpha si se elimina</th>
              )}
            </tr>
          </thead>
          <tbody>
            {resultado.items_estadisticos.map((item, i) => {
              const mejora = item.alpha_si_se_elimina !== null && item.alpha_si_se_elimina > alpha + 0.01
              return (
                <tr key={i} className={`border-b border-[var(--color-border)] last:border-0 ${mejora ? 'bg-amber-400/5' : ''}`}>
                  <td className="px-4 py-2 text-slate-300 font-medium flex items-center gap-1.5">
                    {item.item}
                    {mejora && <span className="text-[10px] text-amber-400 bg-amber-400/10 px-1.5 py-0.5 rounded-full">mejora si se elimina</span>}
                  </td>
                  <td className="px-4 py-2 text-right stat-value text-slate-300">{item.media}</td>
                  <td className="px-4 py-2 text-right stat-value text-slate-400">{item.desv_tipica}</td>
                  <td className={`px-4 py-2 text-right stat-value ${item.correlacion_item_total >= 0.3 ? 'text-emerald-400' : 'text-amber-400'}`}>
                    {item.correlacion_item_total}
                    <span className="text-slate-600 ml-1">(p={item.correlacion_p < 0.001 ? '<.001' : item.correlacion_p})</span>
                  </td>
                  {item.alpha_si_se_elimina !== undefined && (
                    <td className={`px-4 py-2 text-right stat-value ${mejora ? 'text-amber-400 font-semibold' : 'text-slate-400'}`}>
                      {item.alpha_si_se_elimina ?? '—'}
                      {mejora && <TrendingUp size={11} className="inline ml-1" />}
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
        <p className="px-4 pb-2 text-[10px] text-slate-600">r ítem-total ≥ 0.3 indica buen ítem discriminador.</p>
      </div>

      {/* Guía de interpretación */}
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        {Object.entries(ALPHA_STYLE).map(([k, v]) => (
          <div key={k} className={`text-center p-2 rounded-lg border text-[10px] font-medium capitalize ${v}`}>{k}</div>
        ))}
      </div>
    </div>
  )
}

function StatCard({ label, value, big = false }) {
  return (
    <div className="card p-3 space-y-1">
      <p className="text-[10px] text-slate-500 uppercase tracking-wider">{label}</p>
      <p className={`stat-value font-bold ${big ? 'text-2xl text-blue-400' : 'text-base text-slate-200'}`}>{value}</p>
    </div>
  )
}
