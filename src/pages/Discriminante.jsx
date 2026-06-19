import { useState } from 'react'
import { ScanSearch, AlertCircle, Sparkles } from 'lucide-react'
import Plot from 'react-plotly.js'
import { useDataStore } from '../store/dataStore'
import { discriminanteAjustar } from '../services/pythonApi'
import { useAnalysisStore } from '../store/analysisStore'
import { interpretarResultado } from '../services/groqService'

export default function Discriminante() {
  const { metadata } = useDataStore()
  const { guardarResultado } = useAnalysisStore()
  const cols      = metadata?.column_info ?? []
  const numericas = cols.filter(c => c.tipo === 'numerico').map(c => c.nombre)

  const [dep,      setDep]   = useState('')
  const [indeps,   setIndeps] = useState([])
  const [tipo,     setTipo]  = useState('lineal')
  const [resultado, setRes]  = useState(null)
  const [error,    setError] = useState(null)
  const [cargando, setCarg]  = useState(false)
  const [iaTexto,  setIa]    = useState('')
  const [iaLoad,   setIaL]   = useState(false)

  function toggleIndep(v) {
    setIndeps(p => p.includes(v) ? p.filter(x => x !== v) : [...p, v])
  }

  async function handleCalcular() {
    setError(null); setRes(null); setCarg(true)
    try {
      const res = await discriminanteAjustar({ dependiente: dep, independientes: indeps, tipo })
      setRes(res)
      guardarResultado('discriminante', indeps, res)
    } catch (e) { setError(e.message) }
    finally { setCarg(false) }
  }

  async function handleIA() {
    const key = localStorage.getItem('groq-api-key')
    if (!key || !resultado) return
    setIaL(true); setIa('')
    try { const t = await interpretarResultado(resultado, key, 'Análisis discriminante', null); setIa(t) }
    catch (e) { setIa('Error: ' + e.message) }
    finally { setIaL(false) }
  }

  const canCalc = !cargando && dep && indeps.length >= 1

  return (
    <div className="flex-1 flex overflow-hidden">
      <aside className="w-64 flex-shrink-0 border-r border-[var(--color-border)] flex flex-col overflow-y-auto"
        style={{ background: 'var(--color-surface)' }}>
        <div className="px-4 pt-4 pb-2 border-b border-[var(--color-border)]">
          <h2 className="text-sm font-semibold text-slate-200">Análisis discriminante</h2>
          <p className="text-[11px] text-slate-500 mt-0.5">Equivale a Classify &gt; Discriminant en SPSS</p>
        </div>

        <div className="p-3 space-y-3 flex-1">
          <div>
            <label className="block text-[11px] text-slate-500 mb-1">Variable de grupo (factor)</label>
            <select value={dep} onChange={e => setDep(e.target.value)} className="input w-full text-xs" size={1}>
              <option value="">— seleccionar —</option>
              {cols.map(c => <option key={c.nombre} value={c.nombre}>{c.nombre}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-[11px] text-slate-500 mb-1">Variables discriminadoras</label>
            <div className="space-y-1.5 max-h-48 overflow-y-auto">
              {numericas.map(v => (
                <label key={v} className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={indeps.includes(v)} onChange={() => toggleIndep(v)} className="accent-blue-500" />
                  <span className="text-xs text-slate-300">{v}</span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-[11px] text-slate-500 mb-1">Tipo</label>
            <select value={tipo} onChange={e => setTipo(e.target.value)} className="input w-full text-xs" size={1}>
              <option value="lineal">Lineal (LDA)</option>
              <option value="cuadratico">Cuadrático (QDA)</option>
            </select>
          </div>

          <button disabled={!canCalc} onClick={handleCalcular} className="btn-primary w-full">
            {cargando ? 'Analizando…' : 'Analizar'}
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto p-5">
        {!metadata && (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <ScanSearch size={32} className="text-slate-700" />
            <p className="text-slate-500 text-sm">Carga un dataset primero</p>
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 p-3 rounded bg-red-500/10 border border-red-500/20 text-red-400 text-xs mb-4">
            <AlertCircle size={14} className="flex-shrink-0 mt-0.5" /> {error}
          </div>
        )}

        {resultado && <ResultadoDisc res={resultado} />}

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

function ResultadoDisc({ res }) {
  const COLORES = ['#3B82F6','#F59E0B','#10B981','#EF4444','#8B5CF6','#EC4899']

  return (
    <div className="space-y-4">
      <p className="text-sm font-semibold text-slate-200">
        {res.tipo} — {res.dependiente}
        <span className="text-slate-500 text-xs ml-2">N={res.n} · {res.k} grupos · {res.p} variables</span>
      </p>

      {/* Funciones discriminantes */}
      <Section title="Prueba de funciones discriminantes (Lambda de Wilks)">
        <table className="text-xs border-collapse w-full">
          <thead>
            <tr className="text-[11px] text-slate-500 border-b border-[var(--color-border)]">
              {['Función','Eigenvalor','Varianza %','Acum. %','Λ Wilks','Chi²','gl','p-valor','Sig.'].map(h => (
                <th key={h} className="px-3 py-1.5 text-right first:text-left">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {res.tests_wilks.map((t, i) => (
              <tr key={i} className="border-b border-[var(--color-border)]/40">
                <td className="px-3 py-1.5 text-slate-300 font-medium">F{t.funcion}</td>
                <td className="px-3 py-1.5 text-right font-mono text-slate-200">{t.eigenvalor}</td>
                <td className="px-3 py-1.5 text-right font-mono text-slate-300">{t.varianza_pct}%</td>
                <td className="px-3 py-1.5 text-right font-mono text-slate-400">{t.varianza_acum}%</td>
                <td className="px-3 py-1.5 text-right font-mono text-slate-200">{t.lambda_wilks}</td>
                <td className="px-3 py-1.5 text-right font-mono text-slate-200">{t.chi2}</td>
                <td className="px-3 py-1.5 text-right text-slate-400">{t.gl}</td>
                <td className="px-3 py-1.5 text-right font-mono text-slate-200">{t.p_value}</td>
                <td className="px-3 py-1.5 text-center">
                  {t.significativa ? <span className="text-emerald-400 font-bold">✓</span> : <span className="text-slate-600">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      {/* Coeficientes discriminantes */}
      <Section title="Coeficientes de las funciones discriminantes (estandarizados)">
        <table className="text-xs border-collapse w-full">
          <thead>
            <tr className="text-[11px] text-slate-500 border-b border-[var(--color-border)]">
              <th className="px-3 py-1.5 text-left">Variable</th>
              {res.funciones.map(f => (
                <th key={f.funcion} className="px-3 py-1.5 text-right">Función {f.funcion}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {res.independientes.map(v => (
              <tr key={v} className="border-b border-[var(--color-border)]/40">
                <td className="px-3 py-1.5 text-slate-300">{v}</td>
                {res.funciones.map(f => {
                  const coef = f.coeficientes.find(c => c.variable === v)
                  return (
                    <td key={f.funcion} className="px-3 py-1.5 text-right font-mono text-slate-200">
                      {coef ? coef.coef_estandarizado : '—'}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      {/* Centroides de grupos */}
      <Section title="Centroides de grupos en espacio discriminante">
        <table className="text-xs border-collapse w-full">
          <thead>
            <tr className="text-[11px] text-slate-500 border-b border-[var(--color-border)]">
              <th className="px-3 py-1.5 text-left">Grupo</th>
              <th className="px-3 py-1.5 text-right">N</th>
              {res.funciones.map(f => (
                <th key={f.funcion} className="px-3 py-1.5 text-right">F{f.funcion}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {res.centroides_grupos.map((c, i) => (
              <tr key={i} className="border-b border-[var(--color-border)]/40">
                <td className="px-3 py-1.5 text-slate-300 font-medium">{c.grupo}</td>
                <td className="px-3 py-1.5 text-right text-slate-400">{c.n}</td>
                {res.funciones.map(f => (
                  <td key={f.funcion} className="px-3 py-1.5 text-right font-mono text-slate-200">
                    {c[`F${f.funcion}`] ?? '—'}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      {/* Scatter discriminante */}
      {res.scatter && res.n_funciones >= 2 && (
        <Section title="Dispersión en espacio discriminante (F1 vs F2)">
          <Plot
            data={res.grupos.map((g, gi) => {
              const mask = res.scatter.grupo.map((gr, i) => gr === g ? i : -1).filter(i => i >= 0)
              return {
                x: mask.map(i => res.scatter.x[i]),
                y: mask.map(i => res.scatter.y[i]),
                mode: 'markers', name: g,
                marker: { color: COLORES[gi % COLORES.length], size: 5, opacity: 0.7 },
              }
            })}
            layout={{
              paper_bgcolor: 'transparent', plot_bgcolor: 'transparent',
              font: { color: '#94a3b8', size: 11 },
              xaxis: { title: 'Función 1', gridcolor: '#334155', zeroline: true, zerolinecolor: '#475569' },
              yaxis: { title: 'Función 2', gridcolor: '#334155', zeroline: true, zerolinecolor: '#475569' },
              legend: { orientation: 'h', y: -0.25 },
              margin: { t: 10, l: 50, r: 20, b: 60 },
              height: 300,
            }}
            config={{ responsive: true, displayModeBar: false }}
            style={{ width: '100%' }} useResizeHandler
          />
        </Section>
      )}

      {/* Clasificación */}
      <Section title={`Resultados de clasificación — Exactitud: ${res.clasificacion.accuracy}%`}>
        <table className="text-xs border-collapse w-full">
          <thead>
            <tr className="text-[11px] text-slate-500 border-b border-[var(--color-border)]">
              <th className="px-3 py-1.5 text-left">Grupo real</th>
              {res.grupos.map(g => <th key={g} className="px-3 py-1.5 text-right">Pred: {g}</th>)}
              <th className="px-3 py-1.5 text-right">% correcto</th>
            </tr>
          </thead>
          <tbody>
            {res.clasificacion.tabla.map((fila, i) => (
              <tr key={i} className="border-b border-[var(--color-border)]/40">
                <td className="px-3 py-1.5 text-slate-300 font-medium">{fila.grupo_real}</td>
                {res.grupos.map(g => (
                  <td key={g} className={`px-3 py-1.5 text-right font-mono
                    ${fila.grupo_real === g ? 'text-emerald-300 font-bold' : 'text-slate-400'}`}>
                    {fila[`pred_${g}`]}
                  </td>
                ))}
                <td className="px-3 py-1.5 text-right font-mono text-blue-300">{fila.correcto_pct}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
    </div>
  )
}

const COLORES = ['#3B82F6','#F59E0B','#10B981','#EF4444','#8B5CF6','#EC4899']

function Section({ title, children }) {
  return (
    <div className="rounded border border-[var(--color-border)] overflow-hidden"
      style={{ background: 'var(--color-surface)' }}>
      <div className="px-4 py-2.5 border-b border-[var(--color-border)]">
        <p className="text-xs font-medium text-slate-300">{title}</p>
      </div>
      <div className="p-3 overflow-x-auto">{children}</div>
    </div>
  )
}
