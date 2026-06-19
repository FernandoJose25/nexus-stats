import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import Plot from 'react-plotly.js'
import { Loader2, Sparkles, X, Info, TrendingUp, AlertCircle } from 'lucide-react'
import { useDataStore } from '../store/dataStore'
import { calcularMatrizCorrelaciones, calcularCorrelacionParcial, calcularCorrelacionSemiparcial } from '../services/pythonApi'
import { interpretarResultado } from '../services/groqService'

const METODOS = [
  { id: 'pearson',  label: 'Pearson',  desc: 'Para variables normales y relaciones lineales' },
  { id: 'spearman', label: 'Spearman', desc: 'Robusto a outliers, no asume normalidad' },
  { id: 'kendall',  label: 'Kendall',  desc: 'Mejor para muestras pequeñas' },
]

const MAGNITUD_COLOR = {
  despreciable: 'text-slate-500',
  débil:        'text-slate-400',
  moderada:     'text-amber-400',
  fuerte:       'text-blue-400',
  'muy fuerte': 'text-violet-400',
}

const MAGNITUD_BG = {
  despreciable: 'bg-slate-500/10',
  débil:        'bg-slate-400/10',
  moderada:     'bg-amber-400/10',
  fuerte:       'bg-blue-400/10',
  'muy fuerte': 'bg-violet-400/10',
}

