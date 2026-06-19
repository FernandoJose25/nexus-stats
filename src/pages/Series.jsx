import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2, Sparkles, X, Activity, AlertCircle, CheckCircle2, Info } from 'lucide-react'
import Plot from 'react-plotly.js'
import { useDataStore } from '../store/dataStore'
import { analizarSerie, mediaMovil as mediaMovilApi } from '../services/pythonApi'
import { interpretarResultado } from '../services/groqService'

const PERIODOS = [
  { val: 1,  label: 'Sin estacionalidad' },
  { val: 4,  label: 'Trimestral (4)' },
  { val: 7,  label: 'Semanal (7)' },
  { val: 12, label: 'Mensual (12)' },
  { val: 52, label: 'Semanal anual (52)' },
]

export default function Series() {
  const navigate = useNavigate()
  const { metadata, getNumericColumns, getAllColumns } = useDataStore()

  const [tab, setTab] = useState('analizar')  // 'analizar' | 'media-movil'
  const [varValor, setVarValor] = useState('')
  const [varTiempo, setVarTiempo] = useState('')
  const [periodo, setPeriodo] = useState(1)
  const [lagsAcf, setLagsAcf] = useState(20)

  // Media móvil
  const [ventana, setVentana] = useState(5)
  const [tipoMM, setTipoMM] = useState('simple')
  const [alphaEma, setAlphaEma] = useState(0.3)

  const [calculando, setCalculando] = useState(false)
  const [resultado, setResultado] = useState(null)
  const [error, setError] = useState(null)

  const [interpretacionIA, setInterpretacionIA] = useState(null)
  const [interpretandoIA, setInterpretandoIA] = useState(false)
  const [errorIA, setErrorIA] = useState(null)
  const abortRef = useRef(null)

  const numericCols = (getNumericColumns?.() ?? []).map((c) => c.nombre)
  const allCols = (getAllColumns?.() ?? []).map((c) => c.nombre)

  async function handleCalcular() {
    if (!varValor) return
    setCalculando(true)
    setError(null)
    setResultado(null)
    try {
      let resp
      if (tab === 'analizar') {
        resp = await analizarSerie(varValor, varTiempo || null, periodo, lagsAcf)
      } else {
        resp = await mediaMovilApi(varValor, varTiempo || null, ventana, tipoMM, alphaEma)
      }

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
      const texto = await interpretarResultado(resultado, apiKey, resultado.tipo ?? 'Serie temporal', abortRef.current.signal)
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
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Series temporales</p>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {[
            { id: 'analizar',    label: 'Análisis completo' },
            { id: 'media-movil', label: 'Media móvil' },
          ].map(({ id, label }) => (
            <button key={id} onClick={() => { setTab(id); setResultado(null); setError(null) }}
              className={`w-full text-left px-2.5 py-2 rounded-lg text-xs transition-colors ${
                tab === id ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20' : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
              }`}>
              {label}
            </button>
          ))}
        </div>

        <div className="p-3 border-t border-[var(--color-border)] space-y-3">
          {tab === 'analizar' ? (
            <>
              <div>
                <p className="text-xs text-slate-500 mb-1.5">Estacionalidad</p>
                <select value={periodo} onChange={(e) => setPeriodo(parseInt(e.target.value))}
                  className="w-full text-xs bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-2 py-1.5 text-slate-300 focus:outline-none focus:border-blue-500">
                  {PERIODOS.map((p) => <option key={p.val} value={p.val}>{p.label}</option>)}
                </select>
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-1.5">Lags ACF/PACF</p>
                <input type="number" min="5" max="50" value={lagsAcf} onChange={(e) => setLagsAcf(parseInt(e.target.value))}
                  className="w-full text-xs bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-2 py-1.5 text-slate-300 focus:outline-none focus:border-blue-500" />
              </div>
            </>
          ) : (
            <>
              <div>
                <p className="text-xs text-slate-500 mb-1.5">Tipo</p>
                <select value={tipoMM} onChange={(e) => setTipoMM(e.target.value)}
                  className="w-full text-xs bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-2 py-1.5 text-slate-300 focus:outline-none focus:border-blue-500">
                  <option value="simple">Simple (SMA)</option>
                  <option value="exponencial">Exponencial (EMA)</option>
                </select>
              </div>
              {tipoMM === 'simple' ? (
                <div>
                  <p className="text-xs text-slate-500 mb-1.5">Ventana</p>
                  <input type="number" min="2" value={ventana} onChange={(e) => setVentana(parseInt(e.target.value))}
                    className="w-full text-xs bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-2 py-1.5 text-slate-300 focus:outline-none focus:border-blue-500" />
                </div>
              ) : (
                <div>
                  <p className="text-xs text-slate-500 mb-1.5">Alpha (α)</p>
                  <input type="number" step="0.05" min="0.01" max="0.99" value={alphaEma} onChange={(e) => setAlphaEma(parseFloat(e.target.value))}
                    className="w-full text-xs bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-2 py-1.5 text-slate-300 focus:outline-none focus:border-blue-500" />
                </div>
              )}
            </>
          )}
          <button onClick={handleCalcular} disabled={!varValor || calculando}
            className="btn-primary w-full text-sm flex items-center justify-center gap-2">
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
              <p className="font-semibold text-slate-200">Series Temporales</p>
              <p className="text-slate-500 text-xs mt-0.5">Tendencia, ACF/PACF, descomposición y suavizado</p>
            </div>
            {resultado && resultado.tipo && (
              <button onClick={handleInterpretarIA} disabled={interpretandoIA}
                className="flex items-center gap-1.5 text-xs text-amber-400 hover:text-amber-300 px-3 py-1.5 rounded-lg hover:bg-amber-400/10 border border-amber-400/20 transition-colors">
                {interpretandoIA ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                Interpretar con IA
              </button>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3 max-w-2xl">
            <div>
              <label className="text-xs text-slate-500 block mb-1.5">Variable de valor (numérica)</label>
              <select value={varValor} onChange={(e) => setVarValor(e.target.value)}
                className="w-full text-xs bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-2 py-1.5 text-slate-300 focus:outline-none focus:border-blue-500">
                <option value="">— Seleccionar —</option>
                {numericCols.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-slate-500 block mb-1.5">Variable de tiempo (opcional)</label>
              <select value={varTiempo} onChange={(e) => setVarTiempo(e.target.value)}
                className="w-full text-xs bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-2 py-1.5 text-slate-300 focus:outline-none focus:border-blue-500">
                <option value="">— Índice del dataset —</option>
                {allCols.filter((c) => c !== varValor).map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
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
            <Activity size={36} className="text-slate-700 mb-3" />
            <p className="text-slate-500 text-sm">Selecciona una variable y ejecuta el análisis</p>
          </div>
        )}

        {resultado && resultado.serie && <ResultadoSerie resultado={resultado} />}
        {resultado && resultado.label && <ResultadoMediaMovil resultado={resultado} />}
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

function ResultadoSerie({ resultado }) {
  const { tendencia, serie, acf, pacf, ic_95 } = resultado

  const traceSerie = {
    x: serie.tiempo, y: serie.valor, type: 'scatter', mode: 'lines',
    name: resultado.variable, line: { color: '#3B82F6', width: 1.5 },
  }
  const traceTend = {
    x: serie.tiempo, y: serie.tendencia_lineal, type: 'scatter', mode: 'lines',
    name: 'Tendencia', line: { color: '#F59E0B', width: 1, dash: 'dash' },
  }

  const acfTrace = {
    x: acf.map((a) => a.lag), y: acf.map((a) => a.valor),
    type: 'bar', name: 'ACF', marker: { color: acf.map((a) => a.significativo ? '#3B82F6' : '#334155') },
  }
  const pacfTrace = {
    x: pacf.map((a) => a.lag), y: pacf.map((a) => a.valor),
    type: 'bar', name: 'PACF', marker: { color: pacf.map((a) => a.significativo ? '#10B981' : '#334155') },
  }
  const icLine = { x: [0, acf.length + 1], y: [ic_95, ic_95], type: 'scatter', mode: 'lines', name: 'IC 95%', line: { color: '#EF4444', dash: 'dash', width: 1 }, showlegend: false }
  const icLineNeg = { x: [0, acf.length + 1], y: [-ic_95, -ic_95], type: 'scatter', mode: 'lines', name: '-IC 95%', line: { color: '#EF4444', dash: 'dash', width: 1 }, showlegend: false }

  const plotLayout = {
    paper_bgcolor: 'transparent', plot_bgcolor: 'transparent',
    height: 220, margin: { l: 50, r: 10, t: 10, b: 40 },
    font: { color: '#94A3B8', size: 11 },
    xaxis: { gridcolor: '#1E293B', color: '#64748B' },
    yaxis: { gridcolor: '#1E293B', color: '#64748B' },
    legend: { font: { size: 10 } },
  }

  return (
    <div className="p-5 space-y-4">
      {/* Métricas */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="n" value={resultado.n} />
        <StatCard label="Media" value={resultado.descriptivos.media} />
        <StatCard label="Desv. típica" value={resultado.descriptivos.desv_tipica} />
        <StatCard label="Tendencia" value={tendencia.direccion} highlight={tendencia.significativa ? 'green' : 'default'} />
      </div>

      {/* Tendencia info */}
      <div className={`flex items-start gap-2 text-xs p-3 rounded-lg border ${tendencia.significativa ? 'text-emerald-300 bg-emerald-500/5 border-emerald-500/20' : 'text-slate-400 bg-white/[0.02] border-[var(--color-border)]'}`}>
        {tendencia.significativa ? <CheckCircle2 size={13} className="flex-shrink-0 mt-0.5" /> : <Info size={13} className="flex-shrink-0 mt-0.5" />}
        <span>
          Tendencia lineal: pendiente = {tendencia.pendiente}, R² = {tendencia.r2},
          p {tendencia.p_value < 0.001 ? '< 0.001' : `= ${tendencia.p_value}`}
          {tendencia.significativa ? ' — tendencia estadísticamente significativa' : ' — sin tendencia significativa'}
        </span>
      </div>

      {/* Gráfico serie */}
      <div className="card p-3">
        <p className="text-xs text-slate-500 font-semibold mb-2">Serie temporal</p>
        <Plot data={[traceSerie, traceTend]} layout={plotLayout} config={{ displayModeBar: false, responsive: true }} style={{ width: '100%' }} />
      </div>

      {/* ACF y PACF */}
      <div className="grid grid-cols-2 gap-3">
        <div className="card p-3">
          <p className="text-xs text-slate-500 font-semibold mb-1">ACF</p>
          <Plot data={[acfTrace, icLine, icLineNeg]} layout={{ ...plotLayout, height: 180 }} config={{ displayModeBar: false, responsive: true }} style={{ width: '100%' }} />
        </div>
        <div className="card p-3">
          <p className="text-xs text-slate-500 font-semibold mb-1">PACF</p>
          <Plot data={[pacfTrace, icLine, icLineNeg]} layout={{ ...plotLayout, height: 180 }} config={{ displayModeBar: false, responsive: true }} style={{ width: '100%' }} />
        </div>
      </div>

      {/* Ljung-Box */}
      <div className="flex items-start gap-2 text-xs text-slate-500 p-3 bg-white/[0.02] border border-[var(--color-border)] rounded-lg">
        <Info size={13} className="flex-shrink-0 mt-0.5" />
        <span>
          Ljung-Box (10 lags): Q = {resultado.ljung_box_10.estadistico}, p = {resultado.ljung_box_10.p_value} →{' '}
          {resultado.ljung_box_10.p_value < 0.05
            ? 'autocorrelación significativa — la serie NO es ruido blanco'
            : 'sin autocorrelación significativa (ruido blanco)'}
        </span>
      </div>

      {/* Descomposición */}
      {resultado.descomposicion && (
        <div className="card p-3">
          <p className="text-xs text-slate-500 font-semibold mb-2">Descomposición aditiva (período = {resultado.periodo})</p>
          <Plot
            data={[
              { y: resultado.descomposicion.tendencia, type: 'scatter', mode: 'lines', name: 'Tendencia', line: { color: '#F59E0B', width: 1.5 } },
              { y: resultado.descomposicion.estacional, type: 'scatter', mode: 'lines', name: 'Estacional', line: { color: '#8B5CF6', width: 1 } },
              { y: resultado.descomposicion.residuo, type: 'scatter', mode: 'lines', name: 'Residuo', line: { color: '#64748B', width: 1 } },
            ]}
            layout={{ ...plotLayout, height: 220 }}
            config={{ displayModeBar: false, responsive: true }}
            style={{ width: '100%' }}
          />
        </div>
      )}
    </div>
  )
}

function ResultadoMediaMovil({ resultado }) {
  const { serie } = resultado

  const traces = [
    { x: serie.tiempo, y: serie.valor, type: 'scatter', mode: 'lines', name: resultado.variable, line: { color: '#3B82F6', width: 1 } },
    { x: serie.tiempo, y: serie.mm, type: 'scatter', mode: 'lines', name: resultado.label, line: { color: '#F59E0B', width: 2 } },
  ]

  return (
    <div className="p-5 space-y-4">
      <div className="card p-3">
        <p className="text-xs text-slate-500 font-semibold mb-2">{resultado.label}</p>
        <Plot
          data={traces}
          layout={{
            paper_bgcolor: 'transparent', plot_bgcolor: 'transparent',
            height: 300, margin: { l: 50, r: 10, t: 10, b: 40 },
            font: { color: '#94A3B8', size: 11 },
            xaxis: { gridcolor: '#1E293B', color: '#64748B' },
            yaxis: { gridcolor: '#1E293B', color: '#64748B' },
            legend: { font: { size: 10 } },
          }}
          config={{ displayModeBar: false, responsive: true }}
          style={{ width: '100%' }}
        />
      </div>
    </div>
  )
}

function StatCard({ label, value, highlight = 'default' }) {
  const valColor = highlight === 'green' ? 'text-emerald-400' : 'text-slate-200'
  return (
    <div className="card p-3 space-y-1">
      <p className="text-[10px] text-slate-500 uppercase tracking-wider">{label}</p>
      <p className={`stat-value font-bold text-base ${valColor} capitalize`}>{value}</p>
    </div>
  )
}

