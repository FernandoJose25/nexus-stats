import { useState } from 'react'
import { Zap, AlertCircle } from 'lucide-react'
import Plot from 'react-plotly.js'
import { useDataStore } from '../store/dataStore'
import { potenciaCalcular, potenciaCurva } from '../services/pythonApi'

const TESTS = [
  { id: 't_una_muestra',   label: 'T — una muestra' },
  { id: 't_independientes',label: 'T — muestras independientes' },
  { id: 't_relacionadas',  label: 'T — muestras relacionadas' },
  { id: 'anova',           label: 'ANOVA one-way' },
  { id: 'correlacion',     label: 'Correlación (Pearson)' },
  { id: 'chi2',            label: 'Chi-cuadrado' },
  { id: 'regresion',       label: 'Regresión lineal múltiple' },
  { id: 'proporcion',      label: 'Diferencia de proporciones' },
]

const EFECTOS_CONVENCIONALES = {
  t_una_muestra:    { pequeno: 0.2, mediano: 0.5, grande: 0.8,  param: 'd', label: "Cohen's d" },
  t_independientes: { pequeno: 0.2, mediano: 0.5, grande: 0.8,  param: 'd', label: "Cohen's d" },
  t_relacionadas:   { pequeno: 0.2, mediano: 0.5, grande: 0.8,  param: 'd', label: "Cohen's d" },
  anova:            { pequeno: 0.1, mediano: 0.25, grande: 0.40, param: 'f', label: "Cohen's f" },
  correlacion:      { pequeno: 0.1, mediano: 0.30, grande: 0.50, param: 'r', label: 'r de Pearson' },
  chi2:             { pequeno: 0.1, mediano: 0.30, grande: 0.50, param: 'w', label: "Cohen's w" },
  regresion:        { pequeno: 0.02, mediano: 0.15, grande: 0.35, param: 'f2', label: "Cohen's f²" },
  proporcion:       null,
}

