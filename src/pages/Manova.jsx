import { useState } from 'react'
import { Layers3, AlertCircle, Sparkles, Plus, Trash2 } from 'lucide-react'
import { useDataStore } from '../store/dataStore'
import { manovaAjustar } from '../services/pythonApi'
import { useAnalysisStore } from '../store/analysisStore'
import { interpretarResultado } from '../services/groqService'

export default function Manova() {
  const { metadata } = useDataStore()
  const { guardarResultado } = useAnalysisStore()
  const cols      = metadata?.column_info ?? []
  const numericas = cols.filter(c => c.tipo === 'numerico').map(c => c.nombre)

  const [factor,   setFactor]  = useState('')
  const [deps,     setDeps]    = useState([])
  const [posthoc,  setPosthoc] = useState(true)
  const [resultado, setRes]    = useState(null)
  const [error,    setError]   = useState(null)
  const [cargando, setCarg]    = useState(false)
  const [iaTexto,  setIa]      = useState('')
  const [iaLoad,   setIaL]     = useState(false)

  function toggleDep(v) {
    setDeps(p => p.includes(v) ? p.filter(x => x !== v) : [...p, v])
  }

  async function handleCalcular() {
    setError(null); setRes(null); setCarg(true)
    try {
      const res = await manovaAjustar({ factor, dependientes: deps, posthoc })
      setRes(res)
      guardarResultado('manova', deps, res)
    } catch (e) { setError(e.message) }
    finally { setCarg(false) }
  }

  async function handleIA() {
    const key = localStorage.getItem('groq-api-key')
    if (!key || !resultado) return
    setIaL(true); setIa('')
    try { const t = await interpretarResultado(resultado, key, 'MANOVA', null); setIa(t) }
    catch (e) { setIa('Error: ' + e.message) }
    finally { setIaL(false) }
  }

  const canCalc = !cargando && factor && deps.length >= 2

  return (
    <div className="flex-1 flex overflow-hidden">
      <aside className="w-64 flex-shrink-0 border-r border-[var(--color-border)] flex flex-col overflow-y-auto"
        style={{ background: 'var(--color-surface)' }}>
        <div className="px-4 pt-4 pb-2 border-b border-[var(--color-border)]">
          <h2 className="text-sm font-semibold text-slate-200">MANOVA</h2>
          <p className="text-[11px] text-slate-500 mt-0.5">Análisis multivariante de varianza</p>
        </div>

        <div className="p-3 space-y-3 flex-1">
          <div>
            <label className="block text-[11px] text-slate-500 mb-1">Factor (variable de grupo)</label>
            <select value={factor} onChange={e => setFactor(e.target.value)} className="input w-full text-xs" size={1}>
              <option value="">— seleccionar —</option>
              {cols.map(c => <option key={c.nombre} value={c.nombre}>{c.nombre}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-[11px] text-slate-500 mb-1">Variables dependientes (≥ 2)</label>
            <div className="space-y-1.5 max-h-52 overflow-y-auto">
              {numericas.map(v => (
                <label key={v} className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={deps.includes(v)} onChange={() => toggleDep(v)} className="accent-blue-500" />
                  <span className="text-xs text-slate-300">{v}</span>
                </label>
              ))}
            </div>
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={posthoc} onChange={e => setPosthoc(e.target.checked)} className="accent-blue-500" />
            <span className="text-xs text-slate-300">Post-hoc univariante</span>
          </label>

          <button disabled={!canCalc} onClick={handleCalcular} className="btn-primary w-full">
            {cargando ? 'Calculando…' : 'Calcular MANOVA'}
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto p-5">
        {!metadata && (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <Layers3 size={32} className="text-slate-700" />
            <p className="text-slate-500 text-sm">Carga un dataset primero</p>
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 p-3 rounded bg-red-500/10 border border-red-500/20 text-red-400 text-xs mb-4">
            <AlertCircle size={14} className="flex-shrink-0 mt-0.5" /> {error}
          </div>
        )}

        {resultado && <ResultadoManova res={resultado} />}

        {resultado && (
          <div className="mt-4">
            <button onClick={handleIA} disabled={iaLoad} className="btn-ghost text-xs flex items-center gap-1.5">
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

function ResultadoManova({ res }) {
  return (
    <div className="space-y-4">
      <p className="text-sm font-semibold text-slate-200">
        MANOVA — {res.factor}
        <span className="text-slate-500 text-xs ml-2">N={res.n} · {res.k} grupos · {res.dependientes.length} dependientes</span>
      </p>

      {/* Estadísticos multivariantes */}
      <Section title="Estadísticos multivariantes">
        <table className="text-xs border-collapse w-full">
          <thead>
            <tr className="text-[11px] text-slate-500 border-b border-[var(--color-border)]">
              {['Estadístico','Valor','F aprox.','gl1','gl2','p-valor','Sig.'].map(h => (
                <th key={h} className="px-3 py-1.5 text-right first:text-left">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {res.estadisticos_multivariantes.map((e, i) => (
              <tr key={i} className="border-b border-[var(--color-border)]/40 hover:bg-white/[0.02]">
                <td className="px-3 py-2 text-slate-300 font-medium">{e.nombre}</td>
                <td className="px-3 py-2 text-right font-mono text-slate-200">{e.valor}</td>
                <td className="px-3 py-2 text-right font-mono text-slate-200">{e.F ?? '—'}</td>
                <td className="px-3 py-2 text-right text-slate-400">{e.gl1 ?? '—'}</td>
                <td className="px-3 py-2 text-right text-slate-400">{e.gl2 ?? '—'}</td>
                <td className="px-3 py-2 text-right font-mono">{e.p_value != null ? (
                  <span className={e.sig ? 'text-emerald-400 font-bold' : 'text-slate-300'}>{e.p_value.toFixed(4)}</span>
                ) : '—'}</td>
                <td className="px-3 py-2 text-center">
                  {e.sig === true  ? <span className="text-emerald-400 font-bold">✓</span>
                  : e.sig === false ? <span className="text-slate-600">—</span>
                  : '?'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      {/* ANOVA univariante por dependiente */}
      <Section title="Tests univariantes (ANOVA por variable dependiente)">
        <table className="text-xs border-collapse w-full">
          <thead>
            <tr className="text-[11px] text-slate-500 border-b border-[var(--color-border)]">
              {['Variable','SS entre','SS intra','MS entre','MS intra','F','gl1','gl2','p-valor','η²','Sig.'].map(h => (
                <th key={h} className="px-2 py-1.5 text-right first:text-left">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {res.anovas_univariantes.map((a, i) => (
              <tr key={i} className="border-b border-[var(--color-border)]/40">
                <td className="px-2 py-1.5 text-slate-300 font-medium">{a.variable}</td>
                <td className="px-2 py-1.5 text-right font-mono text-slate-300">{a.ss_between}</td>
                <td className="px-2 py-1.5 text-right font-mono text-slate-400">{a.ss_within}</td>
                <td className="px-2 py-1.5 text-right font-mono text-slate-300">{a.ms_between}</td>
                <td className="px-2 py-1.5 text-right font-mono text-slate-400">{a.ms_within}</td>
                <td className="px-2 py-1.5 text-right font-mono text-slate-200">{a.F ?? '—'}</td>
                <td className="px-2 py-1.5 text-right text-slate-400">{a.gl_between}</td>
                <td className="px-2 py-1.5 text-right text-slate-400">{a.gl_within}</td>
                <td className={`px-2 py-1.5 text-right font-mono font-bold ${a.significativo ? 'text-emerald-400' : 'text-slate-300'}`}>
                  {a.p_value?.toFixed(4) ?? '—'}
                </td>
                <td className="px-2 py-1.5 text-right font-mono text-blue-300">{a.eta2}</td>
                <td className="px-2 py-1.5 text-center">
                  {a.significativo ? <span className="text-emerald-400 font-bold">✓</span> : <span className="text-slate-600">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      {/* Descriptivos */}
      <Section title="Estadísticos descriptivos por grupo">
        {res.dependientes.map(dep => (
          <div key={dep} className="mb-4">
            <p className="text-[11px] font-medium text-slate-400 mb-1.5">{dep}</p>
            <table className="text-xs border-collapse w-full">
              <thead>
                <tr className="text-[11px] text-slate-500 border-b border-[var(--color-border)]">
                  {['Grupo','N','Media','Desv. típica','IC 95%'].map(h => (
                    <th key={h} className="px-3 py-1 text-right first:text-left">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {res.descriptivos.filter(d => d.variable === dep).map((d, i) => (
                  <tr key={i} className="border-b border-[var(--color-border)]/30">
                    <td className="px-3 py-1 text-slate-300">{d.grupo}</td>
                    <td className="px-3 py-1 text-right text-slate-400">{d.n}</td>
                    <td className="px-3 py-1 text-right font-mono text-slate-200">{d.media}</td>
                    <td className="px-3 py-1 text-right font-mono text-slate-400">{d.desv}</td>
                    <td className="px-3 py-1 text-right font-mono text-slate-400">[{d.ic_low}, {d.ic_high}]</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </Section>

      {/* Post-hoc */}
      {res.posthoc?.length > 0 && (
        <Section title="Comparaciones post-hoc univariantes">
          <table className="text-xs border-collapse w-full">
            <thead>
              <tr className="text-[11px] text-slate-500 border-b border-[var(--color-border)]">
                {['Variable','Grupo 1','Grupo 2','Diferencia','SE','t','p-valor','Sig.'].map(h => (
                  <th key={h} className="px-3 py-1.5 text-right first:text-left">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {res.posthoc.map((p, i) => (
                <tr key={i} className="border-b border-[var(--color-border)]/30">
                  <td className="px-3 py-1.5 text-slate-300">{p.variable}</td>
                  <td className="px-3 py-1.5 text-right text-slate-300">{p.grupo_1}</td>
                  <td className="px-3 py-1.5 text-right text-slate-300">{p.grupo_2}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-slate-200">{p.diferencia}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-slate-400">{p.se}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-slate-200">{p.t}</td>
                  <td className={`px-3 py-1.5 text-right font-mono font-bold ${p.significativo ? 'text-emerald-400' : 'text-slate-300'}`}>
                    {p.p_value}
                  </td>
                  <td className="px-3 py-1.5 text-center">
                    {p.significativo ? <span className="text-emerald-400 font-bold">✓</span> : <span className="text-slate-600">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}
    </div>
  )
}

function Section({ title, children }) {
  return (
    <div className="rounded border border-[var(--color-border)] overflow-hidden" style={{ background: 'var(--color-surface)' }}>
      <div className="px-4 py-2.5 border-b border-[var(--color-border)]">
        <p className="text-xs font-medium text-slate-300">{title}</p>
      </div>
      <div className="p-3 overflow-x-auto">{children}</div>
    </div>
  )
}
