import { useState } from 'react'
import { Heart, AlertCircle, ChevronDown, ChevronRight, Sparkles } from 'lucide-react'
import Plot from 'react-plotly.js'
import { useDataStore } from '../store/dataStore'
import { supervivenciaKM, supervivenciaTablaVida, supervivenciaCox } from '../services/pythonApi'
import { useAnalysisStore } from '../store/analysisStore'
import { interpretarResultado } from '../services/groqService'

const TABS = [
  { id: 'km',   label: 'Kaplan-Meier' },
  { id: 'vida', label: 'Tabla de vida' },
  { id: 'cox',  label: 'Regresión de Cox' },
]

export default function Supervivencia() {
  const { metadata } = useDataStore()
  const { guardarResultado } = useAnalysisStore()
  const cols = metadata?.column_info ?? []
  const numericas  = cols.filter(c => c.tipo === 'numerico').map(c => c.nombre)

  const [tab, setTab]         = useState('km')
  const [resultado, setRes]   = useState(null)
  const [error, setError]     = useState(null)
  const [cargando, setCarg]   = useState(false)
  const [iaTexto, setIa]      = useState('')
  const [iaLoad, setIaLoad]   = useState(false)

  // KM
  const [kmTiempo,  setKmTiempo]  = useState('')
  const [kmEvento,  setKmEvento]  = useState('')
  const [kmGrupo,   setKmGrupo]   = useState('')
  const [kmValor,   setKmValor]   = useState('1')

  // Tabla vida
  const [tvTiempo,  setTvTiempo]  = useState('')
  const [tvEvento,  setTvEvento]  = useState('')
  const [tvInterv,  setTvInterv]  = useState(10)

  // Cox
  const [coxTiempo, setCoxTiempo] = useState('')
  const [coxEvento, setCoxEvento] = useState('')
  const [coxCovs,   setCoxCovs]   = useState([])

  function toggleCov(v) {
    setCoxCovs(p => p.includes(v) ? p.filter(x => x !== v) : [...p, v])
  }

  async function handleCalcular() {
    setError(null); setRes(null); setCarg(true)
    try {
      let res
      if (tab === 'km') {
        res = await supervivenciaKM({
          variable_tiempo: kmTiempo, variable_evento: kmEvento,
          variable_grupo: kmGrupo || null, valor_evento: Number(kmValor),
        })
      } else if (tab === 'vida') {
        res = await supervivenciaTablaVida({
          variable_tiempo: tvTiempo, variable_evento: tvEvento, n_intervalos: tvInterv,
        })
      } else {
        res = await supervivenciaCox({
          variable_tiempo: coxTiempo, variable_evento: coxEvento,
          covariables: coxCovs,
        })
      }
      setRes(res)
      guardarResultado('supervivencia', [], res)
    } catch (e) {
      setError(e.message)
    } finally {
      setCarg(false)
    }
  }

  async function handleIA() {
    const key = localStorage.getItem('groq-api-key')
    if (!key || !resultado) return
    setIaLoad(true); setIa('')
    try {
      const t = await interpretarResultado(resultado, key, 'Análisis de supervivencia', null)
      setIa(t)
    } catch (e) { setIa('Error: ' + e.message) }
    finally { setIaLoad(false) }
  }

  const sinDatos = !metadata
  const canCalc  = !sinDatos && !cargando && (
    tab === 'km'   ? (kmTiempo && kmEvento) :
    tab === 'vida' ? (tvTiempo && tvEvento) :
                     (coxTiempo && coxEvento && coxCovs.length > 0)
  )

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Panel izquierdo */}
      <aside className="w-64 flex-shrink-0 border-r border-[var(--color-border)] flex flex-col overflow-y-auto"
        style={{ background: 'var(--color-surface)' }}>
        <div className="px-4 pt-4 pb-2 border-b border-[var(--color-border)]">
          <h2 className="text-sm font-semibold text-slate-200">Supervivencia</h2>
          <p className="text-[11px] text-slate-500 mt-0.5">Equivale a Survival en SPSS</p>
        </div>

        {/* Tabs de análisis */}
        <div className="p-3 space-y-3 flex-1">
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

          {tab === 'km' && (
            <KmForm cols={cols} numericas={numericas}
              tiempo={kmTiempo} setTiempo={setKmTiempo}
              evento={kmEvento} setEvento={setKmEvento}
              grupo={kmGrupo}   setGrupo={setKmGrupo}
              valor={kmValor}   setValor={setKmValor}
            />
          )}
          {tab === 'vida' && (
            <TvForm numericas={numericas}
              tiempo={tvTiempo} setTiempo={setTvTiempo}
              evento={tvEvento} setEvento={setTvEvento}
              interv={tvInterv} setInterv={setTvInterv}
            />
          )}
          {tab === 'cox' && (
            <CoxForm numericas={numericas}
              tiempo={coxTiempo} setTiempo={setCoxTiempo}
              evento={coxEvento} setEvento={setCoxEvento}
              covs={coxCovs} toggleCov={toggleCov}
            />
          )}

          <button disabled={!canCalc} onClick={handleCalcular} className="btn-primary w-full">
            {cargando ? 'Calculando…' : 'Calcular'}
          </button>
        </div>
      </aside>

      {/* Panel central */}
      <main className="flex-1 overflow-y-auto p-5">
        {sinDatos && <Empty />}

        {error && (
          <div className="flex items-start gap-2 p-3 rounded bg-red-500/10 border border-red-500/20 text-red-400 text-xs mb-4">
            <AlertCircle size={14} className="flex-shrink-0 mt-0.5" /> {error}
          </div>
        )}

        {resultado && tab === 'km'   && <ResultadoKM    res={resultado} />}
        {resultado && tab === 'vida' && <ResultadoTablaVida res={resultado} />}
        {resultado && tab === 'cox'  && <ResultadoCox   res={resultado} />}

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

