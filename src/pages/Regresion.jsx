import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Loader2, Sparkles, X, TrendingUp, AlertCircle, CheckCircle2, Info, GitMerge,
} from 'lucide-react'
import Plot from 'react-plotly.js'
import { useDataStore } from '../store/dataStore'
import {
  regresionLineal, regresionLogistica, regresionStepwise, regresionMultinomial,
  regresionOrdinal, regresionPoisson, regresionNoLineal, regresionPonderada,
} from '../services/pythonApi'
import { interpretarResultado } from '../services/groqService'

const TIPOS = [
  { id: 'lineal',       label: 'Lineal (OLS)',           desc: 'VIF, Cook\'s D, leverage, 4 gráficos diagnóstico', grupo: 'lineal' },
  { id: 'stepwise',     label: 'Por pasos',              desc: 'Forward / backward / bidireccional con AIC', grupo: 'lineal' },
  { id: 'ponderada',    label: 'Ponderada (WLS)',        desc: 'Mínimos cuadrados ponderados por una variable de pesos', grupo: 'lineal' },
  { id: 'no-lineal',    label: 'No lineal',              desc: 'Ajuste de curvas: exponencial, potencia, log, cuadrática, sigmoide', grupo: 'lineal' },
  { id: 'logistica',    label: 'Logística binaria',      desc: 'OR, Nagelkerke R², matriz de confusión', grupo: 'logistica' },
  { id: 'multinomial',  label: 'Multinomial',            desc: '3+ categorías — OR por clase vs. referencia', grupo: 'logistica' },
  { id: 'ordinal',      label: 'Ordinal',                desc: 'Odds proporcionales — variable respuesta ordenada', grupo: 'logistica' },
  { id: 'poisson',      label: 'Poisson (GLM)',          desc: 'Datos de conteo — IRR (Incidence Rate Ratio)', grupo: 'glm' },
]

const GRUPOS = {
  lineal:   'Regresión lineal',
  logistica:'Regresión logística',
  glm:      'Modelos GLM',
}

const MAGNITUD_STYLE = {
  despreciable: 'text-slate-500 bg-slate-500/10',
  pequeño:      'text-sky-400 bg-sky-400/10',
  mediano:      'text-amber-400 bg-amber-400/10',
  grande:       'text-violet-400 bg-violet-400/10',
}

