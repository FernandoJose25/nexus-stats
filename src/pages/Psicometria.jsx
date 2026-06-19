import { useState } from 'react'
import { Star, AlertCircle, Sparkles } from 'lucide-react'
import { useDataStore } from '../store/dataStore'
import { psicometriaOmega, psicometriaICC, psicometriaKappa, psicometriaKuder } from '../services/pythonApi'
import { useAnalysisStore } from '../store/analysisStore'
import { interpretarResultado } from '../services/groqService'

const TABS = [
  { id: 'omega', label: 'Omega de McDonald' },
  { id: 'icc',   label: 'ICC (Correlación intraclase)' },
  { id: 'kappa', label: 'Kappa de Cohen' },
  { id: 'kr20',  label: 'Kuder-Richardson (KR-20)' },
]

export default function Psicometria() {
  const { metadata } = useDataStore()
  const { guardarResultado } = useAnalysisStore()
  const cols      = metadata?.column_info ?? []
  const numericas = cols.filter(c => c.tipo === 'numerico').map(c => c.nombre)

  const [tab,      setTab]   = useState('omega')
  const [items,    setItems] = useState([])
  const [var1,     setVar1]  = useState('')
  const [var2,     setVar2]  = useState('')
  const [iccMod,   setIccMod]  = useState('dos_vias')
  const [iccTipo,  setIccTipo] = useState('consistencia')
  const [iccUnit,  setIccUnit] = useState('unico')
  const [ponderado, setPond]   = useState(false)

  const [resultado, setRes]  = useState(null)
  const [error,    setError] = useState(null)
  const [cargando, setCarg]  = useState(false)
  const [iaTexto,  setIa]    = useState('')
  const [iaLoad,   setIaL]   = useState(false)

  function toggleItem(v) {
    setItems(p => p.includes(v) ? p.filter(x => x !== v) : [...p, v])
  }

  async function handleCalcular() {
    setError(null); setRes(null); setCarg(true)
    try {
      let res
      if (tab === 'omega')      res = await psicometriaOmega({ items })
      else if (tab === 'icc')   res = await psicometriaICC({ items, modelo: iccMod, tipo: iccTipo, unidad: iccUnit })
      else if (tab === 'kappa') res = await psicometriaKappa({ variable_1: var1, variable_2: var2, ponderado })
      else                      res = await psicometriaKuder({ items })
      setRes(res)
      guardarResultado('psicometria', items, res)
    } catch (e) { setError(e.message) }
    finally { setCarg(false) }
  }

  async function handleIA() {
    const key = localStorage.getItem('groq-api-key')
    if (!key || !resultado) return
    setIaL(true); setIa('')
    try { const t = await interpretarResultado(resultado, key, 'Psicometría avanzada', null); setIa(t) }
    catch (e) { setIa('Error: ' + e.message) }
    finally { setIaL(false) }
  }

  const needsItems = ['omega','icc','kr20'].includes(tab)
  const canCalc = !cargando && (
    needsItems ? items.length >= 2 : (var1 && var2)
  )

  return (
    <div className="flex-1 flex overflow-hidden">
      <aside className="w-64 flex-shrink-0 border-r border-[var(--color-border)] flex flex-col overflow-y-auto"
        style={{ background: 'var(--color-surface)' }}>
        <div className="px-4 pt-4 pb-2 border-b border-[var(--color-border)]">
          <h2 className="text-sm font-semibold text-slate-200">Psicometría avanzada</h2>
          <p className="text-[11px] text-slate-500 mt-0.5">Omega · ICC · Kappa · KR-20</p>
        </div>

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

          {needsItems ? (
            <div>
              <label className="block text-[11px] text-slate-500 mb-1">
                {tab === 'icc' ? 'Evaluadores / mediciones' : 'Ítems'}
              </label>
              <div className="space-y-1.5 max-h-52 overflow-y-auto">
                {numericas.map(v => (
                  <label key={v} className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={items.includes(v)} onChange={() => toggleItem(v)} className="accent-blue-500" />
                    <span className="text-xs text-slate-300">{v}</span>
                  </label>
                ))}
              </div>
            </div>
          ) : (
            <>
              {[['Evaluador / var 1', var1, setVar1], ['Evaluador / var 2', var2, setVar2]].map(([lbl, val, set]) => (
                <div key={lbl}>
                  <label className="block text-[11px] text-slate-500 mb-1">{lbl}</label>
                  <select value={val} onChange={e => set(e.target.value)} className="input w-full text-xs" size={1}>
                    <option value="">— seleccionar —</option>
                    {cols.map(c => <option key={c.nombre} value={c.nombre}>{c.nombre}</option>)}
                  </select>
                </div>
              ))}
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={ponderado} onChange={e => setPond(e.target.checked)} className="accent-blue-500" />
                <span className="text-xs text-slate-300">Kappa ponderado (ordinales)</span>
              </label>
            </>
          )}

          {tab === 'icc' && (
            <div className="space-y-2">
              <div>
                <label className="block text-[11px] text-slate-500 mb-1">Modelo</label>
                <select value={iccMod} onChange={e => setIccMod(e.target.value)} className="input w-full text-xs" size={1}>
                  <option value="dos_vias">Dos vías (aleatorio/mixto)</option>
                  <option value="una_via">Una vía (aleatorio)</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] text-slate-500 mb-1">Tipo</label>
                <select value={iccTipo} onChange={e => setIccTipo(e.target.value)} className="input w-full text-xs" size={1}>
                  <option value="consistencia">Consistencia</option>
                  <option value="acuerdo">Acuerdo absoluto</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] text-slate-500 mb-1">Unidad de medida</label>
                <select value={iccUnit} onChange={e => setIccUnit(e.target.value)} className="input w-full text-xs" size={1}>
                  <option value="unico">Evaluador único</option>
                  <option value="promedio">Promedio de evaluadores</option>
                </select>
              </div>
            </div>
          )}

          <button disabled={!canCalc} onClick={handleCalcular} className="btn-primary w-full">
            {cargando ? 'Calculando…' : 'Calcular'}
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto p-5">
        {!metadata && (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <Star size={32} className="text-slate-700" />
            <p className="text-slate-500 text-sm">Carga un dataset primero</p>
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 p-3 rounded bg-red-500/10 border border-red-500/20 text-red-400 text-xs mb-4">
            <AlertCircle size={14} className="flex-shrink-0 mt-0.5" /> {error}
          </div>
        )}

        {resultado && <ResultadoPsico res={resultado} />}

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