/* ── Formularios ─────────────────────────────────────────────────────────── */

function FS({ label, children }) {
  return (
    <div>
      <label className="block text-[11px] text-slate-500 mb-1">{label}</label>
      {children}
    </div>
  )
}

function KmForm({ cols, numericas, tiempo, setTiempo, evento, setEvento, grupo, setGrupo, valor, setValor }) {
  return (
    <div className="space-y-3">
      <FS label="Variable de tiempo">
        <select value={tiempo} onChange={e => setTiempo(e.target.value)} className="input w-full text-xs" size={1}>
          <option value="">— seleccionar —</option>
          {numericas.map(v => <option key={v} value={v}>{v}</option>)}
        </select>
      </FS>
      <FS label="Variable de estado (evento)">
        <select value={evento} onChange={e => setEvento(e.target.value)} className="input w-full text-xs" size={1}>
          <option value="">— seleccionar —</option>
          {cols.map(c => <option key={c.nombre} value={c.nombre}>{c.nombre}</option>)}
        </select>
      </FS>
      <FS label="Valor que indica evento">
        <input value={valor} onChange={e => setValor(e.target.value)} className="input w-full text-xs" placeholder="1" />
      </FS>
      <FS label="Variable de grupo (opcional)">
        <select value={grupo} onChange={e => setGrupo(e.target.value)} className="input w-full text-xs" size={1}>
          <option value="">— ninguna —</option>
          {cols.map(c => <option key={c.nombre} value={c.nombre}>{c.nombre}</option>)}
        </select>
      </FS>
    </div>
  )
}