export default function Regresion() {
  const navigate = useNavigate()
  const { metadata, getNumericColumns, getAllColumns } = useDataStore()

  const [tipo, setTipo] = useState('lineal')
  const [dependiente, setDependiente] = useState('')
  const [independientes, setIndependientes] = useState([])
  const [alpha, setAlpha] = useState(0.05)
  const [stepMetodo, setStepMetodo] = useState('both')
  const [stepPentrada, setStepPentrada] = useState(0.05)
  const [stepPsalida, setStepPsalida] = useState(0.10)
  const [noLinealModelo, setNoLinealModelo] = useState('auto')
  const [varPesos, setVarPesos] = useState('')
  const [varIndepNoLineal, setVarIndepNoLineal] = useState('')

  const [calculando, setCalculando] = useState(false)
  const [resultado, setResultado] = useState(null)
  const [error, setError] = useState(null)

  const [interpretacionIA, setInterpretacionIA] = useState(null)
  const [interpretandoIA, setInterpretandoIA] = useState(false)
  const [errorIA, setErrorIA] = useState(null)
  const abortRef = useRef(null)

  const numericCols = (getNumericColumns?.() ?? []).map((c) => c.nombre)
  const allCols = (getAllColumns?.() ?? []).map((c) => c.nombre)

  const depOpts = (['lineal','stepwise','ponderada','no-lineal','poisson'].includes(tipo)) ? numericCols : allCols
  const indOpts = numericCols.filter((c) => c !== dependiente)

  function toggleIndep(col) {
    setIndependientes((prev) =>
      prev.includes(col) ? prev.filter((c) => c !== col) : [...prev, col]
    )
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
      let resp
      switch (tipo) {
        case 'lineal':      resp = await regresionLineal(dependiente, independientes, alpha); break
        case 'stepwise':    resp = await regresionStepwise(dependiente, independientes, stepMetodo, stepPentrada, stepPsalida, alpha); break
        case 'logistica':   resp = await regresionLogistica(dependiente, independientes, alpha); break
        case 'multinomial': resp = await regresionMultinomial(dependiente, independientes, alpha); break
        case 'ordinal':     resp = await regresionOrdinal(dependiente, independientes, alpha); break
        case 'poisson':     resp = await regresionPoisson(dependiente, independientes, alpha); break
        case 'no-lineal':   resp = await regresionNoLineal(dependiente, varIndepNoLineal || independientes[0], noLinealModelo, alpha); break
        case 'ponderada':   resp = await regresionPonderada(dependiente, independientes, varPesos, alpha); break
        default:            resp = await regresionLineal(dependiente, independientes, alpha)
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

  const canCalc = dependiente && (
    tipo === 'no-lineal' ? !!varIndepNoLineal :
    tipo === 'ponderada' ? (independientes.length > 0 && !!varPesos) :
    independientes.length > 0
  )

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Sidebar */}
      <aside className="w-56 flex-shrink-0 border-r border-[var(--color-border)] flex flex-col overflow-hidden">
        <div className="px-4 py-3 border-b border-[var(--color-border)]">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Regresión</p>
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {Object.entries(GRUPOS).map(([gId, gLabel]) => (
            <div key={gId}>
              <p className="text-[10px] font-semibold text-slate-600 uppercase tracking-wider px-2 pt-2 pb-1">{gLabel}</p>
              {TIPOS.filter((t) => t.grupo === gId).map((t) => (
                <button key={t.id} onClick={() => handleTipo(t.id)} title={t.desc}
                  className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs transition-colors
                    ${tipo === t.id ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20' : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'}`}>
                  {t.label}
                </button>
              ))}
            </div>
          ))}
        </div>

        <div className="p-3 border-t border-[var(--color-border)] space-y-3">
          {tipo === 'stepwise' && (
            <>
              <div>
                <p className="text-xs text-slate-500 mb-1.5">Método</p>
                <select value={stepMetodo} onChange={(e) => setStepMetodo(e.target.value)}
                  className="w-full text-xs bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-2 py-1.5 text-slate-300 focus:outline-none focus:border-blue-500">
                  <option value="both">Bidireccional</option>
                  <option value="forward">Forward</option>
                  <option value="backward">Backward</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div><p className="text-[10px] text-slate-500 mb-1">p entrada</p>
                  <input type="number" step="0.01" min="0.01" max="0.2" value={stepPentrada} onChange={(e) => setStepPentrada(parseFloat(e.target.value))}
                    className="w-full text-xs bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-2 py-1.5 text-slate-300 focus:outline-none focus:border-blue-500" /></div>
                <div><p className="text-[10px] text-slate-500 mb-1">p salida</p>
                  <input type="number" step="0.01" min="0.01" max="0.3" value={stepPsalida} onChange={(e) => setStepPsalida(parseFloat(e.target.value))}
                    className="w-full text-xs bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-2 py-1.5 text-slate-300 focus:outline-none focus:border-blue-500" /></div>
              </div>
            </>
          )}
          {tipo === 'no-lineal' && (
            <div>
              <p className="text-xs text-slate-500 mb-1.5">Modelo</p>
              <select value={noLinealModelo} onChange={(e) => setNoLinealModelo(e.target.value)}
                className="w-full text-xs bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-2 py-1.5 text-slate-300 focus:outline-none focus:border-blue-500">
                <option value="auto">Auto (mejor AIC)</option>
                <option value="exponencial">Exponencial: a·eᵇˣ</option>
                <option value="potencia">Potencia: a·xᵇ</option>
                <option value="logaritmica">Logarítmica: a·ln(x)+b</option>
                <option value="cuadratica">Cuadrática: ax²+bx+c</option>
                <option value="sigmoide">Sigmoide (Gompertz)</option>
              </select>
            </div>
          )}
          <div>
            <p className="text-xs text-slate-500 mb-1.5">Nivel α</p>
            <select
              value={alpha}
              onChange={(e) => setAlpha(parseFloat(e.target.value))}
              className="w-full text-xs bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-2 py-1.5 text-slate-300 focus:outline-none focus:border-blue-500"
            >
              <option value={0.05}>0.05 (95%)</option>
              <option value={0.01}>0.01 (99%)</option>
              <option value={0.001}>0.001 (99.9%)</option>
            </select>
          </div>
          <button
            onClick={handleCalcular}
            disabled={!canCalc || calculando}
            className="btn-primary w-full text-sm flex items-center justify-center gap-2"
          >
            {calculando
              ? <><Loader2 size={14} className="animate-spin" /> Calculando...</>
              : 'Calcular'}
          </button>
        </div>
      </aside>

      {/* Panel central */}
      <div className="flex-1 overflow-y-auto">
        {/* Formulario */}
        <div className="p-5 border-b border-[var(--color-border)]">
          <div
            className="flex items-start justify-between mb-4"
            style={{ paddingRight: 'calc(var(--titlebar-controls-width) + 8px)' }}
          >
            <div>
              <p className="font-semibold text-slate-200">{TIPOS.find((t) => t.id === tipo).label}</p>
              <p className="text-slate-500 text-xs mt-0.5">{TIPOS.find((t) => t.id === tipo).desc}</p>
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

          <div className="grid grid-cols-2 gap-4 max-w-2xl">
            <div>
              <label className="text-xs text-slate-500 block mb-1.5">Variable dependiente (Y)</label>
              <select value={dependiente} onChange={(e) => { setDependiente(e.target.value); setIndependientes([]) }}
                className="w-full text-xs bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-2 py-1.5 text-slate-300 focus:outline-none focus:border-blue-500">
                <option value="">— Seleccionar —</option>
                {depOpts.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>

            {/* Para no-lineal: solo 1 independiente */}
            {tipo === 'no-lineal' ? (
              <div>
                <label className="text-xs text-slate-500 block mb-1.5">Variable independiente (X)</label>
                <select value={varIndepNoLineal} onChange={(e) => setVarIndepNoLineal(e.target.value)}
                  className="w-full text-xs bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-2 py-1.5 text-slate-300 focus:outline-none focus:border-blue-500">
                  <option value="">— Seleccionar —</option>
                  {indOpts.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            ) : (
              <div className="col-span-2">
                <label className="text-xs text-slate-500 block mb-1.5">
                  {tipo === 'ponderada' ? 'Variables independientes (X)' : 'Variables independientes (X) — una o varias'}
                </label>
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
                </div>
              </div>
            )}

            {/* Para ponderada: selector de variable de pesos */}
            {tipo === 'ponderada' && (
              <div>
                <label className="text-xs text-slate-500 block mb-1.5">Variable de pesos</label>
                <select value={varPesos} onChange={(e) => setVarPesos(e.target.value)}
                  className="w-full text-xs bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-2 py-1.5 text-slate-300 focus:outline-none focus:border-blue-500">
                  <option value="">— Seleccionar —</option>
                  {numericCols.filter((c) => c !== dependiente && !independientes.includes(c)).map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            )}
          </div>
        </div>

        {error && (
          <div className="mx-5 mt-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-xs text-red-400 flex items-center gap-2">
            <AlertCircle size={14} /> {error}
          </div>
        )}

        {!resultado && !error && (
          <div className="flex flex-col items-center justify-center h-48 text-center">
            <TrendingUp size={36} className="text-slate-700 mb-3" />
            <p className="text-slate-500 text-sm">Selecciona variables y haz clic en Calcular</p>
          </div>
        )}

        {resultado && (
          <div className="p-5 space-y-4">
            {resultado.tipo?.includes('multinomial')
              ? <ResultadoMultinomial resultado={resultado} alpha={alpha} />
              : resultado.tipo?.includes('ordinal')
                ? <ResultadoOrdinal resultado={resultado} alpha={alpha} />
                : resultado.tipo?.includes('Poisson')
                  ? <ResultadoPoisson resultado={resultado} alpha={alpha} />
                  : resultado.tipo?.includes('no lineal')
                    ? <ResultadoNoLineal resultado={resultado} />
                    : resultado.tipo?.includes('ponderada') || resultado.tipo?.includes('WLS')
                      ? <ResultadoPonderada resultado={resultado} alpha={alpha} magnitudStyle={MAGNITUD_STYLE} />
                      : resultado.tipo?.includes('logística')
                        ? <ResultadoLogistica resultado={resultado} alpha={alpha} magnitudStyle={MAGNITUD_STYLE} />
                        : resultado.tipo?.includes('stepwise') || resultado.tipo?.includes('Stepwise')
                          ? <ResultadoStepwise resultado={resultado} alpha={alpha} magnitudStyle={MAGNITUD_STYLE} />
                          : <ResultadoLineal resultado={resultado} alpha={alpha} magnitudStyle={MAGNITUD_STYLE} />}
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
            {interpretandoIA && <div className="flex items-center gap-2 text-slate-400 text-sm"><Loader2 size={14} className="animate-spin" /> Analizando...</div>}
            {errorIA && <p className="text-red-400 text-xs">{errorIA}</p>}
            {interpretacionIA && <p className="text-slate-300 text-sm leading-relaxed">{interpretacionIA}</p>}
          </div>
        </aside>
      )}
    </div>
  )
}

// ─── Regresión lineal ─────────────────────────────────────────────────────────

function ResultadoLineal({ resultado, alpha, magnitudStyle }) {
  const sig = resultado.f_significativo
  return (
    <div className="space-y-4">
      {/* Veredicto */}
      <div className={`flex items-start gap-3 p-4 rounded-xl border ${
        sig ? 'bg-emerald-500/5 border-emerald-500/20' : 'bg-slate-500/5 border-slate-600/20'
      }`}>
        {sig
          ? <CheckCircle2 size={20} className="text-emerald-400 flex-shrink-0 mt-0.5" />
          : <Info size={20} className="text-slate-400 flex-shrink-0 mt-0.5" />}
        <div>
          <p className={`font-semibold text-sm ${sig ? 'text-emerald-300' : 'text-slate-300'}`}>
            {sig ? 'Modelo estadísticamente significativo' : 'Modelo no significativo'}
          </p>
          <p className="text-slate-500 text-xs mt-0.5">
            F({resultado.f_gl1}, {resultado.f_gl2}) = {resultado.f_stat},&nbsp;
            p {resultado.f_p_value < 0.001 ? '< 0.001' : `= ${resultado.f_p_value}`}
          </p>
        </div>
      </div>

      {/* Métricas del modelo */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="R²" value={resultado.r2} badge={_r2Badge(resultado.r2)} magnitudStyle={magnitudStyle} />
        <StatCard label="R² ajustado" value={resultado.r2_ajustado} />
        <StatCard label="R" value={resultado.r} />
        <StatCard label="RMSE" value={resultado.rmse} />
        <StatCard label="n" value={resultado.n} />
        <StatCard label="Predictores (k)" value={resultado.k} />
        <StatCard
          label="p-valor (F)"
          value={resultado.f_p_value < 0.001 ? '< 0.001' : resultado.f_p_value}
          highlight={sig ? 'green' : 'default'}
        />
        <StatCard label="Durbin-Watson" value={resultado.durbin_watson} />
      </div>

      {/* Tabla de coeficientes */}
      <div className="card overflow-auto">
        <p className="text-xs text-slate-500 px-4 pt-3 pb-1 font-semibold">Coeficientes</p>
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-[var(--color-border)]" style={{ background: 'var(--color-bg)' }}>
              <th className="px-4 py-2.5 text-left text-slate-400">Variable</th>
              <th className="px-4 py-2.5 text-right text-slate-400">B</th>
              <th className="px-4 py-2.5 text-right text-slate-400">Error std.</th>
              <th className="px-4 py-2.5 text-right text-slate-400">t</th>
              <th className="px-4 py-2.5 text-right text-slate-400">p</th>
              <th className="px-4 py-2.5 text-right text-slate-400">IC {Math.round((1 - alpha) * 100)}%</th>
            </tr>
          </thead>
          <tbody>
            {resultado.coeficientes.map((c, i) => (
              <tr key={i} className="border-b border-[var(--color-border)] last:border-0">
                <td className="px-4 py-2 text-slate-300 font-medium">{c.nombre}</td>
                <td className="px-4 py-2 text-right stat-value text-slate-200">{c.b}</td>
                <td className="px-4 py-2 text-right stat-value text-slate-400">{c.se}</td>
                <td className="px-4 py-2 text-right stat-value text-slate-300">{c.t}</td>
                <td className={`px-4 py-2 text-right stat-value ${c.significativo ? 'text-emerald-400' : 'text-slate-400'}`}>
                  {c.p_value < 0.001 ? '< 0.001' : c.p_value}
                  {c.significativo && ' *'}
                </td>
                <td className="px-4 py-2 text-right stat-value text-slate-500">
                  [{c.ic_low}, {c.ic_high}]
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Coeficientes estandarizados */}
      {resultado.coef_estandarizados?.length > 0 && (
        <div className="card overflow-auto">
          <p className="text-xs text-slate-500 px-4 pt-3 pb-1 font-semibold">Coeficientes estandarizados (β)</p>
          <div className="flex flex-wrap gap-3 p-4">
            {resultado.independientes.map((v, i) => (
              <div key={v} className="flex items-center gap-2">
                <span className="text-xs text-slate-400">{v}:</span>
                <span className="stat-value text-sm text-slate-200">{resultado.coef_estandarizados[i]}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* VIF / Tolerancia */}
      {resultado.vif?.length > 0 && (
        <div className="card overflow-auto">
          <div className="flex items-center gap-2 px-4 pt-3 pb-1">
            <p className="text-xs text-slate-500 font-semibold">Multicolinealidad — VIF y Tolerancia</p>
            {resultado.multicolinealidad_ok
              ? <span className="text-[10px] text-emerald-400 bg-emerald-400/10 px-1.5 py-0.5 rounded-full">sin problemas</span>
              : <span className="text-[10px] text-red-400 bg-red-400/10 px-1.5 py-0.5 rounded-full">multicolinealidad alta</span>}
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[var(--color-border)]" style={{ background: 'var(--color-bg)' }}>
                <th className="px-4 py-2 text-left text-slate-400">Variable</th>
                <th className="px-4 py-2 text-right text-slate-400">VIF</th>
                <th className="px-4 py-2 text-right text-slate-400">Tolerancia</th>
                <th className="px-4 py-2 text-right text-slate-400">Estado</th>
              </tr>
            </thead>
            <tbody>
              {resultado.vif.map((v, i) => (
                <tr key={i} className="border-b border-[var(--color-border)] last:border-0">
                  <td className="px-4 py-2 text-slate-300">{v.variable}</td>
                  <td className={`px-4 py-2 text-right stat-value ${v.vif > 10 ? 'text-red-400 font-bold' : v.vif > 5 ? 'text-amber-400' : 'text-slate-200'}`}>{v.vif}</td>
                  <td className="px-4 py-2 text-right stat-value text-slate-400">{v.tolerancia}</td>
                  <td className={`px-4 py-2 text-right text-[10px] ${v.alerta === 'aceptable' ? 'text-emerald-400' : v.alerta === 'moderada' ? 'text-amber-400' : 'text-red-400'}`}>{v.alerta}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="px-4 pb-2 text-[10px] text-slate-600">VIF &gt; 10 → multicolinealidad grave. VIF &gt; 5 → moderada. Tolerancia = 1/VIF.</p>
        </div>
      )}

      {/* Casos influyentes */}
      {resultado.casos_influyentes?.length > 0 && (
        <div className="card overflow-auto">
          <p className="text-xs text-slate-500 px-4 pt-3 pb-1 font-semibold">
            Casos influyentes — Cook's D &gt; {resultado.umbral_cook} (umbral: 4/n)
          </p>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[var(--color-border)]" style={{ background: 'var(--color-bg)' }}>
                <th className="px-4 py-2 text-left text-slate-400">Obs.</th>
                <th className="px-4 py-2 text-right text-slate-400">Cook's D</th>
                <th className="px-4 py-2 text-right text-slate-400">Leverage</th>
                <th className="px-4 py-2 text-right text-slate-400">Resid. std.</th>
                <th className="px-4 py-2 text-center text-slate-400">Leverage alto</th>
              </tr>
            </thead>
            <tbody>
              {resultado.casos_influyentes.map((c, i) => (
                <tr key={i} className="border-b border-[var(--color-border)] last:border-0">
                  <td className="px-4 py-2 text-slate-300 font-mono">{c.obs}</td>
                  <td className="px-4 py-2 text-right stat-value text-amber-400 font-semibold">{c.cook_d}</td>
                  <td className={`px-4 py-2 text-right stat-value ${c.leverage_alto ? 'text-orange-400' : 'text-slate-400'}`}>{c.leverage}</td>
                  <td className={`px-4 py-2 text-right stat-value ${Math.abs(c.residuo_std) > 2 ? 'text-red-400' : 'text-slate-400'}`}>{c.residuo_std}</td>
                  <td className="px-4 py-2 text-center">{c.leverage_alto ? '⚠️' : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {resultado.n_influyentes === 0 && (
        <div className="flex items-center gap-2 text-xs text-emerald-400 p-3 bg-emerald-400/5 border border-emerald-400/20 rounded-lg">
          <CheckCircle2 size={13} /> Sin casos influyentes (Cook's D &lt; {resultado.umbral_cook})
        </div>
      )}

      {/* Gráficos de diagnóstico */}
      {resultado.diagnosticos && <DiagnosticosPlots diag={resultado.diagnosticos} />}

      {/* Nota Durbin-Watson */}
      <div className="flex items-start gap-2 text-xs text-slate-500 p-3 bg-white/[0.02] border border-[var(--color-border)] rounded-lg">
        <Info size={13} className="flex-shrink-0 mt-0.5" />
        <span>
          Durbin-Watson = {resultado.durbin_watson}. Valores cercanos a 2 indican ausencia de autocorrelación en los residuos.
        </span>
      </div>
    </div>
  )
}

// ─── Gráficos de diagnóstico (4 plots estilo R) ──────────────────────────────
function DiagnosticosPlots({ diag }) {
  const layout = {
    paper_bgcolor: 'transparent', plot_bgcolor: 'transparent',
    height: 220, margin: { l: 50, r: 15, t: 30, b: 45 },
    font: { color: '#94A3B8', size: 10 },
    xaxis: { gridcolor: '#1E293B', color: '#64748B' },
    yaxis: { gridcolor: '#1E293B', color: '#64748B' },
    showlegend: false,
  }

  return (
    <div className="card p-4">
      <p className="text-xs text-slate-500 font-semibold mb-3">Gráficos de diagnóstico de residuos</p>
      <div className="grid grid-cols-2 gap-3">
        {/* 1. Residuos vs. ajustados */}
        <div>
          <p className="text-[10px] text-slate-600 mb-1">Residuos vs. Ajustados</p>
          <Plot
            data={[{
              x: diag.residuos_vs_ajustados.x, y: diag.residuos_vs_ajustados.y,
              mode: 'markers', type: 'scatter',
              marker: { color: '#3B82F6', size: 4, opacity: 0.6 },
            }, {
              x: [Math.min(...diag.residuos_vs_ajustados.x), Math.max(...diag.residuos_vs_ajustados.x)],
              y: [0, 0], mode: 'lines', line: { color: '#EF4444', dash: 'dash', width: 1 },
            }]}
            layout={{ ...layout, xaxis: { ...layout.xaxis, title: 'Valores ajustados' }, yaxis: { ...layout.yaxis, title: 'Residuos' } }}
            config={{ displayModeBar: false, responsive: true }}
            style={{ width: '100%' }}
          />
        </div>

        {/* 2. Q-Q Plot */}
        <div>
          <p className="text-[10px] text-slate-600 mb-1">Q-Q Normal</p>
          <Plot
            data={[{
              x: diag.qq.teoricos, y: diag.qq.observados,
              mode: 'markers', type: 'scatter',
              marker: { color: '#8B5CF6', size: 4, opacity: 0.7 },
            }, {
              x: diag.qq.teoricos, y: diag.qq.teoricos,
              mode: 'lines', line: { color: '#EF4444', dash: 'dash', width: 1 },
            }]}
            layout={{ ...layout, xaxis: { ...layout.xaxis, title: 'Cuantiles teóricos' }, yaxis: { ...layout.yaxis, title: 'Cuantiles observados' } }}
            config={{ displayModeBar: false, responsive: true }}
            style={{ width: '100%' }}
          />
        </div>

        {/* 3. Escala-Localización */}
        <div>
          <p className="text-[10px] text-slate-600 mb-1">Escala-Localización</p>
          <Plot
            data={[{
              x: diag.scale_location.x, y: diag.scale_location.y,
              mode: 'markers', type: 'scatter',
              marker: { color: '#10B981', size: 4, opacity: 0.6 },
            }]}
            layout={{ ...layout, xaxis: { ...layout.xaxis, title: 'Valores ajustados' }, yaxis: { ...layout.yaxis, title: '√|Resid. std.|' } }}
            config={{ displayModeBar: false, responsive: true }}
            style={{ width: '100%' }}
          />
        </div>

        {/* 4. Residuos vs. Leverage */}
        <div>
          <p className="text-[10px] text-slate-600 mb-1">Residuos vs. Leverage</p>
          <Plot
            data={[{
              x: diag.residuos_vs_leverage.x, y: diag.residuos_vs_leverage.y,
              mode: 'markers', type: 'scatter',
              marker: {
                color: diag.residuos_vs_leverage.cook,
                colorscale: [[0,'#1E293B'],[0.5,'#F59E0B'],[1,'#EF4444']],
                size: 5, opacity: 0.8,
                colorbar: { title: "Cook's D", thickness: 8, len: 0.7, titlefont: { size: 9 } },
              },
            }, {
              x: [diag.residuos_vs_leverage.umbral_leverage, diag.residuos_vs_leverage.umbral_leverage],
              y: [-4, 4], mode: 'lines', line: { color: '#EF4444', dash: 'dash', width: 1 },
            }]}
            layout={{ ...layout, xaxis: { ...layout.xaxis, title: 'Leverage' }, yaxis: { ...layout.yaxis, title: 'Resid. std.' } }}
            config={{ displayModeBar: false, responsive: true }}
            style={{ width: '100%' }}
          />
        </div>
      </div>
    </div>
  )
}

// ─── Regresión logística multinomial ─────────────────────────────────────────
function ResultadoMultinomial({ resultado, alpha }) {
  const { confusion } = resultado
  const clases = confusion.clases

  return (
    <div className="space-y-4">
      {/* Métricas globales */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Nagelkerke R²" value={resultado.nagelkerke_r2} />
        <StatCard label="McFadden R²"   value={resultado.mcfadden_r2} />
        <StatCard label="Accuracy"      value={`${(resultado.accuracy*100).toFixed(1)}%`} highlight={resultado.accuracy>=0.6?'green':'default'} />
        <StatCard label="Clases"        value={resultado.n_clases} />
        <StatCard label="n"             value={resultado.n} />
        <StatCard label="Predictores"   value={resultado.k} />
        <StatCard label="Log-Likelihood" value={resultado.log_likelihood} />
        <StatCard label="Referencia"    value={resultado.categoria_referencia} />
      </div>

      {/* Distribución de clases */}
      <div className="card overflow-auto">
        <p className="text-xs text-slate-500 px-4 pt-3 pb-1 font-semibold">Distribución de clases</p>
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-[var(--color-border)]" style={{ background: 'var(--color-bg)' }}>
              <th className="px-4 py-2 text-left text-slate-400">Clase</th>
              <th className="px-4 py-2 text-right text-slate-400">n observado</th>
              <th className="px-4 py-2 text-right text-slate-400">% observado</th>
              <th className="px-4 py-2 text-right text-slate-400">% predicho (media)</th>
            </tr>
          </thead>
          <tbody>
            {resultado.distribucion_clases.map((c, i) => (
              <tr key={i} className="border-b border-[var(--color-border)] last:border-0">
                <td className="px-4 py-2 text-slate-300 font-medium">{c.clase}</td>
                <td className="px-4 py-2 text-right stat-value text-slate-200">{c.n}</td>
                <td className="px-4 py-2 text-right stat-value text-slate-400">{c.pct}%</td>
                <td className="px-4 py-2 text-right stat-value text-blue-300">{c.pred_pct}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Coeficientes por clase */}
      {resultado.coeficientes_por_clase.map((bloque, bi) => (
        <div key={bi} className="card overflow-auto">
          <p className="text-xs text-slate-500 px-4 pt-3 pb-1 font-semibold">
            Coeficientes: <span className="text-blue-300">{bloque.clase}</span> vs. {bloque.referencia} (referencia)
          </p>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[var(--color-border)]" style={{ background: 'var(--color-bg)' }}>
                <th className="px-4 py-2 text-left text-slate-400">Variable</th>
                <th className="px-4 py-2 text-right text-slate-400">B</th>
                <th className="px-4 py-2 text-right text-slate-400">OR</th>
              </tr>
            </thead>
            <tbody>
              {bloque.coeficientes.map((c, i) => (
                <tr key={i} className="border-b border-[var(--color-border)] last:border-0">
                  <td className="px-4 py-2 text-slate-300">{c.nombre}</td>
                  <td className="px-4 py-2 text-right stat-value text-slate-200">{c.b}</td>
                  <td className="px-4 py-2 text-right stat-value text-sky-300">{c.odds_ratio}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      {/* Matriz de confusión */}
      <div className="card overflow-auto">
        <p className="text-xs text-slate-500 px-4 pt-3 pb-1 font-semibold">Matriz de confusión</p>
        <div className="p-4 overflow-auto">
          <table className="text-xs">
            <thead>
              <tr>
                <th className="px-3 py-2 text-slate-600 text-left">Real \ Pred.</th>
                {clases.map((c) => <th key={c} className="px-3 py-2 text-right text-slate-400">{c}</th>)}
              </tr>
            </thead>
            <tbody>
              {confusion.matrix.map((row, i) => (
                <tr key={i}>
                  <td className="px-3 py-2 text-slate-400 font-medium">{clases[i]}</td>
                  {row.map((v, j) => (
                    <td key={j} className={`px-3 py-2 text-right stat-value ${i===j ? 'text-emerald-400 font-bold' : 'text-slate-400'}`}>{v}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function _r2Badge(r2) {
  if (r2 < 0.1) return 'despreciable'
  if (r2 < 0.3) return 'pequeño'
  if (r2 < 0.5) return 'mediano'
  return 'grande'
}

// ─── Regresión logística ──────────────────────────────────────────────────────

function ResultadoLogistica({ resultado, alpha, magnitudStyle }) {
  const { confusion } = resultado
  const n = confusion.tp + confusion.tn + confusion.fp + confusion.fn

  return (
    <div className="space-y-4">
      {/* Métricas del modelo */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Nagelkerke R²" value={resultado.nagelkerke_r2} badge={_r2Badge(resultado.nagelkerke_r2)} magnitudStyle={magnitudStyle} />
        <StatCard label="Accuracy" value={`${(resultado.accuracy * 100).toFixed(1)}%`} highlight={resultado.accuracy >= 0.7 ? 'green' : 'default'} />
        <StatCard label="n" value={resultado.n} />
        <StatCard label="Log-Likelihood" value={resultado.log_likelihood} />
      </div>

      {/* Información de categorías */}
      <div className="flex items-start gap-2 text-xs text-slate-400 p-3 bg-white/[0.02] border border-[var(--color-border)] rounded-lg">
        <Info size={13} className="flex-shrink-0 mt-0.5" />
        <span>
          Variable codificada: <strong className="text-slate-300">{resultado.categorias?.[0]}</strong> = 0,&nbsp;
          <strong className="text-slate-300">{resultado.categorias?.[1]}</strong> = 1
        </span>
      </div>

      {/* Tabla de coeficientes */}
      <div className="card overflow-auto">
        <p className="text-xs text-slate-500 px-4 pt-3 pb-1 font-semibold">Coeficientes y Odds Ratios</p>
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-[var(--color-border)]" style={{ background: 'var(--color-bg)' }}>
              <th className="px-4 py-2.5 text-left text-slate-400">Variable</th>
              <th className="px-4 py-2.5 text-right text-slate-400">B</th>
              <th className="px-4 py-2.5 text-right text-slate-400">Error std.</th>
              <th className="px-4 py-2.5 text-right text-slate-400">Wald</th>
              <th className="px-4 py-2.5 text-right text-slate-400">p</th>
              <th className="px-4 py-2.5 text-right text-slate-400">OR</th>
              <th className="px-4 py-2.5 text-right text-slate-400">IC OR {Math.round((1 - alpha) * 100)}%</th>
            </tr>
          </thead>
          <tbody>
            {resultado.coeficientes.map((c, i) => (
              <tr key={i} className="border-b border-[var(--color-border)] last:border-0">
                <td className="px-4 py-2 text-slate-300 font-medium">{c.nombre}</td>
                <td className="px-4 py-2 text-right stat-value text-slate-200">{c.b}</td>
                <td className="px-4 py-2 text-right stat-value text-slate-400">{c.se}</td>
                <td className="px-4 py-2 text-right stat-value text-slate-300">{c.wald ?? '—'}</td>
                <td className={`px-4 py-2 text-right stat-value ${c.significativo ? 'text-emerald-400' : 'text-slate-400'}`}>
                  {c.p_value < 0.001 ? '< 0.001' : c.p_value}
                  {c.significativo && ' *'}
                </td>
                <td className="px-4 py-2 text-right stat-value text-sky-300">{c.odds_ratio}</td>
                <td className="px-4 py-2 text-right stat-value text-slate-500">
                  [{c.ic_or_low}, {c.ic_or_high}]
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Matriz de confusión */}
      <div className="card p-4">
        <p className="text-xs text-slate-500 font-semibold mb-3">Matriz de confusión (umbral 0.5)</p>
        <div className="grid grid-cols-2 gap-2 max-w-xs">
          <ConfCell label="Verdaderos Positivos" value={confusion.tp} color="emerald" />
          <ConfCell label="Falsos Positivos" value={confusion.fp} color="red" />
          <ConfCell label="Falsos Negativos" value={confusion.fn} color="red" />
          <ConfCell label="Verdaderos Negativos" value={confusion.tn} color="emerald" />
        </div>
        <p className="text-[10px] text-slate-600 mt-2">n total = {n}</p>
      </div>
    </div>
  )
}

function ConfCell({ label, value, color }) {
  const colors = {
    emerald: 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400',
    red: 'bg-red-500/10 border-red-500/20 text-red-400',
  }
  return (
    <div className={`p-3 rounded-lg border text-center ${colors[color]}`}>
      <p className="stat-value text-xl font-bold">{value}</p>
      <p className="text-[10px] mt-1 opacity-70">{label}</p>
    </div>
  )
}

// ─── Regresión stepwise ───────────────────────────────────────────────────────

function ResultadoStepwise({ resultado, alpha, magnitudStyle }) {
  const sig = resultado.f_significativo ?? resultado.f_p < alpha
  return (
    <div className="space-y-4">
      {/* Modelo final */}
      <div className={`flex items-start gap-3 p-4 rounded-xl border ${sig !== false ? 'bg-emerald-500/5 border-emerald-500/20' : 'bg-slate-500/5 border-slate-600/20'}`}>
        <div>
          <p className="font-semibold text-sm text-emerald-300">Modelo final seleccionado</p>
          <p className="text-slate-500 text-xs mt-0.5">
            Variables: <span className="text-slate-300">{resultado.variables_seleccionadas.join(', ')}</span>
            {' · '}{resultado.pasos.length} paso{resultado.pasos.length !== 1 ? 's' : ''}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="R²" value={resultado.r2} badge={_r2Badge(resultado.r2)} magnitudStyle={magnitudStyle} />
        <StatCard label="R² ajustado" value={resultado.r2_ajustado} />
        <StatCard label="AIC" value={resultado.aic} />
        <StatCard label="RMSE" value={resultado.rmse} />
        <StatCard label="n" value={resultado.n} />
        <StatCard label="Variables selec." value={resultado.k} />
        <StatCard label="p-valor (F)" value={resultado.f_p < 0.001 ? '< 0.001' : resultado.f_p} highlight={resultado.f_p < alpha ? 'green' : 'default'} />
      </div>

      {/* Tabla de coeficientes */}
      <div className="card overflow-auto">
        <p className="text-xs text-slate-500 px-4 pt-3 pb-1 font-semibold">Coeficientes del modelo final</p>
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-[var(--color-border)]" style={{ background: 'var(--color-bg)' }}>
              <th className="px-4 py-2.5 text-left text-slate-400">Variable</th>
              <th className="px-4 py-2.5 text-right text-slate-400">B</th>
              <th className="px-4 py-2.5 text-right text-slate-400">Error std.</th>
              <th className="px-4 py-2.5 text-right text-slate-400">t</th>
              <th className="px-4 py-2.5 text-right text-slate-400">p</th>
              <th className="px-4 py-2.5 text-right text-slate-400">IC {Math.round((1-alpha)*100)}%</th>
            </tr>
          </thead>
          <tbody>
            {resultado.coeficientes.map((c, i) => (
              <tr key={i} className="border-b border-[var(--color-border)] last:border-0">
                <td className="px-4 py-2 text-slate-300 font-medium">{c.nombre}</td>
                <td className="px-4 py-2 text-right stat-value text-slate-200">{c.b}</td>
                <td className="px-4 py-2 text-right stat-value text-slate-400">{c.se}</td>
                <td className="px-4 py-2 text-right stat-value text-slate-300">{c.t}</td>
                <td className={`px-4 py-2 text-right stat-value ${c.significativo ? 'text-emerald-400' : 'text-slate-400'}`}>
                  {c.p_value < 0.001 ? '< 0.001' : c.p_value}{c.significativo && ' *'}
                </td>
                <td className="px-4 py-2 text-right stat-value text-slate-500">[{c.ic_low}, {c.ic_high}]</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Variables excluidas */}
      {resultado.variables_excluidas?.length > 0 && (
        <div className="card overflow-auto">
          <p className="text-xs text-slate-500 px-4 pt-3 pb-1 font-semibold">Variables excluidas del modelo</p>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[var(--color-border)]" style={{ background: 'var(--color-bg)' }}>
                <th className="px-4 py-2.5 text-left text-slate-400">Variable</th>
                <th className="px-4 py-2.5 text-right text-slate-400">p si entrara</th>
              </tr>
            </thead>
            <tbody>
              {resultado.variables_excluidas.map((v, i) => (
                <tr key={i} className="border-b border-[var(--color-border)] last:border-0">
                  <td className="px-4 py-2 text-slate-400">{v.variable}</td>
                  <td className="px-4 py-2 text-right stat-value text-slate-500">{v.p_si_entra}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Historial de pasos */}
      {resultado.pasos?.length > 0 && (
        <div className="card overflow-auto">
          <p className="text-xs text-slate-500 px-4 pt-3 pb-1 font-semibold">Historial de pasos</p>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[var(--color-border)]" style={{ background: 'var(--color-bg)' }}>
                <th className="px-4 py-2.5 text-left text-slate-400">Paso</th>
                <th className="px-4 py-2.5 text-left text-slate-400">Acción</th>
                <th className="px-4 py-2.5 text-left text-slate-400">Variable</th>
                <th className="px-4 py-2.5 text-right text-slate-400">p</th>
                <th className="px-4 py-2.5 text-right text-slate-400">R²</th>
                <th className="px-4 py-2.5 text-right text-slate-400">AIC</th>
              </tr>
            </thead>
            <tbody>
              {resultado.pasos.map((p, i) => (
                <tr key={i} className="border-b border-[var(--color-border)] last:border-0">
                  <td className="px-4 py-2 text-slate-500">{p.paso}</td>
                  <td className="px-4 py-2">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${p.accion === 'entra' ? 'text-emerald-400 bg-emerald-400/10' : 'text-red-400 bg-red-400/10'}`}>
                      {p.accion === 'entra' ? '+ entra' : '− sale'}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-slate-300 font-medium">{p.variable}</td>
                  <td className="px-4 py-2 text-right stat-value text-slate-400">{p.p_value}</td>
                  <td className="px-4 py-2 text-right stat-value text-slate-300">{p.r2}</td>
                  <td className="px-4 py-2 text-right stat-value text-slate-400">{p.aic}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ─── Utilidades ───────────────────────────────────────────────────────────────

// ─── Ordinal ──────────────────────────────────────────────────────────────────
function ResultadoOrdinal({ resultado, alpha }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="McFadden R²" value={resultado.mcfadden_r2} />
        <StatCard label="Accuracy" value={`${(resultado.accuracy*100).toFixed(1)}%`} highlight={resultado.accuracy>=0.5?'green':'default'} />
        <StatCard label="Categorías" value={resultado.n_categorias} />
        <StatCard label="n" value={resultado.n} />
      </div>
      <div className="card overflow-auto">
        <p className="text-xs text-slate-500 px-4 pt-3 pb-1 font-semibold">Categorías (ordenadas): {resultado.categorias?.join(' < ')}</p>
      </div>
      <TablaCoefs coeficientes={resultado.coeficientes} alpha={alpha} titulo="Coeficientes (OR = odds de categoría superior)" tipoValor="odds_ratio" labelValor="OR" />
      <div className="card overflow-auto">
        <p className="text-xs text-slate-500 px-4 pt-3 pb-1 font-semibold">Umbrales (thresholds)</p>
        <table className="w-full text-xs">
          <thead><tr className="border-b border-[var(--color-border)]" style={{background:'var(--color-bg)'}}>
            <th className="px-4 py-2 text-left text-slate-400">Umbral</th>
            <th className="px-4 py-2 text-right text-slate-400">Valor estimado</th>
          </tr></thead>
          <tbody>
            {resultado.umbrales?.map((u,i) => (
              <tr key={i} className="border-b border-[var(--color-border)] last:border-0">
                <td className="px-4 py-2 text-slate-300">{u.entre}</td>
                <td className="px-4 py-2 text-right stat-value text-slate-200">{u.umbral}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Poisson ──────────────────────────────────────────────────────────────────
function ResultadoPoisson({ resultado, alpha }) {
  const sig = resultado.coeficientes?.some(c => c.significativo && c.nombre !== '(Constante)')
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="McFadden R²" value={resultado.mcfadden_r2} />
        <StatCard label="Devianza resid." value={resultado.deviance} />
        <StatCard label="Dispersión Pearson" value={resultado.dispersion_pearson}
          highlight={resultado.sobredispersion ? 'default' : 'green'} />
        <StatCard label="n" value={resultado.n} />
      </div>
      {resultado.sobredispersion && (
        <div className="flex items-start gap-2 text-xs text-amber-400 p-3 bg-amber-400/5 border border-amber-400/20 rounded-lg">
          <AlertCircle size={13} className="flex-shrink-0 mt-0.5" />
          Sobredispersión detectada (dispersión = {resultado.dispersion_pearson}). {resultado.nota}
        </div>
      )}
      <TablaCoefs coeficientes={resultado.coeficientes} alpha={alpha} titulo="Coeficientes — IRR (Incidence Rate Ratio)" tipoValor="irr" labelValor="IRR" />
    </div>
  )
}

// ─── No lineal ────────────────────────────────────────────────────────────────
function ResultadoNoLineal({ resultado }) {
  const modelosOk = resultado.comparativa_modelos?.filter(m => m.ok) || []
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Modelo seleccionado" value={resultado.modelo_seleccionado} />
        <StatCard label="R²" value={resultado.r2} highlight={resultado.r2>=0.7?'green':'default'} />
        <StatCard label="RMSE" value={resultado.rmse} />
        <StatCard label="AIC" value={resultado.aic} />
        <StatCard label="n" value={resultado.n} />
        <StatCard label="Selección" value={resultado.seleccion} />
      </div>
      {resultado.scatter && resultado.curva_ajuste && (
        <div className="card p-3">
          <p className="text-xs text-slate-500 font-semibold mb-2">Ajuste del modelo: {resultado.modelo_seleccionado}</p>
          <Plot
            data={[
              { x: resultado.scatter.x, y: resultado.scatter.y, mode: 'markers', type: 'scatter', name: 'Datos', marker: { color: '#3B82F6', size: 5, opacity: 0.7 } },
              { x: resultado.curva_ajuste.x, y: resultado.curva_ajuste.y, mode: 'lines', type: 'scatter', name: 'Ajuste', line: { color: '#EF4444', width: 2 } },
            ]}
            layout={{ paper_bgcolor:'transparent', plot_bgcolor:'transparent', height:280, margin:{l:50,r:15,t:15,b:45}, font:{color:'#94A3B8',size:10}, xaxis:{gridcolor:'#1E293B',title:resultado.independiente}, yaxis:{gridcolor:'#1E293B',title:resultado.dependiente}, showlegend:true }}
            config={{ displayModeBar: false, responsive: true }}
            style={{ width: '100%' }}
          />
        </div>
      )}
      <div className="card overflow-auto">
        <p className="text-xs text-slate-500 px-4 pt-3 pb-1 font-semibold">Comparativa de modelos</p>
        <table className="w-full text-xs">
          <thead><tr className="border-b border-[var(--color-border)]" style={{background:'var(--color-bg)'}}>
            <th className="px-4 py-2 text-left text-slate-400">Modelo</th>
            <th className="px-4 py-2 text-right text-slate-400">R²</th>
            <th className="px-4 py-2 text-right text-slate-400">RMSE</th>
            <th className="px-4 py-2 text-right text-slate-400">AIC</th>
          </tr></thead>
          <tbody>
            {resultado.comparativa_modelos?.map((m, i) => (
              <tr key={i} className={`border-b border-[var(--color-border)] last:border-0 ${m.modelo === resultado.modelo_seleccionado ? 'bg-blue-500/5' : ''}`}>
                <td className={`px-4 py-2 ${m.modelo===resultado.modelo_seleccionado?'text-blue-300 font-semibold':'text-slate-400'}`}>
                  {m.modelo} {m.modelo===resultado.modelo_seleccionado&&'★'}
                </td>
                <td className="px-4 py-2 text-right stat-value text-slate-200">{m.ok ? m.r2 : '—'}</td>
                <td className="px-4 py-2 text-right stat-value text-slate-400">{m.ok ? m.rmse : '—'}</td>
                <td className="px-4 py-2 text-right stat-value text-slate-400">{m.ok ? m.aic : m.error?.slice(0,30)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Ponderada ────────────────────────────────────────────────────────────────
function ResultadoPonderada({ resultado, alpha, magnitudStyle }) {
  return (
    <div className="space-y-4">
      <div className={`flex items-start gap-3 p-4 rounded-xl border ${resultado.f_significativo ? 'bg-emerald-500/5 border-emerald-500/20' : 'bg-slate-500/5 border-slate-600/20'}`}>
        {resultado.f_significativo ? <CheckCircle2 size={20} className="text-emerald-400 mt-0.5" /> : <Info size={20} className="text-slate-400 mt-0.5" />}
        <div>
          <p className={`font-semibold text-sm ${resultado.f_significativo?'text-emerald-300':'text-slate-300'}`}>
            {resultado.f_significativo ? 'Modelo WLS significativo' : 'Modelo WLS no significativo'}
          </p>
          <p className="text-slate-500 text-xs mt-0.5">Variable de pesos: {resultado.pesos}</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="R² ponderado" value={resultado.r2_ponderado} badge={_r2Badge(resultado.r2_ponderado)} magnitudStyle={magnitudStyle} />
        <StatCard label="RMSE ponderado" value={resultado.rmse_ponderado} />
        <StatCard label="F" value={resultado.f_stat} />
        <StatCard label="p-valor (F)" value={resultado.f_p_value < 0.001 ? '< 0.001' : resultado.f_p_value} highlight={resultado.f_significativo?'green':'default'} />
      </div>
      <TablaCoefs coeficientes={resultado.coeficientes} alpha={alpha} titulo="Coeficientes WLS" />
    </div>
  )
}

// ─── Tabla de coeficientes reutilizable ───────────────────────────────────────
function TablaCoefs({ coeficientes, alpha, titulo = 'Coeficientes', tipoValor = null, labelValor = null }) {
  return (
    <div className="card overflow-auto">
      <p className="text-xs text-slate-500 px-4 pt-3 pb-1 font-semibold">{titulo}</p>
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-[var(--color-border)]" style={{background:'var(--color-bg)'}}>
            <th className="px-4 py-2.5 text-left text-slate-400">Variable</th>
            <th className="px-4 py-2.5 text-right text-slate-400">B</th>
            <th className="px-4 py-2.5 text-right text-slate-400">SE</th>
            <th className="px-4 py-2.5 text-right text-slate-400">{coeficientes[0]?.z !== undefined ? 'Z' : 't'}</th>
            <th className="px-4 py-2.5 text-right text-slate-400">p</th>
            {tipoValor && <th className="px-4 py-2.5 text-right text-slate-400">{labelValor}</th>}
          </tr>
        </thead>
        <tbody>
          {coeficientes?.map((c, i) => (
            <tr key={i} className="border-b border-[var(--color-border)] last:border-0">
              <td className="px-4 py-2 text-slate-300 font-medium">{c.nombre}</td>
              <td className="px-4 py-2 text-right stat-value text-slate-200">{c.b}</td>
              <td className="px-4 py-2 text-right stat-value text-slate-400">{c.se}</td>
              <td className="px-4 py-2 text-right stat-value text-slate-300">{c.z ?? c.t}</td>
              <td className={`px-4 py-2 text-right stat-value ${c.significativo?'text-emerald-400':'text-slate-400'}`}>
                {c.p_value < 0.001 ? '< 0.001' : c.p_value}{c.significativo && ' *'}
              </td>
              {tipoValor && <td className="px-4 py-2 text-right stat-value text-sky-300">{c[tipoValor]}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function StatCard({ label, value, highlight = 'default', badge, magnitudStyle = {} }) {
  const valColor = highlight === 'green' ? 'text-emerald-400' : 'text-slate-200'
  return (
    <div className="card p-3 space-y-1">
      <p className="text-[10px] text-slate-500 uppercase tracking-wider">{label}</p>
      <p className={`stat-value font-bold text-base ${valColor}`}>{value}</p>
      {badge && (
        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium capitalize ${magnitudStyle[badge] ?? 'text-slate-400 bg-slate-400/10'}`}>
          {badge}
        </span>
      )}
    </div>
  )
}
