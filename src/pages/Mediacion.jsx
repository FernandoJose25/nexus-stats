import { useState } from 'react'
import { ArrowRight, AlertCircle, Sparkles, ChevronDown, ChevronRight } from 'lucide-react'
import Plot from 'react-plotly.js'
import { useDataStore } from '../store/dataStore'
import { mediacionAjustar, mediacionSobel } from '../services/pythonApi'
import { useAnalysisStore } from '../store/analysisStore'
import { interpretarResultado } from '../services/groqService'

const MODELOS = [
  { id: 4,  label: 'Modelo 4 — Mediación simple',           desc: 'X → M → Y' },
  { id: 1,  label: 'Modelo 1 — Moderación simple',          desc: 'X → Y (moderado por W)' },
  { id: 7,  label: 'Modelo 7 — Mediación moderada',         desc: 'W modera X→M→Y' },
  { id: 58, label: 'Modelo 58 — Mediación paralela',        desc: 'X → M1, M2, M3 → Y' },
]

export default function Mediacion() {
  const { metadata } = useDataStore()
  const { guardarResultado } = useAnalysisStore()
  const numericas = (metadata?.column_info ?? []).filter(c => c.tipo === 'numerico').map(c => c.nombre)

  const [modelo,      setModelo]   = useState(4)
  const [x,           setX]        = useState('')
  const [y,           setY]        = useState('')
  const [mediadores,  setMediadores] = useState([])
  const [moderador,   setModerador] = useState('')
  const [nBoot,       setNBoot]    = useState(1000)
  const [resultado,   setRes]      = useState(null)
  const [error,       setError]    = useState(null)
  const [cargando,    setCarg]     = useState(false)
  const [iaTexto,     setIa]       = useState('')
  const [iaLoad,      setIaL]      = useState(false)

  function toggleMed(v) {
    setMediadores(p => p.includes(v) ? p.filter(x => x !== v) : [...p, v])
  }

  const modeloObj = MODELOS.find(m => m.id === modelo)
  const needsMed = [4, 7, 58].includes(modelo)
  const needsMod = [1, 7].includes(modelo)

  async function handleCalcular() {
    setError(null); setRes(null); setCarg(true)
    try {
      const res = await mediacionAjustar({
        x, y,
        mediadores: needsMed ? mediadores : [],
        moderador:  needsMod ? moderador : '',
        modelo,
        n_bootstrap: nBoot,
      })
      setRes(res)
      guardarResultado('mediacion', [x, y], res)
    } catch (e) { setError(e.message) }
    finally { setCarg(false) }
  }

  async function handleIA() {
    const key = localStorage.getItem('groq-api-key')
    if (!key || !resultado) return
    setIaL(true); setIa('')
    try { const t = await interpretarResultado(resultado, key, 'Mediación/Moderación (PROCESS)', null); setIa(t) }
    catch (e) { setIa('Error: ' + e.message) }
    finally { setIaL(false) }
  }

  const canCalc = !cargando && x && y && (
    needsMed ? mediadores.length > 0 :
    needsMod ? !!moderador : true
  )

  return (
    <div className="flex-1 flex overflow-hidden">
      <aside className="w-64 flex-shrink-0 border-r border-[var(--color-border)] flex flex-col overflow-y-auto"
        style={{ background: 'var(--color-surface)' }}>
        <div className="px-4 pt-4 pb-2 border-b border-[var(--color-border)]">
          <h2 className="text-sm font-semibold text-slate-200">Mediación / Moderación</h2>
          <p className="text-[11px] text-slate-500 mt-0.5">Equivale a PROCESS macro de Hayes</p>
        </div>

        <div className="p-3 space-y-3 flex-1">
          <div>
            <label className="block text-[11px] text-slate-500 mb-1">Modelo</label>
            <div className="space-y-1">
              {MODELOS.map(m => (
                <button key={m.id} onClick={() => { setModelo(m.id); setRes(null) }}
                  className={`w-full text-left px-3 py-2 rounded text-xs transition-colors border
                    ${modelo === m.id ? 'bg-blue-500/15 text-blue-300 border-blue-500/30' : 'text-slate-400 border-slate-700 hover:text-slate-200 hover:bg-white/5'}`}>
                  <div className="font-medium">{m.label}</div>
                  <div className="text-[10px] opacity-70 font-mono mt-0.5">{m.desc}</div>
                </button>
              ))}
            </div>
          </div>

          <hr className="border-[var(--color-border)]" />

          {[['Variable X (independiente)', x, setX], ['Variable Y (dependiente)', y, setY]].map(([lbl, val, set]) => (
            <div key={lbl}>
              <label className="block text-[11px] text-slate-500 mb-1">{lbl}</label>
              <select value={val} onChange={e => set(e.target.value)} className="input w-full text-xs" size={1}>
                <option value="">— seleccionar —</option>
                {numericas.map(v => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>
          ))}

          {needsMed && (
            <div>
              <label className="block text-[11px] text-slate-500 mb-1">
                Mediador(es) M {modelo === 58 && <span className="text-slate-600">(≥2 para paralela)</span>}
              </label>
              <div className="space-y-1.5 max-h-36 overflow-y-auto">
                {numericas.filter(v => v !== x && v !== y).map(v => (
                  <label key={v} className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={mediadores.includes(v)} onChange={() => toggleMed(v)} className="accent-blue-500" />
                    <span className="text-xs text-slate-300">{v}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {needsMod && (
            <div>
              <label className="block text-[11px] text-slate-500 mb-1">Moderador W</label>
              <select value={moderador} onChange={e => setModerador(e.target.value)} className="input w-full text-xs" size={1}>
                <option value="">— seleccionar —</option>
                {numericas.filter(v => v !== x && v !== y).map(v => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>
          )}

          <div>
            <label className="block text-[11px] text-slate-500 mb-1">Bootstrap ({nBoot} muestras)</label>
            <input type="number" min={200} max={10000} step={100} value={nBoot}
              onChange={e => setNBoot(Number(e.target.value))} className="input w-full text-xs" />
          </div>

          <button disabled={!canCalc} onClick={handleCalcular} className="btn-primary w-full">
            {cargando ? 'Calculando…' : 'Calcular'}
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto p-5">
        {!metadata && (
          <div className="flex items-center justify-center h-full">
            <p className="text-slate-500 text-sm">Carga un dataset primero</p>
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 p-3 rounded bg-red-500/10 border border-red-500/20 text-red-400 text-xs mb-4">
            <AlertCircle size={14} className="mt-0.5 flex-shrink-0"/> {error}
          </div>
        )}

        {resultado && <ResultadoMediacion res={resultado} />}

        {resultado && (
          <div className="mt-4">
            <button onClick={handleIA} disabled={iaLoad} className="btn-ghost text-xs flex items-center gap-1.5">
              <Sparkles size={13}/> {iaLoad ? 'Interpretando…' : 'Interpretar con IA'}
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

function StatBox({ label, value, sub, highlight }) {
  return (
    <div className="rounded border border-[var(--color-border)] px-4 py-3" style={{ background: 'var(--color-surface)' }}>
      <p className="text-[11px] text-slate-500">{label}</p>
      <p className={`text-base font-bold mt-0.5 ${highlight ? 'text-blue-300' : 'text-slate-200'}`}>{value}</p>
      {sub && <p className="text-[10px] text-slate-500 mt-0.5">{sub}</p>}
    </div>
  )
}

function Coef({ nombre, b, se, t, p, sig }) {
  return (
    <tr className="border-b border-[var(--color-border)]/40">
      <td className="px-3 py-1.5 text-slate-300">{nombre}</td>
      <td className="px-3 py-1.5 text-right font-mono text-slate-200">{b}</td>
      <td className="px-3 py-1.5 text-right font-mono text-slate-400">{se}</td>
      <td className="px-3 py-1.5 text-right font-mono text-slate-300">{t}</td>
      <td className={`px-3 py-1.5 text-right font-mono font-bold ${sig ? 'text-emerald-400' : 'text-slate-300'}`}>{p}</td>
    </tr>
  )
}

function ResultadoMediacion({ res }) {
  return (
    <div className="space-y-4">
      <p className="text-sm font-semibold text-slate-200">{res.tipo}</p>

      {/* Modelo 4: Mediación simple */}
      {res.modelo === 4 && res.modelos_mediadores && (
        <>
          <div className="grid grid-cols-3 gap-3">
            <StatBox label="Efecto total (c)" value={res.efecto_total_c} />
            <StatBox label="Efecto directo (c')" value={res.efecto_directo_c_prima} />
            <StatBox label="Proporción mediada" value={res.proporcion_mediada != null ? `${(res.proporcion_mediada*100).toFixed(1)}%` : '—'} />
          </div>

          {res.efectos_indirectos?.map((ef, i) => (
            <div key={i} className="rounded border border-[var(--color-border)] p-4"
              style={{ background: 'var(--color-surface)' }}>
              <p className="text-xs font-medium text-slate-300 mb-3">
                Efecto indirecto vía <strong>{ef.mediador}</strong>
                <span className={`ml-2 px-2 py-0.5 rounded text-[10px] ${ef.significativo ? 'bg-emerald-500/10 text-emerald-400' : 'bg-slate-700 text-slate-500'}`}>
                  {ef.significativo ? 'Significativo' : 'No significativo'}
                </span>
              </p>
              <div className="grid grid-cols-4 gap-3 text-xs">
                <div><p className="text-slate-500">Efecto a*b</p><p className="font-mono text-slate-200 font-bold">{ef.efecto_indirecto}</p></div>
                <div><p className="text-slate-500">Boot SE</p><p className="font-mono text-slate-300">{ef.boot_se}</p></div>
                <div><p className="text-slate-500">IC inf. (95%)</p><p className="font-mono text-slate-300">{ef.boot_ci_lo}</p></div>
                <div><p className="text-slate-500">IC sup. (95%)</p><p className="font-mono text-slate-300">{ef.boot_ci_hi}</p></div>
              </div>
              <p className="text-[10px] text-slate-600 mt-2">IC bootstrap {ef.significativo ? 'no contiene 0 → significativo' : 'contiene 0 → no significativo'}</p>
            </div>
          ))}

          {res.modelos_mediadores?.map((mm, i) => (
            <div key={i} className="rounded border border-[var(--color-border)] overflow-hidden"
              style={{ background: 'var(--color-surface)' }}>
              <div className="px-4 py-2 border-b border-[var(--color-border)]">
                <p className="text-xs font-medium text-slate-300">Coeficientes — Mediador: {mm.mediador}</p>
              </div>
              <div className="p-3 grid grid-cols-2 gap-4 text-xs">
                <div>
                  <p className="text-slate-500 mb-1">Ruta a: {res.x} → {mm.mediador}</p>
                  <div className="flex gap-4">
                    <span className="text-slate-400">b = <span className="font-mono text-slate-200">{mm.path_a.coef}</span></span>
                    <span className="text-slate-400">p = <span className={`font-mono font-bold ${mm.path_a.p < 0.05 ? 'text-emerald-400' : 'text-slate-300'}`}>{mm.path_a.p.toFixed(4)}</span></span>
                  </div>
                </div>
                <div>
                  <p className="text-slate-500 mb-1">Ruta b: {mm.mediador} → {res.y}</p>
                  <div className="flex gap-4">
                    <span className="text-slate-400">b = <span className="font-mono text-slate-200">{mm.path_b.coef}</span></span>
                    <span className="text-slate-400">p = <span className={`font-mono font-bold ${mm.path_b.p < 0.05 ? 'text-emerald-400' : 'text-slate-300'}`}>{mm.path_b.p.toFixed(4)}</span></span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </>
      )}

      {/* Modelo 1: Moderación */}
      {res.modelo === 1 && res.coeficientes && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <StatBox label="R²" value={res.r2} />
            <StatBox label="Interacción X×W"
              value={res.interaccion_significativa ? '✓ Significativa' : '— No significativa'}
              highlight={res.interaccion_significativa} />
          </div>

          <div className="rounded border border-[var(--color-border)] overflow-hidden"
            style={{ background: 'var(--color-surface)' }}>
            <div className="px-4 py-2 border-b border-[var(--color-border)]">
              <p className="text-xs font-medium text-slate-300">Coeficientes</p>
            </div>
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="text-[11px] text-slate-500 border-b border-[var(--color-border)]">
                  {['Variable','B','SE','t','p'].map(h => <th key={h} className="px-3 py-1.5 text-right first:text-left">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {res.coeficientes.map((c,i) => (
                  <Coef key={i} nombre={c.nombre} b={c.b} se={c.se} t={c.t}
                    p={c.p.toFixed(4)} sig={c.p < 0.05} />
                ))}
              </tbody>
            </table>
          </div>

          {res.pendientes_simples && (
            <div className="rounded border border-[var(--color-border)] p-4" style={{ background: 'var(--color-surface)' }}>
              <p className="text-xs font-medium text-slate-300 mb-2">Pendientes simples (Floodlight)</p>
              <div className="space-y-1">
                {res.pendientes_simples.map((p,i) => (
                  <div key={i} className="flex justify-between text-xs">
                    <span className="text-slate-400">{p.condicion}</span>
                    <span className="font-mono text-slate-200">slope = {p.slope_x}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