function TvForm({ numericas, tiempo, setTiempo, evento, setEvento, interv, setInterv }) {
  return (
    <div className="space-y-3">
      <FS label="Variable de tiempo">
        <select value={tiempo} onChange={e => setTiempo(e.target.value)} className="input w-full text-xs" size={1}>
          <option value="">— seleccionar —</option>
          {numericas.map(v => <option key={v} value={v}>{v}</option>)}
        </select>
      </FS>
      <FS label="Variable de estado">
        <select value={evento} onChange={e => setEvento(e.target.value)} className="input w-full text-xs" size={1}>
          <option value="">— seleccionar —</option>
          {numericas.map(v => <option key={v} value={v}>{v}</option>)}
        </select>
      </FS>
      <FS label="Número de intervalos">
        <input type="number" min={3} max={50} value={interv} onChange={e => setInterv(Number(e.target.value))} className="input w-full text-xs" />
      </FS>
    </div>
  )
}

function CoxForm({ numericas, tiempo, setTiempo, evento, setEvento, covs, toggleCov }) {
  return (
    <div className="space-y-3">
      <FS label="Variable de tiempo">
        <select value={tiempo} onChange={e => setTiempo(e.target.value)} className="input w-full text-xs" size={1}>
          <option value="">— seleccionar —</option>
          {numericas.map(v => <option key={v} value={v}>{v}</option>)}
        </select>
      </FS>
      <FS label="Variable de estado">
        <select value={evento} onChange={e => setEvento(e.target.value)} className="input w-full text-xs" size={1}>
          <option value="">— seleccionar —</option>
          {numericas.map(v => <option key={v} value={v}>{v}</option>)}
        </select>
      </FS>
      <FS label="Covariables">
        <div className="space-y-1.5 mt-1">
          {numericas.map(v => (
            <label key={v} className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={covs.includes(v)} onChange={() => toggleCov(v)} className="accent-blue-500" />
              <span className="text-xs text-slate-300">{v}</span>
            </label>
          ))}
        </div>
      </FS>
    </div>
  )
}

/* ── Resultados ──────────────────────────────────────────────────────────── */

function Empty() {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-3">
      <Heart size={32} className="text-slate-700" />
      <p className="text-slate-500 text-sm">Carga un dataset primero</p>
    </div>
  )
}

function StatBox({ label, value, sub }) {
  return (
    <div className="rounded border border-[var(--color-border)] px-4 py-3" style={{ background: 'var(--color-surface)' }}>
      <p className="text-[11px] text-slate-500">{label}</p>
      <p className="text-lg font-bold text-slate-200 mt-0.5">{value}</p>
      {sub && <p className="text-[10px] text-slate-500 mt-0.5">{sub}</p>}
    </div>
  )
}

