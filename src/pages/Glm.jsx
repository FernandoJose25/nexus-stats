import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2, Sparkles, X, FlaskConical, AlertCircle, CheckCircle2, Info } from 'lucide-react'
import { useDataStore } from '../store/dataStore'
import { ancova, anovaMedidasRepetidas } from '../services/pythonApi'
import { interpretarResultado } from '../services/groqService'

const MAGNITUD_STYLE = {
  despreciable: 'text-slate-500 bg-slate-500/10',
  pequeño:      'text-sky-400 bg-sky-400/10',
  mediano:      'text-amber-400 bg-amber-400/10',
  grande:       'text-violet-400 bg-violet-400/10',
}

export default function Glm() {
  const navigate = useNavigate()
  const { metadata, getNumericColumns, getAllColumns } = useDataStore()

  const [modo, setModo] = useState('ancova')
  // ANCOVA
  const [dependiente, setDependiente] = useState('')
  const [factor, setFactor] = useState('')
  const [covariables, setCovariables] = useState([])
  const [testHom, setTestHom] = useState(true)
  // Medidas repetidas
  const [varsMR, setVarsMR] = useState([])
  // Comunes
  const [alpha, setAlpha] = useState(0.05)
  const [posthoc, setPosthoc] = useState(true)

  const [calculando, setCalculando] = useState(false)
  const [resultado, setResultado] = useState(null)
  const [error, setError] = useState(null)

  const [interpretacionIA, setInterpretacionIA] = useState(null)
  const [interpretandoIA, setInterpretandoIA] = useState(false)
  const [errorIA, setErrorIA] = useState(null)
  const abortRef = useRef(null)

  const numericCols = (getNumericColumns?.() ?? []).map((c) => c.nombre)
  const allCols = (getAllColumns?.() ?? []).map((c) => c.nombre)

  function toggleCov(col) { setCovariables((p) => p.includes(col) ? p.filter((c) => c !== col) : [...p, col]) }
  function toggleMR(col) { setVarsMR((p) => p.includes(col) ? p.filter((c) => c !== col) : [...p, col]) }

  async function handleCalcular() {
    setCalculando(true); setError(null); setResultado(null)
    try {
      let resp
      if (modo === 'ancova') {
        if (!dependiente || !factor || covariables.length === 0) throw new Error('Completa todos los campos')
        resp = await ancova(dependiente, factor, covariables, alpha, posthoc, testHom)
      } else {
        if (varsMR.length < 2) throw new Error('Selecciona al menos 2 variables')
        resp = await anovaMedidasRepetidas(varsMR, alpha, posthoc)
      }
      setResultado(resp)
    } catch (err) { setError(err.message) }
    finally { setCalculando(false) }
  }

  async function handleInterpretarIA() {
    const apiKey = localStorage.getItem('nexus-groq-key')
    if (!apiKey) { navigate('/configuracion'); return }
    setInterpretandoIA(true); setInterpretacionIA(null); setErrorIA(null)
    abortRef.current?.abort(); abortRef.current = new AbortController()
    try {
      const texto = await interpretarResultado(resultado, apiKey, resultado.tipo, abortRef.current.signal)
      setInterpretacionIA(texto)
    } catch (err) {
      if (err.name === 'AbortError') return
      setErrorIA(err.message)
    } finally { setInterpretandoIA(false) }
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
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Modelos GLM</p>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {[
            { id: 'ancova', label: 'ANCOVA', desc: 'ANOVA + covariable continua' },
            { id: 'medidas-repetidas', label: 'Medidas repetidas', desc: 'Within-subjects + esfericidad' },
          ].map(({ id, label, desc }) => (
            <button key={id} onClick={() => { setModo(id); setResultado(null); setError(null) }} title={desc}
              className={`w-full text-left px-2.5 py-2 rounded-lg text-xs transition-colors ${
                modo === id ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20' : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
              }`}>
              {label}
            </button>
          ))}
        </div>
        <div className="p-3 border-t border-[var(--color-border)] space-y-3">
          <div>
            <p className="text-xs text-slate-500 mb-1.5">Nivel α</p>
            <select value={alpha} onChange={(e) => setAlpha(parseFloat(e.target.value))}
              className="w-full text-xs bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-2 py-1.5 text-slate-300 focus:outline-none focus:border-blue-500">
              <option value={0.05}>0.05</option><option value={0.01}>0.01</option><option value={0.001}>0.001</option>
            </select>
          </div>
          <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer">
            <input type="checkbox" checked={posthoc} onChange={(e) => setPosthoc(e.target.checked)} className="accent-blue-500" />
            Post-hoc (Bonferroni)
          </label>
          {modo === 'ancova' && (
            <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer">
              <input type="checkbox" checked={testHom} onChange={(e) => setTestHom(e.target.checked)} className="accent-blue-500" />
              Test pendientes homogéneas
            </label>
          )}
          <button onClick={handleCalcular} disabled={calculando}
            className="btn-primary w-full text-sm flex items-center justify-center gap-2">
            {calculando ? <><Loader2 size={14} className="animate-spin" /> Calculando...</> : 'Calcular'}
          </button>
        </div>
      </aside>

      {/* Panel central */}
      <div className="flex-1 overflow-y-auto">
        <div className="p-5 border-b border-[var(--color-border)]">
          <div className="flex items-start justify-between mb-4" style={{ paddingRight: 'calc(var(--titlebar-controls-width) + 8px)' }}>
            <div>
              <p className="font-semibold text-slate-200">
                {modo === 'ancova' ? 'ANCOVA — Análisis de Covarianza' : 'ANOVA de Medidas Repetidas'}
              </p>
              <p className="text-slate-500 text-xs mt-0.5">
                {modo === 'ancova'
                  ? 'Controla el efecto de covariables continuas antes de comparar grupos'
                  : 'Compara k mediciones del mismo sujeto — con test de esfericidad'}
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

          {modo === 'ancova' ? (
            <div className="grid grid-cols-2 gap-3 max-w-2xl">
              <VarSelect label="Variable dependiente (numérica)" value={dependiente}
                onChange={(v) => { setDependiente(v); setCovariables([]) }} options={numericCols} />
              <VarSelect label="Factor (grupos)" value={factor} onChange={setFactor}
                options={allCols.filter((c) => c !== dependiente)} />
              <div className="col-span-2">
                <p className="text-xs text-slate-500 mb-2">Covariables continuas ({covariables.length} seleccionadas)</p>
                <div className="flex flex-wrap gap-1.5">
                  {numericCols.filter((c) => c !== dependiente && c !== factor).map((col) => (
                    <button key={col} onClick={() => toggleCov(col)}
                      className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                        covariables.includes(col) ? 'bg-blue-500/20 text-blue-300 border-blue-500/40' : 'text-slate-400 border-[var(--color-border)] hover:text-slate-200'
                      }`}>{col}</button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div>
              <p className="text-xs text-slate-500 mb-2">Variables / mediciones ({varsMR.length} seleccionadas — cada una = 1 nivel del factor)</p>
              <div className="flex flex-wrap gap-1.5">
                {numericCols.map((col) => (
                  <button key={col} onClick={() => toggleMR(col)}
                    className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                      varsMR.includes(col) ? 'bg-blue-500/20 text-blue-300 border-blue-500/40' : 'text-slate-400 border-[var(--color-border)] hover:text-slate-200'
                    }`}>{col}</button>
                ))}
              </div>
            </div>
          )}
        </div>

        {error && (
          <div className="mx-5 mt-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-xs text-red-400 flex items-center gap-2">
            <AlertCircle size={14} /> {error}
          </div>
        )}

        {!resultado && !error && (
          <div className="flex flex-col items-center justify-center h-48 text-center">
            <FlaskConical size={36} className="text-slate-700 mb-3" />
            <p className="text-slate-500 text-sm">Configura el modelo y haz clic en Calcular</p>
          </div>
        )}

        {resultado?.tipo === 'ANCOVA' && <ResultadoAncova resultado={resultado} alpha={alpha} />}
        {resultado?.tipo === 'ANOVA de medidas repetidas' && <ResultadoMR resultado={resultado} alpha={alpha} />}
      </div>

      {(interpretacionIA || interpretandoIA || errorIA) && (
        <aside className="w-72 flex-shrink-0 border-l border-[var(--color-border)] flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)]">
            <div className="flex items-center gap-2 text-amber-400"><Sparkles size={14} /><span className="text-xs font-semibold">Interpretación IA</span></div>
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

// ─── ANCOVA resultados ────────────────────────────────────────────────────────
function ResultadoAncova({ resultado, alpha }) {
  const t = resultado.tabla
  const sig = t.factor.sig
  return (
    <div className="p-5 space-y-4">
      <Veredicto sig={sig} titulo={sig ? 'Efecto del factor significativo (controlando covariables)' : 'Factor no significativo tras controlar covariables'}
        subtitulo={`${resultado.dependiente} ~ ${resultado.factor} + ${resultado.covariables?.join(' + ')}`} />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="F (factor)" value={t.factor.F} />
        <StatCard label="p (factor)" value={t.factor.p < 0.001 ? '< 0.001' : t.factor.p} highlight={sig ? 'green' : 'default'} />
        <StatCard label="η² parcial (factor)" value={t.factor.eta2_parcial} badge={resultado.magnitud_efecto} />
        <StatCard label="n" value={resultado.n} />
        <StatCard label="F (covariables)" value={t.covariables.F} />
        <StatCard label="p (covariables)" value={t.covariables.p < 0.001 ? '< 0.001' : t.covariables.p} highlight={t.covariables.sig ? 'green' : 'default'} />
        <StatCard label="k grupos" value={resultado.k} />
        <StatCard label="gl error" value={t.error.gl} />
      </div>

      {/* Tabla ANCOVA */}
      <TablaAncova tabla={t} alpha={alpha} />

      {/* Medias ajustadas */}
      <div className="card overflow-auto">
        <p className="text-xs text-slate-500 px-4 pt-3 pb-1 font-semibold">Medias ajustadas (LS-means) — covariables en su media</p>
        <table className="w-full text-xs">
          <thead><tr className="border-b border-[var(--color-border)]" style={{background:'var(--color-bg)'}}>
            <th className="px-4 py-2 text-left text-slate-400">Nivel</th>
            <th className="px-4 py-2 text-right text-slate-400">n</th>
            <th className="px-4 py-2 text-right text-slate-400">Media observada</th>
            <th className="px-4 py-2 text-right text-slate-400">Media ajustada</th>
          </tr></thead>
          <tbody>
            {resultado.medias_ajustadas?.map((m, i) => (
              <tr key={i} className="border-b border-[var(--color-border)] last:border-0">
                <td className="px-4 py-2 text-slate-300 font-medium">{m.nivel}</td>
                <td className="px-4 py-2 text-right stat-value text-slate-400">{m.n}</td>
                <td className="px-4 py-2 text-right stat-value text-slate-400">{m.media_observada}</td>
                <td className="px-4 py-2 text-right stat-value text-blue-300 font-semibold">{m.media_ajustada}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Test homogeneidad */}
      {resultado.test_homogeneidad_pendientes && (
        <div className={`flex items-start gap-2 text-xs p-3 rounded-lg border ${
          resultado.test_homogeneidad_pendientes.pendientes_homogeneas
            ? 'text-emerald-300 bg-emerald-500/5 border-emerald-500/20'
            : 'text-red-300 bg-red-500/5 border-red-500/20'
        }`}>
          {resultado.test_homogeneidad_pendientes.pendientes_homogeneas
            ? <CheckCircle2 size={13} className="mt-0.5 flex-shrink-0" />
            : <AlertCircle size={13} className="mt-0.5 flex-shrink-0" />}
          <span>
            Test de homogeneidad de pendientes: F({resultado.test_homogeneidad_pendientes.gl_num},{resultado.test_homogeneidad_pendientes.gl_den}) = {resultado.test_homogeneidad_pendientes.F},
            p = {resultado.test_homogeneidad_pendientes.p_value} → {resultado.test_homogeneidad_pendientes.interpretacion}
          </span>
        </div>
      )}

      {/* Post-hoc */}
      {resultado.posthoc_bonferroni?.length > 0 && (
        <PosthocAncova comparaciones={resultado.posthoc_bonferroni} alpha={alpha} />
      )}
    </div>
  )
}

function TablaAncova({ tabla, alpha }) {
  const filas = [
    { fuente: 'Factor', ...tabla.factor, eta: tabla.factor.eta2_parcial },
    { fuente: 'Covariables', ...tabla.covariables, eta: null },
    { fuente: 'Error', SS: tabla.error.SS, gl: tabla.error.gl, MS: tabla.error.MS, F: null, p: null, sig: null, eta: null },
    { fuente: 'Total', SS: tabla.total.SS, gl: tabla.total.gl, MS: null, F: null, p: null, sig: null, eta: null },
  ]
  return (
    <div className="card overflow-auto">
      <p className="text-xs text-slate-500 px-4 pt-3 pb-1 font-semibold">Tabla ANCOVA</p>
      <table className="w-full text-xs">
        <thead><tr className="border-b border-[var(--color-border)]" style={{background:'var(--color-bg)'}}>
          <th className="px-4 py-2 text-left text-slate-400">Fuente</th>
          <th className="px-4 py-2 text-right text-slate-400">SC</th>
          <th className="px-4 py-2 text-right text-slate-400">gl</th>
          <th className="px-4 py-2 text-right text-slate-400">CM</th>
          <th className="px-4 py-2 text-right text-slate-400">F</th>
          <th className="px-4 py-2 text-right text-slate-400">p</th>
          <th className="px-4 py-2 text-right text-slate-400">η²p</th>
        </tr></thead>
        <tbody>
          {filas.map((f, i) => (
            <tr key={i} className={`border-b border-[var(--color-border)] last:border-0 ${f.sig ? 'bg-blue-500/5' : ''}`}>
              <td className="px-4 py-2 text-slate-300 font-medium">{f.fuente}</td>
              <td className="px-4 py-2 text-right stat-value text-slate-300">{f.SS}</td>
              <td className="px-4 py-2 text-right stat-value text-slate-400">{f.gl}</td>
              <td className="px-4 py-2 text-right stat-value text-slate-300">{f.MS ?? '—'}</td>
              <td className="px-4 py-2 text-right stat-value text-slate-200">{f.F ?? '—'}</td>
              <td className={`px-4 py-2 text-right stat-value ${f.sig ? 'text-emerald-400' : 'text-slate-400'}`}>
                {f.p != null ? (f.p < 0.001 ? '< 0.001' : f.p) : '—'}{f.sig && ' *'}
              </td>
              <td className="px-4 py-2 text-right stat-value text-slate-400">{f.eta ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function PosthocAncova({ comparaciones, alpha }) {
  return (
    <div className="card overflow-auto">
      <p className="text-xs text-slate-500 px-4 pt-3 pb-1 font-semibold">Post-hoc — Bonferroni sobre medias ajustadas</p>
      <table className="w-full text-xs">
        <thead><tr className="border-b border-[var(--color-border)]" style={{background:'var(--color-bg)'}}>
          <th className="px-4 py-2 text-left text-slate-400">Nivel 1</th>
          <th className="px-4 py-2 text-left text-slate-400">Nivel 2</th>
          <th className="px-4 py-2 text-right text-slate-400">Dif. ajustada</th>
          <th className="px-4 py-2 text-right text-slate-400">t</th>
          <th className="px-4 py-2 text-right text-slate-400">p (Bonferroni)</th>
          <th className="px-4 py-2 text-right text-slate-400">IC {Math.round((1-alpha)*100)}%</th>
        </tr></thead>
        <tbody>
          {comparaciones.map((c, i) => (
            <tr key={i} className="border-b border-[var(--color-border)] last:border-0">
              <td className="px-4 py-2 text-slate-300">{c.nivel_1}</td>
              <td className="px-4 py-2 text-slate-300">{c.nivel_2}</td>
              <td className="px-4 py-2 text-right stat-value text-slate-200">{c.dif_medias_ajustadas}</td>
              <td className="px-4 py-2 text-right stat-value text-slate-400">{c.t}</td>
              <td className={`px-4 py-2 text-right stat-value ${c.significativo ? 'text-emerald-400' : 'text-slate-400'}`}>
                {c.p_bonferroni < 0.001 ? '< 0.001' : c.p_bonferroni}{c.significativo && ' *'}
              </td>
              <td className="px-4 py-2 text-right stat-value text-slate-500">[{c.ic_low}, {c.ic_high}]</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─── Medidas repetidas resultados ─────────────────────────────────────────────
function ResultadoMR({ resultado, alpha }) {
  const sig = resultado.significativo
  const mw = resultado.mauchly

  return (
    <div className="p-5 space-y-4">
      <Veredicto sig={sig} titulo={sig ? 'Diferencias significativas entre mediciones' : 'Sin diferencias significativas entre mediciones'}
        subtitulo={`${resultado.k} mediciones × ${resultado.n} sujetos`} />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="F" value={resultado.F} />
        <StatCard label="p-valor" value={resultado.p_value < 0.001 ? '< 0.001' : resultado.p_value} highlight={sig ? 'green' : 'default'} />
        <StatCard label="η²" value={resultado.eta2} badge={resultado.magnitud_efecto} />
        <StatCard label="ω²" value={resultado.omega2} />
        <StatCard label="n sujetos" value={resultado.n} />
        <StatCard label="k mediciones" value={resultado.k} />
        {mw && <StatCard label="F (GG)" value={resultado.F_gg} />}
        {mw && <StatCard label="p (GG)" value={resultado.p_gg < 0.001 ? '< 0.001' : resultado.p_gg} highlight={resultado.p_gg < alpha ? 'green' : 'default'} />}
      </div>

      {/* Esfericidad */}
      {mw && (
        <div className={`flex items-start gap-2 text-xs p-3 rounded-lg border ${
          mw.esfericidad_ok ? 'text-emerald-300 bg-emerald-500/5 border-emerald-500/20' : 'text-amber-300 bg-amber-500/5 border-amber-500/20'
        }`}>
          {mw.esfericidad_ok ? <CheckCircle2 size={13} className="mt-0.5 flex-shrink-0" /> : <AlertCircle size={13} className="mt-0.5 flex-shrink-0" />}
          <span>
            Mauchly W = {mw.W}, χ²({mw.gl}) = {mw.chi2}, p = {mw.p_value} → {mw.interpretacion}
            {!mw.esfericidad_ok && (
              <span className="block mt-1">
                Greenhouse-Geisser: ε = {resultado.epsilon_gg}, F = {resultado.F_gg}, p = {resultado.p_gg < 0.001 ? '< 0.001' : resultado.p_gg} ·
                Huynh-Feldt: ε = {resultado.epsilon_hf}, p = {resultado.p_hf < 0.001 ? '< 0.001' : resultado.p_hf}
              </span>
            )}
          </span>
        </div>
      )}

      {/* Tabla RM */}
      <div className="card overflow-auto">
        <p className="text-xs text-slate-500 px-4 pt-3 pb-1 font-semibold">Tabla ANOVA de medidas repetidas</p>
        <table className="w-full text-xs">
          <thead><tr className="border-b border-[var(--color-border)]" style={{background:'var(--color-bg)'}}>
            <th className="px-4 py-2 text-left text-slate-400">Fuente</th>
            <th className="px-4 py-2 text-right text-slate-400">SC</th>
            <th className="px-4 py-2 text-right text-slate-400">gl</th>
            <th className="px-4 py-2 text-right text-slate-400">CM</th>
            <th className="px-4 py-2 text-right text-slate-400">F</th>
            <th className="px-4 py-2 text-right text-slate-400">p</th>
          </tr></thead>
          <tbody>
            {[
              { fuente: 'Entre sujetos', ...resultado.tabla.entre_sujetos, MS: null, F: null, p: null },
              { fuente: 'Factor (tiempo)', ...resultado.tabla.factor_tiempo, MS: resultado.tabla.factor_tiempo.MS },
              { fuente: 'Error (within)', ...resultado.tabla.error, F: null, p: null },
              { fuente: 'Total', ...resultado.tabla.total, MS: null, F: null, p: null },
            ].map((f, i) => (
              <tr key={i} className={`border-b border-[var(--color-border)] last:border-0 ${f.sig ? 'bg-blue-500/5' : ''}`}>
                <td className="px-4 py-2 text-slate-300 font-medium">{f.fuente}</td>
                <td className="px-4 py-2 text-right stat-value text-slate-300">{f.SS}</td>
                <td className="px-4 py-2 text-right stat-value text-slate-400">{f.gl}</td>
                <td className="px-4 py-2 text-right stat-value text-slate-300">{f.MS ?? '—'}</td>
                <td className="px-4 py-2 text-right stat-value text-slate-200">{f.F ?? '—'}</td>
                <td className={`px-4 py-2 text-right stat-value ${f.sig ? 'text-emerald-400' : 'text-slate-400'}`}>
                  {f.p != null ? (f.p < 0.001 ? '< 0.001' : f.p) : '—'}{f.sig && ' *'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Descriptivos */}
      <div className="card overflow-auto">
        <p className="text-xs text-slate-500 px-4 pt-3 pb-1 font-semibold">Estadísticos por medición</p>
        <table className="w-full text-xs">
          <thead><tr className="border-b border-[var(--color-border)]" style={{background:'var(--color-bg)'}}>
            <th className="px-4 py-2 text-left text-slate-400">Variable</th>
            <th className="px-4 py-2 text-right text-slate-400">Media</th>
            <th className="px-4 py-2 text-right text-slate-400">Desv.</th>
            <th className="px-4 py-2 text-right text-slate-400">Mediana</th>
          </tr></thead>
          <tbody>
            {resultado.descriptivos?.map((d, i) => (
              <tr key={i} className="border-b border-[var(--color-border)] last:border-0">
                <td className="px-4 py-2 text-slate-300 font-medium">{d.variable}</td>
                <td className="px-4 py-2 text-right stat-value text-slate-200">{d.media}</td>
                <td className="px-4 py-2 text-right stat-value text-slate-400">{d.desv_tipica}</td>
                <td className="px-4 py-2 text-right stat-value text-slate-400">{d.mediana}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Post-hoc */}
      {resultado.posthoc?.length > 0 && (
        <div className="card overflow-auto">
          <p className="text-xs text-slate-500 px-4 pt-3 pb-1 font-semibold">Post-hoc — t relacionadas con Bonferroni</p>
          <table className="w-full text-xs">
            <thead><tr className="border-b border-[var(--color-border)]" style={{background:'var(--color-bg)'}}>
              <th className="px-4 py-2 text-left text-slate-400">Var 1</th>
              <th className="px-4 py-2 text-left text-slate-400">Var 2</th>
              <th className="px-4 py-2 text-right text-slate-400">Dif. medias</th>
              <th className="px-4 py-2 text-right text-slate-400">t</th>
              <th className="px-4 py-2 text-right text-slate-400">p (Bonferroni)</th>
              <th className="px-4 py-2 text-right text-slate-400">d Cohen</th>
            </tr></thead>
            <tbody>
              {resultado.posthoc.map((c, i) => (
                <tr key={i} className="border-b border-[var(--color-border)] last:border-0">
                  <td className="px-4 py-2 text-slate-300">{c.var_1}</td>
                  <td className="px-4 py-2 text-slate-300">{c.var_2}</td>
                  <td className="px-4 py-2 text-right stat-value text-slate-200">{c.dif_medias}</td>
                  <td className="px-4 py-2 text-right stat-value text-slate-400">{c.t}</td>
                  <td className={`px-4 py-2 text-right stat-value ${c.significativo ? 'text-emerald-400' : 'text-slate-400'}`}>
                    {c.p_bonferroni < 0.001 ? '< 0.001' : c.p_bonferroni}{c.significativo && ' *'}
                  </td>
                  <td className="px-4 py-2 text-right stat-value text-slate-400">{c.d_cohen}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ─── Helpers UI ───────────────────────────────────────────────────────────────
function Veredicto({ sig, titulo, subtitulo }) {
  return (
    <div className={`flex items-start gap-3 p-4 rounded-xl border ${sig ? 'bg-emerald-500/5 border-emerald-500/20' : 'bg-slate-500/5 border-slate-600/20'}`}>
      {sig ? <CheckCircle2 size={20} className="text-emerald-400 flex-shrink-0 mt-0.5" /> : <Info size={20} className="text-slate-400 flex-shrink-0 mt-0.5" />}
      <div>
        <p className={`font-semibold text-sm ${sig ? 'text-emerald-300' : 'text-slate-300'}`}>{titulo}</p>
        {subtitulo && <p className="text-slate-500 text-xs mt-0.5">{subtitulo}</p>}
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
      {badge && <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium capitalize ${MAGNITUD_STYLE[badge] ?? 'text-slate-400 bg-slate-400/10'}`}>{badge}</span>}
    </div>
  )
}

function VarSelect({ label, value, onChange, options }) {
  return (
    <div>
      <label className="text-xs text-slate-500 block mb-1.5">{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="w-full text-xs bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-2 py-1.5 text-slate-300 focus:outline-none focus:border-blue-500">
        <option value="">— Seleccionar —</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  )
}
