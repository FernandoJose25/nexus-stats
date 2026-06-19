import { useState } from 'react'
import { TrendingUp, AlertCircle, ChevronDown, ChevronRight, Sparkles, Wand2 } from 'lucide-react'
import Plot from 'react-plotly.js'
import { useDataStore } from '../store/dataStore'
import { arimaAjustar, arimaHoltWinters, arimaAutoIdentificar } from '../services/pythonApi'
import { useAnalysisStore } from '../store/analysisStore'
import { interpretarResultado } from '../services/groqService'

const TABS = [
  { id: 'arima', label: 'ARIMA / SARIMA' },
  { id: 'hw',    label: 'Holt-Winters' },
  { id: 'auto',  label: 'Auto-identificar' },
]

export default function Arima() {
  const { metadata } = useDataStore()
  const { guardarResultado } = useAnalysisStore()
  const numericas = (metadata?.column_info ?? []).filter(c => c.tipo === 'numerico').map(c => c.nombre)

  const [tab, setTab]       = useState('arima')
  const [resultado, setRes] = useState(null)
  const [error, setError]   = useState(null)
  const [cargando, setCarg] = useState(false)
  const [iaTexto, setIa]    = useState('')
  const [iaLoad, setIaL]    = useState(false)

  // ARIMA params
  const [variable, setVar]    = useState('')
  const [p, setP]             = useState(1)
  const [d, setD]             = useState(1)
  const [q, setQ]             = useState(1)
  const [auto, setAuto]       = useState(true)
  const [nPasos, setNPasos]   = useState(12)

  // HW params
  const [hwVar, setHwVar]     = useState('')
  const [hwTipo, setHwTipo]   = useState('aditivo')
  const [hwS, setHwS]         = useState(12)
  const [hwPasos, setHwPasos] = useState(12)

  // Auto
  const [autoVar, setAutoVar] = useState('')

  async function handleCalcular() {
    setError(null); setRes(null); setCarg(true)
    try {
      let res
      if (tab === 'arima') {
        res = await arimaAjustar({ variable, p, d, q, auto, n_pasos: nPasos })
      } else if (tab === 'hw') {
        res = await arimaHoltWinters({ variable: hwVar, tipo: hwTipo, s: hwS, n_pasos: hwPasos })
      } else {
        res = await arimaAutoIdentificar({ variable: autoVar, n_pasos: 1 })
      }
      setRes(res)
      guardarResultado('arima', [variable || hwVar || autoVar], res)
    } catch (e) {
      setError(e.message)
    } finally {
      setCarg(false)
    }
  }

  async function handleIA() {
    const key = localStorage.getItem('groq-api-key')
    if (!key || !resultado) return
    setIaL(true); setIa('')
    try {
      const t = await interpretarResultado(resultado, key, 'Análisis ARIMA / series temporales', null)
      setIa(t)
    } catch (e) { setIa('Error: ' + e.message) }
    finally { setIaL(false) }
  }

  const sinDatos = !metadata
  const canCalc  = !sinDatos && !cargando && (
    tab === 'arima' ? !!variable :
    tab === 'hw'    ? !!hwVar    : !!autoVar
  )

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Panel izquierdo */}
      <aside className="w-64 flex-shrink-0 border-r border-[var(--color-border)] flex flex-col overflow-y-auto"
        style={{ background: 'var(--color-surface)' }}>
        <div className="px-4 pt-4 pb-2 border-b border-[var(--color-border)]">
          <h2 className="text-sm font-semibold text-slate-200">Series temporales</h2>
          <p className="text-[11px] text-slate-500 mt-0.5">ARIMA · Holt-Winters · Predicción</p>
        </div>

        <div className="p-3 flex-1 space-y-3">
          <div className="flex flex-col gap-1">
            {TABS.map(t => (
              <button key={t.id}
                onClick={() => { setTab(t.id); setRes(null); setError(null) }}
                className={`text-left px-3 py-1.5 rounded text-xs transition-colors
                  ${tab === t.id ? 'bg-blue-500/15 text-blue-300' : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'}`}>
                {t.label}
              </button>
            ))}
          </div>

          <hr className="border-[var(--color-border)]" />

          {tab === 'arima' && (
            <div className="space-y-3">
              <FS label="Variable">
                <select value={variable} onChange={e => setVar(e.target.value)} className="input w-full text-xs" size={1}>
                  <option value="">— seleccionar —</option>
                  {numericas.map(v => <option key={v} value={v}>{v}</option>)}
                </select>
              </FS>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={auto} onChange={e => setAuto(e.target.checked)} className="accent-blue-500" />
                <span className="text-xs text-slate-300">Auto-seleccionar p,d,q (AIC)</span>
              </label>
              {!auto && (
                <div className="grid grid-cols-3 gap-2">
                  {[['p','AR',p,setP],['d','I',d,setD],['q','MA',q,setQ]].map(([id,lbl,val,set]) => (
                    <FS key={id} label={`${id} (${lbl})`}>
                      <input type="number" min={0} max={5} value={val} onChange={e => set(Number(e.target.value))} className="input w-full text-xs" />
                    </FS>
                  ))}
                </div>
              )}
              <FS label="Horizonte de predicción">
                <input type="number" min={1} max={120} value={nPasos} onChange={e => setNPasos(Number(e.target.value))} className="input w-full text-xs" />
              </FS>
            </div>
          )}

          {tab === 'hw' && (
            <div className="space-y-3">
              <FS label="Variable">
                <select value={hwVar} onChange={e => setHwVar(e.target.value)} className="input w-full text-xs" size={1}>
                  <option value="">— seleccionar —</option>
                  {numericas.map(v => <option key={v} value={v}>{v}</option>)}
                </select>
              </FS>
              <FS label="Tipo de suavizado">
                <select value={hwTipo} onChange={e => setHwTipo(e.target.value)} className="input w-full text-xs" size={1}>
                  <option value="simple">Simple (SES)</option>
                  <option value="doble">Doble (Holt)</option>
                  <option value="aditivo">Triple aditivo (Holt-Winters)</option>
                  <option value="multiplicativo">Triple multiplicativo</option>
                </select>
              </FS>
              {['aditivo','multiplicativo'].includes(hwTipo) && (
                <FS label="Período estacional (s)">
                  <input type="number" min={2} max={52} value={hwS} onChange={e => setHwS(Number(e.target.value))} className="input w-full text-xs" />
                </FS>
              )}
              <FS label="Pasos de predicción">
                <input type="number" min={1} max={120} value={hwPasos} onChange={e => setHwPasos(Number(e.target.value))} className="input w-full text-xs" />
              </FS>
            </div>
          )}

          {tab === 'auto' && (
            <div className="space-y-3">
              <FS label="Variable">
                <select value={autoVar} onChange={e => setAutoVar(e.target.value)} className="input w-full text-xs" size={1}>
                  <option value="">— seleccionar —</option>
                  {numericas.map(v => <option key={v} value={v}>{v}</option>)}
                </select>
              </FS>
              <p className="text-[11px] text-slate-500">
                Prueba todas las combinaciones p,d,q hasta (3,2,3) y selecciona la de menor AIC.
              </p>
            </div>
          )}

          <button disabled={!canCalc} onClick={handleCalcular} className="btn-primary w-full">
            {cargando ? 'Calculando…' : tab === 'auto' ? 'Identificar modelo' : 'Ajustar y predecir'}
          </button>
        </div>
      </aside>

      {/* Panel central */}
      <main className="flex-1 overflow-y-auto p-5">
        {sinDatos && (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <TrendingUp size={32} className="text-slate-700" />
            <p className="text-slate-500 text-sm">Carga un dataset primero</p>
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 p-3 rounded bg-red-500/10 border border-red-500/20 text-red-400 text-xs mb-4">
            <AlertCircle size={14} className="flex-shrink-0 mt-0.5" /> {error}
          </div>
        )}

        {resultado && tab === 'arima' && <ResultadoArima res={resultado} />}
        {resultado && tab === 'hw'    && <ResultadoHW    res={resultado} />}
        {resultado && tab === 'auto'  && <ResultadoAuto  res={resultado} />}

        {resultado && (
          <div className="mt-4">
            <button onClick={handleIA} disabled={iaLoad}
              className="btn-ghost text-xs flex items-center gap-1.5">
              <Sparkles size={13} /> {iaLoad ? 'Interpretando…' : 'Interpretar con IA'}
            </button>
          </div>
        )}
        {iaTexto && (
          <div className="mt-4 p-4 rounded border border-[var(--color-border)] text-xs text-slate-300 leading-relaxed whitespace-pre-wrap"
            style={{ background: 'var(--color-surface)' }}>
            {iaTexto}
          </div>
        )}
      </main>
    </div>
  )
}