export default function Correlaciones() {
  const navigate = useNavigate()
  const { metadata, getNumericColumns } = useDataStore()

  const [modo, setModo] = useState('matriz')   // 'matriz' | 'parcial' | 'semiparcial'
  const [selectedVars, setSelectedVars] = useState([])
  const [metodo, setMetodo] = useState('pearson')
  const [alpha, setAlpha] = useState(0.05)
  const [ajusteP, setAjusteP] = useState('none')
  // Parcial
  const [varX, setVarX] = useState('')
  const [varY, setVarY] = useState('')
  const [covariables, setCovariables] = useState([])
  const [calculando, setCalculando] = useState(false)
  const [resultado, setResultado] = useState(null)
  const [error, setError] = useState(null)
  const [vistaActiva, setVistaActiva] = useState('heatmap')
  const [interpretacionIA, setInterpretacionIA] = useState(null)
  const [interpretandoIA, setInterpretandoIA] = useState(false)
  const [errorIA, setErrorIA] = useState(null)
  const abortRef = useRef(null)

  const numericCols = getNumericColumns()

  // Recalcular automáticamente cuando cambia método o alpha (si ya hay resultado)
  useEffect(() => {
    if (resultado && selectedVars.length >= 2) {
      handleCalcular()
    }
  }, [metodo, alpha]) // eslint-disable-line react-hooks/exhaustive-deps

  function toggleVar(nombre) {
    setSelectedVars((prev) =>
      prev.includes(nombre) ? prev.filter((v) => v !== nombre) : [...prev, nombre]
    )
  }

  function selectAll() {
    setSelectedVars(numericCols.map((c) => c.nombre))
  }

  async function handleCalcular() {
    setCalculando(true)
    setError(null)
    setResultado(null)
    try {
      let resp
      if (modo === 'matriz') {
        if (selectedVars.length < 2) throw new Error('Selecciona al menos 2 variables')
        resp = await calcularMatrizCorrelaciones(selectedVars, metodo, alpha, ajusteP)
      } else if (modo === 'parcial') {
        if (!varX || !varY || covariables.length === 0) throw new Error('Selecciona X, Y y al menos 1 covariable')
        resp = await calcularCorrelacionParcial(varX, varY, covariables, metodo, alpha)
      } else {
        if (!varX || !varY) throw new Error('Selecciona X e Y')
        resp = await calcularCorrelacionSemiparcial(varX, varY, covariables, [], alpha)
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
    abortRef.current?.abort()
    abortRef.current = new AbortController()

    // Enviar solo los top 5 pares más relevantes para no saturar el prompt
    const resumen = {
      metodo,
      n_variables: resultado.variables.length,
      n_pares_significativos: resultado.n_pares_significativos,
      top_pares: resultado.pares.slice(0, 5).map((p) => ({
        variables: `${p.var_x} × ${p.var_y}`,
        r: p.r, p_value: p.p_value, magnitud: p.magnitud, significativa: p.significativa,
      })),
    }

    try {
      const texto = await interpretarResultado(resumen, apiKey, `Matriz de correlaciones ${metodo}`, abortRef.current.signal)
      setInterpretacionIA(texto)
    } catch (err) {
      if (err.name === 'AbortError') return
      setErrorIA(err.message)
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
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Correlaciones</p>
        </div>

        {/* Variables */}
        <div className="px-3 pt-3 pb-1">
          <div className="flex items-center justify-between mb-1.5">
            <p className="text-xs text-slate-500">Variables ({selectedVars.length})</p>
            <button onClick={selectAll} className="text-xs text-blue-400 hover:text-blue-300">Todas</button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-2 space-y-0.5">
          {numericCols.map((col) => (
            <label key={col.nombre} className="flex items-center gap-2 px-2 py-2 rounded-lg cursor-pointer hover:bg-white/5 transition-colors">
              <input
                type="checkbox"
                checked={selectedVars.includes(col.nombre)}
                onChange={() => toggleVar(col.nombre)}
                className="accent-blue-500 w-3.5 h-3.5"
              />
              <span className="text-sm text-slate-300 truncate">{col.nombre}</span>
            </label>
          ))}
        </div>

        {/* Opciones */}
        <div className="p-3 border-t border-[var(--color-border)] space-y-3">
          <div>
            <p className="text-xs text-slate-500 mb-1.5">Tipo</p>
            <div className="space-y-0.5">
              {[
                { id: 'matriz',      label: 'Matriz de correlaciones' },
                { id: 'parcial',     label: 'Correlación parcial' },
                { id: 'semiparcial', label: 'Correlación semiparcial' },
              ].map((m) => (
                <button key={m.id} onClick={() => { setModo(m.id); setResultado(null); setError(null) }}
                  className={`w-full text-left px-2.5 py-1.5 rounded text-xs transition-colors
                    ${modo === m.id ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20' : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'}`}>
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="text-xs text-slate-500 mb-1.5">Método</p>
            <div className="space-y-0.5">
              {METODOS.filter(m => modo !== 'semiparcial' || m.id !== 'kendall').map((m) => (
                <button key={m.id} onClick={() => setMetodo(m.id)} title={m.desc}
                  className={`w-full text-left px-2.5 py-1.5 rounded text-xs transition-colors
                    ${metodo === m.id ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20' : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'}`}>
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          {modo === 'matriz' && (
            <div>
              <p className="text-xs text-slate-500 mb-1.5">Ajuste p-valores</p>
              <select value={ajusteP} onChange={(e) => setAjusteP(e.target.value)}
                className="w-full text-xs bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-2 py-1.5 text-slate-300 focus:outline-none focus:border-blue-500">
                <option value="none">Sin ajuste</option>
                <option value="bonferroni">Bonferroni</option>
                <option value="holm">Holm-Bonferroni</option>
                <option value="bh">Benjamini-Hochberg (FDR)</option>
              </select>
            </div>
          )}

          <div>
            <p className="text-xs text-slate-500 mb-1.5">Nivel α</p>
            <select value={alpha} onChange={(e) => setAlpha(parseFloat(e.target.value))}
              className="w-full text-xs bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-2 py-1.5 text-slate-300 focus:outline-none focus:border-blue-500">
              <option value={0.05}>0.05 (95%)</option>
              <option value={0.01}>0.01 (99%)</option>
              <option value={0.001}>0.001 (99.9%)</option>
            </select>
          </div>

          <button onClick={handleCalcular} disabled={calculando}
            className="btn-primary w-full text-sm flex items-center justify-center gap-2">
            {calculando ? <><Loader2 size={14} className="animate-spin" /> Calculando...</> : 'Calcular'}
          </button>
        </div>
      </aside>

      {/* Panel central */}
      <div className="flex-1 overflow-y-auto">
        {/* Formulario correlación parcial/semiparcial */}
        {(modo === 'parcial' || modo === 'semiparcial') && (
          <div className="p-5 border-b border-[var(--color-border)]">
            <p className="text-sm font-semibold text-slate-200 mb-3" style={{ paddingRight: 'calc(var(--titlebar-controls-width) + 8px)' }}>
              {modo === 'parcial' ? 'Correlación parcial — controla covariables en ambas variables' : 'Correlación semiparcial — controla covariables solo en X'}
            </p>
            <div className="grid grid-cols-2 gap-3 max-w-2xl mb-3">
              <VarSelectCor label="Variable X" value={varX} onChange={setVarX} options={numericCols.map(c=>c.nombre)} />
              <VarSelectCor label="Variable Y" value={varY} onChange={setVarY} options={numericCols.map(c=>c.nombre).filter(c=>c!==varX)} />
            </div>
            <p className="text-xs text-slate-500 mb-2">
              {modo === 'parcial' ? 'Covariables a controlar (≥1)' : 'Covariables a controlar en X (opcional)'}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {numericCols.filter(c=>c.nombre!==varX && c.nombre!==varY).map(c => (
                <button key={c.nombre} onClick={() => setCovariables(p => p.includes(c.nombre) ? p.filter(x=>x!==c.nombre) : [...p, c.nombre])}
                  className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                    covariables.includes(c.nombre) ? 'bg-blue-500/20 text-blue-300 border-blue-500/40' : 'text-slate-400 border-[var(--color-border)] hover:text-slate-200'
                  }`}>
                  {c.nombre}
                </button>
              ))}
            </div>
          </div>
        )}

        {error && (
          <div className="m-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-xs text-red-400 flex items-center gap-2">
            <AlertCircle size={14} /> {error}
          </div>
        )}

        {!resultado && !error && (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <TrendingUp size={40} className="text-slate-700 mb-4" />
            <p className="text-slate-400 font-medium">Sin resultados</p>
            <p className="text-slate-600 text-sm mt-1 max-w-xs">
              {modo === 'matriz' ? 'Selecciona al menos 2 variables numéricas y haz clic en Calcular' : 'Configura las variables y haz clic en Calcular'}
            </p>
          </div>
        )}

        {resultado && resultado.tipo?.includes('parcial') && (
          <div className="p-5">
            <ResultadoParcial resultado={resultado} />
          </div>
        )}

        {resultado && resultado.tipo?.includes('semiparcial') && (
          <div className="p-5">
            <ResultadoSemiparcial resultado={resultado} />
          </div>
        )}

        {resultado && resultado.metodo && (
          <div className="p-5 space-y-5">
            {/* Header de resultados */}
            <div
              className="flex items-center justify-between"
              style={{ paddingRight: 'calc(var(--titlebar-controls-width) + 8px)' }}
            >
              <div>
                <p className="font-semibold text-slate-200">
                  Matriz de correlaciones — <span className="text-blue-400 capitalize">{resultado.metodo}</span>
                  {resultado.ajuste_p && resultado.ajuste_p !== 'none' && (
                    <span className="ml-2 text-[10px] text-amber-400 bg-amber-400/10 px-1.5 py-0.5 rounded-full">p ajustado: {resultado.ajuste_p}</span>
                  )}
                </p>
                <p className="text-slate-500 text-xs mt-0.5">
                  {resultado.n_pares_significativos} de {resultado.n_pares_total} pares significativos (α = {resultado.alpha})
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleInterpretarIA}
                  disabled={interpretandoIA}
                  className="flex items-center gap-1.5 text-xs text-amber-400 hover:text-amber-300 px-3 py-1.5 rounded-lg hover:bg-amber-400/10 transition-colors border border-amber-400/20"
                >
                  {interpretandoIA ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                  Interpretar con IA
                </button>
                <div className="flex rounded-lg overflow-hidden border border-[var(--color-border)]">
                  {['heatmap', 'tabla'].map((v) => (
                    <button
                      key={v}
                      onClick={() => setVistaActiva(v)}
                      className={`px-3 py-1.5 text-xs transition-colors capitalize
                                  ${vistaActiva === v ? 'bg-blue-500/20 text-blue-400' : 'text-slate-400 hover:bg-white/5'}`}
                    >
                      {v === 'heatmap' ? 'Mapa de calor' : 'Tabla'}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Heatmap */}
            {vistaActiva === 'heatmap' && (
              <div className="card p-2" style={{ height: Math.max(300, resultado.variables.length * 55 + 120) }}>
                <Plot
                  data={resultado.heatmap.data}
                  layout={{ ...resultado.heatmap.layout, autosize: true }}
                  config={{ displayModeBar: 'hover', displaylogo: false, responsive: true }}
                  style={{ width: '100%', height: '100%' }}
                  useResizeHandler
                />
              </div>
            )}

            {/* Tabla de pares */}
            {vistaActiva === 'tabla' && (
              <div className="card overflow-hidden selectable">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-[var(--color-border)]" style={{ background: 'var(--color-bg)' }}>
                      <th className="px-4 py-3 text-left text-slate-400 font-semibold">Variable X</th>
                      <th className="px-4 py-3 text-left text-slate-400 font-semibold">Variable Y</th>
                      <th className="px-4 py-3 text-right text-slate-400 font-semibold">r</th>
                      <th className="px-4 py-3 text-right text-slate-400 font-semibold">r²</th>
                      <th className="px-4 py-3 text-right text-slate-400 font-semibold">p-valor</th>
                      <th className="px-4 py-3 text-right text-slate-400 font-semibold">n</th>
                      <th className="px-4 py-3 text-center text-slate-400 font-semibold">Magnitud</th>
                      <th className="px-4 py-3 text-center text-slate-400 font-semibold">Sig.</th>
                      {resultado.pares[0]?.ic_low != null && (
                        <th className="px-4 py-3 text-center text-slate-400 font-semibold">IC 95%</th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {resultado.pares.map((par, i) => (
                      <tr key={i} className={`border-b border-[var(--color-border)] last:border-0 ${i % 2 === 0 ? 'bg-white/[0.01]' : ''}`}>
                        <td className="px-4 py-2.5 text-slate-300 font-medium">{par.var_x}</td>
                        <td className="px-4 py-2.5 text-slate-300 font-medium">{par.var_y}</td>
                        <td className={`px-4 py-2.5 text-right stat-value font-bold ${par.r > 0 ? 'text-blue-400' : 'text-red-400'}`}>
                          {par.r?.toFixed(4)}
                        </td>
                        <td className="px-4 py-2.5 text-right stat-value text-slate-300">{par.r2?.toFixed(4)}</td>
                        <td className={`px-4 py-2.5 text-right stat-value ${par.significativa ? 'text-emerald-400' : 'text-slate-500'}`}>
                          {par.p_value < 0.001 ? '< 0.001' : par.p_value?.toFixed(4)}
                          {par.p_value < 0.001 ? ' ***' : par.p_value < 0.01 ? ' **' : par.p_value < 0.05 ? ' *' : ''}
                          {par.p_ajustado != null && (
                            <span className="block text-[10px] text-amber-400">adj: {par.p_ajustado < 0.001 ? '<.001' : par.p_ajustado?.toFixed(3)}</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-right stat-value text-slate-400">{par.n}</td>
                        <td className="px-4 py-2.5 text-center">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium capitalize
                                          ${MAGNITUD_COLOR[par.magnitud]} ${MAGNITUD_BG[par.magnitud]}`}>
                            {par.magnitud}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          {par.significativa
                            ? <span className="text-emerald-400 font-bold">✓</span>
                            : <span className="text-slate-600">—</span>
                          }
                        </td>
                        {par.ic_low != null && (
                          <td className="px-4 py-2.5 text-center stat-value text-slate-400">
                            [{par.ic_low?.toFixed(3)}, {par.ic_high?.toFixed(3)}]
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Leyenda */}
            <div className="flex items-start gap-2 text-xs text-slate-600 p-3 bg-white/[0.02] rounded-lg border border-[var(--color-border)]">
              <Info size={13} className="flex-shrink-0 mt-0.5" />
              <span>
                * p &lt; {alpha} &nbsp; ** p &lt; 0.01 &nbsp; *** p &lt; 0.001 &nbsp;·&nbsp;
                Magnitud (Cohen): débil |r| &lt; 0.3, moderada &lt; 0.5, fuerte &lt; 0.7, muy fuerte ≥ 0.7
                {resultado.metodo === 'pearson' && ' · IC 95% via transformación de Fisher'}
                {resultado.ajuste_p && resultado.ajuste_p !== 'none' && ` · p ajustado: ${resultado.ajuste_p}`}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Panel IA */}
      {(interpretacionIA || interpretandoIA || errorIA) && (
        <aside className="w-72 flex-shrink-0 border-l border-[var(--color-border)] flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)]">
            <div className="flex items-center gap-2 text-amber-400">
              <Sparkles size={14} />
              <span className="text-xs font-semibold">Interpretación IA</span>
            </div>
            <button onClick={() => { setInterpretacionIA(null); setErrorIA(null); setInterpretandoIA(false) }} className="btn-ghost p-1">
              <X size={14} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            {interpretandoIA && (
              <div className="flex items-center gap-2 text-slate-400 text-sm">
                <Loader2 size={14} className="animate-spin" /> Analizando...
              </div>
            )}
            {errorIA && <p className="text-red-400 text-xs">{errorIA}</p>}
            {interpretacionIA && <p className="text-slate-300 text-sm leading-relaxed">{interpretacionIA}</p>}
          </div>
        </aside>
      )}
    </div>
  )
}

// ─── Correlación parcial ──────────────────────────────────────────────────────
function ResultadoParcial({ resultado }) {
  const sig = resultado.significativa
  return (
    <div className="space-y-4 max-w-2xl">
      <div className={`flex items-start gap-3 p-4 rounded-xl border ${sig ? 'bg-emerald-500/5 border-emerald-500/20' : 'bg-slate-500/5 border-slate-600/20'}`}>
        {sig ? <span className="text-emerald-400 mt-0.5">✓</span> : <Info size={16} className="text-slate-400 mt-0.5" />}
        <div>
          <p className={`font-semibold text-sm ${sig ? 'text-emerald-300' : 'text-slate-300'}`}>
            {sig ? 'Correlación parcial significativa' : 'Sin correlación parcial significativa'}
          </p>
          <p className="text-slate-500 text-xs mt-0.5">
            {resultado.variable_x} × {resultado.variable_y} · controlando: {resultado.covariables?.join(', ')}
          </p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="r parcial" value={resultado.r_parcial} color={sig ? 'text-emerald-400' : 'text-slate-200'} />
        <StatCard label="r² parcial" value={resultado.r2_parcial} />
        <StatCard label="p-valor" value={resultado.p_value < 0.001 ? '< 0.001' : resultado.p_value} color={sig ? 'text-emerald-400' : 'text-slate-400'} />
        <StatCard label="g.l." value={resultado.gl} />
        <StatCard label="r cero-orden" value={resultado.r_cero_orden} />
        <StatCard label="p (cero-orden)" value={resultado.p_cero_orden < 0.001 ? '< 0.001' : resultado.p_cero_orden} />
        <StatCard label="Diferencia |r|" value={resultado.diferencia_r} />
        <StatCard label="Magnitud parcial" value={resultado.magnitud} />
      </div>
      {resultado.ic_low != null && (
        <div className="flex items-center gap-2 text-xs text-slate-400 p-3 bg-white/[0.02] border border-[var(--color-border)] rounded-lg">
          <Info size={13} /> IC {Math.round((1-resultado.alpha)*100)}% (Fisher): [{resultado.ic_low}, {resultado.ic_high}]
        </div>
      )}
      <div className="flex items-center gap-2 text-xs text-slate-500 p-3 bg-white/[0.02] border border-[var(--color-border)] rounded-lg">
        <Info size={13} />
        La correlación cero-orden fue {resultado.r_cero_orden} · la parcial (controlando {resultado.covariables?.join(', ')}) es {resultado.r_parcial}.
        Diferencia: {resultado.diferencia_r} puntos de |r|.
      </div>
    </div>
  )
}

function ResultadoSemiparcial({ resultado }) {
  const sig = resultado.significativa
  return (
    <div className="space-y-4 max-w-2xl">
      <div className={`flex items-start gap-3 p-4 rounded-xl border ${sig ? 'bg-emerald-500/5 border-emerald-500/20' : 'bg-slate-500/5 border-slate-600/20'}`}>
        {sig ? <span className="text-emerald-400 mt-0.5">✓</span> : <Info size={16} className="text-slate-400 mt-0.5" />}
        <div>
          <p className={`font-semibold text-sm ${sig ? 'text-emerald-300' : 'text-slate-300'}`}>
            {sig ? 'Correlación semiparcial significativa' : 'Sin correlación semiparcial significativa'}
          </p>
          <p className="text-slate-500 text-xs mt-0.5">
            {resultado.variable_x} (controlando {resultado.covariables_x?.join(', ') || 'ninguna'}) × {resultado.variable_y}
          </p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="r semiparcial" value={resultado.r_semiparcial} color={sig ? 'text-emerald-400' : 'text-slate-200'} />
        <StatCard label="r² semiparcial" value={resultado.r2_semiparcial} />
        <StatCard label="p-valor" value={resultado.p_value < 0.001 ? '< 0.001' : resultado.p_value} color={sig ? 'text-emerald-400' : 'text-slate-400'} />
        <StatCard label="g.l." value={resultado.gl} />
      </div>
      <div className="flex items-center gap-2 text-xs text-slate-500 p-3 bg-white/[0.02] border border-[var(--color-border)] rounded-lg">
        <Info size={13} />
        r² semiparcial = {resultado.r2_semiparcial} → {resultado.variable_x} explica de forma única el {(resultado.r2_semiparcial*100).toFixed(1)}% de la varianza en {resultado.variable_y}.
      </div>
    </div>
  )
}

function StatCard({ label, value, color = 'text-slate-200' }) {
  return (
    <div className="card p-3 space-y-1">
      <p className="text-[10px] text-slate-500 uppercase tracking-wider">{label}</p>
      <p className={`stat-value font-bold text-base ${color}`}>{value}</p>
    </div>
  )
}

function VarSelectCor({ label, value, onChange, options }) {
  return (
    <div>
      <label className="text-xs text-slate-500 block mb-1.5">{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="w-full text-xs bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-2 py-1.5 text-slate-300 focus:outline-none focus:border-blue-500">
        <option value="">— Seleccionar —</option>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  )
}