function ResultadoKM({ res }) {
  const hayGrupos = !!res.variable_grupo

  // Construir trazas Plotly
  const trazas = []
  if (hayGrupos) {
    const COLORES = ['#3B82F6','#F59E0B','#10B981','#EF4444','#8B5CF6','#EC4899']
    Object.entries(res.curvas).forEach(([grupo, datos], i) => {
      const color = COLORES[i % COLORES.length]
      const ts = [0, ...datos.curva.map(p => p.t)]
      const Ss = [1, ...datos.curva.map(p => p.S)]
      trazas.push({
        x: ts, y: Ss, mode: 'lines', name: grupo,
        line: { color, shape: 'hv', width: 2 },
      })
    })
  } else {
    const ts = [0, ...res.curva.map(p => p.t)]
    const Ss = [1, ...res.curva.map(p => p.S)]
    const lo = [1, ...res.curva.map(p => p.IC_low)]
    const hi = [1, ...res.curva.map(p => p.IC_high)]
    trazas.push({ x: ts, y: Ss, mode: 'lines', name: 'Supervivencia', line: { color: '#3B82F6', shape: 'hv', width: 2 } })
    trazas.push({ x: [...ts, ...ts.slice().reverse()], y: [...hi, ...lo.slice().reverse()], fill: 'toself', fillcolor: 'rgba(59,130,246,0.12)', line: { width: 0 }, name: 'IC 95%', hoverinfo: 'skip' })
  }

  const layout = {
    paper_bgcolor: 'transparent', plot_bgcolor: 'transparent',
    font: { color: '#94a3b8', size: 11 },
    xaxis: { title: res.variable_tiempo, gridcolor: '#334155', zeroline: false },
    yaxis: { title: 'Probabilidad de supervivencia', range: [0, 1.05], gridcolor: '#334155', zeroline: false },
    legend: { orientation: 'h', y: -0.2 },
    margin: { t: 20, l: 50, r: 20, b: 60 },
    height: 340,
  }

  return (
    <div className="space-y-4">
      <p className="text-sm font-semibold text-slate-200">
        Kaplan-Meier — {res.variable_tiempo}
        {hayGrupos && <span className="text-slate-500 ml-2 text-xs">por {res.variable_grupo}</span>}
      </p>

      {/* Estadísticos resumen */}
      {!hayGrupos ? (
        <div className="grid grid-cols-3 gap-3">
          <StatBox label="N total"      value={res.n} />
          <StatBox label="Eventos"      value={res.n_eventos} sub={`${res.n_censurados} censurados`} />
          <StatBox label="Mediana superv." value={res.mediana_supervivencia ?? 'No alcanzada'} />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {Object.entries(res.curvas).map(([g, d]) => (
            <StatBox key={g} label={`Grupo: ${g}`}
              value={`Med: ${d.mediana_supervivencia ?? 'N/A'}`}
              sub={`N=${d.n} | Eventos=${d.n_eventos} | Cens.=${d.n_censurados}`} />
          ))}
        </div>
      )}

      {/* Gráfico KM */}
      <div className="rounded border border-[var(--color-border)] p-2" style={{ background: 'var(--color-surface)' }}>
        <Plot data={trazas} layout={layout} config={{ responsive: true, displayModeBar: false }}
          style={{ width: '100%' }} useResizeHandler />
      </div>

      {/* Log-rank */}
      {hayGrupos && res.logrank && (
        <div className="rounded border border-[var(--color-border)] p-4 text-xs space-y-2"
          style={{ background: 'var(--color-surface)' }}>
          <p className="font-medium text-slate-300">Prueba log-rank (Mantel-Haenszel)</p>
          <div className="flex gap-6">
            <span className="text-slate-400">Chi² <span className="text-slate-200 font-mono">{res.logrank.chi2}</span></span>
            <span className="text-slate-400">gl <span className="text-slate-200 font-mono">{res.logrank.gl}</span></span>
            <span className="text-slate-400">p <span className={`font-mono font-bold ${res.logrank.significativo ? 'text-emerald-400' : 'text-slate-200'}`}>{res.logrank.p_value.toFixed(4)}</span></span>
          </div>
          <table className="w-full border-collapse mt-2">
            <thead>
              <tr className="text-[11px] text-slate-500 border-b border-[var(--color-border)]">
                <th className="text-left pb-1">Grupo</th>
                <th className="text-right pb-1">Observados</th>
                <th className="text-right pb-1">Esperados</th>
              </tr>
            </thead>
            <tbody>
              {res.logrank.grupos_detalle.map(g => (
                <tr key={g.grupo} className="border-b border-[var(--color-border)]/30">
                  <td className="py-1 text-slate-300">{g.grupo}</td>
                  <td className="py-1 text-right font-mono text-slate-200">{g.observados}</td>
                  <td className="py-1 text-right font-mono text-slate-200">{g.esperados}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function ResultadoTablaVida({ res }) {
  return (
    <div className="space-y-4">
      <p className="text-sm font-semibold text-slate-200">
        Tabla de vida actuarial
        <span className="text-slate-500 text-xs ml-2">N={res.n_total} | Eventos={res.n_eventos_total}</span>
      </p>
      <div className="overflow-x-auto">
        <table className="text-xs border-collapse w-full">
          <thead>
            <tr className="text-[11px] text-slate-500 border-b border-[var(--color-border)]">
              {['Intervalo','N entrante','Eventos','Censurados','N efectivo','q(t)','S inicio','S fin','h(t)'].map(h => (
                <th key={h} className="px-3 py-2 text-right first:text-left">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {res.tabla.map((fila, i) => (
              <tr key={i} className="border-b border-[var(--color-border)]/40 hover:bg-white/[0.02]">
                <td className="px-3 py-1.5 text-slate-300">[{fila.t_inicio.toFixed(1)}, {fila.t_fin.toFixed(1)})</td>
                <td className="px-3 py-1.5 text-right font-mono text-slate-200">{fila.n_entrante}</td>
                <td className="px-3 py-1.5 text-right font-mono text-slate-200">{fila.n_eventos}</td>
                <td className="px-3 py-1.5 text-right font-mono text-slate-400">{fila.n_censurados}</td>
                <td className="px-3 py-1.5 text-right font-mono text-slate-300">{fila.n_efectivo}</td>
                <td className="px-3 py-1.5 text-right font-mono text-slate-200">{fila.q_i.toFixed(4)}</td>
                <td className="px-3 py-1.5 text-right font-mono text-blue-300">{fila.S_inicio.toFixed(4)}</td>
                <td className="px-3 py-1.5 text-right font-mono text-blue-300">{fila.S_fin.toFixed(4)}</td>
                <td className="px-3 py-1.5 text-right font-mono text-slate-400">{fila.h_i.toFixed(4)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ResultadoCox({ res }) {
  return (
    <div className="space-y-4">
      <p className="text-sm font-semibold text-slate-200">
        Regresión de Cox
        <span className="text-slate-500 text-xs ml-2">N={res.n} | Eventos={res.n_eventos}</span>
      </p>

      <div className="grid grid-cols-3 gap-3">
        <StatBox label="Índice C de Harrell" value={res.c_index} sub={res.interpretacion_c} />
        <StatBox label="LR Chi²" value={`${res.lr_chi2} (gl=${res.lr_gl})`} />
        <StatBox label="p-valor global" value={res.lr_p_value.toFixed(4)} sub={res.lr_significativo ? 'Significativo ✓' : 'No significativo'} />
      </div>

      <div className="overflow-x-auto rounded border border-[var(--color-border)]" style={{ background: 'var(--color-surface)' }}>
        <table className="text-xs border-collapse w-full">
          <thead>
            <tr className="text-[11px] text-slate-500 border-b border-[var(--color-border)]">
              {['Covariable','B','SE','Wald','p-valor','HR','IC 95% HR'].map(h => (
                <th key={h} className="px-3 py-2 text-right first:text-left">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {res.coeficientes.map((c, i) => (
              <tr key={i} className="border-b border-[var(--color-border)]/40 hover:bg-white/[0.02]">
                <td className="px-3 py-2 text-slate-300 font-medium">{c.covariable}</td>
                <td className="px-3 py-2 text-right font-mono text-slate-200">{c.b.toFixed(4)}</td>
                <td className="px-3 py-2 text-right font-mono text-slate-400">{c.se.toFixed(4)}</td>
                <td className="px-3 py-2 text-right font-mono text-slate-200">{c.wald.toFixed(4)}</td>
                <td className={`px-3 py-2 text-right font-mono font-bold ${c.significativo ? 'text-emerald-400' : 'text-slate-300'}`}>
                  {c.p_value.toFixed(4)}
                </td>
                <td className="px-3 py-2 text-right font-mono text-amber-300 font-bold">{c.HR.toFixed(4)}</td>
                <td className="px-3 py-2 text-right font-mono text-slate-400">
                  [{c.HR_IC_low.toFixed(3)}, {c.HR_IC_high.toFixed(3)}]
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-slate-500">HR &gt; 1 = mayor riesgo · HR &lt; 1 = factor protector · IC que no cruza 1.0 = significativo</p>
    </div>
  )
}
