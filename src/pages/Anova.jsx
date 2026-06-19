import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Loader2, Sparkles, X, BarChart2, AlertCircle, CheckCircle2, Info,
} from 'lucide-react'
import { useDataStore } from '../store/dataStore'
import { anovaOneWay, anovaTwoWay } from '../services/pythonApi'
import { interpretarResultado } from '../services/groqService'

const MAGNITUD_STYLE = {
  despreciable: 'text-slate-500 bg-slate-500/10',
  pequeño:      'text-sky-400 bg-sky-400/10',
  mediano:      'text-amber-400 bg-amber-400/10',
  grande:       'text-violet-400 bg-violet-400/10',
}

export default function Anova() {
  const navigate = useNavigate()
  const { metadata, getNumericColumns, getAllColumns } = useDataStore()

  const [modo, setModo] = useState('one-way')   // 'one-way' | 'two-way'
  const [dependiente, setDependiente] = useState('')
  const [factor, setFactor] = useState('')
  const [factorB, setFactorB] = useState('')
  const [alpha, setAlpha] = useState(0.05)
  const [posthoc, setPosthoc] = useState(true)
  const [metodoPosthoc, setMetodoPosthoc] = useState('tukey')

  const [calculando, setCalculando] = useState(false)
  const [resultado, setResultado] = useState(null)
  const [error, setError] = useState(null)

  const [interpretacionIA, setInterpretacionIA] = useState(null)
  const [interpretandoIA, setInterpretandoIA] = useState(false)
  const [errorIA, setErrorIA] = useState(null)
  const abortRef = useRef(null)

  const numericCols = (getNumericColumns?.() ?? []).map((c) => c.nombre)
  const allCols = (getAllColumns?.() ?? []).map((c) => c.nombre)
  const factorOpts = allCols.filter((c) => c !== dependiente)

  async function handleCalcular() {
    if (!dependiente || !factor) return
    if (modo === 'two-way' && !factorB) return
    setCalculando(true)
    setError(null)
    setResultado(null)
    try {
      const resp = modo === 'one-way'
        ? await anovaOneWay(dependiente, factor, alpha, posthoc, metodoPosthoc)
        : await anovaTwoWay(dependiente, factor, factorB, alpha, posthoc)
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

  const canCalc = dependiente && factor

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Sidebar */}
      <aside className="w-56 flex-shrink-0 border-r border-[var(--color-border)] flex flex-col overflow-hidden">
        <div className="px-4 py-3 border-b border-[var(--color-border)]">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">ANOVA</p>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {[
            { id: 'one-way', label: 'ANOVA un factor' },
            { id: 'two-way', label: 'ANOVA dos factores' },
          ].map(({ id, label }) => (
            <button key={id} onClick={() => { setModo(id); setResultado(null); setError(null); setFactorB('') }}
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
          <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer">
            <input type="checkbox" checked={posthoc} onChange={(e) => setPosthoc(e.target.checked)} className="accent-blue-500" />
            Post-hoc
          </label>
          {posthoc && modo === 'one-way' && (
            <select value={metodoPosthoc} onChange={(e) => setMetodoPosthoc(e.target.value)}
              className="w-full text-xs bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-2 py-1.5 text-slate-300 focus:outline-none focus:border-blue-500">
              <option value="tukey">Tukey HSD</option>
              <option value="bonferroni">Bonferroni</option>
              <option value="scheffe">Scheffé</option>
              <option value="todos">Todos (Tukey + Bonferroni + Scheffé)</option>
            </select>
          )}
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
        <div className="p-5 border-b border-[var(--color-border)]">
          <div
            className="flex items-start justify-between mb-4"
            style={{ paddingRight: 'calc(var(--titlebar-controls-width) + 8px)' }}
          >
            <div>
              <p className="font-semibold text-slate-200">ANOVA de un factor</p>
              <p className="text-slate-500 text-xs mt-0.5">
                Compara medias de 3 o más grupos independientes con prueba F
              </p>
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

          <div className="grid grid-cols-2 gap-3 max-w-2xl">
            <VarSelect
              label="Variable dependiente (numérica)"
              value={dependiente}
              onChange={(v) => { setDependiente(v); setFactor(''); setFactorB('') }}
              options={numericCols}
            />
            <VarSelect
              label={modo === 'one-way' ? 'Factor (variable de grupos)' : 'Factor A'}
              value={factor}
              onChange={setFactor}
              options={factorOpts}
            />
            {modo === 'two-way' && (
              <VarSelect
                label="Factor B"
                value={factorB}
                onChange={setFactorB}
                options={allCols.filter((c) => c !== dependiente && c !== factor)}
              />
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
            <BarChart2 size={36} className="text-slate-700 mb-3" />
            <p className="text-slate-500 text-sm">Configura las variables y haz clic en Calcular</p>
          </div>
        )}

        {resultado && (
          <div className="p-5 space-y-4">
            {resultado.tipo === 'ANOVA de dos factores'
              ? <ResultadoAnovaDos resultado={resultado} alpha={alpha} />
              : <ResultadoAnova resultado={resultado} alpha={alpha} />}
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

function ResultadoAnova({ resultado, alpha }) {
  const sig = resultado.significativo

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
            {sig ? 'Diferencias significativas entre grupos' : 'Sin diferencias significativas'}
          </p>
          <p className="text-slate-500 text-xs mt-0.5 capitalize">{resultado.interpretacion}</p>
        </div>
      </div>

      {/* Métricas globales */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="F" value={resultado.f_stat} />
        <StatCard
          label="p-valor"
          value={resultado.p_value < 0.001 ? '< 0.001' : resultado.p_value}
          highlight={sig ? 'green' : 'default'}
        />
        <StatCard label="η² (eta cuadrado)" value={resultado.eta2} badge={resultado.magnitud_efecto} />
        <StatCard label="ω² (omega cuadrado)" value={resultado.omega2} />
        <StatCard label="n total" value={resultado.n_total} />
        <StatCard label="Grupos (k)" value={resultado.k} />
        <StatCard label="gl entre" value={resultado.gl_between} />
        <StatCard label="gl dentro" value={resultado.gl_within} />
      </div>

      {/* Tabla ANOVA */}
      <div className="card overflow-auto">
        <p className="text-xs text-slate-500 px-4 pt-3 pb-1 font-semibold">Tabla ANOVA</p>
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-[var(--color-border)]" style={{ background: 'var(--color-bg)' }}>
              <th className="px-4 py-2.5 text-left text-slate-400">Fuente</th>
              <th className="px-4 py-2.5 text-right text-slate-400">gl</th>
              <th className="px-4 py-2.5 text-right text-slate-400">CM</th>
              <th className="px-4 py-2.5 text-right text-slate-400">F</th>
              <th className="px-4 py-2.5 text-right text-slate-400">p</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-[var(--color-border)]">
              <td className="px-4 py-2 text-slate-300">Entre grupos</td>
              <td className="px-4 py-2 text-right stat-value text-slate-400">{resultado.gl_between}</td>
              <td className="px-4 py-2 text-right stat-value text-slate-200">{resultado.ms_between}</td>
              <td className="px-4 py-2 text-right stat-value text-slate-200">{resultado.f_stat}</td>
              <td className={`px-4 py-2 text-right stat-value ${sig ? 'text-emerald-400' : 'text-slate-400'}`}>
                {resultado.p_value < 0.001 ? '< 0.001' : resultado.p_value}
              </td>
            </tr>
            <tr>
              <td className="px-4 py-2 text-slate-300">Dentro de grupos</td>
              <td className="px-4 py-2 text-right stat-value text-slate-400">{resultado.gl_within}</td>
              <td className="px-4 py-2 text-right stat-value text-slate-400">{resultado.ms_within}</td>
              <td className="px-4 py-2 text-right stat-value text-slate-600">—</td>
              <td className="px-4 py-2 text-right stat-value text-slate-600">—</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Resumen por grupo */}
      <div className="card overflow-auto">
        <p className="text-xs text-slate-500 px-4 pt-3 pb-1 font-semibold">Estadísticos por grupo</p>
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-[var(--color-border)]" style={{ background: 'var(--color-bg)' }}>
              <th className="px-4 py-2.5 text-left text-slate-400">Grupo</th>
              <th className="px-4 py-2.5 text-right text-slate-400">n</th>
              <th className="px-4 py-2.5 text-right text-slate-400">Media</th>
              <th className="px-4 py-2.5 text-right text-slate-400">Desv. típica</th>
              <th className="px-4 py-2.5 text-right text-slate-400">Mediana</th>
              <th className="px-4 py-2.5 text-right text-slate-400">IC {Math.round((1 - alpha) * 100)}%</th>
            </tr>
          </thead>
          <tbody>
            {resultado.grupos.map((g, i) => (
              <tr key={i} className="border-b border-[var(--color-border)] last:border-0">
                <td className="px-4 py-2 text-slate-300 font-medium">{g.grupo}</td>
                <td className="px-4 py-2 text-right stat-value text-slate-400">{g.n}</td>
                <td className="px-4 py-2 text-right stat-value text-slate-200">{g.media}</td>
                <td className="px-4 py-2 text-right stat-value text-slate-400">{g.desv_tipica}</td>
                <td className="px-4 py-2 text-right stat-value text-slate-400">{g.mediana}</td>
                <td className="px-4 py-2 text-right stat-value text-slate-500">[{g.ic_low}, {g.ic_high}]</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Levene */}
      <div className="flex items-start gap-2 text-xs text-slate-500 p-3 bg-white/[0.02] border border-[var(--color-border)] rounded-lg">
        <Info size={13} className="flex-shrink-0 mt-0.5" />
        <span>
          Test de Levene: F = {resultado.levene_stat}, p = {resultado.levene_p?.toFixed(4)} →{' '}
          {resultado.varianzas_homogeneas
            ? 'varianzas homogéneas (supuesto ANOVA verificado)'
            : 'varianzas heterogéneas — los resultados del ANOVA pueden no ser fiables, considera Welch ANOVA o Kruskal-Wallis'}
        </span>
      </div>

      {/* Post-hoc Tukey */}
      {resultado.posthoc_tukey?.length > 0 && (
        <PosthocTabla titulo="Post-hoc Tukey HSD" comparaciones={resultado.posthoc_tukey} alpha={alpha}
          columnas={[{k:'p_value',label:'p'}]} />
      )}
      {/* Post-hoc Bonferroni */}
      {resultado.posthoc_bonferroni?.length > 0 && (
        <PosthocTabla titulo="Post-hoc Bonferroni" comparaciones={resultado.posthoc_bonferroni} alpha={alpha}
          columnas={[{k:'p_value',label:'p (sin ajuste)'},{k:'p_bonferroni',label:'p (Bonferroni)'}]} />
      )}
      {/* Post-hoc Scheffé */}
      {resultado.posthoc_scheffe?.length > 0 && (
        <PosthocTabla titulo="Post-hoc Scheffé" comparaciones={resultado.posthoc_scheffe} alpha={alpha}
          columnas={[{k:'f_scheffe',label:'F Scheffé'},{k:'p_value',label:'p'},{k:'diferencia_critica',label:'Dif. crítica'}]} />
      )}
    </div>
  )
}

function PosthocTabla({ titulo, comparaciones, alpha, columnas }) {
  const pKey = columnas.find(c => c.k.includes('bonferroni') || (c.k === 'p_value' && columnas.length === 1))?.k || 'p_value'
  return (
    <div className="card overflow-auto">
      <p className="text-xs text-slate-500 px-4 pt-3 pb-1 font-semibold">{titulo} — comparaciones por pares</p>
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-[var(--color-border)]" style={{ background: 'var(--color-bg)' }}>
            <th className="px-4 py-2.5 text-left text-slate-400">Grupo 1</th>
            <th className="px-4 py-2.5 text-left text-slate-400">Grupo 2</th>
            <th className="px-4 py-2.5 text-right text-slate-400">Diferencia</th>
            <th className="px-4 py-2.5 text-right text-slate-400">Error std.</th>
            {columnas.map(c => <th key={c.k} className="px-4 py-2.5 text-right text-slate-400">{c.label}</th>)}
            <th className="px-4 py-2.5 text-right text-slate-400">IC {Math.round((1-alpha)*100)}%</th>
          </tr>
        </thead>
        <tbody>
          {comparaciones.map((c, i) => (
            <tr key={i} className="border-b border-[var(--color-border)] last:border-0">
              <td className="px-4 py-2 text-slate-300">{c.grupo_1}</td>
              <td className="px-4 py-2 text-slate-300">{c.grupo_2}</td>
              <td className="px-4 py-2 text-right stat-value text-slate-200">{c.diferencia}</td>
              <td className="px-4 py-2 text-right stat-value text-slate-400">{c.se}</td>
              {columnas.map((col, ci) => {
                const val = c[col.k]
                const isLastP = ci === columnas.length - 1 && col.k !== 'diferencia_critica'
                const isSig = c.significativo && isLastP
                return (
                  <td key={col.k} className={`px-4 py-2 text-right stat-value ${isSig ? 'text-emerald-400' : 'text-slate-400'}`}>
                    {typeof val === 'number' && val < 0.001 && col.k.includes('p') ? '< 0.001' : val}
                    {isSig && ' *'}
                  </td>
                )
              })}
              <td className="px-4 py-2 text-right stat-value text-slate-500">[{c.ic_low}, {c.ic_high}]</td>
            </tr>
          ))}
        </tbody>
      </table>
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

function ResultadoAnovaDos({ resultado, alpha }) {
  const t = resultado.tabla
  const filas = [
    { fuente: resultado.factor_a, ...t.factor_a },
    { fuente: resultado.factor_b, ...t.factor_b },
    { fuente: `${resultado.factor_a} × ${resultado.factor_b}`, ...t.interaccion },
    { fuente: 'Error', ...t.error, F: null, p: null, sig: null, eta2: null },
    { fuente: 'Total', SS: t.total.SS, gl: t.total.gl, MS: null, F: null, p: null, sig: null, eta2: null },
  ]

  return (
    <div className="space-y-4">
      {/* Tabla ANOVA */}
      <div className="card overflow-auto">
        <p className="text-xs text-slate-500 px-4 pt-3 pb-1 font-semibold">Tabla ANOVA — dos factores</p>
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-[var(--color-border)]" style={{ background: 'var(--color-bg)' }}>
              <th className="px-4 py-2.5 text-left text-slate-400">Fuente</th>
              <th className="px-4 py-2.5 text-right text-slate-400">SC</th>
              <th className="px-4 py-2.5 text-right text-slate-400">gl</th>
              <th className="px-4 py-2.5 text-right text-slate-400">CM</th>
              <th className="px-4 py-2.5 text-right text-slate-400">F</th>
              <th className="px-4 py-2.5 text-right text-slate-400">p</th>
              <th className="px-4 py-2.5 text-right text-slate-400">η²</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((f, i) => (
              <tr key={i} className={`border-b border-[var(--color-border)] last:border-0 ${f.sig ? 'bg-blue-500/5' : ''}`}>
                <td className="px-4 py-2 text-slate-300 font-medium">{f.fuente}</td>
                <td className="px-4 py-2 text-right stat-value text-slate-300">{f.SS}</td>
                <td className="px-4 py-2 text-right stat-value text-slate-400">{f.gl}</td>
                <td className="px-4 py-2 text-right stat-value text-slate-300">{f.MS ?? '—'}</td>
                <td className="px-4 py-2 text-right stat-value text-slate-200">{f.F ?? '—'}</td>
                <td className={`px-4 py-2 text-right stat-value ${f.sig ? 'text-emerald-400' : 'text-slate-400'}`}>
                  {f.p != null ? (f.p < 0.001 ? '< 0.001' : f.p) : '—'}
                  {f.sig && ' *'}
                </td>
                <td className="px-4 py-2 text-right stat-value text-slate-400">{f.eta2 ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Medias marginales */}
      <div className="grid grid-cols-2 gap-3">
        <MediasTable titulo={`Medias: ${resultado.factor_a}`} medias={resultado.medias_factor_a} alpha={alpha} />
        <MediasTable titulo={`Medias: ${resultado.factor_b}`} medias={resultado.medias_factor_b} alpha={alpha} />
      </div>

      {/* Medias de celdas */}
      <div className="card overflow-auto">
        <p className="text-xs text-slate-500 px-4 pt-3 pb-1 font-semibold">Medias por celda (interacción)</p>
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-[var(--color-border)]" style={{ background: 'var(--color-bg)' }}>
              <th className="px-3 py-2 text-left text-slate-400">{resultado.factor_a}</th>
              <th className="px-3 py-2 text-left text-slate-400">{resultado.factor_b}</th>
              <th className="px-3 py-2 text-right text-slate-400">n</th>
              <th className="px-3 py-2 text-right text-slate-400">Media</th>
              <th className="px-3 py-2 text-right text-slate-400">Desv.</th>
            </tr>
          </thead>
          <tbody>
            {resultado.medias_celdas.map((c, i) => (
              <tr key={i} className="border-b border-[var(--color-border)] last:border-0">
                <td className="px-3 py-2 text-slate-300">{c.nivel_a}</td>
                <td className="px-3 py-2 text-slate-300">{c.nivel_b}</td>
                <td className="px-3 py-2 text-right stat-value text-slate-400">{c.n}</td>
                <td className="px-3 py-2 text-right stat-value text-slate-200">{c.media}</td>
                <td className="px-3 py-2 text-right stat-value text-slate-400">{c.desv}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Post-hoc */}
      {(resultado.posthoc_a || resultado.posthoc_b) && (
        <div className="space-y-3">
          {resultado.posthoc_a && <PosthocTable titulo={`Post-hoc Tukey — ${resultado.factor_a}`} comparaciones={resultado.posthoc_a} alpha={alpha} />}
          {resultado.posthoc_b && <PosthocTable titulo={`Post-hoc Tukey — ${resultado.factor_b}`} comparaciones={resultado.posthoc_b} alpha={alpha} />}
        </div>
      )}
    </div>
  )
}

function MediasTable({ titulo, medias, alpha }) {
  return (
    <div className="card overflow-hidden">
      <p className="text-xs text-slate-500 px-4 pt-3 pb-1 font-semibold">{titulo}</p>
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-[var(--color-border)]" style={{ background: 'var(--color-bg)' }}>
            <th className="px-4 py-2 text-left text-slate-400">Nivel</th>
            <th className="px-4 py-2 text-right text-slate-400">n</th>
            <th className="px-4 py-2 text-right text-slate-400">Media</th>
            <th className="px-4 py-2 text-right text-slate-400">Desv.</th>
          </tr>
        </thead>
        <tbody>
          {medias.map((m, i) => (
            <tr key={i} className="border-b border-[var(--color-border)] last:border-0">
              <td className="px-4 py-2 text-slate-300">{m.nivel}</td>
              <td className="px-4 py-2 text-right stat-value text-slate-400">{m.n}</td>
              <td className="px-4 py-2 text-right stat-value text-slate-200">{m.media}</td>
              <td className="px-4 py-2 text-right stat-value text-slate-400">{m.desv}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function PosthocTable({ titulo, comparaciones, alpha }) {
  return (
    <div className="card overflow-auto">
      <p className="text-xs text-slate-500 px-4 pt-3 pb-1 font-semibold">{titulo}</p>
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-[var(--color-border)]" style={{ background: 'var(--color-bg)' }}>
            <th className="px-4 py-2.5 text-left text-slate-400">Grupo 1</th>
            <th className="px-4 py-2.5 text-left text-slate-400">Grupo 2</th>
            <th className="px-4 py-2.5 text-right text-slate-400">Dif.</th>
            <th className="px-4 py-2.5 text-right text-slate-400">p</th>
            <th className="px-4 py-2.5 text-right text-slate-400">IC {Math.round((1-alpha)*100)}%</th>
          </tr>
        </thead>
        <tbody>
          {comparaciones.map((c, i) => (
            <tr key={i} className="border-b border-[var(--color-border)] last:border-0">
              <td className="px-4 py-2 text-slate-300">{c.grupo_1}</td>
              <td className="px-4 py-2 text-slate-300">{c.grupo_2}</td>
              <td className="px-4 py-2 text-right stat-value text-slate-200">{c.diferencia}</td>
              <td className={`px-4 py-2 text-right stat-value ${c.significativo ? 'text-emerald-400' : 'text-slate-400'}`}>
                {c.p_value < 0.001 ? '< 0.001' : c.p_value}{c.significativo && ' *'}
              </td>
              <td className="px-4 py-2 text-right stat-value text-slate-500">[{c.ic_low}, {c.ic_high}]</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function VarSelect({ label, value, onChange, options }) {
  return (
    <div>
      <label className="text-xs text-slate-500 block mb-1.5">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full text-xs bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-2 py-1.5 text-slate-300 focus:outline-none focus:border-blue-500"
      >
        <option value="">— Seleccionar —</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  )
}