function ResultadoPsico({ res }) {
  return (
    <div className="space-y-4">
      <p className="text-sm font-semibold text-slate-200">{res.tipo}</p>

      {/* Resultado principal en cards */}
      <div className="grid grid-cols-3 gap-3">
        {res.omega    != null && <BigStat label="Omega (ω)" value={res.omega} interp={res.interpretacion} />}
        {res.alpha_cronbach != null && <BigStat label="Alpha de Cronbach" value={res.alpha_cronbach} />}
        {res.diferencia_omega_alpha != null && <BigStat label="ω − α" value={res.diferencia_omega_alpha} sub="Diferencia de estimación" />}
        {res.icc      != null && <BigStat label="ICC" value={res.icc} interp={res.interpretacion} />}
        {res.ic_low   != null && <BigStat label="IC 95% ICC" value={`[${res.ic_low}, ${res.ic_high}]`} />}
        {res.F        != null && <BigStat label="F" value={`${res.F} (p=${res.p_value})`} />}
        {res.kappa    != null && <BigStat label="Kappa (κ)" value={res.kappa} interp={res.interpretacion} />}
        {res.kappa_ponderado != null && <BigStat label="Kappa ponderado" value={res.kappa_ponderado} />}
        {res.p_observada != null && <BigStat label="Po (observada)" value={res.p_observada} />}
        {res.kr20     != null && <BigStat label="KR-20" value={res.kr20} interp={res.interpretacion} />}
        {res.kr21     != null && <BigStat label="KR-21" value={res.kr21} />}
        {res.suma_pq  != null && <BigStat label="Σ p·q" value={res.suma_pq} />}
      </div>

      {/* Tabla ANOVA (ICC) */}
      {res.tabla_anova && (
        <Section title="Tabla ANOVA">
          <table className="text-xs border-collapse w-full">
            <thead>
              <tr className="text-[11px] text-slate-500 border-b border-[var(--color-border)]">
                {['Fuente','SS','gl','MS'].map(h => <th key={h} className="px-3 py-1.5 text-right first:text-left">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {res.tabla_anova.map((f, i) => (
                <tr key={i} className="border-b border-[var(--color-border)]/40">
                  <td className="px-3 py-1.5 text-slate-300">{f.fuente}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-slate-200">{f.SS}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-slate-400">{f.gl}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-slate-200">{f.MS ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}

      {/* ICC: todos los valores */}
      {res.todos_icc && (
        <Section title="Todos los ICCs calculados">
          <div className="grid grid-cols-3 gap-4 text-xs">
            {Object.entries(res.todos_icc).map(([k, v]) => (
              <div key={k}>
                <p className="text-[11px] text-slate-500">{k.replace(/_/g,' ')}</p>
                <p className="font-mono text-slate-200 text-base font-bold">{v}</p>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Tabla contingencia (kappa) */}
      {res.tabla_contingencia && (
        <Section title="Tabla de concordancia">
          <table className="text-xs border-collapse w-full">
            <thead>
              <tr className="text-[11px] text-slate-500 border-b border-[var(--color-border)]">
                <th className="px-3 py-1.5 text-left">{res.variable_1} / {res.variable_2}</th>
                {res.categorias.map(c => <th key={c} className="px-3 py-1.5 text-right">{c}</th>)}
              </tr>
            </thead>
            <tbody>
              {res.categorias.map((cat, i) => (
                <tr key={i} className="border-b border-[var(--color-border)]/40">
                  <td className="px-3 py-1.5 text-slate-300 font-medium">{cat}</td>
                  {res.tabla_contingencia[i].map((v, j) => (
                    <td key={j} className={`px-3 py-1.5 text-right font-mono ${i===j?'text-emerald-300 font-bold':'text-slate-300'}`}>{v}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}

      {/* Estadísticos por ítem */}
      {res.items && (
        <Section title="Estadísticos por ítem">
          <table className="text-xs border-collapse w-full">
            <thead>
              <tr className="text-[11px] text-slate-500 border-b border-[var(--color-border)]">
                <th className="px-3 py-1.5 text-left">Ítem</th>
                {res.items[0]?.carga    != null && <th className="px-3 py-1.5 text-right">Carga</th>}
                {res.items[0]?.unicidad != null && <th className="px-3 py-1.5 text-right">Unicidad</th>}
                {res.items[0]?.comunalidad != null && <th className="px-3 py-1.5 text-right">Comunalidad</th>}
                {res.items[0]?.p        != null && <th className="px-3 py-1.5 text-right">p (dific.)</th>}
                {res.items[0]?.pq       != null && <th className="px-3 py-1.5 text-right">p·q</th>}
                {res.items[0]?.dificultad != null && <th className="px-3 py-1.5 text-right">Nivel</th>}
              </tr>
            </thead>
            <tbody>
              {res.items.map((it, i) => (
                <tr key={i} className="border-b border-[var(--color-border)]/40 hover:bg-white/[0.02]">
                  <td className="px-3 py-1.5 text-slate-300 font-medium">{it.item}</td>
                  {it.carga    != null && <td className="px-3 py-1.5 text-right font-mono text-slate-200">{it.carga}</td>}
                  {it.unicidad != null && <td className="px-3 py-1.5 text-right font-mono text-slate-400">{it.unicidad}</td>}
                  {it.comunalidad != null && <td className="px-3 py-1.5 text-right font-mono text-slate-300">{it.comunalidad}</td>}
                  {it.p        != null && <td className="px-3 py-1.5 text-right font-mono text-slate-200">{it.p}</td>}
                  {it.pq       != null && <td className="px-3 py-1.5 text-right font-mono text-slate-400">{it.pq}</td>}
                  {it.dificultad != null && (
                    <td className={`px-3 py-1.5 text-right text-[11px] ${
                      it.dificultad==='fácil'?'text-emerald-400':it.dificultad==='difícil'?'text-red-400':'text-amber-400'
                    }`}>{it.dificultad}</td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}
    </div>
  )
}

function BigStat({ label, value, interp, sub }) {
  return (
    <div className="rounded border border-[var(--color-border)] px-4 py-3" style={{ background: 'var(--color-surface)' }}>
      <p className="text-[11px] text-slate-500">{label}</p>
      <p className="text-lg font-bold text-slate-200 mt-0.5">{value}</p>
      {interp && <p className="text-[10px] text-blue-400 mt-0.5">{interp}</p>}
      {sub && <p className="text-[10px] text-slate-500 mt-0.5">{sub}</p>}
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