export default function Potencia() {
  const [test,     setTest]    = useState('t_independientes')
  const [calcular, setCalc]    = useState('n')
  const [alpha,    setAlpha]   = useState(0.05)
  const [potencia, setPot]     = useState(0.80)
  const [n,        setN]       = useState(50)
  const [efecto,   setEfecto]  = useState(0.5)
  const [k,        setK]       = useState(3)
  const [p1,       setP1]      = useState(0.5)
  const [p2,       setP2]      = useState(0.3)
  const [bilateral,setBilat]   = useState(true)

  const [resultado, setRes]    = useState(null)
  const [curva,     setCurva]  = useState(null)
  const [error,     setError]  = useState(null)
  const [cargando,  setCarg]   = useState(false)

  const conv = EFECTOS_CONVENCIONALES[test]

  function buildParams() {
    const base = { test, calcular, alpha, potencia: Number(potencia), n: Number(n), bilateral, k: Number(k) }
    if (conv) {
      base[conv.param] = Number(efecto)
    } else {
      base.p1 = Number(p1); base.p2 = Number(p2)
    }
    return base
  }

  async function handleCalcular() {
    setError(null); setRes(null); setCurva(null); setCarg(true)
    try {
      const params = buildParams()
      const [res, curvaRes] = await Promise.all([
        potenciaCalcular(params),
        potenciaCurva(params),
      ])
      setRes(res)
      setCurva(curvaRes)
    } catch (e) {
      setError(e.message)
    } finally {
      setCarg(false)
    }
  }

  return (
    <div className="flex-1 flex overflow-hidden">
      <aside className="w-64 flex-shrink-0 border-r border-[var(--color-border)] flex flex-col overflow-y-auto"
        style={{ background: 'var(--color-surface)' }}>
        <div className="px-4 pt-4 pb-2 border-b border-[var(--color-border)]">
          <h2 className="text-sm font-semibold text-slate-200">Análisis de potencia</h2>
          <p className="text-[11px] text-slate-500 mt-0.5">Tamaño muestral · Potencia · Efecto</p>
        </div>

        <div className="p-3 space-y-3 flex-1">
          <div>
            <label className="block text-[11px] text-slate-500 mb-1">Test estadístico</label>
            <select value={test} onChange={e => { setTest(e.target.value); setRes(null) }} className="input w-full text-xs" size={1}>
              {TESTS.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-[11px] text-slate-500 mb-1">Calcular</label>
            <div className="flex flex-col gap-1">
              {[['n','Tamaño muestral (n)'],['potencia','Potencia (1−β)']].map(([v,l]) => (
                <label key={v} className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" value={v} checked={calcular===v} onChange={()=>setCalc(v)} className="accent-blue-500" />
                  <span className="text-xs text-slate-300">{l}</span>
                </label>
              ))}
            </div>
          </div>

          <hr className="border-[var(--color-border)]" />

          {/* Tamaño de efecto */}
          {conv ? (
            <div>
              <label className="block text-[11px] text-slate-500 mb-1">{conv.label} (tamaño de efecto)</label>
              <input type="number" step="0.01" value={efecto} onChange={e=>setEfecto(e.target.value)} className="input w-full text-xs" />
              <div className="flex gap-1.5 mt-1.5">
                {[['p',conv.pequeno],['m',conv.mediano],['g',conv.grande]].map(([id,v]) => (
                  <button key={id} onClick={()=>setEfecto(v)}
                    className="flex-1 py-0.5 text-[10px] rounded border border-slate-700 text-slate-500 hover:text-blue-300 hover:border-blue-500/40 transition-colors">
                    {id==='p'?'Pequeño':id==='m'?'Mediano':'Grande'}<br/>{v}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <div>
                <label className="block text-[11px] text-slate-500 mb-1">Proporción grupo 1 (p₁)</label>
                <input type="number" step="0.01" min="0" max="1" value={p1} onChange={e=>setP1(e.target.value)} className="input w-full text-xs" />
              </div>
              <div>
                <label className="block text-[11px] text-slate-500 mb-1">Proporción grupo 2 (p₂)</label>
                <input type="number" step="0.01" min="0" max="1" value={p2} onChange={e=>setP2(e.target.value)} className="input w-full text-xs" />
              </div>
            </div>
          )}

          {['anova','chi2','regresion'].includes(test) && (
            <div>
              <label className="block text-[11px] text-slate-500 mb-1">
                {test==='anova'?'Número de grupos (k)':test==='regresion'?'Predictores (k)':'GL (k−1)'}
              </label>
              <input type="number" min={2} value={k} onChange={e=>setK(e.target.value)} className="input w-full text-xs" />
            </div>
          )}

          {calcular === 'n' ? (
            <div>
              <label className="block text-[11px] text-slate-500 mb-1">Potencia deseada (1−β)</label>
              <input type="number" step="0.01" min="0.5" max="0.999" value={potencia} onChange={e=>setPot(e.target.value)} className="input w-full text-xs" />
              <div className="flex gap-1.5 mt-1.5">
                {[0.70,0.80,0.90,0.95].map(v => (
                  <button key={v} onClick={()=>setPot(v)}
                    className={`flex-1 py-0.5 text-[10px] rounded border transition-colors
                      ${Number(potencia)===v?'bg-blue-500/15 text-blue-300 border-blue-500/30':'border-slate-700 text-slate-500 hover:text-blue-300'}`}>
                    {v}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div>
              <label className="block text-[11px] text-slate-500 mb-1">N (por grupo si aplica)</label>
              <input type="number" min={2} value={n} onChange={e=>setN(e.target.value)} className="input w-full text-xs" />
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[11px] text-slate-500 mb-1">α (error tipo I)</label>
              <select value={alpha} onChange={e=>setAlpha(Number(e.target.value))} className="input w-full text-xs" size={1}>
                {[0.10,0.05,0.025,0.01].map(v=><option key={v} value={v}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[11px] text-slate-500 mb-1">Contraste</label>
              <select value={String(bilateral)} onChange={e=>setBilat(e.target.value==='true')} className="input w-full text-xs" size={1}>
                <option value="true">Bilateral</option>
                <option value="false">Unilateral</option>
              </select>
            </div>
          </div>

          <button disabled={cargando} onClick={handleCalcular} className="btn-primary w-full">
            {cargando ? 'Calculando…' : 'Calcular'}
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto p-5">
        {!resultado && !error && (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <Zap size={32} className="text-slate-700" />
            <p className="text-slate-500 text-sm">Configura los parámetros y calcula</p>
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 p-3 rounded bg-red-500/10 border border-red-500/20 text-red-400 text-xs mb-4">
            <AlertCircle size={14} className="flex-shrink-0 mt-0.5" /> {error}
          </div>
        )}

        {resultado && (
          <div className="space-y-5">
            <p className="text-sm font-semibold text-slate-200">
              {TESTS.find(t=>t.id===test)?.label}
            </p>

            {/* Resultado principal */}
            <div className="grid grid-cols-3 gap-3">
              {resultado.n != null && (
                <StatBox label="N requerido" value={resultado.n} highlight />
              )}
              {resultado.n_por_grupo != null && (
                <StatBox label="N por grupo" value={resultado.n_por_grupo} highlight />
              )}
              {resultado.n_total != null && (
                <StatBox label="N total" value={resultado.n_total} />
              )}
              <StatBox label="Potencia (1−β)" value={`${(Number(resultado.potencia)*100).toFixed(1)}%`}
                highlight={Number(resultado.potencia) >= 0.80} />
              <StatBox label="α (error tipo I)" value={resultado.alpha} />
              {resultado.interpretacion_efecto && (
                <StatBox label="Tamaño de efecto" value={resultado.interpretacion_efecto} />
              )}
            </div>

            {/* Parámetros usados */}
            <div className="rounded border border-[var(--color-border)] p-4 text-xs"
              style={{ background: 'var(--color-surface)' }}>
              <p className="font-medium text-slate-300 mb-2">Parámetros del análisis</p>
              <div className="grid grid-cols-3 gap-2">
                {Object.entries(resultado)
                  .filter(([k]) => !['test','calcular','interpretacion_efecto'].includes(k))
                  .map(([k, v]) => (
                    <div key={k} className="flex justify-between gap-2">
                      <span className="text-slate-500">{k}</span>
                      <span className="font-mono text-slate-200">{String(v)}</span>
                    </div>
                  ))}
              </div>
            </div>

            {/* Curva de potencia */}
            {curva?.curva && (
              <div className="rounded border border-[var(--color-border)] p-3"
                style={{ background: 'var(--color-surface)' }}>
                <p className="text-xs font-medium text-slate-300 mb-2">Curva de potencia</p>
                <Plot
                  data={[
                    {
                      x: curva.curva.map(p => p.n),
                      y: curva.curva.map(p => p.potencia),
                      mode: 'lines', line: { color: '#3B82F6', width: 2 },
                      name: 'Potencia',
                    },
                    {
                      x: [curva.curva[0]?.n, curva.curva[curva.curva.length-1]?.n],
                      y: [0.80, 0.80],
                      mode: 'lines', line: { color: '#F59E0B', width: 1, dash: 'dot' },
                      name: 'Potencia 0.80',
                    },
                  ]}
                  layout={{
                    paper_bgcolor: 'transparent', plot_bgcolor: 'transparent',
                    font: { color: '#94a3b8', size: 11 },
                    xaxis: { title: 'N', gridcolor: '#334155', zeroline: false },
                    yaxis: { title: 'Potencia', range: [0, 1.05], gridcolor: '#334155' },
                    legend: { orientation: 'h', y: -0.25 },
                    margin: { t: 10, l: 50, r: 20, b: 60 },
                    height: 280,
                  }}
                  config={{ responsive: true, displayModeBar: false }}
                  style={{ width: '100%' }} useResizeHandler
                />
              </div>
            )}

            <div className="text-[11px] text-slate-500 space-y-1 rounded border border-[var(--color-border)] p-3">
              <p className="font-medium text-slate-400">Interpretación</p>
              <p>• <strong>Potencia ≥ 0.80</strong>: estándar convencional (Cohen, 1988)</p>
              <p>• <strong>Potencia ≥ 0.90</strong>: recomendado para estudios clínicos</p>
              <p>• Si potencia &lt; 0.80, aumenta n o acepta un efecto mayor como mínimo detectable</p>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}

function StatBox({ label, value, highlight }) {
  return (
    <div className="rounded border border-[var(--color-border)] px-4 py-3" style={{ background: 'var(--color-surface)' }}>
      <p className="text-[11px] text-slate-500">{label}</p>
      <p className={`text-lg font-bold mt-0.5 ${highlight ? 'text-blue-300' : 'text-slate-200'}`}>{value}</p>
    </div>
  )
}