function FS({ label, children }) {
  return (
    <div>
      <label className="block text-[11px] text-slate-500 mb-1">{label}</label>
      {children}
    </div>
  )
}

function StatBox({ label, value, sub, highlight }) {
  return (
    <div className="rounded border border-[var(--color-border)] px-4 py-3" style={{ background: 'var(--color-surface)' }}>
      <p className="text-[11px] text-slate-500">{label}</p>
      <p className={`text-base font-bold mt-0.5 ${highlight ? 'text-blue-300' : 'text-slate-200'}`}>{value}</p>
      {sub && <p className="text-[10px] text-slate-500 mt-0.5">{sub}</p>}
    </div>
  )
}

const LAYOUT_BASE = {
  paper_bgcolor: 'transparent', plot_bgcolor: 'transparent',
  font: { color: '#94a3b8', size: 11 },
  xaxis: { gridcolor: '#334155', zeroline: false },
  yaxis: { gridcolor: '#334155', zeroline: false },
  legend: { orientation: 'h', y: -0.25 },
  margin: { t: 20, l: 50, r: 20, b: 60 },
  height: 300,
}

function ResultadoArima({ res }) {
  const [showDiag, setShowDiag] = useState(false)

  const traza_hist = {
    x: res.serie_historica.indices,
    y: res.serie_historica.valores,
    mode: 'lines', name: 'Histórico',
    line: { color: '#3B82F6', width: 1.5 },
  }
  const traza_pred = {
    x: res.prediccion.indices,
    y: res.prediccion.valores,
    mode: 'lines', name: 'Predicción',
    line: { color: '#F59E0B', width: 2, dash: 'dash' },
  }
  const traza_ic = {
    x: [...res.prediccion.indices, ...res.prediccion.indices.slice().reverse()],
    y: [...res.prediccion.ic_high, ...res.prediccion.ic_low.slice().reverse()],
    fill: 'toself', fillcolor: 'rgba(245,158,11,0.12)',
    line: { width: 0 }, name: 'IC 95%', hoverinfo: 'skip',
  }

  const traza_res = {
    x: res.residuos.valores.map((_, i) => i),
    y: res.residuos.valores,
    mode: 'lines', name: 'Residuos',
    line: { color: '#8B5CF6', width: 1 },
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <p className="text-sm font-semibold text-slate-200">{res.tipo}</p>
        <span className="text-xs text-slate-500">{res.variable} · N={res.n}</span>
        {res.auto && <span className="text-[11px] bg-blue-500/10 text-blue-300 px-2 py-0.5 rounded">Auto-seleccionado</span>}
      </div>

      <div className="grid grid-cols-4 gap-3">
        <StatBox label="Modelo" value={res.tipo} highlight />
        <StatBox label="AIC"    value={res.aic ?? '—'} />
        <StatBox label="BIC"    value={res.bic ?? '—'} />
        <StatBox label="RMSE"   value={res.diagnosticos.rmse} />
      </div>

      {/* Coeficientes */}
      {(res.coeficientes.AR.length > 0 || res.coeficientes.MA.length > 0) && (
        <div className="rounded border border-[var(--color-border)] p-4 text-xs"
          style={{ background: 'var(--color-surface)' }}>
          <p className="font-medium text-slate-300 mb-2">Coeficientes estimados</p>
          <div className="flex gap-6 flex-wrap">
            {res.coeficientes.AR.map((v, i) => (
              <div key={i} className="text-center">
                <p className="text-[10px] text-slate-500">AR({i+1})</p>
                <p className="font-mono text-slate-200">{v}</p>
              </div>
            ))}
            {res.coeficientes.MA.map((v, i) => (
              <div key={i} className="text-center">
                <p className="text-[10px] text-slate-500">MA({i+1})</p>
                <p className="font-mono text-slate-200">{v}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Gráfico principal */}
      <div className="rounded border border-[var(--color-border)] p-2" style={{ background: 'var(--color-surface)' }}>
        <Plot
          data={[traza_hist, traza_pred, traza_ic]}
          layout={{ ...LAYOUT_BASE, yaxis: { ...LAYOUT_BASE.yaxis, title: res.variable } }}
          config={{ responsive: true, displayModeBar: false }}
          style={{ width: '100%' }} useResizeHandler
        />
      </div>

      {/* Tabla de predicciones */}
      <div className="rounded border border-[var(--color-border)] overflow-hidden"
        style={{ background: 'var(--color-surface)' }}>
        <div className="px-4 py-2.5 border-b border-[var(--color-border)]">
          <p className="text-xs font-medium text-slate-300">Predicciones (IC 95%)</p>
        </div>
        <div className="overflow-x-auto">
          <table className="text-xs border-collapse w-full">
            <thead>
              <tr className="text-[11px] text-slate-500 border-b border-[var(--color-border)]">
                <th className="px-3 py-1.5 text-left">Paso</th>
                <th className="px-3 py-1.5 text-right">Predicción</th>
                <th className="px-3 py-1.5 text-right">Límite inf.</th>
                <th className="px-3 py-1.5 text-right">Límite sup.</th>
              </tr>
            </thead>
            <tbody>
              {res.prediccion.valores.map((v, i) => (
                <tr key={i} className="border-b border-[var(--color-border)]/30 hover:bg-white/[0.02]">
                  <td className="px-3 py-1.5 text-slate-400">t+{i+1}</td>
                  <td className="px-3 py-1.5 text-right font-mono font-bold text-amber-300">{v}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-slate-400">{res.prediccion.ic_low[i]}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-slate-400">{res.prediccion.ic_high[i]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Diagnósticos */}
      <div className="rounded border border-[var(--color-border)] overflow-hidden"
        style={{ background: 'var(--color-surface)' }}>
        <button onClick={() => setShowDiag(s => !s)}
          className="w-full flex items-center gap-2 px-4 py-2.5 text-xs font-medium text-slate-300 hover:bg-white/5">
          {showDiag ? <ChevronDown size={13}/> : <ChevronRight size={13}/>}
          Diagnósticos del modelo
        </button>
        {showDiag && (
          <div className="px-4 pb-4 space-y-3 border-t border-[var(--color-border)]">
            <div className="pt-3 grid grid-cols-2 gap-3 text-xs">
              <div>
                <p className="text-slate-500 text-[11px]">ADF (estacionariedad original)</p>
                <p className="font-mono text-slate-200">t={res.diagnosticos.adf_original.statistic} p={res.diagnosticos.adf_original.p_value}</p>
                <p className={res.diagnosticos.adf_original.estacionaria ? 'text-emerald-400' : 'text-amber-400'}>
                  {res.diagnosticos.adf_original.estacionaria ? 'Serie estacionaria' : 'Serie no estacionaria (se aplicó diferenciación)'}
                </p>
              </div>
              <div>
                <p className="text-slate-500 text-[11px]">Ljung-Box (residuos)</p>
                <p className="font-mono text-slate-200">Q={res.diagnosticos.ljung_box.Q_stat} p={res.diagnosticos.ljung_box.p_value}</p>
                <p className={res.diagnosticos.ljung_box.residuos_independientes ? 'text-emerald-400' : 'text-amber-400'}>
                  {res.diagnosticos.ljung_box.residuos_independientes ? 'Residuos independientes ✓' : 'Posible autocorrelación en residuos'}
                </p>
              </div>
            </div>
            <Plot
              data={[traza_res]}
              layout={{ ...LAYOUT_BASE, height: 180, yaxis: { ...LAYOUT_BASE.yaxis, title: 'Residuos' }, margin: { t: 10, l: 45, r: 15, b: 35 } }}
              config={{ responsive: true, displayModeBar: false }}
              style={{ width: '100%' }} useResizeHandler
            />
          </div>
        )}
      </div>
    </div>
  )
}

function ResultadoHW({ res }) {
  const traza_hist = {
    x: res.serie_historica.indices, y: res.serie_historica.valores,
    mode: 'lines', name: 'Histórico', line: { color: '#3B82F6', width: 1.5 },
  }
  const traza_fit = {
    x: res.ajustados.indices, y: res.ajustados.valores,
    mode: 'lines', name: 'Ajustado', line: { color: '#10B981', width: 1.5, dash: 'dot' },
  }
  const traza_pred = {
    x: res.prediccion.indices, y: res.prediccion.valores,
    mode: 'lines', name: 'Predicción', line: { color: '#F59E0B', width: 2, dash: 'dash' },
  }

  return (
    <div className="space-y-4">
      <p className="text-sm font-semibold text-slate-200">{res.tipo} — {res.variable}</p>
      <div className="grid grid-cols-3 gap-3">
        <StatBox label="α (nivel)"    value={res.parametros.alpha} />
        <StatBox label="RMSE"         value={res.metricas.rmse} />
        <StatBox label="MAE"          value={res.metricas.mae} />
      </div>
      <div className="rounded border border-[var(--color-border)] p-2" style={{ background: 'var(--color-surface)' }}>
        <Plot
          data={[traza_hist, traza_fit, traza_pred]}
          layout={{ ...LAYOUT_BASE, yaxis: { ...LAYOUT_BASE.yaxis, title: res.variable } }}
          config={{ responsive: true, displayModeBar: false }}
          style={{ width: '100%' }} useResizeHandler
        />
      </div>
      <div className="text-xs text-slate-400">
        Predicciones: {res.prediccion.valores.slice(0, 6).join(', ')}{res.prediccion.valores.length > 6 ? '…' : ''}
      </div>
    </div>
  )
}

function ResultadoAuto({ res }) {
  return (
    <div className="space-y-4">
      <p className="text-sm font-semibold text-slate-200">Identificación automática de modelo</p>

      <div className="rounded border border-blue-500/30 bg-blue-500/10 p-4">
        <div className="flex items-center gap-2 mb-1">
          <Wand2 size={14} className="text-blue-400" />
          <p className="text-sm font-semibold text-blue-300">Modelo recomendado</p>
        </div>
        <p className="text-xl font-bold text-slate-200">
          ARIMA({res.mejor_modelo.p},{res.mejor_modelo.d},{res.mejor_modelo.q})
        </p>
        <p className="text-xs text-slate-400 mt-1">AIC={res.mejor_modelo.aic} · BIC={res.mejor_modelo.bic}</p>
      </div>

      <div className="rounded border border-[var(--color-border)] p-4 text-xs space-y-2"
        style={{ background: 'var(--color-surface)' }}>
        <p className="font-medium text-slate-300 mb-2">Prueba ADF (estacionariedad)</p>
        <p className="text-slate-400">Estadístico: <span className="font-mono text-slate-200">{res.adf_test.statistic}</span></p>
        <p className="text-slate-400">p-valor: <span className="font-mono text-slate-200">{res.adf_test.p_value}</span></p>
        <p className={res.adf_test.estacionaria ? 'text-emerald-400' : 'text-amber-400'}>
          {res.adf_test.estacionaria ? 'Serie estacionaria (d=0 probablemente adecuado)' : 'Serie no estacionaria — se recomienda diferenciar'}
        </p>
      </div>

      <div className="rounded border border-[var(--color-border)] overflow-hidden"
        style={{ background: 'var(--color-surface)' }}>
        <div className="px-4 py-2.5 border-b border-[var(--color-border)]">
          <p className="text-xs font-medium text-slate-300">Top 5 modelos por AIC</p>
        </div>
        <table className="text-xs border-collapse w-full">
          <thead>
            <tr className="text-[11px] text-slate-500 border-b border-[var(--color-border)]">
              <th className="px-3 py-2 text-left">Modelo</th>
              <th className="px-3 py-2 text-right">AIC</th>
              <th className="px-3 py-2 text-right">BIC</th>
            </tr>
          </thead>
          <tbody>
            {res.top_5.map((m, i) => (
              <tr key={i} className={`border-b border-[var(--color-border)]/30 ${i===0 ? 'bg-blue-500/5' : 'hover:bg-white/[0.02]'}`}>
                <td className={`px-3 py-1.5 font-mono ${i===0 ? 'text-blue-300 font-bold' : 'text-slate-300'}`}>
                  ARIMA({m.p},{m.d},{m.q})
                </td>
                <td className="px-3 py-1.5 text-right font-mono text-slate-200">{m.aic}</td>
                <td className="px-3 py-1.5 text-right font-mono text-slate-400">{m.bic}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-slate-500">
        Usa el modelo recomendado en la pestaña ARIMA para ajustar y obtener predicciones.
      </p>
    </div>
  )
}
